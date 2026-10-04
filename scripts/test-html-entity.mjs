// HTML Entity encoder — escaped characters and numeric references per code point
//
// Read:  src/components/tools/HtmlEntityTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers and complete page script)
//        src/layouts/ToolLayout.astro (actual keyboard handler)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: & < > " ' are written as &amp; &lt; &gt; &quot; &#39;; other ASCII is unchanged;
// non-ASCII becomes one decimal reference per code point, so an emoji is one reference
// (it used to be two surrogate references that decode to two U+FFFD); the converted-character
// count; the examples on the English tool page. Decoding uses the browser's HTML parser
// (a textarea's innerHTML); page tests execute that decoder with parse5 textarea RCDATA.
//
// Guide checks (src/content/blog/html-entity-guide/en.mdx and ja.mdx): every symbol table row
// (`| sym | names | &#dec; | &#xHEX; | UNICODE NAME |`) is recomputed from the WHATWG named
// character reference list and the Unicode 18.0 names in scripts/test-html-entity.fixtures.json:
// the name cell must list exactly the names that the list gives for that code point, every name
// must decode to it (entities package, WHATWG decoding), hex must equal decimal, and the Unicode
// name must match. The counts quoted in the text are recomputed from the list. Examples marked
// {/* he-check: {"encode": ..., "expect": ..., "count": n} */} run the tool's encoder;
// {/* he-check: {"decode": ..., "expect": ...} */} are decoded with the entities package in text
// mode. The expected text must appear in the page. The JavaScript sample is executed; the Python
// sample runs when python3 is available (SKIP otherwise).
//
// Run: node scripts/test-html-entity.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { parseFragment, defaultTreeAdapter } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtmlEntityTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlEntityTool.astro');
  process.exit(1);
}
const { encodeHtml, countReferences } = new Function(source.slice(startIndex, endIndex) + '\nreturn { encodeHtml, countReferences };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

// The decode status counts character references. Named references may contain digits
// (WHATWG entities.json: &frac12; &sup2; &there4;); every name with a semicolon counts once.
eq('names with digits are counted', countReferences('&frac12; &sup2; &there4;'), 3);
eq('named, decimal and hex references', countReferences('&amp;&#65;&#x41;&lt;'), 4);
eq('not references', countReferences('& amp; &1a; &#; &#x; a&b'), 0);
{
  const fixture = JSON.parse(readFileSync(join(root, 'scripts/test-html-entity.fixtures.json'), 'utf8'));
  const names = Object.keys(fixture.whatwgEntities).filter((n) => n.endsWith(';'));
  eq('fixture has the WHATWG names', names.length > 2000, true);
  eq('every WHATWG name with a semicolon counts once', names.filter((n) => countReferences(n) !== 1).join(' '), '');
}

eq('special characters', encodeHtml('&<>"\'').text, '&amp;&lt;&gt;&quot;&#39;');
eq('plain ASCII unchanged', encodeHtml('a = b; // ok\n').text, 'a = b; // ok\n');
eq('BMP character', encodeHtml('é').text, '&#233;');
eq('emoji is one reference', encodeHtml('😀').text, '&#128512;');
eq('emoji count', encodeHtml('a😀b').count, 1);
eq('ZWJ sequence', encodeHtml('👩‍💻').text, '&#128105;&#8205;&#128187;');
eq('lone surrogate kept as its code', encodeHtml('\uD800x').text, '&#55296;x');
eq('round trip of references to code points',
  [...encodeHtml('😀é中').text.matchAll(/&#(\d+);/g)].map((m) => String.fromCodePoint(+m[1])).join(''), '😀é中');

// examples on the English page
eq('page: div', encodeHtml('<div class="box">').text, '&lt;div class=&quot;box&quot;&gt;');
eq('page: cafe', encodeHtml('Café © 2024').text, 'Caf&#233; &#169; 2024');
eq('page: attribute', encodeHtml('<a title="Tom\'s café">').text, '&lt;a title=&quot;Tom&#39;s caf&#233;&quot;&gt;');
eq('page: attribute count', encodeHtml('<a title="Tom\'s café">').count, 6);
eq('page: emoji', encodeHtml('Ship it 🚀').text, 'Ship it &#128640;');

// ---------- guide: symbol tables, counts and examples ----------
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-html-entity.fixtures.json'), 'utf8'));
const whatwg = fixtures.whatwgEntities;
const unicodeName = new Map(fixtures.unicodeNames.map((l) => { const [cp, name] = l.split(';'); return [parseInt(cp, 16), name]; }));
const namesByCp = new Map();
for (const [name, v] of Object.entries(whatwg)) {
  if (!name.endsWith(';') || v.codepoints.length !== 1) continue;
  const cp = v.codepoints[0];
  if (!namesByCp.has(cp)) namesByCp.set(cp, []);
  namesByCp.get(cp).push(name);
}
const allNames = Object.keys(whatwg);
const semi = allNames.filter((n) => n.endsWith(';'));
const counts = {
  total: allNames.length,
  semicolon: semi.length,
  legacy: allNames.length - semi.length,
  singleChars: namesByCp.size,
  twoCodePoints: semi.filter((n) => whatwg[n].codepoints.length === 2).length,
};
eq('WHATWG list: entries', counts.total, 2231);
eq('WHATWG list: names with a semicolon', counts.semicolon, 2125);
eq('WHATWG list: legacy names', counts.legacy, 106);
eq('WHATWG list: characters with a name', counts.singleChars, 1446);
eq('WHATWG list: names giving two code points', counts.twoCodePoints, 93);
eq('six names for ≈', (namesByCp.get(0x2248) || []).length, 6);
eq('five names for →', (namesByCp.get(0x2192) || []).length, 5);
eq('five names for U+200B', (namesByCp.get(0x200b) || []).length, 5);
eq('&NotEqualTilde; is two code points', whatwg['&NotEqualTilde;'].codepoints.join(' '), '8770 824');
eq('&nvlt; is two code points', whatwg['&nvlt;'].codepoints.join(' '), '60 8402');
eq('&Copy; is not a name', decodeHTML('&Copy;'), '&Copy;');
eq('&angst; is U+00C5', whatwg['&angst;'].codepoints[0], 0xc5);

const placeholders = { en: ['(space)', '(invisible)'], ja: ['（空白）', '（見えない文字）'] };
const none = { en: 'none', ja: 'なし' };
let python = true;
try { execFileSync('python3', ['-c', 'import html'], { stdio: 'ignore' }); } catch { python = false; }
for (const lang of ['en', 'ja']) {
  const page = readFileSync(join(root, 'src/content/blog/html-entity-guide/' + lang + '.mdx'), 'utf8');
  for (const [k, v] of Object.entries(counts)) {
    eq(lang + ' guide quotes ' + k, page.includes(v.toLocaleString('en-US')), true);
  }
  let rows = 0;
  for (const m of page.matchAll(/^\| (.+?) \| (.+?) \| `&#(\d+);` \| `&#x([0-9A-F]+);` \| ([A-Z0-9 -]+) \|$/gm)) {
    rows++;
    const [, sym, namesCell, dec, hex, uname] = m;
    const cp = Number(dec);
    const label = lang + ' row U+' + cp.toString(16).toUpperCase();
    eq(label + ' hex', parseInt(hex, 16), cp);
    eq(label + ' symbol', sym === '`' + String.fromCodePoint(cp) + '`' || placeholders[lang].includes(sym), true);
    eq(label + ' Unicode name', uname, unicodeName.get(cp));
    const listed = namesCell === none[lang] ? [] : [...namesCell.matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    eq(label + ' names', listed.slice().sort().join(' '), (namesByCp.get(cp) || []).slice().sort().join(' '));
    for (const n of listed) eq(label + ' ' + n + ' decodes', decodeHTML(n), String.fromCodePoint(cp));
    eq(label + ' decimal decodes', decodeHTML('&#' + dec + ';'), String.fromCodePoint(cp));
  }
  eq(lang + ' guide has symbol tables', rows >= 80, true);
  let examples = 0;
  for (const m of page.matchAll(/\{\/\* he-check: (\{.*?\}) \*\/\}/g)) {
    examples++;
    const ex = JSON.parse(m[1]);
    if (ex.encode !== undefined) {
      const r = encodeHtml(ex.encode);
      eq(lang + ' encode ' + ex.encode, r.text, ex.expect);
      if (ex.count !== undefined) eq(lang + ' count ' + ex.encode, r.count, ex.count);
    } else {
      eq(lang + ' decode ' + ex.decode, decodeHTML(ex.decode), ex.expect);
    }
    if (!ex.expect.includes('\uFFFD')) eq(lang + ' page shows ' + ex.expect, page.includes(ex.expect), true);
  }
  eq(lang + ' guide carries examples', examples >= 3, true);
  // Text says: in an attribute the legacy name is left alone when followed by a letter.
  eq(lang + ' attribute keeps &region', decodeHTMLAttribute('?lang=en&region=us'), '?lang=en&region=us');
  // JavaScript sample: run the definition, then every `call; // 'result'` line.
  const js = page.match(/```javascript\n([\s\S]*?)```/)[1];
  const def = js.slice(0, js.indexOf(';\n') + 1);
  const escapeHtml = new Function(def + '\nreturn escapeHtml;')();
  for (const line of js.split('\n').filter((l) => /^escapeHtml\(/.test(l))) {
    const [call, comment] = line.split(' // ');
    eq(lang + ' JS ' + call, "'" + new Function('escapeHtml', 'return ' + call.replace(/;$/, ''))(escapeHtml) + "'", comment.trim());
  }
  const py = page.match(/```python\n([\s\S]*?)```/)[1].split('\n');
  if (!python) { console.log('SKIP: python3 not found, ' + lang + ' Python sample not run'); continue; }
  for (let i = 0; i < py.length - 1; i++) {
    if (!/^html\./.test(py[i]) || !/^# /.test(py[i + 1])) continue;
    const out = execFileSync('python3', ['-c', 'import html, sys; sys.stdout.write(repr(' + py[i] + '))'], { encoding: 'utf8' });
    eq(lang + ' Python ' + py[i], out, py[i + 1].slice(2));
  }
}

// ---------- actual page lifecycle and shared keyboard handler ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw new Error('Shared shortcut extraction failed');
function pageVM(lang = 'en', shellFirst = false) {
  const timers = new Map(), copies = [], cleared = [], tracked = [];
  let now = 0, timerID = 0, document;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      if (el.tagName.startsWith('#')) return false;
      const parts = part.trim().split(/\s+(?![^\[]*\])/), last = parts.pop();
      const attrs = [...last.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      const plain = last.replace(/\[[^\]]*\]/g, ''), tag = /^[\w-]+/.exec(plain), id = /#([\w-]+)/.exec(plain);
      if ((tag && el.tagName !== tag[0].toUpperCase()) || (id && el.id !== id[1])) return false;
      if (![...plain.matchAll(/\.([\w-]+)/g)].every(m => el.className.split(' ').includes(m[1]))) return false;
      if (!attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2])) return false;
      if (!parts.length) return true;
      for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, parts.join(' '))) return true;
      return false;
    });
  }
  class PageEvent {
    constructor(type, options = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, options); }
    preventDefault() { this.defaultPrevented = true; }
  }
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', attributes: {}, children: [], parentElement: null, listeners: {}, text: '', _value: undefined, disabled: false }); }
    get value() { return this._value ?? (this.tagName === 'TEXTAREA' ? this.textContent : ''); }
    set value(value) { this._value = String(value); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (['id', 'class', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    set innerHTML(value) {
      this.textContent = '';
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(value)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(el) { return this === el || this.children.some(c => c.contains(el)); }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentElement) {
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, options = {}) { return this.dispatchEvent(new PageEvent(type, { bubbles: true, ...options })); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element()); widget.className = 'tool-widget';
  widget.innerHTML = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  document.getElementById = id => descendants(document).find(el => el.id === id) || null;
  document.createElement = tag => new Element(tag);
  const context = { document, console, Event: PageEvent, _slug: 'html-entity',
    ztPersist: { clear: slug => cleared.push(slug) }, trackTool: (...args) => tracked.push(args),
    setTimeout(fn, delay = 0) { const id = ++timerID; timers.set(id, { fn, due: now + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } }
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context);
  if (!shellFirst) vm.runInContext(shortcut, context);
  const get = id => { const el = document.getElementById(id); if (!el) throw new Error('Missing actual ID ' + id); return el; };
  return { context, document, get, copies, timers, cleared, tracked,
    input(value) { get('he-input').value = value; get('he-input').dispatch('input'); },
    key(key = 'l', modifiers = { ctrlKey: true }) { document.activeElement.dispatch('keydown', { key, ...modifiers }); },
    advance(ms) { const target = now + ms; for (;;) { const next = [...timers].filter(([,t]) => t.due <= target).sort((a,b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = target; },
    snapshot() { return [get('he-input').value,get('he-output').value,get('he-status').textContent,get('he-status').className,get('he-copy').textContent]; }
  };
}
function samePage(name, actual, expected) { eq(name, JSON.stringify(actual), JSON.stringify(expected)); }
const localized = {
  en: { copy: 'Copy', copied: 'Copied!', copyFail: 'Could not copy. Please select and copy the output manually.' },
  zh: { copy: '复制', copied: '已复制！', copyFail: '复制失败。请选中输出内容后手动复制。' },
  ja: { copy: 'コピー', copied: 'コピー済み！', copyFail: 'コピーできませんでした。出力を選択して手動でコピーしてください。' },
  ko: { copy: '복사', copied: '복사됨!', copyFail: '복사하지 못했습니다. 출력을 선택하여 직접 복사하세요.' }
};
function manual(p, direction, value) { p.get('he-input').value = value; p.get('he-' + direction).click(); }
for (const lang of Object.keys(localized)) {
  const p = pageVM(lang);
  p.input('<a>😀&'); p.advance(299); eq(lang + ': live conversion waits 300ms',p.get('he-output').value,'');
  p.advance(1); samePage(lang + ': real live encode and count',[p.get('he-output').value,p.get('he-status').textContent],['&lt;a&gt;&#128512;&amp;','Encoded — 4 characters converted.']);
  p.input('&lt;a&gt;&#128512;&amp;'); p.get('he-decode').click();
  samePage(lang + ': manual decode uses textarea RCDATA',[p.get('he-output').value,p.get('he-status').textContent],['<a>😀&','Decoded — 4 entities converted.']);
  p.input('<b>&amp;</b>'); p.advance(300);
  samePage(lang + ': live decoder preserves literal tags',[p.get('he-output').value,p.get('he-status').textContent],['<b>&</b>','Decoded — 1 entity converted.']);
  for (const [input,expected] of [['&copy 2024 &#128; &#0; &#xD800; &notARealEntity;','© 2024 € � � ¬ARealEntity;'],['&madeUp; &#xZZ; &amp;lt;','&madeUp; &#xZZ; &lt;']]) {
    manual(p,'decode',input); eq(lang + ': real tolerant RCDATA ' + input,p.get('he-output').value,expected);
  }
  p.get('he-input').focus(); p.key('Enter');
  eq(lang + ': shared CtrlEnter chooses Encode once',p.tracked.filter(x=>x[1]==='encode').length,1);
  eq(lang + ': shared CtrlEnter keeps current Encode semantics',p.get('he-output').value,'&amp;madeUp; &amp;#xZZ; &amp;amp;lt;');
  for (const action of ['live','encode','decode']) {
    manual(p,'encode','&');
    if(action==='live'){p.input('');p.advance(300);}else manual(p,action,'');
    samePage(lang + ': empty '+action+' clears output and status',[p.get('he-output').value,p.get('he-status').textContent],['','']);
    const count=p.copies.length;p.get('he-copy').click();eq(lang+': empty '+action+' cannot copy old output',p.copies.length,count);
  }
  for (const shellFirst of [false,true]) for (const modifiers of [{ctrlKey:true},{metaKey:true}]) {
    const q=pageVM(lang,shellFirst);manual(q,'decode','&lt;');const before=q.snapshot();q.key();samePage(lang+': outside CtrlL preserves page',q.snapshot(),before);
    q.get('he-output').focus();q.key('L',modifiers);
    samePage(`${lang}: CtrlL clears fields/status and persistence, sharedFirst=${shellFirst}`,[...q.snapshot().slice(0,4),q.cleared],['','','','he-status',['html-entity']]);
    q.input('&amp;');q.advance(300);eq(lang+': CtrlL retains last Decode direction',q.get('he-output').value,'&');
    q.input('queued &');q.get('he-clear').click();q.advance(300);samePage(lang+': Clear cancels pending result/status',[...q.snapshot().slice(0,4)],['','','','he-status']);
    q.input('&lt;');q.advance(300);eq(lang+': Clear retains last Decode direction',q.get('he-output').value,'<');
  }
}

const flushCopies = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function withResult(lang, shellFirst = false) {
  const p=pageVM(lang,shellFirst);manual(p,'encode','<a>😀&');return p;
}
for (const lang of Object.keys(localized)) {
  const t=localized[lang],expected='&lt;a&gt;&#128512;&amp;';
  {
    const p=withResult(lang);p.get('he-copy').click();const job=p.copies.at(-1);
    eq(lang+': clipboard receives complete actual output',job.value,expected);
    job.resolve();await flushCopies();samePage(lang+': current copy keeps conversion status',[p.get('he-copy').textContent,p.get('he-status').textContent],[t.copied,'Encoded — 4 characters converted.']);
    p.advance(1499);eq(lang+': feedback lasts 1500ms',p.get('he-copy').textContent,t.copied);
    p.advance(1);eq(lang+': current feedback expires',p.get('he-copy').textContent,t.copy);
    p.get('he-clear').click();const count=p.copies.length;p.get('he-copy').click();eq(lang+': empty result does not copy',p.copies.length,count);
  }
  for(const kind of ['reject','throw','missing']) {
    const p=withResult(lang),original=p.context.navigator.clipboard,start=unhandled.length;let thrown;
    if(kind==='missing')p.context.navigator.clipboard=undefined;
    if(kind==='throw')p.context.navigator.clipboard={writeText(){throw new Error('Clipboard blocked');}};
    try{p.get('he-copy').click();if(kind==='reject')p.copies.at(-1).reject(new Error('Clipboard denied'));}catch(error){thrown=error.message;}
    await flushCopies();eq(lang+'/'+kind+': failure stays inside handler',thrown,undefined);
    samePage(lang+'/'+kind+': no unhandled rejection',unhandled.slice(start),[]);
    samePage(lang+'/'+kind+': visible translated error',[p.get('he-status').textContent,p.get('he-status').className,p.get('he-copy').textContent],[t.copyFail,'he-status error',t.copy]);
    p.context.navigator.clipboard=original;p.get('he-copy').click();const retry=p.copies.at(-1);retry.resolve();await flushCopies();
    samePage(lang+'/'+kind+': same-output direct retry recovers',[retry.value,p.get('he-output').value,p.get('he-copy').textContent,p.get('he-status').textContent],[expected,expected,t.copied,'']);
  }
}

const copyBoundaries = ['clear','ctrlL','input','live-result','encode','decode','empty-live','empty-encode','empty-decode'];
function changeCopyContext(p, action) {
  if(action==='clear')p.get('he-clear').click();
  else if(action==='ctrlL'){p.get('he-input').focus();p.key();}
  else if(action==='input')p.input('new <text>');
  else if(action==='live-result'){p.input('new <text>');p.advance(300);}
  else if(action==='encode')manual(p,'encode','new &');
  else if(action==='decode')manual(p,'decode','new &amp;');
  else if(action==='empty-live'){p.input('');p.advance(300);}
  else if(action==='empty-encode')manual(p,'encode','');
  else if(action==='empty-decode')manual(p,'decode','');
}
for(const lang of Object.keys(localized)) {
  const t=localized[lang];
  for(const action of copyBoundaries)for(const shellFirst of action==='ctrlL'?[false,true]:[false])for(const outcome of ['resolve','reject']) {
    const p=withResult(lang,shellFirst);p.get('he-copy').click();const job=p.copies.at(-1);changeCopyContext(p,action);
    const before=p.snapshot(),start=unhandled.length;job[outcome](outcome==='reject'?new Error('late copy failed'):undefined);await flushCopies();
    samePage(`${lang}: late ${outcome} after ${action}, sharedFirst=${shellFirst}`,p.snapshot(),before);
    samePage(lang+': late copy rejection handled',unhandled.slice(start),[]);
  }
  for(const action of copyBoundaries)for(const shellFirst of action==='ctrlL'?[false,true]:[false]) {
    const p=withResult(lang,shellFirst);p.get('he-copy').click();p.copies.at(-1).resolve();await flushCopies();
    const timer=[...p.timers.values()].find(t=>t.delay===1500);changeCopyContext(p,action);
    eq(lang+': '+action+' immediately removes old Copied feedback',p.get('he-copy').textContent,t.copy);
    const before=p.snapshot();timer.fn();samePage(lang+': queued copy timer after '+action+' cannot write',p.snapshot(),before);
  }
  {
    const p=withResult(lang);p.get('he-copy').click();p.copies.at(-1).resolve();await flushCopies();
    const oldTimer=[...p.timers.values()].find(t=>t.delay===1500);p.advance(500);p.get('he-copy').click();p.copies.at(-1).resolve();await flushCopies();
    oldTimer.fn();eq(lang+': queued old timer cannot clear new Copied',p.get('he-copy').textContent,t.copied);
    p.advance(1000);eq(lang+': first deadline preserves new Copied',p.get('he-copy').textContent,t.copied);
    p.advance(500);eq(lang+': newest timer restores Copy',p.get('he-copy').textContent,t.copy);
  }
  {
    const p=withResult(lang);p.get('he-copy').click();const older=p.copies.at(-1);p.get('he-copy').click();p.copies.at(-1).resolve();await flushCopies();
    const before=p.snapshot();older.reject(new Error('older failed'));await flushCopies();samePage(lang+': older rejection cannot replace newest success',p.snapshot(),before);
    p.get('he-copy').click();const pending=p.copies.at(-1);p.get('he-copy').click();p.copies.at(-1).reject(new Error('latest failed'));await flushCopies();
    const failed=p.snapshot();pending.resolve();await flushCopies();samePage(lang+': older success cannot clear newest failure',p.snapshot(),failed);
    p.get('he-copy').click();p.copies.at(-1).resolve();await flushCopies();eq(lang+': latest same-result retry clears own failure',p.get('he-status').textContent,'');
  }
  for(const outcome of ['resolve','reject']) {
    const p=withResult(lang);p.input('new & result');p.get('he-copy').click();const between=p.copies.at(-1);
    eq(lang+': copy during debounce retains actual displayed value',between.value,'&lt;a&gt;&#128512;&amp;');
    p.advance(300);const before=p.snapshot();between[outcome](outcome==='reject'?new Error('copy of preceding display failed'):undefined);await flushCopies();
    samePage(lang+': live result invalidates copy started during debounce '+outcome,p.snapshot(),before);
  }
  {
    const p=withResult(lang);p.get('he-copy').click();p.copies.at(-1).reject(new Error('current failed'));await flushCopies();
    p.get('he-copy').click();const retry=p.copies.at(-1);manual(p,'decode','&amp;');const before=p.snapshot();retry.resolve();await flushCopies();
    samePage(lang+': retry success cannot erase later conversion status',p.snapshot(),before);
    p.input('later &');p.get('he-clear').click();eq(lang+': Clear cancels scheduled conversion', [...p.timers.values()].filter(t=>t.delay===300).length,0);
    p.input('new &');p.get('he-input').focus();p.key();eq(lang+': CtrlL cancels scheduled conversion', [...p.timers.values()].filter(t=>t.delay===300).length,0);
  }
}
const protectedEngine=source.slice(startIndex,endIndex+'/* ── engine:end ── */'.length);
eq('engine bytes preserved',createHash('sha256').update(protectedEngine).digest('hex'),'37c57f5a685464de55f5b7210e8489ed2ae725f4e79303ace17fd54d12333ffa');
const protectedDecode=source.slice(source.indexOf('      function decodeHtml(str)'),source.indexOf('      /* ── Real-time'));
eq('native textarea decode declaration preserved',createHash('sha256').update(protectedDecode).digest('hex'),'55dcadb46a88a32846de5e18c658761ac847145d87a30820fde0a6bd429ec533');

samePage('all page copy rejections handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
