// Hash Generator — MD5 implementation and the values quoted on the English page
//
// Read:  src/components/tools/HashGeneratorTool.astro (extracts the page's md5() function),
//        src/content/tools/hash-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: md5() equals node:crypto MD5 of the TextEncoder bytes for 3,000 random strings that mix
// ASCII, CJK, emoji and lone surrogates (the old hand-written UTF-8 step encoded a lone surrogate
// differently from TextEncoder, so the MD5 row and the SHA rows hashed different bytes); RFC 1321
// test vectors; every hash quoted on the English page, recomputed with node:crypto.
//
// Run: node scripts/test-hash-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HashGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/hash-generator/en.mdx'), 'utf8');
const start = source.indexOf('function md5(str)');
const end = source.indexOf('async function sha');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate md5() in HashGeneratorTool.astro');
  process.exit(1);
}
const md5 = new Function(source.slice(start, end) + '\nreturn md5;')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
const hex = (algo, bytes) => createHash(algo).update(Buffer.from(bytes)).digest('hex');
const utf8 = (s) => new TextEncoder().encode(s);

// RFC 1321 appendix A.5
for (const [input, want] of [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
]) eq('RFC 1321 ' + JSON.stringify(input), md5(input), want);

// random strings, including lone surrogates
const pool = ['a', 'Z', ' ', '\n', 'é', '中', '文', '😀', '👨‍👩‍👧', '\ud800', '\udfff', '\ud83d', '\u0000', '\u07ff', '\uffff'];
let seed = 12345;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let mismatches = 0;
for (let i = 0; i < 3000; i++) {
  let s = '';
  const len = rand(80);
  for (let j = 0; j < len; j++) s += pool[rand(pool.length)];
  if (md5(s) !== hex('md5', utf8(s))) mismatches++;
}
eq('md5 equals node:crypto on TextEncoder bytes (3,000 strings)', mismatches, 0);
eq('lone surrogate hashed as EF BF BD', md5('a\ud800b'), hex('md5', [0x61, 0xef, 0xbf, 0xbd, 0x62]));

// values on the English page
const quoted = (v) => page.includes('`' + v + '`');
for (const algo of ['md5', 'sha1', 'sha256', 'sha384', 'sha512']) {
  eq('page: ' + algo + ' of hello', quoted(hex(algo, utf8('hello'))), true);
}
eq('page: md5 of hello via page function', quoted(md5('hello')), true);
eq('page: sha256 of hello + LF', page.includes(hex('sha256', utf8('hello\n'))), true);
eq('page: sha256 of empty string', quoted(hex('sha256', [])), true);
eq('page: 你好 UTF-8 bytes', page.includes('`e4 bd a0 e5 a5 bd`'), Buffer.from(utf8('你好')).toString('hex') === 'e4bda0e5a5bd');
eq('page: 你好 md5', quoted(md5('你好')), true);
eq('page: 你好 sha256', quoted(hex('sha256', utf8('你好'))), true);
eq('page: 你好 GBK md5', quoted(hex('md5', [0xc4, 0xe3, 0xba, 0xc3])), true);
eq('page: hello with BOM', quoted(hex('sha256', [0xef, 0xbb, 0xbf, ...utf8('hello')])), true);
eq('page: git blob id', quoted(hex('sha1', utf8('blob 6\0hello\n'))), true);
eq('page: plain sha1 of hello + LF', quoted(hex('sha1', utf8('hello\n'))), true);

// Actual page lifecycle: native WebCrypto bytes with controlled promise delivery.
const require = createRequire(import.meta.url);
const { parseFragment, defaultTreeAdapter } = require('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const must = (ok, message) => { if (!ok) throw Error('Harness prerequisite: ' + message); };
must(shortcut.includes("widget.querySelectorAll('textarea"), 'actual ToolLayout shortcut');
const scriptOf = text => /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(text)[1];
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
const same = (name, actual, expected) => eq(name, JSON.stringify(actual), JSON.stringify(expected));

const strings = vm.runInNewContext(source.slice(source.indexOf('const STRINGS ='), source.indexOf('const T = STRINGS[lang]')).replace(/\bas const\b/g, '') + '\nSTRINGS;');
const escapeHTML = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function pageVM(lang = 'en', shellFirst = false) {
  const key = 'hash';
  const clipboard = [], digests = [], timers = new Map(), tracks = [];
  let timerId = 0, now = 0, doc;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const matchOne = (el, selector) => {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchOne(parent, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  };
  const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
  class EventStub {
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return this.querySelector('option')?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true; }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (matches(el, selector)) return el; return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentNode) {
        event.currentTarget = el;
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
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
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget);
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  widget.innerHTML = markup.replace(/\{T\.([\w]+)\}/g, (_, key) => escapeHTML(strings[lang][key])).replace(/\{TIPS\.([\w]+)\}/g, (_, key) => escapeHTML(strings[lang].tips[key]));
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  doc.activeElement = doc.body;
  doc.execCommand = () => { throw Error('Forbidden unexpected execCommand'); };
  const sandbox = {
    document: doc, console, TextEncoder, TextDecoder, Event: EventStub,
    t: Object.fromEntries(Object.entries(strings[lang]).filter(([key]) => key !== 'tips')),
    _slug: 'hash-generator', ztPersist: { clear() {} }, trackTool(...args) { tracks.push(args); },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: {
      writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); clipboard.push({ value: String(value), resolve, reject }); return promise; },
      write() { throw Error('Forbidden unexpected clipboard.write'); },
    } },
    crypto: { subtle: { digest(algorithm, bytes) {
      const snapshot = Uint8Array.from(bytes); let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      digests.push({ algorithm, text: new TextDecoder().decode(snapshot), real: webcrypto.subtle.digest(algorithm, snapshot), resolve, reject, released: false });
      return promise;
    } } },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(scriptOf(source), context, { filename: 'HashGeneratorTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  const get = id => { const el = doc.getElementById(id); must(el, key + ' source ID ' + id); return el; };
  return {
    key, doc, widget, get, clipboard, digests, timers, tracks, context,
    input(id, text) { get(id).value = text; get(id).dispatch('input'); },
    ctrlL(id) { get(id).focus(); get(id).dispatch('keydown', { key: 'l', ctrlKey: true }); },
    advance(ms) { const target = now + ms; for (;;) { const next = [...timers].filter(([,t]) => t.due <= target).sort((a,b) => a[1].due-b[1].due || a[0]-b[0])[0]; if (!next) break; now=next[1].due; timers.delete(next[0]); next[1].fn(); } now=target; },
    flush(ms) { for (const [id, job] of [...timers]) if (job.ms === ms) { timers.delete(id); job.fn(); } },
    fire(id) { const job = timers.get(id); must(job, 'real timer ' + id); timers.delete(id); job.fn(); },
    async finishHash(text) {
      for (const algorithm of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) {
        const job = digests.find(job => job.text === text && job.algorithm === algorithm && !job.released);
        must(job, 'pending real digest ' + text + '/' + algorithm);
        job.released = true; job.resolve(await job.real); await settle();
      }
    },
    async rejectHash(text) { const job = digests.find(job => job.text === text && !job.released); must(job, 'pending digest to reject'); await job.real; job.released = true; job.reject(Error('probe digest denied')); await settle(); },
  };
}

const labels = {
  en:{ copy:'Copy',copied:'Copied!',success:'Hashes generated.',empty:'Please enter some text.',failure:'Could not copy. Please select the hash and copy it manually.' },
  zh:{ copy:'复制',copied:'已复制！',success:'哈希已生成。',empty:'请输入文本。',failure:'复制失败。请选中哈希值后手动复制。' },
  ja:{ copy:'コピー',copied:'コピー済み！',success:'ハッシュが生成されました。',empty:'テキストを入力してください。',failure:'コピーできませんでした。ハッシュを選択して手動でコピーしてください。' },
  ko:{ copy:'복사',copied:'복사됨!',success:'해시가 생성되었습니다.',empty:'텍스트를 입력해 주세요.',failure:'복사하지 못했습니다. 해시를 선택하여 직접 복사하세요.' },
};
const expected = text => ['MD5','SHA-1','SHA-256','SHA-384','SHA-512'].map(name=>[name,createHash(name.toLowerCase().replace('-','')).update(text).digest('hex')]);
const rows = p => p.get('hg-results').querySelectorAll('.hg-row').map(row=>[row.querySelector('.hg-label').textContent,row.querySelector('.hg-value').textContent]);
const buttons = p => p.get('hg-results').querySelectorAll('.btn-copy');
const state = p => ({input:p.get('hg-input').value,rows:rows(p),status:p.get('hg-status').textContent,statusClass:p.get('hg-status').className,copy:buttons(p).map(b=>b.textContent)});
async function generated(lang='en',shellFirst=false,text='A世界😀') {const p=pageVM(lang,shellFirst);p.input('hg-input',text);p.get('hg-hash').click();await p.finishHash(text);return p;}
function boundary(p,kind){if(kind==='clear')p.get('hg-clear').click();else if(kind==='ctrlL')p.ctrlL('hg-input');else if(kind==='input')p.input('hg-input','NEXT');else if(kind==='empty'){p.input('hg-input','');p.get('hg-hash').click();}else{p.input('hg-input','NEXT');p.get('hg-hash').click();}}
for(const [lang,T] of Object.entries(labels)){
  const p=await generated(lang);same(lang+': five actual digests',rows(p),expected('A世界😀'));eq(lang+': localized success',p.get('hg-status').textContent,T.success);eq(lang+': one tracking event',p.tracks.length,1);
  p.input('hg-input','manual');same(lang+': edits preserve completed manual result',rows(p),expected('A世界😀'));eq(lang+': typing does not compute',p.digests.length,4);
  p.get('hg-input').focus();p.get('hg-input').dispatch('keydown',{key:'Enter',ctrlKey:true});await p.finishHash('manual');same(lang+': CtrlEnter generates once',rows(p),expected('manual'));eq(lang+': two requested generations',p.tracks.length,2);
  p.input('hg-input','');p.get('hg-hash').click();same(lang+': empty Generate clears old rows',[rows(p),p.get('hg-status').textContent],[[],T.empty]);
  for(const order of [false,true]){
    const q=await generated(lang,order);const before=state(q);q.doc.body.dispatch('keydown',{key:'l',ctrlKey:true});same(lang+': outside CtrlL does not change page',state(q),before);q.ctrlL('hg-input');same(lang+': idle CtrlL clears result '+order,[q.get('hg-input').value,rows(q),q.get('hg-status').textContent],['',[],'']);
    for(const kind of ['clear','ctrlL','input','empty','next'])for(const outcome of ['resolve','reject']){
      const r=pageVM(lang,order);r.input('hg-input','OLD');r.get('hg-hash').click();boundary(r,kind);if(kind==='next')await r.finishHash('NEXT');const before=state(r);
      if(outcome==='resolve')await r.finishHash('OLD');else await r.rejectHash('OLD');same(`${lang}: late digest ${outcome}/${kind}/${order}`,state(r),before);eq(lang+': one tracking event only for current result',r.tracks.length,kind==='next'?1:0);
    }
  }
  for(const algorithm of ['SHA-1','SHA-256','SHA-384','SHA-512']){
    const q=pageVM(lang);q.input('hg-input','failure');q.get('hg-hash').click();
    for(const name of ['SHA-1','SHA-256','SHA-384','SHA-512']){const job=q.digests.find(j=>j.algorithm===name&&!j.released);must(job,'current digest');job.released=true;if(name===algorithm){await job.real;job.reject(Error('digest denied'));await settle();break;}job.resolve(await job.real);await settle();}
    same(lang+': current '+algorithm+' error clears rows',[rows(q),q.get('hg-status').textContent,q.get('hg-status').className],[[],'Error: digest denied','hg-status error']);
    q.get('hg-hash').click();await q.finishHash('failure');same(lang+': failed digest retry succeeds',rows(q),expected('failure'));
  }
  for(let index=0;index<5;index++){
    const q=await generated(lang),b=buttons(q)[index];b.click();eq(`${lang}/${index}: exact copy`,q.clipboard.at(-1).value,expected('A世界😀')[index][1]);q.clipboard.at(-1).resolve();await settle();eq(lang+': copy succeeded',b.textContent,T.copied);q.advance(1499);eq(lang+': full feedback duration',b.textContent,T.copied);q.advance(1);eq(lang+': feedback ends',b.textContent,T.copy);
    for(const kind of ['reject','throw','missing']){
      const r=await generated(lang),button=buttons(r)[index],original=r.context.navigator.clipboard;let thrown=null;
      if(kind==='throw')r.context.navigator.clipboard={writeText(){throw Error('blocked');}};if(kind==='missing')r.context.navigator.clipboard=undefined;
      try{button.click();if(kind==='reject')r.clipboard.at(-1).reject(Error('denied'));}catch(e){thrown=String(e);}await settle();eq(lang+': '+kind+' caught',thrown,null);eq(lang+': '+kind+' localized',r.get('hg-status').textContent,T.failure);
      r.context.navigator.clipboard=original;button.click();r.clipboard.at(-1).resolve();await settle();same(lang+': direct same-result retry',[r.get('hg-status').textContent,button.textContent],['',T.copied]);
    }
    for(const kind of ['clear','ctrlL','input','empty','next'])for(const outcome of ['resolve','reject']){
      const r=await generated(lang),button=buttons(r)[index];button.click();const pending=r.clipboard.at(-1);boundary(r,kind);if(kind==='next')await r.finishHash('NEXT');const before=state(r);pending[outcome](outcome==='reject'?Error('late copy'):undefined);await settle();same(`${lang}/${index}: late copy ${outcome}/${kind}`,state(r),before);
    }
    for(const kind of ['clear','ctrlL','input','empty','next']){
      const r=await generated(lang),button=buttons(r)[index];button.click();r.clipboard.at(-1).resolve();await settle();const oldTimer=[...r.timers.values()].find(t=>t.ms===1500);boundary(r,kind);if(kind==='next')await r.finishHash('NEXT');const before=state(r);oldTimer.fn();same(`${lang}/${index}: queued old timer after ${kind}`,state(r),before);
    }
    {
      const r=await generated(lang),button=buttons(r)[index];button.click();r.clipboard.at(-1).resolve();await settle();const old=[...r.timers.values()][0];r.advance(500);button.click();r.clipboard.at(-1).resolve();await settle();old.fn();eq(lang+': queued timer preserves newer feedback',button.textContent,T.copied);r.advance(1000);eq(lang+': old deadline preserves newer feedback',button.textContent,T.copied);r.advance(500);eq(lang+': new deadline restores Copy',button.textContent,T.copy);
      button.click();const first=r.clipboard.at(-1);button.click();r.clipboard.at(-1).reject(Error('latest'));await settle();const before=state(r);first.resolve();await settle();same(lang+': old success cannot hide latest failure',state(r),before);
      button.click();const owner=r.clipboard.at(-1),other=buttons(r)[(index+1)%5];other.click();r.clipboard.at(-1).reject(Error('other failed'));await settle();owner.resolve();await settle();eq(lang+': one row success cannot hide another row failure',r.get('hg-status').textContent,T.failure);
    }
  }
}
same('all promises handled',unhandled,[]);process.off('unhandledRejection',onUnhandled);
// Dynamic result nodes do not receive an Astro scope attribute.
const astroRequire=createRequire(require.resolve('astro'));
const {transform}=astroRequire('@astrojs/compiler');
const compiled=await transform(source,{filename:'HashGeneratorTool.astro'});
for(const cls of ['hg-row','hg-label','hg-value']){
  eq('compiled CSS reaches generated '+cls,compiled.css.some(css=>new RegExp('\\.'+cls+'\\s*\\{').test(css)),true);
  eq('generated '+cls+' CSS does not require scope',compiled.css.some(css=>new RegExp('\\.'+cls+'\\[data-astro-cid').test(css)),false);
}

// ---------- v2 page layout ----------
{
  const markup=source.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0];
  const css=source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const tips=['input','generate','clear','copy'];
  same('four control tips', [...markup.matchAll(/<Toggletip id="hg-tip-([^"]+)"/g)].map(m=>m[1]).sort(),tips.toSorted());
  eq('direct tool root',/^<div class="hg-wrap">/.test(markup),true);
  eq('root is a flex column with min-height zero',/\.hg-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css),true);
  eq('controls and fixed status precede panels',markup.indexOf('hg-actions')<markup.indexOf('id="hg-status"')&&markup.indexOf('id="hg-status"')<markup.indexOf('hg-panels'),true);
  eq('two shared panes',(markup.match(/zt-io-pane/g)||[]).length,2);
  eq('input and output fill available height',(markup.match(/zt-io-fill/g)||[]).length,2);
  eq('output has its own scroll region',/class="hg-output-body zt-io-fill" role="region" aria-labelledby="hg-output-label" tabindex="0"/.test(markup)&&/\.hg-output-body\s*\{\s*overflow: auto/.test(css),true);
  eq('status has fixed height and internal overflow',/\.hg-status\s*\{[^}]*height: 2\.8em;[^}]*overflow: auto/.test(css),true);
  eq('empty message disappears after real rows',/\.hg-output-pane:has\(\.hg-results:not\(:empty\)\) \.hg-empty\s*\{ display: none/.test(css),true);
  eq('stacked empty output disappears',/@media \(max-width: 860px\)[\s\S]*?\.hg-output-pane:has\(\.hg-results:empty\)\s*\{ display: none/.test(css),true);
  eq('mobile input remains bounded',/@media \(max-width: 640px\)[\s\S]*?\.hg-input\s*\{ height: 120px/.test(css),true);
  eq('no runtime label replacement',!/data-i18n/.test(source),true);
  eq('tips excluded from client variables',source.includes('const { tips: TIPS, ...CLIENT_T } = T;')&&compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'),true);
  eq('manual Generate remains the primary action',/id="hg-hash" class="btn-primary"/.test(markup),true);
  eq('registered convert',/['"]hash-generator['"]:\s*['"]convert['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')),true);
  eq('labels contain no interactive children',[...markup.matchAll(/<label\b[\s\S]*?<\/label>/g)].every(m=>!/<Toggletip|<button/.test(m[0])),true);
  const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);eq('unique markup IDs',new Set(ids).size,ids.length);
  const protectedContent={
  "en": {
    "frontmatter": "1b647f3037c7ca961ca54770761f9850a148e7d7e0bc0cc5eec93cff7229c185",
    "body": "bf7b654464cbd7e90712a33be5ae88f0a294478a55b9b75ff1c9b7bf50b0cfb9"
  },
  "zh": {
    "frontmatter": "5345d79e734895ec3c604657455238499dce1f73619e6aba6084c573b540f351",
    "body": "2d5b56e773f8f155325d521fda43948440978432756adb40b697e4c1375b722d"
  },
  "ja": {
    "frontmatter": "079d91f90f1a99135b951d85525b74a4189284ef0cdaed980faa47705b5653f1",
    "body": "7a66df4f83baeff237573e4643562ccd8c267a7a8369f4b59b1d09e27c25f808"
  },
  "ko": {
    "frontmatter": "4c2911084e36ad8ac3c4835ff1deb96f10517c828fec6305bf0ef509c5038024",
    "body": "e00f8e700a1a243bd183e1585e1f7ecffd247b3a6519911419d5d8852389aad4"
  }
};
  const yaml=require('js-yaml');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  for(const lang of Object.keys(labels)){
    same(lang+': equal client text keys',Object.keys(strings[lang]).sort(),Object.keys(strings.en).sort());
    same(lang+': complete tip keys',Object.keys(strings[lang].tips).sort(),tips.toSorted());
    for(const key of tips)eq(lang+': tip '+key+' is plain nonempty text',typeof strings[lang].tips[key]==='string'&&strings[lang].tips[key].length>20&&!/[<>]|https?:/.test(strings[lang].tips[key]),true);
    const doc=readFileSync(join(root,'src/content/tools/hash-generator/'+lang+'.mdx'),'utf8'),fm=doc.match(/^---\n([\s\S]*?)\n---/)[1],body=doc.slice(doc.indexOf('\n---',4)+4),meta=yaml.load(fm);
    eq(lang+': four steps before FAQ',meta.steps.length===4&&fm.indexOf('steps:')<fm.indexOf('faqItems:'),true);
    eq(lang+': bounded plain steps',meta.steps.every(x=>typeof x==='string'&&x.length<=280&&!/[<>]/.test(x))&&meta.steps.join('').length<=1200,true);
    eq(lang+': FAQ and SEO byte protection',hash(fm.replace(/^steps:\n(?:  .*\n)*/m,'')),protectedContent[lang].frontmatter);
    eq(lang+': all non-Usage body byte protection',hash(body),protectedContent[lang].body);
    const p=pageVM(lang);eq(lang+': input label is local before IIFE',p.get('hg-input').parentElement.querySelector('label').textContent,strings[lang].inputLabel);eq(lang+': initial output has no rows',rows(p).length,0);eq(lang+': localized empty message',p.widget.querySelector('.hg-empty').textContent,strings[lang].emptyOutput);
  }
  eq('MD5 and SHA helpers unchanged',hash(source.slice(source.indexOf('      // Compact MD5'),source.indexOf('      var inputEl'))),'fa6dbe7d03462cdef083bac56db494bb240a4aa8d110cdec05eedbc7de7ef74f');
  const {transform:parseJS}=require('esbuild');await parseJS(compiled.code,{loader:'ts'});eq('Astro output parses as JavaScript',true,true);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
