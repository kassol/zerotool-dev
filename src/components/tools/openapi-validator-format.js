// OpenAPI Validator — the small part the page itself needs: choosing the main file among
// several and formatting a problem in the page language. Kept apart from
// openapi-validator-engine.js so the page script does not load the engine (it runs in the worker).

/* Picks the root among several files: the one that has a top-level `openapi` or `swagger` key;
   with several, prefer a name like openapi.* / swagger.* / api.*, then the shortest path. */
export function pickRoot(files) {
  var names = Object.keys(files);
  var roots = names.filter(function (n) { return /^\s*["']?(openapi|swagger)["']?\s*:/m.test(files[n].slice(0, 4096)); });
  if (!roots.length) return names[0] || null;
  roots.sort(function (a, b) {
    var pa = /(^|\/)(openapi|swagger|api)\.[a-z]+$/i.test(a) ? 0 : 1;
    var pb = /(^|\/)(openapi|swagger|api)\.[a-z]+$/i.test(b) ? 0 : 1;
    return pa - pb || a.split('/').length - b.split('/').length || a.length - b.length || (a < b ? -1 : 1);
  });
  return roots[0];
}

/* Message formatting: T.msg[code] with {name} placeholders; `detail` is a nested message. */
export function formatMessage(p, T) {
  var tpl = (T.msg && T.msg[p.code]) || p.code;
  var args = p.args || {};
  return tpl.replace(/\{(\w+)\}/g, function (_m, k) {
    var v = args[k];
    if (k === 'detail' && v && typeof v === 'object') return formatMessage(v, T);
    if (k === 'reason') return (T.yamlReasons && T.yamlReasons[v]) || v;
    if (k === 'kind' && T.kinds && T.kinds[v]) return T.kinds[v];
    if (k === 'where') return v ? (T.msg.atPath || ' ({path})').replace('{path}', v) : '';
    if (k === 'more') return v && v !== '0' ? (T.msg.moreErrors || ' (+{n})').replace('{n}', v) : '';
    return v === undefined ? '' : String(v);
  });
}
