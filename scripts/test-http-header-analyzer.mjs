// HTTP Header Analyzer — parsing, hints and the claims on the tool pages
//
// Read:  src/components/tools/HttpHeaderAnalyzerTool.astro (extracts HEADER_DB and the functions
//        from detectType to applyHints), src/content/tools/http-header-analyzer/{en,zh,ja,ko}.mdx,
//        src/data/persistence.ts
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: request / response / header-only detection, obs-fold, HTTP/2 pseudo-headers skipped; the
// hints for the problem response on the English page; the credentials warning is dropped when the
// pasted headers name a specific Allow-Origin (it used to show for every credentialed response);
// the X-XSS-Protection description no longer recommends `1; mode=block`; the SameSite note no
// longer says every browser defaults to Lax; the header count in the four seoDescriptions matches
// HEADER_DB; the page stays `disabled` in persistence.ts and the script stores nothing.
//
// Run: node scripts/test-http-header-analyzer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HttpHeaderAnalyzerTool.astro'), 'utf8');
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, `src/content/tools/http-header-analyzer/${l}.mdx`), 'utf8')]));
const dbStart = source.indexOf('var HEADER_DB');
const dbEnd = source.indexOf('var CATEGORY_ORDER');
const fnStart = source.indexOf('function detectType');
const fnEnd = source.indexOf('function localizedCategory');
if (dbStart < 0 || dbEnd <= dbStart || fnStart < 0 || fnEnd <= fnStart) {
  console.error('FAIL: could not locate HEADER_DB or the parser in HttpHeaderAnalyzerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(dbStart, dbEnd) + source.slice(fnStart, fnEnd) + '\nreturn { parseHeaders, HEADER_DB };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}
const hintsOf = (parsed, name) => parsed.headers.filter((h) => h.lower === name).flatMap((h) => h.hints.map((x) => x.sev + ': ' + x.text));

// detection and parsing
eq('response', E.parseHeaders('HTTP/1.1 404 Not Found\nX-A: 1').type, 'response');
eq('request', E.parseHeaders('OPTIONS /api HTTP/1.1\nHost: a').type, 'request');
eq('PROPFIND is not recognized', E.parseHeaders('PROPFIND /a HTTP/1.1\nHost: a').type, 'unknown');
eq('obs-fold', E.parseHeaders('X-Long: a\n  b').headers[0].value, 'a b');
eq('HTTP/2 pseudo-headers skipped', E.parseHeaders(':status: 200\ncontent-type: text/plain').headers.map((h) => h.name), ['content-type']);
eq('header count', Object.keys(E.HEADER_DB).length, 88);
eq('unknown header is custom', E.parseHeaders('X-Request-Id: 7f3a').headers[0].cat, 'custom');

// the problem response on the English page
const problem = [
  'HTTP/2 200',
  'content-type: text/html; charset=utf-8',
  'strict-transport-security: max-age=86400',
  "content-security-policy: script-src 'self' 'unsafe-inline'",
  'access-control-allow-origin: *',
  'access-control-allow-credentials: true',
  'set-cookie: sid=31d4d96e407aad42; Path=/',
  'cache-control: no-store, max-age=600',
  'server: nginx',
].join('\n');
eq('page shows the problem response', pages.en.includes(problem), true);
const p = E.parseHeaders(problem);
eq('problem: response', [p.type, p.statusLine], ['response', 'HTTP/2 200']);
eq('problem: HSTS', hintsOf(p, 'strict-transport-security')[0], 'warn: max-age < 1 year (31536000s). Many preload lists require ≥ 1 year.');
eq('problem: CSP', hintsOf(p, 'content-security-policy'), ["warn: 'unsafe-inline' defeats most XSS protection. Use nonces or hashes instead.", 'info: No default-src — define one as a safety net.']);
eq('problem: credentials with *', hintsOf(p, 'access-control-allow-credentials'), ['warn: Credentialed CORS requires explicit Allow-Origin (no wildcard).']);
eq('problem: cookie', hintsOf(p, 'set-cookie').length, 3);
eq('problem: cache-control', hintsOf(p, 'cache-control'), ['warn: no-store and max-age together — no-store wins, max-age is dead weight.']);
eq('problem: server', hintsOf(p, 'server').length, 1);
for (const quote of [
  'max-age &lt; 1 year (31536000s). Many preload lists require ≥ 1 year.',
  "'unsafe-inline' defeats most XSS protection. Use nonces or hashes instead.",
  'Credentialed CORS requires explicit Allow-Origin (no wildcard).',
]) eq('page quotes ' + quote, pages.en.includes(quote), true);

// credentials warning only with a wildcard or no origin
const explicit = E.parseHeaders('HTTP/1.1 200 OK\nAccess-Control-Allow-Origin: https://app.example.com\nAccess-Control-Allow-Credentials: true');
eq('explicit origin: no credentials warning', hintsOf(explicit, 'access-control-allow-credentials'), []);
const alone = E.parseHeaders('HTTP/1.1 200 OK\nAccess-Control-Allow-Credentials: true');
eq('no origin pasted: warning stays', hintsOf(alone, 'access-control-allow-credentials').length, 1);

// texts that used to be wrong
eq('X-XSS-Protection description', /mode=block is the safer/.test(E.HEADER_DB['x-xss-protection'].desc), false);
eq('SameSite note', hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nSet-Cookie: a=b; Secure; HttpOnly'), 'set-cookie'), ['info: No SameSite — Chrome treats the cookie as Lax, Firefox and Safari do not. Set it explicitly.']);
eq('cookie name containing httponly', hintsOf(E.parseHeaders('HTTP/1.1 200 OK\nSet-Cookie: httponly=1; Secure; SameSite=Lax'), 'set-cookie').length, 1);

// header count claims and sensitive page
const n = String(Object.keys(E.HEADER_DB).length);
for (const [lang, text] of Object.entries(pages)) {
  const desc = /^seoDescription: "(.*)"$/m.exec(text)[1];
  eq(lang + ': seoDescription states the header count', desc.includes(n) && !desc.includes('100+'), true);
  eq(lang + ': no fetch -v', text.includes('fetch -v'), false);
}
eq('persistence disabled', /'http-header-analyzer': 'disabled'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')), true);
eq('script stores nothing', /localStorage|sessionStorage|ztPersist|fetch\(/.test(source), false);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
