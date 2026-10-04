// OpenAPI Validator — the small part the page itself needs: choosing the main file among
// several and formatting a problem in the page language. Kept apart from
// openapi-validator-engine.js so the page script does not load the engine (it runs in the worker).

import jsyaml from 'js-yaml';

const rootSchema = jsyaml.CORE_SCHEMA.extend({ implicit: [jsyaml.types.merge] });
const hasVersion = (value) => value && typeof value === 'object' && !Array.isArray(value) &&
  (Object.hasOwn(value, 'openapi') || Object.hasOwn(value, 'swagger'));

function hasYamlRootKey(text) {
  var starts = [], candidateEnd = 0, complete = false, root = null;
  var stop = {};
  try {
    jsyaml.load(text, { schema: rootSchema, listener: function (event, state) {
      if (event === 'open') { starts.push(state.position); return; }
      // Flow roots have an extra speculative node at the same starting position.
      if (!candidateEnd && starts.length > 1 && starts.slice(0, -1).every(function (p) { return p === starts[0]; }) &&
          (state.result === 'openapi' || state.result === 'swagger')) {
        var colon = /^\s*:/.exec(text.slice(state.position));
        if (colon) candidateEnd = state.position + colon[0].length;
      }
      starts.pop();
      if (!starts.length) { complete = true; root = state.result; throw stop; }
    } });
  } catch (_e) { /* A truncated prefix can still contain a complete root key. */ }
  if (complete) return hasVersion(root);
  if (candidateEnd) {
    // Confirm the candidate's root with the parser, including block and flow mappings.
    // A neutral value completes the key even when the original value is truncated.
    for (var suffix of [' null', ' null}']) {
      try { if (hasVersion(jsyaml.load(text.slice(0, candidateEnd) + suffix, { schema: rootSchema }))) return true; }
      catch (_e) { /* Try the flow-mapping close after the block-mapping form. */ }
    }
  }
  return false;
}

function hasJsonRootKey(text) {
  // Scan the bounded JSON prefix without parsing the full document. Only root keys count.
  var depth = 0, key = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (c === '"') {
      var start = i++;
      for (; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') break;
      }
      if (i >= text.length) return false;
      if (depth === 1 && key) {
        var end = i + 1;
        while (end < text.length && /\s/.test(text[end])) end++;
        if (text[end] === ':') {
          try {
            var name = JSON.parse(text.slice(start, i + 1));
            if (name === 'openapi' || name === 'swagger') return true;
          } catch (_e) { return false; }
        }
        key = false;
      }
    } else if (c === '{' || c === '[') {
      depth++;
      if (depth === 1) key = true;
    } else if (c === '}' || c === ']') {
      if (--depth === 0) return false;
    } else if (c === ',' && depth === 1) key = true;
  }
  return false;
}

/* Picks the root among several files: the one that has a top-level `openapi` or `swagger` key;
   with several, prefer a name like openapi.* / swagger.* / api.*, then the shortest path. */
export function pickRoot(files) {
  var names = Object.keys(files);
  var roots = names.filter(function (n) {
    var text = files[n].slice(0, 4096);
    return /^\s*\{\s*"/.test(text) && hasJsonRootKey(text.trimStart()) || hasYamlRootKey(text);
  });
  if (!roots.length) return names[0] || null;
  roots.sort(function (a, b) {
    var pa = /(^|\/)(openapi|swagger|api)\.[a-z]+$/i.test(a) ? 0 : 1;
    var pb = /(^|\/)(openapi|swagger|api)\.[a-z]+$/i.test(b) ? 0 : 1;
    return pa - pb || a.split('/').length - b.split('/').length || a.length - b.length || (a < b ? -1 : 1);
  });
  return roots[0];
}

/* A js-yaml reason in the page language. Keys with {n} (the work limits, such as
   "nesting exceeded maxDepth ({n})") match the same text with any number in that place. */
function yamlReason(v, T) {
  var table = T.yamlReasons || {};
  if (Object.prototype.hasOwnProperty.call(table, v)) return table[v];
  for (var key in table) {
    if (key.indexOf('{n}') < 0) continue;
    var parts = key.split('{n}').map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    var m = new RegExp('^' + parts.join('(\\d+)') + '$').exec(String(v));
    if (m) return table[key].replace('{n}', m[1]);
  }
  return v;
}

/* Message formatting: T.msg[code] with {name} placeholders; `detail` is a nested message. */
export function formatMessage(p, T) {
  var tpl = (T.msg && T.msg[p.code]) || p.code;
  var args = p.args || {};
  return tpl.replace(/\{(\w+)\}/g, function (_m, k) {
    var v = args[k];
    if (k === 'detail' && v && typeof v === 'object') return formatMessage(v, T);
    if (k === 'reason') return yamlReason(v, T);
    if (k === 'kind' && T.kinds && T.kinds[v]) return T.kinds[v];
    if (k === 'where') return v ? (T.msg.atPath || ' ({path})').replace('{path}', v) : '';
    if (k === 'more') return v && v !== '0' ? (T.msg.moreErrors || ' (+{n})').replace('{n}', v) : '';
    return v === undefined ? '' : String(v);
  });
}
