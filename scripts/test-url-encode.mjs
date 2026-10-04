// URL Encode / Decode — page script against a stand-in DOM
//
// Read:  src/components/tools/UrlEncodeTool.astro (runs the inline page script against a small
//        stand-in for the elements it reads), src/content/tools/url-encode/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: encode / decode through the debounced input handler; Swap moves the result into the input box
// and switches the mode (it used to keep the mode and encode the result a second time); a decode error clears the old result instead of leaving it next to the
// error; errors give the position and cause in the page language (they used to be the browser's
// English "URI malformed"): a bad %, a byte run that is not UTF-8, a lone surrogate; decoding
// agrees with decodeURIComponent on 3,000 random inputs (same result or both fail); the Space as +
// option encodes like URLSearchParams and decodes + as a space; 4-language STRINGS share keys;
// every example row on the English page is the output of the same built-ins.
//
// Run: node scripts/test-url-encode.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UrlEncodeTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/url-encode/en.mdx'), 'utf8');
const scriptMatch = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(source);
const STR = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/)[1])();
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in UrlEncodeTool.astro');
  process.exit(1);
}

function makePage() {
  const els = {};
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', checked: false, textContent: '', className: '', placeholder: '',
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
        getAttribute() { return null; },
        setAttribute() {},
      };
    }
    return els[id];
  }
  // a radio group: checking one unchecks the others, as in the browser
  let checkedValue = 'encode';
  const radios = ['encode', 'decode'].map((v) => {
    const r = el('radio-' + v);
    r.value = v;
    Object.defineProperty(r, 'checked', {
      get() { return checkedValue === v; },
      set(on) { if (on) checkedValue = v; else if (checkedValue === v) checkedValue = null; },
    });
    return r;
  });
  const document = {
    documentElement: { lang: 'en' },
    addEventListener() {},
    getElementById: el,
    querySelectorAll(sel) { return sel === 'input[name="urlmode"]' ? radios : []; },
    querySelector(sel) {
      if (sel === 'input[name="urlmode"]:checked') return radios.find((r) => r.checked) || null;
      const m = /\[value="(\w+)"\]/.exec(sel);
      return m ? radios.find((r) => r.value === m[1]) : null;
    },
  };
  const timers = new Map(); let timerID = 0;
  const client = Object.fromEntries(Object.entries(STR.en).filter(([key]) => key !== 'tips'));
  new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', 't', scriptMatch[1])(
    document, {}, {}, (fn, ms) => { const id=++timerID;timers.set(id,{fn,ms});return id; }, id => timers.delete(id), client);
  return {
    el,
    run(text) { el('url-input').value = text; el('url-input').fire('input'); for (const [id,timer] of timers) if (timer.ms===300) { timers.delete(id);timer.fn(); } return el('url-output').value; },
    setMode(m) { radios.forEach((r) => { r.checked = r.value === m; }); radios.find((r) => r.value === m).fire('change'); },
    mode() { return radios.find((r) => r.checked).value; },
  };
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

// encode and decode through the actual input handler
let p = makePage();
eq('encode café', p.run('café & tea'), 'caf%C3%A9%20%26%20tea');
p.setMode('decode');
eq('decode', p.run('a%2Bb'), 'a+b');
eq('decode leaves +', p.run('a+b%20c'), 'a+b c');

// swap switches the mode
p = makePage();
const encoded = p.run('東京 2026');
p.el('url-swap').fire('click');
eq('swap: mode switches to decode', p.mode(), 'decode');
eq('swap: input holds the result', p.el('url-input').value, encoded);
eq('swap: output label follows the mode', p.el('url-output-label-text').textContent, 'Decoded URL');
p.run(p.el('url-input').value);
eq('swap then run decodes back', p.el('url-output').value, '東京 2026');
p.el('url-swap').fire('click');
eq('swap again: mode back to encode', p.mode(), 'encode');

// decode error clears the old result
p = makePage();
p.setMode('decode');
p.run('a%20b');
eq('decode before error', p.el('url-output').value, 'a b');
p.run('100%');
eq('error clears output', p.el('url-output').value, '');
// Errors name the position and the cause in the page language (they used to be the browser's
// English "URI malformed")
eq('error: lone %', p.el('url-status').textContent, 'Position 4: "%" must be followed by two hexadecimal digits ("%").');
p.run('%zz');
eq('error: %zz', p.el('url-status').textContent, 'Position 1: "%" must be followed by two hexadecimal digits ("%zz").');
p.run('%E4%B8');
eq('error: cut UTF-8', p.el('url-status').textContent, 'Position 1: %E4%B8 is not valid UTF-8. Text saved in GBK, Shift_JIS or EUC-KR cannot be decoded here.');
p.run('ok%E4%B8%ADx%C4%E3');
eq('error: GBK after valid text', p.el('url-status').textContent, 'Position 13: %C4%E3 is not valid UTF-8. Text saved in GBK, Shift_JIS or EUC-KR cannot be decoded here.');
p.setMode('encode');
p.run('a\uD83D b');
eq('error: lone surrogate', p.el('url-status').textContent, 'Position 2: a lone surrogate (half of an emoji or other character) cannot be encoded.');
eq('error: lone surrogate clears output', p.el('url-output').value, '');

// decoding agrees with decodeURIComponent wherever that succeeds
p.setMode('decode');
let seed = 11;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pieces = ['a', ' ', '+', '%20', '%2B', '%E4%B8%AD', '%F0%9F%98%80', '%EF%BB%BF', '%41', '%e4%b8%ad', '%C4', '%zz', '%', '~', '中'];
let agree = true;
for (let i = 0; i < 3000 && agree; i++) {
  const text = Array.from({ length: 1 + rand(6) }, () => pieces[rand(pieces.length)]).join('');
  let want = null;
  try { want = decodeURIComponent(text); } catch { want = null; }
  const got = p.run(text);
  const failed = p.el('url-status').className.includes('error');
  if (want === null ? !failed : got !== want) { agree = false; eq('agrees with decodeURIComponent: ' + text, failed ? 'error' : got, want); }
}
if (agree) passes++;

// + as space (application/x-www-form-urlencoded, as URLSearchParams)
p = makePage();
p.el('url-plus').checked = true;
p.el('url-plus').fire('change');
eq('form encode', p.run('a b+c'), 'a+b%2Bc');
eq('form encode matches URLSearchParams', p.run("Zoë O'Brien (admin)!*~"), new URLSearchParams([['', "Zoë O'Brien (admin)!*~"]]).toString().slice(1));
p.setMode('decode');
eq('form decode', p.run('a+b%20c%2B'), 'a b c+');
p.el('url-plus').checked = false;
p.el('url-plus').fire('change');
eq('plus kept when the option is off', p.run('a+b'), 'a+b');
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' keys', JSON.stringify(Object.keys(STR[lang]).sort()), JSON.stringify(Object.keys(STR.en).sort()));
eq('page no longer says there is no + option', page.includes('There is no option for + as space'), false);

// English page examples
const rows = [
  ['encode', 'https://example.com/search?q=café & tea#top'],
  ['encode', '東京 2026'],
  ['encode', '😀'],
  ['encode', "Zoë O'Brien (admin)!*~"],
  ['decode', 'a%2Bb'],
  ['decode', 'a+b%20c'],
];
for (const [mode, input] of rows) {
  const out = mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input);
  p = makePage();
  p.setMode(mode);
  eq('page example ' + input, p.run(input), out);
  const shown = (s) => page.includes('<code>' + s.replace(/&/g, '&amp;') + '</code>') || page.includes('<code>{"' + s + '"}</code>');
  eq('page shows input ' + input, shown(input), true);
  eq('page shows output ' + out, shown(out), true);
}
eq('page double-encoding example', encodeURIComponent(encodeURIComponent('a b')), 'a%2520b');


// ---------- actual page lifecycle and shared keyboard handler ----------
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw Error('Missing actual shared keyboard handler');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const same = (name, actual, expected) => eq(name, JSON.stringify(actual), JSON.stringify(expected));
function pageVM(lang = 'en', shellFirst = false, savedInput = '', restoredMode = 'encode') {
  const SLUG = 'url-encode';
  const ids = new Map(), copies = [], clears = [], saves = [], docEvents = {}, timers = new Map();
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function simple(e, sel) {
    if (sel.includes(':checked') && !e.checked) return false;
    sel = sel.replace(':checked', '');
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    sel = sel.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(sel), id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      for (let n = e.parentElement; parts.length;) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: tag === 'input' ? 'text' : '', value: '', textContent: '', checked: false, readOnly: false, disabled: false, attributes: {}, children: [], parentElement: null, listeners: {} });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (['id', 'type', 'value', 'class'].includes(k)) this[k === 'class' ? 'className' : k] = String(v);
      if (k === 'readonly') this.readOnly = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'checked') this.checked = true;
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return {
        contains: k => e.className.split(/\s+/).includes(k),
        add(...keys) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove(...keys) { e.className = e.className.split(/\s+/).filter(k => k && !keys.includes(k)).join(' '); },
        toggle(k, on) { const want = on ?? !this.contains(k); if (want) this.add(k); else this.remove(k); return want; },
      };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const event = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, event);
      return event;
    }
    click() {
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      if (this.type === 'radio') { for (const radio of body.querySelectorAll('input[type="radio"]')) if (radio.getAttribute('name') === this.getAttribute('name')) radio.checked = radio === this; }
      this.dispatch('click');
      if (this.type === 'checkbox' || this.type === 'radio') this.dispatch('change');
    }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const escapeHTML = text => String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g,'')
    .replace(/=\{T\.(\w+)\}/g,(_,key)=>'="'+escapeHTML(STR[lang][key])+'"')
    .replace(/\{T\.(\w+)\}/g,(_,key)=>escapeHTML(STR[lang][key]));
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    const tag = token[1];
    if (token[0].startsWith('</')) {
      if (stack.at(-1)?.tagName !== tag.toUpperCase()) throw new Error('Markup nesting mismatch ' + tag);
      stack.pop(); continue;
    }
    const e = new Element(tag);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) e.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(e);
    if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !token[2].endsWith('/')) stack.push(e);
  }
  for (const select of body.querySelectorAll('select')) {
    const options = select.querySelectorAll('option');
    select.value = (options.find(o => o.getAttribute('selected') !== null) || options[0])?.value || '';
  }
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra) {
      const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of docEvents[t] || []) fn.call(this, e);
      return e;
    },
  });
  const context = {
    document: doc, console, TextDecoder, TextEncoder, URLSearchParams, _slug: SLUG,
    t: Object.fromEntries(Object.entries(STR[lang]).filter(([key])=>key!=='tips')),
    ztPersist: { load: () => ({input: savedInput}), save: (slug, value) => saves.push({slug, value: JSON.parse(JSON.stringify(value))}), clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  for (const radio of body.querySelectorAll('input[name="urlmode"]')) radio.checked = radio.value === restoredMode;
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: SLUG + '.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    doc, body, get, copies, clears, saves, context, timers,
    input(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
    key(focus, { key = 'l', ctrlKey = true, metaKey = false } = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      return doc.dispatch('keydown', { key, ctrlKey, metaKey });
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

const textLabels = {
  en: ['Copy', 'Copied!', 'Could not copy. Please select and copy the output manually.'],
  zh: ['复制', '已复制！', '复制失败。请选中输出内容后手动复制。'],
  ja: ['コピー', 'コピー済み！', 'コピーできませんでした。出力を選択して手動でコピーしてください。'],
  ko: ['복사', '복사됨!', '복사하지 못했습니다. 출력을 선택하여 직접 복사하세요.'],
};
const snapshot = p => [p.get('url-input').value,p.get('url-output').value,p.get('url-status').textContent,p.get('url-status').className,p.get('url-copy').textContent];
function modeRadio(p, mode) { return p.doc.querySelector('input[name="urlmode"][value="' + mode + '"]'); }
function resultPage(lang, order = false) { const p=pageVM(lang,order);p.input('url-input','a b+世界');p.advance(300);return p; }
const unhandled=[];const onUnhandled=e=>unhandled.push(String(e));process.on('unhandledRejection',onUnhandled);
for (const [lang,labels] of Object.entries(textLabels)) {
  const p=pageVM(lang);p.input('url-input','a b+世界');p.advance(299);eq(lang+': waits for 300ms conversion',p.get('url-output').value,'');p.advance(1);
  eq(lang+': live UTF8 conversion',p.get('url-output').value,encodeURIComponent('a b+世界'));
  p.advance(199);eq(lang+': save waits for 500ms',p.saves.length,0);p.advance(1);same(lang+': save shape and timing',p.saves,[{slug:'url-encode',value:{input:'a b+世界'}}]);
  p.input('url-input','');p.advance(300);same(lang+': empty live clears output/status',[p.get('url-output').value,p.get('url-status').textContent],['','']);
  p.get('url-copy').click();eq(lang+': empty output never copies',p.copies.length,0);
  const restored=pageVM(lang,false,'saved & text');eq(lang+': saved input is restored',restored.get('url-input').value,'saved & text');
  for(const order of [false,true]) for(const mod of [{ctrlKey:true},{ctrlKey:false,metaKey:true}]) {
    const q=resultPage(lang,order),before=snapshot(q);q.key(q.body);same(lang+': outside shortcut preserves tool',snapshot(q),before);
    q.input('url-input','pending &');q.key('url-output',{key:'L',...mod});q.advance(1000);
    same(lang+': CtrlL clears and cancels live/save '+order,[snapshot(q),q.saves,q.clears],[['','','','url-status',labels[0]],[],['url-encode']]);
    eq(lang+': CtrlL leaves mode selected',modeRadio(q,'encode').checked,true);
    q.input('url-input','next');q.advance(300);eq(lang+': new input works after clear',q.get('url-output').value,'next');
  }
  {
    const q=resultPage(lang);q.input('url-input','pending');q.get('url-clear').click();q.advance(1000);
    same(lang+': Clear removes pending save and conversion',[snapshot(q),q.saves,q.clears],[['','','','url-status',labels[0]],[],['url-encode']]);
  }
  {
    const q=resultPage(lang);q.input('url-input','pending &');q.get('url-swap').click();const before=snapshot(q);q.advance(1000);
    same(lang+': Swap stays exchanged after queued conversion',snapshot(q),before);eq(lang+': Swap cancels pending save',q.saves.length,0);eq(lang+': Swap toggles mode',modeRadio(q,'decode').checked,true);
  }
  for(const kind of ['reject','throw','missing']) {
    const q=resultPage(lang),original=q.context.navigator.clipboard;let thrown=null;
    if(kind==='throw')q.context.navigator.clipboard={writeText(){throw Error('denied');}};
    if(kind==='missing')q.context.navigator.clipboard=undefined;
    try{q.get('url-copy').click();if(kind==='reject')q.copies.at(-1).reject(Error('denied'));}catch(e){thrown=String(e);}await settle();
    eq(lang+': '+kind+' remains in handler',thrown,null);same(lang+': localized current failure '+kind,[q.get('url-status').textContent,q.get('url-status').className],[labels[2],'url-status error']);
    q.context.navigator.clipboard=original;q.get('url-copy').click();eq(lang+': complete copy value',q.copies.at(-1).value,encodeURIComponent('a b+世界'));q.copies.at(-1).resolve();await settle();
    same(lang+': direct retry clears own error',[q.get('url-status').textContent,q.get('url-copy').textContent],['',labels[1]]);
  }
  function boundary(q,kind) {
    if(kind==='clear')q.get('url-clear').click();
    else if(kind==='ctrlL')q.key('url-input');
    else if(kind==='input')q.input('url-input','new');
    else if(kind==='result'){q.input('url-input','new &');q.advance(300);}
    else if(kind==='error'){modeRadio(q,'decode').click();q.input('url-input','%zz');q.advance(300);}
    else if(kind==='mode')modeRadio(q,'decode').click();
    else if(kind==='plus')q.get('url-plus').click();
    else q.get('url-swap').click();
  }
  for(const kind of ['clear','ctrlL','input','result','error','mode','plus','swap']) {
    for(const outcome of ['resolve','reject']) {
      const q=resultPage(lang);q.get('url-copy').click();const job=q.copies.at(-1);boundary(q,kind);const before=snapshot(q);
      job[outcome](outcome==='reject'?Error('late'):undefined);await settle();same(lang+': late '+outcome+' after '+kind,snapshot(q),before);
    }
    const q=resultPage(lang);q.get('url-copy').click();q.copies.at(-1).resolve();await settle();const timer=[...q.timers.values()].find(t=>t.due===1800);boundary(q,kind);const before=snapshot(q);
    eq(lang+': '+kind+' invalidates Copied immediately',q.get('url-copy').textContent,labels[0]);timer.fn();same(lang+': queued timer after '+kind,snapshot(q),before);
  }
  {
    const q=resultPage(lang);q.input('url-input','new &');q.get('url-copy').click();const job=q.copies.at(-1);eq(lang+': debounce copy uses displayed output',job.value,encodeURIComponent('a b+世界'));q.advance(300);const before=snapshot(q);job.resolve();await settle();same(lang+': debounce result invalidates prior copy',snapshot(q),before);
    q.get('url-copy').click();q.copies.at(-1).resolve();await settle();const old=[...q.timers.values()].find(t=>t.ms===1500);q.advance(500);q.get('url-copy').click();q.copies.at(-1).resolve();await settle();old.fn();eq(lang+': queued old timer keeps newer feedback',q.get('url-copy').textContent,labels[1]);q.advance(1000);eq(lang+': old deadline keeps newer feedback',q.get('url-copy').textContent,labels[1]);q.advance(499);eq(lang+': feedback lasts full interval',q.get('url-copy').textContent,labels[1]);q.advance(1);eq(lang+': latest feedback expires',q.get('url-copy').textContent,labels[0]);
    q.get('url-copy').click();const older=q.copies.at(-1);q.get('url-copy').click();q.copies.at(-1).reject(Error('current'));await settle();const failed=snapshot(q);older.resolve();await settle();same(lang+': old success cannot erase new failure',snapshot(q),failed);
    q.get('url-copy').click();const oldFailure=q.copies.at(-1);q.get('url-copy').click();q.copies.at(-1).resolve();await settle();const success=snapshot(q);oldFailure.reject(Error('old'));await settle();same(lang+': old rejection cannot erase new success',snapshot(q),success);
  }
}
eq('engine bytes preserved',createHash('sha256').update(source.slice(source.indexOf('/* ── engine:start ── */'),source.indexOf('/* ── engine:end ── */')+'/* ── engine:end ── */'.length)).digest('hex'),'81b60383d4b792e452c5fb6af02c47b21c95dbdd83c9ba0171abfa2fd23e1bbf');
same('all clipboard rejections handled',unhandled,[]);process.off('unhandledRejection',onUnhandled);
// ---------- v2 page layout ----------
const v2Start=passes;
const require=createRequire(import.meta.url),astroRequire=createRequire(require.resolve('astro'));
const {transform}=astroRequire('@astrojs/compiler');
const compiled=await transform(source,{filename:'UrlEncodeTool.astro'});
await require('esbuild').transform(compiled.code,{loader:'ts'});
eq('v2 Astro compiled JS parses',true,true);
const markup=source.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0],css=source.match(/<style>([\s\S]*?)<\/style>/)[1];
eq('v2 root direct flex column',/^<div class="url-wrap">/.test(markup)&&/\.url-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css),true);
eq('v2 shared two panes',(markup.match(/zt-io-pane/g)||[]).length,2);
eq('v2 shared fill editors',(markup.match(/zt-io-fill/g)||[]).length,2);
eq('v2 controls, fixed status, panels order',markup.indexOf('url-controls')<markup.indexOf('id="url-status"')&&markup.indexOf('id="url-status"')<markup.indexOf('url-panels'),true);
eq('v2 fixed status scrolls',/\.url-status\s*\{[^}]*height: 2\.8em;[^}]*overflow: auto/.test(css),true);
eq('v2 bounded mobile boxes and empty output hidden',/@media \(max-width: 860px\)[\s\S]*?\.url-output-row\[data-empty="true"\] \{ display: none; \}/.test(css)&&/\.url-box \{ height: 120px;/.test(css),true);
eq('v2 no manual execution button',!/url-run|runBtn|btn-primary/.test(source),true);
eq('v2 no runtime label table',!/data-i18n|var STRINGS|pageLang/.test(source),true);
eq('v2 labels have no interactive descendants',[...markup.matchAll(/<label\b[\s\S]*?<\/label>/g)].every(m=>!/<Toggletip|<button/.test(m[0])),true);
eq('v2 excludes tips from client',source.includes('const { tips: TIPS, ...CLIENT_T } = T;')&&source.includes('define:vars={{ t: CLIENT_T }}'),true);
eq('v2 registered convert',/'url-encode':\s*'convert'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')),true);
const tips=['mode','input','plus','swap','clear','copy'];same('v2 six tips on real controls',[...markup.matchAll(/<Toggletip id="url-tip-([^"]+)"/g)].map(m=>m[1]).sort(),tips.toSorted());
const protection={
  "en": "d59713ac4b021467020e012553322dd1ef2d26bab65e273cfc720a6d8e85454e",
  "zh": "871e2f4695f4714d457fa8ee6b087ed68f163429e2ed6ca0b8824e9d215aa6ad",
  "ja": "5b7a6ad01e4839a0bd12428c883aa9bdc2c953a24bbf093ff671b5196988384e",
  "ko": "194d19e2e9ed20423389882aa87922e84e73c2a9a4cc69cbde9a1245fd2f7f3b"
};
const hash=text=>createHash('sha256').update(text).digest('hex');
for(const lang of Object.keys(textLabels)){
 same(lang+': v2 tips same keys',Object.keys(STR[lang].tips).sort(),tips.toSorted());
 for(const tip of tips)eq(lang+': v2 '+tip+' tip plain nonempty',typeof STR[lang].tips[tip]==='string'&&STR[lang].tips[tip].length>20&&!/[<>]|https?:/.test(STR[lang].tips[tip]),true);
 const doc=readFileSync(join(root,'src/content/tools/url-encode/'+lang+'.mdx'),'utf8'),fm=doc.match(/^---\n([\s\S]*?)\n---/)[1];
 const steps=require('js-yaml').load(fm).steps;
 eq(lang+': v2 six bounded steps',steps.length===6&&steps.every(s=>s.length<=280&&!/[<>]/.test(s))&&steps.join('').length<=1200,true);
 eq(lang+': v2 preserves non-Usage MDX',hash(doc.replace(/^steps:\n(?:  .*\n)*/m,'')),protection[lang]);
 await (await import('@mdx-js/mdx')).compile(doc.replace(/^---[\s\S]*?---\s*/,''));eq(lang+': v2 MDX compiles',true,true);
 const q=pageVM(lang);
 eq(lang+': v2 input label rendered before scripts',q.get('url-input-label').textContent,STR[lang].plainUrlLabel);
 eq(lang+': v2 initial empty state',q.get('url-output-row').getAttribute('data-empty'),'true');
 q.input('url-input','a%20b');q.advance(300);modeRadio(q,'decode').click();eq(lang+': v2 direction immediately converts',q.get('url-output').value,'a b');eq(lang+': v2 nonempty state',q.get('url-output-row').getAttribute('data-empty'),'false');
 q.input('url-input','pending%20new');modeRadio(q,'encode').click();const before=snapshot(q);q.advance(300);same(lang+': v2 mode cancels queued conversion',snapshot(q),before);
 const noPrimary=snapshot(q);q.key('url-input',{key:'Enter'});same(lang+': v2 CtrlEnter has no duplicate action',snapshot(q),noPrimary);
 q.input('url-input','');q.advance(300);eq(lang+': v2 cleared output hides',q.get('url-output-row').getAttribute('data-empty'),'true');modeRadio(q,'decode').click();q.input('url-input','%zz');q.advance(300);eq(lang+': v2 error hides empty output',q.get('url-output-row').getAttribute('data-empty'),'true');
 q.input('url-input','a+b');q.advance(300);q.get('url-plus').click();eq(lang+': v2 plus immediately converts',q.get('url-output').value,'a b');
 const restored=pageVM(lang,false,'a%20b','decode');eq(lang+': v2 restored mode and input calculate',restored.get('url-output').value,'a b');eq(lang+': v2 restoration adds no writes',restored.saves.length,0);
}
console.log('v2 page layout: '+(passes-v2Start)+' passed');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
