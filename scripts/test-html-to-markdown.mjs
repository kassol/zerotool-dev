// HTML to Markdown — converter options, fenced code language, GFM table cells
//
// Read:  src/components/tools/HtmlToMarkdownTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers), node_modules/turndown and
//        node_modules/turndown-plugin-gfm, public/vendor/turndown*.js
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the page loads the same turndown / turndown-plugin-gfm code as node_modules
// (whitespace-insensitive compare), so running the engine with the npm packages tests the
// shipped behaviour; ATX headings, `-` bullets, `*` emphasis, `* * *` rules, fenced code with
// the language from `language-*`; a literal | in a table cell is escaped as \| and a line
// break in a cell becomes <br> (both used to split the row); tables without a header row are
// kept as HTML; the examples on the English tool page.
//
// Run: node scripts/test-html-to-markdown.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import { loadPage } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/HtmlToMarkdownTool.astro'), 'utf8');

const startIndex = source.indexOf('// engine:start');
const endIndex = source.indexOf('// engine:end');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlToMarkdownTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const createConverter = new Function(block + '\nreturn createConverter;')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail ? '\n  ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

const squash = (s) => s.replace(/\s+/g, '');
check('vendor turndown is the npm browser build',
  squash(readFileSync(join(root, 'public/vendor/turndown.umd.js'), 'utf8')) ===
  squash(readFileSync(join(root, 'node_modules/turndown/lib/turndown.browser.umd.js'), 'utf8')));
check('vendor turndown-plugin-gfm is the npm build',
  squash(readFileSync(join(root, 'public/vendor/turndown-plugin-gfm.js'), 'utf8')) ===
  squash(readFileSync(join(root, 'node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js'), 'utf8')));

const td = createConverter(require('turndown'), require('turndown-plugin-gfm'));
const md = (html) => td.turndown(html);

// ---------- options ----------
eq('atx heading', md('<h1>Title</h1>'), '# Title');
eq('bullet marker and nested list',
  md('<ul><li>Step one</li><li>Step two<ul><li>Sub step</li></ul></li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>'),
  '-   Step one\n-   Step two\n    -   Sub step\n\n3.  Third\n4.  Fourth');
eq('emphasis', md('<p><strong>b</strong> <em>i</em></p>'), '**b** *i*');
eq('horizontal rule keeps the turndown default', md('<hr>'), '* * *');
eq('br is two spaces + newline', md('line one<br>line two'), 'line one  \nline two');
eq('markdown characters in text are escaped', md('<p>5 * 3, _a_</p>'), '5 \\* 3, \\_a\\_');
eq('link with title', md('<h2>Install</h2><p>Run <code>npm i turndown</code> and see the <a href="https://github.com/mixmark-io/turndown" title="repo">README</a>.</p>'),
  '## Install\n\nRun `npm i turndown` and see the [README](https://github.com/mixmark-io/turndown "repo").');
eq('image', md('<img src="a.png" alt="Logo">'), '![Logo](a.png)');
eq('del is not converted (strikethrough plugin not loaded)', md('<p><del>old</del> new</p>'), 'old new');

// ---------- code ----------
eq('fenced code with language', md('<pre><code class="language-python">print("hi")\n</code></pre>'), '```python\nprint("hi")\n```');
eq('fenced code without language', md('<pre><code>x = 1</code></pre>'), '```\nx = 1\n```');
eq('pre without code is not fenced', md('<pre>a\n  b</pre>'), 'a\n  b');

// ---------- tables ----------
eq('header table', md('<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Alice</td><td>Engineer</td></tr></tbody></table>'),
  '| Name | Role |\n| --- | --- |\n| Alice | Engineer |');
eq('pipe in a cell is escaped', md('<table><tr><th>Flag</th><th>Meaning</th></tr><tr><td><code>a|b</code></td><td>x | y</td></tr></table>'),
  '| Flag | Meaning |\n| --- | --- |\n| `a\\|b` | x \\| y |');
eq('br in a cell becomes <br>', md('<table><tr><th>H</th></tr><tr><td>line<br>break</td></tr></table>'),
  '| H |\n| --- |\n| line<br>break |');
eq('first cell prefix', md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
  '| A | B |\n| --- | --- |\n| 1 | 2 |');
eq('table without header row stays HTML', md('<table><tr><td>A</td></tr></table>'),
  '<table><tbody><tr><td>A</td></tr></tbody></table>');

// ---------- page example ----------
eq('page example: release notes table',
  md('<table><thead><tr><th>Option</th><th>Values</th></tr></thead><tbody><tr><td><code>--format</code></td><td>json | yaml<br>default: json</td></tr></tbody></table>'),
  '| Option | Values |\n| --- | --- |\n| `--format` | json \\| yaml<br>default: json |');

// ---------- real complete page lifecycle + actual shared shortcut ----------
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const sharedShortcut = layoutSource.slice(layoutSource.indexOf('      // ── Keyboard shortcuts:'), layoutSource.indexOf('      // ── Copy button visual feedback'));
check('real shared shortcut extracted', sharedShortcut.includes('window.ztPersist.clear(_slug)'));
const allLabels = vm.runInNewContext('(' + source.match(/const labels = ([\s\S]*?);\n\nconst L/)[1] + ')');
function page({ lang = 'en', order = 'before', preset = '' } = {}) {
  const L = allLabels[lang], keys = [], requests = [], tracks = [], clears = [], downloads = [], urls = [];
  const timers = new Map(); let seq = 0, clock = 0, document;
  const escape = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'))
    .replace(/=\{L\.(\w+)\}/g, (_, k) => '="' + escape(L[k]) + '"').replace(/\{L\.(\w+)\}/g, (_, k) => escape(L[k]));
  const walk = n => n.children.flatMap(c => [c, ...walk(c)]);
  function wrap(n, parentNode = null) {
    if (!n.tagName) return { value: n.value || '', parentNode };
    const attrs = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value])), listeners = {};
    const el = { tagName: n.tagName.toUpperCase(), parentNode, childNodes: [], attributes: attrs, value: attrs.value || '', disabled: 'disabled' in attrs,
      dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5).replace(/-([a-z])/g, (_,x) => x.toUpperCase()),v])),
      get id() { return attrs.id || ''; }, get children() { return this.childNodes.filter(x => x.tagName); },
      get className() { return attrs.class || ''; }, set className(v) { attrs.class = v; },
      get textContent() { return this.childNodes.map(x => x.tagName ? x.textContent : x.value).join(''); }, set textContent(v) { this.childNodes = [{ value: String(v), parentNode: this }]; },
      getAttribute(k) { return attrs[k] ?? null; }, setAttribute(k,v) { attrs[k] = String(v); },
      contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; },
      querySelectorAll(sel) { if (sel === 'textarea, input[type="text"]') return walk(this).filter(x => x.tagName === 'TEXTAREA' || x.tagName === 'INPUT' && x.attributes.type === 'text'); throw Error('Unhandled selector ' + sel); },
      addEventListener(k, fn) { (listeners[k] ||= []).push(fn); }, focus() { document.activeElement = this; },
      dispatch(k, init = {}) { const e = { type:k, target:this, currentTarget:this, defaultPrevented:false, cancelBubble:false, preventDefault(){this.defaultPrevented=true;}, stopPropagation(){this.cancelBubble=true;}, ...init }; for (const fn of listeners[k] || []) fn.call(this,e); if (k === 'keydown' && !e.cancelBubble) for (const fn of keys) fn(e); return e; },
      click() { if (this.tagName === 'A') downloads.push({ href:this.href, name:this.download }); else if (!this.disabled) this.dispatch('click'); },
    };
    el.classList = { contains:c => el.className.split(/\s+/).includes(c), add(c){ if (!this.contains(c)) el.className += ' ' + c; }, remove(c){ el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } };
    el.childNodes = (n.childNodes || []).map(x => wrap(x,el)); if (el.tagName === 'TEXTAREA') el.value = el.textContent; return el;
  }
  const body = wrap({tagName:'body'}), widget = wrap({tagName:'section',attrs:[{name:'class',value:'tool-widget'}],childNodes:parseFragment(markup).childNodes},body); body.childNodes.push(widget);
  document = { body, documentElement:{lang}, activeElement:body,
    getElementById(id) { const e = walk(body).find(x => x.id === id); if (!e) throw Error('Missing actual DOM ' + id); return e; },
    querySelector(sel) { if (sel === '.tool-widget .btn-primary') return walk(widget).find(x => x.classList.contains('btn-primary')) || null; return walk(body).find(x => x.classList.contains(sel.slice(1))) || null; },
    addEventListener(k,fn) { if (k === 'keydown') keys.push(fn); }, createElement:tag => wrap({tagName:tag}), execCommand(){throw Error('No fallback or OS clipboard permitted');},
  };
  const $ = id => document.getElementById(id), input = $('htm-input'); input.value = preset;
  const globals = { document, TurndownService:require('turndown'), turndownPluginGfm:require('turndown-plugin-gfm'), Blob,
    URL:{ createObjectURL(blob){urls.push(blob);return 'blob:fixture/'+urls.length;}, revokeObjectURL(){} },
    navigator:{ clipboard:{writeText(text){return new Promise((resolve,reject)=>requests.push({text,resolve,reject}));}} },
    setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,delay,due:clock+delay});return id;}, clearTimeout(id){timers.delete(id);},
    trackTool(...x){tracks.push(x);}, ztPersist:{clear(slug){clears.push(slug);}},
  };
  if (order === 'before') { const ctx={...globals,_slug:'html-to-markdown'};ctx.window=ctx;vm.runInNewContext(sharedShortcut,ctx); }
  const loaded=loadPage('src/components/tools/HtmlToMarkdownTool.astro',{lang,globals});
  if (order === 'after') loaded.run('var _slug="html-to-markdown";\n'+sharedShortcut);
  return {$,input,output:$('htm-output'),status:$('htm-status'),copy:$('htm-copy'),requests,tracks,clears,downloads,urls,globals,document,timers,
    advance(ms){const end=clock+ms;for(let guard=0;;guard++){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;if(guard>100)throw Error('Timer runaway');clock=next[1].due;timers.delete(next[0]);next[1].fn();}clock=end;},
    type(v){input.focus();input.value=v;input.dispatch('input');}, render(v){this.type(v);this.advance(300);},
    key(meta=false,focus='htm-copy'){ $(focus).focus();return $(focus).dispatch('keydown',{key:'l',ctrlKey:!meta,metaKey:meta}); },
    snapshot(){return JSON.stringify([input.value,this.output.value,this.status.textContent,this.copy.textContent]);},
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const copyFailures = {en:'Copy failed',zh:'复制失败',ja:'コピー失敗',ko:'복사 실패'};
const unhandled=[]; const recordUnhandled=e=>unhandled.push(String(e)); process.on('unhandledRejection',recordUnhandled);
for (const lang of ['en','zh','ja','ko']) {
  const L=allLabels[lang], early=page({lang,preset:'<h2>Typed early</h2>'});
  eq(lang+' early input survives script startup',early.input.value,'<h2>Typed early</h2>');eq(lang+' early HTML converts immediately',early.output.value,'## Typed early');
  const p=page({lang}); check(lang+' initial sample remains',p.input.value.startsWith('<h1>HTML to Markdown Example</h1>'));check(lang+' real default output remains',p.output.value.startsWith('# HTML to Markdown Example'));
  const initial=p.output.value;p.type('<h2>Alpha</h2>');p.advance(299);eq(lang+' 300ms debounce retains previous result until due',p.output.value,initial);p.advance(1);eq(lang+' real Turndown emits literal golden',p.output.value,'## Alpha');
  p.$('htm-download').click();eq(lang+' download filename',p.downloads[0].name,'output.md');eq(lang+' download exact Markdown',await p.urls[0].text(),'## Alpha');
  p.copy.click();eq(lang+' copy full output bytes',p.requests[0].text,'## Alpha');p.requests[0].resolve();await settle();eq(lang+' current copy succeeds',p.copy.textContent,L.copied);p.advance(1500);eq(lang+' current timer restores label',p.copy.textContent,L.copy);
  for (const failure of ['reject','missing','throw']) {
    const q=page({lang});q.render('<h2>Alpha</h2>');
    if(failure==='missing')q.globals.navigator.clipboard=undefined;if(failure==='throw')q.globals.navigator.clipboard.writeText=()=>{throw Error('denied');};
    let thrown=false;try{q.copy.click();}catch{thrown=true;}if(failure==='reject')q.requests[0].reject(Error('denied'));await settle();
    check(lang+' '+failure+' handled without throwing',!thrown);eq(lang+' '+failure+' is visible',q.copy.textContent,copyFailures[lang]);
    q.globals.navigator.clipboard={writeText(text){return new Promise((resolve,reject)=>q.requests.push({text,resolve,reject}));}};
    q.copy.click();q.requests.at(-1).resolve();await settle();eq(lang+' '+failure+' same-result direct retry',q.copy.textContent,L.copied);eq(lang+' '+failure+' keeps output',q.output.value,'## Alpha');
  }
  for(const order of ['before','after']) {
    const q=page({lang,order});q.render('x'.repeat(1024*1024+1));check(lang+' large-input warning positive control',!!q.status.textContent);q.type('<h2>Queued</h2>');
    q.key(order==='after');eq(lang+' '+order+' CtrlL clears all derived fields',JSON.stringify([q.input.value,q.output.value,q.status.textContent,q.copy.textContent]),JSON.stringify(['','','',L.copy]));eq(lang+' '+order+' CtrlL stabilizes focus',q.document.activeElement.id,'htm-input');eq(lang+' '+order+' real shared storage clear',JSON.stringify(q.clears),JSON.stringify(['html-to-markdown']));
    const before=q.snapshot();q.advance(300);eq(lang+' '+order+' no old conversion after shortcut',q.snapshot(),before);q.copy.click();eq(lang+' '+order+' empty cannot copy',q.requests.length,0);
  }
  for(const boundary of ['input','clear','CtrlL','example','new-result'])for(const outcome of ['resolve','reject']) {
    const q=page({lang});q.render('<h2>Alpha</h2>');q.copy.click();
    if(boundary==='input')q.type('<h2>Beta</h2>');else if(boundary==='clear')q.$('htm-clear').click();else if(boundary==='CtrlL')q.key();else if(boundary==='example')q.$('htm-example').click();else q.render('<h2>Beta</h2>');
    const before=q.snapshot();q.requests[0][outcome](Error('old request'));await settle();eq(lang+' stale '+outcome+' after '+boundary,q.snapshot(),before);
  }
  const q=page({lang});q.render('<h2>Alpha</h2>');q.copy.click();q.requests[0].resolve();await settle();const oldTimer=[...q.timers.values()].find(t=>t.delay===1500);q.advance(100);q.copy.click();q.requests[1].resolve();await settle();oldTimer.fn();eq(lang+' stale timer cannot erase newer copy',q.copy.textContent,L.copied);q.advance(1500);eq(lang+' latest timer restores Copy',q.copy.textContent,L.copy);
  const r=page({lang});r.type('<p>Queued</p>');r.$('htm-clear').click();const cleared=r.snapshot();r.advance(300);eq(lang+' Clear keeps empty state',r.snapshot(),cleared);
  r.input.value='<h2>Unannounced edit</h2>';r.advance(300);eq(lang+' Clear leaves no queued conversion',r.output.value,'');
}
await settle();eq('no unhandled copy rejection',unhandled.length,0);process.removeListener('unhandledRejection',recordUnhandled);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
