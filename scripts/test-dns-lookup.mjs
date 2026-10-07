// DNS Lookup — input normalization, query URL and response-merging regression test
//
// Read:  src/components/tools/DnsLookupTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source), ToolLayout.astro (real keyboard shortcuts),
//        src/data/tool-layouts.ts and src/content/tools/dns-lookup/*.mdx.
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
// have the same keys; diagnoseDomain (the `diagnose:start/end` block after the engine) names
// the reason for a rejected name — no host, a bad character with its code-point position, an
// empty label, a hyphen at a label edge, a label over 63, one label, over 253 — and the
// page shows the localized reason; the article examples match the engine. The page suite executes the actual client scripts with a DOM and
// deferred fetch stubs: result copying, tab changes, failures, cancellation, request order,
// ALL, keyboard bubbling, and v2 localization/content contracts. It never sends a request.
//
// Run: node scripts/test-dns-lookup.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import yaml from 'js-yaml';
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
const stringsMatch = source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/);
check('frontmatter STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const STRINGS = new Function('return ' + stringsMatch[1])();
  const enKeys = Object.keys(STRINGS.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) {
    eq('STRINGS keys ' + lang, Object.keys(STRINGS[lang]).sort().join(','), enKeys);
  }
  check('STRINGS.en has summaryDnssecFailed', 'summaryDnssecFailed' in STRINGS.en);
  const reasonKeys = ['noHost', 'badChar', 'idnChar', 'emptyLabel', 'hyphenStart', 'hyphenEnd', 'labelTooLong', 'singleLabel', 'tooLong'];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq('domain error reasons ' + lang, Object.keys(STRINGS[lang].domainErrors || {}).sort(), [...reasonKeys].sort());
    const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const key of reasonKeys) {
      eq('domain error placeholders ' + lang + ' ' + key, placeholders(STRINGS[lang].domainErrors?.[key]), placeholders(STRINGS.en.domainErrors?.[key]));
    }
  }
}

// ---------- diagnoseDomain (runs only after isValidDomain rejects) ----------
const DIAG_START = '/* ── diagnose:start ── */';
const DIAG_END = '/* ── diagnose:end ── */';
const diagStart = source.indexOf(DIAG_START);
const diagEnd = source.indexOf(DIAG_END);
check('diagnose block present outside the engine block', diagStart > endIndex && diagEnd > diagStart);
const D = diagStart > 0 && diagEnd > diagStart
  ? new Function(source.slice(diagStart, diagEnd) + '\nreturn { diagnoseDomain };')()
  : { diagnoseDomain: () => null };
const diagCases = [
  ['http://', { code: 'noHost' }],
  ['https:///path', { code: 'noHost' }],
  ['exa mple.com', { code: 'badChar', ch: ' ', cp: 'U+0020', pos: 4 }],
  ['  https://exa mple.com/x', { code: 'badChar', ch: ' ', cp: 'U+0020', pos: 14 }],
  ['example!.com', { code: 'badChar', ch: '!', cp: 'U+0021', pos: 8 }],
  ['😀😀a b.com', { code: 'badChar', ch: ' ', cp: 'U+0020', pos: 4 }],
  ['example.com:abc', { code: 'badChar', ch: ':', cp: 'U+003A', pos: 12 }],
  ['ｅｘａｍｐｌｅ＊．ｃｏｍ', { code: 'badChar', ch: '＊', cp: 'U+FF0A', pos: 8 }],
  ['a..b', { code: 'emptyLabel', n: 2 }],
  ['.example.com', { code: 'emptyLabel', n: 1 }],
  ['example.com..', { code: 'emptyLabel', n: 3 }],
  ['-foo.com', { code: 'hyphenStart', n: 1, label: '-foo' }],
  ['www.foo-.com', { code: 'hyphenEnd', n: 2, label: 'foo-' }],
  ['a'.repeat(64) + '.com', { code: 'labelTooLong', n: 1, label: 'a'.repeat(24) + '…', len: 64 }],
  ['localhost', { code: 'singleLabel', name: 'localhost' }],
  ['LOCALHOST:8080', { code: 'singleLabel', name: 'localhost' }],
  [Array(64).fill('abc').join('.'), { code: 'tooLong', len: 255 }],
];
for (const [input, expected] of diagCases) {
  check('isValidDomain rejects ' + JSON.stringify(input), !E.isValidDomain(E.normalizeDomain(input)));
  eq('diagnose ' + JSON.stringify(input), D.diagnoseDomain(input), expected);
}

// ---------- real page entry points (no network) ----------
// The shared harness does not bubble key events or execute ToolLayout's shortcuts.
// Run both real scripts together here; only browser APIs and the DNS transport are stubs.
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcutScript = [...layoutSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1]).find((code) => code.includes('// ── Keyboard shortcuts:'));
check('actual ToolLayout keyboard script found', !!shortcutScript);
const ALL_STRINGS = stringsMatch ? new Function('return ' + stringsMatch[1])() : null;
function pageFixture(lang = 'en', options = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const requests = [];
  const clipboard = [];
  const clipboardRequests = [];
  const timers = new Map();
  let timerId = 0;
  let document;
  const widget = element('widget');
  function element(id) {
    const listeners = new Map();
    const el = { id, value: '', textContent: '', innerHTML: '', className: '', hidden: false,
      disabled: false, dataset: {}, style: {}, attributes: {},
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] ?? null; },
      removeAttribute(key) { delete this.attributes[key]; },
      focus() { document.activeElement = this; },
      contains(node) { return node === this || (this === widget && node?.id?.startsWith('dnsl-')); },
      closest(selector) { return selector === '.tool-widget' || selector === '.dnsl-wrap' ? widget : null; },
      querySelectorAll(selector) { return selector.includes('input') ? [get('dnsl-domain')] : []; },
      select() {}, appendChild(child) { return child; }, removeChild() {},
      dispatch(type, values = {}) {
        const event = { type, target: this, currentTarget: this, defaultPrevented: false,
          propagationStopped: false, preventDefault() { this.defaultPrevented = true; },
          stopPropagation() { this.propagationStopped = true; }, ...values };
        for (const callback of listeners.get(type) || []) callback(event);
        if (!event.propagationStopped) {
          event.currentTarget = document;
          for (const callback of documentListeners.get(type) || []) callback(event);
        }
        return event;
      },
      click() { if (!this.disabled) this.dispatch('click'); },
    };
    el.classList = {
      toggle(name, force) {
        const set = new Set(el.className.split(/\s+/).filter(Boolean));
        if (force ?? !set.has(name)) set.add(name); else set.delete(name);
        el.className = [...set].join(' ');
      },
      add(name) { this.toggle(name, true); }, remove(name) { this.toggle(name, false); },
      contains(name) { return el.className.split(/\s+/).includes(name); },
    };
    return el;
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  };
  for (const match of source.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = get(match[1]);
    el.hidden = /\bhidden(?:\s|>|=)/.test(match[0]);
    el.disabled = /\bdisabled(?:\s|>|=)/.test(match[0]);
    el.className = match[0].match(/class="([^"]*)"/)?.[1] || '';
  }
  get('dnsl-type').value = 'A';
  get('dnsl-resolver').value = 'cloudflare';
  document = {
    documentElement: { lang }, activeElement: get('dnsl-domain'), body: element('body'),
    getElementById: get,
    querySelector(selector) {
      if (selector === '.tool-widget .btn-primary') return get('dnsl-lookup');
      if (selector === '.tool-widget' || selector === '.dnsl-wrap') return widget;
      return null;
    },
    querySelectorAll() { return []; },
    createElement: element,
    execCommand() { if (options.copyFallbackFails) throw new Error('Copy failed'); return true; },
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(callback);
    },
  };
  const sandbox = { document, URL, AbortController, console,
    t: ALL_STRINGS ? Object.fromEntries(Object.entries(ALL_STRINGS[lang]).filter(([key]) => key !== 'tips')) : null,
    location: { pathname: '/tools/dns-lookup/' },
    localStorage: { getItem() { return null; }, setItem() {} },
    ztPersist: { clear() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    navigator: { clipboard: { writeText(text) {
      clipboard.push(text);
      if (options.deferClipboard) return new Promise((resolve, reject) => clipboardRequests.push({ resolve, reject }));
      return Promise.resolve();
    } } },
    setTimeout(callback, ms) { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(match[1], context, { filename: 'DnsLookupTool.astro' });
  }
  vm.runInContext(shortcutScript, context, { filename: 'ToolLayout.astro' });
  return {
    get, requests, clipboard, clipboardRequests, strings: ALL_STRINGS[lang], document,
    lookup(value = 'example.com') { get('dnsl-domain').value = value; get('dnsl-lookup').click(); },
    async success(index = requests.length - 1, response = signedA) {
      requests[index].resolve({ ok: true, json: async () => structuredClone(response) });
      await new Promise(setImmediate);
    },
    async failure(index = requests.length - 1, error = new Error('Failed to fetch')) {
      requests[index].reject(error);
      await new Promise(setImmediate);
    },
    timeout() {
      for (const [id, timer] of timers) {
        if (timer.ms === 5000) { timers.delete(id); timer.callback(); }
      }
    },
    key(key, modifier = 'ctrlKey', focused = 'dnsl-domain') {
      document.activeElement = get(focused);
      return get(focused).dispatch('keydown', { key, [modifier]: true });
    },
  };
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const page = pageFixture(lang);
  page.lookup();
  eq(lang + ': one click sends one query', page.requests.length, 1);
  await page.success();
  eq(lang + ': successful result visible', page.get('dnsl-result').hidden, false);
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq(lang + ': copied JSON matches displayed response', JSON.parse(page.clipboard[0]), JSON.parse(page.get('dnsl-json-output').textContent));
  eq(lang + ': successful copy is localized', page.get('dnsl-status').textContent, page.strings.copied);
  for (const [button, panel] of [['dnsl-tab-raw', 'dnsl-panel-raw'], ['dnsl-tab-json', 'dnsl-panel-json'], ['dnsl-tab-records', 'dnsl-panel-records']]) {
    page.get(button).click();
    eq(lang + ': selected tab visible ' + panel, page.get(panel).hidden, false);
    eq(lang + ': selected tab aria state ' + panel, page.get(button).getAttribute('aria-selected'), 'true');
  }
  page.lookup('bad domain');
  eq(lang + ': invalid input does not query', page.requests.length, 1);
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const reasons = page.strings.domainErrors || {};
  eq(lang + ': invalid input names the character and position', page.get('dnsl-status').textContent,
    fill(reasons.badChar, { ch: ' ', cp: 'U+0020', pos: 4 }));
  check(lang + ': invalid input status is an error', page.get('dnsl-status').className.includes('error'));
  for (const [input, key, vars] of [
    ['-foo.com', 'hyphenStart', { n: 1, label: '-foo' }],
    ['a..b', 'emptyLabel', { n: 2 }],
    ['localhost', 'singleLabel', { name: 'localhost' }],
    ['http://', 'noHost', {}],
    ['x'.repeat(64) + '.com', 'labelTooLong', { n: 1, label: 'x'.repeat(24) + '…', len: 64 }],
  ]) {
    page.lookup(input);
    eq(lang + ': ' + key + ' message for ' + JSON.stringify(input.slice(0, 12)), page.get('dnsl-status').textContent, fill(reasons[key], vars));
  }
  eq(lang + ': invalid inputs send no query', page.requests.length, 1);
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq(lang + ': invalid input cannot copy previous JSON', page.clipboard.length, 1);
  page.lookup();
  await page.success();
  page.lookup('other.example');
  await page.failure();
  check(lang + ': failed request reports localized network error', page.get('dnsl-status').textContent.startsWith(page.strings.netError));
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq(lang + ': failed request cannot copy previous JSON', page.clipboard.length, 1);
}

for (const action of ['Clear', 'Ctrl+L', 'Cmd+L']) {
  for (const outcome of ['success', 'failure']) {
    const page = pageFixture();
    page.lookup();
    if (action === 'Clear') page.get('dnsl-clear').click();
    else page.key('L', action === 'Cmd+L' ? 'metaKey' : 'ctrlKey');
    eq(action + ': input cleared while waiting', page.get('dnsl-domain').value, '');
    // Deliberately deliver a response even after abort: the page must reject stale completions.
    await page[outcome]();
    eq(action + ': late ' + outcome + ' keeps result hidden', page.get('dnsl-result').hidden, true);
    eq(action + ': late ' + outcome + ' keeps status empty', page.get('dnsl-status').textContent, '');
    page.get('dnsl-copy-json').click();
    await new Promise(setImmediate);
    eq(action + ': late ' + outcome + ' cannot be copied', page.clipboard.length, 0);
  }
}

for (const modifier of ['ctrlKey', 'metaKey']) {
  const page = pageFixture();
  page.get('dnsl-domain').value = 'example.com';
  page.key('Enter', modifier);
  eq(modifier + '+Enter in domain sends one query', page.requests.length, 1);
}

{
  const page = pageFixture();
  page.lookup('older.example');
  page.lookup('newer.example');
  await page.success(1, { Status: 0, Answer: [{ name: 'newer.example', type: 1, TTL: 60, data: '192.0.2.2' }] });
  await page.success(0, { Status: 0, Answer: [{ name: 'older.example', type: 1, TTL: 60, data: '192.0.2.1' }] });
  check('late old request cannot replace newer result', page.get('dnsl-json-output').textContent.includes('newer.example'));
}

{
  const page = pageFixture();
  page.get('dnsl-domain').value = 'example.com';
  page.get('dnsl-domain').dispatch('keydown', { key: 'Enter' });
  eq('plain Enter sends one request', page.requests.length, 1);
  await page.success();
  page.key('L', 'ctrlKey', 'outside-tool');
  eq('Ctrl+L outside the tool preserves domain', page.get('dnsl-domain').value, 'example.com');
  eq('Ctrl+L outside the tool preserves result', page.get('dnsl-result').hidden, false);
  page.key('l', 'ctrlKey');
  eq('Ctrl+L after success clears result', page.get('dnsl-result').hidden, true);
  eq('Ctrl+L after success clears status', page.get('dnsl-status').textContent, '');
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq('Ctrl+L after success leaves nothing copyable', page.clipboard.length, 0);
}

{
  const page = pageFixture();
  page.lookup();
  await page.success();
  page.lookup('');
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq('empty lookup leaves nothing copyable', page.clipboard.length, 0);
  page.lookup();
  await page.success();
  page.lookup('pending.example');
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq('pending lookup cannot copy the previous response', page.clipboard.length, 0);
}

{
  const page = pageFixture();
  page.lookup();
  page.timeout();
  eq('single query aborts after five seconds', page.requests[0].options.signal.aborted, true);
  const error = new Error('Aborted');
  error.name = 'AbortError';
  await page.failure(0, error);
  eq('timed out lookup reports the timeout message', page.get('dnsl-status').textContent, page.strings.timeout);
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq('timed out lookup cannot be copied', page.clipboard.length, 0);
}

{
  const page = pageFixture();
  page.get('dnsl-type').value = 'ALL';
  page.get('dnsl-resolver').value = 'google';
  page.lookup();
  eq('ALL page entry sends exactly eight record types', page.requests.map((request) => new URL(request.url).searchParams.get('type')),
    ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA']);
  check('selected resolver is used for every ALL request', page.requests.every((request) => new URL(request.url).hostname === 'dns.google'));
  await page.success(0);
  for (let i = 1; i < page.requests.length; i++) await page.failure(i);
  eq('ALL partial success shows results', page.get('dnsl-result').hidden, false);
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  const response = JSON.parse(page.clipboard[0]);
  eq('ALL copies the successful DNS answers', response.Answer, signedA.Answer);
  eq('ALL copies the seven failed types', response._partialErrors.length, 7);
  eq('ALL record count excludes RRSIG', page.get('dnsl-summary-count').textContent, '2 records');
  check('ALL record view includes partial error notes', page.get('dnsl-panel-records').innerHTML.includes('Failed to fetch'));
  check('raw view preserves RRSIG records', page.get('dnsl-raw-output').textContent.includes('RRSIG'));
}

for (const action of ['Clear', 'Ctrl+L']) {
  const page = pageFixture();
  page.get('dnsl-type').value = 'ALL';
  page.lookup();
  if (action === 'Clear') page.get('dnsl-clear').click(); else page.key('l');
  for (let i = 0; i < page.requests.length; i++) await page.success(i);
  eq(action + ': late ALL result remains hidden', page.get('dnsl-result').hidden, true);
  eq(action + ': late ALL result leaves status empty', page.get('dnsl-status').textContent, '');
  page.get('dnsl-copy-json').click();
  await new Promise(setImmediate);
  eq(action + ': late ALL result cannot be copied', page.clipboard.length, 0);
}

// Clipboard permission prompts may settle after Clear or the shared shortcut.
for (const action of ['Clear', 'Ctrl+L']) {
  for (const outcome of ['success', 'fallback success', 'fallback failure']) {
    const page = pageFixture('en', { deferClipboard: true, copyFallbackFails: outcome === 'fallback failure' });
    page.lookup();
    await page.success();
    page.get('dnsl-copy-json').click();
    if (action === 'Clear') page.get('dnsl-clear').click(); else page.key('l');
    if (outcome === 'success') page.clipboardRequests[0].resolve();
    else page.clipboardRequests[0].reject(new Error('Clipboard permission denied'));
    await new Promise(setImmediate);
    eq(action + ': late copy ' + outcome + ' keeps status empty', page.get('dnsl-status').textContent, '');
  }
}

// ---------- v2 page layout ----------
{
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const markup = source.replace(/^---\n[\s\S]*?\n---/, '').split('<script')[0].trim();
  check('tool root owns the layout', /^<div class="dnsl-wrap"[^>]*>/.test(markup));
  eq('four controls have contextual help', [...markup.matchAll(/<Toggletip\s+id="([^"]+)"/g)].map((match) => match[1]),
    ['dnsl-tip-domain', 'dnsl-tip-type', 'dnsl-tip-resolver', 'dnsl-tip-results']);
  check('labels render at build time', !source.includes('data-i18n'));
  for (const id of new Set([...source.matchAll(/document\.getElementById\('([^']+)'\)/g)].map((match) => match[1]))) {
    eq('client element appears once: ' + id, [...markup.matchAll(/\bid="([^"]+)"/g)].filter((match) => match[1] === id).length, 1);
  }
  check('strings are in the frontmatter', /const STRINGS = \{[\s\S]*\} as const;/.test(frontmatter));
  check('one language is selected before rendering', /const T = STRINGS\[lang\];/.test(frontmatter));
  check('help text stays out of the inline payload', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = T;/.test(frontmatter)
    && /<script[^>]*define:vars=\{\{ t: CLIENT_T \}\}/.test(source));
  if (ALL_STRINGS) {
    const tips = ['domain', 'type', 'resolver', 'results'];
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      eq(lang + ': every control has translated help', Object.keys(ALL_STRINGS[lang].tips || {}), tips);
      check(lang + ': help text is nonempty plain text', tips.every((key) => typeof ALL_STRINGS[lang].tips?.[key] === 'string'
        && ALL_STRINGS[lang].tips[key].trim().length > 0 && !/<\/?[a-z]/i.test(ALL_STRINGS[lang].tips[key])));
    }
    for (const key of tips) check('help text is rendered for ' + key, markup.includes('{TIPS.' + key + '}'));
  }
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('DNS lookup uses analyze layout', /'dns-lookup':\s*'analyze'/.test(layouts));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/dns-lookup/' + lang + '.mdx'), 'utf8');
    const front = mdx.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const data = yaml.load(front);
    const body = mdx.slice(front.length + 8);
    eq(lang + ': five user steps in frontmatter', data.steps?.length, 5);
    check(lang + ': steps fit llms-full text limits', Array.isArray(data.steps) && data.steps.every((step) => typeof step === 'string' && step.length <= 280)
      && data.steps.reduce((sum, step) => sum + step.length, 0) <= 1200);
    check(lang + ': no duplicate how-to section', !/^## (How to Use|使用方法|使い方|사용 방법)\s*$/mi.test(body));
    check(lang + ': limitations remain in the article', /^## (Limits|限制|制限事項|제한 사항)\s*$/m.test(body));
    if (ALL_STRINGS) {
      const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k]);
      const firstSentence = (s) => s.split(/(?<=[.。])\s?/)[0].replace(/[.。]$/, '');
      const reasons = ALL_STRINGS[lang].domainErrors;
      eq(lang + ': article example for exa mple.com matches the engine', D.diagnoseDomain('exa mple.com'), { code: 'badChar', ch: ' ', cp: 'U+0020', pos: 4 });
      eq(lang + ': article example for -foo.com matches the engine', D.diagnoseDomain('-foo.com'), { code: 'hyphenStart', n: 1, label: '-foo' });
      if (lang === 'en') {
        check('en: article quotes the space message', body.includes('`' + firstSentence(fill(reasons.badChar, { ch: ' ', cp: 'U+0020', pos: 4 })) + '`'));
        check('en: article quotes the hyphen message', body.includes('`' + firstSentence(fill(reasons.hyphenStart, { n: 1, label: '-foo' })) + '`'));
      } else {
        check(lang + ': article names the space position and the hyphen label', /U\+0020/.test(body) && /-foo/.test(body) && /4/.test(body));
      }
    }
  }
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
