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
    isSensitiveName, redactHar, redactEntry, newCtx, scanSensitive, loadJob, redactJob, curlJob, redactUrl, residueRegex, replaceKnown, countResidue, looksSanitizedChrome, residueEligible, sampleHar };`)();

const clone = (x) => JSON.parse(JSON.stringify(x));
function allStrings(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach((y) => allStrings(y, out));
  else if (x && typeof x === 'object') Object.keys(x).forEach((k) => allStrings(x[k], out));
  return out;
}
const contains = (har, value) => allStrings(har).some((s) => s.includes(value));

// Cookie Parser keeps a source copy of these declarations. Changing HAR must not drift it.
{
  const cookie = readFileSync(join(root, 'src/components/tools/CookieParserTool.astro'), 'utf8');
  const declaration = (src, name) => {
    const lines = src.split('\n');
    const at = lines.findIndex((line) => new RegExp('^\\s*(?:function|var) ' + name + '(?:\\b|\\()').test(line));
    if (at < 0) return '';
    const indent = lines[at].match(/^\s*/)[0];
    let end = at + 1;
    if (!/;\s*$|}\s*$/.test(lines[at])) {
      while (end < lines.length && !new RegExp('^' + indent + '(?:};|})\\s*$').test(lines[end])) end++;
      end++;
    }
    return lines.slice(at, end).map((line) => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');
  };
  for (const name of ['notFiller', 'base64HasColon', 'TOKEN_RULES', 'SENS_SUBSTR', 'NON_SECRET_TAIL', 'SENS_WORDS', 'normName', 'nameWords', 'isSensitiveName']) {
    const mine = declaration(componentSrc, name);
    check('Cookie source copy identical: ' + name, mine !== '' && mine === declaration(cookie, name));
  }
}

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
  check('drop bodies: request text absent', dropped.har.log.entries.filter((e) => e.request.postData).every((e) => e.request.postData.text === undefined));
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
  eq('binary Base64 removed from redacted copy', one(b64).har.log.entries[0].response.content.text, undefined);

  const encoded = baseEntry();
  const session = 'fixtureSession123456789';
  encoded.request.headers = [{ name: 'Authorization', value: 'Bearer ' + session }];
  encoded.response.content = { size: 80, mimeType: 'application/json', encoding: 'base64', text: Buffer.from(JSON.stringify({ token: session, echo: session, ok: true })).toString('base64') };
  const encodedBefore = JSON.stringify(encoded);
  const exported = one(encoded);
  // Independent oracle: reparse the output and use Node's byte decoder, never redactHar again.
  const saved = JSON.parse(exported.json).log.entries[0].response.content;
  const decoded = Buffer.from(saved.text || '', 'base64').toString('utf8');
  check('Base64 decoded export has no fixture session despite left=0', !decoded.includes(session), 'left=' + exported.left);
  check('Base64 JSON preserves non-secret data', decoded.includes('"ok":true'));
  eq('Base64 original entry unchanged', JSON.stringify(encoded), encodedBefore);

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

// ---------- Base64 bodies ----------
// Independent decoding oracle: Buffer and TextDecoder, no production redaction helpers.
{
  const secret = 'fixtureSession123456789';
  const cases = [
    ['application/json', JSON.stringify({ nested: { token: secret }, echo: secret, ok: true })],
    ['application/problem+json; charset=UTF-8', JSON.stringify({ password: secret, ok: true })],
    ['text/html', '<p data-id="' + secret + '">public</p>'],
    ['application/javascript', 'const echo="' + secret + '";'],
    ['image/svg+xml', '<svg><desc>' + secret + '</desc></svg>'],
    ['application/x-www-form-urlencoded', 'password=' + secret + '&ok=1'],
  ];
  for (const [mime, text] of cases) {
    const entry = baseEntry();
    entry.request.headers = [{ name: 'Authorization', value: 'Bearer ' + secret }];
    entry.response.content = { size: Buffer.byteLength(text), compression: 4, mimeType: mime, encoding: 'base64', text: Buffer.from(text).toString('base64') };
    const before = JSON.stringify(entry);
    const result = one(entry);
    const content = JSON.parse(result.json).log.entries[0].response.content;
    const bytes = Buffer.from(content.text || '', 'base64');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    check(mime + ': decoded export removes known secret', !decoded.includes(secret) && decoded.includes('redacted'));
    eq(mime + ': size = decoded bytes', content.size, bytes.length);
    eq(mime + ': stale compression omitted', content.compression, undefined);
    eq(mime + ': one decoded Base64 body reported', result.coverage?.base64, 1);
    eq(mime + ': original unchanged', JSON.stringify(entry), before);
  }
  for (const [label, mime, encoding, text, reason] of [
    ['binary', 'image/png', 'base64', 'iVBORw0KGgo=', 'binary'],
    ['missing MIME', '', 'base64', 'aGVsbG8=', 'binary'],
    ['bad alphabet', 'application/json', 'base64', '%%%bad', 'base64'],
    ['bad UTF8', 'text/plain', 'base64', Buffer.from([0xc3, 0x28]).toString('base64'), 'charset'],
    ['unsupported charset', 'text/plain; charset=shift_jis', 'base64', 'aGVsbG8=', 'charset'],
    ['unknown encoding', 'text/plain', 'gzip', 'opaque-data', 'encoding'],
  ]) {
    const entry = baseEntry();
    entry.response.content = { size: 80, compression: 4, mimeType: mime, encoding, text };
    const result = one(entry);
    const content = JSON.parse(result.json).log.entries[0].response.content;
    eq(label + ': opaque body removed', [content.text, content.encoding], [undefined, undefined]);
    eq(label + ': removal reason counted', result.coverage?.removed?.[reason], 1);
    eq(label + ': response body not counted as retained', result.kept.res, 0);
    eq(label + ': captured timing/size metadata retained', [content.size, result.har.log.entries[0].time], [80, 3]);
  }
  const entry = baseEntry();
  const escaped = [...secret].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  entry.request.headers = [{ name: 'Cookie', value: 'sid=' + secret }];
  entry.request.postData = { mimeType: 'application/json', encoding: 'base64', text: Buffer.from('{"echo":"' + escaped + '"}').toString('base64') };
  entry.response.content = { mimeType: 'text/plain', size: 100, encoding: 'base64', text: Buffer.from(secret + ' ' + Buffer.from(secret).toString('base64')).toString('base64') };
  const result = one(entry);
  const saved = JSON.parse(result.json).log.entries[0];
  const request = JSON.parse(Buffer.from(saved.request.postData.text, 'base64').toString());
  check('escaped JSON echo independently scanned', request.echo !== secret);
  check('encoded known-value variant removed', !Buffer.from(saved.response.content.text, 'base64').toString().includes(Buffer.from(secret).toString('base64')));
  const off = one(entry, { everywhere: false });
  check('everywhere off: decoded residue counted', off.left > 0);
  const token = baseEntry();
  token.response.content = { mimeType: 'application/json', encoding: 'base64', text: Buffer.from(JSON.stringify({ echo: 'Bearer ' + secret })).toString('base64') };
  check('overview inspects decoded Base64 tokens', E.scanSensitive({ log: { entries: [token] } }).tokens > 0);
  const binaryWs = baseEntry({ _webSocketMessages: [{ opcode: 2, data: 'opaque-binary' }] });
  eq('binary WebSocket message removed in copy', one(binaryWs).har.log.entries[0]._webSocketMessages[0].data, undefined);
  for (const mime of ['application/json-binary', 'application/javascript-opaque', 'image/svg+xml-binary']) {
    const e = baseEntry();
    e.response.content = { mimeType: mime, size: 99, compression: 4, encoding: 'base64', text: Buffer.from(secret).toString('base64') };
    const r = one(e);
    eq(mime + ': MIME must match completely', r.coverage.removed.binary, 1);
    eq(mime + ': removed body omits compression', r.har.log.entries[0].response.content.compression, undefined);
  }
  const upper = clone(entry);
  upper.request.postData.encoding = 'BASE64';
  upper.response.content.encoding = 'Base64';
  const up = one(upper);
  const u = JSON.parse(up.json).log.entries[0];
  check('case-insensitive encoding: decoded echo replaced', !Buffer.from(u.request.postData.text, 'base64').toString().includes(secret));
  eq('postData has no invented HAR content size', u.request.postData.size, undefined);
  eq('encoding normalized on export', [u.request.postData.encoding, u.response.content.encoding], ['base64', 'base64']);
  const dropped = one(upper, { dropReq: true, dropRes: true });
  eq('explicit request removal omits text and encoding', [dropped.har.log.entries[0].request.postData.text, dropped.har.log.entries[0].request.postData.encoding], [undefined, undefined]);
  upper.response.content.compression = 4;
  eq('explicit response removal omits compression', one(upper, { dropRes: true }).har.log.entries[0].response.content.compression, undefined);
  const commented = { log: { version: '1.2', comment: 'Echo: ' + secret, entries: [upper] } };
  const cr = E.redactHar(commented, { tokens: true, everywhere: true });
  check('log.comment does not reintroduce removed secret', !cr.error && !JSON.parse(cr.json).log.comment.includes(secret));
}

// ---------- Base64 runs and the known-value pattern ----------
{
  const withHeader = (value, body, mime = 'text/plain') => {
    const e = baseEntry();
    e.request.headers = [{ name: 'Authorization', value: 'Bearer ' + value }];
    e.response.content = { size: body.length, mimeType: mime, text: body };
    return one(e);
  };
  const v8 = 'ab12cd34'; // 8 characters: Base64 without padding is 11 characters
  const r1 = withHeader(v8, 'id=' + Buffer.from(v8).toString('base64').replace(/=+$/, '') + ' end');
  check('11-character unpadded Base64 of an 8-character value replaced', !r1.json.includes(Buffer.from(v8).toString('base64').replace(/=+$/, '')) && r1.json.includes('id=[redacted] end'));
  const long = 'fixtureSession123456789';
  const wrapped = Buffer.from('{"user":"demo","sid":"' + long + '","n":1}').toString('base64url');
  const r2 = withHeader(long, 'token ' + wrapped + ' tail');
  check('value inside a longer Base64url run: run replaced', r2.json.includes('token [redacted] tail'));
  const r3 = withHeader(long, 'plain ' + Buffer.from('nothing secret in here').toString('base64') + ' text');
  check('unrelated Base64 run kept', r3.json.includes(Buffer.from('nothing secret in here').toString('base64')));
  // Longest value wins when one removed value is a prefix of another.
  const e4 = baseEntry();
  e4.request.headers = [{ name: 'Cookie', value: 'a=prefixValue123; b=prefixValue123456789' }];
  e4.response.content = { size: 10, mimeType: 'text/plain', text: 'x prefixValue123456789 y prefixValue123 z' };
  const r4 = one(e4);
  check('longest removed value replaced whole', JSON.parse(r4.json).log.entries[0].response.content.text === 'x [redacted] y [redacted] z');
  const huge = 'q1' + 'x'.repeat(200000);
  const e5 = baseEntry();
  e5.request.headers = [{ name: 'X-Api-Key', value: huge }];
  e5.response.content = { size: 10, mimeType: 'text/plain', text: 'echo ' + huge };
  let r5; try { r5 = one(e5); } catch (err) { r5 = { error: String(err) }; }
  check('200,000-character removed value: no stack overflow, echo replaced', !r5.error && !r5.json.includes(huge), String(r5.error));
  const many = baseEntry();
  many.request.headers = Array.from({ length: 3000 }, (_, i) => ({ name: 'X-Token-' + i, value: 'tok' + i + 'abcdefgh' }));
  many.response.content = { size: 10, mimeType: 'text/plain', text: 'tok2999abcdefgh '.repeat(2000) + 'x'.repeat(2e6) };
  const t0 = performance.now();
  const r6 = one(many);
  const ms = performance.now() - t0;
  check('3,000 removed values over 2 MB of text: replaced', !r6.json.includes('tok2999abcdefgh'));
  check('3,000 removed values over 2 MB of text: under 1.5 s', ms < 1500 * PERF_SLACK, ms.toFixed(0) + ' ms');
}

// ---------- sliced redaction and cURL ----------
// The page runs loadJob, redactJob and curlJob in slices on its own thread (no Worker).
// redactJob must give the same bytes and report as the single-pass redaction it replaced,
// written out here from the previous redactHar, for any slice boundary.
{
  const main = componentSrc.slice(ei, componentSrc.indexOf('</script>', ei));
  for (const fn of ['redactHar(', 'buildIndex(', 'scanSensitive(', 'readHarText(', 'curlJoin(', 'new Worker', 'postMessage(m'])
    check('page code does not call ' + fn, !main.includes(fn));
  for (const fn of ['loadJob(', 'redactJob(', 'curlJob(', 'runJob(job, gen', 'gen !== taskGen', "priority: 'user-blocking'"])
    check('page code runs work in slices: ' + fn, main.includes(fn));
  check('engine has no worker code left', !componentSrc.includes('worker:start') && !componentSrc.includes('harWorkerMain'));

  const legacy = (har, opts, indices, meta) => {
    const log = har.log, ctx = E.newCtx(opts || {}), out = { log: {} };
    Object.keys(log).forEach((k) => { if (k !== 'entries' && k !== 'pages') out.log[k] = structuredClone(log[k]); });
    const list = indices ? indices.map((i) => log.entries[i]) : log.entries;
    out.log.entries = list.map((e) => E.redactEntry(structuredClone(e), ctx));
    if (Array.isArray(log.pages)) {
      const refs = new Set(out.log.entries.map((e) => (e && typeof e === 'object' && !Array.isArray(e) ? e.pageref : undefined)));
      out.log.pages = log.pages.filter((p) => !indices || !(p && typeof p === 'object' && !Array.isArray(p)) || refs.has(p.id)).map((p) => {
        const c = structuredClone(p);
        if (c && typeof c === 'object' && typeof c.title === 'string') c.title = E.redactUrl(c.title, ctx);
        return c;
      });
    }
    const re = E.residueRegex(ctx.removed);
    if (re && ctx.opts.everywhere) E.replaceKnown(out.log, re, ctx);
    const note = 'Redacted with ZeroTool HAR Analyzer (https://zerotool.dev/tools/har-file-analyzer/): ' + (meta && meta.summary ? meta.summary : 'credentials replaced by [redacted].');
    out.log.comment = out.log.comment ? String(out.log.comment) + '\n' + note : note;
    const json = JSON.stringify(out, null, 2), check = JSON.parse(json);
    const left = re ? E.countResidue(check.log, re) : 0;
    if (left && ctx.opts.everywhere) return { error: 'residue', count: left };
    let total = 0;
    ['credentials', 'cookies', 'params', 'body', 'tokens', 'elsewhere', 'ips'].forEach((k) => { total += ctx.counts[k]; });
    return { har: check, json, counts: ctx.counts, kept: ctx.kept, names: Array.from(ctx.names), total, left, entries: check.log.entries.length, coverage: ctx.coverage };
  };
  const secret = 'fixtureSession123456789';
  const har = E.sampleHar();
  har.log.comment = 'see ' + secret;
  har.log.entries[0].response.content = { size: 40, mimeType: 'application/json', encoding: 'base64', text: Buffer.from(JSON.stringify({ echo: secret })).toString('base64') };
  har.log.entries[0].request.headers.push({ name: 'Authorization', value: 'Bearer ' + secret });
  har.log.entries[3].response.content = { size: 9, mimeType: 'image/png', encoding: 'base64', text: Buffer.from('PNG' + secret).toString('base64') };
  har.log.entries.push('raw ' + secret, null, 7);
  har.log.pages.push({ id: 'page_x', title: 'https://x.example/?sid=' + secret });
  const before = JSON.stringify(har);
  const all = { tokens: true, everywhere: true, dropReq: false, dropRes: false, ips: false, extra: '' };
  const cases = [
    ['all entries', all, null, undefined],
    ['subset', all, [4, 5, 10], undefined],
    ['not everywhere', Object.assign({}, all, { everywhere: false }), null, undefined],
    ['drop bodies, ips, extra names', Object.assign({}, all, { dropReq: true, dropRes: true, ips: true, extra: 'theme' }), null, { summary: 'custom note' }],
    ['no tokens', Object.assign({}, all, { tokens: false }), [0, 1, 2], undefined],
  ];
  for (const [label, opts, indices, meta] of cases) {
    const want = legacy(har, opts, indices, meta);
    for (const every of [1, 2, 5, 1e9]) {
      const job = E.redactJob(har, opts, indices, meta);
      let calls = 0, slices = 1;
      while (!job.step(() => ++calls % every === 0)) slices++;
      const got = job.result;
      if (want.error) { eq('redactJob ' + label + ' / ' + every + ': residue error', got, want); continue; }
      eq('redactJob ' + label + ' / ' + every + ': bytes', got.json, want.json);
      eq('redactJob ' + label + ' / ' + every + ': report', [got.counts, got.kept, got.names, got.total, got.left, got.entries, got.coverage], [want.counts, want.kept, want.names, want.total, want.left, want.entries, want.coverage]);
      if (every === 1) check('redactJob ' + label + ': yields between entries', slices > (indices || har.log.entries).length, String(slices));
      check('redactJob ' + label + ': step after done stays done', job.step(() => true) === true);
    }
    check('redactHar equals legacy: ' + label, JSON.stringify(E.redactHar(har, opts, indices, meta).json) === JSON.stringify(want.json));
  }
  const res = E.redactHar(har, all, null);
  check('sliced export has no decoded secret', !Buffer.from(JSON.parse(res.json).log.entries[0].response.content.text, 'base64').toString().includes(secret) && !res.json.includes(secret));
  check('original HAR unchanged by redactJob', JSON.stringify(har) === before);

  const order = [5, 0, 4, 9];
  for (const [platform, redact] of [['unix', true], ['win', true], ['unix', false]]) {
    const ctx = E.newCtx({ tokens: true });
    const want = E.curlJoin(order.map((i) => { let e = har.log.entries[i]; if (redact) e = E.redactEntry(structuredClone(e), ctx); return E.curlFor(e, platform); }).filter(Boolean), platform);
    for (const every of [1, 3, 1e9]) {
      const job = E.curlJob(har, order, platform, redact);
      let calls = 0;
      while (!job.step(() => ++calls % every === 0));
      eq('curlJob ' + platform + (redact ? ' masked' : '') + ' / ' + every, job.result, want);
    }
  }
  const empty = E.curlJob(har, [], 'unix', true);
  eq('curlJob with no requests', [empty.step(() => true), empty.result], [true, '']);
}

// ---------- removed values split over several patterns ----------
// One prefix-tree pattern for 11,045 values took V8 33 s to run the first time; the values are
// split so no pattern gets that large. Values that start alike must still be matched longest
// first, also when their group is split.
{
  const removed = new Map();
  for (let i = 0; i < 6000; i++) removed.set('tok-' + i + '-abcdefghijk', 1);
  for (let i = 0; i < 3000; i++) removed.set('sharedPfx' + String(i).padStart(5, '0'), 1);
  removed.set('sharedPfx00001-and-longer', 1);
  removed.set('pw-7-correct-horse', 1);
  const t0 = performance.now();
  const res = E.residueRegex(removed);
  check('many values: several patterns', Array.isArray(res) && res.length > 2, String(res.length));
  check('many values: each pattern under 40,000 characters', res.every((r) => r.source.length < 40000), res.map((r) => r.source.length).join(','));
  const ctx = E.newCtx({ tokens: true, everywhere: true });
  const x = { a: 'x tok-5999-abcdefghijk y', b: 'see sharedPfx00001-and-longer!', c: 'sharedPfx02999 and pw-7-correct-horse', d: Buffer.from('id=sharedPfx01500').toString('base64') };
  E.replaceKnown(x, res, ctx);
  eq('many values: all replaced, longest first', x, { a: 'x [redacted] y', b: 'see [redacted]!', c: '[redacted] and [redacted]', d: '[redacted]' });
  const ms = performance.now() - t0;
  check('many values: first use under 3 s', ms < 3000 * PERF_SLACK, ms.toFixed(0) + ' ms');
  eq('many values: residue count', E.countResidue({ s: 'tok-1-abcdefghijk sharedPfx00001-and-longer' }, res), 2);
}

// ---------- sliced opening ----------
// loadJob runs buildIndex and scanSensitive one entry at a time; any slice boundary must give
// the same result as the direct calls.
{
  const secret = 'fixtureSession123456789';
  const har = E.sampleHar();
  har.log.entries.push(42, null);
  har.log.entries[1].response.content = { size: 40, mimeType: 'text/plain', encoding: 'base64', text: Buffer.from('Bearer ' + secret + 'abcdefghij').toString('base64') };
  har.log.entries[2].request.url += '&access_token=' + secret;
  const wantIdx = structuredClone(E.buildIndex(har)), wantSens = E.scanSensitive(har);
  for (const every of [1, 2, 3, 7, 1e9]) {
    const job = E.loadJob(har);
    let calls = 0, steps = 0;
    while (!job.step(() => ++calls % every === 0)) steps++;
    eq('loadJob index, slice every ' + every, structuredClone(job.idx), wantIdx);
    eq('loadJob scan, slice every ' + every, job.sens, wantSens);
    if (every === 1) check('loadJob yields after each entry', steps >= har.log.entries.length * 3 - 1, String(steps));
    check('loadJob step after done stays done', job.step(() => true) && job.idx !== null);
  }
  check('loadJob scan found the Base64 token', wantSens.tokens > 0 && wantSens.params > 0);
}

// ---------- whole-file residue scan of a redacted copy ----------
// Oracle independent of the engine: walk every string of the saved JSON, decode every
// `encoding: base64` text with Buffer, and look for the secret and its Base64 / URL forms.
{
  const secret = 'fixtureSession123456789';
  const b64 = Buffer.from(secret).toString('base64');
  const forms = [secret, b64, b64.replace(/=+$/, ''), b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), encodeURIComponent(secret)];
  const mk = (mime, text, enc = 'base64') => { const e = baseEntry(); e.response.content = { size: Buffer.byteLength(text), mimeType: mime, encoding: enc, text: enc === 'base64' ? Buffer.from(text).toString('base64') : text }; return e; };
  const entries = [
    baseEntry({ request: Object.assign(baseEntry().request, { headers: [{ name: 'Authorization', value: 'Bearer ' + secret }] }) }),
    mk('application/json', JSON.stringify({ deep: [{ v: secret }], b: b64 })),
    mk('text/html; charset=utf-8', '<html data-x="' + secret + '"></html>'),
    mk('image/png', 'PNG' + secret),
    mk('text/plain; charset=euc-kr', secret),
    mk('application/octet-stream', secret),
    baseEntry({ _webSocketMessages: [{ type: 'receive', opcode: 1, data: '{"s":"' + secret + '"}' }, { type: 'receive', opcode: 2, data: b64 }] }),
  ];
  const har = { log: { version: '1.2', creator: { name: 't', version: '1' }, entries } };
  const before = JSON.stringify(har);
  const res = E.redactHar(har, { tokens: true, everywhere: true }, null);
  check('whole file: export succeeded', !res.error, JSON.stringify(res.error));
  const hits = [];
  const walk = (x, path) => {
    if (typeof x === 'string') { for (const f of forms) if (x.includes(f)) hits.push(path + ' raw'); return; }
    if (Array.isArray(x)) return x.forEach((y, i) => walk(y, path + '[' + i + ']'));
    if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) walk(x[k], path + '.' + k);
      if (typeof x.text === 'string' && String(x.encoding).toLowerCase() === 'base64') {
        const t = Buffer.from(x.text, 'base64').toString('latin1') + '\n' + Buffer.from(x.text, 'base64').toString('utf8');
        for (const f of forms) if (t.includes(f)) hits.push(path + '.text decoded');
      }
    }
  };
  walk(JSON.parse(res.json), 'root');
  eq('whole file: independent scan finds no secret form', hits, []);
  eq('whole file: engine left count', res.left, 0);
  eq('whole file: coverage', res.coverage, { base64: 2, removed: { binary: 3, base64: 0, charset: 1, encoding: 0 } });
  eq('whole file: original HAR unchanged', JSON.stringify(har), before);
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
