// CSS Specificity Calculator — specificity per Selectors Level 4 §17
//
// Read:  src/components/tools/CssSpecificityCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); the 4 tool pages under src/content/tools/css-specificity-calculator/
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected values are the examples in Selectors Level 4 §17 and the MDN "Specificity" page,
// plus values worked out by hand from the §17 rules. Covers the reported defects: class
// selectors were stripped before functional pseudo-classes, so `:where(.active, p)` gave (0,1,0);
// `:is()` / `:not()` / `:has()` summed their arguments instead of taking the most specific one;
// `:nth-child(2n+1)` counted `n` as a type selector; `#top` inside an attribute value counted as
// an ID; commas inside `:is()` / `:where()` split the input into separate selectors.
// Also: `:nth-child(An+B of S)`, legacy pseudo-elements, `::slotted()` / `:host()` (CSS Scoping),
// namespace prefixes, escapes, `&`, syntax errors with positions, 4-language STRINGS keys,
// the examples quoted on the 4 tool pages.
//
// Run: node scripts/test-css-specificity-calculator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import domino from '@mixmark-io/domino';
import { loadPage, frontmatterStrings } from './astro-page-harness.mjs';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssSpecificityCalculatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CssSpecificityCalculatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { specificity, splitSelectorList };')();

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
function spec(sel) {
  try { const s = E.specificity(sel); return [s.a, s.b, s.c]; } catch (e) { return 'error: ' + e.message; }
}

// ---------- Selectors Level 4 §17 examples ----------
const SPEC_EXAMPLES = [
  ['*', [0, 0, 0]],
  ['LI', [0, 0, 1]],
  ['UL LI', [0, 0, 2]],
  ['UL OL+LI', [0, 0, 3]],
  ['H1 + *[REL=up]', [0, 1, 1]],
  ['UL OL LI.red', [0, 1, 3]],
  ['LI.red.level', [0, 2, 1]],
  ['#x34y', [1, 0, 0]],
  ['#s12:not(FOO)', [1, 0, 1]],
  ['.foo :is(.bar, #baz)', [1, 1, 0]],
];
for (const [sel, exp] of SPEC_EXAMPLES) eq('Selectors 4 §17: ' + sel, spec(sel), exp);

// ---------- MDN Specificity examples ----------
const MDN_EXAMPLES = [
  ['#myElement', [1, 0, 0]],
  ['.bodyClass .sectionClass .parentClass [id="myElement"]', [0, 4, 0]],
  [':root #myApp input:required', [1, 2, 1]],
  ['#myApp [type="password"]', [1, 1, 0]],
  ['input:focus', [0, 1, 1]],
  [':not(#fakeId #fakeId #fakeID)', [3, 0, 0]],
  [':is(p, #fakeId)', [1, 0, 0]],
  ['h1:has(+ h2, > #fakeId)', [1, 0, 1]],
  [':where(#defaultTheme) a', [0, 0, 1]],
  ['p::first-line', [0, 0, 2]],
];
for (const [sel, exp] of MDN_EXAMPLES) eq('MDN: ' + sel, spec(sel), exp);

// ---------- reported defects ----------
eq(':where() is zero even with classes inside', spec(':where(.active, p)'), [0, 0, 0]);
eq(':where(#a .b) div', spec(':where(#a .b) div'), [0, 0, 1]);
eq(':is() takes the most specific argument', spec(':is(.a, .b.c, d)'), [0, 2, 0]);
eq(':not() takes the most specific argument', spec(':not(.a, #b)'), [1, 0, 0]);
eq(':has() takes the most specific argument', spec('div:has(> img, > .x.y)'), [0, 2, 1]);
eq(':nth-child(2n+1) is one pseudo-class', spec(':nth-child(2n+1)'), [0, 1, 0]);
eq('li:nth-child(2n+1)', spec('li:nth-child(2n+1)'), [0, 1, 1]);
eq(':nth-child(odd)', spec(':nth-child(odd)'), [0, 1, 0]);
eq(':nth-last-of-type(-n + 3)', spec('p:nth-last-of-type(-n + 3)'), [0, 1, 1]);
eq('a[href="#top"] has no ID', spec('a[href="#top"]'), [0, 1, 1]);
eq('[data-x=".a.b"] counts once', spec('[data-x=".a.b"]'), [0, 1, 0]);
eq('attribute with ] in a string', spec('[title="a]b"] p'), [0, 1, 1]);
eq('split keeps :is() arguments together', E.splitSelectorList(':is(a, b) .x, :where(c, d)'), [':is(a, b) .x', ':where(c, d)']);
eq('split keeps commas in attribute strings', E.splitSelectorList('a, [data-x="a,b"]'), ['a', '[data-x="a,b"]']);
eq('split drops empty items and trims', E.splitSelectorList(' a ,, b '), ['a', 'b']);

// ---------- nth-child of S ----------
eq(':nth-child(2n+1 of .important)', spec('li:nth-child(2n+1 of .important)'), [0, 2, 1]);
eq(':nth-child(1 of #a, .b)', spec(':nth-child(1 of #a, .b)'), [1, 1, 0]);
eq(':nth-last-child(odd of li.x)', spec(':nth-last-child(odd of li.x)'), [0, 2, 1]);
eq(':nth-of-type(2n) has no of-clause', spec(':nth-of-type(2n)'), [0, 1, 0]);

// ---------- other pseudo-classes and pseudo-elements ----------
eq(':lang(en)', spec(':lang(en)'), [0, 1, 0]);
eq(':dir(rtl)', spec('p:dir(rtl)'), [0, 1, 1]);
eq('legacy :before', spec('a:before'), [0, 0, 2]);
eq('legacy :first-letter', spec('p:first-letter'), [0, 0, 2]);
eq('::before', spec('a::before'), [0, 0, 2]);
eq('::slotted(span.x) adds its argument', spec('::slotted(span.x)'), [0, 1, 2]);
eq(':host is a pseudo-class', spec(':host'), [0, 1, 0]);
eq(':host(.dark) adds its argument', spec(':host(.dark)'), [0, 2, 0]);
eq('::part(label)', spec('x-foo::part(label)'), [0, 0, 2]);
eq('nested :is(:not(#a), .b)', spec(':is(:not(#a), .b)'), [1, 0, 0]);
eq(':is() with a complex argument', spec(':is(ul li, .x) a'), [0, 1, 1]);
eq('pseudo-class names are case-insensitive', spec(':WHERE(#a) :IS(#b)'), [1, 0, 0]);
eq(':-webkit-any() and :matches() act like :is()', spec(':matches(#a, b)'), [1, 0, 0]);

// ---------- namespaces, escapes, nesting ----------
eq('svg|rect', spec('svg|rect'), [0, 0, 1]);
eq('*|*', spec('*|*'), [0, 0, 0]);
eq('|a', spec('|a'), [0, 0, 1]);
eq('column combinator ||', spec('col.sel || td'), [0, 1, 2]);
eq('escaped colon in a class', spec('.md\\:flex'), [0, 1, 0]);
eq('escaped digit in an ID', spec('#\\31 23'), [1, 0, 0]);
eq('non-ASCII class', spec('.größe'), [0, 1, 0]);
eq('& counts as zero', spec('& .x'), [0, 1, 0]);
eq('combinators without spaces', spec('a>b~c+d'), [0, 0, 4]);

// ---------- syntax errors ----------
for (const bad of ['a(', ':is(.a', '[x', '#', 'a)b', '.', ':', '[x="a]']) {
  check('error for ' + JSON.stringify(bad), typeof spec(bad) === 'string', JSON.stringify(spec(bad)));
}
{
  let msg = '';
  try { E.specificity(':is(.a'); } catch (e) { msg = e.message; }
  check('error message gives a position', /\d/.test(msg), msg);
}

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/const STRINGS = (\{[\s\S]*?\n\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    check('STRINGS has invalid key', 'invalid' in S.en);
  }
}

// ---------- examples on the tool pages ----------
// Lines in the form `<code>SELECTOR</code> → <code>(a, b, c)</code>` are recomputed.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/css-specificity-calculator', lang + '.mdx'), 'utf8');
  const re = /<code>([^<]+)<\/code>\s*→\s*<code>\((\d+), (\d+), (\d+)\)<\/code>/g;
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const sel = m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    eq(lang + ' page example ' + sel, spec(sel), [+m[2], +m[3], +m[4]]);
  }
  check(lang + ' page has at least 6 checked examples', n >= 6, n);
}

// ---------- complete page lifecycle and real shared shortcuts ----------
// Only DOM, clipboard delivery and the timer clock are controlled. The actual engine,
// renderer and event listeners run together; detached buttons stay observable.
const frontmatter=source.split('---')[1];
const pageStrings=frontmatterStrings(frontmatter);
const locale=new Function('lang',frontmatter.slice(frontmatter.indexOf('const STRINGS'))+'\nreturn {T,TIPS,CLIENT_T};');
const markupTemplate=source.replace(/^---\n[\s\S]*?\n---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0];
const escapeMarkup=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMarkup(lang){
 const T=pageStrings[lang],about=JSON.parse(readFileSync(join(root,'src/i18n',lang+'.json'),'utf8'))['tool.tipAbout'];
 return markupTemplate.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_all,id,label,key)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+escapeMarkup(about.replace('{name}',T[label]))+'"></button><span id="'+id+'" class="zt-tip-pop" hidden>'+escapeMarkup(T.tips[key])+'</span></span>')
  .replace(/=\{T\.(\w+)\}/g,(_all,key)=>'="'+escapeMarkup(T[key])+'"').replace(/\{T\.(\w+)\}/g,(_all,key)=>escapeMarkup(T[key]));
}
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const unhandled=[];
const onUnhandled=error=>unhandled.push(String(error));
process.on('unhandledRejection',onUnhandled);
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function page(lang,order){
 const markup=renderMarkup(lang);
 const document=domino.createDocument('<html lang="'+lang+'"><body><main class="tool-widget">'+markup+'</main><input id="outside" type="text"></body></html>');
 Object.defineProperty(document,'activeElement',{value:document.body,writable:true,configurable:true});
 const timers=new Map(),clipboard=[],clears=[],tracks=[],errors=[],effects=[];
 let clock=0,seq=0;
 const input=document.getElementById('csc-input'),result=document.getElementById('csc-results');
 function focus(el){if(!Object.hasOwn(el,'focus'))Object.defineProperty(el,'focus',{value:()=>{document.activeElement=el;}});el.focus();}
 focus(input);
 const navigator={clipboard:{writeText(value){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});clipboard.push({value,promise,resolve,reject});return promise;}}};
 const globals={document,navigator,t:locale(lang).CLIENT_T,_slug:'css-specificity-calculator',ztPersist:{clear:slug=>clears.push(slug)},trackTool:(...args)=>tracks.push(args),fetch(){effects.push('network');throw Error('Unexpected network');},setTimeout(fn,ms){timers.set(++seq,{fn,ms,due:clock+ms});return seq;},clearTimeout(id){timers.delete(id);}};
 document.execCommand=()=>{effects.push('fallback');throw Error('Unexpected fallback');};
 if(order==='shared-before'){const ctx=vm.createContext(globals);ctx.window=ctx;vm.runInContext(shortcut,ctx);}
 const real=loadPage('src/components/tools/CssSpecificityCalculatorTool.astro',{lang,globals});
 if(order==='shared-after')real.run(shortcut);
 function event(el,type,values={}){const e=document.createEvent('Event');e.initEvent(type,true,true);Object.assign(e,values);try{el.dispatchEvent(e);}catch(error){errors.push(String(error));}return e;}
 return{document,input,result,clipboard,clears,tracks,errors,effects,timers,navigator,
  type(value){input.value=value;event(input,'input');},
  tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  key(el,values){focus(el);return event(el,'keydown',{ctrlKey:false,metaKey:false,...values});},
  click(btn){focus(btn);event(btn,'click');},
  buttons(){return Array.from(result.querySelectorAll('.csc-copy-btn'));},
  tuples(){return Array.from(result.querySelectorAll('.csc-tuple')).map(e=>e.textContent);},
 };
}
const copyFailed={en:'Copy failed',zh:'复制失败',ja:'コピー失敗',ko:'복사 실패'};
function prepared(lang,order,value='#nav .item:hover, h1.title'){const p=page(lang,order);p.type(value);p.tick(200);return p;}
check('actual shared keyboard handler loaded',shortcut.includes('window.ztPersist.clear(_slug)'));
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const t=pageStrings[lang],tag=lang+'/'+order;
 {
  const p=page(lang,order);eq(tag+' initial prompt',p.result.textContent,t.noInput);
  p.type('#nav .item:hover, h1.title');p.tick(199);eq(tag+' remains at original 200ms boundary',p.tuples(),[]);p.tick(1);eq(tag+' actual tuples',p.tuples(),['(1, 2, 0)','(0, 1, 1)']);
  eq(tag+' split/list note preserved',p.result.querySelector('.csc-note').textContent,t.note);
  p.type(':is(');p.tick(200);check(tag+' real engine error replaces prior cards',p.result.querySelector('.csc-error-msg').textContent.startsWith(t.invalid.split('{msg}')[0]));eq(tag+' invalid has no copy',p.buttons().length,0);
  p.type('');p.tick(200);eq(tag+' empty query returns prompt',p.result.textContent,t.noInput);
 }
 for(const state of ['valid','invalid','pending'])for(const mod of ['ctrlKey','metaKey']){
  const p=prepared(lang,order);if(state==='invalid'){p.type(':is(');p.tick(200);}if(state==='pending')p.type('.queued');
  const btn=p.buttons()[0],el=btn||p.input,ev=p.key(el,{key:mod==='ctrlKey'?'l':'L',[mod]:true});
  eq(tag+'/'+state+'/'+mod+' clears input and old results',[p.input.value,p.result.textContent,p.buttons().length],['',t.noInput,0]);
  eq(tag+'/'+state+'/'+mod+' focuses input',p.document.activeElement.id,'csc-input');
  eq(tag+'/'+state+'/'+mod+' shared persist exactly once',p.clears,['css-specificity-calculator']);check(tag+'/'+state+'/'+mod+' default suppressed',ev.defaultPrevented);
  eq(tag+'/'+state+'/'+mod+' no queue remains',p.timers.size,0);p.tick(500);eq(tag+'/'+state+'/'+mod+' stays clear',p.result.textContent,t.noInput);
  p.type('a:hover');p.tick(200);eq(tag+'/'+state+'/'+mod+' recovery',p.tuples(),['(0, 1, 1)']);
 }
 {
  const p=prepared(lang,order),html=p.result.innerHTML;
  for(const values of [{key:'l'},{key:'Enter',ctrlKey:true},{key:'Enter',metaKey:true}]){const ev=p.key(p.input,values);eq(tag+' ordinary/unbound keys preserve result',p.result.innerHTML,html);check(tag+' ordinary/unbound key not suppressed',!ev.defaultPrevented);}
  p.key(p.document.getElementById('outside'),{key:'l',ctrlKey:true});eq(tag+' outside shortcut preserves tool',p.result.innerHTML,html);eq(tag+' outside shortcut preserves storage',p.clears,[]);
 }
 {
  const p=prepared(lang,order),btn=p.buttons()[0],u=unhandled.length;p.click(btn);
  eq(tag+' copied exact tuple',p.clipboard[0].value,'(1, 2, 0)');p.clipboard[0].reject(Error('controlled denial'));await settle();
  eq(tag+' current rejection handled',unhandled.length,u);eq(tag+' current rejection visible',btn.textContent,copyFailed[lang]);
  p.click(btn);p.clipboard[1].resolve();await settle();eq(tag+' same output direct success retry',btn.textContent,t.copied);p.tick(1500);eq(tag+' current timer resets success',btn.textContent,t.copyBtn);eq(tag+' no synchronous error',p.errors,[]);
 }
 for(const unavailable of ['absent','throw']){
  const p=prepared(lang,order),btn=p.buttons()[0];
  if(unavailable==='absent')delete p.navigator.clipboard;else p.navigator.clipboard.writeText=()=>{throw Error('controlled synchronous failure');};
  p.click(btn);await settle();eq(tag+'/'+unavailable+' API failure handled',p.errors,[]);eq(tag+'/'+unavailable+' failure visible',btn.textContent,copyFailed[lang]);eq(tag+'/'+unavailable+' no fallback invented',p.effects,[]);
 }
 for(const transition of ['clear','new-valid','new-invalid','input-only','same-input'])for(const completion of ['resolve','reject']){
  const p=prepared(lang,order),btn=p.buttons()[0],u=unhandled.length;p.click(btn);
  if(transition==='clear')p.key(btn,{key:'l',ctrlKey:true});else{p.type(transition==='new-invalid'?':is(':transition==='same-input'?'#nav .item:hover, h1.title':'.new');if(transition.startsWith('new-'))p.tick(200);}
  const before=[p.result.innerHTML,btn.textContent];p.clipboard[0][completion](completion==='reject'?Error('controlled late denial'):undefined);await settle();
  eq(tag+'/'+transition+'/'+completion+' old callback cannot change current or detached button',[p.result.innerHTML,btn.textContent],before);eq(tag+'/'+transition+'/'+completion+' no unhandled rejection',unhandled.length,u);
 }
 for(const first of ['resolve','reject'])for(const second of ['resolve','reject']){
  const p=prepared(lang,order),btn=p.buttons()[0],u=unhandled.length;p.click(btn);p.click(btn);
  p.clipboard[1][second](second==='reject'?Error('new denial'):undefined);await settle();const text=btn.textContent;
  p.clipboard[0][first](first==='reject'?Error('old denial'):undefined);await settle();
  eq(tag+'/request-order/'+first+'/'+second+' newest result retained',btn.textContent,text);eq(tag+'/request-order/'+first+'/'+second+' newest visible result',text,second==='resolve'?t.copied:copyFailed[lang]);eq(tag+'/request-order/'+first+'/'+second+' handled',unhandled.length,u);
 }
 {
  const p=prepared(lang,order),btn=p.buttons()[0];p.click(btn);p.clipboard[0].resolve();await settle();const oldTimer=[...p.timers.values()].find(x=>x.ms===1500);
  check(tag+' real success timer captured',!!oldTimer);p.tick(100);p.click(btn);p.clipboard[1].resolve();await settle();p.tick(1400);eq(tag+' old deadline preserves second success',btn.textContent,t.copied);
  oldTimer.fn();eq(tag+' forced old timer delivery also stays stale',btn.textContent,t.copied);p.tick(100);eq(tag+' new deadline restores label',btn.textContent,t.copyBtn);
 }
 for(const transition of ['clear','input']){
  const p=prepared(lang,order),btn=p.buttons()[0];p.click(btn);p.clipboard[0].resolve();await settle();const timer=[...p.timers.values()].find(x=>x.ms===1500);
  if(transition==='clear')p.key(btn,{key:'l',ctrlKey:true});else p.type('.new');
  eq(tag+'/'+transition+' synchronously clears copied feedback',btn.textContent,t.copyBtn);const before=[p.result.innerHTML,btn.textContent];timer.fn();eq(tag+'/'+transition+' old timer cannot change state',[p.result.innerHTML,btn.textContent],before);
 }
 {
  const p=prepared(lang,order),[a,b]=p.buttons(),u=unhandled.length;p.click(a);p.click(b);p.clipboard[1].reject(Error('second button denied'));await settle();p.clipboard[0].resolve();await settle();
  eq(tag+' two buttons retain independent feedback',[a.textContent,b.textContent],[t.copied,copyFailed[lang]]);eq(tag+' both real values copied',p.clipboard.map(c=>c.value),['(1, 2, 0)','(0, 1, 1)']);eq(tag+' independent rejection handled',unhandled.length,u);eq(tag+' no network/fallback effects',p.effects,[]);
 }
}
process.removeListener('unhandledRejection',onUnhandled);
const protectedEngine=source.match(/^      \/\* ── engine:start ── \*\/[\s\S]*?^      \/\* ── engine:end ── \*\//m)[0];
eq('engine exact original bytes including indentation',Buffer.byteLength(protectedEngine),7645);
eq('engine exact original SHA256',createHash('sha256').update(protectedEngine).digest('hex'),'3a9f29257895fc733bcdb1ee7bde7820985760a4a23c74f8c82a6ebb85609843');


// ---------- v2 page layout ----------
const require=createRequire(join(root,'package.json'));
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/CssSpecificityCalculatorTool.astro'),scopedStyleStrategy:'attribute'});
check('v2 Astro compilation diagnostics',!compiled.diagnostics.some(d=>d.severity===1));
let moduleError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){moduleError=String(e);}eq('v2 generated module parses',moduleError,'');
const css=compiled.css.join('\n'),scope=css.match(/data-astro-cid-[\w-]+/)[0];
const hash=v=>createHash('sha256').update(v).digest('hex');
// Hash updated by S2-9 (2026-10-09): localized error messages, the full-width note, and analytics on change / copy success.
eq('v2 whole client core retained apart from shared Copy class',hash(source.slice(source.indexOf('      var inputEl ='),source.indexOf('  </script>')).replace('csc-copy-btn btn-copy','csc-copy-btn')),'f175f3bc6aa936e396e230b21de8bab7e531b24f17e96af06924bfac2f7c36c3');
check('v2 direct flex root',/^<div class="csc-wrap">/.test(markupTemplate)&&/\.csc-wrap[^{}]*\{[^}]*min-width:\s*0[^}]*min-height:\s*0/.test(css));
check('v2 input before reserved hint/status before results',markupTemplate.indexOf('id="csc-input"')<markupTemplate.indexOf('csc-hint csc-status')&&markupTemplate.indexOf('csc-hint csc-status')<markupTemplate.indexOf('class="csc-result-section"'));
check('v2 fixed hint/status height',/\.csc-status[^{}]*\{[^}]*height:\s*2\.8em[^}]*overflow:\s*auto/.test(css));
check('v2 bounded result fills available height',/\.csc-result-section[^{}]*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*min-height:\s*0/.test(css));
check('v2 list has internal scroll and zero basis',/\.csc-results[^{}]*\{[^}]*flex:\s*1 1 0[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css));
check('v2 dynamic card cannot shrink',/\.csc-result-card[^{}]*,[^{]*\.csc-note[^{}]*,[^{]*\.csc-empty[^{}]*\{\s*flex:\s*none/.test(css));
check('v2 mobile fixed result heights',/@media\s*\(max-width:\s*860px\)[\s\S]*?height:\s*28rem/.test(css)&&/@media\s*\(max-width:\s*640px\)[\s\S]*?height:\s*26rem/.test(css));
check('v2 mobile search and copy 44px',/@media\s*\(max-width:\s*640px\)[\s\S]*?\.csc-field[^{}]*input[^{}]*\{\s*min-height:\s*44px[\s\S]*?\.csc-copy-btn[^{}]*\{\s*min-height:\s*44px/.test(css));
check('v2 compiled mobile empty selector has no unresolved global',!css.includes(':global(')&&/@media\s*\(max-width:\s*860px\)[\s\S]*?\.csc-result-section:has\(\.csc-empty\)\s*\{\s*display:\s*none/.test(css));
check('v2 no runtime i18n',!/data-i18n|document\.documentElement\.lang/.test(source));
const pageScript=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
check('v2 tips not sent to client',/define:vars=\{\{ t: CLIENT_T \}\}/.test(source)&&!/TIPS|tips|STRINGS/.test(pageScript));
const bindings=[...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 literal tip IDs',bindings.map(m=>m[1]),['csc-tip-input','csc-tip-parsing','csc-tip-results','csc-tip-copy']);
check('v2 tips outside input label',!/<label\b[^>]*>[\s\S]*?<Toggletip[\s\S]*?<\/label>/.test(markupTemplate));
const {compile}=await import('@mdx-js/mdx');
for(const lang of ['en','zh','ja','ko']){
 const {T,TIPS,CLIENT_T}=locale(lang),p=page(lang,'shared-after');
 eq('v2 '+lang+' four tip keys',Object.keys(TIPS),['input','parsing','results','copy']);
 check('v2 '+lang+' plain bounded tips',Object.values(TIPS).every(t=>typeof t==='string'&&t.length>0&&t.length<=280&&!/[<>\n]|https?:/.test(t)));
 eq('v2 '+lang+' only eleven client keys',Object.keys(CLIENT_T),['id','cls','elem','noInput','copyBtn','copied','copyFailed','note','invalid','errors','fullwidth']);
 check('v2 '+lang+' serialized strings omit tips',Object.values(TIPS).every(text=>!JSON.stringify(CLIENT_T).includes(text)));
 eq('v2 '+lang+' SSR label',p.document.querySelector('label[for="csc-input"]').textContent,T.inputLabel);
 eq('v2 '+lang+' SSR placeholder',p.input.placeholder,T.inputPlaceholder);
 eq('v2 '+lang+' original hint retained',p.document.querySelector('.csc-hint').textContent,T.hint);
 eq('v2 '+lang+' accessible scroll region',[p.result.getAttribute('tabindex'),p.result.getAttribute('role'),p.result.getAttribute('aria-label')],['0','region',T.specificity]);
 eq('v2 '+lang+' default real empty prompt',p.result.textContent,T.noInput);
 eq('v2 '+lang+' no invented static actions',p.document.querySelectorAll('button:not([data-zt-tip])').length,0);
 for(const [,id,label,key]of bindings){eq('v2 '+lang+' literal tip '+id,p.document.getElementById(id).textContent,TIPS[key]);check('v2 '+lang+' localized aria '+id,p.document.querySelector('[data-zt-tip="'+id+'"]').getAttribute('aria-label').includes(T[label]));}
 const content=readFileSync(join(root,'src/content/tools/css-specificity-calculator',lang+'.mdx'),'utf8'),data=require('js-yaml').load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
 eq('v2 '+lang+' five steps',data.steps.length,5);check('v2 '+lang+' bounded plain steps',data.steps.every(t=>t.length<=280&&!/[<>\n]/.test(t))&&data.steps.join('').length<=1200);check('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'));
 eq('v2 '+lang+' MDX content contract', contractProblems('css-specificity-calculator', lang), '');
 let error='';try{await compile(content.replace(/^---\n[\s\S]*?\n---/,''));}catch(e){error=String(e);}eq('v2 '+lang+' MDX compiles',error,'');
 for(const order of ['shared-before','shared-after'])for(const id of ['csc-tip-results','csc-tip-copy']){
  const q=prepared(lang,order);q.key(q.document.querySelector('[data-zt-tip="'+id+'"]'),{ctrlKey:true,key:'l'});
  eq('v2 '+lang+'/'+order+'/'+id+' real CtrlL preserves shared focus',[q.input.value,q.result.textContent,q.document.activeElement.id,q.clears],['',T.noInput,'csc-input',['css-specificity-calculator']]);
 }
}
{
 const p=prepared('en','shared-after');p.result.setAttribute(scope,'');
 for(const name of ['csc-empty','csc-result-card','csc-result-header','csc-selector','csc-tuple','csc-badges','csc-badge','csc-badge-label','csc-badge-val','csc-bar-wrap','csc-bar-track','csc-bar-seg','csc-copy-btn','csc-note','csc-error-msg']){
  if(name==='csc-empty'){p.type('');p.tick(200);}else if(name==='csc-error-msg'){p.type(':is(');p.tick(200);}else{p.type('#nav .item:hover, h1.title');p.tick(200);}
  const selector=css.match(new RegExp('\\.csc-results\\[data-astro-cid-[^\\]]+\\]\\s+\\.'+name+'\\s*\\{'))?.[0].replace(/\s*\{$/,'');
  check('v2 compiled selector reaches real dynamic '+name,!!selector&&p.document.querySelectorAll(selector).length>0,selector);
 }
 const long=Array.from({length:240},(_,i)=>'#id'+i+' .item:hover').join(', ');p.type(long);p.tick(200);
 eq('v2 long result retains every selector',Array.from(p.result.querySelectorAll('.csc-selector')).map(e=>e.textContent),long.split(', '));eq('v2 long result preserves every tuple',p.tuples(),Array.from({length:240},()=>'(1, 2, 0)'));
 const last=p.buttons().at(-1);p.click(last);eq('v2 last long result copies complete tuple',p.clipboard.at(-1).value,'(1, 2, 0)');p.clipboard.at(-1).resolve();await settle();eq('v2 long result copy success',last.textContent,pageStrings.en.copied);
}
// ---------- S2-9 fixes outside the engine ----------
// Error messages in the page language: the engine's English message is mapped by pattern,
// with the same position. Unknown messages are shown unchanged.
const errorCases = [
  ['a(', 'unexpected', { char: '(', pos: '2' }],
  [':is(.a', 'missing', { char: ')', pos: '4' }],
  ['[x', 'missing', { char: ']', pos: '1' }],
  ['#', 'expectedName', { pos: '2' }],
  ['[x="a]', 'unclosedString', { pos: '6' }],
  [':is()', 'emptyArgument', { pos: '5' }],
  ['a\\', 'escapeEnd', { pos: '2' }],
];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const t = pageStrings[lang], C = locale(lang).CLIENT_T;
  check(lang + ' error templates exist', C.errors && typeof C.errors === 'object', JSON.stringify(Object.keys(C)));
  for (const [sel, key, vars] of errorCases) {
    const p = page(lang, 'shared-after'); p.type(sel); p.tick(200);
    const tmpl = C.errors?.[key] ?? '';
    const want = t.invalid.replace('{msg}', tmpl.replace('{char}', vars.char ?? '').replace('{pos}', vars.pos));
    eq(lang + ' localized error for ' + JSON.stringify(sel), p.result.querySelector('.csc-error-msg')?.textContent, want);
    for (const v of Object.values(vars)) check(lang + ' error keeps ' + v + ' for ' + JSON.stringify(sel), want.includes(v), want);
  }
  if (lang === 'en') {
    // en keeps the engine wording
    const p = page('en', 'shared-after'); p.type('a)b'); p.tick(200);
    eq('en error text unchanged', p.result.querySelector('.csc-error-msg').textContent, 'Not a valid selector: Unexpected ")" (position 2)');
  }
}
// Full-width ＃ ． ： and the ideographic space are name characters in CSS, so the tuple counts
// them as part of a name; the card says so in the page language.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const C = locale(lang).CLIENT_T;
  check(lang + ' full-width note text', typeof C.fullwidth === 'string' && C.fullwidth.length > 0);
  const p = page(lang, 'shared-after'); p.type('＃ｍａｉｎ．ｎａｖ, #main.nav, [title="Ｑ＆Ａ"]'); p.tick(200);
  eq(lang + ' full-width tuple as CSS reads it', p.tuples(), ['(0, 0, 1)', '(1, 1, 0)', '(0, 1, 0)']);
  const notes = Array.from(p.result.querySelectorAll('.csc-result-card')).map(c => c.querySelector('.csc-warn')?.textContent ?? '');
  eq(lang + ' full-width note only on the card with full-width syntax', notes, [C.fullwidth, '', '']);
  const q = page(lang, 'shared-after'); q.type('div　p'); q.tick(200);
  eq(lang + ' ideographic space note', q.result.querySelector('.csc-warn')?.textContent, C.fullwidth);
}
// Analytics: `calc` once per committed change (change event), not after every 200 ms pause;
// `copy` only after a successful copy.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = page(lang, 'shared-after'), calcs = () => p.tracks.filter(x => x[1] === 'calc').length, copies = () => p.tracks.filter(x => x[1] === 'copy').length;
  p.type('#a'); p.tick(200); p.type('#a .b'); p.tick(200); p.type('#a .b:hover'); p.tick(200);
  eq(lang + ' GA: typing pauses send no calc', calcs(), 0);
  const ev = p.document.createEvent('Event'); ev.initEvent('change', true, true); p.input.dispatchEvent(ev);
  eq(lang + ' GA: committed change sends one calc', calcs(), 1);
  p.input.value = ''; const ev2 = p.document.createEvent('Event'); ev2.initEvent('change', true, true); p.input.dispatchEvent(ev2);
  eq(lang + ' GA: empty change sends nothing', calcs(), 1);
  p.type('#a .b:hover'); p.tick(200);
  const btn = p.buttons()[0]; p.click(btn); eq(lang + ' GA: copy request alone sends nothing', copies(), 0);
  p.clipboard[0].reject(Error('denied')); await settle(); eq(lang + ' GA: failed copy sends nothing', copies(), 0);
  p.click(btn); p.clipboard[1].resolve(); await settle(); eq(lang + ' GA: successful copy sends one', copies(), 1);
}
check('v2 registered as analyze',/'css-specificity-calculator':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
