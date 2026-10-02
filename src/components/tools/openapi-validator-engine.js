// OpenAPI Validator engine. Pure functions, no DOM: used by openapi-validator.worker.js, by the
// main-thread fallback in OpenapiValidatorTool.astro and by scripts/test-openapi-validator.mjs.
//
// validateProject({ root, files }, lib) parses every file, resolves $ref between them, validates
// the root document against the official JSON Schema for its version (Swagger 2.0, OpenAPI 3.0,
// 3.1, 3.2) and runs the rules the schemas cannot express. It returns plain data that can be
// posted across a worker boundary: { kind, version, problems, summary }. Every problem has a
// level (error / warning / info), a message code with arguments (the page formats the text in
// its language), the file, a JSON Pointer and the line and column in that file.
//
// lib: { jsyaml, Ajv, Ajv2020, addFormats, schemas: { '2.0', 'draft-04', '3.0', '3.1', '3.2' } }

var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };

/* ───────────────────────── YAML / JSON parsing with positions ───────────────────────── */

/* YAML 1.2 core schema (as Redocly, Spectral and swagger-parser read files: `2024-01-15` stays a
   string) plus merge keys (`<<: *anchor`), which Redocly and Spectral also accept. */
var schemaCache = null;
function yamlSchema(jsyaml) {
  if (!schemaCache || schemaCache.lib !== jsyaml) {
    schemaCache = { lib: jsyaml, schema: jsyaml.CORE_SCHEMA.extend({ implicit: [jsyaml.types.merge] }) };
  }
  return schemaCache.schema;
}

/* js-yaml calls the listener when it starts ('open') and finishes ('close') each node, keys
   included. The frames form a tree that mirrors the document, so a JSON Pointer can be mapped
   back to a character offset. Frame: { p: offset, k: 'm' | 's' | '', v: scalar text, c: kids }. */
export function parseText(text, jsyaml) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  var stack = [];
  var root = null;
  var bigInts = [];
  function listener(ev, st) {
    if (ev === 'open') { stack.push({ p: st.position, k: '', v: undefined, c: null }); return; }
    var f = stack.pop();
    if (!f) return;
    f.k = st.kind === 'mapping' ? 'm' : st.kind === 'sequence' ? 's' : '';
    if (st.kind === 'scalar') {
      var r = st.result;
      if (typeof r === 'string') f.v = r;
      else if (typeof r === 'number' || typeof r === 'boolean' || r === null) f.v = String(r);
      if (typeof r === 'number' && Number.isInteger(r) && !Number.isSafeInteger(r)) bigInts.push(f);
    }
    var parent = stack[stack.length - 1];
    if (parent) (parent.c || (parent.c = [])).push(f); else root = f;
  }
  var doc;
  try {
    doc = jsyaml.load(text, { schema: yamlSchema(jsyaml), listener: listener });
  } catch (e) {
    var mark = e && e.mark;
    return {
      text: text,
      error: {
        reason: String((e && e.reason) || (e && e.message) || e),
        line: mark ? mark.line + 1 : 1,
        col: mark ? mark.column + 1 : 1,
        offset: mark ? mark.position : 0,
      },
    };
  }
  var parsed = { text: text, doc: doc, root: root, lineStarts: null, bigInts: [] };
  bigInts.forEach(function (f) {
    var at = skipSpace(text, f.p);
    var m = /^[-+]?(?:0x[0-9a-fA-F_]+|0o[0-7_]+|[0-9][0-9_]*)/.exec(text.slice(at, at + 64));
    parsed.bigInts.push({ offset: at, raw: m ? m[0] : '' });
  });
  return parsed;
}

function skipSpace(text, p) {
  while (p < text.length) {
    var ch = text.charCodeAt(p);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13) { p++; continue; }
    if (ch === 35) { while (p < text.length && text.charCodeAt(p) !== 10) p++; continue; }
    if (ch === 45 && text.charCodeAt(p + 1) === 32) { p += 2; continue; } // "- " of a block sequence item
    break;
  }
  return p;
}

/* js-yaml opens an extra node around some values (the document root, block sequence items):
   a frame with one kid that starts at the same place is a wrapper. */
var unwrapText = '';
function unwrap(f) {
  while (f && f.c && f.c.length === 1 && (f.k === '' || f.k === f.c[0].k) &&
         skipSpace(unwrapText, f.p) === skipSpace(unwrapText, f.c[0].p)) f = f.c[0];
  return f;
}

function findKey(frame, key, depth) {
  if (!frame || frame.k !== 'm' || !frame.c || depth > 8) return null;
  var kids = frame.c, found = null, merges = [];
  for (var i = 0; i + 1 < kids.length; i += 2) {
    var k = unwrap(kids[i]);
    if (k && k.v === key) found = { key: k, value: kids[i + 1] };
    else if (k && k.v === '<<') merges.push(kids[i + 1]);
  }
  if (found) return found;
  for (var j = 0; j < merges.length; j++) {
    var mv = unwrap(merges[j]);
    var list = mv && mv.k === 's' ? (mv.c || []) : [mv];
    for (var n = 0; n < list.length; n++) {
      var hit = findKey(unwrap(list[n]), key, depth + 1);
      if (hit) return { key: kids[0] && hit.key, value: hit.value, viaMerge: merges[j] };
    }
  }
  return null;
}

/* Offset of the node at `segments`: the key of a mapping entry, the start of a sequence item.
   When the pointer leaves the tree (an alias, a merged value), the deepest node found is used. */
export function locate(parsed, segments) {
  unwrapText = parsed.text;
  var f = unwrap(parsed.root);
  var pos = 0;
  for (var i = 0; f && i < segments.length; i++) {
    var seg = String(segments[i]);
    if (f.k === 'm') {
      var hit = findKey(f, seg, 0);
      if (!hit) break;
      pos = hit.viaMerge ? skipSpace(parsed.text, hit.viaMerge.p) : skipSpace(parsed.text, hit.key.p);
      if (hit.viaMerge) break;
      f = unwrap(hit.value);
    } else if (f.k === 's') {
      var idx = Number(seg);
      if (!f.c || !(idx >= 0 && idx < f.c.length)) break;
      f = f.c[idx];
      pos = skipSpace(parsed.text, f.p);
      f = unwrap(f);
    } else break;
  }
  return pos;
}

export function lineCol(parsed, offset) {
  if (!parsed.lineStarts) {
    var ls = [0], t = parsed.text;
    for (var i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) ls.push(i + 1);
    parsed.lineStarts = ls;
  }
  var a = parsed.lineStarts, lo = 0, hi = a.length - 1;
  while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (a[mid] <= offset) lo = mid; else hi = mid - 1; }
  return { line: lo + 1, col: offset - a[lo] + 1 };
}

/* ───────────────────────── JSON Pointer and references ───────────────────────── */

export function pointerOf(segments) {
  return '#' + segments.map(function (s) { return '/' + String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }).join('');
}
function segmentsOf(fragment) {
  if (fragment === '' || fragment === '/') return fragment === '/' ? [''] : [];
  return fragment.slice(1).split('/').map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
}
function getAt(node, segs) {
  for (var i = 0; i < segs.length; i++) {
    if (node === null || typeof node !== 'object' || !hasOwn(node, segs[i])) return undefined;
    node = node[segs[i]];
  }
  return node;
}

function dirOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }
function normalizePath(path) {
  var out = [];
  path.split('/').forEach(function (s) {
    if (s === '' || s === '.') return;
    if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else out.push('..'); return; }
    out.push(s);
  });
  return out.join('/');
}
function baseName(path) { return path.slice(path.lastIndexOf('/') + 1); }

/* Splits a $ref and finds its target among the parsed files.
   kind: 'local' | 'file' | 'url' | 'missing-file' | 'anchor' | 'bad'. */
function resolveRef(project, fromFile, ref) {
  var hash = ref.indexOf('#');
  var path = hash < 0 ? ref : ref.slice(0, hash);
  var frag = hash < 0 ? '' : ref.slice(hash + 1);
  var decoded;
  try { decoded = decodeURIComponent(frag); } catch (_e) { return { kind: 'bad', ref: ref }; }
  if (decoded !== '' && decoded.charAt(0) !== '/') return { kind: 'anchor', ref: ref };
  var file = fromFile;
  if (path !== '') {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return { kind: 'url', ref: ref };
    var target = normalizePath(dirOf(fromFile) + path.split('?')[0]);
    if (!project.parsed[target]) {
      var byBase = project.names.filter(function (n) { return baseName(n) === baseName(target); });
      if (byBase.length !== 1) return { kind: 'missing-file', ref: ref, file: target };
      target = byBase[0];
    }
    file = target;
  }
  var p = project.parsed[file];
  if (!p || p.error) return { kind: 'unparsed', ref: ref, file: file };
  var segs = segmentsOf(decoded);
  var node = getAt(p.doc, segs);
  return { kind: file === fromFile ? 'local' : 'file', ref: ref, file: file, segs: segs, node: node, exists: node !== undefined };
}

/* Keys whose values are example data, not part of the description. */
var DATA_KEYS = { example: 1, default: 1, enum: 1, const: 1 };
/* `default` under `responses` is the default Response Object, not data. References inside
   specification extensions (x-webhooks in OpenAPI 3.0 descriptions, for example) are followed,
   as Redocly and Spectral do. */
function isData(k, parentKey) { return DATA_KEYS[k] === 1 && !(k === 'default' && parentKey === 'responses'); }
function eachRef(doc, cb, includeData) {
  function walk(node, segs) {
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walk(node[i], segs.concat(i)); return; }
    if (!isObj(node)) return;
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (k === '$ref' && typeof v === 'string') { cb(v, segs.concat('$ref'), node); return; }
      if (!includeData && isData(k, segs[segs.length - 1])) return;
      if (k === 'examples' && isObj(v) && !includeData) {
        Object.keys(v).forEach(function (name) {
          var ex = v[name];
          if (!isObj(ex)) return;
          Object.keys(ex).forEach(function (ek) {
            if (ek === 'value' || ek === 'dataValue') return;
            walk(ex[ek], segs.concat(k, name, ek));
          });
          if (typeof ex.$ref === 'string') cb(ex.$ref, segs.concat(k, name, '$ref'), ex);
        });
        return;
      }
      walk(v, segs.concat(k));
    });
  }
  walk(doc, []);
}

/* ───────────────────────── schema validators ───────────────────────── */

/* draft-04 → draft-07: `id` becomes `$id`, boolean exclusiveMinimum / exclusiveMaximum become
   the numeric form. Keys under properties / patternProperties / definitions are names. */
export function fromDraft04(schema) {
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (k === 'properties' || k === 'patternProperties' || k === 'definitions') {
        var map = {};
        Object.keys(v).forEach(function (name) { map[name] = walk(v[name]); });
        out[k] = map;
      } else if (k === 'id' && typeof v === 'string') {
        out.$id = v;
      } else if (k === '$schema') {
        out.$schema = 'http://json-schema.org/draft-07/schema#';
      } else if ((k === 'exclusiveMinimum' || k === 'exclusiveMaximum') && typeof v === 'boolean') {
        // handled with minimum / maximum below
      } else {
        out[k] = walk(v);
      }
    });
    if (node.exclusiveMinimum === true && typeof node.minimum === 'number') { out.exclusiveMinimum = node.minimum; delete out.minimum; }
    if (node.exclusiveMaximum === true && typeof node.maximum === 'number') { out.exclusiveMaximum = node.maximum; delete out.maximum; }
    return out;
  }
  return walk(schema);
}

/* The 3.1 / 3.2 schemas point Schema Objects at `{ "$dynamicRef": "#meta" }`, whose anchor is
   $defs/schema. Ajv does not resolve this $dynamicRef correctly (it validated Schema Objects
   against the root), so it is replaced with the equivalent static $ref. */
export function staticDynamicRefs(schema) {
  var anchorPath = null;
  Object.keys(schema.$defs || {}).forEach(function (k) {
    if (schema.$defs[k] && schema.$defs[k].$dynamicAnchor === 'meta') anchorPath = '#/$defs/' + k;
  });
  function walk(node) {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (k) {
      if (k === '$dynamicRef' && node[k] === '#meta' && anchorPath) out.$ref = anchorPath;
      else if (k === '$dynamicAnchor') return;
      else out[k] = walk(node[k]);
    });
    return out;
  }
  return walk(schema);
}

/* OpenAPI format registry values (spec.openapis.org/registry/format): int32 / int64 ranges,
   float / double numbers, byte = base64. Other formats are annotations. */
var INT32 = [-2147483648, 2147483647];
function addOasFormats(ajv) {
  ajv.addFormat('int32', { type: 'number', validate: function (n) { return Number.isInteger(n) && n >= INT32[0] && n <= INT32[1]; } });
  ajv.addFormat('int64', { type: 'number', validate: function (n) { return Number.isInteger(n); } });
  ajv.addFormat('float', { type: 'number', validate: function () { return true; } });
  ajv.addFormat('double', { type: 'number', validate: function () { return true; } });
  ajv.addFormat('byte', /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  ['binary', 'password', 'media-range', 'char', 'commonmark', 'html', 'sf-string', 'sf-token', 'sf-binary', 'sf-boolean', 'sf-integer', 'sf-decimal', 'decimal', 'decimal128', 'int8', 'int16', 'uint8', 'uint16', 'uint32', 'uint64', 'double-int', 'http-date'].forEach(function (f) {
    if (!ajv.formats[f]) ajv.addFormat(f, true);
  });
}

/* Returns getDocValidator(version): the compiled validator for the description itself. */
export function createValidators(lib) {
  var cache = {};
  function prepare(ajv) {
    lib.addFormats(ajv);
    ajv.addFormat('media-range', true);
    return ajv;
  }
  return function (version) {
    if (cache[version]) return cache[version];
    var s = lib.schemas;
    var v;
    if (version === '2.0') {
      var ajv2 = prepare(new lib.Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false }));
      ajv2.addSchema(fromDraft04(s['draft-04']), 'http://json-schema.org/draft-04/schema');
      v = ajv2.compile(fromDraft04(s['2.0']));
    } else if (version === '3.0') {
      v = prepare(new lib.Ajv({ allErrors: true, strict: false, logger: false })).compile(fromDraft04(s['3.0']));
    } else if (s[version]) {
      v = prepare(new lib.Ajv2020({ allErrors: true, strict: false, logger: false })).compile(staticDynamicRefs(s[version]));
    } else return null;
    cache[version] = v;
    return v;
  };
}

/* Ajv reports every failed branch of a oneOf / anyOf. Keep the errors that explain the problem:
   drop the oneOf / anyOf summary and the "must have $ref" branch (Reference Object) when another
   error exists at the same place or deeper, and drop exact duplicates. */
function isSummaryErr(e) { return e.keyword === 'oneOf' || e.keyword === 'anyOf' || e.keyword === 'if'; }
function isRefBranch(e) { return e.keyword === 'required' && e.params && e.params.missingProperty === '$ref'; }
export function simplifyErrors(errors) {
  function deeperOrSame(a, b) { return a === b || a.indexOf(b + '/') === 0 || b === ''; }
  var choiceAt = {};
  errors.forEach(function (e) { if (e.keyword === 'oneOf' || e.keyword === 'anyOf') choiceAt[e.instancePath] = 1; });
  var kept = errors.filter(function (e) {
    if (!isSummaryErr(e) && !isRefBranch(e)) return true;
    return !errors.some(function (o) {
      return o !== e && !isSummaryErr(o) && !isRefBranch(o) && deeperOrSame(o.instancePath, e.instancePath);
    });
  });
  var seen = {};
  kept = kept.filter(function (e) {
    var key = e.instancePath + '|' + e.keyword + '|' + JSON.stringify(e.params);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  // A `not` failure next to a clearer error at the same place adds nothing.
  var otherAt = {};
  kept.forEach(function (e) { if (e.keyword !== 'not') otherAt[e.instancePath] = 1; });
  kept = kept.filter(function (e) { return e.keyword !== 'not' || !otherAt[e.instancePath]; });
  // Alternatives that each require a field (Parameter: schema or content) become one error.
  var req = {};
  kept.forEach(function (e) {
    if (e.keyword === 'required' && choiceAt[e.instancePath]) (req[e.instancePath] = req[e.instancePath] || []).push(e);
  });
  return kept.filter(function (e) {
    var group = req[e.instancePath];
    if (!group || group.length < 2 || e.keyword !== 'required') return true;
    if (group[0] !== e) return false;
    e.keyword = 'requiredOneOf';
    e.params = { names: group.map(function (g) { return g.params.missingProperty; }) };
    return true;
  });
}

/* A keyword that may be one of several forms (the meta-schema's `type`: a type name or a list)
   fails both branches. Keep the enum error, which lists the allowed values. */
function dropTypeBesideEnum(errors) {
  var enumAt = {};
  errors.forEach(function (e) { if (e.keyword === 'enum') enumAt[e.instancePath] = 1; });
  return errors.filter(function (e) { return !(e.keyword === 'type' && enumAt[e.instancePath]); });
}

/* Ajv error → { code, args, at } where `at` is a JSON Pointer suffix (instancePath). */
function describe(e, instance) {
  var p = e.params || {};
  if (e.keyword === 'additionalProperties' && e.instancePath === '/paths') return { code: 'schema.pathSlash', args: { name: p.additionalProperty } };
  if (e.keyword === 'unevaluatedProperties' && e.instancePath === '/paths') return { code: 'schema.pathSlash', args: { name: p.unevaluatedProperty } };
  if (e.keyword === 'required') return { code: 'schema.required', args: { name: p.missingProperty } };
  if (e.keyword === 'requiredOneOf') return { code: 'schema.requiredOneOf', args: { names: p.names.map(function (n) { return '"' + n + '"'; }).join(', ') } };
  if (e.keyword === 'additionalProperties') return { code: 'schema.unknown', args: { name: p.additionalProperty } };
  if (e.keyword === 'unevaluatedProperties') return { code: 'schema.unknown', args: { name: p.unevaluatedProperty } };
  if (e.keyword === 'propertyNames') return { code: 'schema.propertyName', args: { name: p.propertyName || '' } };
  var field = e.instancePath.slice(e.instancePath.lastIndexOf('/') + 1).replace(/~1/g, '/').replace(/~0/g, '~');
  if (/^\d+$/.test(field)) field = '';
  if (e.keyword === 'type') {
    var t = Array.isArray(p.type) ? p.type.join(' | ') : String(p.type);
    return field ? { code: 'schema.fieldType', args: { field: field, type: t } } : { code: 'schema.type', args: { type: t } };
  }
  if (e.keyword === 'enum') {
    var vals = p.allowedValues.map(function (v) { return JSON.stringify(v); }).join(', ');
    return field ? { code: 'schema.fieldEnum', args: { field: field, values: vals } } : { code: 'schema.enum', args: { values: vals } };
  }
  if (e.keyword === 'const') return { code: 'schema.const', args: { value: JSON.stringify(p.allowedValue) } };
  if (e.keyword === 'pattern') return { code: 'schema.pattern', args: { pattern: p.pattern } };
  if (e.keyword === 'format') return { code: 'schema.format', args: { format: p.format } };
  if (e.keyword === 'oneOf' || e.keyword === 'anyOf') return { code: 'schema.oneOf', args: {} };
  if (e.keyword === 'not' && isObj(instance) && hasOwn(instance, 'example') && hasOwn(instance, 'examples')) return { code: 'schema.exampleBoth', args: {} };
  if (e.keyword === 'minItems' || e.keyword === 'maxItems' || e.keyword === 'minLength' || e.keyword === 'maxLength' ||
      e.keyword === 'minimum' || e.keyword === 'maximum' || e.keyword === 'exclusiveMinimum' || e.keyword === 'exclusiveMaximum' ||
      e.keyword === 'minProperties' || e.keyword === 'maxProperties' || e.keyword === 'multipleOf') {
    return { code: 'schema.limit', args: { keyword: e.keyword, limit: String(p.limit !== undefined ? p.limit : p.multipleOf) } };
  }
  if (e.keyword === 'uniqueItems') return { code: 'schema.unique', args: { i: String(p.i), j: String(p.j) } };
  if (e.keyword === 'dependencies' || e.keyword === 'dependentRequired') return { code: 'schema.required', args: { name: p.missingProperty } };
  if (e.keyword === 'false schema') return { code: 'schema.false', args: {} };
  return { code: 'schema.other', args: { keyword: e.keyword, text: e.message || '' } };
}

/* ───────────────────────── the checks ───────────────────────── */

var METHODS = {
  '2.0': ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'],
  '3.0': ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'],
  '3.1': ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'],
  '3.2': ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'],
};

var COMPONENT_KINDS = {
  '2.0': [['definitions'], ['parameters'], ['responses'], ['securityDefinitions']],
  '3.0': ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks'],
  '3.1': ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks', 'pathItems'],
  '3.2': ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks', 'pathItems', 'mediaTypes'],
};
function componentMaps(doc, version) {
  var out = [];
  if (version === '2.0') {
    COMPONENT_KINDS['2.0'].forEach(function (segs) { if (isObj(doc[segs[0]])) out.push({ segs: segs, map: doc[segs[0]] }); });
  } else if (isObj(doc.components)) {
    COMPONENT_KINDS[version].forEach(function (k) { if (isObj(doc.components[k])) out.push({ segs: ['components', k], map: doc.components[k] }); });
  }
  return out;
}

function versionOf(doc) {
  if (doc.swagger !== undefined && doc.openapi === undefined) return doc.swagger === '2.0' ? '2.0' : null;
  var v = doc.openapi;
  if (typeof v !== 'string') return null;
  var m = /^(3\.[0-2])\.\d+(-.+)?$/.exec(v);
  return m ? m[1] : null;
}

/* Walks the description along its structure. Internal references are followed and every
   object is visited once (at its definition), so a component used ten times is checked once. */
function Walker(doc, version) {
  this.doc = doc;
  this.version = version;
  this.seen = new Set();
}
Walker.prototype.deref = function (node, segs) {
  for (var i = 0; i < 30 && isObj(node) && typeof node.$ref === 'string'; i++) {
    var ref = node.$ref;
    if (ref.charAt(0) !== '#') return null;
    var frag;
    try { frag = decodeURIComponent(ref.slice(1)); } catch (_e) { return null; }
    if (frag !== '' && frag.charAt(0) !== '/') return null;
    segs = segmentsOf(frag);
    node = getAt(this.doc, segs);
  }
  return node === undefined ? null : { node: node, segs: segs };
};
Walker.prototype.once = function (node) {
  if (!isObj(node) && !Array.isArray(node)) return false;
  if (this.seen.has(node)) return false;
  this.seen.add(node);
  return true;
};

/* Collects the objects the checks need: path items (with their key when under `paths`),
   operations, parameters, headers, media types, schema slots and security requirements. */
function collect(doc, version) {
  var W = new Walker(doc, version);
  var out = { pathItems: [], operations: [], parameterLists: [], parameters: [], headers: [], mediaTypes: [], schemaSlots: [], requirements: [], responses: [], servers: [] };
  var oas3 = version !== '2.0';

  function schemaSlot(node, segs, context) {
    if (node === undefined) return;
    if (W.once(node) || typeof node === 'boolean') out.schemaSlots.push({ node: node, segs: segs, context: context });
  }
  /* Examples of media types that are not JSON are written as a string in their serialized form
     (OAS 3.x Example Object: "use a string value"), so a string is not compared with the schema. */
  function serialized(mediaKey, value) {
    return typeof value === 'string' && typeof mediaKey === 'string' && !/(^|[/+])json\b|^\*\/\*$/i.test(mediaKey);
  }
  function examplesOf(obj, segs, schemaSegs, context, kind, mediaKey) {
    // value(s) to check against schemaSegs
    if (!schemaSegs) return;
    if (hasOwn(obj, 'example') && !serialized(mediaKey, obj.example)) out.mediaTypes.push({ value: obj.example, segs: segs.concat('example'), schemaSegs: schemaSegs, context: context, kind: kind });
    if (isObj(obj.examples)) {
      Object.keys(obj.examples).forEach(function (name) {
        var ex = W.deref(obj.examples[name], segs.concat('examples', name));
        if (!ex || !isObj(ex.node)) return;
        var key = hasOwn(ex.node, 'dataValue') ? 'dataValue' : hasOwn(ex.node, 'value') ? 'value' : null;
        if (key === 'value' && serialized(mediaKey, ex.node.value)) return;
        if (key) out.mediaTypes.push({ value: ex.node[key], segs: ex.segs.concat(key), schemaSegs: schemaSegs, context: context, kind: kind, shared: ex.segs[0] === 'components' });
      });
    }
  }
  function schemaTarget(schema, segs) {
    // Example checks validate against the schema location; a $ref schema is validated through it.
    return schema === undefined ? null : segs;
  }
  function mediaType(mt, segs, context, mediaKey) {
    var r = W.deref(mt, segs);
    if (!r || !isObj(r.node)) return;
    mt = r.node; segs = r.segs;
    if (!W.once(mt)) return;
    if (hasOwn(mt, 'schema')) schemaSlot(mt.schema, segs.concat('schema'), context);
    examplesOf(mt, segs, schemaTarget(mt.schema, segs.concat('schema')), context, 'media', mediaKey);
    if (isObj(mt.encoding)) Object.keys(mt.encoding).forEach(function (n) {
      var enc = mt.encoding[n];
      if (isObj(enc) && isObj(enc.headers)) Object.keys(enc.headers).forEach(function (h) { header(enc.headers[h], segs.concat('encoding', n, 'headers', h)); });
    });
  }
  function content(map, segs, context) {
    if (!isObj(map)) return;
    Object.keys(map).forEach(function (m) { mediaType(map[m], segs.concat(m), context, m); });
  }
  function header(h, segs) {
    var r = W.deref(h, segs);
    if (!r || !isObj(r.node) || !W.once(r.node)) return;
    h = r.node; segs = r.segs;
    out.headers.push({ node: h, segs: segs });
    if (hasOwn(h, 'schema')) schemaSlot(h.schema, segs.concat('schema'), 'response');
    examplesOf(h, segs, schemaTarget(h.schema, segs.concat('schema')), 'response', 'header');
    content(h.content, segs.concat('content'), 'response');
  }
  function parameter(p, segs) {
    var r = W.deref(p, segs);
    if (!r || !isObj(r.node)) return r ? r : null;
    if (W.once(r.node)) {
      var node = r.node;
      out.parameters.push({ node: node, segs: r.segs });
      if (hasOwn(node, 'schema')) schemaSlot(node.schema, r.segs.concat('schema'), 'request');
      if (oas3) {
        examplesOf(node, r.segs, schemaTarget(node.schema, r.segs.concat('schema')), 'request', 'parameter');
        content(node.content, r.segs.concat('content'), 'request');
      }
    }
    return r;
  }
  function parameterList(list, segs) {
    if (!Array.isArray(list)) return [];
    var resolved = list.map(function (p, i) { return { r: parameter(p, segs.concat(i)), index: i, raw: p }; });
    out.parameterLists.push({ segs: segs, items: resolved });
    return resolved;
  }
  function response(resp, segs) {
    var r = W.deref(resp, segs);
    if (!r || !isObj(r.node) || !W.once(r.node)) return;
    resp = r.node; segs = r.segs;
    out.responses.push({ node: resp, segs: segs });
    if (isObj(resp.headers)) Object.keys(resp.headers).forEach(function (h) { header(resp.headers[h], segs.concat('headers', h)); });
    if (oas3) content(resp.content, segs.concat('content'), 'response');
    else {
      if (hasOwn(resp, 'schema')) schemaSlot(resp.schema, segs.concat('schema'), 'response');
      if (isObj(resp.examples) && hasOwn(resp, 'schema')) {
        Object.keys(resp.examples).forEach(function (mime) {
          if (/\bjson\b/i.test(mime)) out.mediaTypes.push({ value: resp.examples[mime], segs: segs.concat('examples', mime), schemaSegs: segs.concat('schema'), context: 'response', kind: 'media' });
        });
      }
    }
  }
  function requestBody(rb, segs) {
    var r = W.deref(rb, segs);
    if (!r || !isObj(r.node) || !W.once(r.node)) return;
    content(r.node.content, r.segs.concat('content'), 'request');
  }
  function servers(list, segs) {
    if (Array.isArray(list)) list.forEach(function (s, i) { if (isObj(s)) out.servers.push({ node: s, segs: segs.concat(i) }); });
  }
  function pathItem(item, segs, templ) {
    var r = W.deref(item, segs);
    if (!r || !isObj(r.node)) return;
    var first = W.once(r.node);
    item = r.node; var isegs = r.segs;
    var entry = { node: item, segs: isegs, keySegs: segs, template: templ, ops: [] };
    out.pathItems.push(entry);
    var shared = first ? parameterList(item.parameters, isegs.concat('parameters')) : null;
    if (first && oas3) servers(item.servers, isegs.concat('servers'));
    var ms = METHODS[version] || METHODS['3.0'];
    var ops = [];
    ms.forEach(function (m) { if (isObj(item[m])) ops.push({ method: m, op: item[m], segs: isegs.concat(m) }); });
    if (version === '3.2' && isObj(item.additionalOperations)) {
      Object.keys(item.additionalOperations).forEach(function (m) {
        if (isObj(item.additionalOperations[m])) ops.push({ method: m, op: item.additionalOperations[m], segs: isegs.concat('additionalOperations', m) });
      });
    }
    entry.ops = ops;
    if (!first) return;
    entry.shared = shared;
    ops.forEach(function (o) {
      o.params = parameterList(o.op.parameters, o.segs.concat('parameters'));
      out.operations.push(o);
      if (Array.isArray(o.op.security)) out.requirements.push({ list: o.op.security, segs: o.segs.concat('security') });
      if (oas3) {
        servers(o.op.servers, o.segs.concat('servers'));
        if (hasOwn(o.op, 'requestBody')) requestBody(o.op.requestBody, o.segs.concat('requestBody'));
        if (isObj(o.op.callbacks)) Object.keys(o.op.callbacks).forEach(function (cb) { callback(o.op.callbacks[cb], o.segs.concat('callbacks', cb)); });
      }
      if (isObj(o.op.responses)) Object.keys(o.op.responses).forEach(function (code) { response(o.op.responses[code], o.segs.concat('responses', code)); });
    });
  }
  function callback(cb, segs) {
    var r = W.deref(cb, segs);
    if (!r || !isObj(r.node) || !W.once(r.node)) return;
    Object.keys(r.node).forEach(function (expr) { if (!/^x-/.test(expr)) pathItem(r.node[expr], r.segs.concat(expr), null); });
  }

  if (oas3) servers(doc.servers, ['servers']);
  if (Array.isArray(doc.security)) out.requirements.push({ list: doc.security, segs: ['security'] });
  if (isObj(doc.paths)) Object.keys(doc.paths).forEach(function (p) { if (!/^x-/.test(p)) pathItem(doc.paths[p], ['paths', p], p); });
  if (isObj(doc.webhooks)) Object.keys(doc.webhooks).forEach(function (w) { pathItem(doc.webhooks[w], ['webhooks', w], null); });
  if (version === '2.0') {
    if (isObj(doc.definitions)) Object.keys(doc.definitions).forEach(function (n) { schemaSlot(doc.definitions[n], ['definitions', n], null); });
    if (isObj(doc.parameters)) Object.keys(doc.parameters).forEach(function (n) { parameter(doc.parameters[n], ['parameters', n]); });
    if (isObj(doc.responses)) Object.keys(doc.responses).forEach(function (n) { response(doc.responses[n], ['responses', n]); });
  } else if (isObj(doc.components)) {
    var c = doc.components;
    if (isObj(c.schemas)) Object.keys(c.schemas).forEach(function (n) { schemaSlot(c.schemas[n], ['components', 'schemas', n], null); });
    if (isObj(c.parameters)) Object.keys(c.parameters).forEach(function (n) { parameter(c.parameters[n], ['components', 'parameters', n]); });
    if (isObj(c.headers)) Object.keys(c.headers).forEach(function (n) { header(c.headers[n], ['components', 'headers', n]); });
    if (isObj(c.responses)) Object.keys(c.responses).forEach(function (n) { response(c.responses[n], ['components', 'responses', n]); });
    if (isObj(c.requestBodies)) Object.keys(c.requestBodies).forEach(function (n) { requestBody(c.requestBodies[n], ['components', 'requestBodies', n]); });
    if (isObj(c.mediaTypes)) Object.keys(c.mediaTypes).forEach(function (n) { mediaType(c.mediaTypes[n], ['components', 'mediaTypes', n], null); });
    if (isObj(c.callbacks)) Object.keys(c.callbacks).forEach(function (n) { callback(c.callbacks[n], ['components', 'callbacks', n]); });
    if (isObj(c.pathItems)) Object.keys(c.pathItems).forEach(function (n) { pathItem(c.pathItems[n], ['components', 'pathItems', n], null); });
  }
  out.walker = W;
  return out;
}

function templateNames(p) {
  var names = [], re = /\{([^{}]+)\}/g, m;
  while ((m = re.exec(p))) if (names.indexOf(m[1]) < 0) names.push(m[1]);
  return names;
}

function semanticChecks(doc, version, C, add) {
  var oas3 = version !== '2.0';

  // Path Templating: every {name} needs an `in: path` parameter on the Path Item or the
  // operation, and every `in: path` parameter must appear in the path.
  C.pathItems.forEach(function (pi) {
    if (pi.template === null || !pi.shared) return;
    var names = templateNames(pi.template);
    function declared(list, outMap) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i].r;
        if (!r) return false; // external or broken reference: cannot tell
        var prm = r.node;
        if (isObj(prm) && prm.in === 'path' && typeof prm.name === 'string') outMap[prm.name] = true;
      }
      return true;
    }
    var shared = {};
    if (!declared(pi.shared, shared)) return;
    pi.ops.forEach(function (o) {
      var have = Object.assign({}, shared);
      if (!declared(o.params || [], have)) return;
      var label = o.method.toUpperCase() + ' ' + pi.template;
      names.forEach(function (n) { if (!have[n]) add('error', 'path.undeclared', o.segs, { op: label, name: n }); });
      Object.keys(have).forEach(function (n) { if (names.indexOf(n) < 0) add('error', 'path.extra', o.segs, { op: label, name: n }); });
    });
  });

  // Equivalent templates and query strings in path keys
  if (isObj(doc.paths)) {
    var byShape = {};
    Object.keys(doc.paths).forEach(function (p) {
      if (/^x-/.test(p)) return;
      if (p.indexOf('?') >= 0) add('warning', 'path.query', ['paths', p], { path: p });
      var shape = p.replace(/\{[^{}]*\}/g, '{}');
      if (shape === p) return;
      if (byShape[shape]) add('error', 'path.equivalent', ['paths', p], { path: p, other: byShape[shape] });
      else byShape[shape] = p;
    });
  }

  // Duplicate parameters (name + in) in one list
  C.parameterLists.forEach(function (pl) {
    var seen = {};
    pl.items.forEach(function (it) {
      if (!it.r || !isObj(it.r.node)) return;
      var prm = it.r.node;
      if (typeof prm.name !== 'string' || typeof prm.in !== 'string') return;
      var key = prm.in + '\u0000' + prm.name;
      if (seen[key] !== undefined) add('error', 'param.duplicate', pl.segs.concat(it.index), { name: prm.name, in: prm.in, other: String(seen[key] + 1) });
      else seen[key] = it.index;
    });
  });

  // operationId is unique across the description
  var ids = {};
  C.operations.forEach(function (o) {
    var id = o.op.operationId;
    if (typeof id !== 'string') return;
    var at = o.segs.concat('operationId');
    if (ids[id]) add('error', 'opid.duplicate', at, { id: id, at: ids[id] });
    else ids[id] = pointerOf(at);
  });

  // Tag names are unique
  if (Array.isArray(doc.tags)) {
    var tags = {};
    doc.tags.forEach(function (t, i) {
      if (!isObj(t) || typeof t.name !== 'string') return;
      if (tags[t.name] !== undefined) add('error', 'tag.duplicate', ['tags', i, 'name'], { name: t.name, other: String(tags[t.name] + 1) });
      else tags[t.name] = i;
    });
  }

  // Security requirements name declared security schemes
  var schemes = version === '2.0' ? doc.securityDefinitions : (isObj(doc.components) ? doc.components.securitySchemes : undefined);
  C.requirements.forEach(function (rq) {
    rq.list.forEach(function (req, i) {
      if (!isObj(req)) return;
      Object.keys(req).forEach(function (name) {
        if (isObj(schemes) && hasOwn(schemes, name)) return;
        if (version === '3.2' && /[#/:]/.test(name)) return; // 3.2 allows a URI reference to a scheme
        add('error', 'security.undefined', rq.segs.concat(i, name), { name: name, container: version === '2.0' ? 'securityDefinitions' : 'components.securitySchemes' });
      });
    });
  });

  // Server URL variables
  if (oas3) {
    C.servers.forEach(function (s) {
      var url = s.node.url;
      if (typeof url !== 'string') return;
      var used = [], re = /\{([^{}]+)\}/g, m, counts = {};
      while ((m = re.exec(url))) { counts[m[1]] = (counts[m[1]] || 0) + 1; if (used.indexOf(m[1]) < 0) used.push(m[1]); }
      var vars = isObj(s.node.variables) ? s.node.variables : {};
      used.forEach(function (n) {
        if (!hasOwn(vars, n)) add('warning', 'server.varUndefined', s.segs.concat('url'), { name: n, url: url });
        if (version === '3.2' && counts[n] > 1) add('error', 'server.varRepeated', s.segs.concat('url'), { name: n });
      });
      Object.keys(vars).forEach(function (n) {
        if (/^x-/.test(n)) return;
        if (used.indexOf(n) < 0) add('warning', 'server.varUnused', s.segs.concat('variables', n), { name: n });
        var v = vars[n];
        if (!isObj(v) || !Array.isArray(v.enum)) return;
        if (v.enum.length === 0) { if (version === '3.0') add('warning', 'server.enumEmpty', s.segs.concat('variables', n, 'enum'), { name: n }); return; }
        if (typeof v.default === 'string' && v.enum.indexOf(v.default) < 0) {
          add(version === '3.0' ? 'warning' : 'error', 'server.defaultNotInEnum', s.segs.concat('variables', n, 'default'), { name: n, value: v.default });
        }
      });
    });
  }
}

/* Walks a Schema Object tree (no $ref following). cb(node, segs) for every subschema. */
var SUB_MAPS = ['properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas'];
var SUB_ONE = ['items', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'additionalItems', 'contentSchema'];
var SUB_LIST = ['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items'];
function eachSubschema(schema, segs, cb, seen) {
  if (!isObj(schema) || seen.has(schema)) return;
  seen.add(schema);
  cb(schema, segs);
  SUB_MAPS.forEach(function (k) {
    if (isObj(schema[k])) Object.keys(schema[k]).forEach(function (n) { eachSubschema(schema[k][n], segs.concat(k, n), cb, seen); });
  });
  SUB_ONE.forEach(function (k) { if (isObj(schema[k])) eachSubschema(schema[k], segs.concat(k), cb, seen); });
  SUB_LIST.forEach(function (k) {
    if (Array.isArray(schema[k])) schema[k].forEach(function (s, i) { eachSubschema(s, segs.concat(k, i), cb, seen); });
  });
}

/* OpenAPI 3.0 / Swagger 2.0 Schema Object → JSON Schema draft-07 for checking examples:
   nullable adds "null" to an explicit type (OAS 3.0.4 §4.7.24.1), boolean exclusiveMinimum /
   exclusiveMaximum become numeric. Structure and key paths are kept so pointers still match. */
var NAME_MAPS = SUB_MAPS.concat(['schemas']);
function toJsonSchema07(doc) {
  function walk(node, inSchemaMap, parentKey) {
    if (Array.isArray(node)) return node.map(function (v) { return walk(v, false); });
    if (!isObj(node)) return node;
    var out = {};
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      if (isData(k, parentKey) && !inSchemaMap) { out[k] = v; return; }
      if (k === 'examples' && !inSchemaMap && isObj(v)) { out[k] = v; return; }
      if (!inSchemaMap && (k === 'exclusiveMinimum' || k === 'exclusiveMaximum') && typeof v === 'boolean') return;
      if (!inSchemaMap && k === 'nullable') return;
      out[k] = inSchemaMap ? walk(v, false, k) : walk(v, NAME_MAPS.indexOf(k) >= 0, k);
    });
    if (inSchemaMap) return out;
    if (node.exclusiveMinimum === true && typeof node.minimum === 'number') { out.exclusiveMinimum = node.minimum; delete out.minimum; }
    if (node.exclusiveMaximum === true && typeof node.maximum === 'number') { out.exclusiveMaximum = node.maximum; delete out.maximum; }
    if (node.nullable === true && typeof node.type === 'string') {
      out.type = [node.type, 'null'];
      if (Array.isArray(node.enum) && node.enum.indexOf(null) < 0) out.enum = node.enum.concat([null]);
    }
    return out;
  }
  return walk(doc, false);
}

function fragmentOf(segs) {
  return '#' + segs.map(function (s) { return '/' + encodeURIComponent(String(s).replace(/~/g, '~0').replace(/\//g, '~1')); }).join('');
}

/* Examples (SHOULD match the schema: OAS 3.x Parameter / Header / Media Type Objects, Swagger 2.0
   Schema `example` and response `examples`). readOnly properties are not required in requests,
   writeOnly ones not in responses. Returns false when the time budget ran out. */
function exampleChecks(doc, version, C, lib, add, budgetMs) {
  var oas3x = version === '3.1' || version === '3.2';
  var ajv = oas3x
    ? new lib.Ajv2020({ allErrors: true, strict: false, validateSchema: false, logger: false, verbose: true, messages: false, code: { optimize: false } })
    : new lib.Ajv({ allErrors: true, strict: false, validateSchema: false, logger: false, verbose: true, messages: false, code: { optimize: false } });
  lib.addFormats(ajv);
  addOasFormats(ajv);
  var docSchema = oas3x ? doc : toJsonSchema07(doc);
  try { ajv.addSchema(docSchema, 'urn:oav:doc'); } catch (_e) { return true; }
  var compiled = {};
  function validatorFor(schemaSegs) {
    var key = pointerOf(schemaSegs);
    if (compiled[key] !== undefined) return compiled[key];
    var v;
    try { v = ajv.compile({ $ref: 'urn:oav:doc' + fragmentOf(schemaSegs) }); } catch (e) { v = { failed: String((e && e.message) || e) }; }
    compiled[key] = v;
    return v;
  }
  function propSchema(parent, name) {
    if (!isObj(parent) || !isObj(parent.properties)) return null;
    var s = parent.properties[name];
    for (var i = 0; i < 10 && isObj(s) && typeof s.$ref === 'string' && s.$ref.charAt(0) === '#'; i++) {
      var f;
      try { f = decodeURIComponent(s.$ref.slice(1)); } catch (_e) { return null; }
      s = getAt(docSchema, segmentsOf(f));
    }
    return isObj(s) ? s : null;
  }
  var start = Date.now();
  var items = C.mediaTypes.slice();
  // Schema `example` (3.0, 2.0, and still allowed in 3.1+) and `examples` arrays (3.1+)
  var seen = new Set();
  C.schemaSlots.forEach(function (slot) {
    eachSubschema(slot.node, slot.segs, function (s, segs) {
      if (hasOwn(s, 'example')) items.push({ value: s.example, segs: segs.concat('example'), schemaSegs: segs, context: slot.context, kind: 'schema' });
      if (oas3x && Array.isArray(s.examples)) s.examples.forEach(function (v, i) { items.push({ value: v, segs: segs.concat('examples', i), schemaSegs: segs, context: slot.context, kind: 'schema' }); });
    }, seen);
  });
  var done = {};
  for (var i = 0; i < items.length; i++) {
    if (Date.now() - start > budgetMs) return false;
    var it = items[i];
    var dkey = pointerOf(it.segs) + '|' + pointerOf(it.schemaSegs);
    if (done[dkey]) continue;
    done[dkey] = 1;
    var v = validatorFor(it.schemaSegs);
    if (v.failed) { add('info', 'example.schemaInvalid', it.segs, {}); continue; }
    if (v(it.value)) continue;
    var errs = simplifyErrors(v.errors || []).filter(function (e) {
      if (e.keyword !== 'required') return true;
      var ps = propSchema(e.parentSchema, e.params.missingProperty);
      if (!ps) return true;
      if (ps.readOnly === true && it.context === 'request') return false;
      if (ps.writeOnly === true && it.context === 'response') return false;
      return true;
    });
    if (!errs.length) continue;
    var e0 = errs[0];
    var d = describe(e0, undefined);
    // the location is already given by `where`
    if (d.code === 'schema.fieldType') d = { code: 'schema.type', args: { type: d.args.type } };
    if (d.code === 'schema.fieldEnum') d = { code: 'schema.enum', args: { values: d.args.values } };
    add('warning', 'example.mismatch', it.segs.concat(segmentsOf(e0.instancePath)), { where: e0.instancePath === '' ? '' : e0.instancePath, detail: { code: d.code, args: d.args }, more: String(errs.length - 1) });
  }
  return true;
}

/* 3.1 / 3.2: Schema Objects are JSON Schema 2020-12 documents (the official base schema only
   checks that they are objects or booleans). Each schema slot is checked against the 2020-12
   meta-schema, and `nullable` (3.0 only) is flagged because it has no effect. */
function schemaObjectChecks(version, C, lib, add) {
  if (version !== '3.1' && version !== '3.2') return;
  var ajv = new lib.Ajv2020({ allErrors: true, strict: false, logger: false });
  var seen = new Set();
  C.schemaSlots.forEach(function (slot) {
    if (isObj(slot.node) && !ajv.validateSchema(slot.node)) {
      dropTypeBesideEnum(simplifyErrors(ajv.errors || [])).forEach(function (e) {
        var d = describe(e, undefined);
        add('error', d.code, slot.segs.concat(segmentsOf(e.instancePath)), d.args);
      });
    }
    eachSubschema(slot.node, slot.segs, function (s, segs) {
      if (hasOwn(s, 'nullable')) add('warning', 'schema.nullable31', segs.concat('nullable'), {});
    }, seen);
  });
}

/* Components that no reference, security requirement or discriminator mapping uses. A
   reference from inside the component itself does not count (recursive schemas). */
function unusedComponents(project, rootName, version, add) {
  var root = project.parsed[rootName].doc;
  var maps = componentMaps(root, version);
  if (!maps.length) return;
  var used = {};
  function mark(segs) { if (segs.length >= maps[0].segs.length + 1) used[pointerOf(segs.slice(0, maps[0].segs.length + 1))] = (used[pointerOf(segs.slice(0, maps[0].segs.length + 1))] || 0) + 1; }
  function usedFrom(fromSegs, targetSegs) {
    var depth = maps[0].segs.length + 1;
    if (fromSegs && pointerOf(fromSegs.slice(0, depth)) === pointerOf(targetSegs.slice(0, depth))) return;
    mark(targetSegs);
  }
  project.names.forEach(function (name) {
    var p = project.parsed[name];
    if (!p || p.error) return;
    eachRef(p.doc, function (ref, segs) {
      var r = resolveRef(project, name, ref);
      if ((r.kind === 'local' || r.kind === 'file') && r.file === rootName) usedFrom(name === rootName ? segs : null, r.segs);
    }, true);
    // discriminator mappings name schemas by reference or by name
    (function walk(node) {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!isObj(node)) return;
      if (isObj(node.discriminator) && isObj(node.discriminator.mapping)) {
        Object.keys(node.discriminator.mapping).forEach(function (k) {
          var t = node.discriminator.mapping[k];
          if (typeof t !== 'string') return;
          if (t.indexOf('#') >= 0 || t.indexOf('/') >= 0) {
            var r = resolveRef(project, name, t);
            if (r.file === rootName && r.segs) mark(r.segs);
          } else mark(version === '2.0' ? ['definitions', t] : ['components', 'schemas', t]);
        });
      }
      Object.keys(node).forEach(function (k) { if (!DATA_KEYS[k] || k === 'default') walk(node[k]); });
    })(p.doc);
  });
  // security requirements
  var C = collect(root, version);
  C.requirements.forEach(function (rq) {
    rq.list.forEach(function (req) {
      if (isObj(req)) Object.keys(req).forEach(function (n) { mark(version === '2.0' ? ['securityDefinitions', n] : ['components', 'securitySchemes', n]); });
    });
  });
  maps.forEach(function (m) {
    Object.keys(m.map).forEach(function (n) {
      if (/^x-/.test(n)) return;
      var segs = m.segs.concat(n);
      if (!used[pointerOf(segs)]) add('warning', 'component.unused', segs, { kind: m.segs[m.segs.length - 1], name: n }, rootName);
    });
  });
}

/* ───────────────────────── multi-file bundling ───────────────────────── */

/* Replaces references to other provided files with a copy of their target, so the root can be
   validated as one document. References inside a copied file are resolved against that file;
   references back into the root become local ones. origins maps each copied object to its file
   and pointer, so problems found in the copy are reported where the text is. */
function bundle(project, rootName, limit) {
  var origins = new Map();
  var count = 0, truncated = false;
  var rootDoc = project.parsed[rootName].doc;
  function copy(node, file, segs, stack) {
    if (Array.isArray(node)) {
      var arr = node.map(function (v, i) { return copy(v, file, segs.concat(i), stack); });
      if (file !== rootName) origins.set(arr, { file: file, segs: segs });
      return arr;
    }
    if (!isObj(node)) return node;
    if (++count > limit) { truncated = true; return node; }
    if (typeof node.$ref === 'string') {
      var r = resolveRef(project, file, node.$ref);
      if (r.kind === 'file' || (r.kind === 'local' && file !== rootName)) {
        if (r.file === rootName) {
          var local = {};
          Object.keys(node).forEach(function (k) { local[k] = k === '$ref' ? pointerOf(r.segs) : node[k]; });
          if (file !== rootName) origins.set(local, { file: file, segs: segs });
          return local;
        }
        if (r.exists) {
          var key = r.file + pointerOf(r.segs);
          if (stack.indexOf(key) < 0) return copy(r.node, r.file, r.segs, stack.concat(key));
        }
      }
    }
    var out = {};
    Object.keys(node).forEach(function (k) {
      out[k] = (isData(k, segs[segs.length - 1]) || /^x-/.test(k)) ? node[k] : copy(node[k], file, segs.concat(k), stack);
    });
    if (file !== rootName) origins.set(out, { file: file, segs: segs });
    return out;
  }
  var doc = copy(rootDoc, rootName, [], []);
  return { doc: doc, origins: origins, truncated: truncated };
}

/* Bundled pointer → { file, segs } in the original files. */
function mapBack(bundled, rootName, segs) {
  if (!bundled.origins.size) return { file: rootName, segs: segs };
  var node = bundled.doc, best = { file: rootName, segs: segs };
  for (var i = 0; i <= segs.length; i++) {
    var o = (isObj(node) || Array.isArray(node)) ? bundled.origins.get(node) : undefined;
    if (o) best = { file: o.file, segs: o.segs.concat(segs.slice(i)) };
    if (i === segs.length || node === null || typeof node !== 'object') break;
    node = node[segs[i]];
  }
  return best;
}

/* ───────────────────────── entry point ───────────────────────── */

var MAX_BUNDLE = 200000;
var EXAMPLE_BUDGET_MS = 4000;

export function validateProject(input, lib) {
  var started = Date.now();
  var names = Object.keys(input.files);
  var rootName = input.root;
  var project = { names: names, parsed: {} };
  var problems = [];
  function push(level, code, file, segs, args) {
    problems.push({ level: level, code: code, args: args || {}, file: file, segs: segs || [] });
  }
  names.forEach(function (n) { project.parsed[n] = parseText(input.files[n], lib.jsyaml); });

  var rootParsed = project.parsed[rootName];
  var result = { kind: null, version: null, problems: problems, summary: null, files: names, ms: 0 };
  function finish() {
    // locate, sort, de-duplicate
    var seen = {};
    var outList = [];
    problems.forEach(function (p) {
      var parsed = project.parsed[p.file];
      var offset = p.offset;
      if (offset === undefined) offset = parsed && !parsed.error ? locate(parsed, p.segs) : 0;
      var lc = parsed ? lineCol(parsed, offset) : { line: 1, col: 1 };
      var item = { level: p.level, code: p.code, args: p.args, file: p.file, path: p.path || pointerOf(p.segs), line: p.line || lc.line, col: p.col || lc.col, offset: offset };
      var key = item.level + item.code + item.file + item.path + JSON.stringify(item.args);
      if (seen[key]) return;
      seen[key] = 1;
      outList.push(item);
    });
    var rank = { error: 0, warning: 1, info: 2 };
    outList.sort(function (a, b) {
      if (a.file !== b.file) return a.file === rootName ? -1 : b.file === rootName ? 1 : (a.file < b.file ? -1 : 1);
      return a.line - b.line || a.col - b.col || rank[a.level] - rank[b.level];
    });
    result.problems = outList;
    result.ms = Date.now() - started;
    return result;
  }

  // parse errors
  names.forEach(function (n) {
    var p = project.parsed[n];
    if (p.error) problems.push({ level: 'error', code: 'parse.yaml', args: { reason: p.error.reason }, file: n, segs: [], offset: p.error.offset, line: p.error.line, col: p.error.col, path: '' });
  });
  if (rootParsed.error) return finish();

  var doc = rootParsed.doc;
  if (!isObj(doc)) { push('error', 'doc.notObject', rootName, []); return finish(); }
  if (doc.swagger !== undefined && doc.openapi === undefined) {
    result.kind = 'swagger';
    if (doc.swagger !== '2.0') { push('error', 'doc.swaggerVersion', rootName, ['swagger'], { got: JSON.stringify(doc.swagger) }); return finish(); }
  } else if (doc.openapi === undefined) {
    push('error', 'doc.noVersion', rootName, []);
    return finish();
  } else {
    result.kind = 'openapi';
  }
  var version = versionOf(doc);
  if (!version) { push('error', 'doc.badOpenapi', rootName, ['openapi'], { got: JSON.stringify(doc.openapi) }); return finish(); }
  result.version = version;

  // references, per file (only files reachable from the root are checked)
  var reachable = {};
  reachable[rootName] = true;
  var queue = [rootName];
  var refInfo = {};
  while (queue.length) {
    var f = queue.shift();
    var pf = project.parsed[f];
    if (!pf || pf.error) continue;
    eachRef(pf.doc, function (ref, segs) {
      var r = resolveRef(project, f, ref);
      if (r.kind === 'local' || r.kind === 'file') {
        if (!r.exists) push('error', r.kind === 'local' ? 'ref.missing' : 'ref.missingInFile', f, segs, { ref: ref, file: r.file });
        if (r.kind === 'file' && !reachable[r.file]) { reachable[r.file] = true; queue.push(r.file); }
      } else if (r.kind === 'unparsed') {
        if (!reachable[r.file]) { reachable[r.file] = true; }
      } else if (r.kind === 'url') {
        refInfo.url = (refInfo.url || 0) + 1;
        push('info', 'ref.url', f, segs, { ref: ref });
      } else if (r.kind === 'missing-file') {
        refInfo.missing = (refInfo.missing || 0) + 1;
        push('info', 'ref.missingFile', f, segs, { ref: ref, file: r.file });
      } else if (r.kind === 'anchor') {
        push('info', 'ref.anchor', f, segs, { ref: ref });
      } else {
        push('error', 'ref.bad', f, segs, { ref: ref });
      }
    });
  }
  names.forEach(function (n) { if (!reachable[n]) push('info', 'file.unused', n, [], { file: n }); });

  // one document for the structural checks
  var bundled = bundle(project, rootName, MAX_BUNDLE);
  if (bundled.truncated) push('info', 'bundle.truncated', rootName, [], { limit: String(MAX_BUNDLE) });
  var bdoc = bundled.doc;
  function addB(level, code, segs, args, fileOverride) {
    if (fileOverride) { push(level, code, fileOverride, segs, args); return; }
    var m = mapBack(bundled, rootName, segs);
    push(level, code, m.file, m.segs, args);
  }

  var validate = createValidatorsCached(lib)(version);
  if (!validate(bdoc)) {
    var typeListAt = {};
    dropTypeBesideEnum(simplifyErrors(validate.errors || [])).forEach(function (e) {
      var segs = segmentsOf(e.instancePath);
      var inst = getAt(bdoc, segs);
      var d = describe(e, inst);
      if (version === '3.0' && segs[segs.length - 1] === 'type' && Array.isArray(inst)) {
        if (typeListAt[e.instancePath]) return;
        typeListAt[e.instancePath] = 1;
        d = { code: 'schema.typeList30', args: {} };
      }
      addB('error', d.code, segs, d.args);
    });
  }
  var C = collect(bdoc, version);
  semanticChecks(bdoc, version, C, addB);
  schemaObjectChecks(version, C, lib, addB);
  var exampleDone = exampleChecks(bdoc, version, C, lib, addB, EXAMPLE_BUDGET_MS);
  if (!exampleDone) push('info', 'example.budget', rootName, [], { seconds: String(EXAMPLE_BUDGET_MS / 1000) });
  unusedComponents(project, rootName, version, function (level, code, segs, args, file) { push(level, code, file, segs, args); });
  if ((refInfo.missing || refInfo.url) && componentMaps(doc, version).length) push('info', 'component.unusedMaybe', rootName, [], {});

  names.forEach(function (n) {
    var p = project.parsed[n];
    if (!p || p.error || !reachable[n]) return;
    p.bigInts.forEach(function (b) {
      var lc = lineCol(p, b.offset);
      problems.push({ level: 'info', code: 'number.big', args: { raw: b.raw }, file: n, segs: [], offset: b.offset, line: lc.line, col: lc.col, path: '' });
    });
  });
  if (version === '2.0') push('info', 'swagger.convert', rootName, ['swagger'], {});

  result.summary = summarize(bdoc, version, C);
  return finish();
}

var validatorCache = null;
function createValidatorsCached(lib) {
  if (!validatorCache || validatorCache.lib !== lib.schemas) validatorCache = { lib: lib.schemas, get: createValidators(lib) };
  return validatorCache.get;
}

function summarize(doc, version, C) {
  var info = isObj(doc.info) ? doc.info : {};
  var comps = 0;
  componentMaps(doc, version).forEach(function (m) { comps += Object.keys(m.map).filter(function (k) { return !/^x-/.test(k); }).length; });
  var servers = [];
  if (version === '2.0') {
    if (typeof doc.host === 'string') servers.push(((Array.isArray(doc.schemes) && doc.schemes[0]) || 'https') + '://' + doc.host + (typeof doc.basePath === 'string' ? doc.basePath : ''));
  } else if (Array.isArray(doc.servers)) doc.servers.forEach(function (s) { if (isObj(s) && typeof s.url === 'string') servers.push(s.url); });
  var pathCount = isObj(doc.paths) ? Object.keys(doc.paths).filter(function (k) { return !/^x-/.test(k); }).length : 0;
  var ops = 0;
  C.pathItems.forEach(function (pi) { if (pi.keySegs[0] === 'paths' && pi.keySegs.length === 2) ops += pi.ops.length; });
  return {
    title: typeof info.title === 'string' ? info.title : '',
    apiVersion: info.version === undefined ? '' : String(info.version),
    specVersion: String(version === '2.0' ? doc.swagger : doc.openapi),
    paths: pathCount,
    operations: ops,
    webhooks: isObj(doc.webhooks) ? Object.keys(doc.webhooks).length : 0,
    components: comps,
    servers: servers,
  };
}
