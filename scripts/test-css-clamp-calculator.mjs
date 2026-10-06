// CSS Clamp Calculator — actual page regressions. Read component/harness; write stdout only.
import { readFileSync } from 'node:fs';
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
  let html = source.replace(/^---\n[\s\S]*?\n---/, '').replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g,'').replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/g,'').replace(/<Toggletip\s[^>]*\/>/g,'');
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
check('client self assertions',open().assertions.every(a=>a.ok));
check('no unhandled promises',asyncErrors.length===0,asyncErrors.join(';'));


console.log(`${passes} passed, ${failures} failed`);process.exit(failures?1:0);
