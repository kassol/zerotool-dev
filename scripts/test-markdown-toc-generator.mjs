// Markdown TOC Generator — anchors match each platform's heading-id rules
//
// Read:  src/components/tools/MarkdownTocGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), node_modules/github-slugger,
//        src/content/tools/markdown-toc-generator/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// References (not hand-written rules):
//   - GitHub: github-slugger 2.0.0 (`GithubSlugger#slug`, also used by Astro and rehype-slug),
//     run over a heading corpus and over every BMP code point.
//   - GitLab: the examples in the GitLab docs, "Heading anchors" (GitLab 17.0+ rules).
//   - Jekyll (kramdown-parser-gfm 1.1.0, Jekyll's default `input: GFM`) and kramdown
//     (kramdown 2.5.2, `input: kramdown`): the ids below were produced by running those gems
//     (Ruby 2.6.10) on the same corpus; see KRAMDOWN_IDS.
//   - Bitbucket Cloud: the `markdown-header-` prefix (Atlassian issue BCLOUD-8276).
// Defects covered (before the fix): Bitbucket prefix `markdown-`; GitHub style deleted "_",
// collapsed runs of spaces and trimmed hyphens; GitLab style collapsed "--" (GitLab 17.0+ does
// not); Jekyll style dropped non-ASCII (Jekyll's GFM parser keeps it) and never produced
// "section"; ids were de-duplicated only among headings inside the chosen level range;
// "a", "a-1", "a" gave a duplicate id; `## C#` lost its "#".
//
// Run: node scripts/test-markdown-toc-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { parseFragment } from 'parse5';
import { loadPage } from './astro-page-harness.mjs';
import GithubSlugger, { slug as githubSlug } from 'github-slugger';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownTocGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MarkdownTocGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { parseHeadings, slugify, dedupe, renderTOC };')();

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
const ids = (titles, style) => E.dedupe(titles.map((t) => E.slugify(t, style)), style);

const CORPUS = ['Getting Started', 'Getting Started', 'Install', 'Install-1', 'Install', 'Héllo, World! 中文', 'API_v2 & config.yml', '1. Intro', 'Spaces  around', '!!!', 'Ⓐ circled', 'Ünïcödé — dash', 'C++ / C#', '日本語の見出し', '한국어 제목', 'Tab\there', 'emoji 🚀 launch', "Q&A: what's new?", 'Install'];

// kramdown 2.5.2 + kramdown-parser-gfm 1.1.0 on Ruby 2.6.10, `## <title>` per line, ids read
// from to_html (null = no id attribute).
const KRAMDOWN_IDS = {
  gfm: ['getting-started', 'getting-started-1', 'install', 'install-1', 'install-1', 'héllo-world-中文', 'api_v2--configyml', '1-intro', 'spaces--around', null, 'ⓐ-circled', 'ünïcödé--dash', 'c--c', '日本語の見出し', '한국어-제목', 'tab-here', 'emoji--launch', 'qa-whats-new', 'install-2'],
  kramdown: ['getting-started', 'getting-started-1', 'install', 'install-1', 'install-1', 'hllo-world-', 'apiv2--configyml', 'intro', 'spaces--around', 'section', 'circled', 'ncd--dash', 'c--c', 'section-1', 'section-2', 'tabhere', 'emoji--launch', 'qa-whats-new', 'install-2'],
};

// ── 1. GitHub against github-slugger ──
{
  const slugger = new GithubSlugger();
  eq('github ids for the corpus', ids(CORPUS, 'github'), CORPUS.map((t) => slugger.slug(t)));
  const s2 = new GithubSlugger();
  const tricky = ['a', 'a-1', 'a', 'a', 'a-2', 'A', '_x_', ' lead', 'trail ', 'two  spaces', '--', ''];
  eq('github de-duplication matches github-slugger', ids(tricky, 'github'), tricky.map((t) => s2.slug(t)));
  // Every BMP code point: github-slugger 2.0.0's table predates Unicode 14, so the only allowed
  // difference is a letter / mark / digit that the tool keeps and the old table drops.
  let bad = 0; let newer = 0; let firstBad = '';
  for (let cp = 0; cp <= 0xFFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue;
    const ch = String.fromCodePoint(cp);
    const a = E.slugify('x' + ch + 'y', 'github');
    const b = githubSlug('x' + ch + 'y');
    if (a === b) continue;
    if (b === 'xy' && /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}]/u.test(ch)) { newer++; continue; }
    bad++;
    if (!firstBad) firstBad = 'U+' + cp.toString(16) + ' tool ' + a + ' slugger ' + b;
  }
  check('github: every BMP code point matches github-slugger (except characters newer than its table)', bad === 0, bad + ' differ, first ' + firstBad);
  check('github: characters newer than github-slugger\'s table stay under 200', newer < 200, String(newer));
}

// ── 2. GitLab docs example ──
eq('gitlab docs example', ids([
  'This heading has spaces in it',
  'This heading has a :thumbsup: in it',
  'This heading has Unicode in it: 한글',
  'This heading has spaces in it',
  'This heading has spaces in it',
  'This heading has 3.5 in it (and parentheses)',
  'This heading has  multiple spaces and --- hyphens_and_underscores',
], 'gitlab'), [
  'this-heading-has-spaces-in-it',
  'this-heading-has-a-thumbsup-in-it',
  'this-heading-has-unicode-in-it-한글',
  'this-heading-has-spaces-in-it-1',
  'this-heading-has-spaces-in-it-2',
  'this-heading-has-35-in-it-and-parentheses',
  'this-heading-has--multiple-spaces-and-----hyphens_and_underscores',
]);

// ── 3. Jekyll (GFM) and kramdown against the gems' output ──
const jek = ids(CORPUS, 'jekyll');
eq('jekyll (kramdown GFM) ids', jek.map((x) => (x === '' ? null : x)), KRAMDOWN_IDS.gfm);
eq('kramdown ids', ids(CORPUS, 'kramdown'), KRAMDOWN_IDS.kramdown);

// ── 4. Bitbucket ──
eq('bitbucket prefix', ids(['Getting Started', 'Getting Started'], 'bitbucket'), ['markdown-header-getting-started', 'markdown-header-getting-started_1']);

// ── 5. heading parser ──
eq('ATX closing sequence needs a space', E.parseHeadings('## C#\n## Title ##\n##No space\n   ### Indented\n    #### Code').map((h) => h.text), ['C#', 'Title', 'Indented']);
eq('setext and fences', E.parseHeadings('Top\n===\n\n```\n# not\n```\nSub\n---').map((h) => [h.level, h.text]), [[1, 'Top'], [2, 'Sub']]);

// ── 6. ids count all headings, not just the ones in the TOC ──
{
  const md = '# Setup\n## Setup\n### Setup\n## Usage\n#### Setup';
  const toc = E.renderTOC(E.parseHeadings(md), { minLevel: 2, maxLevel: 3, includeH1: true, bullet: '-', indent: '2', style: 'github' });
  eq('level range does not reset de-duplication', toc, '- [Setup](#setup-1)\n  - [Setup](#setup-2)\n- [Usage](#usage)');
}
{
  const toc = E.renderTOC(E.parseHeadings('## A_b c\n## A_b c'), { minLevel: 1, maxLevel: 6, includeH1: true, bullet: '-', indent: '2', style: 'gitlab' });
  eq('gitlab keeps underscores and de-duplicates', toc, '- [A_b c](#a_b-c)\n- [A_b c](#a_b-c-1)');
}

// ── 7. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/markdown-toc-generator', lang + '.mdx'), 'utf8');
  check(lang + ': page uses the markdown-header- prefix for Bitbucket', mdx.includes("markdown-header-") && !/#markdown-(?!header-)|<code>markdown-<\/code>/.test(mdx), lang);
  check(lang + ': page has 2 annotated TOC examples', [...mdx.matchAll(/\{\/\* mtoc: /g)].length === 2, lang);
  for (const m of mdx.matchAll(/\{\/\* mtoc: (\{.*?\}) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)) {
    const spec = JSON.parse(m[1]);
    const toc = E.renderTOC(E.parseHeadings(spec.md), Object.assign({ minLevel: 1, maxLevel: 6, includeH1: true, bullet: '-', indent: '2', style: 'github' }, spec.opts || {}));
    eq(lang + ': example ' + (spec.opts && spec.opts.style || 'github'), m[2].trim(), toc);
  }
}

// ---------- real complete page lifecycle + actual shared shortcut ----------
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const sharedShortcut = layoutSource.slice(layoutSource.indexOf('      // ── Keyboard shortcuts:'), layoutSource.indexOf('      // ── Copy button visual feedback'));
check('real shared shortcut extracted', sharedShortcut.includes('window.ztPersist.clear(_slug)'));
const allLabels = vm.runInNewContext(ts.transpileModule('const labels = ' + source.match(/const labels = ([\s\S]*?);\n\nconst L/)[1] + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nlabels');
function page({ lang = 'en', order = 'before', preset = '' } = {}) {
  const L = allLabels[lang], keys = [], requests = [], clears = [], fallback = [];
  const timers = new Map(); let seq = 0, clock = 0, document, selection = null;
  const escape = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'))
    .replace(/=\{([^{}]+)\}/g, (_, expr) => '="' + escape(vm.runInNewContext(expr,{L,lang})) + '"').replace(/\{L\.(\w+)\}/g, (_, k) => escape(L[k]));
  const walk = n => n.children.flatMap(c => [c, ...walk(c)]);
  function wrap(n, parentNode = null) {
    if (!n.tagName) return { value: n.value || '', parentNode };
    const attrs = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value])), listeners = {};
    const el = { tagName: n.tagName.toUpperCase(), parentNode, childNodes: [], attributes: attrs, value: attrs.value || '', disabled: 'disabled' in attrs, checked: 'checked' in attrs, hidden: 'hidden' in attrs,
      dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k,v]) => [k.slice(5).replace(/-([a-z])/g, (_,x) => x.toUpperCase()),v])),
      get id() { return attrs.id || ''; }, get children() { return this.childNodes.filter(x => x.tagName); },
      get className() { return attrs.class || ''; }, set className(v) { attrs.class = v; },
      get textContent() { return this.childNodes.map(x => x.tagName ? x.textContent : x.value).join(''); }, set textContent(v) { this.childNodes = [{ value: String(v), parentNode: this }]; },
      getAttribute(k) { return attrs[k] ?? null; }, setAttribute(k,v) { attrs[k] = String(v); },
      contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; },
      querySelectorAll(sel) { if (sel === 'textarea, input[type="text"]') return walk(this).filter(x => x.tagName === 'TEXTAREA' || x.tagName === 'INPUT' && x.attributes.type === 'text'); throw Error('Unhandled selector ' + sel); },
      addEventListener(k, fn) { (listeners[k] ||= []).push(fn); }, focus() { document.activeElement = this; }, select() { selection = this; },
      dispatch(k, init = {}) { const e = { type:k, target:this, currentTarget:this, defaultPrevented:false, cancelBubble:false, preventDefault(){this.defaultPrevented=true;}, stopPropagation(){this.cancelBubble=true;}, ...init }; for (const fn of listeners[k] || []) fn.call(this,e); if (k === 'keydown' && !e.cancelBubble) for (const fn of keys) fn(e); return e; },
      click() { if (!this.disabled) this.dispatch('click'); },
    };
    el.classList = { contains:c => el.className.split(/\s+/).includes(c), add(c){ if (!this.contains(c)) el.className += ' ' + c; }, remove(c){ el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } };
    el.childNodes = (n.childNodes || []).map(x => wrap(x,el)); if (el.tagName === 'TEXTAREA') el.value = el.textContent; if (el.tagName === 'SELECT') el.value = el.children.find(x => 'selected' in x.attributes)?.attributes.value || el.children[0]?.attributes.value || ''; return el;
  }
  const body = wrap({tagName:'body'}), widget = wrap({tagName:'section',attrs:[{name:'class',value:'tool-widget'}],childNodes:parseFragment(markup).childNodes},body); body.childNodes.push(widget);
  document = { body, documentElement:{lang}, activeElement:body,
    getElementById(id) { const e = walk(body).find(x => x.id === id); if (!e) throw Error('Missing actual DOM ' + id); return e; },
    querySelector(sel) { if (sel === '.tool-widget .btn-primary') return walk(widget).find(x => x.classList.contains('btn-primary')) || null; return walk(body).find(x => x.classList.contains(sel.slice(1))) || null; },
    addEventListener(k,fn) { if (k === 'keydown') keys.push(fn); }, createElement:tag => wrap({tagName:tag}), execCommand(command){fallback.push({command,text:selection?.value});if(options.fallbackThrows)throw Error('fallback refusal');return options.fallbackSuccess;},
  };
  const $ = id => document.getElementById(id), input = $('mtoc-input'); input.value = preset;
  const options={fallbackSuccess:false,fallbackThrows:false};
  const globals = { document,
    navigator:{ clipboard:{writeText(text){return new Promise((resolve,reject)=>requests.push({text,resolve,reject}));}} },
    setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,delay,due:clock+delay});return id;}, clearTimeout(id){timers.delete(id);},
    ztPersist:{clear(slug){clears.push(slug);}},
  };
  if (order === 'before') { const ctx={...globals,_slug:'markdown-toc-generator'};ctx.window=ctx;vm.runInNewContext(sharedShortcut,ctx); }
  const loaded=loadPage('src/components/tools/MarkdownTocGeneratorTool.astro',{lang,globals});
  if (order === 'after') loaded.run('var _slug="markdown-toc-generator";\n'+sharedShortcut);
  return {$,input,output:$('mtoc-toc'),status:$('mtoc-status'),copy:$('mtoc-copy-toc'),requests,clears,fallback,options,globals,document,timers,
    advance(ms){const end=clock+ms;for(let guard=0;;guard++){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;if(guard>100)throw Error('Timer runaway');clock=next[1].due;timers.delete(next[0]);next[1].fn();}clock=end;},
    type(v){input.focus();input.value=v;input.dispatch('input');}, render(v){this.type(v);},
    key(meta=false,focus='mtoc-copy-toc'){ $(focus).focus();return $(focus).dispatch('keydown',{key:'l',ctrlKey:!meta,metaKey:meta}); },
    snapshot(){return JSON.stringify([input.value,this.output.value,this.status.textContent,this.copy.textContent]);},
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const copyFailures={en:'Copy failed',zh:'复制失败',ja:'コピー失敗',ko:'복사 실패'};
const unhandled=[];const recordUnhandled=e=>unhandled.push(String(e));process.on('unhandledRejection',recordUnhandled);
const tocGolden='- [Alpha](#alpha)',mdGolden='<!-- toc -->\n- [Alpha](#alpha)\n<!-- /toc -->\n\n## Alpha';
function markerPage(options={}){const p=page(options);p.$('mtoc-marker-mode').checked=true;p.$('mtoc-marker-mode').dispatch('change');p.render('## Alpha');return p;}
for(const lang of ['en','zh','ja','ko']){
  const L=allLabels[lang],p=markerPage({lang,preset:'## Early'});
  eq(lang+' immediate actual heading render',p.output.value,tocGolden);eq(lang+' actual inserted Markdown',p.$('mtoc-md').value,mdGolden);eq(lang+' heading count',p.status.textContent,L.headings(1));eq(lang+' marker status',p.$('mtoc-md-status').textContent,L.markerInserted);
  p.$('mtoc-anchor').value='bitbucket';p.$('mtoc-anchor').dispatch('change');eq(lang+' option updates without Generate',p.output.value,'- [Alpha](#markdown-header-alpha)');
  p.$('mtoc-bullet').value='1.';p.$('mtoc-bullet').dispatch('input');eq(lang+' option input remains immediate',p.output.value,'1. [Alpha](#markdown-header-alpha)');
  const early=page({lang,preset:'## Early'});eq(lang+' early input remains rendered',early.output.value,'- [Early](#early)');
  for(const [button,field,label,golden] of [['mtoc-copy-toc','mtoc-toc',L.copyToc,tocGolden],['mtoc-copy-md','mtoc-md',L.copyMd,mdGolden]]){
    const q=markerPage({lang}),copy=q.$(button);copy.click();eq(lang+' '+button+' exact full bytes',q.requests[0].text,golden);q.requests[0].resolve();await settle();eq(lang+' '+button+' normal success',copy.textContent,L.copied);q.advance(1200);eq(lang+' '+button+' original 1200ms feedback',copy.textContent,label);
    for(const mode of ['reject','missing','throw']){
      const r=markerPage({lang}),btn=r.$(button);if(mode==='missing')r.globals.navigator.clipboard=undefined;if(mode==='throw')r.globals.navigator.clipboard.writeText=()=>{throw Error('denied');};
      let thrown=false;try{btn.click();}catch{thrown=true;}if(mode==='reject')r.requests[0].reject(Error('denied'));await settle();check(lang+' '+button+' '+mode+' does not throw',!thrown);eq(lang+' '+button+' '+mode+' fallback attempts exact output',r.fallback.at(-1),{command:'copy',text:golden});eq(lang+' '+button+' '+mode+' false fallback reports failure',btn.textContent,copyFailures[lang]);
      r.globals.navigator.clipboard={writeText(text){return new Promise((resolve,reject)=>r.requests.push({text,resolve,reject}));}};btn.click();r.requests.at(-1).resolve();await settle();eq(lang+' '+button+' '+mode+' identical output retry',btn.textContent,L.copied);eq(lang+' '+button+' '+mode+' unchanged output',r.$(field).value,golden);
    }
    for(const fallbackSuccess of [true,false]){
      const r=markerPage({lang});r.options.fallbackSuccess=fallbackSuccess;r.options.fallbackThrows=!fallbackSuccess;r.$(button).click();r.requests[0].reject(Error('denied'));await settle();eq(lang+' '+button+' fallback '+(fallbackSuccess?'success':'throw'),r.$(button).textContent,fallbackSuccess?L.copied:copyFailures[lang]);
    }
    for(const boundary of ['input','empty','CtrlL','option','marker'])for(const outcome of ['resolve','reject']){
      const r=markerPage({lang});r.$(button).click();if(boundary==='input')r.type('## Beta');else if(boundary==='empty')r.type('');else if(boundary==='CtrlL')r.key();else if(boundary==='option'){r.$('mtoc-bullet').value='*';r.$('mtoc-bullet').dispatch('change');}else{r.$('mtoc-marker-mode').checked=false;r.$('mtoc-marker-mode').dispatch('change');}
      const before=JSON.stringify([r.$(button).textContent,r.output.value,r.$('mtoc-md').value,r.status.textContent,r.$('mtoc-md-status').textContent,r.fallback]);r.requests[0][outcome](Error('old'));await settle();eq(lang+' '+button+' stale '+outcome+' after '+boundary,JSON.stringify([r.$(button).textContent,r.output.value,r.$('mtoc-md').value,r.status.textContent,r.$('mtoc-md-status').textContent,r.fallback]),before);
    }
    for(const outcome of ['resolve','reject']){
      const r=markerPage({lang});r.$(button).click();r.$(button).click();r.requests[1].resolve();await settle();r.requests[0][outcome](Error('older'));await settle();eq(lang+' '+button+' old '+outcome+' cannot replace current copied state',r.$(button).textContent,L.copied);eq(lang+' '+button+' stale reject never falls back',r.fallback.length,0);
    }
    const r=markerPage({lang});r.$(button).click();r.requests[0].resolve();await settle();const timer=[...r.timers.values()].find(t=>t.delay===1200);r.advance(100);r.$(button).click();r.requests[1].resolve();await settle();timer.fn();eq(lang+' '+button+' old timer leaves newer feedback',r.$(button).textContent,L.copied);r.advance(1200);eq(lang+' '+button+' latest timer returns original label',r.$(button).textContent,label);
  }
  for(const order of ['before','after']){
    const q=markerPage({lang,order});q.$('mtoc-anchor').value='gitlab';q.$('mtoc-anchor').dispatch('change');q.key(order==='after','mtoc-copy-md');eq(lang+' '+order+' CtrlL clears outputs/status and disables both copies',[q.input.value,q.output.value,q.$('mtoc-md').value,q.status.textContent,q.$('mtoc-md-status').textContent,q.copy.disabled,q.$('mtoc-copy-md').disabled],['','','','','',true,true]);eq(lang+' '+order+' focus remains in stable input',q.document.activeElement.id,'mtoc-input');eq(lang+' '+order+' shared persistence clear',q.clears,['markdown-toc-generator']);eq(lang+' '+order+' settings survive',[q.$('mtoc-anchor').value,q.$('mtoc-marker-mode').checked],['gitlab',true]);
    q.type('## Restored');eq(lang+' '+order+' input recovers immediately',q.output.value,'- [Restored](#restored)');
  }
  const q=markerPage({lang});q.$('mtoc-copy-toc').click();q.$('mtoc-copy-md').click();q.requests[1].resolve();q.requests[0].resolve();await settle();eq(lang+' independent buttons both complete',[q.copy.textContent,q.$('mtoc-copy-md').textContent],[L.copied,L.copied]);
}
await settle();eq('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',recordUnhandled);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
