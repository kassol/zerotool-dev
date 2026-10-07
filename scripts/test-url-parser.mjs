// URL Parser — WHATWG parsing, RFC 3986 comparison, query decoding and editing
//
// Read:  src/components/tools/UrlParserTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so this test
//        cannot drift from the shipped source); scripts/test-url-parser.fixtures.json (a subset
//        of web-platform-tests urltestdata.json and setters_tests.json, BSD-3-Clause, commit and
//        selection rule recorded in the file); src/content/tools/url-parser/{lang}.mdx and
//        src/content/blog/url-parser-guide/en.mdx (`up-check` annotations are re-run);
//        src/data/persistence.ts and src/data/tool-layouts.ts
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: URL Standard (url.spec.whatwg.org) — basic URL parser (strip C0 control or space,
// remove tab or newline, "\" as "/" for special schemes, IPv4 parser with hex / octal /
// shortened forms, default ports, application/x-www-form-urlencoded parser §5.1);
// RFC 3986 Appendix B (splitting regex), §2–§3 (character rules), §3.2.1 (user:password);
// RFC 3492 (Punycode); Unicode UTS #39 §5.2 (restriction levels).
//
// Covers:
// - WPT parsing subset: for every case analyze(input, base) succeeds or fails as WPT says, and
//   href, protocol, username, password, host, hostname, port, pathname, search, hash and
//   origin equal the expected values.
// - Failure diagnosis (before: every failure was "Invalid URL. Make sure it includes a
//   scheme"): no scheme with a "Parse as https://…" suggestion, relative and scheme-relative
//   input, bad scheme, empty host, port not a number / above 65535, bad IPv6, forbidden host
//   character, invalid IPv4, IDNA failure, invalid base.
// - Notes (before: none; a backslash, an IPv4 shorthand, "localhost:3000" read as a scheme or a
//   punycode look-alike host were shown without comment): each note is produced for its input
//   and not for a plain URL; percent-encoded characters equal what the parser really encoded.
// - RFC 3986: Appendix B split of the RFC's own examples, the character check on valid
//   references (RFC 3986 §1.1.2 and §5.4) and on invalid ones with exact positions; the host
//   an RFC parser reads equals Python's urllib.parse.urlsplit().hostname (skipped without
//   python3).
// - Punycode: hostToUnicode agrees with node:url domainToUnicode on WPT hosts and on 2,000
//   generated labels.
// - Query: decoded pairs equal URLSearchParams on 3,000 random query strings; flags ("+",
//   no "=", repeats, bad "%", invalid UTF-8, ";"); rebuilding without edits returns the query
//   byte for byte (before, rebuilding with URLSearchParams, as other tools do, turned "flag"
//   into "flag=", "%zz" into "%25zz" and "%E4%B8" into "%EF%BF%BD"); one edit changes only
//   that pair; removed and added pairs.
// - Editing: setComponent on the WPT setter subset; the browser ignoring a value (port 99999)
//   or adjusting it (port "8080abc") is reported.
// - 4-language STRINGS: same keys and {placeholders}; every error and note code has a message.
// - The component script stores nothing and sends nothing; it writes no HTML.
// - `up-check` annotations in the 4 tool pages and the en guide: the engine output matches.
// - v2 analyze root, preserved controls, localized help and plain-text steps.
//
// Run: node scripts/test-url-parser.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { domainToUnicode, domainToASCII } from 'node:url';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UrlParserTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in UrlParserTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) +
  '\nreturn { analyze, diagnoseFailure, rfcSplit, rfcCheck, punyDecode, hostToUnicode, hostScriptWarnings, percentDecode, parseQuery, serializeQuery, setComponent, encodedChars, toJson, stripInput };')();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log(`FAIL: ${name}${detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
function skip(name, why) { skips++; console.log(`SKIP: ${name} (${why})`); }
const codes = (res) => res.notes.map((n) => n.code);
const noteOf = (res, code) => res.notes.find((n) => n.code === code);

// ── WPT parsing subset ────────────────────────────────────────────────────────
const fixture = JSON.parse(readFileSync(join(root, 'scripts/test-url-parser.fixtures.json'), 'utf8'));
const FIELDS = ['href', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
check('fixture records the WPT commit and license', /^[0-9a-f]{40}$/.test(fixture.commit) && /BSD/.test(fixture.license));
check('fixture has 150+ parsing cases in 10 categories', fixture.parsing.length >= 150 && new Set(fixture.parsing.map((c) => c.category)).size === 10, fixture.parsing.length);
for (const c of fixture.parsing) {
  const res = E.analyze(c.input, c.base == null ? '' : c.base);
  if (!c.failure && E.stripInput(c.input).text === '') {
    // The page shows nothing for an empty input, even when a base URL is filled in.
    check(`WPT empty input ${JSON.stringify(c.input)} shows nothing`, !res.ok && res.error.code === 'empty');
    continue;
  }
  const label = `WPT ${c.category} ${JSON.stringify(c.input)}${c.base ? ` base ${c.base}` : ''}`;
  if (c.failure) {
    // A base that is itself invalid makes the browser fail too.
    check(`${label} fails`, !res.ok, res.ok && res.fields.href);
    continue;
  }
  // The engine reads fields from the runtime's own URL parser. When that parser predates a
  // WPT case (Node 22 does not yet encode trailing spaces in opaque paths as %20), the case
  // tests the runtime, not the tool: skip it.
  let native = null;
  try { native = c.base == null ? new URL(c.input) : new URL(c.input, c.base); } catch { /* compared below */ }
  if (native && FIELDS.some((k) => native[k] !== c[k])) { skip(`${label} fields`, `runtime URL parser (Node ${process.versions.node}) disagrees with WPT`); continue; }
  if (!res.ok) { check(`${label} parses`, false, res.error); continue; }
  const diff = FIELDS.filter((k) => res.fields[k] !== c[k]);
  if (c.origin !== undefined && res.fields.origin !== c.origin) diff.push('origin');
  check(`${label} fields`, diff.length === 0, diff.map((k) => `${k}: ${res.fields[k]} ≠ ${c[k]}`).join('; '));
}

// ── Failure diagnosis ─────────────────────────────────────────────────────────
const failCases = [
  ['example.com/path?x=1', 'noScheme', 'https://example.com/path?x=1'],
  ['www.example.org', 'noScheme', 'https://www.example.org'],
  ['user@example.com:8443/x', 'noScheme', 'https://user@example.com:8443/x'],
  ['//cdn.example.com/app.js', 'schemeRelative', 'https://cdn.example.com/app.js'],
  ['/api/v1/users?id=7', 'relative'],
  ['../img/logo.png', 'relative'],
  ['?page=2', 'relative'],
  ['1http://example.com', 'badScheme'],
  ['http://', 'emptyHost'],
  ['https://?q=1', 'emptyHost'],
  ['https://example.com:80a/', 'badPort', '80a'],
  ['https://example.com:99999/', 'portRange', '99999'],
  ['http://[::1/', 'badIpv6'],
  ['http://[1:2:3:4:5:6:7:8:9]/', 'badIpv6'],
  ['http://exa mple.com/', 'badHostChar', ' '],
  ['http://exa<mple.com/', 'badHostChar', '<'],
  ['http://ex%20ample.com/', 'badHostChar', ' '],
  ['http://256.1.1.1/', 'badIpv4'],
  ['http://1.2.3.4.5/', 'badIpv4'],
  ['http://xn--a.com/', 'badIdn'],
];
for (const [input, code, extra] of failCases) {
  const res = E.analyze(input, '');
  check(`diagnose ${input} → ${code}`, !res.ok && res.error.code === code, res.ok ? res.fields.href : res.error);
  if (extra && (code === 'noScheme' || code === 'schemeRelative')) check(`diagnose ${input} suggestion`, res.error.suggestion === extra, res.error && res.error.suggestion);
  else if (extra) check(`diagnose ${input} detail`, res.error.detail === extra, res.error && res.error.detail);
  if (res.error && res.error.suggestion) check(`suggestion for ${input} parses`, E.analyze(res.error.suggestion, '').ok);
}
check('empty input', E.analyze('   ', '').error.code === 'empty');
check('relative with base resolves', E.analyze('../img/logo.png', 'https://example.com/docs/guide/').fields.href === 'https://example.com/docs/img/logo.png');
check('relative with base notes base', codes(E.analyze('?page=2', 'https://example.com/list?page=1')).includes('base'));
check('invalid base', E.analyze('/x', 'not a url').error.code === 'badBase');
check('with a base, "http:foo.com" resolves like new URL(input, base)', E.analyze('http:foo.com', 'http://example.org/foo/bar').fields.href === 'http://example.org/foo/foo.com');
check('absolute input ignores the base', E.analyze('https://a.example/x', 'https://b.example/').usedBase === false);

// ── Notes ─────────────────────────────────────────────────────────────────────
const plain = E.analyze('https://example.com/a/b?x=1#top', '');
check('plain URL has no notes', plain.notes.length === 0, codes(plain));
check('plain URL is valid RFC 3986', plain.rfc.error === null);

const bs = E.analyze('http://evil.example\\@good.example/login', '');
check('backslash: browser host', bs.fields.hostname === 'evil.example' && bs.fields.pathname === '/@good.example/login');
check('backslash: notes backslash + rfcHost', codes(bs).includes('backslash') && codes(bs).includes('rfcHost'), codes(bs));
check('backslash: RFC host good.example', noteOf(bs, 'rfcHost') && noteOf(bs, 'rfcHost').data.rfcHost === 'good.example');
check('backslash: RFC check flags "\\" at 20', bs.rfc.error && bs.rfc.error.pos === 20 && bs.rfc.error.reason === 'char', bs.rfc.error);

const full = E.analyze('https://user:pass@example.com:443/a/./b/../c?q=a+b&q=2&flag&x=%zz#frag', '');
check('full: notes', ['userinfo', 'password', 'defaultPort', 'dotSegments', 'badPercent'].every((c) => codes(full).includes(c)), codes(full));
check('full: default port 443 dropped', full.fields.port === '' && full.effectivePort === '443' && noteOf(full, 'defaultPort').data.raw === '443');
check('full: dot segments', noteOf(full, 'dotSegments').data.path === '/a/c');
check('full: bad percent at 63', noteOf(full, 'badPercent').data.pos === 63);
check('full: warnings first in level', noteOf(full, 'userinfo').level === 'warn' && noteOf(full, 'dotSegments').level === 'info');

const lh = E.analyze('localhost:3000/api', '');
check('localhost:3000 parses as scheme', lh.ok && lh.fields.protocol === 'localhost:' && lh.fields.pathname === '3000/api');
check('localhost:3000 note with suggestion', noteOf(lh, 'schemeLooksLikeHost') && noteOf(lh, 'schemeLooksLikeHost').data.suggestion === 'https://localhost:3000/api');
check('example.com:8080/x note', codes(E.analyze('example.com:8080/x', '')).includes('schemeLooksLikeHost'));
check('mailto has no host note', !codes(E.analyze('mailto:a@b.example', '')).includes('schemeLooksLikeHost'));

const v4 = E.analyze('http://0x7f.1/admin', '');
check('IPv4 shorthand → 127.0.0.1 with note', v4.fields.hostname === '127.0.0.1' && noteOf(v4, 'ipv4') && noteOf(v4, 'ipv4').data.raw === '0x7f.1');
check('IPv4 decimal 2130706433', noteOf(E.analyze('http://2130706433/', ''), 'ipv4').data.host === '127.0.0.1');
check('IPv4 octal 0177.0.0.1', E.analyze('http://0177.0.0.1/', '').fields.hostname === '127.0.0.1');
check('plain IPv4 has no note', !codes(E.analyze('http://192.168.0.1/', '')).includes('ipv4'));
check('IPv6 compressed note', noteOf(E.analyze('http://[0:0:0:0:0:0:0:1]:8080/', ''), 'ipv6').data.host === '[::1]');

const homo = E.analyze('https://раураl.com/signin', '');
check('homograph: punycode host', homo.fields.hostname === 'xn--l-7sba6dbr.com');
check('homograph: idn + mixedScript', codes(homo).includes('idn') && codes(homo).includes('mixedScript'), codes(homo));
check('homograph: unicode host', homo.hostUnicode === 'раураl.com');
check('whole-script Cyrillic look-alike', codes(E.analyze('https://аре.com/', '')).includes('lookalike'));
check('Japanese IDN is not mixed', !codes(E.analyze('https://例え.jp/', '')).includes('mixedScript'));
check('Japanese kana + kanji + Latin label allowed', E.hostScriptWarnings('東京ガスabc.jp').length === 0);
check('Korean IDN allowed', E.hostScriptWarnings('한국인터넷진흥원.한국').length === 0);
check('Russian domain is not a look-alike', E.hostScriptWarnings('пример.рф').length === 0);
check('xn-- in input decoded', E.analyze('https://xn--r8jz45g.jp/', '').hostUnicode === '例え.jp');

const ui = E.analyze('https://paypal.com@evil.example/login', '');
check('user name that looks like a host', noteOf(ui, 'userinfoHost') && noteOf(ui, 'userinfoHost').data.host === 'evil.example');
check('user name without dot', codes(E.analyze('https://bob@example.com/', '')).includes('userinfo'));

const wide = E.analyze('HTTPS://ＥＸＡＭＰＬＥ.com/a b', '');
check('full-width host normalized', wide.fields.hostname === 'example.com' && noteOf(wide, 'hostChanged'));
check('space percent-encoded', noteOf(wide, 'encoded') && noteOf(wide, 'encoded').data.list[0].enc === '%20');
check('upper-case host alone is not noted', !codes(E.analyze('https://Example.COM/', '')).includes('hostChanged'));
check('percent-encoded host', noteOf(E.analyze('http://%65xample.com/', ''), 'hostChanged').data.host === 'example.com');
check('missing slashes', codes(E.analyze('https:example.com', '')).includes('slashes') && codes(E.analyze('https:example.com', '')).includes('rfcNoAuthority'));
check('three slashes', noteOf(E.analyze('https:///example.com/', ''), 'slashes').data.count === 3);
check('%2e%2e dot segment', noteOf(E.analyze('https://example.com/a/%2e%2e/b', ''), 'dotSegments').data.path === '/b');
check('javascript: risky', codes(E.analyze('javascript:alert(1)', '')).includes('risky'));
check('data: risky + opaque path', E.analyze('data:text/plain,hi', '').opaquePath === true);
check('opaque host note', codes(E.analyze('foo://例え.jp/x', '')).includes('opaqueHost'));
check('trimmed + tab/newline', ['trimmed', 'tabNl'].every((c) => codes(E.analyze('  https://exa\nmple.com/\t ', '')).includes(c)));
check('semicolon note', codes(E.analyze('https://example.com/?a=1;b=2', '')).includes('semicolon'));
check('invalid UTF-8 note', codes(E.analyze('https://example.com/?a=%E4%B8', '')).includes('badUtf8'));
check('invalid UTF-8 in path', E.analyze('https://example.com/%FF', '').segments[0].badUtf8 === true);
check('encoded slash in segment', E.analyze('https://example.com/a%2Fb/c', '').segments[0].encodedSlash === true);
check('fragment decoded', E.analyze('https://example.com/#%E7%B5%90%E6%9E%9C', '').fragmentText === '結果');

// Percent-encoded characters reported = what the parser did, for every printable ASCII char.
for (const part of ['path', 'query', 'fragment']) {
  const bad = [];
  for (let c = 0x21; c < 0x7f; c++) {
    const ch = String.fromCharCode(c);
    if ('#?%'.includes(ch) || (part === 'fragment' && ch === '#') || (part === 'path' && ch === '\\')) continue;
    const s = part === 'path' ? `http://a/x${ch}y` : part === 'query' ? `http://a/?x${ch}y` : `http://a/#x${ch}y`;
    let u;
    try { u = new URL(s); } catch { continue; }
    const out = part === 'path' ? u.pathname : part === 'query' ? u.search : u.hash;
    const encoded = !out.includes(`x${ch}y`);
    const mine = E.encodedChars(`x${ch}y`, part, 'http:').some((x) => x.ch === ch);
    if (encoded !== mine) bad.push(ch);
  }
  check(`encodedChars(${part}) matches the parser`, bad.length === 0, bad.join(' '));
}
check('non-special query keeps "\'"', E.encodedChars("a'b", 'query', 'foo:').length === 0 && E.encodedChars("a'b", 'query', 'https:').length === 1);
check('non-ASCII encoded as UTF-8', E.encodedChars('東', 'path', 'https:')[0].enc === '%E6%9D%B1');

// ── RFC 3986 ──────────────────────────────────────────────────────────────────
const sp = E.rfcSplit('foo://example.com:8042/over/there?name=ferret#nose');
check('RFC §3 example split', sp.scheme === 'foo' && sp.authority === 'example.com:8042' && sp.host === 'example.com' && sp.port === '8042' && sp.path === '/over/there' && sp.query === 'name=ferret' && sp.fragment === 'nose');
check('RFC split of urn', E.rfcSplit('urn:example:animal:ferret:nose').path === 'example:animal:ferret:nose');
check('RFC split of IPv6 literal', E.rfcSplit('ldap://[2001:db8::7]/c=GB?objectClass?one').host === '[2001:db8::7]');
const rfcValid = [
  'ftp://ftp.is.co.za/rfc/rfc1808.txt', 'http://www.ietf.org/rfc/rfc2396.txt', 'ldap://[2001:db8::7]/c=GB?objectClass?one',
  'mailto:John.Doe@example.com', 'news:comp.infosystems.www.servers.unix', 'tel:+1-816-555-1212', 'telnet://192.0.2.16:80/',
  'urn:oasis:names:specification:docbook:dtd:xml:4.1.2', 'g:h', 'g', './g', 'g/', '/g', '//g', '?y', 'g?y', '#s', 'g#s', 'g?y#s',
  ';x', 'g;x', 'g;x?y#s', '', '.', './', '..', '../', '../g', '../..', '../../', '../../g', 'http://a/b/c/d;p?q',
];
for (const s of rfcValid) check(`RFC 3986 valid: ${JSON.stringify(s)}`, E.rfcCheck(s) === null, E.rfcCheck(s));
const rfcInvalid = [
  ['https://example.com/a b', 'char', 22],
  ['https://例え.jp/', 'nonAscii', 9],
  ['https://example.com/100%', 'percent', 24],
  ['https://example.com/?q=%G1', 'percent', 24],
  ['https://example.com/#a#b', 'hash', 23],
  ['https://example.com/a[1]', 'bracket', 22],
  ['https://a@b@example.com/', 'userinfo', 10],
  ['https://example.com:8o/', 'port', 21],
  ['https://[::1/', 'ipLiteral', 9],
  ['1abc:x', 'scheme', 1],
  ['a:b/c:d', null, 0],
  ['https://example.com/a|b', 'char', 22],
];
for (const [s, reason, pos] of rfcInvalid) {
  const e = E.rfcCheck(s);
  if (reason === null) { check(`RFC 3986 ${s} valid`, e === null, e); continue; }
  check(`RFC 3986 invalid ${s}: ${reason} at ${pos}`, e && e.reason === reason && e.pos === pos, e);
}

let python = null;
try { execFileSync('python3', ['-c', 'import urllib.parse'], { stdio: 'ignore' }); python = 'python3'; } catch { python = null; }
const pyInputs = [
  'http://evil.example\\@good.example/login', 'https://a@b@example.com/', 'http://example.com:80@evil.example/',
  'https://user:pass@example.com:443/a', 'http://[::1]:8080/', 'https://example.com#@evil.example', 'https://example.com?@evil.example',
  'https://Example.COM/', 'http://0x7f.1/',
];
if (python) {
  const out = execFileSync(python, ['-c', 'import json,sys,urllib.parse as u\nprint(json.dumps([u.urlsplit(s).hostname for s in json.loads(sys.stdin.read())]))'], { input: JSON.stringify(pyInputs) }).toString();
  const hosts = JSON.parse(out);
  pyInputs.forEach((s, i) => {
    const h = E.rfcSplit(s).host;
    check(`RFC host of ${s} = Python urlsplit hostname`, (h === null ? null : h.replace(/^\[|\]$/g, '').toLowerCase()) === hosts[i], `${h} vs ${hosts[i]}`);
  });
} else {
  skip('RFC host vs Python urlsplit', 'python3 not installed');
}

// ── Punycode ──────────────────────────────────────────────────────────────────
const idnHosts = new Set(['例え.jp', 'bücher.example', 'пример.рф', '한국인터넷진흥원.한국', 'münchen.de', 'ελληνικά.gr', 'xn--l-7sba6dbr.com', 'faß.de', '🍕.example']);
for (const c of fixture.parsing) if (c.hostname && /xn--/i.test(c.hostname)) idnHosts.add(c.hostname);
let punyBad = [];
for (const h of idnHosts) {
  const ascii = domainToASCII(h);
  if (!ascii) continue;
  if (E.hostToUnicode(ascii).unicode !== domainToUnicode(ascii)) punyBad.push(h);
}
check('hostToUnicode = domainToUnicode on sample hosts', punyBad.length === 0, punyBad);
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const ranges = [[0x61, 0x7a], [0xe0, 0x24f], [0x3041, 0x30ff], [0x4e00, 0x9fff], [0xac00, 0xd7a3], [0x430, 0x44f], [0x3b1, 0x3c9]];
punyBad = [];
for (let t = 0; t < 2000; t++) {
  const len = 1 + Math.floor(rand() * 10);
  let label = '';
  for (let i = 0; i < len; i++) { const r = ranges[Math.floor(rand() * ranges.length)]; label += String.fromCodePoint(r[0] + Math.floor(rand() * (r[1] - r[0] + 1))); }
  const ascii = domainToASCII(label + '.example');
  if (!ascii) continue;
  if (E.hostToUnicode(ascii).unicode !== domainToUnicode(ascii)) punyBad.push(label);
}
check('hostToUnicode = domainToUnicode on 2,000 generated labels', punyBad.length === 0, punyBad.slice(0, 5));
check('invalid punycode stays as is', E.punyDecode('99999999999') === null && E.hostToUnicode('xn--99999999999.com').idn === false);

// ── Query ─────────────────────────────────────────────────────────────────────
const alphabet = ['a', 'b', 'Z', '0', '=', '&', '+', '%', '%2', '%20', '%2B', '%26', '%3D', '%E4%B8%AD', '%E4%B8', '%FF', '%zz', ' ', ';', '中', 'é', '~', '\'', '!', '%C3%A9', '&&', '=='];
let qBad = [];
for (let t = 0; t < 3000; t++) {
  let q = '';
  const n = Math.floor(rand() * 12);
  for (let i = 0; i < n; i++) q += alphabet[Math.floor(rand() * alphabet.length)];
  const search = new URL('https://h/?' + q).search;
  const mine = E.parseQuery(search).map((p) => [p.key, p.value]);
  const ref = [...new URLSearchParams(search)];
  if (JSON.stringify(mine) !== JSON.stringify(ref)) { qBad.push(q); continue; }
  const rebuilt = E.serializeQuery(E.parseQuery(search));
  if ((rebuilt ? '?' + rebuilt : '') !== search.replace(/^\?$/, '') && rebuilt !== search.slice(1).replace(/&+$/, '').replace(/^&+/, '').replace(/&&+/g, '&')) qBad.push('rebuild:' + q);
}
check('parseQuery = URLSearchParams on 3,000 random queries', qBad.length === 0, qBad.slice(0, 5));

const q = E.parseQuery('?q=a+b&q=2&flag&x=%zz&a=%E4%B8&b=caf%C3%A9&c=1;d=2');
check('query: 7 pairs', q.length === 7);
check('query: "+" is a space', q[0].value === 'a b' && q[0].plus === true);
check('query: repeat count', q[0].occurrence === 1 && q[0].total === 2 && q[1].occurrence === 2);
check('query: no "="', q[2].hasEq === false && q[2].value === '');
check('query: bad percent kept', q[3].value === '%zz' && q[3].badPercent === true);
check('query: invalid UTF-8 → U+FFFD', q[4].value === '\uFFFD' && q[4].badUtf8 === true);
check('query: valid UTF-8', q[5].value === 'café' && !q[5].badUtf8);
check('query: semicolon is not a separator', q[6].key === 'c' && q[6].value === '1;d=2' && q[6].semicolon);
const untouched = 'q=a+b&q=2&flag&x=%zz&a=%E4%B8&b=caf%C3%A9&c=1;d=2';
check('rebuild without edits is byte-identical', E.serializeQuery(E.parseQuery('?' + untouched)) === untouched);
const naive = new URLSearchParams(untouched).toString();
check('URLSearchParams.toString() would change it (flag=, %25zz, %EF%BF%BD)', naive.includes('flag=') && naive.includes('%25zz') && naive.includes('%EF%BF%BD'));
const edited = E.parseQuery('?' + untouched);
edited[5].value = 'naïve & co';
edited[5].edited = true;
const out1 = E.serializeQuery(edited);
check('one edit changes only that pair', out1 === 'q=a+b&q=2&flag&x=%zz&a=%E4%B8&b=na%C3%AFve+%26+co&c=1;d=2', out1);
check('edited value reads back', new URLSearchParams(out1).getAll('b')[0] === 'naïve & co');
edited[2].removed = true;
edited.push({ key: 'new key', value: '1+1=2', edited: true });
const out2 = E.serializeQuery(edited);
check('remove + add', out2 === 'q=a+b&q=2&x=%zz&a=%E4%B8&b=na%C3%AFve+%26+co&c=1;d=2&new+key=1%2B1%3D2', out2);
check('empty added pair ignored', E.serializeQuery([{ key: '', value: '', edited: true }]) === '');
let editBad = [];
for (let t = 0; t < 500; t++) {
  let qs = '';
  for (let i = 0; i < 6; i++) qs += alphabet[Math.floor(rand() * alphabet.length)];
  const search = new URL('https://h/?' + qs).search;
  const pairs = E.parseQuery(search);
  if (!pairs.length) continue;
  const i = Math.floor(rand() * pairs.length);
  const v = alphabet[Math.floor(rand() * alphabet.length)] + 'é &=+';
  pairs[i].value = v;
  pairs[i].edited = true;
  const href = E.setComponent('https://h/', 'search', '?' + E.serializeQuery(pairs)).href;
  const back = E.parseQuery(new URL(href).search);
  const others = pairs.every((p, j) => j === i || back[j].raw === p.raw);
  if (back[i].value !== v || !others) editBad.push(qs);
}
check('500 random single edits read back, other pairs untouched', editBad.length === 0, editBad.slice(0, 5));

// ── Editing components ────────────────────────────────────────────────────────
let setBad = [];
for (const [field, cases] of Object.entries(fixture.setters)) {
  for (const c of cases) {
    const native = new URL(c.href);
    native[field] = c.new_value;
    if (Object.entries(c.expected).some(([k, v]) => native[k] !== v)) {
      skip(`WPT setter ${field} ${c.href} ← ${c.new_value}`, `runtime URL setter (Node ${process.versions.node}) disagrees with WPT`);
      continue;
    }
    const r = E.setComponent(c.href, field, c.new_value);
    const u = new URL(r.href);
    const diff = Object.entries(c.expected).filter(([k, v]) => u[k] !== v);
    if (diff.length) setBad.push(`${field} ${c.href} ← ${c.new_value}: ${diff.map(([k]) => k).join(',')}`);
  }
}
check('WPT setter subset', setBad.length === 0, setBad.slice(0, 5));
check('setter cases cover 7 fields', Object.keys(fixture.setters).length === 7);
const ign = E.setComponent('https://example.com/', 'port', '99999');
check('port 99999 ignored', ign.status === 'ignored' && ign.href === 'https://example.com/');
const adj = E.setComponent('https://example.com/', 'port', '8080abc');
check('port 8080abc adjusted to 8080', adj.status === 'adjusted' && adj.actual === '8080' && adj.href === 'https://example.com:8080/');
check('port 443 on https adjusts to default', E.setComponent('https://example.com:8443/', 'port', '443').href === 'https://example.com/');
check('protocol https → foo ignored', E.setComponent('https://example.com/', 'protocol', 'foo').status === 'ignored');
check('protocol https → wss ok', E.setComponent('https://example.com/', 'protocol', 'wss').status === 'ok');
check('hostname with space ignored', E.setComponent('https://example.com/', 'hostname', 'exa mple').status === 'ignored');
check('hostname IDN adjusted to punycode', E.setComponent('https://example.com/', 'hostname', '例え.jp').actual === 'xn--r8jz45g.jp');
check('pathname with space encoded', E.setComponent('https://example.com/', 'pathname', '/a b').href === 'https://example.com/a%20b');
check('hash set', E.setComponent('https://example.com/', 'hash', 'top').status === 'ok');

// ── JSON ──────────────────────────────────────────────────────────────────────
const json = JSON.parse(E.toJson(E.analyze('https://例え.jp/a/%E3%83%91?q=a+b&q=2#x', '')));
check('JSON: hostnameUnicode, segments, repeated keys', json.hostnameUnicode === '例え.jp' && json.pathSegments[1] === 'パ' && json.query.length === 2 && json.query[0][1] === 'a b' && json.effectivePort === '443');

// ── STRINGS ───────────────────────────────────────────────────────────────────
const flatKeys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flatKeys(v, `${p}${k}.`) : [`${p}${k}`]));
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const langs = ['en', 'zh', 'ja', 'ko'];
const enKeys = flatKeys(STRINGS.en).sort();
for (const lang of langs.slice(1)) {
  check(`STRINGS ${lang} keys = en`, JSON.stringify(flatKeys(STRINGS[lang]).sort()) === JSON.stringify(enKeys), enKeys.filter((k) => !flatKeys(STRINGS[lang]).includes(k)));
  const get = (o, k) => k.split('.').reduce((a, b) => a[b], o);
  const mism = enKeys.filter((k) => placeholders(get(STRINGS.en, k)) !== placeholders(get(STRINGS[lang], k)));
  check(`STRINGS ${lang} placeholders = en`, mism.length === 0, mism);
}
const errorCodes = ['noScheme', 'schemeRelative', 'relative', 'badScheme', 'emptyHost', 'badPort', 'portRange', 'badIpv6', 'badHostChar', 'badIpv4', 'badIdn', 'badBase', 'invalid'];
const noteCodes = ['base', 'userinfo', 'userinfoHost', 'password', 'idn', 'mixedScript', 'lookalike', 'risky', 'opaqueHost', 'trimmed', 'tabNl', 'backslash', 'slashes', 'schemeLooksLikeHost', 'ipv4', 'ipv6', 'hostChanged', 'defaultPort', 'portChanged', 'dotSegments', 'encoded', 'rfcHost', 'rfcNoAuthority', 'badPercent', 'badUtf8', 'semicolon'];
const engineSrc = source.slice(startIndex, endIndex);
const emittedNotes = [...new Set([...engineSrc.matchAll(/note\('(\w+)'/g)].map((m) => m[1]).concat(['mixedScript', 'lookalike']))];
check('every emitted note code has a message', emittedNotes.every((c) => STRINGS.en.notes[c]), emittedNotes.filter((c) => !STRINGS.en.notes[c]));
check('note table matches the list', JSON.stringify(Object.keys(STRINGS.en.notes).sort()) === JSON.stringify(noteCodes.slice().sort()));
const emittedErrors = [...new Set([...engineSrc.matchAll(/code: '(\w+)'/g)].map((m) => m[1]))].filter((c) => c !== 'empty');
check('every error code has a message', emittedErrors.every((c) => STRINGS.en.errors[c]) && errorCodes.every((c) => STRINGS.en.errors[c]), emittedErrors.filter((c) => !STRINGS.en.errors[c]));
check('every RFC reason has a message', ['char', 'nonAscii', 'percent', 'scheme', 'userinfo', 'ipLiteral', 'bracket', 'port', 'hash'].every((r) => STRINGS.en.rfcReasons[r]));
for (const lang of langs) {
  const ex = E.analyze(STRINGS[lang].exampleUrl, '');
  check(`${lang} example parses with notes and repeated keys`, ex.ok && ex.notes.length > 0 && ex.params.some((p) => p.total > 1), ex.ok ? codes(ex) : ex.error);
}

// ── Privacy and safety of the component script ────────────────────────────────
const script = source.slice(source.indexOf('<script is:inline'), source.indexOf('</script>'));
check('script uses no storage, cookies or network', !/localStorage|sessionStorage|ztPersist|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|location\.(hash|search|href)\s*=|history\./.test(script));
check('script writes no HTML', !/innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/.test(script));
const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
check('no persistence entry needed (nothing saved)', !/'url-parser'/.test(persistence));
check('password field masked by default', /type=\{field === 'password' \? 'password' : 'text'\}/.test(source));

// ── Page examples (`up-check` annotations) ───────────────────────────────────
const pages = langs.map((l) => `src/content/tools/url-parser/${l}.mdx`).concat(['src/content/blog/url-parser-guide/en.mdx']);
let annotations = 0;
for (const rel of pages) {
  const path = join(root, rel);
  if (!existsSync(path)) { check(`${rel} exists`, false); continue; }
  const text = readFileSync(path, 'utf8');
  for (const m of text.matchAll(/\{\/\* up-check: (\{.*?\}) \*\/\}/g)) {
    annotations++;
    let spec;
    try { spec = JSON.parse(m[1]); } catch (e) { check(`${rel} annotation is JSON`, false, m[1]); continue; }
    const res = E.analyze(spec.input, spec.base || '');
    const name = `${rel} ${JSON.stringify(spec.input)}`;
    if (spec.error) { check(`${name} → ${spec.error}`, !res.ok && res.error.code === spec.error, res.ok ? res.fields.href : res.error); continue; }
    if (!res.ok) { check(`${name} parses`, false, res.error); continue; }
    for (const [k, v] of Object.entries(spec.fields || {})) check(`${name} ${k}`, res.fields[k] === v, `${res.fields[k]} ≠ ${v}`);
    for (const c of spec.notes || []) check(`${name} note ${c}`, codes(res).includes(c), codes(res));
    if (spec.noNotes) check(`${name} has no notes`, res.notes.length === 0, codes(res));
    if (spec.unicode) check(`${name} unicode host`, res.hostUnicode === spec.unicode, res.hostUnicode);
    if (spec.rfcHost !== undefined) check(`${name} RFC host`, noteOf(res, 'rfcHost') && noteOf(res, 'rfcHost').data.rfcHost === spec.rfcHost);
    if (spec.params) check(`${name} params`, JSON.stringify(res.params.map((p) => [p.key, p.value])) === JSON.stringify(spec.params), res.params.map((p) => [p.key, p.value]));
    if (spec.rfcValid !== undefined) check(`${name} RFC validity`, (res.rfc.error === null) === spec.rfcValid, res.rfc.error);
    if (spec.text) {
      // The quoted engine output must appear verbatim on the page.
      for (const t of spec.text) check(`${name} quoted "${t}" on page`, text.includes(t));
    }
  }
}
check('pages carry up-check annotations', annotations >= 12, annotations);

// The guide's JavaScript block: every `console.log(x); // value` prints the value in the comment.
{
  const guide = readFileSync(join(root, 'src/content/blog/url-parser-guide/en.mdx'), 'utf8');
  const block = (guide.match(/```js\n([\s\S]*?)```/) || [])[1];
  if (!block) check('guide has a JavaScript block', false);
  else {
    const expected = [...block.matchAll(/console\.log\(.*\); \/\/ (.*)$/gm)].map((m) => m[1]);
    const printed = [];
    new Function('console', block)({ log: (v) => printed.push(typeof v === 'string' ? v : JSON.stringify(v)) });
    check('guide JavaScript block has 7 checked lines', expected.length === 7, expected.length);
    expected.forEach((e, i) => check(`guide JS line ${i + 1} prints ${e}`, printed[i] === e, printed[i]));
  }
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('guide has no template headings', tpl.length === 0, tpl.map(String));
}


// ---------- v2 page layout (DESIGN.md "Tool Pages v2", kind: analyze) ----------
{
  const markup = source.replace(/^---\n[\s\S]*?\n---/, '').split('<script')[0].trim();
  const tipNames = ['input', 'base', 'normalized', 'fields', 'query'];
  check('the tool root owns the first-screen height', /^<div class="up-wrap" id="up-wrap">/.test(markup));
  check('no primary action is added to the live parser', !markup.includes('btn-primary'));
  check('labels render before the client script starts', !source.includes('data-i18n'));
  check('controls and status precede the input panel', markup.indexOf('id="up-example"') < markup.indexOf('id="up-status"')
    && markup.indexOf('id="up-status"') < markup.indexOf('id="up-input"'));
  check('result help names what appears after input', markup.includes('{L.resultEmpty}'));
  check('five explained controls have distinct toggletips', JSON.stringify([...markup.matchAll(/<Toggletip id="up-tip-(\w+)"/g)].map((m) => m[1])) === JSON.stringify(tipNames));
  check('toggletips stay out of the client payload', source.includes('const { tips: TIPS, ...CLIENT_L } = L;')
    && source.includes('define:vars={{ S: CLIENT_L }}'));
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['up-wrap', 'up-input', 'up-example', 'up-clear', 'up-base-box', 'up-base', 'up-status', 'up-suggest',
    'up-results', 'up-href', 'up-notes', 'up-reveal', 'up-query-title', 'up-copy-json', 'up-query-note', 'up-params',
    'up-add', 'up-seg-section', 'up-seg-title', 'up-segments', 'up-rfc-summary', 'up-rfc-parts']) {
    check('existing control occurs once: ' + id, ids.filter((x) => x === id).length === 1);
  }
  for (const lang of langs) {
    check(lang + ': all five controls have help', JSON.stringify(Object.keys(STRINGS[lang].tips || {})) === JSON.stringify(tipNames));
    check(lang + ': help is nonempty plain text', tipNames.every((key) => typeof STRINGS[lang].tips?.[key] === 'string'
      && STRINGS[lang].tips[key].trim().length > 0 && !/<\/?[a-z]/i.test(STRINGS[lang].tips[key])));
    const mdx = readFileSync(join(root, 'src/content/tools/url-parser/' + lang + '.mdx'), 'utf8');
    const front = mdx.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const data = yaml.load(front);
    const body = mdx.slice(front.length + 8);
    check(lang + ': five steps precede the FAQ', Array.isArray(data.steps) && data.steps.length === 5
      && front.indexOf('\nsteps:') < front.indexOf('\nfaqItems:'));
    check(lang + ': steps fit llms-full text limits', Array.isArray(data.steps)
      && data.steps.every((step) => typeof step === 'string' && step.length <= 280 && !/<\/?[a-z]/i.test(step))
      && data.steps.reduce((sum, step) => sum + step.length, 0) <= 1200);
    check(lang + ': no duplicate usage section', !/^## (How to Use|用法|使い方|사용 방법)\s*$/mi.test(body));
    check(lang + ': limitations remain', /^## (Limits|限制|制限|제한 사항)\s*$/m.test(body));
  }
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('listed as an analyze page', /'url-parser':\s*'analyze'/.test(layouts));
}

console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
