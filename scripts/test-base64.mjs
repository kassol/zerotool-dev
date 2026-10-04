// Base64 — built page localization test
//
// Read:  dist/{,zh/,ja/,ko/}tools/base64/index.html (run `npm run build` first),
//        src/components/tools/Base64Tool.astro, src/content/tools/base64/en.mdx,
//        src/layouts/ToolLayout.astro (real shared keyboard handler)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the first HTML a visitor receives already has the page language in the
// input and output labels, their placeholders, the Encode button and the file drop
// zone, so non-English pages do not show English text before the script runs; the lone-surrogate,
// large-file and read-error messages and the Data URI label are in the page language (they were
// English, and a lone surrogate showed "Invalid Base64 input" in Encode mode); switching Standard /
// URL-safe converts the current output (it used to keep the old alphabet). The engine block is
// read from src/components/tools/Base64Tool.astro.
//
// Run: node scripts/test-base64.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

const text = (html) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
function pick(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

const expected = {
  en: { plain: 'Plain Text', encodePh: 'Enter text to encode...', outPh: 'Base64 output appears here...', encode: 'Encode', drop: 'Drop any file here, or click to select' },
  zh: { plain: '纯文本', encodePh: '输入要编码的文本...', outPh: 'Base64 输出在这里...', encode: '编码', drop: '拖入任意文件，或点击选择' },
  ja: { plain: 'プレーンテキスト', encodePh: 'エンコードするテキストを入力...', outPh: 'Base64 出力がここに表示されます...', encode: 'エンコード', drop: 'ファイルをここにドロップ、またはクリックして選択' },
  ko: { plain: '일반 텍스트', encodePh: '인코딩할 텍스트를 입력...', outPh: 'Base64 출력이 여기에 표시됩니다...', encode: '인코딩', drop: '파일을 여기에 끌어다 놓거나 클릭하여 선택' },
};

for (const [lang, want] of Object.entries(expected)) {
  const file = join(root, 'dist', lang === 'en' ? '' : lang, 'tools/base64/index.html');
  if (!existsSync(file)) {
    check(lang + ': built page exists (run npm run build)', false, file);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  equal(lang + ': input label', text(pick(html, /<label[^>]*id="b64-input-label"[^>]*>([\s\S]*?)<\/label>/) || ''), want.plain);
  equal(lang + ': input placeholder', pick(html, /<textarea[^>]*id="b64-input"[^>]*placeholder="([^"]*)"/), want.encodePh);
  equal(lang + ': output label', text((pick(html, /<label[^>]*id="b64-output-label"[^>]*>([\s\S]*?)<\/label>/) || '').replace(/<button[\s\S]*?<\/button>/, '')), 'Base64');
  equal(lang + ': output placeholder', pick(html, /<textarea[^>]*id="b64-output"[^>]*placeholder="([^"]*)"/), want.outPh);
  equal(lang + ': Encode button', text(pick(html, /<button[^>]*id="b64-run"[^>]*>([\s\S]*?)<\/button>/) || ''), want.encode);
  equal(lang + ': drop zone text', text(pick(html, /<div[^>]*class="b64-drop-inner[^"]*"[^>]*>([\s\S]*?)<\/div>/) || ''), want.drop);
  if (lang !== 'en') {
    const widget = pick(html, /(<div[^>]*class="b64-wrap[\s\S]*?<\/textarea>[\s\S]*?<\/textarea>)/) || '';
    check(lang + ': no English label or drop text in the widget', !/Plain Text|Drop any file|Enter text to encode|Result appears here/.test(widget));
  }
}

// ---------- engine (source): lone surrogates are reported instead of "Invalid Base64 input" ----------
const source = readFileSync(join(root, 'src/components/tools/Base64Tool.astro'), 'utf8');
const es = source.indexOf('/* ── engine:start ── */');
const ee = source.indexOf('/* ── engine:end ── */');
check('engine block found', es >= 0 && ee > es);
if (es >= 0 && ee > es) {
  const E = new Function(source.slice(es, ee) + '\nreturn { loneSurrogateAt, switchVariant };')();
  equal('no lone surrogate', E.loneSurrogateAt('a😀b'), -1);
  equal('high surrogate alone', E.loneSurrogateAt('ab\uD83D'), 3);
  equal('low surrogate alone', E.loneSurrogateAt('😀\uDE00x'), 2);
  equal('position counts code points', E.loneSurrogateAt('😀😀\uD800'), 3);
  equal('standard → URL-safe', E.switchVariant('+/8=', 'urlsafe'), '-_8');
  equal('URL-safe → standard', E.switchVariant('-_8', 'standard'), '+/8=');
  equal('round trip', E.switchVariant(E.switchVariant('YWI/Pz4+', 'urlsafe'), 'standard'), 'YWI/Pz4+');
}
for (const [lang, word] of Object.entries({ en: 'lone surrogate', zh: '代理项', ja: 'サロゲート', ko: '서로게이트' })) {
  const file = join(root, 'dist', lang === 'en' ? '' : lang, 'tools/base64/index.html');
  if (!existsSync(file)) continue;
  const html = readFileSync(file, 'utf8');
  check(lang + ': lone-surrogate message in the page language', html.includes(word));
  if (lang !== 'en') check(lang + ': no English Data URI label', !/Include Data URI prefix/.test(html));
}
const page = readFileSync(join(root, 'src/content/tools/base64/en.mdx'), 'utf8');
check('page no longer says variant changes do not convert again', !page.includes('does not convert the current output again'));

// ---------- full page lifecycle: actual IIFE + ToolLayout keyboard events ----------
// The DOM comes from component markup. Only FileReader, clipboard, persistence,
// and time are substitutes; conversion runs the real page code. No OS APIs run.
const sourcePath = join(root, 'src/components/tools/Base64Tool.astro');
const shellPath = join(root, 'src/layouts/ToolLayout.astro');
const shell = readFileSync(shellPath, 'utf8');
const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
const fm = source.slice(source.indexOf('const STRINGS ='), source.indexOf('const T = STRINGS[lang]')).replace(/\bas const\b/g, '');
const strings = vm.runInNewContext(fm + '\nSTRINGS;');
if (!script || !shortcut.includes("document.addEventListener('keydown'")) throw new Error('Page or shared shortcut extraction failed');
function same(name, actual, expected) { check(name, isDeepStrictEqual(actual, expected), JSON.stringify({ actual, expected })); }
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const unhandled = [];
const onUnhandled = error => unhandled.push({ name: error.name, message: error.message });
process.on('unhandledRejection', onUnhandled);
const escapeHTML = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

function pageVM(lang = 'en', shellFirst = false, savedInput = '') {
  const ids = new Map(), readers = [], copies = [], timers = new Map(), docEvents = {}, saves = [], clears = [], tracked = [];
  let timerId = 0, now = 0;
  const document = { activeElement: null };
  function simple(e, selector) {
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(selector), id = /#([\w-]+)/.exec(selector), classes = [...selector.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      let n = e.parentElement;
      while (parts.length) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: '', _value: '', _text: '', _html: null, hidden: false, disabled: false, checked: false, attributes: {}, children: [], parentElement: null, listeners: {}, files: [], clicks: 0, placeholder: '' });
    }
    set value(v) { this._value = String(v); if (this.type === 'file' && v === '') this.files = []; }
    get value() { return this._value; }
    set textContent(v) { this._text = String(v); this._html = null; this.children = []; }
    get textContent() { return this._text + this.children.map(e => e.textContent).join(''); }
    set innerHTML(v) { this._html = String(v); this._text = ''; this.children = []; }
    get innerHTML() { return this._html ?? escapeHTML(this.textContent); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'type', 'value', 'class', 'placeholder'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return { contains: k => e.className.split(/\s+/).includes(k), add(k) { if (!this.contains(k)) e.className = (e.className + ' ' + k).trim(); }, remove(k) { e.className = e.className.split(/\s+/).filter(s => s !== k).join(' '); } };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(e => [...(matches(e, s) ? [e] : []), ...e.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const ev = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, ev);
      if (t === 'keydown') for (const fn of docEvents[t] || []) fn.call(document, ev);
      return ev;
    }
    click() { this.clicks++; if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element(); widget.className = 'tool-widget'; body.appendChild(widget);
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/=\{T\.([\w]+)\}/g, (_, key) => '="' + escapeHTML(strings[lang][key]) + '"')
    .replace(/\{T\.([\w]+)\}/g, (_, key) => escapeHTML(strings[lang][key]));
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const m of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (m[3] !== undefined) { stack.at(-1)._text += m[3]; continue; }
    const tag = m[1];
    if (m[0].startsWith('</')) { if (stack.at(-1)?.tagName === tag.toUpperCase()) stack.pop(); continue; }
    const e = new Element(tag);
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(a[1], a[2]);
    for (const name of ['hidden', 'disabled', 'checked']) e[name] = new RegExp('\\b' + name + '(?=\\s|/|$)').test(m[2]);
    stack.at(-1).appendChild(e); if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !m[2].trimEnd().endsWith('/')) stack.push(e);
  }
  const get = id => { const e = ids.get(id); if (!e) throw new Error('Missing actual markup ID ' + id); return e; };
  Object.assign(document, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    createElement: tag => new Element(tag), addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra = {}) { const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of docEvents[t] || []) fn.call(this, e); return e; },
  });
  class FileReader {
    constructor() { this.readyState = 0; this.result = null; readers.push(this); }
    readAsArrayBuffer(file) { this.file = file; this.readyState = 1; }
    abort() { this.readyState = 2; this.aborted = true; this.onabort?.({ target: this }); }
    finish(outcome) {
      // Deliver an already-queued completion even after abort; the page must reject it.
      this.readyState = 2;
      if (outcome === 'load') {
        const b = Uint8Array.from(this.file.bytes); this.result = b.buffer;
        this.onload?.({ target: this });
      } else { this.error = new Error('controlled file read failure'); this.onerror?.({ target: this }); }
    }
  }
  const context = {
    document, console, FileReader, Uint8Array, TextEncoder, TextDecoder, atob, btoa, t: strings[lang], _slug: 'base64',
    navigator: { clipboard: { writeText(value) { const job = defer(); copies.push({ ...job, value }); return job.promise; } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms, delay: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ztPersist: { load: () => ({ input: savedInput }), save: (slug, value) => saves.push({ slug, value }), clear: slug => clears.push(slug) },
    trackTool: (slug, action) => tracked.push({ slug, action }),
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context, { filename: shellPath });
  vm.runInContext(script, context, { filename: sourcePath });
  if (!shellFirst) vm.runInContext(shortcut, context, { filename: shellPath });
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  function input(text) { get('b64-input').value = text; get('b64-input').dispatch('input'); }
  function choose(name, value) { const list = document.querySelectorAll('input[name="' + name + '"]'); const target = list.find(e => e.value === value); if (!target) throw new Error('Missing actual radio ' + name + ':' + value); for (const e of list) e.checked = e === target; target.dispatch('change'); }
  function uri(on) { get('b64-uri-toggle').checked = on; get('b64-uri-toggle').dispatch('change'); }
  function file(name = 'old.bin', bytes = [0xfb, 0xff], type = 'application/octet-stream', drop = false) {
    const f = { name, bytes: Uint8Array.from(bytes), size: bytes.length, type };
    if (drop) get('b64-drop').dispatch('drop', { dataTransfer: { files: [f] } });
    else { get('b64-file').value = 'C:\\fakepath\\' + name; get('b64-file').files = [f]; get('b64-file').dispatch('change'); }
    const reader = readers.at(-1); if (reader?.file !== f) throw new Error('Actual FileReader path was not reached'); return reader;
  }
  function ctrlL() { get('b64-input').focus(); return document.dispatch('keydown', { ctrlKey: true, key: 'l' }); }
  function copy() { get('b64-copy').click(); return copies.at(-1); }
  function snapshot() { return {
    input: get('b64-input').value, output: get('b64-output').value,
    status: get('b64-status').textContent, statusClass: get('b64-status').className,
    fileValue: get('b64-file').value, fileCount: get('b64-file').files.length,
    fileInfoHidden: get('b64-file-info').hidden, fileInfo: get('b64-file-info').innerHTML,
    uriHidden: get('b64-uri-row').hidden, uriChecked: get('b64-uri-toggle').checked,
    dropHidden: get('b64-drop').hidden, copyLabel: get('b64-copy').textContent.trim(), runLabel: get('b64-run').textContent.trim(),
  }; }
  return { context, timers, document, get, advance, input, choose, uri, file, ctrlL, copy, snapshot, copies, readers, saves, clears, tracked, shellFirst };
}

const rendered = (p, value) => { p.input(value); p.advance(300); };
const fileBoundaries = ['clear', 'ctrlL', 'mode', 'swap', 'new-file', 'new-text'];
function changeState(p, action) {
  if (action === 'clear') p.get('b64-clear').click();
  else if (action === 'ctrlL') p.ctrlL();
  else if (action === 'mode') p.choose('b64mode', 'decode');
  else if (action === 'swap') p.get('b64-swap').click();
  else if (action === 'new-file') p.file('new.txt', [...Buffer.from('new-file')], 'text/plain').finish('load');
  else if (action === 'new-text') p.input('new text 世界');
}
for (const lang of Object.keys(expected)) {
  const T = strings[lang];
  {
    const p = pageVM(lang); p.input('Hello, 世界'); p.advance(299);
    equal(lang + ': live conversion waits 300ms', p.snapshot().output, '');
    p.advance(1); equal(lang + ': actual UTF-8 encode', p.snapshot().output, 'SGVsbG8sIOS4lueVjA==');
    equal(lang + ': encoded status', p.snapshot().status, T.encodedOk);
    p.advance(199); equal(lang + ': save waits 500ms', p.saves.length, 0);
    p.advance(1); same(lang + ': original input persistence', JSON.parse(JSON.stringify(p.saves)), [{slug:'base64',value:{input:'Hello, 世界'}}]);
    p.choose('b64mode', 'decode'); equal(lang + ': mode still clears instead of converting', p.snapshot().output, '');
    rendered(p, 'SGVsbG8'); equal(lang + ': actual decode missing padding', p.snapshot().output, 'Hello');
    p.input('%invalid'); p.get('b64-run').click();
    same(lang + ': invalid decode clears output', [p.snapshot().output, p.snapshot().status], ['', T.invalidBase64]);
    p.choose('b64mode', 'encode'); rendered(p, 'a\uD800');
    equal(lang + ': actual surrogate error', p.snapshot().status, T.loneSurrogate.replace('{n}', '2'));
    rendered(p, 'restored'); equal(lang + ': valid input recovers', p.snapshot().output, 'cmVzdG9yZWQ=');
    rendered(p, ''); same(lang + ': empty input clears output and status', [p.snapshot().output,p.snapshot().status], ['','']);
    p.get('b64-output').value = 'stale'; p.get('b64-run').click();
    equal(lang + ': empty manual conversion clears old output', p.snapshot().output, '');
  }
  {
    const p = pageVM(lang); p.file('bytes.bin', [0xfb,0xff], '', true).finish('load');
    equal(lang + ': actual file bytes', p.snapshot().output, '+/8=');
    p.uri(true); equal(lang + ': MIME fallback and URI', p.snapshot().output, 'data:application/octet-stream;base64,+/8=');
    p.choose('b64variant','urlsafe'); equal(lang + ': file URL-safe', p.snapshot().output, 'data:application/octet-stream;base64,-_8');
    p.choose('b64variant','standard'); equal(lang + ': standard restores padding', p.snapshot().output, 'data:application/octet-stream;base64,+/8=');
    p.file().finish('error'); equal(lang + ': current read failure', p.snapshot().status, T.readFailed);
    rendered(p,'new text'); p.uri(true); equal(lang + ': text releases previous file URI cache', p.snapshot().output, 'bmV3IHRleHQ=');
    p.choose('b64variant','urlsafe'); equal(lang + ': text releases previous file variant cache', p.snapshot().output, 'bmV3IHRleHQ');
  }
  for (const action of fileBoundaries) for (const shellFirst of action === 'ctrlL' ? [false,true] : [false]) for (const outcome of ['load','error']) {
    const p=pageVM(lang,shellFirst); rendered(p,'seed'); const reader=p.file(); changeState(p,action);
    const before=p.snapshot(); reader.finish(outcome);
    same(`${lang}: queued file ${outcome} after ${action}, shellFirst=${shellFirst}`, p.snapshot(), before);
    if(action==='new-text') { p.advance(300); equal(lang+': newer text still converts',p.snapshot().output,'bmV3IHRleHQg5LiW55WM'); }
  }
  for(const shellFirst of [false,true]) for(const key of ['l','L']) {
    const p=pageVM(lang,shellFirst); p.file().finish('load'); p.uri(true);
    p.get('b64-input').focus(); const ev=p.document.dispatch('keydown',{metaKey:true,key});
    same(`${lang}: Cmd${key} clears file UI, order=${shellFirst}`, [p.snapshot().input,p.snapshot().output,p.snapshot().status,p.snapshot().fileValue,p.snapshot().fileCount,p.snapshot().fileInfoHidden,p.snapshot().uriHidden,p.snapshot().uriChecked,ev.defaultPrevented],['','','','',0,true,true,false,true]);
    p.uri(true); p.choose('b64variant','urlsafe'); equal(lang+': CtrlL cannot revive cache',p.snapshot().output,'');
    p.input('queued'); p.ctrlL(); p.advance(500);
    same(lang+': CtrlL cancels queued conversion and save',[p.snapshot().output,p.snapshot().status,p.saves.length],['','',0]);
    equal(lang+': shared shortcut clears persistence once per event',p.clears.length,2);
  }
  {
    const p=pageVM(lang); rendered(p,'A'); p.input('B'); p.get('b64-swap').click(); p.advance(500);
    same(lang+': Swap cancels old live conversion and retains direction',[p.snapshot().input,p.snapshot().output,p.snapshot().runLabel],['QQ==','B',T.encode]);
    const q=pageVM(lang); q.input('queued'); const r=q.file(); r.finish('load'); q.advance(500);
    same(lang+': file prevents queued text conversion/save',[q.snapshot().output,q.saves.length],['+/8=',0]);
    const x=pageVM(lang); rendered(x,'outside'); x.document.activeElement=x.document.body; const before=x.snapshot();
    x.document.dispatch('keydown',{ctrlKey:true,key:'l'}); same(lang+': outside CtrlL unchanged',x.snapshot(),before);
    x.get('b64-input').focus(); x.document.dispatch('keydown',{key:'l'}); same(lang+': unmodified L unchanged',x.snapshot(),before);
  }
  for(const mods of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true}]) {
    const p=pageVM(lang); const e=p.get('b64-drop').dispatch('keydown',{key:'Enter',...mods});
    check(lang+': modified Enter prevents native default '+JSON.stringify(mods),e.defaultPrevented);
    equal(lang+': modified Enter never opens native file picker '+JSON.stringify(mods),p.get('b64-file').clicks,0);
  }
  {
    const p=pageVM(lang); p.get('b64-drop').dispatch('keydown',{key:'Enter'}); p.get('b64-drop').dispatch('keydown',{key:' '});
    equal(lang+': ordinary Enter/Space keeps file activation',p.get('b64-file').clicks,2);
    p.input('manual'); p.document.dispatch('keydown',{ctrlKey:true,key:'Enter'});
    equal(lang+': shared CtrlEnter still executes Run',p.snapshot().output,'bWFudWFs');
    equal(lang+': shared CtrlEnter conversion tracked once',p.tracked.length,1);
  }
}
// The retained Run button must preserve a successfully loaded file, including empty files.
for(const lang of Object.keys(expected)) {
  for(const bytes of [[0xfb,0xff],[]]) for(const trigger of ['run','ctrlEnter']) {
    const p=pageVM(lang); p.file('keep.bin',bytes).finish('load'); p.uri(true); const before=p.snapshot();
    if(trigger==='run') p.get('b64-run').click(); else p.document.dispatch('keydown',{ctrlKey:true,key:'Enter'});
    const after=p.snapshot();
    same(`${lang}: ${trigger} preserves loaded ${bytes.length}-byte file`,[after.output,after.fileInfo,after.fileInfoHidden,after.uriHidden,after.uriChecked,after.fileValue],[before.output,before.fileInfo,before.fileInfoHidden,before.uriHidden,before.uriChecked,before.fileValue]);
    p.uri(false); equal(lang+': retained file cache still supports URI toggle',p.snapshot().output,Buffer.from(bytes).toString('base64'));
  }
  {
    const p=pageVM(lang); p.file('old.bin',[0xfb,0xff]).finish('load'); p.uri(true);
    const next=p.file('failed.bin',[1,2,3]);
    same(lang+': new file owns cleared output/metadata while reading',[p.snapshot().output,p.snapshot().fileInfo,p.snapshot().fileInfoHidden,p.snapshot().uriHidden,p.snapshot().fileValue,p.snapshot().fileCount],['','',true,true,'C:\\fakepath\\failed.bin',1]);
    next.finish('error'); same(lang+': current read error has no old result',[p.snapshot().output,p.snapshot().status,p.snapshot().fileInfoHidden,p.snapshot().uriHidden],['',strings[lang].readFailed,true,true]);
    p.uri(true); p.choose('b64variant','urlsafe'); equal(lang+': failed new file cannot revive old bytes',p.snapshot().output,'');
    p.file('recovered.bin',[0xfb,0xff]).finish('load'); check(lang+': file read recovers',p.snapshot().output.endsWith('-_8'));
  }
}
// A zero-byte file is still a current file when toggling URI or alphabet.
for(const lang of Object.keys(expected)) {
  const p=pageVM(lang); p.file('empty.txt',[],'text/plain').finish('load');
  equal(lang+': empty file body remains empty',p.snapshot().output,'');
  p.uri(true); equal(lang+': empty file URI contains MIME and empty body',p.snapshot().output,'data:text/plain;base64,');
  p.choose('b64variant','urlsafe'); equal(lang+': empty file URL-safe keeps URI',p.snapshot().output,'data:text/plain;base64,');
  p.choose('b64variant','standard'); equal(lang+': empty file standard keeps URI',p.snapshot().output,'data:text/plain;base64,');
  p.uri(false); equal(lang+': empty file URI can be removed',p.snapshot().output,'');
  p.get('b64-clear').click(); p.uri(true); equal(lang+': cleared empty file cannot revive URI',p.snapshot().output,'');
}
// A selected file keeps ownership while reading, even if the old text remains visible.
for(const lang of Object.keys(expected)) for(const action of ['alphabet','run','ctrlEnter']) {
  const p=pageVM(lang); rendered(p,'previous text'); const reader=p.file('pending.bin',[0xfb,0xff]);
  if(action==='alphabet') p.choose('b64variant','urlsafe');
  else if(action==='run') p.get('b64-run').click();
  else p.document.dispatch('keydown',{metaKey:true,key:'Enter'});
  same(`${lang}: pending file remains selected after ${action}`,[p.snapshot().fileValue,p.snapshot().fileCount],['C:\\fakepath\\pending.bin',1]);
  equal(`${lang}: ${action} does not restore preceding text output while reading`,p.snapshot().output,'');
  reader.finish('load'); equal(`${lang}: pending file completes with latest alphabet after ${action}`,p.snapshot().output,action==='alphabet'?'-_8':'+/8=');
}
// Copy completion belongs to the current output/action and latest click.
const copyFailure = {
  en: 'Could not copy. Please select and copy the output manually.',
  zh: '复制失败。请选中输出内容后手动复制。',
  ja: 'コピーできませんでした。出力を選択して手動でコピーしてください。',
  ko: '복사하지 못했습니다. 출력을 선택하여 직접 복사하세요.'
};
function copyBoundary(p, action) {
  if (fileBoundaries.includes(action)) changeState(p, action);
  else if(action==='variant') p.choose('b64variant','urlsafe');
  else if(action==='uri') p.uri(true);
  else if(action==='manual') { p.get('b64-input').value='manual replacement'; p.get('b64-run').click(); }
  else if(action==='error') { p.choose('b64mode','decode'); rendered(p,'%invalid'); }
}
for(const lang of Object.keys(expected)) {
  const T=strings[lang]; equal(lang+': copy error is localized',T.copyFail,copyFailure[lang]);
  {
    const p=pageVM(lang); rendered(p,'copy 世界'); const job=p.copy();
    equal(lang+': clipboard receives exact actual UTF-8 result',job.value,'Y29weSDkuJbnlYw=');
    job.resolve(); await flush(); equal(lang+': current copy succeeds',p.snapshot().copyLabel,T.copied);
    p.advance(1499); equal(lang+': feedback remains for 1500ms',p.snapshot().copyLabel,T.copied);
    p.advance(1); equal(lang+': feedback resets at 1500ms',p.snapshot().copyLabel,T.copy);
    p.get('b64-clear').click(); const count=p.copies.length; p.copy(); equal(lang+': empty output never copies',p.copies.length,count);
  }
  for(const kind of ['reject','throw','missing']) {
    const p=pageVM(lang); rendered(p,'retry same output'); const original=p.context.navigator.clipboard; const start=unhandled.length; let thrown;
    if(kind==='missing') p.context.navigator.clipboard=undefined;
    if(kind==='throw') p.context.navigator.clipboard={writeText(){throw new Error('clipboard blocked');}};
    try { const job=p.copy(); if(kind==='reject') job.reject(new Error('clipboard denied')); } catch(e) { thrown=e.message; }
    await flush(); equal(lang+': '+kind+' does not escape handler',thrown,undefined);
    same(lang+': '+kind+' is handled',unhandled.slice(start),[]);
    same(lang+': '+kind+' visible current failure',[p.snapshot().status,p.snapshot().statusClass,p.snapshot().copyLabel],[copyFailure[lang],'b64-status error',T.copy]);
    p.context.navigator.clipboard=original; const before=p.snapshot().output; const retry=p.copy(); retry.resolve(); await flush();
    same(lang+': '+kind+' same-output direct retry recovers',[retry.value,p.snapshot().output,p.snapshot().copyLabel,p.snapshot().status],[before,before,T.copied,'']);
  }
  for(const action of [...fileBoundaries,'variant','uri','manual','error']) for(const shellFirst of action==='ctrlL'?[false,true]:[false]) for(const outcome of ['resolve','reject']) {
    const p=pageVM(lang,shellFirst); rendered(p,'old copy'); const job=p.copy(); copyBoundary(p,action);
    const before=p.snapshot(),start=unhandled.length;
    job[outcome](outcome==='reject'?new Error('late rejection'):undefined); await flush();
    same(`${lang}: late copy ${outcome} after ${action}, order=${shellFirst}`,p.snapshot(),before);
    same(lang+': late copy settles without unhandled rejection',unhandled.slice(start),[]);
  }
  {
    const p=pageVM(lang); rendered(p,'same output'); const old=p.copy(), newer=p.copy();
    newer.resolve(); await flush(); const before=p.snapshot(); old.reject(new Error('older click')); await flush();
    same(lang+': older request cannot replace newer copied feedback',p.snapshot(),before);
    const a=p.copy(),b=p.copy(); b.reject(new Error('newer failed')); await flush(); const failed=p.snapshot();
    a.resolve(); await flush(); same(lang+': older success cannot clear current copy error',p.snapshot(),failed);
  }
  {
    const p=pageVM(lang); rendered(p,'timer'); p.copy().resolve(); await flush();
    const oldTimer=[...p.timers.values()].find(t=>t.delay===1500); check(lang+': copy schedules feedback timer',!!oldTimer);
    p.advance(500); p.copy().resolve(); await flush();
    oldTimer?.fn(); equal(lang+': already-queued old timer cannot reset newer feedback',p.snapshot().copyLabel,T.copied);
    p.advance(1000); equal(lang+': original timer deadline preserves newer feedback',p.snapshot().copyLabel,T.copied);
    p.advance(500); equal(lang+': newest feedback eventually expires',p.snapshot().copyLabel,T.copy);
  }
  for(const action of fileBoundaries) {
    const p=pageVM(lang); rendered(p,'feedback'); p.copy().resolve(); await flush();
    const oldTimer=[...p.timers.values()].find(t=>t.delay===1500); copyBoundary(p,action);
    equal(lang+': '+action+' clears old Copied label immediately',p.snapshot().copyLabel,T.copy);
    const before=p.snapshot(); oldTimer?.fn(); same(lang+': queued timer after '+action+' preserves new state',p.snapshot(),before);
  }
  {
    const p=pageVM(lang); rendered(p,'old result'); const copy=p.copy(); const reader=p.file(); const count=p.copies.length; p.copy();
    equal(lang+': no old output can be copied during file reading',p.copies.length,count); reader.finish('load');
    const before=p.snapshot(); copy.resolve(); await flush(); same(lang+': file completion invalidates old copy',p.snapshot(),before);
    const q=pageVM(lang); rendered(q,'old result'); q.copy().reject(new Error('copy error')); await flush();
    const retry=q.copy(); q.choose('b64mode','decode'); rendered(q,'%invalid'); const error=q.snapshot();
    retry.resolve(); await flush(); same(lang+': retry does not clear newer conversion error',q.snapshot(),error);
    const r=pageVM(lang); rendered(r,'keep'); r.copy().reject(new Error('copy error')); await flush(); const pending=r.copy(); const f=r.file(); f.finish('error'); const readError=r.snapshot();
    pending.resolve(); await flush(); same(lang+': retry does not clear newer read error',r.snapshot(),readError);
  }
}
same('all page copy promises handled',unhandled,[]);

process.removeListener('unhandledRejection', onUnhandled);

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
