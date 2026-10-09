// JWT Generator — HMAC signing, secret decoding and the RFC 7518 §3.2 minimum key length
//
// Read:  src/components/tools/JwtGeneratorTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
//        src/layouts/ToolLayout.astro (actual shared shortcut handler; full page IIFE below)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: HMAC keys shorter than the hash output were accepted without a word,
// although RFC 7518 §3.2 says a key of the same size as the hash output (or larger) MUST be used
// (32 / 48 / 64 bytes for HS256 / HS384 / HS512); the default sample secret "your-256-bit-secret"
// is only 19 bytes. Also: the RFC 7515 Appendix A.1 HS256 example signs to the published JWS;
// HS384 / HS512 match node:crypto; header and payload are signed byte-for-byte as written (UTF-8,
// non-ASCII); Base64 and base64url secrets with or without padding; invalid Base64 is rejected;
// 4-language STRINGS keys. Page: the payload must be a JSON object (RFC 7519 §7.2 step 10), a Base64
// secret that decodes to 0 bytes and a failed signature show localized messages (the browser message
// goes to the console only), an unpaired UTF-16 surrogate in Header, Payload or a UTF-8 secret is
// rejected with its position (TextEncoder would sign U+FFFD instead), Copy falls back to execCommand('copy'), and analytics send one event per
// committed edit (change, algorithm, format) once its token exists, not per typing pause or on load.
//
// Run: node scripts/test-jwt-generator.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac, createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { contractProblems, readToolMdx, annotations, fencedBlocks, LANGS } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JwtGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JwtGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { minKeyBytes, decodeSecret, signJwt };')();
const subtle = webcrypto.subtle;

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
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------- RFC 7518 §3.2 ----------
eq('HS256 needs 32 bytes', E.minKeyBytes('HS256'), 32);
eq('HS384 needs 48 bytes', E.minKeyBytes('HS384'), 48);
eq('HS512 needs 64 bytes', E.minKeyBytes('HS512'), 64);
eq('default sample secret is 19 bytes (below 32)', E.decodeSecret('your-256-bit-secret', 'utf8').length, 19);
check('component warns when the key is shorter than minKeyBytes', /keyBytes\.length < minBytes/.test(source) && /warnShortKey/.test(source));

// ---------- RFC 7515 Appendix A.1 ----------
{
  const key = E.decodeSecret('AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow', 'base64');
  eq('A.1 key is 64 bytes', key.length, 64);
  const jws = await E.signJwt('{"typ":"JWT",\r\n "alg":"HS256"}', '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}', key, 'HS256', subtle);
  eq('RFC 7515 A.1 JWS', jws, 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
}

// ---------- HS384 / HS512 and UTF-8 against node:crypto ----------
for (const [algo, hash] of [['HS256', 'sha256'], ['HS384', 'sha384'], ['HS512', 'sha512']]) {
  const header = JSON.stringify({ alg: algo, typ: 'JWT' });
  const payload = JSON.stringify({ sub: '42', name: 'Zoë 山田 😀' });
  const key = E.decodeSecret('k'.repeat(64), 'utf8');
  const jws = await E.signJwt(header, payload, key, algo, subtle);
  const input = b64url(Buffer.from(header)) + '.' + b64url(Buffer.from(payload));
  eq(algo + ' matches node:crypto', jws, input + '.' + b64url(createHmac(hash, Buffer.from(key)).update(input).digest()));
}

// ---------- secret decoding ----------
eq('base64 with padding', Array.from(E.decodeSecret('AQID/w==', 'base64')), [1, 2, 3, 255]);
eq('base64url without padding', Array.from(E.decodeSecret('AQID_w', 'base64')), [1, 2, 3, 255]);
eq('invalid base64 → null', E.decodeSecret('not base64!', 'base64'), null);
eq('utf8 secret bytes', Array.from(E.decodeSecret('é', 'utf8')), [0xc3, 0xa9]);

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    for (const l of ['en', 'zh', 'ja', 'ko']) check(l + ' warnShortKey placeholders', ['{bytes}', '{min}', '{algo}'].every((x) => S[l].warnShortKey.includes(x)));
  }
}

// ---------- real page controls ----------
// This DOM supplies source-created elements and native value coercion. The complete
// production IIFE and shared key handler run without replacing any application code.
const clientScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!clientScript || !shortcut.includes("document.addEventListener('keydown'")) throw Error('Actual page/shortcut missing');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
function pageVM(lang, shellFirst) {
  const copies = [], timers = new Map(), clears = [], tracks = [], jobs = [];
  let now = 0, timerID = 0, document, copyThrows = false;
  const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
  function simple(e, selector) {
    if (e.tagName === '#TEXT') return false;
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    const classes = [...plain.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
      && classes.every(c => e.className.split(/\s+/).includes(c))
      && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(part => {
      const parts = part.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      let parent = e.parentNode;
      while (parts.length) {
        while (parent && !simple(parent, parts.at(-1))) parent = parent.parentNode;
        if (!parent) return false;
        parts.pop(); parent = parent.parentNode;
      }
      return true;
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', text: '', _value: '', hidden: false, disabled: false, style: {}, checked: false, open: false }); }
    get classList() { const e = this; return { add(c) { if (!e.className.split(/\s+/).includes(c)) e.className = (e.className + ' ' + c).trim(); }, remove(c) { e.className = e.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (['id', 'class', 'type', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value);
      if (['hidden', 'checked', 'disabled', 'open'].includes(key)) this[key] = true;
      if (key === 'style') for (const part of String(value).split(';')) { const [name, value] = part.split(':'); if (name && value) this.style[name.trim()] = value.trim(); }
    }
    getAttribute(key) { return key === 'hidden' ? (this.hidden ? '' : null) : this.attributes[key] ?? null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
    removeChild(e) { this.children = this.children.filter(c => c !== e); e.parentNode = null; return e; }
    select() { document.selected = this; }
    contains(e) { return this === e || descendants(this).includes(e); }
    querySelectorAll(selector) { return descendants(this).filter(e => matches(e, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (let e = this; e; e = e.parentNode) { event.currentTarget = e; for (const fn of e.listeners[type] || []) fn.call(e, event); if (event.stopped) break; }
      return event;
    }
    click() { if (!this.disabled) { if (this.tagName === 'SUMMARY') this.parentNode.open = !this.parentNode.open; return this.dispatch('click'); } }
    focus() { document.activeElement = this; }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const escapeHTML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + escapeHTML(PAGE_STRINGS[lang][key]) + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHTML(PAGE_STRINGS[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const text = token[0];
    if (text.startsWith('</')) { if (stack.length < 2) throw Error('Unbalanced source markup'); stack.pop(); }
    else if (text.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(text)[1], e = new Element(tag);
      for (const attr of text.matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(attr[1], attr[2]);
      for (const attr of ['hidden', 'disabled', 'readonly', 'checked', 'open']) if (new RegExp('\\s' + attr + '(?=\\s|/?>)').test(text)) e.setAttribute(attr, '');
      stack.at(-1).appendChild(e);
      if (!/\/>$/.test(text) && !['input', 'br', 'hr', 'img'].includes(tag)) stack.push(e);
    } else { const e = new Element('#text'); e.text = text; stack.at(-1).appendChild(e); }
  }
  if (stack.length !== 1) throw Error('Incomplete source markup');
  document.getElementById = id => descendants(document).find(e => e.id === id) ?? null;
  document.createElement = tag => new Element(tag);
  // Copy fallback: 'forbidden' (default) throws, 'fail' returns false, 'ok' copies the selected textarea.
  const exec = { mode: 'forbidden', calls: [] };
  document.execCommand = cmd => {
    exec.calls.push({ cmd, value: document.selected?.value, attached: !!document.selected && document.contains(document.selected) });
    if (exec.mode === 'forbidden') throw Error('Forbidden unexpected execCommand');
    return exec.mode === 'ok';
  };
  const errors = [];
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing actual source ID ' + id); return e; };
  const context = {
    document, console: { ...console, error: (...args) => errors.push(args.map(String).join(' ')) }, TextEncoder, TextDecoder, atob, btoa, _slug: 'jwt-generator',
    t: Object.fromEntries(Object.entries(PAGE_STRINGS[lang]).filter(([key]) => key !== 'tips')),
    crypto: { subtle: {
      importKey(...args) { return webcrypto.subtle.importKey(...args); },
      sign(...args) {
        let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        jobs.push({ real: webcrypto.subtle.sign(...args), resolve, reject }); return promise;
      },
    } },
    navigator: { clipboard: { writeText(value) {
      if (copyThrows) throw Error('Controlled synchronous clipboard failure');
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      copies.push({ value: String(value), resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerID; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); },
  };
  context.window = context; vm.createContext(context);
  const shared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.astro:keyboard' });
  if (shellFirst) shared();
  vm.runInContext(clientScript, context, { filename: 'JwtGeneratorTool.astro:script' });
  if (!shellFirst) shared();
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  return {
    get, document, copies, clears, tracks, timers, jobs, advance, exec, errors, context,
    input(id, value) { get(id).value = value; get(id).dispatch('input'); },
    change(id) { get(id).dispatch('change'); },
    key(key = 'l', modifier = 'ctrlKey', target = 'jg-header') { if (target === 'jg-header') get('jg-header-details').open = true; (target ? get(target) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy() { const before = copies.length; get('jg-copy').click(); return copies.length > before ? copies.at(-1) : null; },
    setCopyThrows(value) { copyThrows = value; },
    algo(algo) { document.querySelector('[data-algo="' + algo + '"]').click(); },
    format(fmt) { document.querySelectorAll('input[name="jg-fmt"]').forEach(e => e.checked = e.value === fmt); document.querySelector('input[name="jg-fmt"][value="' + fmt + '"]').dispatch('change'); },
    async waitJobs(count) { for (let i = 0; i < 2000 && jobs.length < count; i++) await new Promise(resolve => setTimeout(resolve, 1)); if (jobs.length < count) throw Error('Expected actual WebCrypto sign job ' + count); },
    async finish(index, outcome = 'resolve') { const job = jobs[index]; if (!job) throw Error('Missing actual sign job'); const real = await job.real; job[outcome](outcome === 'resolve' ? real : Error('controlled sign rejection')); await settle(); },
    snapshot() { return { inputs: ['jg-header','jg-payload','jg-secret'].map(id => get(id).value), token: get('jg-result').textContent, display: get('jg-result-wrap').style.display, status: get('jg-status').textContent, statusClass: get('jg-status').className, errors: ['jg-header-err','jg-payload-err','jg-secret-warn'].map(id => get(id).textContent), copy: get('jg-copy').textContent }; },
  };
}

const PAGE_STRINGS = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/)[1])();
const COPY_FAILURE = {
  en: 'Could not copy. Try again or copy the token manually.',
  zh: '复制失败。请重试，或选中 Token 后手动复制。',
  ja: 'コピーできませんでした。再試行するか、トークンを選択して手動でコピーしてください。',
  ko: '복사하지 못했습니다. 다시 시도하거나 토큰을 선택하여 직접 복사하세요.',
};
const ALGO_FAILURE = {
  en: 'Header alg must match the selected algorithm ({algo}).',
  zh: 'Header 的 alg 必须与所选算法（{algo}）一致。',
  ja: 'ヘッダーの alg は選択したアルゴリズム（{algo}）と一致する必要があります。',
  ko: '헤더의 alg는 선택한 알고리즘({algo})과 일치해야 합니다.',
};
function verifies(token, algo, key, header, payload) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const hash = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' }[algo];
  return parts[0] === b64url(Buffer.from(header.trim())) && parts[1] === b64url(Buffer.from(payload.trim()))
    && parts[2] === createHmac(hash, key).update(parts[0] + '.' + parts[1]).digest('base64url');
}
const pageStart = passes;
for (const lang of ['en','zh','ja','ko']) for (const shellFirst of [false, true]) {
  const tag = lang + '/' + (shellFirst ? 'shell-first' : 'tool-first'), t = PAGE_STRINGS[lang];
  const populated = async () => { const p = pageVM(lang, shellFirst); await p.waitJobs(1); await p.finish(0); return p; };
  const empty = p => { const s = p.snapshot(); return !s.token && s.display === 'none' && !s.status && !s.errors.some(Boolean) && s.copy === t.copy; };
  {
    const p = await populated(), s = p.snapshot();
    check(tag + ' default auto-generated token verifies independently', verifies(s.token, 'HS256', Buffer.from('your-256-bit-secret'), s.inputs[0], s.inputs[1]));
    eq(tag + ' short default key still signs with localized warning', s.errors[2], t.warnShortKey.replace('{bytes}',19).replace('{min}',32).replace('{algo}','HS256'));
    eq(tag + ' default success visible', [s.display,s.status], ['',t.generated]);
    for (const algo of ['HS256','HS384','HS512']) for (const fmt of ['utf8','base64']) {
      const count = p.jobs.length, key = Buffer.from('é'.repeat(40));
      p.algo(algo); p.format(fmt); p.input('jg-secret', fmt === 'base64' ? key.toString('base64') : key.toString());
      p.input('jg-payload','{\n "sub": "山田", "n": 42\n}');
      p.advance(499); eq(tag + ' 500ms debounce ' + algo + '/' + fmt, p.jobs.length, count);
      p.advance(1); await p.waitJobs(count + 1); await p.finish(count);
      const s = p.snapshot();
      check(tag + ' real page native HMAC matches node:crypto ' + algo + '/' + fmt, verifies(s.token, algo, key, s.inputs[0], s.inputs[1]));
      eq(tag + ' menu deliberately synchronizes Header alg ' + algo, JSON.parse(s.inputs[0]).alg, algo);
      eq(tag + ' valid adequate key has no field errors', s.errors, ['','','']);
      eq(tag + ' full token copy ' + algo + '/' + fmt, p.copy()?.value, s.token); p.copies.at(-1).resolve(); await settle();
    }
  }
  for (const [name,id,value,errorId,error] of [
    ['bad header','jg-header','{','jg-header-err',t.errHeaderJson],
    ['wrong algorithm','jg-header','{"alg":"HS512","typ":"JWT"}','jg-header-err',ALGO_FAILURE[lang].replace('{algo}','HS256')],
    ['missing algorithm','jg-header','{"typ":"JWT"}','jg-header-err',ALGO_FAILURE[lang].replace('{algo}','HS256')],
    ['null header','jg-header','null','jg-header-err',ALGO_FAILURE[lang].replace('{algo}','HS256')],
    ['bad payload','jg-payload','{','jg-payload-err',t.errPayloadJson],
    ['empty key','jg-secret','','jg-secret-warn',t.errEmptySecret],
    ['invalid Base64','jg-secret','not base64!','jg-secret-warn',t.errBase64Secret],
    ['whitespace-only Base64 key','jg-secret','   ','jg-secret-warn',t.errEmptyKey],
    ['array payload','jg-payload','[1, 2]','jg-payload-err',t.errPayloadObject],
    ['string payload','jg-payload','"user-42"','jg-payload-err',t.errPayloadObject],
    ['number payload','jg-payload','42','jg-payload-err',t.errPayloadObject],
    ['null payload','jg-payload','null','jg-payload-err',t.errPayloadObject],
    ['lone surrogate in payload','jg-payload','{"name": "a\ud83d"}','jg-payload-err',t.errSurrogate.replace('{pos}', 12)],
    ['lone surrogate in header','jg-header','{"alg":"HS256","x":"\udc00"}','jg-header-err',t.errSurrogate.replace('{pos}', 21)],
    ['lone surrogate in UTF-8 secret','jg-secret','key-\ud800-more','jg-secret-warn',t.errSurrogate.replace('{pos}', 5)],
    ['lone surrogate in Base64 secret has no position','jg-secret','c2Vj\ud800cmV0','jg-secret-warn',t.errBase64Secret],
  ]) {
    const p = await populated(); if (name === 'invalid Base64' || name === 'whitespace-only Base64 key' || name.includes('Base64 secret')) p.format('base64'); p.input(id,value); p.advance(500); await settle();
    eq(tag + ' ' + name + ' visible localized validation', p.get(errorId).textContent, error);
    eq(tag + ' ' + name + ' never starts another signing job', p.jobs.length, 1);
    eq(tag + ' ' + name + ' preserves typed text', p.get(id).value, value);
    eq(tag + ' ' + name + ' erases stale token and copy data', [p.snapshot().token,p.snapshot().display,p.copy()], ['', 'none', null]);
  }
  {
    const p = await populated(), key = Buffer.from('é'.repeat(40)), b64 = key.toString('base64');
    p.format('base64'); p.input('jg-secret', '  ' + b64.slice(0, 20) + ' \t ' + b64.slice(20) + '  '); p.advance(500); await p.waitJobs(2); await p.finish(1);
    const s = p.snapshot();
    check(tag + ' Base64 mode ignores leading, trailing and inner whitespace in the secret', verifies(s.token, 'HS256', key, s.inputs[0], s.inputs[1]) && s.errors[2] === '');
  }
  {
    const p = await populated(), key = 'demo-secret-at-least-32-bytes-long';
    p.input('jg-secret', ' ' + key); p.advance(500); await p.waitJobs(2); await p.finish(1);
    const s = p.snapshot();
    check(tag + ' UTF-8 mode keeps a leading space in the key bytes', verifies(s.token, 'HS256', Buffer.from(' ' + key), s.inputs[0], s.inputs[1]) && !verifies(s.token, 'HS256', Buffer.from(key), s.inputs[0], s.inputs[1]));
  }
  {
    const p = await populated(); p.input('jg-payload','{"name": "\\ud83d\\ude00 ok 😀"}'); p.advance(500); await p.waitJobs(2); await p.finish(1);
    const s = p.snapshot();
    check(tag + ' JSON escapes and a paired emoji still sign', verifies(s.token, 'HS256', Buffer.from('your-256-bit-secret'), s.inputs[0], s.inputs[1]) && s.errors[1] === '');
  }
  {
    const p = await populated(); const before = p.snapshot(); const event = p.key('l','ctrlKey',null);
    eq(tag + ' outside focus does not clear state', p.snapshot(), before); check(tag + ' outside focus does not prevent default', !event.defaultPrevented);
    for (const modifier of ['ctrlKey','metaKey']) for (const id of ['jg-header','jg-payload','jg-secret','jg-copy']) {
      const p = await populated(), event = p.key('L',modifier,id);
      check(tag + ' shortcut clears result/warning/status ' + modifier + '/' + id, empty(p));
      eq(tag + ' shared shortcut empties all input and persists clear', [p.snapshot().inputs,p.clears,event.defaultPrevented], [['','',''],['jwt-generator'],true]);
      eq(tag + ' cleared result cannot be copied', p.copy(), null);
      eq(tag + ' shortcut keeps focus in visible input ' + id, p.document.activeElement.id, id === 'jg-copy' ? 'jg-payload' : id);
    }
  }
  const changes = {
    CtrlL: p => p.key(),
    manualEmpty: p => { for (const id of ['jg-header','jg-payload','jg-secret']) p.input(id,''); },
    input: p => p.input('jg-payload','{"sub":"NEW"}'),
    invalid: p => p.input('jg-header','{'),
    algorithm: p => p.algo('HS512'),
    format: p => p.format('base64'),
  };
  for (const [action,change] of Object.entries(changes)) for (const outcome of ['resolve','reject']) {
    const p = pageVM(lang,shellFirst); await p.waitJobs(1); change(p); const before = p.snapshot();
    unhandled.length = 0; await p.finish(0,outcome);
    eq(tag + ' late sign ' + outcome + ' after ' + action + ' preserves current state before debounce', p.snapshot(), before);
    eq(tag + ' late sign rejection handled', unhandled, []);
    if (action === 'CtrlL' || action === 'manualEmpty') { p.advance(500); await settle(); check(tag + ' cleared input stays empty after debounce', empty(p)); }
  }
  for (const oldFirst of [true,false]) for (const outcome of ['resolve','reject']) {
    const p = pageVM(lang,shellFirst); await p.waitJobs(1); p.input('jg-payload','{"sub":"NEW"}'); p.advance(500); await p.waitJobs(2);
    if (oldFirst) { const before = p.snapshot(); await p.finish(0,outcome); eq(tag + ' old sign cannot replace newer pending status', p.snapshot(),before); }
    await p.finish(1); const latest = p.snapshot(); if (!oldFirst) await p.finish(0,outcome);
    check(tag + ' newest real signature authentic', verifies(latest.token,'HS256',Buffer.from('your-256-bit-secret'),latest.inputs[0],latest.inputs[1]));
    eq(tag + ' old/new signing completion order ' + oldFirst + '/' + outcome, p.snapshot(),latest);
  }
  {
    const p = await populated(); p.input('jg-payload','{"retry":true}'); p.advance(500); await p.waitJobs(2); await p.finish(1,'reject');
    eq(tag + ' current sign failure is visible, localized and old token erased', [p.snapshot().status,p.snapshot().statusClass,p.snapshot().token,p.snapshot().display], [t.errSign,'jg-status error','','none']);
    check(tag + ' sign failure logs the browser message to the console only', p.errors.some(e => /controlled sign rejection/.test(e)) && !/controlled|Error:/.test(p.snapshot().status));
    p.input('jg-payload','{"retry":true}'); p.advance(500); await p.waitJobs(3); await p.finish(2);
    eq(tag + ' failed sign can retry same input', [p.snapshot().status,p.snapshot().display], [t.generated,'']);
  }
  {
    const p = await populated(), token = p.snapshot().token; unhandled.length = 0;
    p.copy().reject(Error('controlled copy rejection')); await settle();
    eq(tag + ' current copy rejection localized', p.snapshot().status,COPY_FAILURE[lang]); eq(tag + ' copy rejection handled',unhandled,[]);
    const retry = p.copy(); eq(tag + ' failure direct retry copies same token', retry.value,token); retry.resolve(); await settle();
    eq(tag + ' direct retry clears error and succeeds', [p.snapshot().status,p.snapshot().statusClass,p.snapshot().copy], [t.generated,'jg-status success',t.copied]);
    p.advance(1499); eq(tag + ' copy lasts own deadline',p.snapshot().copy,t.copied); p.advance(1); eq(tag + ' copy resets own deadline',p.snapshot().copy,t.copy);
    p.setCopyThrows(true); let threw = false; try { p.copy(); } catch { threw = true; }
    check(tag + ' synchronous clipboard throw handled',!threw); eq(tag + ' synchronous failure visible',p.snapshot().status,COPY_FAILURE[lang]);
    p.setCopyThrows(false); p.copy().resolve(); await settle(); eq(tag + ' synchronous failure direct retry',p.snapshot().status,t.generated);
  }
  for (const [action,change] of Object.entries({...changes,newResult:async p=>{p.input('jg-payload','{"sub":"NEW"}');p.advance(500);await p.waitJobs(2);await p.finish(1);}})) for (const outcome of ['resolve','reject']) {
    const p = await populated(), copy = p.copy(); await change(p); const before = p.snapshot(); unhandled.length = 0;
    copy[outcome](Error('controlled obsolete copy')); await settle();
    eq(tag + ' late copy ' + outcome + ' after ' + action, p.snapshot(),before); eq(tag + ' obsolete clipboard rejection handled',unhandled,[]);
  }
  for (const oldFirst of [true,false]) for (const outcome of ['resolve','reject']) {
    const p = await populated(), old = p.copy(), current = p.copy();
    if (oldFirst) { old[outcome](Error('old')); await settle(); eq(tag + ' old copy leaves current pending label',p.snapshot().copy,t.copy); }
    current.resolve(); await settle(); const latest = p.snapshot(); if (!oldFirst) { old[outcome](Error('old')); await settle(); }
    eq(tag + ' newest copy owns feedback in either order ' + oldFirst + '/' + outcome,p.snapshot(),latest);
    eq(tag + ' current copied feedback',p.snapshot().copy,t.copied);
  }
  {
    const p = await populated(); p.copy().resolve(); await settle();
    const oldTimers = [...p.timers.values()]; p.timers.clear(); p.advance(1500); p.copy().resolve(); await settle(); const latest = p.snapshot();
    check(tag + ' actual copy timer captured',oldTimers.length > 0); for (const timer of oldTimers) timer.fn();
    eq(tag + ' overdue old timer preserves new copied feedback',p.snapshot(),latest); p.advance(1500);eq(tag + ' new timer restores localized Copy',p.snapshot().copy,t.copy);
  }
  for (const [action,change] of Object.entries(changes)) {
    const p = await populated(); p.copy().resolve(); await settle(); const oldTimers = [...p.timers.values()]; p.timers.clear(); p.advance(1500); change(p); const before = p.snapshot();
    eq(tag + ' '+action+' resets old copied label immediately',p.snapshot().copy,t.copy); for (const timer of oldTimers) timer.fn();
    eq(tag + ' held old feedback timer after '+action,p.snapshot(),before);
  }
}
// ---------- copy fallback and analytics ----------
for (const lang of ['en','zh','ja','ko']) {
  const t = PAGE_STRINGS[lang];
  const populated = async () => { const p = pageVM(lang, false); await p.waitJobs(1); await p.finish(0); return p; };
  for (const kind of ['reject','throw','missing']) {
    for (const mode of ['ok','fail']) {
      const p = await populated(), token = p.snapshot().token; p.exec.mode = mode;
      if (kind === 'throw') p.setCopyThrows(true);
      if (kind === 'missing') p.context.navigator.clipboard = undefined;
      const pending = kind === 'missing' ? null : (kind === 'throw' ? (p.get('jg-copy').click(), null) : p.copy());
      if (kind === 'missing') p.get('jg-copy').click();
      if (pending) pending.reject(Error('denied'));
      await settle();
      eq(lang + ' copy ' + kind + ' tries execCommand with the full token in an attached textarea', p.exec.calls.map(c => [c.cmd, c.value, c.attached]), [['copy', token, true]]);
      eq(lang + ' copy ' + kind + ' fallback textarea is removed', p.document.selected ? p.document.selected.parentNode : 'no fallback textarea', null);
      eq(lang + ' copy ' + kind + ' fallback ' + mode, [p.snapshot().copy, p.snapshot().status], mode === 'ok' ? [t.copied, t.generated] : [t.copy, COPY_FAILURE[lang]]);
    }
  }
  {
    // A refused copy that is already obsolete does not try the fallback.
    const p = await populated(), pending = p.copy(); p.input('jg-payload', '{"sub":"NEW"}'); p.exec.mode = 'ok';
    pending.reject(Error('late')); await settle();
    eq(lang + ' obsolete copy rejection does not run execCommand', p.exec.calls.length, 0);
  }
  {
    // Analytics: the automatic first token and typing pauses send nothing; a committed change
    // (change event, algorithm or format) sends one event once its token exists; same state once.
    const p = await populated();
    eq(lang + ' first automatic token sends no event', p.tracks.length, 0);
    p.input('jg-payload', '{"sub":"a"}'); p.advance(500); await p.waitJobs(2); await p.finish(1);
    eq(lang + ' typing pause sends no event', p.tracks.length, 0);
    p.change('jg-payload'); eq(lang + ' change after the token exists sends one event', p.tracks, [['jwt-generator','generate']]);
    p.change('jg-payload'); p.change('jg-secret'); eq(lang + ' same inputs are not sent again', p.tracks.length, 1);
    p.input('jg-payload', '{"sub":"b"}'); p.change('jg-payload'); await p.waitJobs(3);
    eq(lang + ' change flushes the pending debounce at once', p.jobs.length, 3);
    eq(lang + ' no event before the flushed token exists', p.tracks.length, 1);
    await p.finish(2); eq(lang + ' flushed token sends its event', p.tracks.length, 2);
    p.advance(1000); eq(lang + ' no second signing after the flush', p.jobs.length, 3);
    p.input('jg-payload', '['); p.change('jg-payload'); p.advance(500); await settle();
    eq(lang + ' invalid input sends no event', p.tracks.length, 2);
    p.input('jg-payload', '{"sub":"b"}'); p.change('jg-payload'); await p.waitJobs(4); await p.finish(3);
    eq(lang + ' returning to the last tracked inputs sends nothing', p.tracks.length, 2);
    p.algo('HS512'); p.advance(500); await p.waitJobs(5); await p.finish(4);
    eq(lang + ' algorithm change sends one event once signed', p.tracks.length, 3);
    p.format('base64'); p.advance(500); await p.waitJobs(6); await p.finish(5);
    eq(lang + ' format change sends one event once signed', p.tracks.length, 4);
    p.key('l', 'ctrlKey', 'jg-payload');
    p.input('jg-header', '{"alg":"HS512","typ":"JWT"}'); p.input('jg-secret', 'your-256-bit-secret'); p.input('jg-payload', '{"sub":"b"}'); p.change('jg-payload'); await p.waitJobs(7); await p.finish(6);
    eq(lang + ' Ctrl+L resets the duplicate check', p.tracks.length, 5);
    check(lang + ' every event is jwt-generator/generate', p.tracks.every(a => a[0] === 'jwt-generator' && a[1] === 'generate'));
  }
}

await settle(); eq('all page Promise rejections handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);
console.log('real page lifecycle: ' + (passes - pageStart) + ' passed');


// ---------- worked examples on the four pages ----------
// {/* jwt-check: {"algo","fmt","secret","header","payload", "warn"?, "inputLen"?, "secretShown"?} */}
//   The token is signed again with node:crypto (and, in a separate pass, with the page engine) and must
//   appear in inline code or a code block after the note. Header and Payload must be shown as code
//   blocks, and the secret as code, in the same section (before or after the note). The inputs must pass
//   the page's own checks (alg matches, Payload is an object, no unpaired surrogate, key not empty). A
//   key shorter than RFC 7518 §3.2 needs "warn": <bytes>, and the page's localized warning must appear.
// {/* jwt-time: {"iso","unix"} */}  Date.parse(iso) / 1000 = unix, and unix is shown as code after the note.
// {/* jwt-py: {"expect"} */}  the next code block is Python; with PyJWT 2.10.1 (python3, or $PYJWT_PYTHON)
//   it runs and prints expect, which must also be shown as code after the note. Without PyJWT: SKIP.
function shownCode(text) {
  const inline = [...text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').replace(/<pre\b[\s\S]*?<\/pre>/g, '').matchAll(/`([^`\n]+)`|<code>\{"((?:[^"\\]|\\.)*)"\}<\/code>|<code>([^<{]+)<\/code>/g)].map(m => m[1] ?? m[3] ?? JSON.parse('"' + m[2] + '"'));
  return [...inline, ...fencedBlocks(text).map(b => b.text)];
}
function sectionBefore(body, index) {
  const before = body.slice(0, index);
  const h2 = Math.max(before.lastIndexOf('\n## '), before.lastIndexOf('<h2'));
  return h2 < 0 ? before : before.slice(h2);
}
const HMAC = { HS256: 'sha256', HS384: 'sha384', HS512: 'sha512' };
function lone(str) { for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const d = str.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { i++; continue; } return true; } if (c >= 0xdc00 && c <= 0xdfff) return true; } return false; }
function exampleToken(spec) {
  const key = Buffer.from(E.decodeSecret(spec.secret, spec.fmt) ?? []);
  const input = b64url(Buffer.from(spec.header.trim())) + '.' + b64url(Buffer.from(spec.payload.trim()));
  return { key, input, token: input + '.' + createHmac(HMAC[spec.algo], key).update(input).digest('base64url') };
}
function verifyJwtExample({ spec, after, lang, body, index }) {
  for (const k of ['algo', 'fmt', 'secret', 'header', 'payload']) if (typeof spec?.[k] !== 'string') return 'annotation needs ' + k;
  if (!HMAC[spec.algo] || !['utf8', 'base64'].includes(spec.fmt)) return 'bad algo or fmt';
  let header, payload;
  try { header = JSON.parse(spec.header.trim()); payload = JSON.parse(spec.payload.trim()); } catch { return 'header or payload is not JSON'; }
  if (!header || header.alg !== spec.algo) return 'header alg does not match the algorithm';
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload is not an object';
  if (lone(spec.header) || lone(spec.payload) || (spec.fmt === 'utf8' && lone(spec.secret))) return 'unpaired surrogate';
  const decoded = E.decodeSecret(spec.secret, spec.fmt);
  if (!decoded || !decoded.length) return 'secret does not decode to key bytes';
  const { input, token } = exampleToken(spec);
  const section = sectionBefore(body, index) + after;
  const blocks = fencedBlocks(section).map(b => b.text), codes = shownCode(section), here = shownCode(after);
  if (!here.some(c => c === token || c.includes(token))) return 'token ' + token + ' not shown after the note';
  if (!blocks.includes(spec.header)) return 'header block not shown in the section';
  if (!blocks.includes(spec.payload)) return 'payload block not shown in the section';
  if (spec.secretShown !== false && !codes.includes(spec.secret)) return 'secret not shown as code in the section';
  const min = E.minKeyBytes(spec.algo);
  if (decoded.length < min) {
    if (spec.warn !== decoded.length) return `key is ${decoded.length} bytes; annotation needs "warn": ${decoded.length}`;
    const text = PAGE_STRINGS[lang].warnShortKey.replace('{bytes}', decoded.length).replace('{min}', min).replace('{algo}', spec.algo);
    if (!after.includes(text)) return 'warning not shown: ' + text;
  } else if (spec.warn !== undefined) return `key is ${decoded.length} bytes, no warning`;
  if (spec.inputLen !== undefined && input.length !== spec.inputLen) return `signing input is ${input.length} characters, not ${spec.inputLen}`;
  return null;
}
function verifyJwtTime({ spec, after }) {
  if (typeof spec?.iso !== 'string' || !Number.isInteger(spec.unix)) return 'annotation needs iso and unix';
  if (Date.parse(spec.iso) / 1000 !== spec.unix) return `${spec.iso} is ${Date.parse(spec.iso) / 1000}, not ${spec.unix}`;
  if (!shownCode(after).some(c => c.includes(String(spec.unix)))) return spec.unix + ' not shown as code after the note';
  return null;
}
const pyjwtPython = process.env.PYJWT_PYTHON || 'python3';
let pyjwt = false;
try { pyjwt = execFileSync(pyjwtPython, ['-c', 'import jwt;print(jwt.__version__)'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '2.10.1'; } catch {}
let skips = 0;
function verifyJwtPy({ spec, after }) {
  if (typeof spec?.expect !== 'string') return 'annotation needs expect';
  const block = fencedBlocks(after)[0];
  if (!block || !/^import jwt\b/m.test(block.text)) return 'next code block is not PyJWT code';
  if (!shownCode(after).some(c => c.includes(spec.expect))) return 'expected output not shown after the code';
  if (!pyjwt) { skips++; return null; }
  const dir = mkdtempSync(join(tmpdir(), 'jwt-py-'));
  try {
    writeFileSync(join(dir, 'main.py'), block.text);
    const out = execFileSync(pyjwtPython, [join(dir, 'main.py')]).toString().trim();
    return out === spec.expect ? null : 'PyJWT printed ' + JSON.stringify(out);
  } catch (e) { return 'PyJWT failed: ' + String(e.stderr || e.message).slice(0, 300); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const JWT_ANNOTATIONS = { annotations: [
  { tag: 'jwt-check', min: 2, verify: verifyJwtExample },
  { tag: 'jwt-time', verify: verifyJwtTime },
  { tag: 'jwt-py', verify: verifyJwtPy },
] };
{
  // The page engine (Web Crypto) signs every annotated example to the same token as node:crypto.
  const docs = readToolMdx('jwt-generator');
  for (const lang of LANGS) for (const note of annotations(docs[lang].body, 'jwt-check')) {
    if (!note.spec) continue;
    const key = E.decodeSecret(note.spec.secret, note.spec.fmt);
    if (!key || !key.length) continue;
    const engine = await E.signJwt(note.spec.header.trim(), note.spec.payload.trim(), key, note.spec.algo, subtle);
    eq(lang + ' jwt-check engine token equals node:crypto: ' + engine.slice(-12), engine, exampleToken(note.spec).token);
  }
}

{
  // Text claims about one Base64URL segment: the characters encode exactly those UTF-8 bytes and
  // appear in the page's token.
  const docs = readToolMdx('jwt-generator');
  for (const [lang, word, seg] of [['zh', '运营', '6L-Q6JCl'], ['ko', '홍길동', '7ZmN6ri464-Z']]) {
    const body = docs[lang].body;
    eq(lang + ' segment ' + seg + ' is Base64URL of ' + word, Buffer.from(word).toString('base64url'), seg);
    check(lang + ' segment ' + seg + ' appears inside a token on the page', fencedBlocks(body).some(b => /^ey|^ew/.test(b.text) && b.text.split('.')[1]?.includes(seg)));
  }
}

// ---------- v2 page layout ----------
const v2Start = passes;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const addedExample = {
  en: '<p>Editing Header alg to HS512 while HS256 remains selected shows an error and clears the previous token.</p>',
  zh: '<p>例如，所选算法仍为 HS256 时，把 Header 的 alg 改为 HS512，会显示错误并清除旧 Token。</p>',
  ja: '<p>例えば、選択を HS256 のままヘッダーの alg を HS512 に変えると、エラーを表示して以前のトークンを消します。</p>',
  ko: '<p>예를 들어 HS256을 선택한 상태에서 헤더의 alg를 HS512로 바꾸면 오류를 표시하고 이전 토큰을 지웁니다.</p>',
};
// The secret field is a single-line <input type="text">, so it cannot hold a line break; Base64 mode
// strips all whitespace before decoding. The Limits sentence must say exactly that in every language.
const SECRET_WHITESPACE_LIMIT = {
  en: 'In UTF-8 mode the secret is used exactly as typed, so a leading or trailing space changes the signature; Base64 mode ignores whitespace.',
  zh: 'UTF-8 模式下密钥按原样使用，首尾多一个空格签名就会不同；Base64 模式忽略空白。',
  ja: 'UTF-8 モードでは秘密鍵を入力どおりに使うため、前後に空白が 1 つ増えるだけで署名が変わります（Base64 モードでは空白を無視します）。',
  ko: 'UTF-8 모드에서는 비밀 키를 입력한 그대로 쓰므로 앞뒤 공백 하나로도 서명이 달라집니다(Base64 모드에서는 공백을 무시합니다).',
};
// An unpaired surrogate is reported with its position only in Header, Payload and a UTF-8 secret;
// in Base64 mode atob fails first and the page shows errBase64Secret without a position.
const SURROGATE_LIMIT = {
  en: 'Half of an emoji (an unpaired UTF-16 surrogate) in the Header, the Payload or a UTF-8 secret is rejected with its position, because UTF-8 cannot encode it. In Base64 mode it is reported as invalid Base64.',
  zh: 'Header、Payload 和 UTF-8 模式的密钥里如果有 emoji 的一半（落单的 UTF-16 代理项），会报出位置，因为 UTF-8 无法编码它；Base64 模式下它会被报为无效的 Base64。',
  ja: '絵文字の片割れ（対になっていない UTF-16 サロゲート）がヘッダー・ペイロード・UTF-8 モードの秘密鍵にあると、UTF-8 で表せないため位置を示してエラーにします。Base64 モードでは無効な Base64 としてエラーになります。',
  ko: '헤더, 페이로드, UTF-8 모드의 비밀 키에 이모지의 반쪽(짝이 없는 UTF-16 서로게이트)이 있으면 UTF-8로 인코딩할 수 없어 위치를 알려 주고 오류로 처리합니다. Base64 모드에서는 유효하지 않은 Base64로 오류를 표시합니다.',
};
const ANY_FIELD_SURROGATE_CLAIM = { en: /in any field is rejected/, zh: /任何字段里如果有 emoji/, ja: /どの欄にあっても/, ko: /어느 필드든 이모지/ };
const SECRET_LINE_BREAK_CLAIM = {
  en: /secret[^<]{0,80}line break/i, zh: /密钥[^<]{0,40}换行/, ja: /秘密鍵[^<]{0,40}改行/, ko: /비밀 키[^<]{0,40}줄바꿈/,
};
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
check('v2 direct root is a flex column with zero minimum height', /^<div class="jg-wrap">/.test(markup) && /\.jg-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(css));
check('secret field is a single-line text input', /<input id="jg-secret"[^>]*type="text"/.test(markup) && !/<textarea[^>]*id="jg-secret"/.test(markup));
check('v2 registry is convert', /'jwt-generator':\s*'convert'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
check('v2 toolbar precedes reserved status and two panes', markup.indexOf('jg-toolbar') < markup.indexOf('id="jg-status"') && markup.indexOf('id="jg-status"') < markup.indexOf('jg-panels zt-io'));
check('v2 shared two panes', [...markup.matchAll(/zt-io-pane/g)].length === 2 && markup.includes('class="jg-panels zt-io"'));
check('v2 Payload and Token use shared zero-basis fill', /id="jg-payload"[^>]*zt-io-fill/.test(markup) && /id="jg-result-wrap"[^>]*zt-io-fill/.test(markup));
check('v2 Token is an accessible internal scroll region', /id="jg-result-wrap"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-labelledby="jg-result-label"/.test(markup) && /\.jg-result-wrap\s*\{[^}]*overflow:\s*auto/.test(css));
check('v2 long Header or Payload cannot expand desktop input pane', /\.jg-input-pane\s*\{[^}]*overflow:\s*auto/.test(css) && /\.jg-payload\s*\{[^}]*overflow:\s*auto/.test(css));
check('v2 status reserves bounded space', /\.jg-status\s*\{[^}]*height:\s*2\.5rem;[^}]*overflow:\s*auto/.test(css));
check('v2 direct security warning reserves space and scrolls', /\.jg-secret-warn\s*\{[^}]*height:\s*3\.5rem;[^}]*overflow:\s*auto/.test(css));
check('v2 mobile stacks with bounded Token and hides empty pane', /@media\s*\(max-width:\s*860px\)[\s\S]*\.jg-result-wrap\s*\{\s*height:\s*180px/.test(css) && /\.jg-output-pane\[data-empty="true"\]\s*\{\s*display:\s*none/.test(css));
check('v2 phone input is compact, radio and summary targets stay usable', /@media\s*\(max-width:\s*640px\)[\s\S]*\.jg-payload\s*\{\s*min-height:\s*96px;\s*height:\s*96px/.test(css) && /\.jg-radio\s*\{\s*min-height:\s*44px/.test(css) && /\.jg-header-details summary\s*\{\s*min-height:\s*44px/.test(css));
check('v2 Header starts folded and remains a labelled editor', /<details id="jg-header-details"[^>]*>/.test(markup) && !/<details id="jg-header-details"[^>]*\bopen\b/.test(markup) && /<label for="jg-header"/.test(markup));
eq('v2 retains three algorithm buttons and Copy', [...markup.matchAll(/<button\b/g)].length, 4);
check('v2 automatic signing has no Generate or Clear button', !/btn-primary|id="jg-(?:generate|clear)"/.test(markup));
check('v2 secret keeps autocomplete off and current format values', /id="jg-secret"[^>]*autocomplete="off"/.test(markup) && /name="jg-fmt" value="utf8" checked/.test(markup) && /name="jg-fmt" value="base64"/.test(markup));
check('v2 privacy notice follows output', markup.indexOf('class="jg-privacy"') > markup.indexOf('id="jg-result"'));
check('v2 tips are excluded from client and runtime localization is removed', source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && source.includes('define:vars={{ t: CLIENT_T }}') && !/data-i18n|pageLang|STRINGS|TIPS/.test(clientScript) && !/data-i18n/.test(markup));
eq('v2 six actual control/tip bindings', [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\} wide>\{TIPS\.(\w+)\}<\/Toggletip>/g)].map(m=>m.slice(1)).sort(), [
  ['jg-tip-algorithm','algorithm','algorithm'], ['jg-tip-header','headerLabel','header'], ['jg-tip-payload','payloadLabel','payload'], ['jg-tip-secret','secretLabel','secret'], ['jg-tip-format','secretFormat','format'], ['jg-tip-copy','copy','copy'],
].sort());
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { transform } = await import(astroRequire.resolve('@astrojs/compiler'));
const compiled = await transform(source,{filename:'JwtGeneratorTool.astro'});
check('v2 Astro compiles with no errors', !compiled.diagnostics.some(d=>d.severity===1));
function leaves(value,path='') { return Object.entries(value).flatMap(([key,item])=>typeof item==='object'?leaves(item,path+key+'.'):[[path+key,item]]); }
const english = Object.fromEntries(leaves(PAGE_STRINGS.en));
for (const lang of ['en','zh','ja','ko']) {
  const local=Object.fromEntries(leaves(PAGE_STRINGS[lang]));
  eq(lang+' v2 recursive i18n key parity',Object.keys(local).sort(),Object.keys(english).sort());
  for (const [key,value] of Object.entries(local)) {
    check(lang+' v2 nonempty '+key,typeof value==='string'&&value.trim().length>0);
    const placeholders=text=>[...text.matchAll(/\{[^}]+\}/g)].map(m=>m[0]).sort();
    eq(lang+' v2 placeholder parity '+key,placeholders(value),placeholders(english[key]));
  }
  const mdx=readFileSync(join(root,'src/content/tools/jwt-generator',lang+'.mdx'),'utf8');
  const steps=(mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1]||'').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line.trim().slice(2)));
  check(lang+' v2 has five bounded steps',steps.length===5&&steps.every(step=>[...step].length<=280)&&steps.reduce((n,step)=>n+[...step].length,0)<=1200);
  check(lang+' v2 steps are plain text with current labels',steps.every(step=>!/[<>]|\]\(|\*\*|`/.test(step))&&['algorithm','headerLabel','payloadLabel','secretLabel','copy'].every(key=>steps.join(' ').includes(PAGE_STRINGS[lang][key])));
  check(lang+' v2 usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));
  check(lang+' v2 new example is present',mdx.includes(addedExample[lang]));
  check(lang+' limits: secret whitespace rule is scoped to UTF-8 mode and Base64 ignores whitespace',mdx.includes(SECRET_WHITESPACE_LIMIT[lang]));
  check(lang+' limits: no claim that a line break can be typed into the secret',!SECRET_LINE_BREAK_CLAIM[lang].test(mdx));
  check(lang+' limits: surrogate position claim is scoped to the fields that report it',mdx.includes(SURROGATE_LIMIT[lang])&&!ANY_FIELD_SURROGATE_CLAIM[lang].test(mdx));
  eq(lang+' MDX content contract and worked examples', contractProblems('jwt-generator', lang, JWT_ANNOTATIONS), '');
  const p=pageVM(lang,false),details=p.get('jg-header-details'),pane=p.get('jg-result-pane');
  eq(lang+' v2 Header initially closed and pending token empty',[details.open,pane.getAttribute('data-empty')],[false,'true']);
  await p.waitJobs(1); await p.finish(0);
  eq(lang+' v2 signed token replaces empty state',pane.getAttribute('data-empty'),'false');
  check(lang+' v2 warning stays outside folded Header',!details.contains(p.get('jg-secret-warn'))&&p.get('jg-secret-warn').textContent.includes('19'));
  const before=p.snapshot(),count=p.jobs.length;
  details.querySelector('summary').click();check(lang+' v2 Header summary opens editor',details.open);
  details.querySelector('summary').click();eq(lang+' v2 closing Header leaves data and signing state unchanged',[details.open,p.snapshot(),p.jobs.length],[false,before,count]);
  p.input('jg-header','{"alg":"HS512","typ":"JWT"}');p.advance(500);await settle();
  eq(lang+' v2 mismatch example automatically reveals Header error',[details.open,p.get('jg-header-err').textContent,p.snapshot().token],[true,ALGO_FAILURE[lang].replace('{algo}','HS256'),'']);
  details.querySelector('summary').click();p.input('jg-header','{');p.advance(500);
  eq(lang+' v2 JSON error automatically reveals Header',[details.open,p.get('jg-header-err').textContent],[true,PAGE_STRINGS[lang].errHeaderJson]);
  p.algo('HS512');p.input('jg-header','{"alg":"HS512","typ":"JWT"}');p.input('jg-payload',JSON.stringify({text:'long-λ-'.repeat(5000)}));p.advance(500);await p.waitJobs(2);await p.finish(1);
  const long=p.snapshot();check(lang+' v2 long complete token verifies',verifies(long.token,'HS512',Buffer.from('your-256-bit-secret'),long.inputs[0],long.inputs[1]));
  eq(lang+' v2 copy keeps long token complete',p.copy().value,long.token);p.copies.at(-1).resolve();await settle();
  p.key('l','ctrlKey','jg-copy');eq(lang+' v2 clear from result focuses visible Payload and restores empty pane',[p.document.activeElement.id,pane.getAttribute('data-empty'),p.snapshot().token],['jg-payload','true','']);
}
eq('v2 engine marker bytes unchanged',sha256(source.slice(startIndex,endIndex+END_MARK.length)),'add9a68290c5f7cb2a3dd74868f0819a041658931cdb96e22f62fea953b08cc7');
check('v2 sensitive policy remains disabled',/'jwt-generator':\s*'disabled'/.test(readFileSync(join(root,'src/data/persistence.ts'),'utf8')));
check('v2 client adds no network or persistence',!/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(clientScript));
console.log('v2 page layout: '+(passes-v2Start)+' passed');

if (skips) console.log(`SKIP: ${skips} jwt-py example(s): ${pyjwtPython} with PyJWT 2.10.1 not found (set PYJWT_PYTHON)`);
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
