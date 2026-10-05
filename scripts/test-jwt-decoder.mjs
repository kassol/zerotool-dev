// JWT Decoder — Base64URL decoding to UTF-8 and escaped highlighting
//
// Read:  src/components/tools/JwtDecoderTool.astro (engine and complete inline script),
//        src/layouts/ToolLayout.astro (actual shared shortcuts), and existing guide fixtures
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: header and payload segments decode as UTF-8 (atob alone gave one character per
// byte, so "José" showed as "JosÃ©"); missing padding; invalid characters return null;
// syntaxHighlight escapes < > & before it adds spans, because the result is written with
// innerHTML (a claim such as "<img src=x onerror=...>" used to become a real element);
// the example token and the examples on the English page; the English guide
// (src/content/blog/jwt-decoder-guide/en.mdx): the demo token is rebuilt from its claims and
// secret, the decoded JSON, dates, lengths and the signature-length table are recomputed, the
// RFC 7515 A.1 and RFC 7519 6.1 tokens decode as the guide says, and code blocks marked
// {/* jwt-run: {"lang":"node|python","expect":"…"} */} are run (Python needs PyJWT; SKIP otherwise).
//
// Run: node scripts/test-jwt-decoder.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash, createHmac, generateKeyPairSync, sign as cryptoSign, constants } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { parseFragment, defaultTreeAdapter } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JwtDecoderTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JwtDecoderTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { b64urlDecode, parseJSON, syntaxHighlight };')();

let failures = 0;
let passes = 0;
let skips = 0;
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const decode = (token) => token.split('.').slice(0, 2).map((p) => E.parseJSON(E.b64urlDecode(p)));
const protectedEngine = source.slice(startIndex, endIndex + '/* ── engine:end ── */'.length);
eq('protected engine bytes', Buffer.byteLength(protectedEngine), 1613);
eq('protected engine SHA256', createHash('sha256').update(protectedEngine).digest('hex'), 'fa9473b8818ef1d5bc86e16b3b88aa972307e93dc01f75fc14f229c7af31aa82');

// example token in the component
const example = /var EXAMPLE_JWT = '([^']+)'/.exec(source)[1];
const [h, p] = decode(example);
eq('example header', JSON.stringify(h), '{"alg":"HS256","typ":"JWT"}');
eq('example payload', JSON.stringify(p), '{"sub":"1234567890","name":"John Doe","iat":1516239022,"exp":1893456000}');
eq('example exp date', new Date(p.exp * 1000).toUTCString(), 'Tue, 01 Jan 2030 00:00:00 GMT');

// UTF-8
eq('UTF-8 claim', E.b64urlDecode(seg({ name: 'José', city: '東京' })), '{"name":"José","city":"東京"}');
eq('UTF-8 segment from the page', E.b64urlDecode('eyJuYW1lIjoiSm9zw6kiLCJyb2xlcyI6WyJhZG1pbiJdfQ'), '{"name":"José","roles":["admin"]}');
eq('padding restored', E.b64urlDecode('eyJhIjoxfQ'), '{"a":1}');
eq('standard alphabet also accepted', E.b64urlDecode('-_8'), E.b64urlDecode('+/8'));
eq('invalid character', E.b64urlDecode('ab$c'), null);
eq('not JSON', E.parseJSON('abc'), null);

// escaping
const xss = E.syntaxHighlight({ name: '<img src=x onerror=alert(1)>', note: 'a & b' });
eq('no raw tag in output', /<img/.test(xss), false);
eq('escaped tag', xss.includes('&lt;img src=x onerror=alert(1)&gt;'), true);
eq('escaped ampersand', xss.includes('a &amp; b'), true);
eq('highlight spans kept', E.syntaxHighlight({ a: 1, b: true, c: null, d: 'x' }),
  '{\n  <span class="jv-key">"a":</span> <span class="jv-num">1</span>,\n  <span class="jv-key">"b":</span> <span class="jv-bool">true</span>,\n  <span class="jv-key">"c":</span> <span class="jv-null">null</span>,\n  <span class="jv-key">"d":</span> <span class="jv-str">"x"</span>\n}');

// guide
{
  const guide = readFileSync(join(root, 'src/content/blog/jwt-decoder-guide/en.mdx'), 'utf8');
  const has = (name, text) => eq('guide: ' + name, guide.includes(text), true);
  const iat = Date.UTC(2026, 9, 1, 9, 0, 0) / 1000;
  const claims = { iss: 'https://auth.example.com', sub: 'user-4821', aud: 'orders-api', iat, exp: iat + 900, scope: 'orders:read' };
  const hSeg = seg({ alg: 'HS256', typ: 'JWT' });
  const pSeg = seg(claims);
  const sig = createHmac('sha256', 'demo-secret-from-zerotool-guide-do-not-reuse').update(hSeg + '.' + pSeg).digest('base64url');
  const demo = hSeg + '.' + pSeg + '.' + sig;
  const shown = /jwt-check: demo-token \*\/\}\n```text\n([^\n]+)\n/.exec(guide);
  eq('guide demo token', shown && shown[1], demo);
  has('token length', 'It is ' + demo.length + ' characters long');
  const lens = demo.split('.').map((x) => x.length);
  has('part lengths', lens[0] + ' characters of header, ' + lens[1] + ' of payload and ' + lens[2] + ' of signature');
  const [dh, dp] = decode(demo);
  has('decoded header', JSON.stringify(dh, null, 2));
  has('decoded payload', JSON.stringify(dp, null, 2));
  has('iat date', new Date(dp.iat * 1000).toUTCString());
  has('exp date', new Date(dp.exp * 1000).toUTCString());
  has('raw signature', '`' + sig + '`');
  eq('eyJ prefix of {"a', Buffer.from('{"a').toString('base64url').slice(0, 3), 'eyJ');
  eq('demo segments start with eyJ', hSeg.startsWith('eyJ') && pSeg.startsWith('eyJ'), true);

  // RFC 7515 A.1 / RFC 7519 3.1 example
  const rfc = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const [rh, rp] = decode(rfc);
  has('RFC header compact', '`' + JSON.stringify(rh) + '`');
  has('RFC payload compact', '`' + JSON.stringify(rp) + '`');
  has('RFC exp', new Date(rp.exp * 1000).toUTCString() + ' — EXPIRED');
  eq('RFC header has CRLF', E.b64urlDecode(rfc.split('.')[0]).includes('\r\n'), true);
  has('CRLF fragment', 'LA0KICJ');

  // RFC 7519 6.1 unsecured JWT
  const none = /jwt-check: unsecured \*\/\}\n```text\n([^\n]+)\n/.exec(guide)[1];
  const [nh, np] = decode(none);
  eq('unsecured header', JSON.stringify(nh), '{"alg":"none"}');
  eq('unsecured claims equal the RFC example', JSON.stringify(np), JSON.stringify(rp));
  eq('unsecured signature empty', none.split('.')[2], '');
  eq('decoder auto-decodes a token with an empty signature', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(none) && source.includes(String.raw`var JWT_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;`), true);
  eq('JWE error string', source.includes("errInvalid: 'Invalid JWT: expected 3 dot-separated parts, got '") && source.includes("t.errInvalid + parts.length + '.'"), true);
  has('JWE message', 'Invalid JWT: expected 3 dot-separated parts, got 5.');

  // signature lengths
  const input = Buffer.from('a.b');
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ed = generateKeyPairSync('ed25519');
  const sigs = {
    HS256: createHmac('sha256', 'k').update(input).digest(),
    RS256: cryptoSign('sha256', input, rsa.privateKey),
    PS256: cryptoSign('sha256', input, { key: rsa.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING }),
    ES256: cryptoSign('sha256', input, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }),
    EdDSA: cryptoSign(null, input, ed.privateKey),
  };
  const row = (label, s) => '| ' + label + ' | ' + s.length + ' | ' + s.toString('base64url').length + ' |';
  has('HS256 row', row('HS256', sigs.HS256));
  eq('PS256 same length as RS256', sigs.PS256.length, sigs.RS256.length);
  has('RS256 row', row('RS256, PS256 (2048-bit key)', sigs.RS256));
  has('ES256 row', row('ES256', sigs.ES256));
  has('EdDSA row', row('EdDSA (Ed25519)', sigs.EdDSA));
  // DER length depends on the random signature: r and s are each 32 bytes, plus a 0x00 when the
  // top bit is set, minus leading zero bytes. Check the length from the structure, not a fixed range.
  const derSig = cryptoSign('sha256', input, ec.privateKey);
  const intLen = (off) => derSig[off + 1];
  const rLen = intLen(2), sLen = intLen(4 + rLen);
  eq('DER ES256 signature is SEQUENCE(INTEGER r, INTEGER s)', derSig[0] === 0x30 && derSig[2] === 0x02 && derSig[4 + rLen] === 0x02 && derSig.length === 2 + derSig[1] && derSig[1] === 4 + rLen + sLen && rLen <= 33 && sLen <= 33, true);

  // code blocks
  let pyjwt = false;
  // The guide's expected output was recorded with PyJWT 2.10.1; error texts differ between releases.
  try { pyjwt = execFileSync('python3', ['-c', 'import jwt;print(jwt.__version__)'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '2.10.1'; } catch {}
  const re = /\{\/\* jwt-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
  let m; let runs = 0;
  while ((m = re.exec(guide))) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = 'guide ' + spec.lang + ' block ' + runs;
    if (spec.lang === 'python' && !pyjwt) { skip(name, 'python3 with PyJWT 2.10.1 not installed'); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'jwt-run-'));
    try {
      const file = join(dir, spec.lang === 'node' ? 'main.mjs' : 'main.py');
      writeFileSync(file, m[2]);
      const out = execFileSync(spec.lang === 'node' ? process.execPath : 'python3', [file]).toString().trim();
      eq(name, out, spec.expect);
    } catch (e) {
      eq(name, String(e.stderr || e.message).slice(0, 300), spec.expect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  eq('guide has 3 runnable blocks', runs, 3);
}

// Complete real page IIFE and actual shared shortcuts. Only DOM, timer and clipboard APIs are controlled.
const pageScript = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcutScript = layoutSource.slice(layoutSource.indexOf('// ── Keyboard shortcuts:'), layoutSource.indexOf('// ── Copy button visual feedback'));
const pageStrings = vm.runInNewContext('(' + /var STRINGS = (\{[\s\S]*?\n      \});/.exec(pageScript)[1] + ')');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function page(lang = 'en', order = 'shared-after') {
  const clipboard = [], timers = new Map(), tracks = [], clears = [];
  let timerId = 0, now = 0, doc;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  function matchesOne(el, selector) {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchesOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchesOne(parent, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.className.split(/\s+/).includes(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  }
  const matches = (el, selector) => selector.split(',').some(part => matchesOne(el, part));
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, listeners: {}, id: '', className: '', text: '', value: '', disabled: false, hidden: false }); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    setAttribute(key, value) { this.attrs[key] = String(value); if (['id', 'class', 'type'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); }
    getAttribute(key) { return key === 'class' ? this.className || null : this.attrs[key] ?? null; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { if (doc?.activeElement !== this && this.contains(doc?.activeElement)) doc.activeElement = doc.body; for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(value); }
    set innerHTML(value) {
      this.textContent = '';
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(value)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      // Event propagation path is captured before a listener removes the focused result button.
      const path = []; for (let el = this; el; el = el.parentNode) path.push(el);
      for (const el of path) { for (const fn of el.listeners[type] || []) fn.call(el, event); if (event.stopped) break; }
      return event;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }
  doc = new Element('#document'); doc.documentElement = new Element('html'); doc.documentElement.lang = lang; doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body); doc.activeElement = doc.body;
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget);
  widget.innerHTML = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0];
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  doc.execCommand = () => { throw Error('Unexpected system clipboard fallback'); };
  const sandbox = { document: doc, console, TextDecoder, atob, Date: class extends Date { static now() { return 1791158400250; } }, _slug: 'jwt-decoder', ztPersist: { clear(slug) { clears.push(slug); } },
    trackTool(...args) { tracks.push(args); },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); clipboard.push({ value: String(value), resolve, reject }); return promise; } } },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (order === 'shared-before') vm.runInContext(shortcutScript, context);
  vm.runInContext(pageScript, context, { filename: 'JwtDecoderTool.astro:complete-inline', timeout: 1000 });
  if (order === 'shared-after') vm.runInContext(shortcutScript, context);
  const get = id => { const el = doc.getElementById(id); if (!el) throw Error('Missing real ID ' + id); return el; };
  return { get, doc, clipboard, timers, tracks, clears, sandbox,
    input(value) { get('jwt-input').value = value; get('jwt-input').dispatch('input'); },
    key(key, extra = {}, target = get('jwt-input')) { target.focus(); return target.dispatch('keydown', { key, ctrlKey: true, ...extra }); },
    advance(ms) { now += ms; for (const [id, job] of [...timers]) if (job.due <= now && timers.has(id)) { timers.delete(id); job.fn(); } },
    takeTimer(ms) { const entry = [...timers].find(([, job]) => job.ms === ms); if (!entry) throw Error('Missing actual ' + ms + ' ms timer'); now = Math.max(now, entry[1].due); timers.delete(entry[0]); return entry[1].fn; },
    snapshot() { return JSON.stringify({ value: get('jwt-input').value, status: get('jwt-status').textContent, className: get('jwt-status').className, result: get('jwt-results').textContent }); },
  };
}
const clearState = page => page.get('jwt-input').value === '' && page.get('jwt-results').children.length === 0 && page.get('jwt-status').textContent === '' && page.get('jwt-status').className === 'jwt-status';
const differentToken = seg({ alg: 'none' }) + '.' + seg({ name: 'José 東京', count: 2 }) + '.';
const lifecycleStart = passes;
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const order of ['shared-before', 'shared-after']) {
  const name = 'page ' + lang + '/' + order + ': ', p = page(lang, order), t = pageStrings[lang];
  p.get('jwt-example').click();
  eq(name + 'actual example yields 3 sections', p.get('jwt-results').querySelectorAll('.jwt-section').length, 3);
  eq(name + 'current success localized', p.get('jwt-status').textContent, t.decodedOk);
  eq(name + 'raw signature remains visibly unverified', p.get('jwt-results').querySelector('.jwt-sig-note').textContent, '(raw Base64URL — not verified)');
  for (const key of [{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }]) {
    p.get('jwt-example').click(); const tracks = p.tracks.length;
    p.key('Enter', key); eq(name + JSON.stringify(key) + ' Enter exactly one decode', p.tracks.length - tracks, 1);
    const before = p.snapshot(), beforeTracks = p.tracks.length;
    p.key('Enter', { ctrlKey: false }); eq(name + 'plain Enter preserves result', p.snapshot(), before);
    eq(name + 'plain Enter never decodes', p.tracks.length, beforeTracks);
    p.key('L', key); eq(name + 'modified L clears all', clearState(p), true);
    p.input(example); p.key('l', key); p.advance(300); eq(name + 'modified L cancels pending decode', clearState(p), true);
    p.get('jwt-example').click(); const copy = p.get('jwt-results').querySelector('.btn-copy'), beforeClear = p.clears.length;
    p.key('l', key, copy); eq(name + 'result-focused L clears all', clearState(p), true);
    eq(name + 'shared persistence clear still runs from result focus', p.clears.length - beforeClear, 1);
  }
  p.get('jwt-clear').click(); p.input(example); p.advance(299); eq(name + 'automatic decode waits 300ms', p.get('jwt-results').children.length, 0);
  p.advance(1); eq(name + 'automatic decode computes real header', p.get('jwt-results').querySelector('.jwt-json').textContent, '{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
  p.input(differentToken); const tracks = p.tracks.length;
  p.get('jwt-decode').click(); p.advance(300); eq(name + 'manual decode consumes pending auto decode', p.tracks.length - tracks, 1);
  eq(name + 'different UTF8 payload decoded', p.get('jwt-results').querySelectorAll('.jwt-json')[1].textContent, '{\n  "name": "José 東京",\n  "count": 2\n}');
  p.input('not-a-token'); p.advance(300); eq(name + 'invalid typing clears without automatic error', p.get('jwt-status').textContent, '');
  p.get('jwt-decode').click(); eq(name + 'manual invalid shows actual parts error', p.get('jwt-status').textContent, t.errInvalid + '1.');
  p.get('jwt-clear').click(); eq(name + 'Clear removes error state', clearState(p), true);
  p.input(example); p.get('jwt-clear').click(); p.advance(300); eq(name + 'Clear cancels pending auto decode', clearState(p), true);
  p.get('jwt-example').click(); const untouched = p.snapshot(); p.doc.body.focus(); p.doc.body.dispatch('keydown', { key: 'l', ctrlKey: true });
  eq(name + 'outside focus preserves tool', p.snapshot(), untouched);
  p.key('l', { ctrlKey: false }); eq(name + 'unmodified L preserves tool', p.snapshot(), untouched);
  p.input(''); p.advance(300); eq(name + 'empty input stays empty', clearState(p), true);
}
console.log('Page control checks: ' + (passes - lifecycleStart) + ' passed');

// Real copy listeners: deferred clipboard Promises and real captured timeout callbacks.
const copyStart = passes, unhandled = [];
const copyFailures = { en: 'Copy failed', zh: '复制失败', ja: 'コピーに失敗', ko: '복사 실패' };
const rejected = reason => unhandled.push(String(reason));
process.on('unhandledRejection', rejected);
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const order of ['shared-before', 'shared-after']) for (const index of [0, 1]) {
    const name = 'copy ' + lang + '/' + order + '/' + (index ? 'payload' : 'header') + ': ', t = pageStrings[lang];
    const fresh = () => { const p = page(lang, order); p.get('jwt-example').click(); return p; };
    const button = p => p.get('jwt-results').querySelectorAll('.btn-copy')[index];
    let p = fresh(), btn = button(p), beforeUnhandled = unhandled.length;
    btn.click();
    eq(name + 'actual JSON copied in full', p.clipboard.at(-1).value, JSON.stringify(index ? { sub: '1234567890', name: 'John Doe', iat: 1516239022, exp: 1893456000 } : { alg: 'HS256', typ: 'JWT' }, null, 2));
    p.clipboard.at(-1).reject(Error('controlled current clipboard denial')); await settle();
    eq(name + 'current rejection is handled', unhandled.length - beforeUnhandled, 0);
    eq(name + 'current rejection is visible in the clicked button', btn.textContent, copyFailures[lang]);
    eq(name + 'copy denial keeps conversion success status', p.get('jwt-status').textContent, t.decodedOk);
    const output = p.get('jwt-results').querySelectorAll('.jwt-json').map(el => el.textContent).join('|');
    btn.click(); p.clipboard.at(-1).resolve(); await settle();
    eq(name + 'same output direct retry succeeds', btn.textContent, t.copied);
    eq(name + 'retry preserves all output', p.get('jwt-results').querySelectorAll('.jwt-json').map(el => el.textContent).join('|'), output);
    p.advance(1500); eq(name + 'current copy timer restores label', btn.textContent, t.copy);

    for (const action of ['Clear', 'CtrlL', 'CmdL', 'new valid input', 'invalid input', 'new decoded result', 'Example', 'manual decode error']) for (const completion of ['resolve', 'reject']) {
      p = fresh(); btn = button(p); btn.click(); const job = p.clipboard.at(-1); beforeUnhandled = unhandled.length;
      if (action === 'Clear') p.get('jwt-clear').click();
      else if (action === 'CtrlL') p.key('l', {}, btn);
      else if (action === 'CmdL') p.key('L', { ctrlKey: false, metaKey: true }, btn);
      else if (action === 'new valid input') p.input(differentToken);
      else if (action === 'invalid input') p.input('editing-invalid');
      else if (action === 'new decoded result') { p.input(differentToken); p.get('jwt-decode').click(); }
      else if (action === 'Example') p.get('jwt-example').click();
      else { p.input('one.part'); p.get('jwt-decode').click(); }
      const before = p.snapshot(), label = btn.textContent;
      completion === 'resolve' ? job.resolve() : job.reject(Error('controlled old clipboard denial'));
      await settle();
      eq(name + completion + ' after ' + action + ' preserves page', p.snapshot(), before);
      eq(name + completion + ' after ' + action + ' does not mutate old button', btn.textContent, label);
      eq(name + completion + ' after ' + action + ' is handled', unhandled.length - beforeUnhandled, 0);
    }

    p = fresh(); btn = button(p); btn.click(); const old = p.clipboard.at(-1); btn.click(); const newer = p.clipboard.at(-1);
    old.resolve(); await settle(); eq(name + 'older same-button success cannot signal newer pending copy', btn.textContent, t.copy);
    newer.reject(Error('controlled newer denial')); await settle(); eq(name + 'newest same-button rejection remains visible', btn.textContent, copyFailures[lang]);
    p = fresh(); btn = button(p); btn.click(); const oldReject = p.clipboard.at(-1); btn.click(); p.clipboard.at(-1).resolve(); await settle();
    beforeUnhandled = unhandled.length; oldReject.reject(Error('controlled older denial')); await settle();
    eq(name + 'older rejection cannot overwrite newer success', btn.textContent, t.copied);
    eq(name + 'older rejection is handled after newer success', unhandled.length - beforeUnhandled, 0);

    p = fresh(); btn = button(p); btn.click(); p.clipboard.at(-1).resolve(); await settle(); p.advance(1000);
    btn.click(); p.clipboard.at(-1).resolve(); await settle(); p.advance(500);
    eq(name + 'first timer deadline retains second Copied feedback', btn.textContent, t.copied);
    p.advance(999); eq(name + 'second feedback lasts its own 1500ms', btn.textContent, t.copied);
    p.advance(1); eq(name + 'second timer restores its own label', btn.textContent, t.copy);
    for (const action of ['new copy success', 'new copy failure', 'Clear', 'CtrlL', 'new input', 'new result']) {
      p = fresh(); btn = button(p); btn.click(); p.clipboard.at(-1).resolve(); await settle();
      const queued = p.takeTimer(1500); // Its real deadline has passed; delay only callback delivery.
      if (action === 'Clear') p.get('jwt-clear').click();
      else if (action === 'CtrlL') p.key('l', {}, btn);
      else if (action === 'new input') p.input(differentToken);
      else if (action === 'new result') { p.input(differentToken); p.get('jwt-decode').click(); }
      else { btn.click(); action === 'new copy success' ? p.clipboard.at(-1).resolve() : p.clipboard.at(-1).reject(Error('controlled second failure')); await settle(); }
      const before = p.snapshot(), label = btn.textContent; queued();
      eq(name + 'queued old timer after ' + action + ' preserves page', p.snapshot(), before);
      eq(name + 'queued old timer after ' + action + ' preserves old button', btn.textContent, label);
    }
    for (const boundary of ['missing API', 'sync throw']) {
      p = fresh(); btn = button(p);
      p.sandbox.navigator.clipboard = boundary === 'missing API' ? undefined : { writeText() { throw Error('controlled synchronous denial'); } };
      let thrown = ''; try { btn.click(); } catch (error) { thrown = String(error); }
      eq(name + boundary + ' does not escape event handler', thrown, '');
      eq(name + boundary + ' is visibly reported', btn.textContent, copyFailures[lang]);
    }
    p = fresh(); btn = button(p); btn.click(); p.clipboard.at(-1).reject(Error('controlled first button denial')); await settle();
    const other = p.get('jwt-results').querySelectorAll('.btn-copy')[1 - index]; other.click(); p.clipboard.at(-1).resolve(); await settle();
    eq(name + 'other button success keeps this button error', btn.textContent, copyFailures[lang]);
    eq(name + 'other button independently shows success', other.textContent, t.copied);
  }
} finally { process.removeListener('unhandledRejection', rejected); }
console.log('Page copy checks: ' + (passes - copyStart) + ' passed');

// NumericDate decorations use the real highlighter, rendered DOM and fixed 2026-10-05T00:00:00.250Z clock.
const timestampStart = passes;
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = page(lang), name = 'timestamp ' + lang + ': ';
  p.get('jwt-example').click();
  eq(name + 'example dates are actually rendered', JSON.stringify(p.get('jwt-results').querySelectorAll('.jwt-time-hint').map(el => el.textContent)), JSON.stringify(['(Thu, 18 Jan 2018 01:30:22 GMT)', '(Tue, 01 Jan 2030 00:00:00 GMT — valid)']));
  eq(name + 'example marks expiration only', p.get('jwt-results').querySelectorAll('.jwt-valid').length, 1);
  for (const fixture of [
    { payload: { iat: -1, nbf: 0.5, exp: 0 }, hints: ['(Wed, 31 Dec 1969 23:59:59 GMT)', '(Thu, 01 Jan 1970 00:00:00 GMT)', '(Thu, 01 Jan 1970 00:00:00 GMT — EXPIRED)'], status: 'EXPIRED' },
    { payload: { exp: 1791158400.5 }, hints: ['(Mon, 05 Oct 2026 00:00:00 GMT — valid)'], status: 'valid' },
    { payload: { exp: 1791158400.125 }, hints: ['(Mon, 05 Oct 2026 00:00:00 GMT — EXPIRED)'], status: 'EXPIRED' },
    { payload: { exp: 1e-7 }, hints: ['(Thu, 01 Jan 1970 00:00:00 GMT — EXPIRED)'], status: 'EXPIRED' },
    { payload: { exp: '1893456000', iat: null, nbf: false }, hints: [], status: null },
  ]) {
    p.input(seg({ alg: 'none' }) + '.' + seg(fixture.payload) + '.'); p.get('jwt-decode').click();
    eq(name + JSON.stringify(fixture.payload) + ' exact displayed dates', JSON.stringify(p.get('jwt-results').querySelectorAll('.jwt-time-hint').map(el => el.textContent)), JSON.stringify(fixture.hints));
    const mark = p.get('jwt-results').querySelector('.jwt-valid,.jwt-expired');
    eq(name + JSON.stringify(fixture.payload) + ' expiry compares unrounded seconds', mark?.textContent ?? null, fixture.status);
    for (const [key, value] of Object.entries(fixture.payload)) eq(name + key + ' original numeric/string precision is visible', p.get('jwt-results').querySelectorAll('.jwt-json')[1].textContent.includes('"' + key + '": ' + JSON.stringify(value)), true);
    p.get('jwt-results').querySelectorAll('.btn-copy')[1].click();
    eq(name + 'copy excludes time decorations and preserves JSON precision', p.clipboard.at(-1).value, JSON.stringify(fixture.payload, null, 2));
    p.clipboard.at(-1).resolve(); await settle();
    eq(name + 'signature remains explicitly unverified', p.get('jwt-results').querySelector('.jwt-sig-note').textContent, '(raw Base64URL — not verified)');
  }
}
console.log('Page timestamp checks: ' + (passes - timestampStart) + ' passed');

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
