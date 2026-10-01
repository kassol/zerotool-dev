// CSP Header Generator — the Strict preset no longer outputs a policy that blocks every script
//
// Read:  src/components/tools/CspHeaderGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
//   - Strict preset follows web.dev "Strict CSP" (nonce-based): script-src 'nonce-{RANDOM}'
//     'strict-dynamic', object-src 'none'. Before the fix it was `script-src 'self'
//     'strict-dynamic'` with no nonce or hash; CSP3 §6.7.1.1 blocks every parser-inserted
//     script and §6.7.3.3 every inline script in that case, so the page ran no script and the
//     tool showed no warning.
//   - The `{RANDOM}` placeholder does not match the CSP3 nonce-source grammar
//     (base64-value = 1*( ALPHA / DIGIT / "+" / "/" / "-" / "_" )*2( "=" )), so it always
//     produces a warning that the server must replace it per response.
//   - 'strict-dynamic' without a nonce / hash in script-src (or in default-src when script-src
//     is absent) is a warning; with a nonce or hash it is not; a malformed nonce is a warning.
//   - <meta> output drops report-uri, frame-ancestors and sandbox only (CSP3 §3.3); report-to
//     stays.
//   - Express output generates a fresh nonce per response with helmet's function-directive
//     form; the generated code is executed with a stub `require` / `app` and the directive
//     functions produce a valid nonce-source for two requests with different nonces.
//   - 4 language STRINGS have the same keys; tool pages no longer describe the old preset.
//
// Run: node scripts/test-csp-header-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CspHeaderGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CspHeaderGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) +
  '\nreturn { STRINGS, PRESETS, PRESET_FLAGS, NONCE_PLACEHOLDER, buildPolicy, buildOutput, validatePolicy };')();
const T = E.STRINGS.en;

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function stateFor(preset, extra) {
  const directives = {};
  for (const [k, v] of Object.entries(E.PRESETS[preset])) directives[k] = v.slice();
  return Object.assign({ mode: 'enforce', upgrade: !!E.PRESET_FLAGS[preset].upgrade, block: false, directives }, extra || {});
}
const keys = (state) => E.validatePolicy(state).map((w) => w.key);

// CSP3 nonce-source grammar
const NONCE_RE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
const HASH_RE = /^'sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}'$/;

// ── 1. Strict preset ──
{
  const s = stateFor('strict');
  const scriptSrc = s.directives['script-src'];
  check('strict script-src has a nonce placeholder', scriptSrc.includes(E.NONCE_PLACEHOLDER), JSON.stringify(scriptSrc));
  check("strict script-src keeps 'strict-dynamic'", scriptSrc.includes("'strict-dynamic'"));
  eq('strict object-src', s.directives['object-src'], ["'none'"]);
  check('strict base-uri is set', Array.isArray(s.directives['base-uri']) && s.directives['base-uri'].length > 0);
  eq('placeholder text', E.NONCE_PLACEHOLDER, "'nonce-{RANDOM}'");
  check('placeholder is not a valid nonce-source (browsers would ignore it)', !NONCE_RE.test(E.NONCE_PLACEHOLDER));
  const k = keys(s);
  check('strict preset warns that the placeholder must be replaced per response', k.includes('warnNoncePlaceholder'), JSON.stringify(k));
  check('strict preset with placeholder is not reported as nonce-less', !k.includes('warnStrictDynamicNoNonce'), JSON.stringify(k));
  const header = E.buildOutput(s, 'header', T);
  check('header output contains the placeholder', header.includes("script-src 'nonce-{RANDOM}' 'strict-dynamic'"), header);
}

// ── 2. the old preset (persisted state from before the fix) ──
{
  const s = stateFor('strict');
  s.directives['script-src'] = ["'self'", "'strict-dynamic'"];
  const w = E.validatePolicy(s);
  const hit = w.find((x) => x.key === 'warnStrictDynamicNoNonce');
  check("'self' 'strict-dynamic' without nonce is a warning", hit && hit.level === 'warn' && hit.directive === 'script-src', JSON.stringify(w));
  check('the warning text mentions that scripts are blocked', /block/i.test(T.warnStrictDynamicNoNonce));
}
{
  const s = { mode: 'enforce', upgrade: false, block: false, directives: { 'default-src': ["'self'", "'strict-dynamic'"] } };
  check('default-src strict-dynamic without script-src and nonce warns', keys(s).includes('warnStrictDynamicNoNonce'));
  s.directives['script-src'] = ["'self'"];
  check('default-src strict-dynamic is ignored once script-src exists', !keys(s).includes('warnStrictDynamicNoNonce'));
}
for (const src of ["'nonce-" + randomBytes(16).toString('base64') + "'", "'sha256-" + randomBytes(32).toString('base64') + "'"]) {
  const s = stateFor('strict');
  s.directives['script-src'] = [src, "'strict-dynamic'"];
  const k = keys(s);
  check('strict-dynamic with ' + src.slice(1, 6) + ' source has no nonce warnings', !k.includes('warnStrictDynamicNoNonce') && !k.includes('warnNoncePlaceholder') && !k.includes('warnNonceInvalid'), JSON.stringify(k));
}
{
  const s = stateFor('strict');
  s.directives['script-src'] = ["'nonce-abc$def'", "'strict-dynamic'"];
  const k = keys(s);
  check('malformed nonce is reported', k.includes('warnNonceInvalid'), JSON.stringify(k));
  check('malformed nonce counts as no nonce for strict-dynamic', k.includes('warnStrictDynamicNoNonce'), JSON.stringify(k));
}
check('moderate preset has no nonce warnings', !keys(stateFor('moderate')).some((k) => /Nonce|StrictDynamic/.test(k)));

// ── 3. <meta> output (CSP3 §3.3) ──
{
  const s = stateFor('strict');
  s.directives['report-uri'] = ['/csp'];
  s.directives['report-to'] = ['csp-endpoint'];
  s.directives['sandbox'] = ['allow-scripts'];
  const meta = E.buildOutput(Object.assign({}, s, { format: 'meta' }), 'meta', T);
  check('meta keeps report-to', meta.includes('report-to csp-endpoint'), meta);
  check('meta drops report-uri', !meta.includes('report-uri'), meta);
  check('meta drops frame-ancestors', !meta.includes('frame-ancestors'), meta);
  check('meta drops sandbox', !meta.includes('sandbox'), meta);
  const k = keys(Object.assign({}, s, { format: 'meta' }));
  check('meta warns about report-uri', k.includes('warnReportUriMeta'), JSON.stringify(k));
  check('meta notes report-to needs Reporting-Endpoints', k.includes('warnReportToMeta'), JSON.stringify(k));
  const header = E.buildOutput(s, 'header', T);
  check('header keeps report-uri and frame-ancestors', header.includes('report-uri /csp') && header.includes("frame-ancestors 'none'"), header);
}

// ── 4. Express output: per-response nonce through helmet function directives ──
function runExpress(code) {
  let options = null;
  const middlewares = [];
  const app = { use: (fn) => middlewares.push(fn) };
  const helmet = { contentSecurityPolicy: (o) => { options = o; return function helmetCsp() {}; } };
  const req = (name) => {
    if (name === 'helmet') return helmet;
    if (name === 'crypto' || name === 'node:crypto') return { randomBytes };
    throw new Error('unexpected require ' + name);
  };
  new Function('require', 'app', code)(req, app);
  return { options, middlewares };
}
{
  const s = stateFor('strict');
  const code = E.buildOutput(s, 'express', T);
  let run;
  try { run = runExpress(code); } catch (e) { check('express output runs', false, e.message + '\n' + code); }
  if (run) {
    check('express output registers a nonce middleware before helmet', run.middlewares.length === 2 && run.middlewares[1].name === 'helmetCsp', run.middlewares.length);
    const sources = run.options.directives['script-src'];
    check('script-src has a function source', sources.some((x) => typeof x === 'function'), JSON.stringify(sources));
    const seen = new Set();
    for (let i = 0; i < 2; i++) {
      const res = { locals: {} };
      run.middlewares[0]({}, res, () => {});
      const out = sources.map((x) => (typeof x === 'function' ? x({}, res) : x));
      const nonce = out.find((x) => /^'nonce-/.test(x));
      check('request ' + i + ': function source returns a valid nonce-source', NONCE_RE.test(nonce || ''), nonce);
      check('request ' + i + ': nonce has at least 128 bits', nonce && Buffer.from(nonce.slice(7, -1), 'base64').length >= 16, nonce);
      seen.add(nonce);
      check("request " + i + ": 'strict-dynamic' kept", out.includes("'strict-dynamic'"));
    }
    check('two requests get different nonces', seen.size === 2);
    check('no placeholder left in express code', !code.includes('{RANDOM}'), code);
    eq('other directives stay arrays', run.options.directives['object-src'], ["'none'"]);
  }
  const plain = E.buildOutput(stateFor('moderate'), 'express', T);
  const r2 = runExpress(plain);
  check('express without nonce has no nonce middleware', r2.middlewares.length === 1, r2.middlewares.length);
  eq('express moderate script-src', r2.options.directives['script-src'], ["'self'"]);
}

// ── 5. nginx output ──
{
  const out = E.buildOutput(stateFor('strict'), 'nginx', T);
  check('nginx output notes the placeholder', /^#/.test(out) && out.includes('{RANDOM}'), out);
  const last = out.split('\n').pop();
  check('nginx add_header line', /^add_header Content-Security-Policy ".*" always;$/.test(last), last);
}

// ── 6. buildPolicy unchanged for plain directives ──
eq('basic preset policy', E.buildPolicy(stateFor('basic'), false), "default-src 'self'");
eq('moderate preset policy', E.buildPolicy(stateFor('moderate'), false),
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests");

// ── 7. strings ──
const base = Object.keys(E.STRINGS.en).sort();
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' STRINGS keys match en', Object.keys(E.STRINGS[lang]).sort(), base);
for (const k of ['warnNoncePlaceholder', 'warnStrictDynamicNoNonce', 'warnNonceInvalid', 'warnReportUriMeta', 'warnReportToMeta']) {
  check('en has ' + k, typeof T[k] === 'string' && T[k].length > 0);
}

// ── 8. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/csp-header-generator', lang + '.mdx'), 'utf8');
  check(lang + " page shows the nonce placeholder", mdx.includes("nonce-{RANDOM}") || mdx.includes("nonce-&#123;RANDOM&#125;") || mdx.includes("{'nonce-{RANDOM}'}") || mdx.includes('nonce-{"{"}RANDOM{"}"}'), lang);
  check(lang + ' page shows the actual Strict header output', mdx.includes(E.buildOutput(stateFor('strict'), 'header', T)), lang);
  check(lang + ' page explains why strict-dynamic needs a nonce (CSP3 §8.2 link)', mdx.includes('https://www.w3.org/TR/CSP3/#strict-dynamic-usage'), lang);
  check(lang + ' page no longer says report-to is ignored in <meta>', !/`frame-ancestors`[、，,・]\s*`report-uri`[、，,・]\s*`report-to`/.test(mdx), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
