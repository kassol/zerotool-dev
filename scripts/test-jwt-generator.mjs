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
import { createHmac, webcrypto } from 'node:crypto';
import vm from 'node:vm';

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
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
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
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', text: '', _value: '', hidden: false, disabled: false, style: {}, checked: false }); }
    get classList() { const e = this; return { add(c) { if (!e.className.split(/\s+/).includes(c)) e.className = (e.className + ' ' + c).trim(); }, remove(c) { e.className = e.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (['id', 'class', 'type', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value);
      if (['hidden', 'checked', 'disabled'].includes(key)) this[key] = true;
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
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const text = token[0];
    if (text.startsWith('</')) { if (stack.length < 2) throw Error('Unbalanced source markup'); stack.pop(); }
    else if (text.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(text)[1], e = new Element(tag);
      for (const attr of text.matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(attr[1], attr[2]);
      for (const attr of ['hidden', 'disabled', 'readonly', 'checked']) if (new RegExp('\\s' + attr + '(?=\\s|/?>)').test(text)) e.setAttribute(attr, '');
      stack.at(-1).appendChild(e);
      if (!/\/>$/.test(text) && !['input', 'br', 'hr', 'img'].includes(tag)) stack.push(e);
    } else { const e = new Element('#text'); e.text = text; stack.at(-1).appendChild(e); }
  }
  if (stack.length !== 1) throw Error('Incomplete source markup');
  document.getElementById = id => descendants(document).find(e => e.id === id) ?? null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing actual source ID ' + id); return e; };
  const context = {
    document, console, TextEncoder, TextDecoder, atob, btoa, _slug: 'jwt-generator',
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
    key(key = 'l', modifier = 'ctrlKey', target = 'jg-header') { (target ? get(target) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy() { const before = copies.length; get('jg-copy').click(); return copies.length > before ? copies.at(-1) : null; },
    setCopyThrows(value) { copyThrows = value; },
    algo(algo) { document.querySelector('[data-algo="' + algo + '"]').click(); },
    format(fmt) { document.querySelectorAll('input[name="jg-fmt"]').forEach(e => e.checked = e.value === fmt); document.querySelector('input[name="jg-fmt"][value="' + fmt + '"]').dispatch('change'); },
    async waitJobs(count) { for (let i = 0; i < 2000 && jobs.length < count; i++) await new Promise(resolve => setTimeout(resolve, 1)); if (jobs.length < count) throw Error('Expected actual WebCrypto sign job ' + count); },
    async finish(index, outcome = 'resolve') { const job = jobs[index]; if (!job) throw Error('Missing actual sign job'); const real = await job.real; job[outcome](outcome === 'resolve' ? real : Error('controlled sign rejection')); await settle(); },
    snapshot() { return { inputs: ['jg-header','jg-payload','jg-secret'].map(id => get(id).value), token: get('jg-result').textContent, display: get('jg-result-wrap').style.display, status: get('jg-status').textContent, statusClass: get('jg-status').className, errors: ['jg-header-err','jg-payload-err','jg-secret-warn'].map(id => get(id).textContent), copy: get('jg-copy').textContent }; },
  };
}

const PAGE_STRINGS = new Function('return ' + source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/)[1])();
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
      eq(tag + ' shortcut keeps focus in visible input ' + id, p.document.activeElement.id, id === 'jg-copy' ? 'jg-header' : id);
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


console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
