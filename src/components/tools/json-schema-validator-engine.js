// JSON Schema Validator engine. Pure functions, no DOM: used by json-schema-validator.worker.js,
// by the main-thread fallback in JsonSchemaValidatorTool.astro (both through
// json-schema-validator-run.js), by the page for messages and copies, and by
// scripts/test-json-schema-validator.mjs.
//
// Ajv, its draft classes, ajv-formats and js-yaml are passed in as `lib`
// ({ Ajv, Ajv2019, Ajv2020, AjvDraft04, addFormats, draft06Meta, yaml }), so the test runs the
// engine in Node against the same packages. runValidation returns plain data that can be posted
// across a worker boundary.
//
// A document has three states: valid, invalid, or unknown ("cannot be determined"). Unknown is
// used when the input reaches a case Ajv is known to get wrong, or when a number cannot be held
// exactly in a JavaScript double; no valid / invalid verdict and no Ajv errors are shown then.
var DRAFTS = ['4', '6', '7', '2019-09', '2020-12'];
var DEFAULT_DRAFT = '2020-12';
var META_URIS = {
  '4': 'http://json-schema.org/draft-04/schema#',
  '6': 'http://json-schema.org/draft-06/schema#',
  '7': 'http://json-schema.org/draft-07/schema#',
  '2019-09': 'https://json-schema.org/draft/2019-09/schema',
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
};
var DRAFT_NAMES = { '4': 'Draft 4', '6': 'Draft 6', '7': 'Draft 7', '2019-09': 'Draft 2019-09', '2020-12': 'Draft 2020-12' };
// "format" is checked (asserted) for the JSON Schema formats that ajv-formats implements.
// Draft 2019-09 and 2020-12 treat format as an annotation unless the validator opts in;
// this tool opts in while "Check format" is on. Formats outside the list are accepted and
// listed in a note.
var ASSERTED_FORMATS = [
  'date', 'time', 'date-time', 'duration', 'email', 'hostname', 'ipv4', 'ipv6',
  'uri', 'uri-reference', 'uri-template', 'uuid', 'json-pointer', 'relative-json-pointer', 'regex',
];
// Keywords Ajv implements beyond (or outside) each draft. Removing them makes Ajv ignore
// them as the specification and Python jsonschema do; they are then reported as unknown.
//   nullable: OpenAPI 3.0, not JSON Schema (Ajv accepts null with it).
//   id: draft-04 only (Ajv throws "NOT SUPPORTED" in later drafts).
//   const / contains / propertyNames / if / then / else: added after draft-04 or draft-06.
//   dependencies: split into dependentRequired / dependentSchemas in 2019-09.
//   $recursiveRef / $recursiveAnchor: 2019-09 only, replaced by $dynamicRef in 2020-12.
var REMOVED_KEYWORDS = {
  '4': ['nullable', 'const', 'contains', 'propertyNames', 'if', 'then', 'else'],
  '6': ['nullable', 'id', 'if', 'then', 'else'],
  '7': ['nullable', 'id'],
  '2019-09': ['nullable', 'id', 'dependencies'],
  '2020-12': ['nullable', 'id', 'dependencies', '$recursiveRef', '$recursiveAnchor'],
};
var SINGLE_SCHEMA = ['additionalItems', 'additionalProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema'];
var ARRAY_SCHEMA = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
var MAP_SCHEMA = ['properties', 'patternProperties', 'dependentSchemas'];
var CONTAINERS = ['definitions', '$defs'];
// Draft 4–7: "All other properties in a $ref object MUST be ignored." Annotations are kept
// because they change nothing; definitions stay because JSON Pointers may point into them.
var KEEP_WITH_REF = ['$ref', '$schema', 'definitions', '$comment', 'title', 'description', 'default', 'examples', 'readOnly', 'writeOnly'];
var MAX_NOTES = 50;

function fmt(tpl, params) {
  return String(tpl).replace(/\{(\w+)\}/g, function (m, k) {
    return params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m;
  });
}
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// plain assignment of "__proto__" would set the prototype instead of a property
function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); }
function escSeg(s) { return String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }
function pointerOf(segs) { return segs.map(function (s) { return '/' + escSeg(s); }).join(''); }
function segmentsOf(ptr) {
  if (!ptr) return [];
  return ptr.slice(1).split('/').map(function (s) { return s.replace(/~1/g, '/').replace(/~0/g, '~'); });
}
function getAt(value, ptr) {
  var segs = segmentsOf(ptr), v = value;
  for (var i = 0; i < segs.length; i++) {
    if (v === null || typeof v !== 'object' || !has(v, segs[i])) return undefined;
    v = v[segs[i]];
  }
  return v;
}
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function codePoints(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0xd800 || c > 0xdbff || i + 1 >= s.length) n++; else { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++; n++; } } return n; }
function preview(v, max) {
  var s;
  try { s = JSON.stringify(v); } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  max = max || 80;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function lineCol(text, offset) {
  var line = 1, last = -1;
  for (var i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return { line: line, col: offset - last };
}

/* $schema → draft. Accepts http and https and an optional trailing "#"; reports the
   non-official forms, which Ajv, Python jsonschema and Go v6 do not all recognize. */
function draftOfUri(uri) {
  if (typeof uri !== 'string') return null;
  var m = /^(https?):\/\/json-schema\.org\/(?:draft-0([467])\/schema|draft\/(2019-09|2020-12)\/schema)(#?)$/.exec(uri.trim());
  if (!m) return null;
  var draft = m[2] || m[3];
  var canonical = META_URIS[draft];
  var bare = canonical.replace(/#$/, '');
  var u = uri.trim();
  return { draft: draft, canonical: u === canonical || u === bare || u === bare + '#' ? true : false, official: canonical };
}
function detectDraft(schema, menu) {
  var uri = isObj(schema) && typeof schema.$schema === 'string' ? schema.$schema : null;
  var d = draftOfUri(uri);
  var notices = [];
  if (!menu || menu === 'auto') {
    if (d) {
      if (!d.canonical) notices.push({ code: 'schemaNonCanonical', uri: uri, canonical: d.official, draft: d.draft });
      return { draft: d.draft, source: 'schema', notices: notices };
    }
    notices.push(uri !== null ? { code: 'schemaUnknown', uri: uri, draft: DEFAULT_DRAFT } : { code: 'noSchema', draft: DEFAULT_DRAFT });
    return { draft: DEFAULT_DRAFT, source: 'default', notices: notices };
  }
  if (d && d.draft !== menu) notices.push({ code: 'schemaMismatch', schemaDraft: d.draft, draft: menu });
  else if (uri !== null && !d) notices.push({ code: 'schemaUnknown', uri: uri, draft: menu });
  return { draft: menu, source: 'menu', notices: notices };
}

function createAjv(draft, lib, formats) {
  var opts = {
    allErrors: true,
    strictSchema: 'log', strictTypes: false, strictTuples: false, strictRequired: false,
    allowUnionTypes: true,
    // without this, {"required": ["constructor"]} passes {} because ({}).constructor exists
    ownProperties: true,
    validateFormats: formats !== false,
    logger: { log: function () {}, warn: function () {}, error: function () {} },
  };
  var ajv;
  if (draft === '4') ajv = new lib.AjvDraft04(opts);
  else if (draft === '6') { ajv = new lib.Ajv(opts); ajv.addMetaSchema(lib.draft06Meta); }
  else if (draft === '7') ajv = new lib.Ajv(opts);
  else if (draft === '2019-09') ajv = new lib.Ajv2019(opts);
  else ajv = new lib.Ajv2020(opts);
  (REMOVED_KEYWORDS[draft] || []).forEach(function (k) { if (ajv.getKeyword(k)) ajv.removeKeyword(k); });
  if (formats !== false) lib.addFormats(ajv, ASSERTED_FORMATS);
  return ajv;
}
function knownKeywords(ajv, draft) {
  var known = {};
  Object.keys(ajv.RULES.keywords).forEach(function (k) { if (k !== '$async') known[k] = true; });
  if (draft === '2019-09' || draft === '2020-12') known.$anchor = true;
  return known;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function suggestKeyword(k, known) {
  var lower = k.toLowerCase(), best = null, bestD = 3;
  Object.keys(known).forEach(function (cand) {
    if (cand.toLowerCase() === lower) { best = cand; bestD = -1; return; }
    if (bestD < 0 || k.length < 4) return;
    var d = editDistance(lower, cand.toLowerCase());
    if (d < bestD) { bestD = d; best = cand; }
  });
  return bestD <= 2 ? best : null;
}

/* Walks the schema in schema positions and returns a copy that Ajv compiles. The copy has
   the root $schema set to the chosen draft, and (draft 4–7) $ref siblings removed. Also
   collects unknown keywords, $ref locations, invalid regular expressions and the `facts` that
   unsupportedOf() turns into "cannot be determined" reasons. */
var NUMERIC_KEYWORDS = ['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'const', 'enum', 'uniqueItems'];
// Ajv's allSchemaProperties() drops a key named "__proto__" from these maps (prototype guard)
var PROTO_MAPS = ['properties', 'patternProperties', 'dependentSchemas', 'dependentRequired', 'dependencies'];
function newFacts() {
  return {
    dynamicRef: null, recursiveRefs: [], recursiveAnchor: false, unevaluated: null, contains: null,
    ifPartial: null, itemsInBranch: null, refInBranch: false, itemsSchema: null, numeric: false, proto: null, keywords: {},
  };
}
// The document a $ref points to (fragment removed), resolved against the base URI; a relative
// reference without a usable base is kept as "rel:<ref>".
function refTarget(ref, base) {
  if (ref.charAt(0) === '#') return null;
  try { return new URL(ref, base || undefined).href.replace(/#.*$/, ''); } catch (e) { return 'rel:' + ref.replace(/#.*$/, ''); }
}
function prepareSchema(schema, draft, known, ctx) {
  ctx = ctx || {};
  var notices = [], errors = [], refs = [], unknown = {}, older = {};
  var facts = newFacts();
  var targets = [];
  var idKey = draft === '4' ? 'id' : '$id';
  var legacyRef = draft === '4' || draft === '6' || draft === '7';
  function checkRegex(p, path) {
    try { new RegExp(p, 'u'); } catch (e) { errors.push({ code: 'badPattern', path: path, pattern: p, message: e.message }); }
  }
  function walkMap(v, segs, sc) {
    if (!isObj(v)) return v;
    var m = {};
    Object.keys(v).forEach(function (name) { put(m, name, walk(v[name], segs.concat(name), sc)); });
    return m;
  }
  // sc: { branch: inside an anyOf / oneOf branch, anchor: the current resource has $recursiveAnchor: true }
  function walk(node, segs, sc) {
    if (!isObj(node)) return node;
    var path = '#' + pointerOf(segs);
    var out = {};
    var hasRef = typeof node.$ref === 'string';
    if (typeof node[idKey] === 'string') {
      var nb = sc.base;
      try { nb = new URL(node[idKey], sc.base || undefined).href.replace(/#.*$/, ''); } catch (e) { /* keep the base */ }
      sc = { branch: sc.branch, anchor: segs.length ? node.$recursiveAnchor === true : sc.anchor, base: nb };
    }
    if (hasRef) {
      refs.push({ ref: node.$ref, path: path + '/$ref' });
      var tg = refTarget(node.$ref, sc.base);
      if (tg && targets.indexOf(tg) < 0) targets.push(tg);
    }
    if (known.$recursiveAnchor && node.$recursiveAnchor === true) facts.recursiveAnchor = true;
    if (has(node, '$dynamicRef') && known.$dynamicRef && !facts.dynamicRef) facts.dynamicRef = path + '/$dynamicRef';
    if (typeof node.$dynamicRef === 'string' && known.$dynamicRef) { var dt = refTarget(node.$dynamicRef, sc.base); if (dt && targets.indexOf(dt) < 0) targets.push(dt); }
    if (has(node, '$recursiveRef') && known.$recursiveRef) facts.recursiveRefs.push({ path: path + '/$recursiveRef', anchor: sc.anchor });
    if (sc.branch && hasRef) facts.refInBranch = true;
    var ignored = [];
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      var here = segs.concat(k);
      if (legacyRef && hasRef && KEEP_WITH_REF.indexOf(k) < 0) { ignored.push(k); return; }
      if (CONTAINERS.indexOf(k) >= 0) { put(out, k, walkMap(v, here, sc)); return; }
      if (known[k]) {
        facts.keywords[k] = true;
        if (NUMERIC_KEYWORDS.indexOf(k) >= 0) facts.numeric = true;
        if ((k === 'unevaluatedItems' || k === 'unevaluatedProperties') && !facts.unevaluated) facts.unevaluated = { keyword: k, path: path + '/' + k, items: false };
        if (k === 'unevaluatedItems') facts.unevaluated.items = true;
        if (k === 'contains' && !facts.contains) facts.contains = path + '/contains';
        if (k === 'if' && (!has(node, 'then') || !has(node, 'else')) && !facts.ifPartial) facts.ifPartial = path + '/if';
        if ((k === 'items' && !Array.isArray(v)) || k === 'additionalItems') {
          if (!facts.itemsSchema) facts.itemsSchema = path + '/' + k;
          if (sc.branch && !facts.itemsInBranch) facts.itemsInBranch = path + '/' + k;
        }
        if (PROTO_MAPS.indexOf(k) >= 0 && isObj(v) && has(v, '__proto__') && !facts.proto) facts.proto = '#' + pointerOf(here.concat('__proto__'));
      }
      if (!known[k]) {
        var u = unknown[k] || (unknown[k] = { count: 0, path: path, node: node });
        u.count++;
        // Ajv's type check reads "nullable" even when the keyword is removed; drop it
        if (k !== 'nullable') put(out, k, v);
        return;
      }
      if (k === 'items') {
        if (Array.isArray(v)) {
          if (draft === '2020-12') older.items = true;
          put(out, k, v.map(function (s, i) { return walk(s, here.concat(i), sc); }));
        } else put(out, k, walk(v, here, sc));
      } else if (SINGLE_SCHEMA.indexOf(k) >= 0) {
        put(out, k, walk(v, here, sc));
      } else if (ARRAY_SCHEMA.indexOf(k) >= 0 && Array.isArray(v)) {
        var inner = k === 'anyOf' || k === 'oneOf' ? { branch: true, anchor: sc.anchor, base: sc.base } : sc;
        put(out, k, v.map(function (s, i) { return walk(s, here.concat(i), inner); }));
      } else if (MAP_SCHEMA.indexOf(k) >= 0) {
        put(out, k, walkMap(v, here, sc));
        if (k === 'patternProperties' && isObj(v)) Object.keys(v).forEach(function (p) { checkRegex(p, '#' + pointerOf(here.concat(p))); });
      } else if (k === 'dependencies' && isObj(v)) {
        var dm = {};
        Object.keys(v).forEach(function (name) { put(dm, name, Array.isArray(v[name]) ? v[name] : walk(v[name], here.concat(name), sc)); });
        put(out, k, dm);
      } else {
        put(out, k, v);
        if (k === 'pattern' && typeof v === 'string') checkRegex(v, path + '/pattern');
      }
    });
    // Ajv refuses "enum": [] although draft-06 and later allow it (nothing is valid); an
    // extra false branch in allOf has the same meaning.
    if (Array.isArray(out.enum) && out.enum.length === 0 && draft !== '4') {
      delete out.enum;
      out.allOf = Array.isArray(out.allOf) ? out.allOf.concat([false]) : [false];
    }
    if (ignored.length) notices.push({ code: 'refSiblings', path: path, keywords: ignored.map(function (k) { return '"' + k + '"'; }).join(', '), draft: draft });
    return out;
  }
  var copy = walk(schema, [], { branch: false, anchor: isObj(schema) && schema.$recursiveAnchor === true, base: ctx.base || undefined });
  if (isObj(copy)) {
    var root = {};
    root.$schema = META_URIS[draft];
    Object.keys(copy).forEach(function (k) { if (k !== '$schema') put(root, k, copy[k]); });
    copy = root;
  }
  Object.keys(unknown).forEach(function (k) {
    var u = unknown[k];
    if (k === 'nullable') {
      var t = u.node.type;
      var types = (Array.isArray(t) ? t : typeof t === 'string' ? [t] : ['string']).filter(function (x) { return x !== 'null'; }).concat('null');
      notices.push({ code: 'nullable', path: u.path, types: types.map(function (x) { return '"' + x + '"'; }).join(', ') });
    } else if (k === 'id' && draft !== '4') notices.push({ code: 'idKeyword', path: u.path, draft: draft });
    else if (k === 'dependencies') { notices.push({ code: 'dependencies', path: u.path, draft: draft }); older.dependencies = true; }
    else if (k === 'additionalItems' && draft === '2020-12') { notices.push({ code: 'additionalItems', path: u.path, draft: draft }); older.additionalItems = true; }
    else notices.push({ code: u.count > 1 ? 'unknownKeywordMany' : 'unknownKeyword', keyword: k, path: u.path, count: u.count, suggestion: suggestKeyword(k, known) });
  });
  if (ctx.source === 'default' && (draft === '2019-09' || draft === '2020-12')) {
    var kws = Object.keys(older).filter(function (k) { return !(k === 'additionalItems' && draft === '2019-09'); });
    if (kws.length) notices.push({ code: 'olderSyntax', keywords: kws.map(function (k) { return '"' + k + '"' + (k === 'items' ? ' (array)' : ''); }).join(', ') });
  }
  return { schema: copy, notices: notices, errors: errors, refs: refs, facts: facts, targets: targets };
}

/* Cases where Ajv is known to give a wrong verdict. Each rule looks only at the structure of
   the schema (and the referenced schemas); a match makes the whole result "cannot be
   determined". Checked against the official JSON Schema Test Suite in the test. */
var VOCABS = {
  '2019-09': ['core', 'applicator', 'validation', 'meta-data', 'format', 'content'],
  '2020-12': ['core', 'applicator', 'unevaluated', 'validation', 'meta-data', 'format-annotation', 'format-assertion', 'content'],
};
// Vocabularies whose keywords decide validity; a meta-schema that leaves one out turns them off.
var VOCAB_KEYWORDS = {
  applicator: ['prefixItems', 'items', 'additionalItems', 'contains', 'additionalProperties', 'properties', 'patternProperties', 'dependentSchemas', 'propertyNames', 'if', 'then', 'else', 'allOf', 'anyOf', 'oneOf', 'not'],
  validation: ['type', 'enum', 'const', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'maxItems', 'minItems', 'uniqueItems', 'maxContains', 'minContains', 'maxProperties', 'minProperties', 'required', 'dependentRequired'],
  unevaluated: ['unevaluatedItems', 'unevaluatedProperties'],
};
function vocabUri(d, name) { return 'https://json-schema.org/draft/' + d + '/vocab/' + name; }
function vocabularyReasons(vocab, uri, draft, ownMeta, used) {
  if (!isObj(vocab)) return [];
  var out = [];
  var standard = {};
  ['2019-09', '2020-12'].forEach(function (d) { VOCABS[d].forEach(function (n) { standard[vocabUri(d, n)] = true; }); });
  var unknownReq = Object.keys(vocab).filter(function (k) { return vocab[k] === true && !standard[k]; });
  if (unknownReq.length) out.push({ code: 'vocabUnknown', uri: uri, vocab: unknownReq.join(', ') });
  if (!ownMeta && (draft === '2019-09' || draft === '2020-12')) {
    // 2019-09 keeps unevaluated* in the applicator vocabulary
    var groups = draft === '2019-09' ? { applicator: VOCAB_KEYWORDS.applicator.concat(VOCAB_KEYWORDS.unevaluated), validation: VOCAB_KEYWORDS.validation } : VOCAB_KEYWORDS;
    var missing = Object.keys(groups).filter(function (n) {
      return !has(vocab, vocabUri(draft, n)) && groups[n].some(function (w) { return used[w]; });
    }).map(function (n) { return vocabUri(draft, n); });
    if (missing.length) out.push({ code: 'vocabMissing', uri: uri, vocab: missing.join(', ') });
  }
  return out;
}
function unsupportedOf(all, draft, rootSchema, extras) {
  var reasons = [];
  var f = newFacts();
  all.forEach(function (x) {
    Object.keys(f).forEach(function (k) {
      if (k === 'recursiveRefs') f[k] = f[k].concat(x[k]);
      else if (k === 'keywords') Object.keys(x[k]).forEach(function (w) { f.keywords[w] = true; });
      else if (!f[k] && x[k]) f[k] = x[k];
    });
  });
  if (f.dynamicRef) reasons.push({ code: 'dynamicRef', path: f.dynamicRef });
  // $recursiveRef whose initial target has no $recursiveAnchor: true acts as a plain $ref, but
  // Ajv follows the dynamic scope when another resource has the anchor.
  var plain = f.recursiveRefs.filter(function (r) { return !r.anchor; })[0];
  if (plain && f.recursiveAnchor) reasons.push({ code: 'recursiveRef', path: plain.path });
  if (f.unevaluated) {
    var combo = null;
    if (f.ifPartial) combo = { kind: 'ifPartial', at: f.ifPartial };
    else if (f.unevaluated.items && f.contains) combo = { kind: 'contains', at: f.contains };
    else if (f.unevaluated.items && f.itemsInBranch) combo = { kind: 'itemsInBranch', at: f.itemsInBranch };
    else if (f.unevaluated.items && f.refInBranch && f.itemsSchema) combo = { kind: 'itemsInBranch', at: f.itemsSchema };
    if (combo) reasons.push({ code: 'unevaluated', keyword: f.unevaluated.keyword, path: f.unevaluated.path, combo: combo.kind, at: combo.at });
  }
  if (draft === '2019-09' || draft === '2020-12') {
    if (isObj(rootSchema)) {
      reasons = reasons.concat(vocabularyReasons(rootSchema.$vocabulary, '#', draft, true, f.keywords));
      var metaUri = typeof rootSchema.$schema === 'string' ? rootSchema.$schema.replace(/#$/, '') : null;
      var meta = metaUri && !draftOfUri(metaUri) ? (extras || []).filter(function (e) { return e.id && e.id.replace(/#$/, '') === metaUri; })[0] : null;
      if (meta) reasons = reasons.concat(vocabularyReasons(meta.doc.$vocabulary, metaUri, draft, false, f.keywords));
    }
  }
  return { reasons: reasons, facts: f };
}

/* Ajv reports every failed branch of a oneOf / anyOf, then the summary. Errors inside a
   $ref'd branch carry the schema path of the referenced location, not of the branch, so
   branches are found by contiguity (Ajv pushes a branch's errors right before the summary)
   and by matching each branch's own path and its local $ref targets. The branch with the
   fewest errors, not counting branches whose const / enum discriminator fails, is shown as
   the closest match. "if" summaries are folded into the then / else errors they explain. */
function resolveLocal(root, ptr) {
  if (ptr === '#') return root;
  if (typeof ptr !== 'string' || ptr.indexOf('#/') !== 0) return undefined;
  var v = root, segs = segmentsOf(ptr.slice(1));
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    try { s = decodeURIComponent(s); } catch (e) {}
    if (v === null || typeof v !== 'object' || !has(v, s)) return undefined;
    v = v[s];
  }
  return v;
}
function localTargets(root, node, out, depth) {
  if (depth > 20 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(function (x) { localTargets(root, x, out, depth); }); return out; }
  Object.keys(node).forEach(function (k) {
    var v = node[k];
    if (k === '$ref' && typeof v === 'string' && v.indexOf('#/') === 0 && out.indexOf(v) < 0) {
      out.push(v);
      localTargets(root, resolveLocal(root, v), out, depth + 1);
    } else if (typeof v === 'object') localTargets(root, v, out, depth);
  });
  return out;
}
function within(path, base) { return base === '' || path === base || path.indexOf(base + '/') === 0; }
function startsAt(sp, prefix) { return sp === prefix || sp.indexOf(prefix + '/') === 0; }
function parentPath(sp) { return sp.slice(0, sp.lastIndexOf('/')) || '#'; }
function lastSeg(sp) { return sp.slice(sp.lastIndexOf('/') + 1); }
function leafCount(nodes) {
  var n = 0;
  nodes.forEach(function (x) {
    var br = x.branches ? x.branches.filter(function (b) { return b.index === x.closest; })[0] : null;
    n += br && br.nodes.length ? leafCount(br.nodes) : 1;
  });
  return n;
}

function nestErrors(raw, root) {
  var seen = {}, list = [];
  (raw || []).forEach(function (e) {
    var key = e.instancePath + '|' + e.schemaPath + '|' + JSON.stringify(e.params);
    if (!seen[key]) { seen[key] = true; list.push(e); }
  });
  var pending = [];
  list.forEach(function (e) {
    var isBranch = (e.keyword === 'oneOf' || e.keyword === 'anyOf') && !(e.params && e.params.passingSchemas);
    var isIf = e.keyword === 'if';
    if (!isBranch && !isIf) { pending.push({ e: e }); return; }
    var S = e.schemaPath, P = e.instancePath, parent = parentPath(S);
    var own = isIf ? parent + '/' + (e.params && e.params.failingKeyword) : S;
    var block = [];
    while (pending.length) {
      var c = pending[pending.length - 1], sp = c.e.schemaPath;
      if (!within(c.e.instancePath, P)) break;
      if (startsAt(sp, parent) && sp !== parent && !startsAt(sp, own)) {
        var kw = segmentsOf(sp.slice(parent.length))[0];
        if (CONTAINERS.indexOf(kw) < 0) break;
      }
      block.unshift(pending.pop());
    }
    if (isIf) {
      if (!block.length) { pending.push({ e: e }); return; }
      block.forEach(function (c) { if (!c.via) c.via = e.params.failingKeyword; pending.push(c); });
      return;
    }
    var arr = root !== undefined ? resolveLocal(root, S) : undefined;
    var n = Array.isArray(arr) ? arr.length : 0;
    var prefixes = [];
    for (var i = 0; i < n; i++) prefixes.push([S + '/' + i].concat(localTargets(root, arr[i], [], 0)));
    var branches = [];
    for (var b = 0; b < n; b++) branches.push({ index: b, nodes: [] });
    var cur = 0;
    block.forEach(function (c) {
      var cands = [];
      for (var i2 = 0; i2 < n; i2++) if (prefixes[i2].some(function (p) { return startsAt(c.e.schemaPath, p); })) cands.push(i2);
      if (cands.length) {
        var pick = cands.filter(function (x) { return x >= cur; })[0];
        cur = pick === undefined ? cands[0] : pick;
      }
      if (!branches[cur]) branches[cur] = { index: cur, nodes: [] };
      branches[cur].nodes.push(c);
    });
    branches = branches.filter(Boolean);
    var best = null, bestScore = Infinity;
    branches.forEach(function (br) {
      if (!br.nodes.length) return;
      var disc = br.nodes.filter(function (x) { return (x.e.keyword === 'const' || x.e.keyword === 'enum') && x.e.instancePath !== P && segmentsOf(x.e.instancePath.slice(P.length)).length === 1; }).length;
      var score = leafCount(br.nodes) + disc * 100;
      if (score < bestScore) { bestScore = score; best = br.index; }
    });
    pending.push({ e: e, branches: branches, closest: best });
  });
  return pending;
}

/* One error → message in the page language (T = STRINGS[lang]). */
function describe(e, data, T) {
  var p = e.params || {}, K = T.kw, v = getAt(data, e.instancePath);
  switch (e.keyword) {
    case 'type': return fmt(K.type, { expected: Array.isArray(p.type) ? p.type.join(' | ') : p.type, actual: typeOf(v) });
    case 'required': return fmt(K.required, { name: p.missingProperty });
    case 'additionalProperties': return fmt(K.additionalProperties, { name: p.additionalProperty });
    case 'unevaluatedProperties': return fmt(K.unevaluatedProperties, { name: p.unevaluatedProperty });
    case 'unevaluatedItems': return fmt(K.unevaluatedItems, { limit: p.limit !== undefined ? p.limit : p.len, actual: Array.isArray(v) ? v.length : '?' });
    case 'additionalItems': case 'items': if (p.limit !== undefined) return fmt(K.items, { limit: p.limit, actual: Array.isArray(v) ? v.length : '?' }); break;
    case 'dependencies': case 'dependentRequired': return fmt(K.dependentRequired, { property: p.property, deps: String(p.deps).split(', ').map(function (d) { return '"' + d + '"'; }).join(', ') });
    case 'minimum': case 'maximum': case 'exclusiveMinimum': case 'exclusiveMaximum': return fmt(K.compare, { comparison: p.comparison === '>=' ? '≥' : p.comparison === '<=' ? '≤' : p.comparison, limit: p.limit, value: preview(v) });
    case 'multipleOf': return fmt(K.multipleOf, { multipleOf: p.multipleOf, value: preview(v) });
    case 'minLength': return fmt(K.minLength, { limit: p.limit, actual: typeof v === 'string' ? codePoints(v) : '?' });
    case 'maxLength': return fmt(K.maxLength, { limit: p.limit, actual: typeof v === 'string' ? codePoints(v) : '?' });
    case 'pattern': return fmt(K.pattern, { pattern: p.pattern });
    case 'format': return fmt(K.format, { format: p.format });
    case 'enum': return fmt(K.enum, { values: (p.allowedValues || []).map(function (x) { return preview(x, 40); }).join(', ') });
    case 'const': return fmt(K.const, { value: preview(p.allowedValue, 60) });
    case 'minItems': case 'maxItems': return fmt(K[e.keyword], { limit: p.limit, actual: Array.isArray(v) ? v.length : '?' });
    case 'minProperties': case 'maxProperties': return fmt(K[e.keyword], { limit: p.limit, actual: isObj(v) ? Object.keys(v).length : '?' });
    case 'uniqueItems': return fmt(K.uniqueItems, { j: Math.min(p.i, p.j), i: Math.max(p.i, p.j) });
    case 'contains': return p.maxContains !== undefined ? fmt(K.maxContains, { limit: p.maxContains }) : fmt(K.minContains, { limit: p.minContains !== undefined ? p.minContains : 1 });
    case 'propertyNames': return fmt(K.propertyNames, { name: p.propertyName });
    case 'oneOf': return p.passingSchemas ? fmt(K.oneOfMany, { branches: [].concat(p.passingSchemas).join(', ') }) : K.oneOfNone;
    case 'anyOf': return K.anyOf;
    case 'not': return K.not;
    case 'false schema': return K.falseSchema;
    case 'if': return fmt(K.if, { kw: p.failingKeyword });
  }
  return e.message || e.keyword;
}

/* Text-level helpers ------------------------------------------------------------------ */

// Called only after JSON.parse failed: finds the first error and names the usual causes
// (comments, trailing commas, single or curly quotes, full-width punctuation from an IME).
function jsonSyntaxError(text) {
  var i = 0, n = text.length;
  var SMART = '\u201c\u201d\u2018\u2019\u300c\u300d';
  var WIDE = '\u3000\uff1a\uff0c\uff5b\uff5d\uff3b\uff3d\uff02';
  function fail(code, at, ch) { throw { jsonErr: true, code: code, offset: at === undefined ? i : at, ch: ch }; }
  function special(c) {
    if (SMART.indexOf(c) >= 0) fail('smartQuote', i, c);
    if (WIDE.indexOf(c) >= 0) fail('fullWidth', i, c);
  }
  function ws() {
    while (i < n) {
      var c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) fail('comment');
      if (c === '#') fail('comment');
      break;
    }
  }
  var NUM = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  var WORD = /[A-Za-z_$][\w$]*/y;
  function str() {
    var s = i; i++;
    while (i < n) {
      var c = text.charCodeAt(i);
      if (c === 34) { i++; return; }
      if (c === 92) {
        var e = text[i + 1];
        if (e !== undefined && '"\\/bfnrt'.indexOf(e) >= 0) { i += 2; continue; }
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.substr(i + 2, 4))) { i += 6; continue; }
        fail('badEscape');
      }
      if (c < 0x20) fail('controlChar');
      i++;
    }
    fail('unterminatedString', s);
  }
  function num() {
    NUM.lastIndex = i;
    var m = NUM.exec(text);
    if (!m || m[0] === '-' || m[0] === '') fail('badNumber');
    i += m[0].length;
    if (i < n && /[0-9.eE]/.test(text[i])) fail('badNumber');
  }
  function startsValue(c) { return c === '{' || c === '[' || c === '"' || c === '-' || (c >= '0' && c <= '9') || c === 't' || c === 'f' || c === 'n'; }
  function value(depth) {
    if (depth > 3000) fail('unexpectedChar');
    ws();
    if (i >= n) fail('unexpectedEnd');
    var c = text[i];
    if (c === '{') return obj(depth);
    if (c === '[') return arr(depth);
    if (c === '"') return str();
    if (c === "'") fail('singleQuote');
    special(c);
    if (c === '-' || (c >= '0' && c <= '9')) return num();
    if (c === '+' || c === '.') fail('badNumber');
    WORD.lastIndex = i;
    var m = WORD.exec(text);
    if (m) {
      if (m[0] === 'true' || m[0] === 'false' || m[0] === 'null') { i += m[0].length; return; }
      if (m[0] === 'NaN' || m[0] === 'Infinity') fail('badNumber');
      fail('badLiteral');
    }
    fail('unexpectedChar', i, c);
  }
  function obj(depth) {
    i++; ws();
    if (text[i] === '}') { i++; return; }
    for (;;) {
      ws();
      if (i >= n) fail('unexpectedEnd');
      var c = text[i];
      if (c === "'") fail('singleQuote');
      special(c);
      if (c !== '"') { if (/[A-Za-z_$0-9]/.test(c)) fail('unquotedKey'); fail('unexpectedChar', i, c); }
      str(); ws();
      if (i >= n) fail('unexpectedEnd');
      if (text[i] !== ':') { special(text[i]); fail('missingColon'); }
      i++;
      value(depth + 1); ws();
      if (i >= n) fail('unexpectedEnd');
      c = text[i];
      if (c === ',') { var comma = i; i++; ws(); if (text[i] === '}') fail('trailingComma', comma); continue; }
      if (c === '}') { i++; return; }
      special(c);
      if (c === '"' || /[A-Za-z_$]/.test(c)) fail('missingComma');
      fail('unexpectedChar', i, c);
    }
  }
  function arr(depth) {
    i++; ws();
    if (text[i] === ']') { i++; return; }
    for (;;) {
      value(depth + 1); ws();
      if (i >= n) fail('unexpectedEnd');
      var c = text[i];
      if (c === ',') { var comma = i; i++; ws(); if (text[i] === ']') fail('trailingComma', comma); continue; }
      if (c === ']') { i++; return; }
      special(c);
      if (startsValue(c)) fail('missingComma');
      fail('unexpectedChar', i, c);
    }
  }
  try {
    ws();
    if (i >= n) return { code: 'empty', offset: 0 };
    value(0);
    ws();
    if (i < n) fail('extraData');
    return null;
  } catch (e) {
    if (e && e.jsonErr) return { code: e.code, offset: e.offset, ch: e.ch };
    throw e;
  }
}

/* Number precision. A literal is exact when the double JavaScript reads it as is the same
   decimal value: 0.1 and 1.0 are exact (String(0.1) is "0.1"); 9007199254740993,
   1.0000000000000001, 1e-400 and 1e400 are not. Distinct exact literals never collapse to the
   same double, so comparisons between them keep their order; an inexact one may not. */
function decimalKey(raw) {
  var m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!m || (m[2] === '' && !m[3])) return null;
  var frac = m[3] || '';
  var digits = (m[2] + frac).replace(/^0+/, '');
  if (!digits) return '0';
  var exp = (m[4] ? parseInt(m[4], 10) : 0) - frac.length;
  var len = digits.length;
  digits = digits.replace(/0+$/, '');
  exp += len - digits.length;
  return (m[1] === '-' ? '-' : '') + digits + 'e' + exp;
}
function isExactNumber(raw, num) {
  if (typeof num !== 'number' || !isFinite(num)) return false;
  if (/^-?(?:0|[1-9]\d{0,14})$/.test(raw)) return true;
  var s = String(raw).replace(/_/g, '');
  var r = /^([+-]?)0([xob])([0-9a-fA-F]+)$/.exec(s);
  if (r) {
    if (!Number.isInteger(num)) return false;
    var big = BigInt('0' + r[2] + r[3]);
    return (r[1] === '-' ? -big : big) === BigInt(num);
  }
  var a = decimalKey(s);
  return a !== null && a === decimalKey(String(num));
}

// One pass over text that JSON.parse accepted. Records the span of the values (and keys)
// asked for, duplicate keys (JSON.parse keeps the last) and numbers that are not exact.
function scanJson(text, want, wantKeys) {
  var res = { spans: {}, keys: {}, dups: [], unsafe: [], lossyCount: 0 };
  var i = 0, n = text.length;
  function ws() { while (i < n) { var c = text.charCodeAt(i); if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break; } }
  function strEnd() { i++; while (i < n) { var c = text.charCodeAt(i); if (c === 34) { i++; return; } i += c === 92 ? 2 : 1; } }
  function readKey(frame) {
    var ks = i; strEnd(); var ke = i;
    var key = JSON.parse(text.slice(ks, ke));
    if (frame.seen[key]) { if (res.dups.length < MAX_NOTES) res.dups.push({ path: frame.ptr, key: key, offset: ks }); }
    else frame.seen[key] = true;
    var kp = frame.ptr + '/' + escSeg(key);
    if (wantKeys && wantKeys[kp]) res.keys[kp] = [ks, ke];
    ws(); i++; ws();
    return kp;
  }
  var stack = [], cur = '';
  ws();
  for (;;) {
    ws();
    var start = i, c = text[i];
    if (c === '{' || c === '[') {
      i++; ws();
      var frame = { obj: c === '{', ptr: cur, n: 0, start: start, seen: c === '{' ? Object.create(null) : null };
      stack.push(frame);
      if (text[i] === (c === '{' ? '}' : ']')) { i++; stack.pop(); if (want && want[frame.ptr] !== undefined) res.spans[frame.ptr] = [start, i]; }
      else { cur = frame.obj ? readKey(frame) : frame.ptr + '/0'; continue; }
    } else {
      if (c === '"') strEnd();
      else {
        while (i < n) { var cc = text.charCodeAt(i); if (cc === 44 || cc === 93 || cc === 125 || cc === 32 || cc === 9 || cc === 10 || cc === 13) break; i++; }
        if (c === '-' || (c >= '0' && c <= '9')) {
          var raw = text.slice(start, i);
          var num = Number(raw);
          if (!isExactNumber(raw, num)) {
            res.lossyCount++;
            if (res.unsafe.length < MAX_NOTES) res.unsafe.push({ path: cur, raw: raw, parsed: String(num), offset: start });
          }
        }
      }
      if (want && want[cur] !== undefined) res.spans[cur] = [start, i];
    }
    // unwind
    for (;;) {
      if (!stack.length) return res;
      ws();
      var top = stack[stack.length - 1];
      if (text[i] === ',') {
        i++; ws(); top.n++;
        cur = top.obj ? readKey(top) : top.ptr + '/' + top.n;
        break;
      }
      i++;
      stack.pop();
      if (want && want[top.ptr] !== undefined) res.spans[top.ptr] = [top.start, i];
    }
  }
}

/* Text → documents. JSON first; text that starts with { [ or " must be JSON. Data whose
   lines each parse as JSON is JSON Lines. Otherwise YAML (core schema, so 2026-10-02 and
   yes stay strings); a YAML result that is only a scalar counts as a JSON error. */
function parseDocs(text, side, lib) {
  var notices = [], base = 0;
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); base = 1; notices.push({ code: 'bom', side: side }); }
  if (!text.trim()) return { format: 'empty', docs: [], notices: notices };
  try {
    return { format: 'json', docs: [{ value: JSON.parse(text), text: text, base: base, line: 1 }], notices: notices };
  } catch (e) { /* fall through */ }
  var syn = jsonSyntaxError(text) || { code: 'unexpectedChar', offset: 0 };
  var first = text.trimStart().charAt(0);
  if (side === 'data' && (first === '{' || first === '[')) {
    var lines = text.split('\n'), docs = [], off = 0, ok = true;
    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li].replace(/\r$/, '');
      if (raw.trim()) {
        try { docs.push({ value: JSON.parse(raw), text: raw, base: base + off, line: li + 1 }); } catch (e2) { ok = false; break; }
      }
      off += lines[li].length + 1;
    }
    if (ok && docs.length > 1) {
      notices.push({ code: 'jsonlRead', n: docs.length });
      return { format: 'jsonl', docs: docs, notices: notices };
    }
  }
  function jsonError() {
    var lc = lineCol(text, syn.offset);
    var code = syn.code === 'extraData' && side === 'data' ? 'extraDataJsonl' : syn.code;
    return { format: 'error', error: { code: code, ch: syn.ch, offset: base + syn.offset, line: lc.line, col: lc.col }, notices: notices };
  }
  if (first === '{' || first === '[' || first === '"') return jsonError();
  var vals = [], lossy = [];
  var ys = yamlSchema(lib.yaml);
  try {
    ys.sink = [];
    lib.yaml.loadAll(text, function (v) { vals.push(v); lossy.push(ys.sink); ys.sink = []; }, { schema: ys.schema });
  } catch (e3) {
    if (!/[:\n]/.test(text.trim())) return jsonError();
    var mark = e3 && e3.mark ? e3.mark : { line: 0, column: 0, position: 0 };
    return { format: 'error', error: { code: 'yaml', reason: e3.reason || e3.message, offset: base + (mark.position || 0), line: mark.line + 1, col: mark.column + 1 }, notices: notices };
  }
  var docs2 = vals.map(function (v, k) { return { value: v, text: null, base: base, line: null, lossy: lossy[k] }; });
  if (docs2.length > 1) docs2 = docs2.filter(function (x) { return x.value !== null && x.value !== undefined; });
  if (!docs2.some(function (x) { return x.value !== null && typeof x.value === 'object'; })) return jsonError();
  if (side === 'schema' && docs2.length > 1) return { format: 'error', error: { code: 'multiDocSchema', n: docs2.length, offset: base, line: 1, col: 1 }, notices: notices };
  notices.push({ code: 'yamlRead', side: side, n: docs2.length });
  docs2.forEach(function (x) {
    x.lossy.slice(0, MAX_NOTES).forEach(function (l) { notices.push({ code: 'lossyNumberYaml', side: side, raw: l.raw, parsed: l.parsed }); });
  });
  return { format: 'yaml', docs: docs2, notices: notices };
}

/* YAML 1.2 core schema (js-yaml CORE_SCHEMA) with the int and float types wrapped so the
   source text of every number that is not exact is recorded in `sink` (keys included: a key
   such as 9007199254740993 becomes the string "9007199254740992"). */
var yamlCache = null;
function yamlSchema(yaml) {
  if (yamlCache && yamlCache.lib === yaml) return yamlCache;
  var holder = { lib: yaml, sink: [], schema: null };
  function wrap(t) {
    // Type keeps styleAliases as { alias: style }; the constructor takes { style: [aliases] }
    var aliases = {};
    Object.keys(t.styleAliases || {}).forEach(function (a) { (aliases[t.styleAliases[a]] = aliases[t.styleAliases[a]] || []).push(a); });
    return new yaml.Type(t.tag, {
      kind: t.kind, resolve: t.resolve, predicate: t.predicate, represent: t.represent,
      defaultStyle: t.defaultStyle, styleAliases: aliases,
      construct: function (data) {
        var v = t.construct(data);
        if (!isExactNumber(data, v) && holder.sink.length < MAX_NOTES * 20) holder.sink.push({ raw: data, parsed: String(v) });
        return v;
      },
    });
  }
  holder.schema = yaml.FAILSAFE_SCHEMA.extend({ implicit: [yaml.types.null, yaml.types.bool, wrap(yaml.types.int), wrap(yaml.types.float)] });
  yamlCache = holder;
  return holder;
}

/* Referenced schemas: one or more documents (--- between them) or one JSON array of them. */
function parseExtras(text, lib) {
  if (!text || !text.trim()) return { docs: [] };
  var re = /^---[ \t]*\r?$/gm, parts = [], last = 0, m;
  while ((m = re.exec(text))) { parts.push([last, m.index]); last = m.index + m[0].length; }
  parts.push([last, text.length]);
  var docs = [], lossy = [];
  for (var i = 0; i < parts.length; i++) {
    var slice = text.slice(parts[i][0], parts[i][1]);
    if (!slice.trim()) continue;
    var r = parseDocs(slice, 'extras', lib);
    if (r.format === 'error') {
      r.error.offset += parts[i][0];
      r.error.line += lineCol(text, parts[i][0]).line - 1;
      return { error: r.error };
    }
    r.docs.forEach(function (d) {
      if (Array.isArray(d.value)) d.value.forEach(function (x) { docs.push(x); });
      else docs.push(d.value);
      var l = d.text !== null && d.text !== undefined ? scanJson(d.text, {}, null).unsafe : d.lossy || [];
      l.forEach(function (x) { lossy.push({ raw: x.raw, parsed: x.parsed, extra: true }); });
    });
  }
  return { docs: docs, lossy: lossy };
}

/* Reasons with the same code are shown once; `count` says how many there were. */
function dedupeReasons(list) {
  var out = [], byCode = {};
  list.forEach(function (r) {
    var k = r.code;
    if (byCode[k]) { byCode[k].count = (byCode[k].count || 1) + (r.count || 1); return; }
    var c = {};
    Object.keys(r).forEach(function (x) { c[x] = r[x]; });
    byCode[k] = c;
    out.push(c);
  });
  return out;
}

// True when some object in the value has a key that a "__proto__" schema entry would cover.
function hasProtoKey(value) {
  var stack = [value];
  while (stack.length) {
    var v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) stack.push(v[i]); continue; }
    var keys = Object.keys(v);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf('__proto__') >= 0) return true;
      stack.push(v[keys[j]]);
    }
  }
  return false;
}

/* One data value against a built validator: { state, valid, errors, reasons }. Used for every
   document and by the official test suite. */
function validateDoc(built, value) {
  if (built.stage === 'unknown') return { state: 'unknown', valid: null, errors: [], reasons: built.reasons };
  var reasons = [];
  if (built.facts && built.facts.proto && hasProtoKey(value)) reasons.push({ code: 'proto', path: built.facts.proto });
  if (reasons.length) return { state: 'unknown', valid: null, errors: [], reasons: reasons };
  var ok;
  try { ok = built.validate(value); } catch (e) {
    return { state: 'unknown', valid: null, errors: [], reasons: [{ code: 'validateError', message: String(e && e.message || e) }] };
  }
  return { state: ok ? 'valid' : 'invalid', valid: !!ok, errors: ok ? [] : (built.validate.errors || []).slice(), reasons: [] };
}

/* Schema (+ referenced schemas) → compiled validator or errors. */
function buildValidator(lib, input) {
  var det = detectDraft(input.schema, input.menu);
  var draft = det.draft;
  var unchecked = [];
  var attempt = function () {
    var ajv = createAjv(draft, lib, input.formats);
    unchecked.forEach(function (f) { ajv.addFormat(f, true); });
    var known = knownKeywords(ajv, draft);
    var notices = det.notices.slice();
    var prep = prepareSchema(input.schema, draft, known, { source: det.source });
    notices = notices.concat(prep.notices);
    var errors = prep.errors.slice(), ids = {};
    var allFacts = [prep.facts], extraInfo = [];
    // extraUris (tests only): the retrieval URI of each referenced schema, as Ajv's addSchema key
    var uris = input.extraUris || [];
    (input.extras || []).forEach(function (doc, i) {
      var id = isObj(doc) ? (typeof doc.$id === 'string' ? doc.$id : draft === '4' && typeof doc.id === 'string' ? doc.id : null) : null;
      if (uris[i]) id = uris[i];
      if (!id) { errors.push({ code: 'extraNoId', n: i + 1 }); return; }
      if (ids[id]) { errors.push({ code: 'extraDup', id: id }); return; }
      ids[id] = true;
      if (doc.$schema !== undefined) {
        var ed = draftOfUri(doc.$schema);
        if (!ed || ed.draft !== draft) { errors.push({ code: 'extraDraft', id: id, uri: doc.$schema, draft: draft }); return; }
      }
      var p = prepareSchema(doc, draft, known, { source: 'extra', base: id });
      var keys = [id, typeof doc.$id === 'string' ? doc.$id : null].filter(Boolean).map(function (k) {
        try { return new URL(k).href.replace(/#.*$/, ''); } catch (e) { return k.replace(/#.*$/, ''); }
      });
      extraInfo.push({ id: id, doc: doc, keys: keys, facts: p.facts, targets: p.targets });
      p.notices.forEach(function (x) { x.schemaId = id; notices.push(x); });
      p.errors.forEach(function (x) { x.schemaId = id; errors.push(x); });
      if (!ajv.validateSchema(p.schema)) { errors = errors.concat(metaErrors(ajv.errors, id, draft, p.schema)); return; }
      try { ajv.addSchema(p.schema, uris[i] || undefined); } catch (e) { errors.push({ code: 'compile', message: e.message, schemaId: id }); }
    });
    if (errors.length) return { ok: false, stage: 'schema', draft: draft, notices: notices, errors: errors };
    if (!ajv.validateSchema(prep.schema)) return { ok: false, stage: 'meta', draft: draft, notices: notices, errors: metaErrors(ajv.errors, null, draft, prep.schema) };
    // Only the referenced schemas that the schema reaches through $ref count; pasting an unused
    // schema with $dynamicRef does not change the result.
    var reach = prep.targets.slice(), used = [];
    for (var qi = 0; qi < reach.length; qi++) {
      var tgt = reach[qi];
      extraInfo.forEach(function (x) {
        if (used.indexOf(x) >= 0) return;
        var hit = x.keys.some(function (k) { return k === tgt || (tgt.indexOf('rel:') === 0 && (k === tgt.slice(4) || k.slice(-tgt.length + 3) === '/' + tgt.slice(4))); });
        if (!hit) return;
        used.push(x);
        allFacts.push(x.facts);
        x.targets.forEach(function (t2) { if (reach.indexOf(t2) < 0) reach.push(t2); });
      });
    }
    var support = unsupportedOf(allFacts, draft, input.schema, extraInfo);
    var reasons = support.reasons.slice();
    (input.lossy || []).forEach(function (x) { if (reasons.length < MAX_NOTES) reasons.push({ code: 'lossySchema', raw: x.raw, parsed: x.parsed, schemaId: x.schemaId }); });
    var done = function (fn) {
      if (unchecked.length) notices.push({ code: 'formatUnchecked', formats: unchecked.map(function (f) { return '"' + f + '"'; }).join(', ') });
      if (input.formats === false) notices.push({ code: 'formatOff' });
      var out = { ok: !reasons.length, draft: draft, notices: notices, root: prep.schema, ids: Object.keys(ids), facts: support.facts };
      if (reasons.length) { out.stage = 'unknown'; out.reasons = dedupeReasons(reasons); } else out.validate = fn;
      return out;
    };
    try {
      return done(ajv.compile(prep.schema));
    } catch (e) {
      // Ajv overflows the stack on some nested $id + relative $ref graphs (a valid schema)
      if (e instanceof RangeError || /Maximum call stack size exceeded|too much recursion/.test(e && e.message || '')) {
        reasons.unshift({ code: 'refOverflow' });
        return done(null);
      }
      var m = /^unknown format "(.+)" ignored in schema/.exec(e && e.message || '');
      if (m && unchecked.indexOf(m[1]) < 0 && unchecked.length < 100) { unchecked.push(m[1]); return null; }
      if (e && typeof e === 'object' && 'missingRef' in e) {
        var rm = /can't resolve reference (.+) from id/.exec(e.message || '');
        var raw = rm ? rm[1] : e.missingRef;
        var where = prep.refs.filter(function (r) { return r.ref === raw; })[0];
        var local = !e.missingSchema || raw.charAt(0) === '#';
        // a schema URL that was not pasted is a real gap; a local miss may be the Ajv limitation
        if (!(local && reasons.length)) return { ok: false, stage: 'schema', draft: draft, notices: notices, errors: [{ code: local ? 'missingLocal' : 'missingRef', ref: raw, id: e.missingSchema || raw, path: where ? where.path : '#' }] };
      }
      // Ajv refuses some valid schemas in the cases listed in `reasons` ("$dynamicRef" only
      // supports hash fragment reference): the result stays "cannot be determined".
      if (reasons.length) return done(null);
      return { ok: false, stage: 'schema', draft: draft, notices: notices, errors: [{ code: 'compile', message: String(e && e.message || e) }] };
    }
  };
  var r = null;
  for (var tries = 0; r === null && tries < 101; tries++) r = attempt();
  return r;
}
function metaErrors(raw, schemaId, draft, root) {
  var out = [];
  nestErrors(raw, undefined).forEach(function (node) {
    var e = node.e;
    if (node.branches && node.closest !== null && node.closest !== undefined) {
      var br = node.branches.filter(function (b) { return b.index === node.closest; })[0];
      if (br && br.nodes.length) e = br.nodes[0].e;
    }
    out.push({ code: 'meta', path: '#' + node.e.instancePath, error: e, root: root, schemaId: schemaId, itemsArray: draft === '2020-12' && /\/items$/.test(node.e.instancePath) && Array.isArray(getAt(root, node.e.instancePath)) });
  });
  var seen = {};
  return out.filter(function (x) { var k = x.path + '|' + (x.error && x.error.keyword); if (seen[k]) return false; seen[k] = true; return true; });
}

/* Messages for the notices and schema errors above. */
function noticeText(n, T) {
  var N = T.notice;
  var p = {};
  Object.keys(n).forEach(function (k) { p[k] = n[k]; });
  if (p.draft) p.draft = DRAFT_NAMES[p.draft] || p.draft;
  if (p.schemaDraft) p.schemaDraft = DRAFT_NAMES[p.schemaDraft] || p.schemaDraft;
  if (p.side) p.side = p.side === 'schema' || p.side === 'extras' ? N.sideSchema : N.sideData;
  if (p.path === '') p.path = T.root;
  var s = fmt(N[n.code] || n.code, p);
  if ((n.code === 'unknownKeyword' || n.code === 'unknownKeywordMany') && n.suggestion) s += ' ' + fmt(N.suggestion, { suggestion: n.suggestion });
  if (n.schemaId) s = '[' + n.schemaId + '] ' + s;
  return s;
}
function schemaErrorText(err, T) {
  var p = {};
  Object.keys(err).forEach(function (k) { p[k] = err[k]; });
  if (p.draft) p.draft = DRAFT_NAMES[p.draft] || p.draft;
  var s;
  if (err.code === 'meta') {
    s = (err.path === '#' ? T.root : err.path) + ': ' + describe(err.error, err.root, T);
    if (err.itemsArray) s += ' — ' + fmt(T.schemaErr.itemsArray, { draft: DRAFT_NAMES['2020-12'] });
  } else s = fmt(T.schemaErr[err.code] || err.code, p);
  if (err.schemaId) s = '[' + err.schemaId + '] ' + s;
  return s;
}
function parseErrorText(err, T) {
  // js-yaml stops at 100 levels of nesting (yaml-limits.js); CORE_SCHEMA has no merge keys, so that is the only work limit here
  var depth = err.code === 'yaml' && /^nesting exceeded maxDepth \((\d+)\)$/.exec(err.reason || '');
  var reason = err.code === 'yaml' ? fmt(T.parse.yaml, { reason: depth ? fmt(T.parse.yamlDepth, { n: depth[1] }) : err.reason }) : fmt(T.parse[err.code] || T.parse.unexpectedChar, { ch: err.ch !== undefined ? JSON.stringify(err.ch) : '', n: err.n });
  return fmt(T.parse.at, { line: err.line, col: err.col, reason: reason });
}

/* Whole run: texts in, a plain result model out (also used by the test).
   res.state: empty | schemaParse | dataParse | extrasParse | schemaInvalid | schemaFail |
   valid | invalid | unknown. A data set is invalid when one document is invalid, unknown when
   none is invalid and one cannot be determined, valid only when every document is valid. */
function runValidation(lib, input, T, cache) {
  var res = { state: 'empty', notices: [], docs: [], draft: null, reasons: [] };
  var s = parseDocs(input.schemaText || '', 'schema', lib);
  var d = parseDocs(input.dataText || '', 'data', lib);
  res.schemaFormat = s.format; res.dataFormat = d.format;
  res.notices = s.notices.concat(d.notices);
  if (s.format === 'error') { res.state = 'schemaParse'; res.parseError = s.error; res.side = 'schema'; return res; }
  if (d.format === 'error') { res.state = 'dataParse'; res.parseError = d.error; res.side = 'data'; return res; }
  var ex = parseExtras(input.extrasText || '', lib);
  if (ex.error) { res.state = 'extrasParse'; res.parseError = ex.error; res.side = 'extras'; return res; }
  if (s.format === 'empty' || d.format === 'empty') return res;
  var schemaScan = s.format === 'json' ? scanJson(s.docs[0].text, {}, null) : null;
  var key = [input.menu, input.formats, input.schemaText, input.extrasText].join('\u0000');
  var built = cache && cache.key === key ? cache.built : null;
  if (!built) {
    var lossy = (schemaScan ? schemaScan.unsafe : s.docs[0].lossy || []).concat(ex.lossy || []);
    built = buildValidator(lib, { schema: s.docs[0].value, menu: input.menu, formats: input.formats, extras: ex.docs, lossy: lossy });
  }
  if (cache) { cache.key = key; cache.built = built; }
  res.draft = built.draft;
  res.notices = res.notices.concat(built.notices);
  if (schemaScan) docNotices(schemaScan, s.docs[0], 'schema', res.notices, T);
  if (!built.ok && built.stage !== 'unknown') {
    res.state = built.stage === 'meta' ? 'schemaInvalid' : 'schemaFail'; res.schemaErrors = built.errors; locateSchema(res.schemaErrors, s); return res;
  }
  var bad = 0, unknown = 0, total = 0, locations = 0, docReasons = [];
  d.docs.forEach(function (doc, di) {
    var hasText = doc.text !== null && doc.text !== undefined;
    var sc = hasText ? scanJson(doc.text, {}, null) : null;
    if (sc) docNotices(sc, doc, 'data', res.notices, T);
    var r;
    var lossyN = sc ? sc.lossyCount : (doc.lossy || []).length;
    // A YAML key can be a number, so an inexact YAML number may also change a property name.
    if (built.stage !== 'unknown' && lossyN && (!hasText || (built.facts && built.facts.numeric))) {
      var first = sc ? sc.unsafe[0] : doc.lossy[0];
      r = { state: 'unknown', valid: null, errors: [], reasons: [{ code: 'lossyData', raw: first.raw, parsed: first.parsed }] };
    } else r = validateDoc(built, doc.value);
    var groups = [];
    if (r.state === 'invalid') {
      bad++;
      groups = groupNodes(nestErrors(r.errors, built.root), doc, T, s, built.ids);
      groups.forEach(function (g) { total += g.count; });
      locations += groups.length;
      if (hasText) placeGroups(doc, groups);
    } else if (r.state === 'unknown') {
      unknown++;
      if (built.stage !== 'unknown') docReasons = docReasons.concat(r.reasons);
    }
    res.docs.push({ index: di, line: doc.line, state: r.state, valid: r.valid, groups: groups, raw: r.errors, reasons: r.reasons.map(function (x) { return x.code; }) });
  });
  res.reasons = built.stage === 'unknown' ? built.reasons : dedupeReasons(docReasons);
  res.state = bad ? 'invalid' : unknown ? 'unknown' : 'valid';
  res.bad = bad; res.unknown = unknown; res.errorCount = total; res.locations = locations;
  if (s.format === 'json') res.schemaRanges = schemaRangesOf(res, s.docs[0]);
  return res;
}
// Duplicate keys and inexact numbers found by scanJson, as notices with their line.
function docNotices(sc, doc, side, notices, T) {
  sc.dups.forEach(function (x) {
    var lc = lineCol(doc.text, x.offset);
    notices.push({ code: 'dupKey', side: side, path: x.path === '' ? T.root : x.path, key: x.key, line: lc.line + (doc.line || 1) - 1, offset: doc.base + x.offset, len: JSON.stringify(x.key).length });
  });
  sc.unsafe.forEach(function (x) {
    var lc = lineCol(doc.text, x.offset);
    notices.push({ code: 'lossyNumber', side: side, path: x.path === '' ? T.root : x.path, raw: x.raw, parsed: x.parsed, line: lc.line + (doc.line || 1) - 1, offset: doc.base + x.offset, len: x.raw.length });
  });
}
// Lines, columns and text ranges of the error locations (a second scan, only for invalid documents).
function placeGroups(doc, groups) {
  var want = {}, wantKeys = {};
  groups.forEach(function (g) {
    want[g.path] = 0;
    g.items.forEach(function walkItem(it) {
      want[it.path] = 0;
      if (it.keyPath) wantKeys[it.keyPath] = 1;
      (it.branches || []).forEach(function (b) { b.items.forEach(walkItem); });
    });
  });
  var sc = scanJson(doc.text, want, wantKeys);
  groups.forEach(function (g) {
    function place(it) {
      var span = it.keyPath && sc.keys[it.keyPath] ? sc.keys[it.keyPath] : sc.spans[it.path];
      if (span) {
        var lc = lineCol(doc.text, span[0]);
        it.range = [doc.base + span[0], doc.base + span[1]];
        it.line = lc.line + (doc.line || 1) - 1; it.col = lc.col;
      }
      (it.branches || []).forEach(function (b) { b.items.forEach(place); });
    }
    g.items.forEach(place);
    var gs = sc.spans[g.path];
    if (gs) { var glc = lineCol(doc.text, gs[0]); g.line = glc.line + (doc.line || 1) - 1; g.col = glc.col; g.range = [doc.base + gs[0], doc.base + gs[1]]; }
  });
  groups.sort(function (a, b) { return (a.range ? a.range[0] : Infinity) - (b.range ? b.range[0] : Infinity); });
}
// Text ranges in the schema box for the "schema #/…" links of the errors.
function schemaRangesOf(res, schemaDoc) {
  var want = {};
  var walk = function (it) { if (it.schemaPtr !== undefined) want[it.schemaPtr] = 0; (it.branches || []).forEach(function (b) { b.items.forEach(walk); }); };
  res.docs.forEach(function (d) { d.groups.forEach(function (g) { g.items.forEach(walk); }); });
  if (!Object.keys(want).length) return {};
  var sc = scanJson(schemaDoc.text, want, null);
  var out = {};
  Object.keys(sc.spans).forEach(function (k) { out[k] = [sc.spans[k][0] + schemaDoc.base, sc.spans[k][1] + schemaDoc.base]; });
  return out;
}
function locateSchema(errors, s) {
  if (s.format !== 'json') return;
  var want = {};
  errors.forEach(function (e) { if (!e.schemaId && e.path && e.path.charAt(0) === '#') want[e.path.slice(1)] = 0; });
  var sc = scanJson(s.docs[0].text, want, null);
  errors.forEach(function (e) {
    var sp = !e.schemaId && e.path ? sc.spans[e.path.slice(1)] : null;
    if (sp) { e.range = [s.docs[0].base + sp[0], s.docs[0].base + sp[1]]; e.line = lineCol(s.docs[0].text, sp[0]).line; }
  });
}
// Ajv writes the schema path of an error inside a referenced schema as "<$id>/properties/…";
// shown as "<$id>#/properties/…".
function schemaPathOf(sp, ids) {
  if (!sp || sp.charAt(0) === '#' || sp.indexOf('#') >= 0) return sp;
  var best = '';
  (ids || []).forEach(function (id) { var base = id.replace(/#$/, ''); if ((sp === base || sp.indexOf(base + '/') === 0) && base.length > best.length) best = base; });
  return best ? best + '#' + sp.slice(best.length) : sp;
}
function itemOf(node, data, T, schemaDoc, ids) {
  var e = node.e, p = e.params || {};
  var name = e.keyword === 'additionalProperties' ? p.additionalProperty : e.keyword === 'unevaluatedProperties' ? p.unevaluatedProperty : e.keyword === 'propertyNames' ? p.propertyName : null;
  var it = {
    keyword: e.keyword, path: e.instancePath, schemaPath: schemaPathOf(e.schemaPath, ids),
    message: describe(e, data, T), via: node.via || null,
    keyPath: name !== null && name !== undefined ? e.instancePath + '/' + escSeg(name) : null,
  };
  if (schemaDoc && schemaDoc.format === 'json' && e.schemaPath.indexOf('#/') === 0) it.schemaPtr = e.schemaPath.slice(1);
  else if (e.schemaPath === '#') it.schemaPtr = '';
  var v = getAt(data, e.instancePath);
  if (v !== undefined && ['required', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'dependentRequired', 'dependencies', 'oneOf', 'anyOf', 'not', 'if', 'minProperties', 'maxProperties', 'minItems', 'maxItems', 'unevaluatedItems', 'items', 'additionalItems', 'uniqueItems', 'contains'].indexOf(e.keyword) < 0) it.value = preview(v);
  if (node.branches) {
    it.closest = node.closest;
    it.branches = node.branches.map(function (b) { return { index: b.index, items: b.nodes.map(function (x) { return itemOf(x, data, T, schemaDoc, ids); }) }; });
  }
  return it;
}
function groupNodes(tree, doc, T, schemaDoc, ids) {
  var groups = [], byPath = {};
  tree.forEach(function (node) {
    var path = node.e.instancePath;
    var g = byPath[path];
    if (!g) { g = byPath[path] = { path: path, items: [], count: 0 }; groups.push(g); }
    g.items.push(itemOf(node, doc.value, T, schemaDoc, ids));
    g.count++;
  });
  return groups;
}

/* Status line, plain-text and JSON reports (status bar, copy buttons, page examples). */
function statusText(res, T) {
  var draft = res.draft ? DRAFT_NAMES[res.draft] : '';
  var n = res.docs.length;
  switch (res.state) {
    case 'empty': return T.empty;
    case 'schemaParse': case 'dataParse': case 'extrasParse': return T[res.state];
    case 'schemaInvalid': case 'schemaFail': return fmt(T[res.state], { draft: draft });
    case 'valid': return n > 1 ? fmt(T.validDocs, { n: n, draft: draft }) : fmt(T.valid, { draft: draft });
    case 'unknown':
      if (n <= 1) return fmt(T.unknownOne, { draft: draft });
      return res.unknown === n ? fmt(T.unknownAll, { n: n, draft: draft }) : fmt(T.unknownDocs, { u: res.unknown, n: n, ok: n - res.unknown, draft: draft });
  }
  if (n > 1) return res.unknown ? fmt(T.invalidDocsUnknown, { bad: res.bad, u: res.unknown, n: n, draft: draft }) : fmt(T.invalidDocs, { bad: res.bad, n: n, draft: draft });
  return res.errorCount === 1 ? fmt(T.invalidOne, { draft: draft }) : fmt(T.invalidMany, { n: res.errorCount, locations: res.locations, draft: draft });
}
function reasonText(r, T) {
  var p = {};
  Object.keys(r).forEach(function (k) { p[k] = r[k]; });
  if (r.code === 'unevaluated') p.combo = T.reason['combo_' + r.combo] || r.combo;
  var s = fmt(T.reason[r.code] || r.code, p);
  if (r.count > 1) s += ' ' + fmt(T.reasonMore, { n: r.count - 1 });
  if (r.schemaId) s = '[' + r.schemaId + '] ' + s;
  return s;
}
function reportText(res, T) {
  var lines = [];
  if (res.parseError) lines.push(parseErrorText(res.parseError, T));
  (res.schemaErrors || []).forEach(function (e) { lines.push(schemaErrorText(e, T)); });
  if (res.reasons && res.reasons.length) {
    lines.push(T.reasonsTitle);
    res.reasons.forEach(function (r) { lines.push('- ' + reasonText(r, T)); });
  }
  function itemLines(it, indent) {
    var loc = (it.path === '' ? T.root : it.path) + (it.line ? ' (' + fmt(T.lineCol, { line: it.line, col: it.col }) + ')' : '');
    lines.push(indent + loc + ': ' + it.message + (it.via ? ' [' + fmt(T.via, { kw: it.via }) + ']' : '') + (it.schemaPath ? '  ' + fmt(T.schemaAt, { path: it.schemaPath }) : ''));
    (it.branches || []).forEach(function (b) {
      lines.push(indent + '  ' + fmt(T.branch, { n: b.index + 1 }) + (b.index === it.closest ? ' *' : ''));
      b.items.forEach(function (x) { itemLines(x, indent + '    '); });
    });
  }
  res.docs.forEach(function (doc) {
    var state = doc.state || (doc.valid ? 'valid' : 'invalid');
    if (res.docs.length > 1) lines.push(fmt(doc.line ? T.docLine : T.docLabel, { n: doc.index + 1, line: doc.line }) + (state === 'valid' ? ': ' + T.docValid : state === 'unknown' ? ': ' + T.unknown : ''));
    else if (state === 'unknown' && !(res.reasons && res.reasons.length)) lines.push(T.unknown);
    doc.groups.forEach(function (g) { g.items.forEach(function (it) { itemLines(it, res.docs.length > 1 ? '  ' : ''); }); });
  });
  return lines.join('\n');
}
// Ajv's own error objects (English messages), one entry per data document, with its state:
// "valid", "invalid" or "unknown" (valid: null, no errors, and the reasons in the page language).
function reportJson(res, T) {
  var byCode = {};
  (res.reasons || []).forEach(function (r) { byCode[r.code] = r; });
  return JSON.stringify(res.docs.map(function (d) {
    var state = d.state || (d.valid ? 'valid' : 'invalid');
    var o = { document: d.index + 1, state: state, valid: state === 'unknown' ? null : d.valid };
    if (state === 'unknown') {
      o.reasons = (d.reasons || []).map(function (code) { var r = byCode[code] || { code: code }; return T ? { code: code, message: reasonText(r, T) } : { code: code }; });
    }
    o.errors = (d.raw || []).map(function (e) { return { instancePath: e.instancePath, schemaPath: e.schemaPath, keyword: e.keyword, params: e.params, message: e.message }; });
    return o;
  }), null, 2);
}

export {
  DRAFTS, DEFAULT_DRAFT, META_URIS, DRAFT_NAMES, ASSERTED_FORMATS, fmt, getAt, lineCol, codePoints,
  draftOfUri, detectDraft, createAjv, knownKeywords, prepareSchema, unsupportedOf, nestErrors, describe,
  jsonSyntaxError, scanJson, decimalKey, isExactNumber, parseDocs, parseExtras, buildValidator, validateDoc,
  hasProtoKey, runValidation, noticeText, schemaErrorText, parseErrorText, statusText, reasonText,
  reportText, reportJson,
};
