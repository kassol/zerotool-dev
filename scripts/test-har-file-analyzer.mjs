// HAR File Analyzer — parsing, timings, waterfall rows, cURL and redacted export
//
// Read:  src/components/tools/HarFileAnalyzerTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table),
//        src/components/tools/SecretRedactorTool.astro (TOKEN_RULES must match its rules),
//        src/data/persistence.ts, src/content/tools/har-file-analyzer/*.mdx, and
//        scripts/test-har-file-analyzer.fixtures.json (a Safari Web Inspector export from the
//        WebKit repository; provenance is in its `source` field)
// Write: stdout only. bash runs generated cURL commands with `curl` replaced by a function that
//        prints its arguments (no network); skipped when bash is older than 4.2.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Chrome-shaped and Firefox-shaped inputs are built here from the exporters' source
// (devtools-frontend front_end/models/har/Log.ts; Firefox devtools har-builder.js and
// NetworkTimings.sys.mjs, main branches read 2026-10-01). Hosts are reserved example
// domains and every secret is made up; provider-format keys are assembled at run time.
//
// Run: node scripts/test-har-file-analyzer.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const componentSrc = readFileSync(join(root, 'src/components/tools/HarFileAnalyzerTool.astro'), 'utf8');
const redactorSrc = readFileSync(join(root, 'src/components/tools/SecretRedactorTool.astro'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-har-file-analyzer.fixtures.json'), 'utf8'));

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

// ---------- engine ----------
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const si = componentSrc.indexOf(START);
const ei = componentSrc.indexOf(END);
check('engine markers present', si >= 0 && ei > si);
const E = new Function(componentSrc.slice(si, ei) + `
  return { REDACTED, TOL_MS, MAX_BYTES, TOKEN_RULES, parseIsoMs, normalizeTimings, typeOf, statusClass, transferOf, cacheOf,
    readHarText, checkHar, buildIndex, sortRows, filterRows, fmtMs, fmtBytes, curlFor, curlJoin, escPosix, escWin,
    isSensitiveName, redactHar, redactEntry, newCtx, scanSensitive, looksSanitizedChrome, residueEligible, sampleHar };`)();

const clone = (x) => JSON.parse(JSON.stringify(x));
function allStrings(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => allStrings(y, out));
  else if (x && typeof x === 'object') Object.keys(x).forEach((k) => allStrings(x[k], out));
  return out;
}
const contains = (har, value) => allStrings(har).some((s) => s.includes(value));

// ---------- STRINGS ----------
{
  const s0 = componentSrc.indexOf('const STRINGS = ');
  const s1 = componentSrc.indexOf('\n};\n', s0);
  check('STRINGS table present', s0 >= 0 && s1 > s0);
  const STRINGS = new Function('return ' + componentSrc.slice(s0 + 'const STRINGS = '.length, s1 + 2))();
  const keys = Object.keys(STRINGS.en).sort();
  const ph = (v) => JSON.stringify(((Array.isArray(v) ? v.join('|') : String(v)).match(/\{\w+\}/g) || []).sort());
  for (const lang of ['zh', 'ja', 'ko']) {
    eq(lang + ' has the same keys as en', Object.keys(STRINGS[lang]).sort(), keys);
    for (const k of keys) {
      check(lang + '.' + k + ' placeholders match en', ph(STRINGS[lang][k]) === ph(STRINGS.en[k]), ph(STRINGS[lang][k]) + ' vs ' + ph(STRINGS.en[k]));
      check(lang + '.' + k + ' plural shape', Array.isArray(STRINGS[lang][k]) === Array.isArray(STRINGS.en[k]));
    }
  }
  const used = new Set((componentSrc.match(/\bS\.(\w+)/g) || []).map((m) => m.slice(2)).concat((componentSrc.match(/\bT\.(\w+)/g) || []).map((m) => m.slice(2))));
  for (const k of ['phaseBlocked', 'phaseDns', 'phaseTcp', 'phaseSsl', 'phaseSend', 'phaseWait', 'phaseReceive', 'cacheMemory', 'cacheDisk', 'cacheSw', 'cache304']) used.add(k);
  for (const k of keys) check('STRINGS.en.' + k + ' is used', used.has(k));
  for (const k of used) check('S.' + k + ' exists', k in STRINGS.en || k === 'replace');
}

// ---------- TOKEN_RULES are the secret-redactor rules ----------
{
  const a = redactorSrc.indexOf(START);
  const b = redactorSrc.indexOf(END);
  const R = new Function(redactorSrc.slice(a, b) + '; return RULES;')();
  const expected = R.filter((r) => !r.keyed);
  eq('TOKEN_RULES ids = secret-redactor rules without the keyed rule', E.TOKEN_RULES.map((r) => r.id), expected.map((r) => r.id));
  for (const r of expected) {
    const mine = E.TOKEN_RULES.find((x) => x.id === r.id);
    check('rule ' + r.id + ' pattern identical', mine && mine.re.source === r.re.source && mine.re.flags === r.re.flags);
    const fn = (f) => String(f || '').replace(/\s+/g, ' ');
    check('rule ' + r.id + ' check function identical', mine && fn(mine.check) === fn(r.check));
  }
}

// ---------- dates ----------
eq('ISO Z', E.parseIsoMs('2026-09-30T09:12:04.120Z'), Date.UTC(2026, 8, 30, 9, 12, 4, 120));
eq('ISO +09:00 (Firefox style)', E.parseIsoMs('2026-09-30T18:12:04.120+09:00'), Date.UTC(2026, 8, 30, 9, 12, 4, 120));
eq('ISO +0900', E.parseIsoMs('2026-09-30T18:12:04.120+0900'), Date.UTC(2026, 8, 30, 9, 12, 4, 120));
eq('ISO -05:00', E.parseIsoMs('2026-09-30T04:12:04.120-05:00'), Date.UTC(2026, 8, 30, 9, 12, 4, 120));
eq('ISO microseconds kept', (E.parseIsoMs('2026-09-30T09:12:04.120456Z') - Date.UTC(2026, 8, 30, 9, 12, 4, 120)).toFixed(3), '0.456');
eq('HAR spec example 2009-07-24T19:20:30.45+01:00', E.parseIsoMs('2009-07-24T19:20:30.45+01:00'), Date.UTC(2009, 6, 24, 18, 20, 30, 450));
check('invalid date is NaN', Number.isNaN(E.parseIsoMs('yesterday')));
check('month 13 is NaN', Number.isNaN(E.parseIsoMs('2026-13-01T00:00:00Z')));
check('non-string date is NaN', Number.isNaN(E.parseIsoMs(1790000000000)));

// ---------- timings (HAR 1.2 §timings; Chrome, Safari: ssl inside connect; Firefox: outside) ----------
{
  const spec = E.normalizeTimings({ blocked: 5, dns: 20, connect: 55, ssl: 25, send: 10, wait: 100, receive: 60 }, 250);
  eq('spec: TCP = connect - ssl', [spec.tcp, spec.ssl, spec.sum, spec.convention, spec.mismatch], [30, 25, 250, 'spec', false]);
  const ff = E.normalizeTimings({ blocked: 5, dns: 20, connect: 30, ssl: 25, send: 10, wait: 100, receive: 60 }, 250);
  eq('Firefox: ssl outside connect, time includes it', [ff.tcp, ff.ssl, ff.sum, ff.convention, ff.mismatch], [30, 25, 250, 'ssl-separate', false]);
  const noSsl = E.normalizeTimings({ blocked: 5, dns: 20, connect: 30, ssl: -1, send: 10, wait: 100, receive: 60 }, 225);
  eq('ssl -1', [noSsl.tcp, noSsl.ssl, noSsl.convention, noSsl.mismatch], [30, -1, 'spec', false]);
  const reuse = E.normalizeTimings({ blocked: 1, dns: -1, connect: -1, ssl: -1, send: 0.2, wait: 40, receive: 3 }, 44.2);
  eq('reused connection', [reuse.dns, reuse.tcp, reuse.ssl, reuse.mismatch], [-1, -1, -1, false]);
  const sslOnly = E.normalizeTimings({ blocked: 5, dns: 20, connect: -1, ssl: 25, send: 10, wait: 100, receive: 60 }, 220);
  eq('ssl without connect counts when time includes it', [sslOnly.tcp, sslOnly.ssl, sslOnly.mismatch], [-1, 25, false]);
  const sslOnlyStrict = E.normalizeTimings({ blocked: 5, dns: 20, connect: -1, ssl: 25, send: 10, wait: 100, receive: 60 }, 195);
  eq('ssl without connect is dropped when time excludes it', [sslOnlyStrict.ssl, sslOnlyStrict.mismatch], [-1, false]);
  const off = E.normalizeTimings({ blocked: 5, dns: 20, connect: 30, ssl: -1, send: 10, wait: 100, receive: 60 }, 245);
  eq('time 20 ms off is a mismatch', off.mismatch, true);
  const drift = E.normalizeTimings({ blocked: 1, dns: 5, connect: 40, ssl: 25, send: 0.5, wait: 80, receive: 30 }, 157.3);
  eq('0.8 ms float drift tolerated', [drift.convention, drift.mismatch], ['spec', false]);
  const missing = E.normalizeTimings({ dns: 20, connect: 50, wait: 60 }, 130);
  eq('missing fields are -1', [missing.blocked, missing.send, missing.receive, missing.mismatch], [-1, -1, -1, false]);
  const strings = E.normalizeTimings({ blocked: '5', dns: 'x', send: '1', wait: '2', receive: '3' }, '11');
  eq('numeric strings read, junk is -1', [strings.blocked, strings.dns, strings.mismatch], [5, -1, false]);
  const q = E.normalizeTimings({ blocked: 620, send: 0.2, wait: 38, receive: 62, _blocked_queueing: 610 }, 720.2);
  eq('Chrome _blocked_queueing', q.queueing, 610);
  const sslGtConnect = E.normalizeTimings({ connect: 10, ssl: 30, send: 1, wait: 1, receive: 1 }, 13);
  eq('ssl larger than connect is clipped to connect', [sslGtConnect.tcp, sslGtConnect.ssl], [0, 10]);
}

// ---------- reading ----------
eq('not JSON', E.readHarText('{"log":').error, 'json');
eq('no log', E.readHarText('{"entries":[]}').error, 'notHar');
eq('entries not array', E.readHarText('{"log":{"entries":{}}}').error, 'notHar');
eq('version 2.0 rejected', E.readHarText('{"log":{"version":"2.0","entries":[{}]}}'), { error: 'version', detail: '2.0' });
eq('empty entries', E.readHarText('{"log":{"version":"1.2","entries":[]}}').error, 'empty');
check('BOM ignored (HAR 1.2: readers must ignore a BOM)', !E.readHarText('\uFEFF{"log":{"version":"1.2","entries":[{}]}}').error);
check('version 1.1 accepted', !E.readHarText('{"log":{"version":"1.1","entries":[{}]}}').error);
check('missing version accepted', !E.readHarText('{"log":{"entries":[{}]}}').error);

// ---------- Safari: real Web Inspector export (WebKit LayoutTests) ----------
{
  const har = fixtures.safari;
  const idx = E.buildIndex(har);
  eq('Safari: 11 entries', idx.rows.length, 11);
  eq('Safari: creator', idx.creator, { name: 'WebKit Web Inspector', version: '605.1.15' });
  eq('Safari: no timing mismatch', idx.stats.mismatch, 0);
  eq('Safari: ssl inside connect', idx.stats.sslSeparate, 0);
  eq('Safari: transfer from _transferSize', idx.rows[0].transfer, har.log.entries[0].response._transferSize);
  eq('Safari: types from MIME', idx.rows.map((r) => r.type), ['document', 'css', 'css', 'css', 'js', 'js', 'img', 'img', 'img', 'img', 'img']);
  eq('Safari: first document TCP / TLS split', [idx.rows[0].tm.tcp.toFixed(3), idx.rows[0].tm.ssl.toFixed(3)], [(47.99997806549072 - 24.99997615814209).toFixed(3), (24.99997615814209).toFixed(3)]);
  eq('Safari: page markers', [Math.round(idx.marks.dcl - idx.marks.page.start), Math.round(idx.marks.load - idx.marks.page.start)], [106878, 106958]);
  const sens = E.scanSensitive(har);
  eq('Safari: 11 Cookie headers and 19 cookie values', [sens.cookie, sens.cookies], [11, 19]);
  const red = E.redactHar(har, { tokens: true, everywhere: true }, null);
  check('Safari: redaction passes its own check', !red.error && red.left === 0);
  check('Safari: cookie value gone', !contains(red.har, 'WP+Cookie+check') && !contains(red.har, 'WP Cookie check'));
  eq('Safari: cookie name kept', red.har.log.entries[0].request.headers[0].value, 'wordpress_test_cookie=[redacted]');
  eq('Safari: bodies kept and counted', red.kept, { req: 0, res: 11 });
  eq('Safari: no false token hits in 11 HTML / CSS / JS / SVG bodies', red.counts.tokens, 0);
}

// ---------- Chrome-shaped: sampleHar() and its Chrome "sanitized" export ----------
// Port of the sanitize branch in devtools-frontend Log.ts Entry.build().
function chromeSanitize(har) {
  const out = clone(har);
  for (const e of out.log.entries) {
    e.response.cookies = [];
    e.response.headers = e.response.headers.filter(({ name }) => !['set-cookie'].includes(name.toLocaleLowerCase()));
    e.request.cookies = [];
    e.request.headers = e.request.headers.filter(({ name }) => !['authorization', 'cookie'].includes(name.toLocaleLowerCase()));
  }
  return out;
}
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJuYW1lIjoiRGVtbyBTaG9wcGVyIiwiaWF0IjoxNzkwMDAwMDAwfQ.demo-signature-not-real';
const SID = 'demo-session-7f3a9c2e51';
{
  const har = E.sampleHar();
  check('sample is HAR 1.2', !E.checkHar(clone(har)).error && har.log.version === '1.2');
  const idx = E.buildIndex(har);
  eq('sample: 10 rows', idx.rows.length, 10);
  eq('sample: status classes', idx.rows.map((r) => r.cls), ['2xx', '2xx', '2xx', '2xx', '2xx', '2xx', '5xx', '2xx', '4xx', 'failed']);
  eq('sample: Chrome _resourceType mapping', idx.rows.map((r) => r.type), ['document', 'js', 'css', 'font', 'fetch', 'fetch', 'fetch', 'img', 'other', 'other']);
  eq('sample: disk cache', idx.rows[1].cache, 'disk');
  eq('sample: _error', idx.rows[9].error, 'net::ERR_BLOCKED_BY_CLIENT');
  eq('sample: every entry.time = spec sum', idx.stats.mismatch, 0);
  eq('sample: slowest is the orders API (TTFB 1486 ms)', E.sortRows(idx.rows, 'time', true)[0].url.startsWith('https://api.example.com/v1/orders'), true);
  const sens = E.scanSensitive(har);
  eq('sample: sensitive counts', sens, { cookie: 2, setCookie: 1, auth: 2, headers: 1, cookies: 5, params: 2, reqBodies: 2, resBodies: 4, tokens: 2 });

  const sanitized = chromeSanitize(har);
  const sSens = E.scanSensitive(sanitized);
  check('Chrome sanitized: no Cookie / Authorization left', sSens.cookie === 0 && sSens.auth === 0 && sSens.setCookie === 0 && sSens.cookies === 0);
  check('Chrome sanitized: detected as sanitized', E.looksSanitizedChrome(sanitized, sSens));
  check('Chrome sanitized: still has the token in the URL', contains(sanitized, 'access_token=' + JWT));
  check('Chrome sanitized: still has the password in the body', contains(sanitized, 'correct-horse-battery-staple'));
  check('Chrome sanitized: still has x-csrf-token', contains(sanitized, 'csrf-demo-4b1c9e7a'));
  check('Chrome sanitized: still has the session id in HTML and the analytics URL', contains(sanitized, SID));
  check('sensitive export is not flagged as sanitized', !E.looksSanitizedChrome(har, sens));

  const red = E.redactHar(har, { tokens: true, everywhere: true }, null);
  check('sample redaction: no error', !red.error);
  for (const secret of [JWT, SID, 'correct-horse-battery-staple', 'csrf-demo-4b1c9e7a', 'demo-signature-not-real']) {
    check('sample redaction removes ' + secret.slice(0, 18), !contains(red.har, secret));
    check('sample redaction: raw JSON has no ' + secret.slice(0, 18), !red.json.includes(secret));
  }
  const e0 = red.har.log.entries[0];
  eq('Cookie header keeps names', e0.request.headers.find((h) => h.name === 'cookie').value, 'session=[redacted]; theme=[redacted]; consent=[redacted]');
  eq('cookie list keeps flags', e0.request.cookies[0], { name: 'session', value: '[redacted]', path: '/', domain: 'shop.example.com', expires: null, httpOnly: true, secure: true, sameSite: 'Lax' });
  const login = red.har.log.entries[4];
  eq('Set-Cookie keeps attributes', login.response.headers.find((h) => h.name === 'set-cookie').value, 'session=[redacted]; Path=/; Secure; HttpOnly; SameSite=Lax');
  eq('CORS header kept', login.response.headers.find((h) => h.name === 'access-control-allow-credentials').value, 'true');
  eq('login body: password only', JSON.parse(login.request.postData.text), { email: 'shopper@example.com', password: '[redacted]', remember: true });
  eq('login response: access_token key', JSON.parse(login.response.content.text).access_token, '[redacted]');
  eq('login response: other fields kept', JSON.parse(login.response.content.text).user, { id: 42, name: 'Demo Shopper' });
  eq('x-csrf-token header', login.request.headers.find((h) => h.name === 'x-csrf-token').value, '[redacted]');
  const orders = red.har.log.entries[5];
  eq('Authorization keeps the scheme', orders.request.headers.find((h) => h.name === 'authorization').value, 'Bearer [redacted]');
  eq('URL query param', orders.request.url, 'https://api.example.com/v1/orders?page=1&access_token=[redacted]');
  eq('queryString array', orders.request.queryString, [{ name: 'page', value: '1' }, { name: 'access_token', value: '[redacted]' }]);
  eq('analytics URL: sid param, host untouched', red.har.log.entries[9].request.url, 'https://analytics.example.org/collect?v=2&sid=[redacted]');
  check('HTML body: session id found elsewhere and replaced', red.har.log.entries[0].response.content.text.includes('data-session="[redacted]"'));
  check('plain cookie value "analytics" does not touch other text', red.har.log.entries[9].request.url.includes('analytics.example.org'));
  eq('page title kept (no credentials)', red.har.log.pages[0].title, 'https://shop.example.com/account?ref=newsletter');
  check('log.comment says how it was made', /Redacted with ZeroTool HAR Analyzer/.test(red.har.log.comment));
  eq('report: kept bodies', red.kept, { req: 2, res: 4 });
  check('report: names', ['session', 'password', 'access_token', 'authorization', 'x-csrf-token', 'sid'].every((n) => red.names.includes(n)), red.names.join(','));
  eq('report: nothing left', red.left, 0);
  eq('output re-parses to the same entries count', JSON.parse(red.json).log.entries.length, 10);
  eq('original HAR not modified', E.scanSensitive(har), sens);

  const noEverywhere = E.redactHar(har, { tokens: true, everywhere: false }, null);
  eq('HTTP/2 :path query redacted without the everywhere pass', noEverywhere.har.log.entries[5].request.headers.find((h) => h.name === ':path').value, '/v1/orders?page=1&access_token=[redacted]');
  check('everywhere off: only the HTML echo of the session id is left', allStrings(noEverywhere.har).filter((s) => s.includes(SID)).length === 1 && noEverywhere.har.log.entries[0].response.content.text.includes(SID));
  check('everywhere off: copies are reported, not an error', !noEverywhere.error && noEverywhere.left > 0 && contains(noEverywhere.har, SID));

  // The file used for the competitor comparison on the tool page: the sample plus a profile
  // call with a custom session header and a refresh token nested after 3,200 characters.
  const comp = clone(har);
  const extraE = clone(comp.log.entries[5]);
  extraE.request.url = 'https://api.example.com/v1/profile';
  extraE.request.queryString = [];
  extraE.request.headers = extraE.request.headers.filter((h) => h.name !== 'authorization').concat([{ name: 'x-session-id', value: 'sess-demo-1122334455' }]);
  extraE.response.content.text = JSON.stringify({ padding: 'p'.repeat(3200), data: { session: { refresh_token: 'rt-demo-5566778899aabb' } } });
  comp.log.entries.push(extraE);
  const cr = E.redactHar(comp, { tokens: true, everywhere: true }, null);
  for (const v of [SID, 'correct-horse-battery-staple', JWT, 'demo-signature-not-real', 'csrf-demo-4b1c9e7a', 'sess-demo-1122334455', 'rt-demo-5566778899aabb']) {
    check('comparison file: ' + v.slice(0, 20) + ' gone', !contains(cr.har, v));
  }
  check('comparison file: email kept (personal data, not a credential)', contains(cr.har, 'shopper@example.com'));

  const dropped = E.redactHar(har, { tokens: true, everywhere: true, dropReq: true, dropRes: true, ips: true }, null);
  check('drop bodies: no response text', dropped.har.log.entries.every((e) => e.response.content.text === undefined));
  check('drop bodies: request text empty', dropped.har.log.entries.filter((e) => e.request.postData).every((e) => e.request.postData.text === ''));
  check('drop IPs', dropped.har.log.entries.every((e) => e.serverIPAddress === undefined) && !contains(dropped.har, '203.0.113.30'));
  eq('drop bodies: counts', [dropped.counts.dropped, dropped.kept.req, dropped.kept.res], [6, 0, 0]);
  check('drop: email gone with the body', !contains(dropped.har, 'shopper@example.com'));

  const extra = E.redactHar(har, { tokens: true, everywhere: true, extra: 'email, theme' }, null);
  eq('extra names: email', JSON.parse(extra.har.log.entries[4].request.postData.text).email, '[redacted]');

  const subset = E.redactHar(har, { tokens: true, everywhere: true }, [4, 5]);
  eq('subset: 2 entries in order', subset.har.log.entries.map((e) => e.request.url.split('?')[0]), ['https://api.example.com/v1/login', 'https://api.example.com/v1/orders']);
  eq('subset: referenced page kept', subset.har.log.pages.map((p) => p.id), ['page_1']);
}

// ---------- name rules ----------
{
  const yes = [['Authorization', 'header'], ['X-Api-Key', 'header'], ['X-Auth-Token', 'header'], ['X-CSRF-Token', 'header'], ['X-XSRF-TOKEN', 'header'],
    ['X-Amz-Security-Token', 'header'], ['x-goog-api-key', 'header'], ['Proxy-Authorization', 'header'], ['X-Session-Id', 'header'],
    ['access_token', 'param'], ['id_token', 'param'], ['refresh_token', 'param'], ['code', 'param'], ['client_secret', 'param'], ['code_verifier', 'param'],
    ['X-Amz-Signature', 'param'], ['X-Amz-Credential', 'param'], ['sig', 'param'], ['key', 'param'], ['apiKey', 'param'], ['sessionId', 'param'],
    ['SAMLResponse', 'param'], ['password', 'body'], ['newPassword', 'body'], ['pwd', 'body'], ['otp', 'body'], ['pin', 'body'], ['client_assertion', 'body'],
    ['accessToken', 'body'], ['secretKey', 'body'], ['privateKey', 'body']];
  const no = [['Accept', 'header'], ['Content-Type', 'header'], ['Access-Control-Allow-Credentials', 'header'], ['Access-Control-Allow-Headers', 'header'],
    [':authority', 'header'], ['Author', 'header'], ['Keep-Alive', 'header'], ['Content-Security-Policy', 'header'], ['country_code', 'param'], ['token_type', 'param'], ['expires_in', 'param'], ['token_endpoint', 'body'],
    ['keyword', 'param'], ['page', 'param'], ['passport', 'param'], ['footprint', 'body'], ['key', 'body'], ['author', 'body'], ['code', 'body'], ['state', 'param']];
  for (const [n, k] of yes) check(`sensitive ${k} name ${n}`, E.isSensitiveName(n, k, null));
  for (const [n, k] of no) check(`not sensitive ${k} name ${n}`, !E.isSensitiveName(n, k, null));
  check('extra name matches case-insensitively', E.isSensitiveName('X-Tenant-Id', 'header', new Set(['xtenantid'])));
}

// ---------- body formats, URLs, messages ----------
function one(entry, opts = {}) {
  const har = { log: { version: '1.2', creator: { name: 't', version: '1' }, entries: [entry] } };
  return E.redactHar(har, Object.assign({ tokens: true, everywhere: true }, opts), null);
}
function baseEntry(over = {}) {
  return Object.assign({
    startedDateTime: '2026-10-01T00:00:00.000Z', time: 3, timings: { send: 1, wait: 1, receive: 1 },
    request: { method: 'GET', url: 'https://example.com/', httpVersion: 'HTTP/1.1', headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: 0 },
    response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [], cookies: [], content: { size: 0, mimeType: 'text/plain' }, redirectURL: '', headersSize: -1, bodySize: 0 },
    cache: {}
  }, over);
}
{
  const nested = baseEntry();
  nested.request.method = 'POST';
  nested.request.postData = { mimeType: 'application/json', text: JSON.stringify({ data: { auth: { refresh_token: 'rt-1234567890abcdef' }, list: [{ apiKey: 'k-998877665544' }] }, credentials: { user: 'u1', pass: 'p-55667788aa' }, ok: true }) };
  const r = one(nested);
  const body = JSON.parse(r.har.log.entries[0].request.postData.text);
  eq('JSON: nested credential object removed whole', body.data.auth, '[redacted]');
  eq('JSON: key inside array', body.list ?? body.data.list, [{ apiKey: '[redacted]' }]);
  eq('JSON: credentials object', body.credentials, '[redacted]');
  eq('JSON: boolean kept', body.ok, true);
  check('JSON: no leaf left', !r.json.includes('rt-1234567890abcdef') && !r.json.includes('p-55667788aa'));

  const form = baseEntry();
  form.request.method = 'POST';
  form.request.postData = { mimeType: 'application/x-www-form-urlencoded', text: 'username=demo&password=hunter2%21x&remember=1', params: [{ name: 'username', value: 'demo' }, { name: 'password', value: 'hunter2!x' }, { name: 'remember', value: '1' }] };
  const rf = one(form);
  eq('form text', rf.har.log.entries[0].request.postData.text, 'username=demo&password=[redacted]&remember=1');
  eq('form params', rf.har.log.entries[0].request.postData.params.map((p) => p.value), ['demo', '[redacted]', '1']);

  const mp = baseEntry();
  mp.request.method = 'POST';
  const B = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  mp.request.postData = { mimeType: 'multipart/form-data; boundary=' + B, text: ['--' + B, 'Content-Disposition: form-data; name="user"', '', 'demo', '--' + B, 'Content-Disposition: form-data; name="token"', '', 'tok-ABCDEF123456', '--' + B, 'Content-Disposition: form-data; name="file"; filename="a.txt"', 'Content-Type: text/plain', '', 'hello', '--' + B + '--', ''].join('\r\n') };
  const rm = one(mp);
  const t = rm.har.log.entries[0].request.postData.text;
  check('multipart: token part redacted', t.includes('name="token"\r\n\r\n[redacted]\r\n') && !t.includes('tok-ABCDEF123456'));
  check('multipart: other parts kept', t.includes('\r\n\r\ndemo\r\n') && t.includes('\r\n\r\nhello\r\n'));

  const u = baseEntry();
  u.request.url = 'https://user:s3cr3t-pass@example.com/cb/' + JWT + '?state=xyz#access_token=at-0123456789abcd&token_type=bearer';
  u.response.status = 302;
  u.response.redirectURL = 'https://example.com/next?code=oauth-code-998877&ok=1';
  u.response.headers = [{ name: 'Location', value: 'https://example.com/next?code=oauth-code-998877&ok=1' }];
  u.request.headers = [{ name: 'Referer', value: 'https://example.com/login?sig=abcd1234efgh' }];
  const ru = one(u);
  const out = ru.har.log.entries[0];
  eq('URL: userinfo, JWT in path, fragment token', out.request.url, 'https://user:[redacted]@example.com/cb/[redacted]?state=xyz#access_token=[redacted]&token_type=bearer');
  eq('redirectURL code', out.response.redirectURL, 'https://example.com/next?code=[redacted]&ok=1');
  eq('Location header code', out.response.headers[0].value, 'https://example.com/next?code=[redacted]&ok=1');
  eq('Referer sig', out.request.headers[0].value, 'https://example.com/login?sig=[redacted]');

  const ws = baseEntry({ _resourceType: 'websocket', _webSocketMessages: [{ type: 'send', time: 1, opcode: 1, data: '{"type":"auth","token":"ws-token-11223344"}' }, { type: 'receive', time: 2, opcode: 1, data: 'hello' }] });
  ws.request.url = 'wss://example.com/socket';
  const rw = one(ws);
  eq('WebSocket message JSON key', JSON.parse(rw.har.log.entries[0]._webSocketMessages[0].data).token, '[redacted]');
  eq('WebSocket plain message kept', rw.har.log.entries[0]._webSocketMessages[1].data, 'hello');
  const rwd = one(clone(ws), { dropRes: true });
  check('WebSocket messages dropped with response bodies', rwd.har.log.entries[0]._webSocketMessages.every((m) => m.data === undefined));

  // Provider-format keys assembled at run time so the source has none.
  const gh = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const aws = 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP'.replace(/[^A-Z2-7]/g, 'Q').slice(0, 16);
  const js = baseEntry();
  js.response.content = { size: 100, mimeType: 'application/javascript', text: 'const cfg={gh:"' + gh + '",aws:"' + aws + '",note:"Bearer abcdefghijklmnop1234"};\nfunction f(a){return a.password||a.token}' };
  const rj = one(js);
  const jt = rj.har.log.entries[0].response.content.text;
  check('JS body: provider keys and Bearer token replaced', !jt.includes(gh) && !jt.includes(aws) && jt.includes('Bearer [redacted]'));
  check('JS body: code that mentions password is untouched', jt.includes('function f(a){return a.password||a.token}'));
  const rjOff = one(clone(js), { tokens: false });
  check('tokens option off keeps text', rjOff.har.log.entries[0].response.content.text.includes(gh));

  const b64 = baseEntry();
  b64.response.content = { size: 3, mimeType: 'image/png', text: 'iVBORw0KGgo=', encoding: 'base64' };
  eq('base64 body untouched', one(b64).har.log.entries[0].response.content.text, 'iVBORw0KGgo=');

  const ip = baseEntry({ serverIPAddress: '192.0.2.44' });
  ip.request.headers = [{ name: 'X-Forwarded-For', value: '198.51.100.7, 10.0.0.2' }];
  const ri = one(ip, { ips: true });
  eq('IP option', [ri.har.log.entries[0].serverIPAddress, ri.har.log.entries[0].request.headers[0].value], [undefined, '[redacted]']);
  eq('IP kept by default', one(clone(ip)).har.log.entries[0].serverIPAddress, '192.0.2.44');

  const multi = baseEntry();
  multi.response.headers = [{ name: 'Set-Cookie', value: 'a=val-1234abcd; Path=/\nb=val-5678efgh; HttpOnly' }];
  eq('Set-Cookie with two lines', one(multi).har.log.entries[0].response.headers[0].value, 'a=[redacted]; Path=/\nb=[redacted]; HttpOnly');

  const basic = baseEntry();
  basic.request.headers = [{ name: 'Authorization', value: 'Basic ZGVtbzpodW50ZXIy' }, { name: 'Proxy-Authorization', value: 'AWS4-HMAC-SHA256 Credential=AKID/20261001/us-east-1/s3/aws4_request, Signature=abc' }];
  const rb = one(basic);
  eq('Basic keeps scheme', rb.har.log.entries[0].request.headers[0].value, 'Basic [redacted]');
  eq('AWS4 keeps scheme', rb.har.log.entries[0].request.headers[1].value, 'AWS4-HMAC-SHA256 [redacted]');

  check('residue rule: plain word not eligible', !E.residueEligible('analytics') && !E.residueEligible('dark'));
  check('residue rule: mixed id eligible', E.residueEligible('abc12345') && E.residueEligible(SID));
  check('residue rule: long numbers only from 16 digits', !E.residueEligible('1790000000') && E.residueEligible('1234567890123456'));
  check('residue rule: long passphrase eligible', E.residueEligible('correct-horse-battery-staple'));
}

// ---------- Firefox-shaped export ----------
// Fields as har-builder.js writes them: local-offset dates, integer ms timings with ssl outside
// connect and time summed over all seven keys, bodySize = transferred size, _securityState.
{
  const ff = {
    log: {
      version: '1.2', creator: { name: 'Firefox', version: '152.0' }, browser: { name: 'Firefox', version: '152.0' },
      pages: [{ id: 'page_1', title: 'https://example.com/', startedDateTime: '2026-10-01T18:00:00.000+09:00', pageTimings: { onContentLoad: 410, onLoad: 902 } }],
      entries: [
        { startedDateTime: '2026-10-01T18:00:00.012+09:00', request: { method: 'GET', url: 'https://example.com/', httpVersion: 'HTTP/2', headers: [{ name: 'Host', value: 'example.com' }], cookies: [], queryString: [], headersSize: 312, bodySize: 0 },
          response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/2', headers: [], cookies: [], content: { mimeType: 'text/html; charset=utf-8', size: 1256, text: '<!doctype html>' }, redirectURL: '', headersSize: 420, bodySize: 1680 },
          cache: {}, timings: { blocked: 1, dns: 12, connect: 18, ssl: 21, send: 0, wait: 96, receive: 3 }, time: 151, _securityState: 'secure', _priority: 'Highest', serverIPAddress: '93.184.215.14', connection: '443', pageref: 'page_1' },
        { startedDateTime: '2026-10-01T18:00:00.200+09:00', request: { method: 'GET', url: 'https://example.com/app.js', httpVersion: 'HTTP/2', headers: [], cookies: [], queryString: [], headersSize: 280, bodySize: 0 },
          response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/2', headers: [], cookies: [], content: { mimeType: 'text/javascript', size: 5120 }, redirectURL: '', headersSize: 380, bodySize: 2048 },
          cache: {}, timings: { blocked: 0, dns: -1, connect: -1, ssl: -1, send: 0, wait: 40, receive: 2 }, time: 42, _securityState: 'secure', serverIPAddress: '93.184.215.14', connection: '443', pageref: 'page_1' }
      ]
    }
  };
  const idx = E.buildIndex(ff);
  eq('Firefox: detected', idx.firefox, true);
  eq('Firefox: ssl outside connect', [idx.stats.sslSeparate, idx.stats.mismatch, idx.rows[0].tm.tcp, idx.rows[0].tm.ssl], [1, 0, 18, 21]);
  eq('Firefox: transfer = bodySize (headers already inside)', idx.rows.map((r) => r.transfer), [1680, 2048]);
  eq('Firefox: offset dates', idx.rows[0].start, Date.UTC(2026, 9, 1, 9, 0, 0, 12));
  eq('Firefox: types from MIME', idx.rows.map((r) => r.type), ['document', 'js']);
  eq('Firefox: duration = time', idx.rows[0].dur, 151);
  const asSpec = clone(ff);
  asSpec.log.creator.name = 'Other'; delete asSpec.log.browser;
  eq('spec reader: headersSize + bodySize', E.buildIndex(asSpec).rows[0].transfer, 2100);
}

// ---------- sorting and filtering ----------
{
  const idx = E.buildIndex(E.sampleHar());
  eq('default start order', E.sortRows(idx.rows, 'start', false).map((r) => r.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq('size desc', E.sortRows(idx.rows, 'size', true).slice(0, 3).map((r) => r.i), [7, 3, 2]);
  eq('status asc', E.sortRows(idx.rows, 'status', false).map((r) => r.status).slice(0, 2), [0, 200]);
  const shuffled = idx.rows.slice().reverse();
  eq('sort is stable on ties (by index)', E.sortRows(shuffled, 'status', false).filter((r) => r.status === 200).map((r) => r.i), [0, 1, 2, 3, 4, 5, 7]);
  eq('filter: AND terms', E.filterRows(idx.rows, { query: 'api v1', status: new Set(), types: new Set() }).map((r) => r.i), [4, 5, 6]);
  eq('filter: exclusion', E.filterRows(idx.rows, { query: 'api -login', status: new Set(), types: new Set() }).map((r) => r.i), [5, 6]);
  eq('filter: method', E.filterRows(idx.rows, { query: 'post', status: new Set(), types: new Set() }).map((r) => r.i), [4, 9]);
  eq('filter: status classes', E.filterRows(idx.rows, { query: '', status: new Set(['4xx', '5xx', 'failed']), types: new Set() }).map((r) => r.i), [6, 8, 9]);
  eq('filter: types', E.filterRows(idx.rows, { query: '', status: new Set(), types: new Set(['img', 'font']) }).map((r) => r.i), [3, 7]);
  const unsorted = E.sampleHar();
  unsorted.log.entries.reverse();
  const ui = E.buildIndex(unsorted);
  eq('entries out of order are drawn by start time', E.sortRows(ui.rows, 'start', false).map((r) => r.url)[0], 'https://shop.example.com/account?ref=newsletter');
  const bad = E.sampleHar();
  bad.log.entries[3].startedDateTime = 'not a date';
  eq('unreadable date counted', E.buildIndex(bad).stats.badDates, 1);
  const many = { log: { version: '1.2', entries: [] } };
  for (let i = 0; i < 200000; i++) many.log.entries.push({ startedDateTime: new Date(1790000000000 + i).toISOString(), time: 1, timings: { send: 0, wait: 1, receive: 0 }, request: { url: 'https://example.com/' + i }, response: { status: 200 } });
  let t = performance.now();
  const big = E.buildIndex(many);
  const dt = performance.now() - t;
  check('200,000 entries index without stack overflow', big.rows.length === 200000 && big.max > big.min, 'min ' + big.min);
  check('200,000 entries index in under 3 s', dt < 3000 * PERF_SLACK, Math.round(dt) + ' ms');
}

// ---------- formatting ----------
eq('fmtMs', [E.fmtMs(0.42), E.fmtMs(4.25), E.fmtMs(212.6), E.fmtMs(1486.2), E.fmtMs(12345), E.fmtMs(125000), E.fmtMs(-1)], ['0.42 ms', '4.3 ms', '213 ms', '1.49 s', '12.3 s', '2 min 5 s', '\u2014']);
eq('fmtBytes (decimal, as DevTools)', [E.fmtBytes(512), E.fmtBytes(13544), E.fmtBytes(182600), E.fmtBytes(43800000), E.fmtBytes(-1)], ['512 B', '13.5 kB', '182.6 kB', '43.8 MB', '\u2014']);

// ---------- cURL (port of Chrome DevTools generateCurlCommand) ----------
function curlEntry(method, url, headers, body) {
  const e = baseEntry();
  e.request.method = method; e.request.url = url;
  e.request.headers = headers.map(([name, value]) => ({ name, value }));
  if (body != null) e.request.postData = { mimeType: 'application/json', text: body };
  return e;
}
{
  const e = curlEntry('POST', 'https://api.example.com/v1/orders?q=[1]', [[':authority', 'api.example.com'], [':method', 'POST'], ['accept-encoding', 'gzip'], ['content-length', '20'], ['content-type', 'application/json'], ['cookie', 'a=1; b=2'], ['x-empty', '']], '{"note":"costs $5"}');
  eq('curl unix', E.curlFor(e, 'unix'), "curl --url 'https://api.example.com/v1/orders?q=\\[1\\]' \\\n  -H 'content-type: application/json' \\\n  -b 'a=1; b=2' \\\n  -H 'x-empty;' \\\n  --data-raw '{\"note\":\"costs $5\"}'");
  eq('curl GET has no -X', E.curlFor(curlEntry('GET', 'https://example.com/', [], null), 'unix'), "curl --url 'https://example.com/'");
  eq('curl PUT has -X', E.curlFor(curlEntry('PUT', 'https://example.com/', [], '{}'), 'unix'), "curl --url 'https://example.com/' \\\n  -X 'PUT' \\\n  --data-raw '{}'");
  eq('curl non-http is null', E.curlFor(curlEntry('GET', 'wss://example.com/', [], null), 'unix'), null);
  eq('curl drops fragment', E.curlFor(curlEntry('GET', 'https://example.com/#x', [], null), 'unix'), "curl --url 'https://example.com/'");
  eq('escPosix ANSI-C for quote', E.escPosix("it's"), "$'it\\'s'");
  eq('escWin (same output as Chrome escapeStringWin)', E.escWin('a "b" %PATH% (c)'), '^"a ^\\^"b^\\^" ^%^PATH^% ^(c^)^"');
  eq('join', E.curlJoin(['curl a', 'curl b'], 'unix'), 'curl a ;\ncurl b');

  const bashOk = spawnSync('bash', ['-c', '[ "${BASH_VERSINFO[0]}" -gt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -ge 2 ]; }']).status === 0;
  if (!bashOk) console.log('SKIP: bash 4.2+ not found; generated cURL commands are not executed');
  else {
    const cases = [
      ['dollar and backtick', '{"note":"costs $5 `id` $(whoami)"}'],
      ['single quote', "{\"name\":\"O'Brien\"}"],
      ['exclamation', '{"msg":"hi!"}'],
      ['newline and tab', 'line1\nline2\tend'],
      ['unicode', '{"city":"東京","emoji":"😀"}'],
      ['backslash', '{"path":"C:\\\\Users\\\\demo"}'],
    ];
    for (const [label, body] of cases) {
      const cmd = E.curlFor(curlEntry('POST', 'https://api.example.com/x?a=1&b=2', [['x-note', "it's $HOME"]], body), 'unix');
      const script = 'curl(){ for a in "$@"; do printf "%s\\0" "$a"; done; }\n' + cmd;
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
      const argv = r.stdout.split('\0').slice(0, -1);
      eq('bash argv: ' + label, argv, ['--url', 'https://api.example.com/x?a=1&b=2', '-H', "x-note: it's $HOME", '--data-raw', body]);
    }
  }
}

function PAGE_CURL_SAMPLE() {
  const har = E.sampleHar();
  return E.curlFor(har.log.entries[4], 'unix');
}
const PAGE_EXAMPLES = {
  'curl-login': PAGE_CURL_SAMPLE,
  'curl-login-redacted': () => {
    const red = E.redactHar(E.sampleHar(), { tokens: true, everywhere: true }, [4]);
    return E.curlFor(red.har.log.entries[0], 'unix');
  },
  'redacted-orders': () => {
    const red = E.redactHar(E.sampleHar(), { tokens: true, everywhere: true }, [5]);
    const e = red.har.log.entries[0];
    return [e.request.url, 'authorization: ' + e.request.headers.find((h) => h.name === 'authorization').value].join('\n');
  },
  'redacted-login': () => {
    const red = E.redactHar(E.sampleHar(), { tokens: true, everywhere: true }, [4]);
    const e = red.har.log.entries[0];
    return ['set-cookie: ' + e.response.headers.find((h) => h.name === 'set-cookie').value, e.request.postData.text, e.response.content.text].join('\n');
  },
  'kollus-url': () => {
    const har = { log: { version: '1.2', entries: [{ startedDateTime: '2026-10-01T00:00:00Z', time: 0, timings: {}, request: { method: 'GET', url: 'https://v.kr.kollus.com/s?jwt=' + JWT + '&custom_key=demo-custom-key-5f2a9c&autoplay=1', headers: [] }, response: { status: 200, headers: [] } }] } };
    return E.redactHar(har, { tokens: true, everywhere: true }, null).har.log.entries[0].request.url;
  },
  'pts-size': () => {
    const har = E.sampleHar();
    const idx = E.buildIndex(har);
    const api = E.filterRows(idx.rows, { query: 'api.example.com', status: new Set(), types: new Set() }).map((r) => r.i);
    const sub = E.redactHar(har, { tokens: true, everywhere: true, dropRes: true }, api);
    return 'full sample: ' + JSON.stringify(har, null, 2).length + ' bytes\napi.example.com only, response bodies removed: ' + sub.json.length + ' bytes (' + sub.entries + ' requests)';
  },
  'timing-firefox': () => {
    const t = E.normalizeTimings({ blocked: 1, dns: 12, connect: 18, ssl: 21, send: 0, wait: 96, receive: 3 }, 151);
    return 'connect ' + t.tcp + ' ms + ssl ' + t.ssl + ' ms (time ' + t.time + ' ms = sum of all seven)';
  },
};

// ---------- page and policy ----------
{
  const policy = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check("persistence policy is 'disabled'", /'har-file-analyzer':\s*'disabled'/.test(policy));
  const script = componentSrc.slice(componentSrc.indexOf('<script'), componentSrc.indexOf('</script>'));
  for (const api of ['localStorage', 'sessionStorage', 'ztPersist', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'document.cookie', 'WebSocket(']) {
    check('component script does not use ' + api, !script.includes(api));
  }
  eq('size limit', E.MAX_BYTES, 300000000);
  const dir = join(root, 'src/content/tools/har-file-analyzer');
  for (const f of readdirSync(dir)) {
    const mdx = readFileSync(join(dir, f), 'utf8');
    // Example blocks marked {/* har-check: <id> */} must match what the engine produces.
    const marks = [...mdx.matchAll(/\{\/\* har-check: ([a-z0-9-]+) \*\/\}\s*\n+```[a-z]*\n([\s\S]*?)```/g)];
    check(f + ' has at least 2 checked examples', marks.length >= 2, String(marks.length));
    for (const [, id, block] of marks) {
      const expected = PAGE_EXAMPLES[id];
      check(f + ' example ' + id + ' is known', typeof expected === 'function');
      if (typeof expected === 'function') eq(f + ' example ' + id, block.trimEnd(), expected().trimEnd());
    }
  }
}

console.log(`HAR file analyzer: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
