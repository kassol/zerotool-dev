// Cookie Parser — Cookie header, Set-Cookie and cookies.txt engine
//
// Read:  src/components/tools/CookieParserTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so the test
//        runs the shipped code); src/components/tools/HarFileAnalyzerTool.astro (the redaction
//        helpers are copies); scripts/test-cookie-parser.fixtures.json (what Chromium 152 stored
//        for 79 Set-Cookie cases and which Cookie headers it sent, recorded 2026-10-02);
//        node_modules/astro/node_modules/cookie (the "cookie" package, compared at 1.1.1 only);
//        src/content/tools/cookie-parser/{lang}.mdx (`ck-check` annotations are re-run);
//        src/data/persistence.ts; src/data/public-suffix-list.mjs (the list the page loads) and
//        scripts/sync-public-suffix-list.mjs (its pinned version); scripts/test-cookie-parser.test_psl.txt
//        (tests/test_psl.txt of the same Public Suffix List commit, CC0, the oracle)
// Write: stdout only (Python checks pipe through a child process; no files)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: draft-ietf-httpbis-rfc6265bis-22 (§5.1.1 dates, §5.1.3–5.1.4, §5.6 parsing, §5.7
// storage, §5.8.3 order); draft-ietf-httpbis-layered-cookies-02 §4.1.3 (__Http-, __Host-Http-);
// draft-cutler-httpbis-partitioned-cookies-01 §2.3; RFC 6265 §4.1.1 (cookie-octet); Fetch §2.2.2
// (Headers.get joins Set-Cookie with ", "); curl.se/docs/http-cookies.html (cookies.txt).
//
// Covers:
// - A-COOKIE-PUBLIC-SUFFIX: a Domain attribute on a public suffix (co.uk, github.io, wildcard and
//   exception rules, unlisted TLDs) is rejected in analyzeSetCookie, kept out of buildJar and not
//   sent by simulate (cookies.txt included); the 78 test_psl.txt vectors; "unknown" before the
//   list is loaded.
// - Defects of the old parser (split on ";" only): "Set-Cookie: a=1" read as a cookie named
//   "Set-Cookie: a"; JSON kept the last of two same-name cookies (Express keeps the first);
//   a cookie named path / secure / domain in a Cookie header was dropped as a "flag"; "abc"
//   without "=" was dropped (RFC 6265bis: a cookie with an empty name); Set-Cookie attributes
//   were shown as text, never checked.
// - The cookie date algorithm and the Set-Cookie verdicts against what Chromium 152 stored for
//   the same lines; the deviations Chromium has from RFC 6265bis are listed and asserted.
// - Cookie header order from the request simulation against the headers Chromium sent.
// - Cookie header parsing against the "cookie" package 1.1.1 on 3,000 random headers.
// - Python 3.12 http.cookies claims made on the page (skipped on other versions).
// - Input splitting (header names, curl -v / -i, curl -b / -H, combined Set-Cookie values,
//   other headers), cookies.txt, redaction (no removed value left), the builder round trip,
//   UTF-8 byte counts, 4-language STRINGS keys and placeholders, every engine code has text,
//   the script writes no HTML and stores or sends nothing, persistence is `disabled`.
//
// Run: node scripts/test-cookie-parser.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { domainToASCII } from 'node:url';
import vm from 'node:vm';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CookieParserTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CookieParserTool.astro');
  process.exit(1);
}
const engineSrc = source.slice(startIndex, endIndex);
const E = new Function(engineSrc + `
return { REDACTED, utf8Len, isToken, parseCookieDate, domainMatch, defaultPath, pathMatch, isSecureUrl, parseUrl,
  decodeValue, inspectValue, knownCookie, sensitiveReason, looksRandom, parseCookieHeader, parseSetCookie, analyzeSetCookie,
  splitCombined, splitInput, parseNetscape, buildJar, simulate, buildSetCookie, redactCookieHeader, redactSetCookie,
  cookiesToJson, setCookiesToJson, isSensitiveName, suggestAttr,
  setPublicSuffixList, publicSuffixOf, registrableDomain, publicSuffixCheck };`)();
// The page loads the Public Suffix List before it judges any Set-Cookie line or cookies.txt
// file; the tests do the same with the module the page imports.
const PSL_DATA = (await import(new URL('../src/data/public-suffix-list.mjs', import.meta.url))).default;
E.setPublicSuffixList(PSL_DATA);

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log(`FAIL: ${name}${detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
function eq(name, a, b) { const x = JSON.stringify(a), y = JSON.stringify(b); check(name, x === y, `got ${x}\n      want ${y}`); }
function skip(name, why) { skips++; console.log(`SKIP: ${name} (${why})`); }

const NOW = Date.UTC(2026, 9, 2, 3, 0, 0);
const U = (s) => E.parseUrl(s).url;
function analyze(line, url = 'https://www.example.com/account/login', now = NOW) {
  return E.analyzeSetCookie(E.parseSetCookie(line), { now, url: url ? U(url) : null });
}
const codes = (a) => a.issues.map((x) => x.code);
const rcodes = (a) => a.reject.map((x) => x.code);

// A-COOKIE-PUBLIC-SUFFIX: exercise the shipped storage and request paths.
{
  const r = analyze('sid=x; Domain=co.uk; Path=/; Secure; HttpOnly; SameSite=Lax', 'https://shop.co.uk/');
  eq('public suffix co.uk is rejected for shop.co.uk', r.verdict, 'rejected');
  eq('public suffix cookie never enters the jar', E.buildJar([r], NOW).length, 0);
  eq('public suffix cookie is never sent to another registrant', E.simulate(E.buildJar([r], NOW), U('https://other.co.uk/'), 'same-site', NOW).header, '');
}

// ── Public Suffix List ───────────────────────────────────────────────────────
// Data: src/data/public-suffix-list.mjs, generated by scripts/sync-public-suffix-list.mjs from the
// pinned commit. Oracle: tests/test_psl.txt of the same commit (CC0, kept verbatim as
// scripts/test-cookie-parser.test_psl.txt); no PSL library is in the lockfile.
{
  const sync = await import(new URL('./sync-public-suffix-list.mjs', import.meta.url));
  const modText = readFileSync(join(root, 'src/data/public-suffix-list.mjs'), 'utf8');
  eq('PSL module: version and commit match the sync script', [PSL_DATA.version, PSL_DATA.commit, PSL_DATA.sha256], [sync.VERSION, sync.COMMIT, sync.SHA256_GIT]);
  check('PSL module: MPL-2.0 notice and source are in the file', /Mozilla Public License, v\. 2\.0/.test(modText) && modText.includes(sync.SOURCE_URL) && PSL_DATA.license === 'MPL-2.0' && PSL_DATA.source === sync.SOURCE_URL && PSL_DATA.licenseUrl === 'https://mozilla.org/MPL/2.0/');
  const icann = PSL_DATA.icann.split('\n'), priv = PSL_DATA.private.split('\n');
  eq('PSL module: rule counts (ICANN, PRIVATE)', [icann.length, priv.length], [6949, 3384]);
  check('PSL module: has wildcard and exception rules in both sections', icann.some((r) => r.startsWith('*.')) && icann.some((r) => r[0] === '!') && priv.some((r) => r.startsWith('*.')));
  check('PSL module: rules are ASCII, lowercase, without spaces', [...icann, ...priv].every((r) => /^[!*a-z0-9.\-_]+$/.test(r)), [...icann, ...priv].find((r) => !/^[!*a-z0-9.\-_]+$/.test(r)));
  check('PSL module: no duplicate rules', new Set([...icann, ...priv]).size === icann.length + priv.length);
  check('PSL module: Unicode rules are present as punycode', icann.includes('xn--55qx5d.cn') && icann.includes('xn--fiqs8s'));

  const vectors = readFileSync(join(root, 'scripts/test-cookie-parser.test_psl.txt'), 'utf8');
  check('test_psl.txt is the pinned copy', sync.sha256(vectors) === '8f50ad958916d6a8f79fba2363501475571acce752757f9126fe9d2f17dd920d');
  const ascii = (d) => (d == null ? null : /[^\x00-\x7f]/.test(d) ? domainToASCII(d) : d.toLowerCase());
  let n = 0;
  for (const m of vectors.matchAll(/^checkPublicSuffix\((null|'[^']*'), (null|'[^']*')\);$/gm)) {
    const input = m[1] === 'null' ? null : m[1].slice(1, -1);
    const want = m[2] === 'null' ? null : ascii(m[2].slice(1, -1));
    const d = ascii(input);
    const got = d == null || d === '' || d[0] === '.' ? null : E.registrableDomain(d);
    eq(`test_psl.txt: ${m[1]} → ${m[2]}`, got, want);
    n++;
  }
  eq('test_psl.txt: every vector ran (commented-out lines excluded)', n, 78);

  // The list against the Domain attribute (RFC 6265bis §5.7 step 9), through all three entries.
  const verdictOf = (line, url) => analyze(line, url).verdict;
  const pub = analyze('a=1; Domain=co.uk', 'https://shop.co.uk/');
  eq('Domain=co.uk: rejected, ICANN rule', [pub.verdict, rcodes(pub), pub.reject[0].vars.rule], ['rejected', ['domainPublicSuffix'], 'co.uk']);
  const gh = analyze('a=1; Domain=github.io; Secure', 'https://user.github.io/');
  eq('Domain=github.io: rejected, PRIVATE section', [gh.verdict, rcodes(gh)], ['rejected', ['domainPrivateSuffix']]);
  eq('Domain=.CO.UK (dot, upper case) is also rejected', verdictOf('a=1; Domain=.CO.UK', 'https://shop.co.uk/'), 'rejected');
  eq('wildcard *.kawasaki.jp: Domain=foo.kawasaki.jp is a public suffix', rcodes(analyze('a=1; Domain=foo.kawasaki.jp', 'https://a.foo.kawasaki.jp/')), ['domainPublicSuffix']);
  eq('exception !city.kawasaki.jp: Domain=city.kawasaki.jp is kept', verdictOf('a=1; Domain=city.kawasaki.jp', 'https://www.city.kawasaki.jp/'), 'stored');
  eq('unlisted TLD (default rule *): Domain=example is rejected', rcodes(analyze('a=1; Domain=example', 'https://a.example/')), ['domainPublicSuffix']);
  eq('unlisted TLD: Domain=b.example is kept', verdictOf('a=1; Domain=b.example', 'https://a.b.example/'), 'stored');
  const sameHost = analyze('a=1; Domain=github.io; Secure', 'https://github.io/');
  eq('Domain equal to a public-suffix host becomes host-only', [sameHost.verdict, sameHost.hostOnly, sameHost.domain, codes(sameHost).includes('domainSuffixHost'), codes(sameHost).includes('domainWide')], ['stored', true, 'github.io', true, false]);
  eq('without a response URL, Domain=co.uk is still rejected', verdictOf('a=1; Domain=co.uk', null), 'rejected');
  eq('Domain=co.uk from another host reports the public suffix, not a mismatch', rcodes(analyze('a=1; Domain=co.uk', 'https://www.example.com/')), ['domainPublicSuffix']);
  const reg = analyze('a=1; Domain=example.co.uk; Path=/', 'https://www.example.co.uk/');
  eq('Domain=example.co.uk is kept for its subdomains', [reg.verdict, reg.hostOnly, codes(reg).includes('domainWide')], ['stored', false, true]);
  eq('host-only cookie on a public-suffix host is kept', verdictOf('a=1', 'https://co.uk/'), 'stored');
  eq('IP host with Domain=IP is unaffected', verdictOf('a=1; Domain=127.0.0.1', 'http://127.0.0.1/'), 'stored');
  check('no single-label note once the list is loaded', !codes(analyze('a=1; Domain=localhost', 'http://lab.localhost/')).includes('domainSingleLabel'));
  // Simulation: the registrable cookie reaches siblings, the public-suffix one reaches nobody.
  const jar = E.buildJar([pub, reg], NOW);
  eq('jar holds only the registrable-domain cookie', jar.map((c) => c.domain), ['example.co.uk']);
  eq('sent to shop.example.co.uk, not to other.co.uk', [E.simulate(jar, U('https://shop.example.co.uk/'), 'same-site', NOW).header, E.simulate(jar, U('https://other.co.uk/'), 'same-site', NOW).header], ['a=1', '']);
  // buildJar and simulate apply the list themselves (an analysis object from elsewhere, cookies.txt).
  eq('buildJar drops a domain cookie on a public suffix even if marked stored', E.buildJar([{ ...pub, verdict: 'stored', reject: [] }], NOW).length, 0);
  const ns = E.splitInput('# Netscape HTTP Cookie File\n.co.uk\tTRUE\t/\tFALSE\t0\tsid\tx\n.example.co.uk\tTRUE\t/\tFALSE\t0\tok\t1\nco.uk\tFALSE\t/\tFALSE\t0\thost\t2', 'auto', {});
  const nsJar = ns.netscape.map((e, i) => ({ ...e, sameSite: 'Default', partitioned: false, order: i }));
  const nsSim = E.simulate(nsJar, U('https://other.co.uk/'), 'same-site', NOW);
  eq('cookies.txt: a .co.uk cookie is skipped as a public suffix', [nsSim.header, nsSim.skipped.map((s) => s.why)], ['', ['publicSuffix', 'domain', 'domain']]);
  eq('cookies.txt: a host-only co.uk cookie still reaches co.uk', E.simulate(nsJar, U('https://co.uk/'), 'same-site', NOW).header, 'host=2');
  // Before the list is loaded: no verdict for a Domain attribute, nothing enters the jar or is sent.
  E.setPublicSuffixList(null);
  const pend = analyze('a=1; Domain=example.co.uk', 'https://www.example.co.uk/');
  eq('list not loaded: Domain cookie is "unknown", with the note', [pend.verdict, codes(pend).includes('pslUnknown')], ['unknown', true]);
  eq('list not loaded: host-only cookie is still judged', verdictOf('a=1; Path=/', 'https://www.example.co.uk/'), 'stored');
  eq('list not loaded: other rejections still win', verdictOf('a=1; Domain=other.com', 'https://www.example.co.uk/'), 'rejected');
  eq('list not loaded: an unknown cookie never enters the jar', E.buildJar([pend], NOW).length, 0);
  eq('list not loaded: a cookies.txt domain cookie is not sent', E.simulate(nsJar, U('https://shop.example.co.uk/'), 'same-site', NOW).skipped.map((s) => s.why), ['pslUnknown', 'pslUnknown', 'domain']);
  check('list not loaded: the single-label note is still given', codes(analyze('a=1; Domain=localhost', 'http://lab.localhost/')).includes('domainSingleLabel'));
  E.setPublicSuffixList(PSL_DATA);
  eq('list loaded again: the same line is kept', verdictOf('a=1; Domain=example.co.uk', 'https://www.example.co.uk/'), 'stored');
}

// ── Copied helpers match the HAR analyzer ────────────────────────────────────
const har = readFileSync(join(root, 'src/components/tools/HarFileAnalyzerTool.astro'), 'utf8');
function declaration(src, name) {
  const fn = src.indexOf(`function ${name}(`);
  if (fn >= 0) {
    let i = src.indexOf('{', fn), depth = 0;
    for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
    return src.slice(fn, i + 1).replace(/^\s+/gm, '');
  }
  const v = src.indexOf(`var ${name} = `);
  if (v < 0) return null;
  const opener = src[v + `var ${name} = `.length];
  const m = opener === '[' || opener === '{' ? /\n\s*[\]}];/.exec(src.slice(v)) : /;\n/.exec(src.slice(v));
  return src.slice(v, v + m.index + m[0].length).replace(/^\s+/gm, '');
}
for (const name of ['notFiller', 'base64HasColon', 'TOKEN_RULES', 'SENS_SUBSTR', 'NON_SECRET_TAIL', 'SENS_WORDS', 'normName', 'nameWords', 'isSensitiveName']) {
  const a = declaration(engineSrc, name), b = declaration(har, name);
  check(`${name} is a verbatim copy of HarFileAnalyzerTool.astro`, a && b && a === b, name);
}

// ── Defects of the previous parser ───────────────────────────────────────────
{
  const sp = E.splitInput('Set-Cookie: a=1; Path=/\nSet-Cookie: b=2; HttpOnly', 'auto', {});
  eq('"Set-Cookie:" prefix is not part of the name', sp.setCookies.map((s) => E.parseSetCookie(s.text).name), ['a', 'b']);
  const ch = E.parseCookieHeader('sid=new; theme=dark; sid=old');
  eq('JSON object keeps the first of two same-name cookies (old: the last)', JSON.parse(E.cookiesToJson(ch.pairs, 'object', true)).sid, 'new');
  eq('array JSON keeps both', JSON.parse(E.cookiesToJson(ch.pairs, 'array', true)).map((x) => x.value), ['new', 'dark', 'old']);
  const named = E.parseCookieHeader('lang=en; path=/blog; secure=1; domain=x');
  eq('cookies named path / secure / domain are kept (old: dropped as flags)', named.pairs.map((p) => p.name), ['lang', 'path', 'secure', 'domain']);
  check('… and flagged as attribute-like', named.pairs[1].issues.some((i) => i.code === 'attrInCookie'));
  const ne = E.parseCookieHeader('abc; d=1');
  eq('a pair without "=" is a nameless cookie (old: dropped)', [ne.pairs[0].name, ne.pairs[0].value], ['', 'abc']);
  const sp2 = E.splitInput('session=abc; Path=/; HttpOnly; Secure', 'auto', {});
  check('the old placeholder is read as one Set-Cookie with attributes', sp2.kind === 'set-cookie' && sp2.setCookies.length === 1);
  const a = analyze('session=abc; Path=/; HttpOnly; Secure');
  check('… whose attributes are interpreted', a.secure && a.httpOnly && a.path === '/' && a.verdict === 'stored');
}

// ── Dates (§5.1.1) ───────────────────────────────────────────────────────────
{
  const ok = (s, iso) => { const r = E.parseCookieDate(s); check(`date ${JSON.stringify(s)} → ${iso}`, r.ok && new Date(r.ms).toISOString() === iso, r); };
  const bad = (s) => { const r = E.parseCookieDate(s); check(`date ${JSON.stringify(s)} fails`, !r.ok, r); };
  ok('Wed, 21 Oct 2026 07:28:00 GMT', '2026-10-21T07:28:00.000Z');
  ok('Wednesday, 21-Oct-26 07:28:00 GMT', '2026-10-21T07:28:00.000Z');
  ok('Wed Oct 21 07:28:00 2026', '2026-10-21T07:28:00.000Z');
  ok('Thu, 01 Jan 70 00:00:01 GMT', '1970-01-01T00:00:01.000Z');
  ok('Sun, 06 Nov 1994 08:49:37 GMT', '1994-11-06T08:49:37.000Z'); // RFC 9110 §5.6.7 IMF-fixdate
  ok('Sunday, 06-Nov-94 08:49:37 GMT', '1994-11-06T08:49:37.000Z'); // obsolete RFC 850
  ok('Sun Nov  6 08:49:37 1994', '1994-11-06T08:49:37.000Z'); // asctime
  ok('Wed, 21 Oct 2026 07:28:00 +0900', '2026-10-21T07:28:00.000Z');
  ok('Wed, 21 Oct 2026 7:8:9 GMT', '2026-10-21T07:08:09.000Z');
  ok('Fri, 29 Feb 2028 00:00:00 GMT', '2028-02-29T00:00:00.000Z');
  bad('2026-10-21T07:28:00Z'); bad('Wed, 21 Oct 2026'); bad('tomorrow'); bad('Fri, 01 Jan 1600 00:00:00 GMT');
  bad('Sat, 31 Feb 2027 10:00:00 GMT'); bad('Wed, 21 Oct 2026 24:00:00 GMT'); bad('Thu, 29 Feb 2027 00:00:00 GMT');
  check('two-digit year 69 → 2069, 70 → 1970', new Date(E.parseCookieDate('1 Jan 69 00:00:00').ms).getUTCFullYear() === 2069 && new Date(E.parseCookieDate('1 Jan 70 00:00:00').ms).getUTCFullYear() === 1970);
}

// ── Chromium 152 observations ───────────────────────────────────────────────
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-cookie-parser.fixtures.json'), 'utf8'));
check('fixture records the browser and date', /Chromium 152/.test(fx.source) && /2026-10-02/.test(fx.source) && /Chrome\/152/.test(fx.userAgent));
// Where Chromium 152 departs from RFC 6265bis, the engine follows the RFC and adds a note.
// Each entry: the note the engine adds, and what the engine and Chromium each did.
const DEVIATIONS = {
  'maxage:"+60"': ['maxAgePlus', 'session', 'persistent'],   // RFC ignores "+60"; Chromium reads 60 s
  date8: ['badDate', 'session', 'none'],                     // year 1600 fails the RFC parse; Chromium drops the cookie
  date20: ['badDate', 'session', 'persistent'],              // year 10000 fails the RFC year rule; Chromium caps at 400 days
  tab: ['tabInside', 'session', 'none'],                     // RFC allows HTAB inside a value; Chromium rejects
  'dom-dot-only': ['domainDotOnly', 'session', 'none']       // Domain=. is an empty domain (host-only) in the RFC; Chromium rejects
};
// Domain=localhost for lab.localhost was a deviation before the Public Suffix List was used: the
// list's default rule "*" makes the unlisted TLD localhost a public suffix, so the engine rejects
// it like Chromium does. It is now compared with the other cases below.
const shapeOf = (r) => (!r || r.verdict === 'rejected' ? 'none' : r.verdict === 'delete' ? 'none' : r.expiry.type);
const reqUrl = U(fx.requestUrl);
for (const c of fx.cases) {
  const at = c.setAt ? Date.parse(c.setAt) : NOW;
  const results = c.lines.map((l) => E.analyzeSetCookie(E.parseSetCookie(l), { now: at, url: reqUrl }));
  const kept = results.filter((r) => r.verdict === 'stored');
  const label = `Chromium case ${c.id} ${JSON.stringify(c.lines[0]).slice(0, 70)}`;
  if (c.id === 'order' || c.id === 'commajoin') continue; // checked below
  if (Object.prototype.hasOwnProperty.call(DEVIATIONS, c.id)) {
    const [note, engineShape, browserShape] = DEVIATIONS[c.id];
    const b = c.stored.length ? (c.stored[0].session ? 'session' : 'persistent') : 'none';
    eq(`${label}: known deviation, engine ${engineShape} / Chromium ${browserShape}`, [shapeOf(results[0]), b], [engineShape, browserShape]);
    check(`${label}: engine notes ${note}`, results.some((r) => codes(r).includes(note)), results.map(codes));
    continue;
  }
  eq(`${label}: same number of cookies kept`, kept.length, c.stored.length);
  kept.forEach((r, i) => {
    const s = c.stored[i];
    if (!s) return;
    const dom = r.hostOnly ? r.domain : '.' + r.domain;
    eq(`${label}: domain`, dom, s.domain);
    if (typeof s.path === 'string') eq(`${label}: path`, r.path, s.path);
    else eq(`${label}: path length`, r.path.length, s.path.len);
    if (typeof s.value === 'string') eq(`${label}: value`, r.value, s.value);
    if ('secure' in s) eq(`${label}: secure / httpOnly`, [r.secure, r.httpOnly], [s.secure, s.httpOnly]);
    if ('sameSite' in s) eq(`${label}: SameSite`, r.sameSite === 'Default' ? null : r.sameSite, s.sameSite);
    if ('partitioned' in s) eq(`${label}: partitioned`, r.partitioned, s.partitioned);
    if (s.session) eq(`${label}: session cookie`, r.expiry.type, 'session');
    else if (s.expiresUtc) {
      // Chromium stores Max-Age expiries in microseconds from its own clock; compare to the second.
      const diff = Math.abs(r.expiry.ms - Date.parse(s.expiresUtc));
      check(`${label}: expiry ${s.expiresUtc} (diff ${diff} ms)`, r.expiry.type === 'persistent' && diff <= 2000, r.expiry);
    }
  });
}
{
  const c = fx.cases.find((x) => x.id === 'commajoin');
  const r = analyze(c.lines[0], fx.requestUrl, Date.parse(c.setAt));
  check('a comma after an Expires date is one cookie for the browser (Chromium kept j only)', c.stored.length === 1 && c.stored[0].name === 'j' && r.name === 'j' && r.expiry.type === 'persistent');
  eq('… while splitCombined (for Headers.get output) splits only at ", k="', E.splitCombined(c.lines[0]), ['j=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'k=2']);
}
{
  const d = fx.dateToString;
  eq('Date#toString() as Expires: "GMT+0900" is read as GMT, like Chromium', new Date(analyze(d.line, 'https://www.example.co.kr/').expiry.ms).toISOString(), d.expiresUtc);
  eq('… and the offset is flagged', analyze(d.line).issues.find((i) => i.code === 'expiresZone').vars.zone, 'GMT+0900');
  check('a GMT date is not flagged, "+0900" is', !codes(analyze(d.utcLine)).includes('expiresZone') && codes(analyze('a=1; Expires=Wed, 21 Oct 2026 07:28:00 +0900')).includes('expiresZone'));
  eq('toUTCString() as Expires', new Date(analyze(d.utcLine, 'https://www.example.co.kr/').expiry.ms).toISOString(), d.utcExpiresUtc);
}
// Cookie header order: Chromium's headers for six request paths.
{
  const now = NOW;
  const from = U(fx.order.setFrom);
  const list = fx.order.lines.map((l) => E.analyzeSetCookie(E.parseSetCookie(l), { now, url: from }));
  const jar = E.buildJar(list, now);
  for (const [path, header] of Object.entries(fx.order.cookieHeaders)) {
    eq(`simulated Cookie header for ${path} matches Chromium`, E.simulate(jar, U('http://lab.localhost:8851' + path), 'same-site', now).header, header);
  }
  const ow = fx.overwrite.lines.map((l) => E.analyzeSetCookie(E.parseSetCookie(l), { now, url: from }));
  eq('a replaced cookie moves after cookies set before it (Chromium gives it a new creation time)', E.simulate(E.buildJar(ow, now), U('http://lab.localhost:8851/z'), 'same-site', now).header, fx.overwrite.cookieHeader);
}

// ── PHP 8.4.26 observations ──────────────────────────────────────────────────
{
  const php = fx.php;
  check('PHP fixture records version and date', /PHP 8\.4\.26/.test(php.source) && /2026-10-02/.test(php.source));
  const p = E.parseCookieHeader(php.cookieHeader);
  const mine = {};
  p.pairs.forEach((x) => {
    const note = x.issues.find((i) => i.code === 'phpName');
    const key = note ? note.vars.php : x.name;
    if (!(key in mine)) mine[key] = x.decoded;
  });
  eq('PHP $_COOKIE equals first-wins + decoded values + phpName renames', mine, php.cookieArray);
  const fromPhp = php.setCookieHeaders.map((l) => analyze(l, 'https://www.example.jp/mypage/login', Date.parse('2026-10-02T03:19:21Z')));
  eq('PHP setcookie output: kept, kept, delete, delete, kept', fromPhp.map((a) => a.verdict), ['stored', 'stored', 'delete', 'delete', 'stored']);
  eq('PHP name value decodes to the original', fromPhp[1].decoded.text, '山田 太郎');
  check('PHP Max-Age and expires both present: Max-Age wins', codes(fromPhp[1]).includes('bothLifetimes') && fromPhp[1].expiry.source === 'max-age');
}

// ── Set-Cookie analysis ──────────────────────────────────────────────────────
{
  const a = analyze('id=1; Max-Age=60; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  check('Max-Age wins over Expires', a.expiry.type === 'persistent' && a.expiry.source === 'max-age' && codes(a).includes('bothLifetimes'));
  check('Max-Age=0 deletes', analyze('id=; Max-Age=0').verdict === 'delete');
  check('Max-Age=-5 deletes', analyze('id=; Max-Age=-5').verdict === 'delete');
  const capped = analyze('id=1; Max-Age=99999999999');
  check('Max-Age over 400 days is capped', capped.expiry.capped && capped.expiry.ms === NOW + 34560000 * 1000 && codes(capped).includes('capped400'));
  check('Max-Age=1e3 is ignored', analyze('id=1; Max-Age=1e3').expiry.type === 'session' && codes(analyze('id=1; Max-Age=1e3')).includes('badMaxAge'));
  check('last Path wins and earlier one is marked', analyze('id=1; Path=/x; Path=/y').path === '/y' && codes(analyze('id=1; Path=/x; Path=/y')).includes('overridden'));
  check('Path=foo falls back to the default path', analyze('id=1; Path=foo').path === '/account' && codes(analyze('id=1; Path=foo')).includes('pathDefault'));
  eq('default path without a URL is unknown', analyze('id=1', null).path, null);
  check('Domain=.example.com: leading dot noted, cookie for subdomains', (() => { const r = analyze('id=1; Domain=.example.com'); return !r.hostOnly && r.domain === 'example.com' && codes(r).includes('domainDot'); })());
  eq('Domain= (empty) is host-only', [analyze('id=1; Domain=').hostOnly, analyze('id=1; Domain=').domain], [true, 'www.example.com']);
  eq('Domain not covering the host is rejected', rcodes(analyze('id=1; Domain=other.com')), ['domainMismatch']);
  eq('Domain on an IP host must be exact', rcodes(analyze('id=1; Domain=0.0.1', 'https://10.0.0.1/')), ['domainMismatch']);
  eq('non-ASCII Domain is rejected', rcodes(analyze('id=1; Domain=exämple.com')), ['domainNonAscii']);
  eq('Secure from http:// is rejected', rcodes(analyze('id=1; Secure', 'http://www.example.com/')), ['secureOnHttp']);
  check('Secure from http://localhost is allowed', analyze('id=1; Secure', 'http://localhost:3000/').verdict === 'stored');
  eq('SameSite=None without Secure', rcodes(analyze('id=1; SameSite=None')), ['noneNeedsSecure']);
  eq('Partitioned without Secure', rcodes(analyze('id=1; Partitioned')), ['partitionedNeedsSecure']);
  check('SameSite=Foo behaves as unset and is noted', (() => { const r = analyze('id=1; SameSite=Foo'); return r.sameSite === 'Default' && codes(r).includes('sameSiteInvalid'); })());
  check('Secure=false still sets Secure', (() => { const r = analyze('id=1; Secure=false'); return r.secure && codes(r).includes('flagValue'); })());
  eq('typo suggestion', analyze('id=1; HtpOnly').issues.find((i) => i.code === 'unknownAttrSuggest').vars.suggest, 'HttpOnly');
  check('Priority is Chrome-only and read', analyze('id=1; Priority=high').priority === 'High' && codes(analyze('id=1; Priority=high')).includes('priority'));
  check('SameParty / Comment are named', codes(analyze('id=1; SameParty')).includes('attr_removed') && codes(analyze('id=1; Comment=x')).includes('attr_rfc2109'));
  check('4096-byte name+value kept, 4097 rejected', analyze('a=' + 'x'.repeat(4095)).verdict === 'stored' && rcodes(analyze('a=' + 'x'.repeat(4096))).includes('tooBig'));
  check('UTF-8 bytes counted: 1365 × 你 + name a = 4096', analyze('a=' + '你'.repeat(1365)).verdict === 'stored' && analyze('a=' + '你'.repeat(1365) + 'x').verdict === 'rejected');
  check('attribute value over 1024 bytes ignored', codes(analyze('id=1; Path=/' + 'x'.repeat(1024))).includes('attrTooLong'));
  const prefixes = [
    ['__Secure-a=1', ['prefixSecure']], ['__secure-a=1; Secure', []], ['__Host-a=1; Secure; Path=/', []], ['__Host-a=1; Secure', ['prefixHost']],
    ['__HOST-a=1; Secure; Path=/; Domain=www.example.com', ['prefixHost']], ['__Http-a=1; Secure', ['prefixHttp']], ['__Http-a=1; Secure; HttpOnly', []],
    ['__Host-Http-a=1; Secure; HttpOnly; Path=/', []], ['__Host-Http-a=1; Secure; Path=/', ['prefixHttp']], ['__Host-Http-a=1; HttpOnly; Path=/', ['prefixHost', 'prefixHttp']],
    ['__Secure-x', ['namelessPrefix']], ['=__host-x', ['namelessPrefix']]
  ];
  for (const [line, want] of prefixes) eq(`prefix rule ${line}`, rcodes(analyze(line)), want);
  // RFC 6265bis §5.4 examples (from https://site.example/)
  const rej = ['__Secure-SID=12345; Domain=site.example', '__secure-SID=12345; Domain=site.example', '__SECURE-SID=12345; Domain=site.example', '__Host-SID=12345', '__host-SID=12345; Secure', '__host-SID=12345; Domain=site.example', '__HOST-SID=12345; Domain=site.example; Path=/', '__Host-SID=12345; Secure; Domain=site.example; Path=/', '__host-SID=12345; Secure; Domain=site.example; Path=/', '__HOST-SID=12345; Secure; Domain=site.example; Path=/'];
  const acc = ['__Secure-SID=12345; Domain=site.example; Secure', '__secure-SID=12345; Domain=site.example; Secure', '__SECURE-SID=12345; Domain=site.example; Secure', '__Host-SID=12345; Secure; Path=/', '__host-SID=12345; Secure; Path=/', '__HOST-SID=12345; Secure; Path=/'];
  for (const l of rej) check(`RFC 6265bis §5.4 rejects ${l}`, analyze(l, 'https://site.example/').verdict === 'rejected');
  for (const l of acc) check(`RFC 6265bis §5.4 accepts ${l}`, analyze(l, 'https://site.example/').verdict === 'stored');
  check('security hints skipped for a deleting cookie', !codes(analyze('cart=; Max-Age=0')).includes('noSecure'));
  check('noHttpOnly is a warning for a session cookie name', analyze('PHPSESSID=abc; Secure').issues.find((i) => i.code === 'noHttpOnly').sev === 'warn');
  eq('two-digit year noted', analyze('a=1; Expires=Wed, 21 Oct 26 07:28:00 GMT').issues.find((i) => i.code === 'twoDigitYear').vars.year, 2026);
  check('quoted value kept with quotes', analyze('q="a b"').value === '"a b"' && codes(analyze('q="a b"')).includes('quoted'));
  check('space inside a value warned', codes(analyze('t=a b')).includes('valueSpace'));
  check('CTL rejects the line', rcodes(analyze('c=a\u0001b')).includes('ctl'));
}

// ── Cookie header ────────────────────────────────────────────────────────────
{
  const p = E.parseCookieHeader('a=1;b=2 ;  c = 3 ; ; d="q"; e=%E4%BD%A0; f=%zz; g=%C4%E3');
  eq('names', p.pairs.map((x) => x.name), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  eq('values trimmed', p.pairs.map((x) => x.value), ['1', '2', '3', '"q"', '%E4%BD%A0', '%zz', '%C4%E3']);
  eq('decoded', p.pairs.map((x) => x.decoded), ['1', '2', '3', '"q"', '你', '%zz', '%C4%E3']);
  check('bad percent and non-UTF-8 noted', p.pairs[5].issues.some((i) => i.code === 'badPercent') && p.pairs[6].issues.some((i) => i.code === 'notUtf8'));
  eq('header bytes', p.bytes, Buffer.byteLength('a=1;b=2 ;  c = 3 ; ; d="q"; e=%E4%BD%A0; f=%zz; g=%C4%E3'));
  const j = E.parseCookieHeader('t=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDI0IiwibmFtZSI6ImRlbW8iLCJleHAiOjE3OTg3NjE2MDB9.c2lnbmF0dXJlLW5vdC12ZXJpZmllZA; c=%7B%22items%22%3A3%7D');
  eq('JWT detected with alg and exp', [j.pairs[0].info.kind, j.pairs[0].info.alg, j.pairs[0].info.exp], ['jwt', 'HS256', 1798761600000]);
  eq('JSON value detected', j.pairs[1].info.kind, 'json');
  eq('known names', ['_ga', '_ga_ABC123', 'PHPSESSID', 'JSESSIONID', 'connect.sid', 'Hm_lvt_8c5e2d1f0a9b4c7e', 'theme'].map(E.knownCookie), ['ga', 'ga4', 'phpsessid', 'jsessionid', 'connectsid', 'hmlvt', null]);
}

// ── "cookie" package 1.1.1 (what Express and Astro use to read Cookie headers) ──
{
  const pkg = join(root, 'node_modules/astro/node_modules/cookie/package.json');
  const ver = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : null;
  if (ver !== '1.1.1') skip('cookie package comparison', `installed ${ver}, recorded 1.1.1`);
  else {
    const cookie = createRequire(pkg)('./dist/index.js');
    eq('cookie 1.1.1: first wins, quotes kept', { ...cookie.parse('sid=new; sid=old; q="a b"; d=x y') }, { sid: 'new', q: '"a b"', d: 'x y' });
    let seed = 20261002;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pick = (s) => s[Math.floor(rnd() * s.length)];
    const nameChars = 'abcdefABCDEF_-.0123';
    const valChars = 'abcXYZ019_-.%E4BD20 ="';
    let agree = 0, total = 0;
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 5);
      const parts = [];
      for (let k = 0; k < n; k++) {
        let name = ''; const nl = 1 + Math.floor(rnd() * 4); for (let q = 0; q < nl; q++) name += pick(nameChars);
        let val = ''; const vl = Math.floor(rnd() * 8); for (let q = 0; q < vl; q++) val += pick(valChars);
        parts.push(name + '=' + val);
      }
      const header = parts.join(pick([';', '; ', ' ; ']));
      const mine = JSON.parse(E.cookiesToJson(E.parseCookieHeader(header).pairs, 'object', true));
      const theirs = { ...cookie.parse(header) };
      total++;
      if (JSON.stringify(mine) === JSON.stringify(theirs)) agree++;
      else check(`cookie.parse agrees on ${JSON.stringify(header)}`, false, { mine, theirs });
    }
    check(`cookie 1.1.1 parse agrees on ${agree}/${total} random headers`, agree === total);
    // parseSetCookie on well-formed lines
    const lines = ['id=a%20b; Path=/x; Domain=Example.com; Max-Age=60; Secure; HttpOnly; SameSite=Strict; Partitioned', 'q=1; path=/; samesite=none; secure', 'v=; Expires=Wed, 21 Oct 2026 07:28:00 GMT'];
    for (const l of lines) {
      const t = cookie.parseSetCookie(l), m = analyze(l);
      eq(`parseSetCookie agrees on ${l}`, [m.name, m.decoded.text, m.secure, m.httpOnly, (m.sameSite === 'Default' ? undefined : m.sameSite.toLowerCase())], [t.name, t.value || '', !!t.secure, !!t.httpOnly, t.sameSite]);
    }
  }
}

// ── cookie 0.7.2 (what cookie-parser 1.4.7, Express's middleware, depends on) ──
{
  const pkg = join(root, 'node_modules/cookie/package.json');
  const ver = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : null;
  if (ver !== '0.7.2') skip('cookie 0.7.2 claims', `installed ${ver}, recorded 0.7.2`);
  else {
    const old = createRequire(pkg)('./index.js');
    eq('cookie 0.7.2: first wins, quotes removed, spaces kept', { ...old.parse('sid=new; sid=old; q="a b"; d=x y') }, { sid: 'new', q: 'a b', d: 'x y' });
  }
}

// ── Python 3.12 http.cookies (claims on the page) ───────────────────────────
{
  const py = spawnSync('python3', ['-c', 'import sys;print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
  const ver = py.status === 0 ? py.stdout.trim() : null;
  if (ver !== '3.12') skip('Python http.cookies claims', `python3 ${ver}, recorded 3.12`);
  else {
    const run = (header) => {
      const r = spawnSync('python3', ['-c', 'import sys,json\nfrom http.cookies import SimpleCookie\nc=SimpleCookie()\nc.load(sys.argv[1])\nprint(json.dumps({k:v.value for k,v in c.items()}))', header], { encoding: 'utf8' });
      return JSON.parse(r.stdout);
    };
    eq('Python: a space in a value drops the whole header', run('a=1; b=x y; c=3'), {});
    eq('Python: a double quote drops that cookie and the rest', run('a=1; b=x"y; c=3'), { a: '1' });
    eq('Python: non-ASCII drops that cookie and the rest', run('a=1; b=你; c=3'), { a: '1' });
    eq('Python: a comma is fine', run('a=1; b=2,3; c=3'), { a: '1', b: '2,3', c: '3' });
    eq('Python: quotes are removed', run('a="x y"'), { a: 'x y' });
    eq('Python: the last same-name cookie wins', run('sid=new; sid=old'), { sid: 'old' });
    check('engine warns on each value Python drops', ['b=x y', 'b=x"y', 'b=你'].every((v) => E.parseCookieHeader(v).pairs[0].issues.some((i) => /^value(Space|Octet)$/.test(i.code))));
  }
}

// ── Input splitting ──────────────────────────────────────────────────────────
{
  const curlV = `* Connected to example.com\n< HTTP/2 200\n< content-type: text/html\n< set-cookie: a=1; Path=/\n< set-cookie: b=2; HttpOnly\n> cookie: x=1; y=2\n`;
  const sp = E.splitInput(curlV, 'auto', {});
  eq('curl -v: set-cookie lines', sp.setCookies.map((s) => s.text), ['a=1; Path=/', 'b=2; HttpOnly']);
  eq('curl -v: cookie line', sp.cookieLines.map((s) => s.text), ['x=1; y=2']);
  check('curl -v: other headers skipped', sp.skipped >= 2 && sp.kind === 'both');
  const curlCmd = `curl 'https://shop.example/api/cart' -H 'accept: application/json' -b 'sid=abc; theme=dark' -H 'Cookie: extra=1'`;
  eq('curl command: -b and -H Cookie', E.splitInput(curlCmd, 'auto', {}).cookieLines.map((s) => s.text), ['sid=abc; theme=dark', 'extra=1']);
  eq('curl --cookie with double quotes', E.splitInput(`curl --cookie "a=1; b=2" https://x`, 'auto', {}).cookieLines.map((s) => s.text), ['a=1; b=2']);
  const joined = E.splitInput('a=1; Path=/, b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT, c=3', 'auto', {});
  eq('Headers.get style joined value is split', joined.setCookies.map((s) => s.text), ['a=1; Path=/', 'b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'c=3']);
  eq('split off keeps one line', E.splitInput('a=1; Path=/, b=2', 'auto', { split: false }).setCookies.length, 1);
  check('a plain Cookie header stays a Cookie header', E.splitInput('a=1; b=2; c=3', 'auto', {}).kind === 'cookie');
  check('forced Cookie mode reads attributes as cookies', E.splitInput('a=1; Path=/', 'cookie', {}).kind === 'cookie');
  check('forced Set-Cookie mode', E.splitInput('a=1; b=2', 'set-cookie', {}).kind === 'set-cookie');
  eq('several Cookie lines joined', E.splitInput('Cookie: a=1\nCookie: b=2', 'auto', {}).notes.map((n) => n.code), ['joinedCookie']);
  eq('BOM and CRLF', E.splitInput('\uFEFFSet-Cookie: a=1\r\nSet-Cookie: b=2\r\n', 'auto', {}).setCookies.map((s) => s.text), ['a=1', 'b=2']);
  check('a URL value is not a header line', E.splitInput('next=https://example.com/a; lang=en', 'auto', {}).kind === 'cookie');
}

// ── cookies.txt ──────────────────────────────────────────────────────────────
{
  const txt = '# Netscape HTTP Cookie File\n# https://curl.se/docs/http-cookies.html\n\n.example.com\tTRUE\t/\tFALSE\t0\tsession\tabc\n#HttpOnly_www.example.com\tFALSE\t/account\tTRUE\t1798761600\tauth\txyz\nbad line\n';
  const sp = E.splitInput(txt, 'auto', {});
  check('cookies.txt detected', sp.kind === 'netscape');
  const good = sp.netscape.filter((e) => !e.error);
  eq('cookies.txt rows', good.map((e) => [e.name, e.domain, e.hostOnly, e.path, e.secure, e.httpOnly, e.session]), [['session', 'example.com', false, '/', false, false, true], ['auth', 'www.example.com', true, '/account', true, true, false]]);
  check('bad line reported', sp.netscape.some((e) => e.error === 'nsFields'));
  const jar = good.map((e, i) => ({ ...e, sameSite: 'Default', partitioned: false, order: i }));
  eq('cookies.txt simulation', E.simulate(jar, U('https://www.example.com/account/x'), 'same-site', NOW).header, 'auth=xyz; session=abc');
}

// ── Simulation contexts ──────────────────────────────────────────────────────
{
  const lines = ['s=1; Secure; SameSite=Strict; Path=/', 'l=1; Secure; SameSite=Lax; Path=/', 'n=1; Secure; SameSite=None; Path=/', 'd=1; Secure; Path=/', 'p=1; Secure; SameSite=None; Partitioned; Path=/'];
  const list = lines.map((l) => analyze(l, 'https://shop.example/'));
  const jar = E.buildJar(list, NOW);
  const req = U('https://shop.example/cart');
  eq('same-site sends all', E.simulate(jar, req, 'same-site', NOW).sent.map((c) => c.name), ['s', 'l', 'n', 'd', 'p']);
  eq('cross-site top-level GET drops Strict', E.simulate(jar, req, 'cross-top', NOW).sent.map((c) => c.name), ['l', 'n', 'd', 'p']);
  eq('cross-site subrequest sends None only (not partitioned)', E.simulate(jar, req, 'cross-sub', NOW).sent.map((c) => c.name), ['n']);
  eq('http request drops Secure cookies', E.simulate(jar, U('http://shop.example/cart'), 'same-site', NOW).sent.length, 0);
  const dj = E.buildJar([analyze('a=1; Path=/'), analyze('a=; Path=/; Max-Age=0')], NOW);
  eq('deletion removes the cookie from the jar', dj.length, 0);
  check('path-match /a/b vs /a/bc', E.pathMatch('/a/b/c', '/a/b') && !E.pathMatch('/a/bc', '/a/b') && E.pathMatch('/a/bc', '/a/'));
  eq('default path', ['/', '', '/a', '/a/b/page', '/a/b/'].map(E.defaultPath), ['/', '/', '/', '/a/b', '/a/b']);
}

// ── Redaction ────────────────────────────────────────────────────────────────
{
  const secrets = ['k8Qe2Vz9LmP4tR7wX1cY3nB6', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMDI0IiwibmFtZSI6ImRlbW8iLCJleHAiOjE3OTg3NjE2MDB9.c2lnbmF0dXJlLW5vdC12ZXJpZmllZA', '7F3A9C2E5B1D4F8A6C0E2B4D6F8A0C2E', 'r4k8vq2m9n1p6s3t0w5x7y2z4b'];
  const header = `_ga=GA1.1.1234567890.1759363200; sessionid=${secrets[0]}; theme=dark; token=${secrets[1]}; data=${secrets[2]}; PHPSESSID=${secrets[3]}; lang=zh-CN`;
  const p = E.parseCookieHeader(header).pairs;
  const all = E.redactCookieHeader(p, 'all').text;
  check('redact all: no value left', p.every((x) => !x.value || !all.includes('=' + x.value)), all);
  const sens = E.redactCookieHeader(p, 'sensitive');
  check('redact sensitive: secrets gone', secrets.every((s) => !sens.text.includes(s)), sens.text);
  check('redact sensitive: plain values kept', ['theme=dark', 'lang=zh-CN', '_ga=GA1.1.1234567890.1759363200'].every((s) => sens.text.includes(s)), sens.text);
  const sc = E.redactSetCookie(E.parseSetCookie('sessionid=abc123def; Path=/; Secure; HttpOnly; SameSite=Lax'), 'sensitive');
  eq('Set-Cookie redaction keeps attributes', sc.text, 'sessionid=[redacted]; Path=/; Secure; HttpOnly; SameSite=Lax');
  check('looksRandom', E.looksRandom('k8Qe2Vz9LmP4tR7wX1cY3nB6') && !E.looksRandom('GA1.1.1234567890.1759363200') && !E.looksRandom('dark') && !E.looksRandom('1759363200,1759449600'));
}

// ── Builder ──────────────────────────────────────────────────────────────────
{
  const f = { name: 'session', value: 'a b;c', encode: true, domain: 'example.com', path: '/', lifetime: 'expires', expiresMs: Date.UTC(2026, 11, 31, 15, 0, 0), secure: true, httpOnly: true, sameSite: 'Lax', partitioned: false, priority: 'High' };
  const b = E.buildSetCookie(f);
  eq('builder line', b.line, 'session=a%20b%3Bc; Domain=example.com; Path=/; Expires=Thu, 31 Dec 2026 15:00:00 GMT; Secure; HttpOnly; SameSite=Lax; Priority=High');
  const r = analyze(b.line);
  check('builder output parses back', r.verdict === 'stored' && r.decoded.text === 'a b;c' && r.domain === 'example.com' && r.expiry.ms === f.expiresMs && r.priority === 'High');
  eq('deletion line', b.deleteLine, 'session=; Domain=example.com; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
  check('deletion line deletes', analyze(b.deleteLine).verdict === 'delete');
  const r2 = analyze(E.buildSetCookie({ name: 'x', value: '1', lifetime: 'max-age', maxAge: '60', sameSite: 'None' }).line);
  eq('builder without Secure + None is flagged', rcodes(r2), ['noneNeedsSecure']);
}

// ── Bytes ────────────────────────────────────────────────────────────────────
{
  const samples = ['', 'abc', 'é', '你好', '😀', '\uD800', 'a\uDC00b', 'mix 你 😀 é'];
  for (const s of samples) eq(`utf8Len ${JSON.stringify(s)}`, E.utf8Len(s), Buffer.byteLength(s, 'utf8'));
}

// ── STRINGS ──────────────────────────────────────────────────────────────────
function shape(o, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x, i) => { out[`${prefix}${k}[${i}]`] = x; });
    else if (v && typeof v === 'object') Object.assign(out, shape(v, `${prefix}${k}.`));
    else out[prefix + k] = v;
  }
  return out;
}
const flat = Object.fromEntries(Object.entries(STRINGS).map(([l, s]) => [l, shape(s)]));
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
for (const lang of ['zh', 'ja', 'ko']) {
  eq(`STRINGS.${lang} has the same keys as en`, Object.keys(flat[lang]).sort(), Object.keys(flat.en).sort());
  for (const k of Object.keys(flat.en)) {
    if (/^example(Cookie|Set|RespUrl|ReqUrl)$/.test(k)) continue;
    if (k in flat[lang]) check(`STRINGS.${lang}.${k} placeholders`, placeholders(flat[lang][k]) === placeholders(flat.en[k]), [flat.en[k], flat[lang][k]]);
  }
}
{
  const issueCodes = new Set(), rejectCodes = new Set();
  for (const m of engineSrc.matchAll(/code: '([A-Za-z0-9_]*[A-Za-z0-9])'/g)) issueCodes.add(m[1]);
  for (const m of engineSrc.matchAll(/reject\.push\(\{ code: '([A-Za-z]+)'/g)) rejectCodes.add(m[1]);
  for (const m of engineSrc.matchAll(/fatal\.push\(\{ code: '([A-Za-z]+)'/g)) rejectCodes.add(m[1]);
  for (const c of ['domainPublicSuffix', 'domainPrivateSuffix']) { check(`engine pushes reject ${c}`, engineSrc.includes(`'${c}'`)); rejectCodes.add(c); }
  const extra = ['attr_removed', 'attr_rfc2109', 'attr_rfc2965', 'valueSpace', 'valueOctet', 'valueComma', 'emptyName', 'noEq', 'unknownAttr', 'unknownAttrSuggest'];
  for (const lang of Object.keys(STRINGS)) {
    const S = STRINGS[lang];
    for (const c of rejectCodes) check(`STRINGS.${lang}.reject.${c}`, typeof S.reject[c] === 'string');
    for (const c of [...issueCodes, ...extra]) {
      if (rejectCodes.has(c) && !S.issues[c]) continue;
      if (['autoSet', 'joinedCookie', 'splitCombined', 'skippedHeaders', 'fromCurl', 'dup'].includes(c)) continue;
      check(`STRINGS.${lang}.issues.${c}`, typeof S.issues[c] === 'string' || typeof S.reject[c] === 'string');
    }
    for (const c of ['autoSet', 'joinedCookie', 'splitCombined', 'skippedHeaders', 'fromCurl']) check(`STRINGS.${lang}.notes.${c}`, typeof S.notes[c] === 'string');
    for (const c of ['expired', 'domain', 'path', 'secure', 'sameSiteStrict', 'sameSiteLax', 'sameSiteDefault', 'partitioned', 'publicSuffix', 'pslUnknown']) check(`STRINGS.${lang}.skip.${c}`, typeof S.skip[c] === 'string');
    for (const c of ['stored', 'delete', 'rejected', 'unknown']) check(`STRINGS.${lang}.verdict.${c}`, typeof S.verdict[c] === 'string');
    for (const c of ['pslLoading', 'pslFailed', 'unknownCount']) check(`STRINGS.${lang}.${c}`, typeof S[c] === 'string');
    for (const [re, k] of [['ga', 1], ['ga4', 1], ['cfbm', 1], ['cfclearance', 1], ['cfuvid', 1], ['phpsessid', 1], ['jsessionid', 1], ['connectsid', 1], ['djangosession', 1], ['djangocsrf', 1], ['aspnet', 1], ['aspnetcore', 1], ['xsrf', 1], ['hmlvt', 1], ['hmlpvt', 1]]) check(`STRINGS.${lang}.known.${re}`, typeof S.known[re] === 'string' && k);
    // Each language's examples parse cleanly into the cards the page describes.
    const sp = E.splitInput(S.exampleSet, 'auto', {});
    check(`STRINGS.${lang}.exampleSet is 5 Set-Cookie lines`, sp.kind === 'set-cookie' && sp.setCookies.length === 5);
    check(`STRINGS.${lang}.exampleCookie is a Cookie header with a repeated name`, (() => { const s = E.splitInput(S.exampleCookie, 'auto', {}); return s.kind === 'cookie' && E.parseCookieHeader(s.cookieLines[0].text).dupNames.length === 1; })());
  }
}

// ── Script safety and persistence ────────────────────────────────────────────
{
  const script = [...source.matchAll(/<script[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
  check('two scripts: the Public Suffix List loader and the page script', (source.match(/<script\b/g) || []).length === 2);
  check('the list is only reached through a dynamic import (separate chunk)', /import\('\.\.\/\.\.\/data\/public-suffix-list\.mjs'\)/.test(script) && !/^import .*public-suffix-list/m.test(source));
  check('script writes no HTML', !/innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/.test(script));
  check('script uses no storage, cookies or network', !/localStorage|sessionStorage|ztPersist|document\.cookie\s*=|fetch\(|XMLHttpRequest|sendBeacon|navigator\.sendBeacon/.test(script));
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check("persistence.ts keeps 'cookie-parser': 'disabled'", /'cookie-parser':\s*'disabled'/.test(persistence));
}

// ── Tool page examples (`ck-check`) ──────────────────────────────────────────
{
  // {/* ck-check: {"set": "line", "url": "...", "now": "ISO", "verdict": "...", "domain": "...", "path": "...", "expires": "ISO", "reject": [...], "issues": [...]} */}
  // {/* ck-check: {"cookie": "header", "json": {...}, "dup": [...]} */}
  // {/* ck-check: {"sim": ["lines"], "from": "url", "to": "url", "ctx": "...", "header": "..."} */}
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const file = join(root, `src/content/tools/cookie-parser/${lang}.mdx`);
    if (!existsSync(file)) continue;
    const mdx = readFileSync(file, 'utf8');
    const notes = [...mdx.matchAll(/\{\/\* ck-check: (\{[\s\S]*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
    check(`${lang}.mdx has ck-check annotations`, notes.length >= 3, notes.length);
    for (const n of notes) {
      const now = n.now ? Date.parse(n.now) : NOW;
      if (n.set) {
        const a = analyze(n.set, n.url || null, now);
        const tag = `${lang} ck-check ${n.set.slice(0, 50)}`;
        if (n.verdict) eq(`${tag} verdict`, a.verdict, n.verdict);
        if (n.domain) eq(`${tag} domain`, (a.hostOnly ? '' : '.') + a.domain, n.domain);
        if ('path' in n) eq(`${tag} path`, a.path, n.path);
        if (n.expires) eq(`${tag} expires`, a.expiry.ms ? new Date(a.expiry.ms).toISOString() : null, n.expires);
        if (n.reject) eq(`${tag} reject`, rcodes(a), n.reject);
        if (n.issues) for (const c of n.issues) check(`${tag} issue ${c}`, codes(a).includes(c), codes(a));
        check(`${tag} line quoted on the page`, mdx.includes(n.set.replace(/^Set-Cookie: /, '')) || mdx.includes(n.set));
      }
      if (n.cookie) {
        const p = E.parseCookieHeader(n.cookie);
        if (n.json) eq(`${lang} ck-check cookie JSON`, JSON.parse(E.cookiesToJson(p.pairs, 'object', true)), n.json);
        if (n.dup) eq(`${lang} ck-check duplicates`, p.dupNames, n.dup);
        if (n.redacted) eq(`${lang} ck-check redacted`, E.redactCookieHeader(p.pairs, n.mode || 'sensitive').text, n.redacted);
        check(`${lang} ck-check cookie quoted on the page`, mdx.includes(n.cookie));
      }
      if (n.sim) {
        const list = n.sim.map((l) => analyze(l, n.from, now));
        const r = E.simulate(E.buildJar(list, now), U(n.to), n.ctx || 'same-site', now);
        eq(`${lang} ck-check simulation ${n.to}`, r.header, n.header);
        check(`${lang} ck-check simulated header on the page`, mdx.includes(n.header));
      }
    }
  }
}

// ── v2 page layout and real page entry points ───────────────────────────────
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script>'));
  const css = source.slice(source.indexOf('<style>'));
  const ids = ['mode', 'decode', 'split', 'json', 'redact', 'input', 'results', 'simulation', 'builder'];
  const chooseStrings = new Function('STRINGS', 'lang', source.slice(source.indexOf('const T = STRINGS'), source.indexOf('\n---\n', 4)) + '\nreturn { CLIENT_T, TIPS, COPY_NOTE };');
  check('v2: root directly receives the widget height', /^\s*<div class="ck-wrap"/.test(markup));
  check('v2: controls, reserved status, input, results and secondary tools follow reading order', ['class="ck-top"', 'class="ck-box ck-options"', 'id="ck-status"', 'class="ck-input-pane"', 'class="ck-results"', 'class="ck-secondary"'].map((v) => markup.indexOf(v)).every((v, i, a) => v >= 0 && (!i || v > a[i - 1])));
  eq('v2: distinct tip IDs', [...markup.matchAll(/<Toggletip id="ck-tip-(\w+)"/g)].map((m) => m[1]), ids);
  check('v2: all tips use localized control names', (markup.match(/<Toggletip [^>]*lang=\{lang\} about=\{T\.\w+\}/g) || []).length === ids.length);
  check('v2: serialized strings omit tips', source.includes('define:vars={{ S: CLIENT_T, pageLang: lang }}'));
  check('v2: redacted-copy privacy note is visible beside results without opening options', markup.includes('<p id="ck-copy-note" class="ck-muted">{COPY_NOTE}</p>') && markup.indexOf('id="ck-copy-note"') > markup.indexOf('id="ck-copy-redacted"') && markup.indexOf('id="ck-copy-note"') < markup.indexOf('class="ck-result-scroll"'));
  check('v2: input label is visible', markup.includes('<label class="tool-label" for="ck-input">') && !css.includes('clip: rect('));
  check('v2: reserved status height contains long messages', /\.ck-wrap \.tool-status \{[^}]*height: 2\.8em;[^}]*overflow: auto;/.test(css));
  check('v2: long results scroll within a named keyboard-accessible region', markup.includes('class="ck-result-scroll" tabindex="0" role="region" aria-label={T.resultLabel}') && /\.ck-result-scroll \{[^}]*flex: 1 1 0;[^}]*min-height: 0;[^}]*overflow: auto;/.test(css));
  check('v2: empty results give the first-screen space to input', /\.ck-wrap:has\(\.ck-out:empty\) \.ck-input-pane \{ flex: 1 1 0;/.test(css) && /\.ck-results:has\(\.ck-out:empty\) \{ display: none;/.test(css));
  check('v2: secondary tools stack at 860px', /@media \(max-width: 860px\)[\s\S]*?\.ck-secondary \{ grid-template-columns: minmax\(0, 1fr\);/.test(css));
  check('v2: mobile output keeps its height as results grow', /@media \(max-width: 860px\)[\s\S]*?\.ck-result-scroll \{ flex: none; height: 55svh; max-height: none; \}/.test(css));
  check('v2: simulation results are a localized keyboard-accessible region', markup.includes('id="ck-sim-out" class="ck-sim-out" tabindex="0" role="region" aria-label={T.simTitle} aria-live="polite"'));
  check('v2: simulation results keep a fixed scrolling height while URL hints keep natural height', /\.ck-sim-out:has\(:global\(\.ck-sim-head\)\) \{[^}]*height: min\(30svh, 10rem\);[^}]*overflow: auto;[^}]*flex: none;/.test(css) && !/\.ck-sim-out \{[^}]*height:/.test(css));
  check('v2: redundant Parse button, binding and translation key are removed', !source.includes('ck-parse') && Object.values(STRINGS).every((v) => !('parse' in v)));
  check('v2: input still parses without a button', source.includes("inputEl.addEventListener('input', function () { render(false); });"));
  check('v2: listed as an analyze page', readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8').includes("'cookie-parser': 'analyze'"));

  // Keep child nodes so table/card replacement and clearing are tested, not only status text.
  function pageFixture(lang, pslResult = 'ready') {
    const { CLIENT_T } = chooseStrings(STRINGS, lang);
    const nodes = new Map(), copied = [], timers = new Map();
    let sequence = 0, loads = 0, releasePsl;
    function element(tag = 'div') {
      const events = new Map(); let text = '';
      const n = { tag, children: [], attrs: {}, style: {}, value: '', checked: false, hidden: false, disabled: false, className: '', scrolls: 0,
        get textContent() { return text + this.children.map((c) => c.textContent).join(''); },
        set textContent(v) { text = String(v); this.children = []; },
        get firstChild() { return this.children[0] || null; },
        appendChild(c) { this.children.push(c); return c; },
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(k, fn) { if (!events.has(k)) events.set(k, []); events.get(k).push(fn); },
        dispatch(k, init = {}) { for (const fn of events.get(k) || []) fn({ target: this, ...init }); },
        click() { if (!this.disabled) this.dispatch('click'); },
        focus() { this.dispatch('focus'); },
        getBoundingClientRect() { return { top: 900 }; },
        scrollIntoView() { this.scrolls++; }
      };
      n.classList = { add(c) { n.className += ' ' + c; } };
      return n;
    }
    for (const m of markup.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
      const n = element(m[1]); n.value = /\bvalue="([^"]*)"/.exec(m[2])?.[1] || '';
      n.checked = /\bchecked\b/.test(m[2]); n.hidden = /\bhidden\b/.test(m[2]);
      if (m[1] === 'select') {
        const opts = markup.slice(m.index + m[0].length).split('</select>')[0];
        const list = [...opts.matchAll(/<option\b([^>]*)>/g)];
        n.value = /value="([^"]*)"/.exec((list.find((o) => /\bselected\b/.test(o[1])) || list[0])[1])[1];
      }
      nodes.set(m[3], n);
    }
    nodes.get('ck-status').textContent = CLIENT_T.statusEmpty;
    const modes = [...markup.matchAll(/<button\b[^>]*data-mode="([^"]+)"[^>]*>/g)].map((m) => {
      const n = element('button'); n.setAttribute('data-mode', m[1]); return n;
    });
    const document = Object.assign(element('document'), {
      getElementById(id) { if (!nodes.has(id)) throw new Error('Missing rendered id: ' + id); return nodes.get(id); },
      querySelectorAll(selector) { if (selector !== '#ck-wrap [data-mode]') throw new Error('Unexpected selector: ' + selector); return modes; },
      createElement: element,
      createTextNode(value) { const n = element('text'); n.textContent = value; return n; }
    });
    const ctx = { S: CLIENT_T, pageLang: lang, document, URL, TextEncoder, TextDecoder, atob, btoa, console,
      navigator: { clipboard: { writeText(t) { copied.push(t); return Promise.resolve(); } } },
      isSecureContext: true, innerHeight: 844,
      setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      __ztCookiePsl() { loads++; return pslResult === 'pending' ? new Promise((resolve) => { releasePsl = resolve; }) : pslResult === 'failed' ? Promise.reject(new Error('fixture import failed')) : Promise.resolve(PSL_DATA); }
    };
    ctx.window = ctx;
    vm.runInNewContext(source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1], ctx, { filename: 'CookieParserTool.astro' });
    return { nodes, copied, modes, document, get loads() { return loads; },
      set(id, value, event = 'input') { const n = nodes.get(id); n.value = value; n.dispatch(event); },
      flush() { for (const [id, t] of timers) if (t.delay === 0) { timers.delete(id); t.fn(); } },
      release() { releasePsl(PSL_DATA); }
    };
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const { CLIENT_T, TIPS, COPY_NOTE } = chooseStrings(STRINGS, lang);
    check(`v2 ${lang}: all tips are complete and kept out of client strings`, Object.keys(TIPS).length === ids.length && Object.values(TIPS).every((v) => v.length > 20 && !JSON.stringify(CLIENT_T).includes(v)) && !('tips' in CLIENT_T));
    check(`v2 ${lang}: copy privacy note is translated and stays outside client strings`, COPY_NOTE === STRINGS[lang].copyNote && COPY_NOTE.length > 20 && !('copyNote' in CLIENT_T) && !JSON.stringify(CLIENT_T).includes(COPY_NOTE));
    const mdx = readFileSync(join(root, 'src/content/tools/cookie-parser/' + lang + '.mdx'), 'utf8');
    const end = mdx.indexOf('\n---\n', 4), front = yaml.load(mdx.slice(4, end)), body = mdx.slice(end + 5);
    check(`v2 ${lang}: five bounded plain-text steps precede FAQ`, Array.isArray(front.steps) && front.steps.length === 5 && front.steps.every((v) => typeof v === 'string' && v.length <= 280 && !/[<>]/.test(v)) && front.steps.join('').length <= 1200 && mdx.indexOf('\nsteps:') < mdx.indexOf('\nfaqItems:'));
    check(`v2 ${lang}: usage removed, limits and executable examples kept`, !/^## (How to Use|使用方法|使い方|사용 방법)\s*$/m.test(body) && /^## (Limits|限制|制限|제한)\s*$/m.test(body) && body.includes('{/* ck-check:'));
    const page = pageFixture(lang), get = (id) => page.nodes.get(id);
    check(`v2 ${lang}: initial input remains empty and builder remains populated`, get('ck-input').value === '' && get('ck-out').children.length === 0 && get('ck-b-out').textContent === 'Set-Cookie: session=abc123; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax');
    page.set('ck-input', 'sid=first; nickname=%E5%BC%A0; sid=second');
    check(`v2 ${lang}: input event renders a table without Parse`, get('ck-status').className === 'tool-status success' && get('ck-out').textContent.includes('张') && get('ck-out').textContent.includes('second'));
    get('ck-copy-json').click(); await settle();
    eq(`v2 ${lang}: object copy keeps first duplicate and decodes`, JSON.parse(page.copied.at(-1)), { sid: 'first', nickname: '张' });
    page.set('ck-json-format', 'array', 'change'); get('ck-copy-json').click(); await settle();
    check(`v2 ${lang}: array copy keeps duplicates`, JSON.parse(page.copied.at(-1)).length === 3);
    get('ck-copy-redacted').click(); await settle();
    eq(`v2 ${lang}: default redacted copy hides every value`, page.copied.at(-1), 'Cookie: sid=[redacted]; nickname=[redacted]; sid=[redacted]');
    get('ck-decode').checked = false; get('ck-decode').dispatch('change');
    check(`v2 ${lang}: decoding toggle renders the original value`, get('ck-out').textContent.includes('%E5%BC%A0') && !get('ck-out').textContent.includes('张'));
    page.set('ck-input', 'x=1; Path=/');
    page.modes.find((n) => n.getAttribute('data-mode') === 'cookie').click();
    check(`v2 ${lang}: forcing Cookie treats Path as a cookie name`, get('ck-out').textContent.includes('Path') && get('ck-sim').hidden);
    page.set('ck-input', 'HTTP/1.1 200 OK');
    check(`v2 ${lang}: unsupported header clears the previous table`, !get('ck-out').firstChild && get('ck-status').textContent === CLIENT_T.statusNothing);
    get('ck-ex-cookie').click();
    check(`v2 ${lang}: Cookie example renders and can scroll to results`, get('ck-input').value === CLIENT_T.exampleCookie && get('ck-out').children.length === 1 && get('ck-out').scrolls === 1);
    get('ck-ex-set').click(); await settle();
    check(`v2 ${lang}: Set-Cookie example loads PSL and opens simulation`, get('ck-input').value === CLIENT_T.exampleSet && get('ck-out').textContent.includes('SameSite') && !get('ck-sim').hidden && get('ck-sim').open && get('ck-sim-out').textContent.length > 0 && page.loads === 1);
    get('ck-clear').click(); await settle();
    check(`v2 ${lang}: Clear removes old output, notes and simulation`, get('ck-input').value === '' && get('ck-out').children.length === 0 && get('ck-notes').children.length === 0 && get('ck-sim').hidden && get('ck-status').textContent === CLIENT_T.statusEmpty);
    page.set('ck-input', 'theme=dark'); get('ck-input').value = '';
    page.document.dispatch('keydown', { ctrlKey: true, key: 'l' }); page.flush();
    check(`v2 ${lang}: Ctrl+L refreshes cleared input and removes stale output`, get('ck-out').children.length === 0 && get('ck-status').textContent === CLIENT_T.statusEmpty);
    page.set('ck-input', Array.from({ length: 500 }, (_, i) => 'k' + i + '=v' + i).join('; '));
    get('ck-copy-json').click(); await settle();
    check(`v2 ${lang}: long input exports all entries`, Object.keys(JSON.parse(page.copied.at(-1))).length === 500);
  }
  const pending = pageFixture('en', 'pending');
  pending.set('ck-input', 'Set-Cookie: sid=x; Domain=example.com; Path=/');
  check('v2: PSL loading reports progress and exposes no stale result', pending.nodes.get('ck-status').textContent === STRINGS.en.pslLoading && !pending.nodes.get('ck-out').firstChild);
  pending.nodes.get('ck-clear').click(); pending.release(); await settle();
  check('v2: clearing while PSL loads does not resurrect the old input', pending.nodes.get('ck-status').textContent === STRINGS.en.statusEmpty && !pending.nodes.get('ck-out').firstChild);
  const failed = pageFixture('en', 'failed');
  failed.set('ck-input', 'Set-Cookie: sid=x; Domain=example.com; Path=/'); await settle();
  check('v2: failed PSL import retains visible reload guidance', failed.nodes.get('ck-status').textContent.includes(STRINGS.en.pslFailed) && failed.nodes.get('ck-status').className === 'tool-status error');
  failed.set('ck-input', 'Set-Cookie: sid=y; Domain=example.com; Path=/'); await settle();
  check('v2: editing after PSL failure does not pretend to retry the module', failed.loads === 1 && failed.nodes.get('ck-status').textContent.includes(STRINGS.en.pslFailed));
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
