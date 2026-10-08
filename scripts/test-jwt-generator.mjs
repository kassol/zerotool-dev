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
// 4-language STRINGS keys.
//
// Run: node scripts/test-jwt-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac, createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

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
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing actual source ID ' + id); return e; };
  const context = {
    document, console, TextEncoder, TextDecoder, atob, btoa, _slug: 'jwt-generator',
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
    get, document, copies, clears, tracks, timers, jobs, advance,
    input(id, value) { get(id).value = value; get(id).dispatch('input'); },
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
  ]) {
    const p = await populated(); if (name === 'invalid Base64') p.format('base64'); p.input(id,value); p.advance(500); await settle();
    eq(tag + ' ' + name + ' visible localized validation', p.get(errorId).textContent, error);
    eq(tag + ' ' + name + ' never starts another signing job', p.jobs.length, 1);
    eq(tag + ' ' + name + ' preserves typed text', p.get(id).value, value);
    eq(tag + ' ' + name + ' erases stale token and copy data', [p.snapshot().token,p.snapshot().display,p.copy()], ['', 'none', null]);
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
    eq(tag + ' current sign failure is visible and old token erased', [p.snapshot().status,p.snapshot().statusClass,p.snapshot().token,p.snapshot().display], ['Error: controlled sign rejection','jg-status error','','none']);
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
await settle(); eq('all page Promise rejections handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);
console.log('real page lifecycle: ' + (passes - pageStart) + ' passed');


// ---------- v2 page layout ----------
const v2Start = passes;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const addedExample = {
  en: '<p>Editing Header alg to HS512 while HS256 remains selected shows an error and clears the previous token.</p>',
  zh: '<p>例如，所选算法仍为 HS256 时，把 Header 的 alg 改为 HS512，会显示错误并清除旧 Token。</p>',
  ja: '<p>例えば、選択を HS256 のままヘッダーの alg を HS512 に変えると、エラーを表示して以前のトークンを消します。</p>',
  ko: '<p>예를 들어 HS256을 선택한 상태에서 헤더의 alg를 HS512로 바꾸면 오류를 표시하고 이전 토큰을 지웁니다.</p>',
};
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
check('v2 direct root is a flex column with zero minimum height', /^<div class="jg-wrap">/.test(markup) && /\.jg-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(css));
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
  eq(lang+' MDX content contract', contractProblems('jwt-generator', lang), '');
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
