// DNS Lookup — input normalization, query URL and response-merging regression test
//
// Read:  src/components/tools/DnsLookupTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: normalizeDomain (URL, port, trailing dot, case, full-width input, IDN to punycode,
// underscore labels); isValidDomain (underscore labels for _dmarc / _domainkey / SRV names,
// label and name length limits); buildQueryUrl (both resolvers send do=1 and cd=0, name and
// type are URL-encoded); displayAnswers (RRSIG hidden from the Records view and the count);
// resolverComments (string and array Comment, Google extended_dns_errors written as "EDE(n): text",
// dedupe); dnssecStatus (AD → validated; SERVFAIL with a DNSSEC EDE code from RFC 8914 §4 → failed,
// other SERVFAIL → unknown; real dnssec-failed.org responses of 2026-09-30); mergeAllResults (NOERROR when any type
// answers, NXDOMAIN / SERVFAIL kept when every type returns it, all-failed becomes SERVFAIL,
// AD only when every type validated, TC, partial errors, comments merged); 4-language STRINGS
// have the same keys.
//
// Run: node scripts/test-dns-lookup.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DnsLookupTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in DnsLookupTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { normalizeDomain, isValidDomain, buildQueryUrl, displayAnswers, resolverComments, dnssecStatus, mergeAllResults, typeNameFromCode };')();

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

// ---------- normalizeDomain ----------
eq('bare host', E.normalizeDomain('example.com'), 'example.com');
eq('trim + case', E.normalizeDomain('  Example.COM  '), 'example.com');
eq('trailing dot', E.normalizeDomain('example.com.'), 'example.com');
eq('port', E.normalizeDomain('example.com:8443'), 'example.com');
eq('full URL', E.normalizeDomain('https://Sub.Example.com/path?q=1#x'), 'sub.example.com');
eq('URL with user info', E.normalizeDomain('https://user:pw@example.com/'), 'example.com');
eq('IDN to punycode', E.normalizeDomain('日本語.jp'), 'xn--wgv71a119e.jp');
eq('ideographic full stop', E.normalizeDomain('日本語。jp'), 'xn--wgv71a119e.jp');
eq('full-width ASCII', E.normalizeDomain('ＥＸＡＭＰＬＥ．ｃｏｍ'), 'example.com');
eq('Korean IDN', E.normalizeDomain('한국인터넷진흥원.한국'), 'xn--3e0bx5e6xzftae3gxzpskhile.xn--3e0b707e');
eq('underscore label kept', E.normalizeDomain('_dmarc.Example.com'), '_dmarc.example.com');
eq('arpa name', E.normalizeDomain('1.1.1.1.in-addr.arpa.'), '1.1.1.1.in-addr.arpa');
eq('empty', E.normalizeDomain('   '), '');
eq('null', E.normalizeDomain(null), '');
eq('space inside stays invalid', E.isValidDomain(E.normalizeDomain('exa mple.com')), false);

// ---------- isValidDomain ----------
for (const d of ['example.com', 'zerotool.dev', '_dmarc.zerotool.dev', 'cf2024-1._domainkey.zerotool.dev',
  '_xmpp-server._tcp.jabber.org', '1.1.1.1.in-addr.arpa', 'xn--wgv71a119e.jp', 'a.b', 'x1.example']) {
  eq('valid ' + d, E.isValidDomain(d), true);
}
for (const d of ['', 'localhost', '-a.example.com', 'a-.example.com', 'a..b', '.example.com',
  'exa mple.com', 'example.com/', '[::1]', 'a'.repeat(64) + '.com']) {
  eq('invalid ' + JSON.stringify(d), E.isValidDomain(d), false);
}
eq('63-char label ok', E.isValidDomain('a'.repeat(63) + '.com'), true);
const long253 = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
eq('253-char name ok', long253.length === 253 && E.isValidDomain(long253), true);
eq('254-char name rejected', E.isValidDomain(long253 + 'e'), false);

// ---------- buildQueryUrl ----------
const cf = E.buildQueryUrl('_dmarc.example.com', 'TXT', 'cloudflare');
eq('cloudflare url', cf.url, 'https://cloudflare-dns.com/dns-query?name=_dmarc.example.com&type=TXT&do=1&cd=0');
eq('cloudflare accept header', cf.headers, { accept: 'application/dns-json' });
const gg = E.buildQueryUrl('example.com', 'CAA', 'google');
eq('google url', gg.url, 'https://dns.google/resolve?name=example.com&type=CAA&do=1&cd=0');
eq('google headers', gg.headers, {});
check('name is encoded', E.buildQueryUrl('a&b.com', 'A', 'google').url.indexOf('name=a%26b.com') !== -1);
eq('unknown resolver falls back to cloudflare', E.buildQueryUrl('example.com', 'A', 'x').url.indexOf('https://cloudflare-dns.com/'), 0);

// ---------- typeNameFromCode ----------
eq('type 46', E.typeNameFromCode(46), 'RRSIG');
eq('type 257', E.typeNameFromCode(257), 'CAA');
eq('unknown type', E.typeNameFromCode(65), 'TYPE65');

// ---------- displayAnswers ----------
const signedA = {
  Status: 0, AD: true, Answer: [
    { name: 'example.com', type: 1, TTL: 194, data: '172.66.147.243' },
    { name: 'example.com', type: 1, TTL: 194, data: '104.20.23.154' },
    { name: 'example.com', type: 46, TTL: 194, data: 'A 13 2 300 1790739030 1790559030 34505 example.com. sig' },
  ],
};
eq('RRSIG hidden', E.displayAnswers(signedA).map((a) => a.type), [1, 1]);
eq('no Answer', E.displayAnswers({ Status: 3 }), []);

// ---------- resolverComments ----------
eq('string comment', E.resolverComments({ Comment: 'Response from 108.162.192.162.' }), ['Response from 108.162.192.162.']);
eq('array comment', E.resolverComments({ Comment: ['EDE(9): DNSKEY Missing', 'EDE(9): DNSKEY Missing'] }), ['EDE(9): DNSKEY Missing']);
eq('no comment', E.resolverComments({}), []);
eq('empty strings dropped', E.resolverComments({ Comment: ['', '  '] }), []);

// Real responses for dnssec-failed.org, 2026-09-30 03:09–03:10 UTC (devto-b fact-check, final.txt).
const cfFailed = {"Status":2,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,"Question":[{"name":"dnssec-failed.org","type":1}],"Comment":["EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org."]};
const ggFailed = {"Status":2,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,"Question":[{"name":"dnssec-failed.org.","type":1}],"Comment":"DNSSEC validation failure. Check http://dnsviz.net/d/dnssec-failed.org/dnssec/ and http://dnssec-debugger.verisignlabs.com/dnssec-failed.org for errors","extended_dns_errors":[{"info_code":9,"extra_text":"No DNSKEY matches DS RRs of dnssec-failed.org"}]};
const ggExample = {"Status":0,"TC":false,"RD":true,"RA":true,"AD":true,"CD":false,"Question":[{"name":"example.com.","type":1}],"Answer":[{"name":"example.com.","type":1,"TTL":300,"data":"172.66.147.243"},{"name":"example.com.","type":1,"TTL":300,"data":"104.20.23.154"}],"Comment":"Response from 172.64.32.162."};
const cfUnsigned = {"Status":0,"TC":false,"RD":true,"RA":true,"AD":false,"CD":false,"Question":[{"name":"www.baidu.com","type":1}],"Answer":[{"name":"www.wshifen.com","type":1,"TTL":274,"data":"103.235.47.188"}]};

eq('google EDE joins the note list', E.resolverComments(ggFailed), [
  'DNSSEC validation failure. Check http://dnsviz.net/d/dnssec-failed.org/dnssec/ and http://dnssec-debugger.verisignlabs.com/dnssec-failed.org for errors',
  'EDE(9): No DNSKEY matches DS RRs of dnssec-failed.org',
]);
eq('google EDE without extra_text', E.resolverComments({ Status: 2, extended_dns_errors: [{ info_code: 6 }] }), ['EDE(6)']);
eq('google EDE deduped', E.resolverComments({ extended_dns_errors: [{ info_code: 9, extra_text: 'x' }, { info_code: 9, extra_text: 'x' }] }), ['EDE(9): x']);
eq('google EDE without info_code ignored', E.resolverComments({ extended_dns_errors: [{ extra_text: 'x' }, null] }), []);

// ---------- dnssecStatus ----------
eq('dnssec: AD true is validated', E.dnssecStatus(ggExample), 'validated');
eq('dnssec: NOERROR without AD is not validated', E.dnssecStatus(cfUnsigned), 'unvalidated');
eq('dnssec: cloudflare SERVFAIL with EDE(9) failed', E.dnssecStatus(cfFailed), 'failed');
eq('dnssec: google SERVFAIL with extended_dns_errors 9 failed', E.dnssecStatus(ggFailed), 'failed');
eq('dnssec: SERVFAIL without EDE is unknown', E.dnssecStatus({ Status: 2, AD: false }), 'unknown');
eq('dnssec: SERVFAIL with a plain comment is unknown', E.dnssecStatus({ Status: 2, AD: false, Comment: 'upstream timed out' }), 'unknown');
// RFC 8914 §4: codes whose definition is about DNSSEC validation.
const dnssecCodes = [1, 2, 5, 6, 7, 8, 9, 10, 11, 12];
for (let code = 0; code <= 24; code++) {
  const expected = dnssecCodes.includes(code) ? 'failed' : 'unknown';
  eq('dnssec: SERVFAIL + cloudflare EDE(' + code + ')', E.dnssecStatus({ Status: 2, AD: false, Comment: ['EDE(' + code + '): text'] }), expected);
  eq('dnssec: SERVFAIL + google EDE ' + code, E.dnssecStatus({ Status: 2, AD: false, extended_dns_errors: [{ info_code: code }] }), expected);
}
eq('dnssec: NXDOMAIN with EDE(9) is not called failed', E.dnssecStatus({ Status: 3, AD: false, Comment: ['EDE(9): x'] }), 'unvalidated');
eq('dnssec: cd=1 NOERROR with EDE(9) is not called failed', E.dnssecStatus({ Status: 0, AD: false, CD: true, Comment: ['EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.'] }), 'unvalidated');
eq('dnssec: EDE text in the middle of a note does not count', E.dnssecStatus({ Status: 2, AD: false, Comment: 'see EDE(9) docs' }), 'unknown');

// ---------- mergeAllResults ----------
function ok(typeName, value) { return { status: 'fulfilled', value, typeName }; }
function bad(typeName, message) { return { status: 'rejected', reason: new Error(message), typeName }; }

let m = E.mergeAllResults([
  ok('A', signedA),
  ok('MX', { Status: 0, AD: true, Answer: [{ name: 'example.com', type: 15, TTL: 300, data: '0 .' }] }),
  ok('CAA', { Status: 0, AD: true, Authority: [{ name: 'example.com', type: 6, TTL: 1800, data: 'soa' }] }),
]);
eq('merge: NOERROR', m.Status, 0);
eq('merge: AD when all validated', m.AD, true);
eq('merge: answers concatenated', m.Answer.length, 4);
eq('merge: authority kept', m.Authority.length, 1);
eq('merge: queries', m._queries.map((q) => q.type), ['A', 'MX', 'CAA']);

m = E.mergeAllResults([ok('A', signedA), ok('TXT', { Status: 0, AD: false, Answer: [] })]);
eq('merge: AD false if any type unvalidated', m.AD, false);

const nx = { Status: 3, AD: false, Authority: [{ name: 'example.com', type: 6, TTL: 1800, data: 'soa' }] };
m = E.mergeAllResults(['A', 'AAAA', 'MX'].map((tn) => ok(tn, nx)));
eq('merge: all NXDOMAIN stays NXDOMAIN', m.Status, 3);

const sf = { Status: 2, AD: false, Comment: ['EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.'] };
m = E.mergeAllResults(['A', 'AAAA', 'MX', 'TXT'].map((tn) => ok(tn, sf)));
eq('merge: all SERVFAIL stays SERVFAIL', m.Status, 2);
eq('merge: comments deduped', E.resolverComments(m), ['EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.']);

m = E.mergeAllResults([ok('A', nx), ok('MX', { Status: 0, AD: false, Answer: [] })]);
eq('merge: any NOERROR wins over NXDOMAIN', m.Status, 0);

m = E.mergeAllResults(['A', 'AAAA', 'MX'].map((tn) => ok(tn, ggFailed)));
eq('merge: google EDE kept in merged notes', E.resolverComments(m), E.resolverComments(ggFailed));
eq('merge: google DNSSEC failure survives merging', E.dnssecStatus(m), 'failed');
m = E.mergeAllResults(['A', 'AAAA'].map((tn) => ok(tn, cfFailed)));
eq('merge: cloudflare DNSSEC failure survives merging', E.dnssecStatus(m), 'failed');

m = E.mergeAllResults([bad('A', 'HTTP 500'), bad('MX', 'Failed to fetch')]);
eq('merge: all failed becomes SERVFAIL', m.Status, 2);
eq('merge: partial errors recorded', m._partialErrors.map((p) => p.type + ':' + p.message), ['A:HTTP 500', 'MX:Failed to fetch']);
eq('merge: AD false when nothing answered', m.AD, false);
eq('merge: all failed does not claim a DNSSEC state', E.dnssecStatus(m), 'unknown');

m = E.mergeAllResults([ok('A', signedA), bad('MX', 'The operation was aborted.')]);
eq('merge: partial failure keeps NOERROR', m.Status, 0);
eq('merge: partial failure listed', m._partialErrors.length, 1);

m = E.mergeAllResults([ok('TXT', { Status: 0, TC: true, AD: false, Answer: [] })]);
eq('merge: TC propagates', m.TC, true);

// ---------- STRINGS keys ----------
const stringsMatch = source.match(/var STRINGS = (\{[\s\S]*?\n {6}\});/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const STRINGS = new Function('return ' + stringsMatch[1])();
  const enKeys = Object.keys(STRINGS.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) {
    eq('STRINGS keys ' + lang, Object.keys(STRINGS[lang]).sort().join(','), enKeys);
  }
  check('STRINGS.en has summaryDnssecFailed', 'summaryDnssecFailed' in STRINGS.en);
  const i18nKeys = [...source.matchAll(/data-i18n="([^"]+)"/g)].map((x) => x[1]);
  for (const k of i18nKeys) check('data-i18n key ' + k + ' in STRINGS.en', k in STRINGS.en);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
