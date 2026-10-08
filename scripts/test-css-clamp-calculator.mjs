// CSS Clamp Calculator — actual page regressions. Read component/harness and the four tool page
// MDX files (`ccc-check` examples recomputed through the page script); write stdout only.
import { readFileSync } from 'node:fs';
import { fencedBlocks, toolMdxContract } from './lib/tool-mdx-contract.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=process.env.ZEROTOOL_QA_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const componentPath=process.env.ZEROTOOL_QA_COMPONENT || join(root,'src/components/tools/CssClampCalculatorTool.astro');
const source=readFileSync(componentPath,'utf8');
const SLUG='css-clamp-calculator';
let passes=0,failures=0;
function check(name,ok,detail){if(ok){passes++;return;}failures++;console.log('FAIL: '+name+(detail!==undefined?' — '+detail:''));}
function eq(name,a,b){check(name,JSON.stringify(a)===JSON.stringify(b),'got '+JSON.stringify(a)+', expected '+JSON.stringify(b));}

import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { relative } from 'node:path';
const { loadPage } = await import(pathToFileURL(join(root, 'scripts/astro-page-harness.mjs')));
const domino = createRequire(join(root, 'package.json'))('@mixmark-io/domino');
const langKeys = ['en', 'zh', 'ja', 'ko'];
function localized(src) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(src)[1];
  const region = /\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(fm);
  if (region) return vm.runInNewContext(region[1] + '\n;STRINGS');
  const start = fm.indexOf('const labels =');
  return vm.runInNewContext(fm.slice(start, fm.indexOf('const L =', start)) + '\n;labels');
}
const labels = localized(source);
const sharedSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = sharedSource.slice(sharedSource.indexOf("      document.addEventListener('keydown',", sharedSource.indexOf('// ── Keyboard shortcuts:')), sharedSource.indexOf('      // ── Copy button visual feedback'));
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const asyncErrors = [];
process.on('unhandledRejection', error => asyncErrors.push(String(error)));
function open(lang = 'en', order = 'after', saved = null) {
  const L = labels[lang], esc = v => String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  let html = source.replace(/^---\n[\s\S]*?\n---/, '').replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g,'').replace(/<Toggletip\s[^>]*>[\s\S]*?<\/Toggletip>/g,'').replace(/<Toggletip\s[^>]*\/>/g,'');
  html = html.replace(/=\{L\.([\w]+)\}/g,(_,key)=>'="'+esc(L[key])+'"').replace(/\{L\.([\w]+)\}/g,(_,key)=>esc(L[key]));
  const win = domino.createWindow('<html lang="'+lang+'"><body><div class="tool-widget">'+html+'</div><input id="outside" type="text"></body></html>');
  const doc = win.document;
  let active = doc.body;
  Object.defineProperty(doc,'activeElement',{configurable:true,get:()=>active});
  function dispatch(el,type,init={}) { const ev=doc.createEvent('Event');ev.initEvent(type,true,true);for(const[k,v]of Object.entries(init))Object.defineProperty(ev,k,{value:v});el.dispatchEvent(ev);return ev; }
  for (const el of doc.querySelectorAll('*')) {
    if (!('dataset' in el)) Object.defineProperty(el,'dataset',{value:new Proxy({}, {get:(_,key)=>el.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()))??undefined,set:(_,key,v)=>{el.setAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),v);return true;}})});
    if (!('hidden' in el)) Object.defineProperty(el,'hidden',{get:()=>el.hasAttribute('hidden'),set:v=>v?el.setAttribute('hidden',''):el.removeAttribute('hidden')});
    Object.defineProperty(el,'focus',{value:()=>{active=el;}});
    if(el.tagName==='BUTTON')Object.defineProperty(el,'click',{value:()=>{if(!el.disabled)dispatch(el,'click');}});
  }
  const jobs=[],timers=new Map(),allTimers=[];let timerID=0;
  const persist={saved,saveCalls:[],clearCalls:[],load:()=>persist.saved,save:(slug,value)=>{persist.saved=JSON.parse(JSON.stringify(value));persist.saveCalls.push([slug,value]);},clear:slug=>{persist.saved=null;persist.clearCalls.push(slug);}};
  const storage=[],tracks=[],assertions=[],fallback=[];
  let mode='pending',fallbackOK=false;
  const native={writeText:value=>{if(mode==='throw')throw Error('sync denial');return new Promise((resolve,reject)=>jobs.push({value,resolve,reject}));}};
  const navigator=Object.create({clipboard:{writeText(){throw Error('prototype clipboard must never run');}}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,writable:true,value:native});
  const create=doc.createElement.bind(doc);doc.createElement=tag=>{const el=create(tag);Object.defineProperty(el,'select',{value:()=>fallback.push(el.value)});return el;};
  doc.execCommand=command=>command==='copy'&&fallbackOK;
  const globals={document:doc,navigator,isSecureContext:true,ztPersist:persist,trackTool:(...args)=>tracks.push(args),addEventListener:(type,fn)=>{if(type==='storage')storage.push(fn);},setTimeout:(fn,ms)=>{const t={id:++timerID,fn,ms};timers.set(t.id,t);allTimers.push(t);return t.id;},clearTimeout:id=>timers.delete(id),console:{assert:(ok,msg)=>assertions.push({ok,msg}),log(){},warn(){},error(){}}};
  if(order==='before')vm.runInNewContext('var _slug='+JSON.stringify(SLUG)+';'+shortcut,{document:doc,window:globals});
  const page=loadPage(relative(root,componentPath),{lang,globals});
  if(order==='after')page.run('var _slug='+JSON.stringify(SLUG)+';'+shortcut);
  const el=id=>{const e=doc.getElementById(id);if(!e)throw Error('Missing actual markup ID '+id);return e;};
  return {page,doc,el,jobs,timers,allTimers,persist,storage,tracks,assertions,fallback,
    text:id=>doc.getElementById(id)?.textContent??'',
    input(id,value,type='input'){const e=el(id);e.value=String(value);dispatch(e,type);},
    click:id=>{try{el(id).click();}catch(error){check(id+' click does not throw',false,String(error));}},
    key(id,key='l',meta=false){el(id).focus();return dispatch(doc,'keydown',{key,ctrlKey:!meta,metaKey:meta});},
    mode(value){mode=value;Object.defineProperty(navigator,'clipboard',{configurable:true,writable:true,value:value==='missing'?undefined:native});},
    fallbackOK(v){fallbackOK=v;},
    expire(){for(const t of [...timers.values()]){timers.delete(t.id);t.fn();}},
  };
}

for (const lang of langKeys) {
  const p=open(lang), L=labels[lang];
  eq(lang+' default formula',p.text('clamp-declaration'),'font-size: clamp(1rem, 0.7143rem + 1.4286vw, 2rem);');
  eq(lang+' real five samples',p.el('clamp-sample-body').querySelectorAll('tr').length,5);
  eq(lang+' curve path',p.el('clamp-chart-line').getAttribute('d'),'M20 160 L160 127.5 L300 95 L440 62.5 L580 30');
  eq(lang+' midpoint live',p.text('clamp-live-value'),'24px / 1.5rem');
  p.input('clamp-start-value',32);p.input('clamp-end-value',16);
  eq(lang+' reverse formula',p.text('clamp-declaration'),'font-size: clamp(1rem, 2.2857rem - 1.4286vw, 2rem);');
  p.input('clamp-start-value',16);eq(lang+' constant value',p.text('clamp-raw-value'),'1rem');eq(lang+' constant notice',p.text('clamp-status'),L.constant);
  p.input('clamp-property','margin','change');p.input('clamp-unit','px','change');p.input('clamp-start-value',-8);p.input('clamp-end-value',8);
  eq(lang+' negative margin',p.text('clamp-declaration'),'margin: clamp(-8px, -12.5714px + 1.4286vw, 8px);');
  p.input('clamp-root',0);eq(lang+' invalid root notice',p.text('clamp-status'),L.invalidRoot);eq(lang+' invalid clears',p.text('clamp-declaration'),'');
  p.click('clamp-reset');eq(lang+' Reset defaults',p.el('clamp-root').value,'16');eq(lang+' Reset removes saved',p.persist.saved,null);eq(lang+' Reset focus',p.doc.activeElement.id,'clamp-min-viewport');
  p.click('clamp-copy-css');eq(lang+' full declaration copy',p.jobs.at(-1).value,p.text('clamp-declaration'));p.jobs.at(-1).reject(Error('denial'));await settle();eq(lang+' visible rejection',p.text('clamp-status'),L.copyFailed);
  p.click('clamp-copy-css');p.jobs.at(-1).resolve();await settle();eq(lang+' direct retry success',p.text('clamp-status'),L.copied);p.expire();eq(lang+' stable CSS label',p.text('clamp-copy-css'),L.copyCss);
  p.click('clamp-copy-value');eq(lang+' full raw copy',p.jobs.at(-1).value,p.text('clamp-raw-value'));p.jobs.at(-1).resolve();await settle();p.expire();eq(lang+' stable value label',p.text('clamp-copy-value'),L.copyValue);
  p.mode('throw');p.click('clamp-copy-css');await settle();eq(lang+' synchronous failure visible',p.text('clamp-status'),L.copyFailed);
  p.mode('missing');p.fallbackOK(false);p.click('clamp-copy-css');await settle();eq(lang+' missing fallback failure visible',p.text('clamp-status'),L.copyFailed);eq(lang+' original fallback copies complete',p.fallback.at(-1),p.text('clamp-declaration'));check(lang+' fallback textarea removed',!p.doc.querySelector('textarea'));
  p.fallbackOK(true);p.click('clamp-copy-css');await settle();eq(lang+' fallback success retry',p.text('clamp-status'),L.copied);
  for (const order of ['before','after']) for (const meta of [false,true]) {
    const q=open(lang,order,{property:'gap',unit:'px',root:20,minViewport:400,maxViewport:1200,startValue:8,endValue:24});
    eq(lang+order+' load preserved',q.el('clamp-property').value,'gap');
    const saves=q.persist.saveCalls.length;q.key('clamp-end-value',meta?'L':'l',meta);
    eq(lang+order+meta+' shortcut defaults',q.text('clamp-declaration'),'font-size: clamp(1rem, 0.7143rem + 1.4286vw, 2rem);');
    eq(lang+order+meta+' shortcut preview midpoint',q.el('clamp-preview-width').value,'880');
    eq(lang+order+meta+' shortcut removes once',q.persist.clearCalls.length,1);eq(lang+order+meta+' shortcut does not resave',q.persist.saveCalls.length,saves);eq(lang+order+meta+' persistence stays removed',q.persist.saved,null);
    q.input('clamp-end-value',48);check(lang+order+' ordinary save resumes',q.persist.saved?.endValue===48);q.key('outside');eq(lang+order+' outside scope',q.el('clamp-end-value').value,'48');eq(lang+order+' outside no clear',q.persist.clearCalls.length,1);
    q.storage.forEach(fn=>fn({key:'zt-input-css-clamp-calculator',newValue:null}));eq(lang+order+' storage default unchanged',q.el('clamp-end-value').value,'32');
  }
}
for (const button of ['clamp-copy-css','clamp-copy-value']) {
  for(const mutation of ['input','live','reset','shortcut'])for(const late of ['resolve','reject']){
    const p=open();p.click(button);const old=p.jobs.at(-1);
    if(mutation==='input')p.input('clamp-end-value',48);if(mutation==='live')p.input('clamp-preview-width',500);if(mutation==='reset')p.click('clamp-reset');if(mutation==='shortcut')p.key('clamp-end-value');
    const before=[p.text(button),p.text('clamp-status')];old[late](Error('late'));await settle();eq(button+mutation+late+' stale callback inert',[p.text(button),p.text('clamp-status')],before);eq(button+mutation+late+' no fallback',p.fallback.length,0);
  }
  for(const a of ['resolve','reject'])for(const b of ['resolve','reject']){
    const p=open();p.click(button);const old=p.jobs.at(-1);p.click(button);const current=p.jobs.at(-1);current[b](Error('current'));await settle();const before=[p.text(button),p.text('clamp-status')];old[a](Error('old'));await settle();eq(button+a+b+' same button latest',[p.text(button),p.text('clamp-status')],before);
    p.expire();eq(button+a+b+' original label restored',p.text(button),labels.en[button.endsWith('css')?'copyCss':'copyValue']);
  }
  const p=open();p.click(button);p.jobs.at(-1).resolve();await settle();const oldTimer=p.allTimers.at(-1);p.input('clamp-end-value',48);p.click(button);p.jobs.at(-1).reject(Error('new'));await settle();const before=p.text('clamp-status');oldTimer.fn();eq(button+' invalid old timer inert',p.text('clamp-status'),before);
}
{
 const p=open();p.click('clamp-copy-css');const css=p.jobs.at(-1);p.click('clamp-copy-value');p.jobs.at(-1).reject(Error('new'));await settle();css.resolve();await settle();eq('other-button old success retains current error',p.text('clamp-status'),labels.en.copyFailed);
}
// ---------- tool page MDX (src/content/tools/css-clamp-calculator/{lang}.mdx): worked examples ----------
// `ccc-check: {"property"?,"unit"?,"root"?,"min","max","start","end","at"?:[viewport],"zoom"?:bool}` sets
// the fields through the page script (property and unit with change events, the numbers with input
// events) on a fresh page. The generated declaration must equal a code element, a code block or an
// inline code span between the annotation and the next ccc-check or H2. For each `at` viewport the
// preview slider is moved there and the pixel value of the live preview ("29.8961px") must appear in
// that text. `zoom` says whether the zoom notice is in the status line. Each language needs at least 3.
{
  const decode=t=>t.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
  const codeSpans=text=>[...[...text.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map(m=>decode(m[1])),...fencedBlocks(text).map(b=>b.text),...[...text.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm,'').matchAll(/`([^`\n]+)`/g)].map(m=>m[1])];
  const shown=(text,s)=>new RegExp('(?<![\\d.])'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(text);
  function pageResult(lang,c){
    const p=open(lang),L=labels[lang];
    if(c.property)p.input('clamp-property',c.property,'change');
    if(c.unit)p.input('clamp-unit',c.unit,'change');
    if(c.root!==undefined)p.input('clamp-root',c.root);
    p.input('clamp-min-viewport',c.min);p.input('clamp-max-viewport',c.max);p.input('clamp-start-value',c.start);p.input('clamp-end-value',c.end);
    const out={declaration:p.text('clamp-declaration'),zoom:p.text('clamp-status')===L.zoomWarning,at:[]};
    for(const v of c.at||[]){p.input('clamp-preview-width',v);out.at.push(p.text('clamp-live-value').split(' / ')[0]);}
    return out;
  }
  const contract=toolMdxContract(SLUG,{annotations:[{tag:'ccc-check',min:3,verify:({spec:c,after,lang})=>{
    const r=pageResult(lang,c);
    if(!r.declaration)return 'the page shows no declaration for '+JSON.stringify(c);
    if(!codeSpans(after).includes(r.declaration))return 'no code span equals '+JSON.stringify(r.declaration);
    const missing=r.at.filter(v=>!shown(after,v));
    if(missing.length)return 'live preview values not shown after the annotation: '+missing.join(', ');
    if(c.zoom!==undefined&&c.zoom!==r.zoom)return 'zoom notice is '+(r.zoom?'shown':'not shown');
    return null;
  }}]});
  for(const r of contract.results)check('tool MDX: '+r.message,r.ok,r.message);
}

// Privacy wording (2026-10-08): no blanket run claims ("Everything runs client-side", "all happen in
// your browser"); the Privacy section and the privacy FAQ say what is stored and what analytics records
// (the component sends trackTool only for copy and reset).
{
  const absolute=/client-side|クライアント|클라이언트|客户端|everything runs|all happen|すべてブラウザー|모두 브라우저|都在浏览器/i;
  const analytics={en:/analytics/,zh:/统计/,ja:/アクセス解析/,ko:/통계/};
  const contract=toolMdxContract(SLUG);
  check('component tracks only copy and reset',JSON.stringify([...source.matchAll(/trackTool\(SLUG, '(\w+)'\)/g)].map(m=>m[1]))==='["copy","reset"]');
  for(const lang of langKeys){
    const {body,data}=contract.docs[lang];
    const privacy=body.slice(body.lastIndexOf('<h2>'));
    const faq=data.faqItems.find(f=>f.id==='privacy')?.answer||'';
    check(lang+' no blanket run claim in the page',!absolute.test(body)&&!absolute.test(faq),(body.match(absolute)||faq.match(absolute)||[])[0]);
    check(lang+' Privacy section names the analytics events',analytics[lang].test(privacy),privacy.slice(0,80));
    check(lang+' privacy FAQ names the analytics events',analytics[lang].test(faq));
  }
}

check('client self assertions',open().assertions.every(a=>a.ok));
check('no unhandled promises',asyncErrors.length===0,asyncErrors.join(';'));



check('registered generate layout',readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').includes("  'css-clamp-calculator': 'generate',"));

// v2 layout and SSR text: the runtime checks above still drive the actual candidate.
const tipKeys=["property", "unit", "root", "min", "max", "start", "end", "preview", "copyCss", "copyValue", "reset"];

const { parse } = createRequire(createRequire(join(root,'package.json')).resolve('astro/package.json'))('@astrojs/compiler');
try { const ast=await parse(source);check('Astro candidate syntax',Boolean(ast.ast)); } catch(error){check('Astro candidate syntax',false,String(error));}
check('SSR strings region',source.includes('// strings:start\nconst STRINGS =')&&source.includes('// strings:end'));
check('no stale labels identifier',! /\blabels\b/.test(source.split('\n---')[0]));
const actualFrontmatter=/^---\n([\s\S]*?)\n---/.exec(source)[1];
const actualStrings=/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(actualFrontmatter)[1];
const actualFallback=/const L = [^\n]+/.exec(actualFrontmatter)[0];
const fallback=vm.runInNewContext(actualStrings+'\nconst lang="unrecognized";'+actualFallback+'\n;L');
eq('actual frontmatter fallback resolves English',fallback,labels.en);
check('Toggletip import',source.includes("import Toggletip from '../Toggletip.astro'"));
const bindings=[...source.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.\w+\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g)];
eq('one real binding per tip',bindings.map(m=>m[2]).sort(),tipKeys.slice().sort());check('unique tip IDs',new Set(bindings.map(m=>m[1])).size===bindings.length);
for(const lang of langKeys){
  const L=labels[lang];for(const key of tipKeys)check(lang+' SSR tip '+key,typeof L.tips[key]==='string'&&L.tips[key].trim().length>0);
  check(lang+' empty explanation',typeof L.empty==='string'&&L.empty.trim().length>0);
  const dir=process.env.ZEROTOOL_QA_MDX_DIR;
  const mdxPath=dir?join(dir,`b12-${SLUG}-feature-${lang}.mdx`):join(root,'src/content/tools',SLUG,lang+'.mdx');
  const mdx=readFileSync(mdxPath,'utf8'),fm=/^---\n([\s\S]*?)\n---/.exec(mdx)[1];
  const region=/steps:\n([\s\S]*?)(?=^\w|$)/m.exec(fm);
  const steps=region?[...region[1].matchAll(/^  - (.+)$/gm)].map(m=>JSON.parse(m[1])):[];
  check(lang+' steps present and <=8',steps.length>0&&steps.length<=8);check(lang+' each step <=280',steps.every(step=>step.length<=280));check(lang+' total steps <=1200',steps.join('').length<=1200);check(lang+' plain steps',steps.every(step=>!/<[^>]+>|\*\*|`/.test(step)));check(lang+' steps before FAQ',fm.indexOf('steps:')>=0&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
}
const client=source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];check('tips stay out of client data',!client.includes('tips')&&!/data-[\w-]*tip/.test(source.split('<script')[0]));
check('270-320px desktop rail',/grid-template-columns:\s*clamp\(270px,\s*24vw,\s*320px\)\s*minmax\(0,\s*1fr\)/.test(source));
check('860px stack breakpoint',/@media \(max-width: 860px\)/.test(source));check('640px phone breakpoint',/@media \(max-width: 640px\)/.test(source));
check('root flex column and min-height0',/clamp-wrap[^{]*\{[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/.test(source)&&source.includes('.clamp-wrap { flex: 1; min-height: 0; }'));
check('result bounded desktop',source.includes('.clamp-result { min-width: 0; min-height: 0; overflow: auto; }'));
check('empty hidden on mobile',source.includes('.clamp-result[data-empty="true"] { display: none; }'));
check('rail uses shared zt-rail',source.includes('class="clamp-rail zt-rail"'));

check('main controls 44px phone',source.includes('.clamp-field .tool-input, .clamp-action button { min-height: 44px; }'));check('dense range24',source.includes('.clamp-preview-control input { min-height: 24px; }'));check('status reserved',source.includes('#clamp-status { min-height: 2.8em;'));
check('code length bounded',source.includes('.clamp-output-pre { height: 4.6rem;'));check('raw value internally scrolls',source.includes('.clamp-raw-row .tool-result-value { min-width: 0; overflow: auto; white-space: nowrap; }'));
const p=open();check('main live preview before exports and curve',source.indexOf('aria-labelledby="clamp-live-title"')<source.indexOf('aria-labelledby="clamp-output-title"')&&source.indexOf('aria-labelledby="clamp-output-title"')<source.indexOf('<details class="clamp-details">'));
eq('three independent buttons retained',p.doc.querySelectorAll('#clamp-copy-css,#clamp-copy-value,#clamp-reset').length,3);check('secondary curve/sample folded',!p.doc.querySelector('.clamp-details').hasAttribute('open'));p.input('clamp-root',0);eq('invalid empty signal',p.el('clamp-result').dataset.empty,'true');check('invalid explanation visible',!p.el('clamp-empty').hidden);p.input('clamp-root',16);eq('real input restores preview',p.el('clamp-result').dataset.empty,'false');check('real result content restored',!p.el('clamp-result-content').hidden);
for(const lang of langKeys){const mdx=readFileSync(process.env.ZEROTOOL_QA_MDX_DIR?join(process.env.ZEROTOOL_QA_MDX_DIR,`b12-${SLUG}-feature-${lang}.mdx`):join(root,'src/content/tools',SLUG,lang+'.mdx'),'utf8');check(lang+' default formula retained',mdx.includes('<pre><code>'+open(lang).text('clamp-declaration')+'</code></pre>'));}
console.log(`\n${passes} passed, ${failures} failed`);process.exit(failures?1:0);
