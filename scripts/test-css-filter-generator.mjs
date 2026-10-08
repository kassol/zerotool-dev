// CSS Filter Generator — value clamping and filter string
//
// Read:  src/components/tools/CssFilterGeneratorTool.astro (runs the real DEFAULTS, clampValue() and
//        buildFilter() between the `engine:start` / `engine:end` markers)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the slider handler used `parseFloat(v) || default`, so moving Brightness, Contrast,
// Opacity or Saturate to 0 snapped back to 100%. The filter string keeps the function order of the
// Filter Effects Level 1 list and omits functions at their default value; the strings checked here are
// the examples quoted on the English tool page.
//
// Run: node scripts/test-css-filter-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = process.env.ZT_B12_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B12_COMPONENT || join(root, 'src/components/tools/CssFilterGeneratorTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in CssFilterGeneratorTool.astro');
  process.exit(1);
}
const make = new Function('state', source.slice(start, end) + '\nreturn { DEFAULTS, clampValue, buildFilter };');

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const probe = make({});
const keys = Object.keys(probe.DEFAULTS);
function filterOf(overrides) {
  const state = {};
  for (const k of keys) state[k] = probe.DEFAULTS[k].default;
  Object.assign(state, overrides);
  return make(state).buildFilter();
}

for (const k of keys) {
  check(`${k}: slider value "0" stays 0`, probe.clampValue(k, '0') === 0, probe.clampValue(k, '0'));
  check(`${k}: empty field falls back to the default`, probe.clampValue(k, '') === probe.DEFAULTS[k].default);
  check(`${k}: value above the maximum is clamped`, probe.clampValue(k, String(probe.DEFAULTS[k].max + 50)) === probe.DEFAULTS[k].max);
  check(`${k}: negative value is clamped to the minimum`, probe.clampValue(k, '-5') === probe.DEFAULTS[k].min);
}
check('blur keeps one decimal', probe.clampValue('blur', '2.5') === 2.5);

check('all defaults → none', filterOf({}) === 'none', filterOf({}));
check('brightness 0 is written', filterOf({ brightness: 0 }) === 'brightness(0%)', filterOf({ brightness: 0 }));
check('opacity 0 is written', filterOf({ opacity: 0 }) === 'opacity(0%)', filterOf({ opacity: 0 }));
check('hover example', filterOf({ grayscale: 100, contrast: 110 }) === 'contrast(110%) grayscale(100%)', filterOf({ grayscale: 100, contrast: 110 }));
check('dark-mode example', filterOf({ invert: 100, 'hue-rotate': 180 }) === 'hue-rotate(180deg) invert(100%)', filterOf({ invert: 100, 'hue-rotate': 180 }));
check('fixed function order', filterOf({ sepia: 60, blur: 1.5, saturate: 140 }) === 'blur(1.5px) saturate(140%) sepia(60%)', filterOf({ sepia: 60, blur: 1.5, saturate: 140 }));

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;


// Actual complete page entry points: shared shortcut orders, clipboard delivery and timers.
// FileReader retains real File/Blob byte reads; only callback delivery is controlled.
{
  const vm = (await import('node:vm')).default;
  const { parseFragment } = await import(join(root, 'node_modules/parse5/dist/index.js'));
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcuts = layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'), layout.indexOf('      // ── Copy button visual feedback'));
  const rows = []; let active = null;
  const onUnhandled = e => { if (active) active.unhandled.push(String(e)); };
  process.on('unhandledRejection', onUnhandled);
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  function check(name, actual, expected) {
    rows.push({name, passed: JSON.stringify(actual) === JSON.stringify(expected), actual, expected});
  }
  const spec = {"slug": "css-filter-generator", "name": "CssFilterGeneratorTool", "root": ".cfg-wrap", "copy": "cfg-copy", "input": "cfg-blur", "output": "cfg-code"};
function open(s,lang='en',shellFirst=false){
  const comp={src:source,frontmatter:source.match(/^---\n([\s\S]*?)\n---/)[1]};
  const varName=comp.frontmatter.includes('const STRINGS =')?'STRINGS':'labels'; const labels=vm.runInNewContext(comp.frontmatter.slice(comp.frontmatter.indexOf('const '+varName+' ='),comp.frontmatter.indexOf('const L ='))+';'+varName);
  const L=labels[lang], escaped=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  // Parse actual static markup, resolving only its build-time localized expressions.
  const html=comp.src.replace(/^---\n[\s\S]*?\n---/,'').replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<style\b[\s\S]*?<\/style>/g,'').replace(/([\w-]+)=\{L\.(\w+)\}/g,(_,a,k)=>a+'="'+escaped(L[k])+'"').replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(L[k]));
  const tree=parseFragment(html), all=[],ids=new Map();let document;
  const plain=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(plain).join('');
  function adapt(n){
    if(!n.tagName){(n.childNodes||[]).forEach(adapt);return;}
    all.push(n); const attrs=Object.fromEntries(n.attrs.map(a=>[a.name,a.value])); const handlers={};
    n.id=attrs.id||'';n.tagName=n.tagName.toUpperCase();n.type=attrs.type||'';let value=attrs.value||'';Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);if(n.type==='file'&&value==='')n.files=[];}});n.checked='checked'in attrs;n.disabled='disabled'in attrs;n.hidden='hidden'in attrs;n.className=attrs.class||'';n.style={};n.dataset={};
    for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))n.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;
    if(n.id)ids.set(n.id,n);
    Object.defineProperty(n,'textContent',{get(){return plain(this);},set(v){this.childNodes=[{nodeName:'#text',value:String(v),parentNode:this}];}});
    Object.defineProperty(n,'innerHTML',{get(){return this._html||'';},set(v){this._html=String(v);this.childNodes=parseFragment(String(v)).childNodes;for(const c of this.childNodes){c.parentNode=this;adapt(c);}}});
    n.setAttribute=(k,v)=>{attrs[k]=String(v);};n.getAttribute=k=>attrs[k]??null;n.removeAttribute=k=>{delete attrs[k];};Object.defineProperty(n,'src',{get:()=>attrs.src||'',set:v=>{attrs.src=String(v);}});n.scrollIntoView=()=>{};
    n.addEventListener=(k,f)=>(handlers[k]??=[]).push(f);
    n.dispatch=(type,init={})=>{const e={type,target:n,currentTarget:n,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of handlers[type]||[])f.call(n,e);if(!e.cancelBubble)document.dispatch(type,e);return e;};
    n.click=()=>{if(!n.disabled)n.dispatch('click');};n.focus=()=>{document.activeElement=n;};n.select=()=>{};n.remove=()=>{};n.appendChild=c=>c;
    n.contains=x=>{while(x){if(x===n)return true;x=x.parentNode;}return false;};
    Object.defineProperty(n,'lastChild',{get:()=>n.childNodes.at(-1)});Object.defineProperty(n,'children',{get:()=>n.childNodes.filter(c=>c.tagName)});
    n.appendChild=c=>{if(c.parentNode)c.parentNode.childNodes.splice(c.parentNode.childNodes.indexOf(c),1);n.childNodes.push(c);c.parentNode=n;return c;};n.removeChild=c=>{n.childNodes.splice(n.childNodes.indexOf(c),1);c.parentNode=null;return c;};n.remove=()=>{if(n.parentNode)n.parentNode.removeChild(n);};
    n.querySelector=sel=>query(sel,n);n.querySelectorAll=sel=>queryAll(sel,n);
    n.classList={contains:c=>n.className.split(/\s+/).includes(c),add:(...cs)=>{n.className=[...new Set([...n.className.split(/\s+/),...cs])].join(' ').trim();},remove:(...cs)=>{n.className=n.className.split(/\s+/).filter(c=>!cs.includes(c)).join(' ');},toggle:(c,force)=>{const add=force===undefined?!n.classList.contains(c):force;n.classList[add?'add':'remove'](c);return add;}};
    (n.childNodes||[]).forEach(adapt);
    if(n.tagName==='SELECT')n.value=(n.childNodes.find(c=>c.tagName==='OPTION'&&c.attrs.some(a=>a.name==='selected'))||n.childNodes.find(c=>c.tagName==='OPTION')||{}).value||'';
  }
  function matches(n,sel){
    const attr=sel.match(/\[([\w-]+)="([^"]*)"\]$/);if(attr){sel=sel.slice(0,attr.index);let v=attr[1]==='type'?n.type:attr[1].startsWith('data-')?n.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:n.getAttribute(attr[1]);if(v!==attr[2])return false;}
    if(sel.startsWith('#'))return n.id===sel.slice(1);if(sel.startsWith('.'))return n.className.split(/\s+/).includes(sel.slice(1));return n.tagName.toLowerCase()===sel;
  }
  function queryAll(sel,within){const out=[];function walk(n){for(const c of n.childNodes||[]){if(c.tagName&&sel.split(',').some(x=>matches(c,x.trim())))out.push(c);walk(c);}}walk(within||tree);return out;}
  function query(sel,within){return queryAll(sel,within)[0]||null;}
  const docHandlers={};document={currentScript:null,documentElement:{lang},getElementById:id=>ids.get(id)||null,querySelector:sel=>sel==='.tool-widget'?wrap:sel==='.tool-widget .btn-primary'?query('.btn-primary',wrap):query(sel),querySelectorAll:sel=>queryAll(sel),addEventListener:(k,f)=>(docHandlers[k]??=[]).push(f),dispatch(type,e){for(const f of docHandlers[type]||[])f(e);},body:{appendChild:c=>c},createElement:tag=>{const n=parseFragment('<'+tag+'></'+tag+'>').childNodes[0];adapt(n);return n;},execCommand:()=>false};
  adapt(tree);const wrap=query(s.root);wrap.closest=()=>wrap;
  const timers=[],requests=[],assertions=[],rafs=[],readers=[],persist={cleared:[],saved:[]},events={};let now=0,seq=0;
  const h={s,L,document,ids,timers,requests,assertions,persist,readers,query:sel=>query(sel,wrap),all:sel=>queryAll(sel,wrap),frames(force=false){for(const r of rafs.splice(0))if(force||!r.cancelled)r.fn();},unhandled:[],syncErrors:[],el:id=>{if(!ids.has(id))throw new Error('Missing actual element '+id);return ids.get(id);},input(id,value,type='input'){const e=this.el(id);e.value=String(value);e.dispatch(type);},click(id=s.copy){try{this.el(id).click();}catch(e){this.syncErrors.push(String(e));}},key(key='l',focus=s.input,meta=false){document.activeElement=focus==='outside'?{}:this.el(focus);document.dispatch('keydown',{key,ctrlKey:!meta,metaKey:meta,preventDefault(){},stopPropagation(){}});},advance(ms){now+=ms;for(const t of timers.filter(t=>!t.cancelled&&!t.ran&&t.due<=now)){t.ran=true;t.fn();}},state(){return {output:this.el(s.output).textContent,label:this.el(s.copy).textContent,aria:this.el(s.copy).getAttribute('aria-label')};}};
  active=h;
  class LocalReader {constructor(){readers.push(this);}readAsDataURL(file){this.ready=file.arrayBuffer().then(bytes=>{this.result='data:'+file.type+';base64,'+Buffer.from(bytes).toString('base64');});}deliver(){this.onload?.({target:this});}}
  const globals={document,isSecureContext:true,FileReader:LocalReader,File,Blob,requestAnimationFrame:f=>{const id=++seq;rafs.push({id,fn:f});return id;},cancelAnimationFrame:id=>{const r=rafs.find(r=>r.id===id);if(r)r.cancelled=true;},alert:message=>{h.alerts??=[];h.alerts.push(message);},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>requests.push({text,resolve,reject}))}},setTimeout:(fn,ms)=>{const id=++seq;timers.push({id,fn,ms,due:now+ms});return id;},clearTimeout:id=>{const t=timers.find(t=>t.id===id);if(t)t.cancelled=true;},addEventListener:(k,f)=>(events[k]??=[]).push(f),console:{...console,assert:(ok,...message)=>assertions.push({passed:!!ok,message})},ztPersist:{load:()=>null,save:(slug,value)=>persist.saved.push({slug,value}),clear:slug=>persist.cleared.push(slug)},trackTool(){}};
  globals.window=globals;const ctx=vm.createContext(globals);const shared='var _slug='+JSON.stringify(s.slug)+';\n'+shortcuts;if(shellFirst)vm.runInContext(shared,ctx);for(const m of source.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],ctx);if(!shellFirst)vm.runInContext(shared,ctx);h.page={run:code=>vm.runInContext(code,ctx)};h.wrap=wrap;
  return h;
}

  function change(h) {
    h.input('cfg-blur', 2.5); h.frames();
  }
  const failedLabels = {en:'Copy failed',zh:'复制失败',ja:'コピーに失敗しました',ko:'복사 실패'};
  for (const lang of ['en','zh','ja','ko']) {
    for (const shellFirst of [false,true]) {
      let h=open(spec,lang,shellFirst); const retained=h.all('input[type="number"],input[type="range"],input[type="color"],select').map(e=>e.value);
      h.click();h.key('L',spec.input,true); check(lang+' clear text/order '+shellFirst,h.all('input[type="text"]').every(e=>e.value===''),true);
      check(lang+' clear CSS/order '+shellFirst,h.el(spec.output).textContent,'');
      check(lang+' retained settings/order '+shellFirst,h.all('input[type="number"],input[type="range"],input[type="color"],select').map(e=>e.value),retained);
      const snapshot=h.state();h.requests[0].resolve();await settle();check(lang+' late success after clear/order '+shellFirst,h.state(),snapshot);
      change(h);check(lang+' input resumes/order '+shellFirst,h.el(spec.output).textContent.length>0,true);
      const before=h.state();h.key('l','outside');check(lang+' outside focus ignored/order '+shellFirst,h.state(),before);
    }
    let h=open(spec,lang);h.click();check(lang+' copies complete CSS',h.requests[0].text,h.el(spec.output).textContent);
    h.requests[0].reject(new Error('current reject'));await settle();check(lang+' reject visibly handled',[h.unhandled.length,h.el(spec.copy).textContent],[0,failedLabels[lang]]);
    h.click();h.requests[1].resolve();await settle();check(lang+' same result retry',h.el(spec.copy).textContent,h.L.copied);
    h.advance(1500);check(lang+' feedback expiry',h.el(spec.copy).textContent,h.L.copy);
    h=open(spec,lang);h.page.run('navigator.clipboard = undefined');h.click();check(lang+' missing API visibly handled',[h.syncErrors.length,h.el(spec.copy).textContent],[0,failedLabels[lang]]);
    h=open(spec,lang);h.page.run("navigator.clipboard.writeText = function () { throw new Error('synchronous rejection'); }");h.click();check(lang+' synchronous throw visibly handled',[h.syncErrors.length,h.el(spec.copy).textContent],[0,failedLabels[lang]]);
    for(const event of ['new result','clear','new copy']) for(const outcome of ['resolve','reject']) {
      h=open(spec,lang);h.click();const old=h.requests[0];
      if(event==='new result')change(h);else if(event==='clear')h.key();else {h.click();h.requests[1].resolve();await settle();}
      const before=h.state();old[outcome](outcome==='reject'?new Error('old reject'):undefined);await settle();check(lang+' stale '+outcome+' '+event,[h.state(),h.unhandled.length],[before,0]);
    }
    h=open(spec,lang);h.click();h.requests[0].resolve();await settle();h.advance(1499);h.click();h.requests[1].resolve();await settle();h.advance(1);check(lang+' one current feedback timer',h.el(spec.copy).textContent,h.L.copied);h.advance(1500);check(lang+' newest timer expiry',h.el(spec.copy).textContent,h.L.copy);
  }
    async function selection(h,tag) {const file=new File(['<svg>'+tag+'</svg>'],tag+'.svg',{type:'image/svg+xml'});h.el('cfg-file-input').files=[file];h.el('cfg-file-input').dispatch('change');const r=h.readers.at(-1);await r.ready;return r;}
    let h=open(spec);const a=await selection(h,'old');h.key();a.deliver();check('FileReader old delivery after clear',h.el('cfg-preview-img').src,'');check('selected file clears',h.el('cfg-file-input').files.length,0);
    h=open(spec);const first=await selection(h,'first');const second=await selection(h,'second');second.deliver();first.deliver();check('FileReader newer selection wins',h.el('cfg-preview-img').src,second.result);check('real File bytes preserved',Buffer.from(second.result.split(',')[1],'base64').toString(),'<svg>second</svg>');
    h=open(spec);h.input('cfg-blur',2.5);h.key();h.frames(true);check('queued rAF cannot restore cleared CSS',h.el(spec.output).textContent,'');check('queued rAF cannot save after clear',h.persist.saved.length,0);check('numeric setting retained',h.el('cfg-blur').value,'2.5');h.input('cfg-brightness',0);h.frames();check('numeric change restores default local SVG',h.el('cfg-preview-img').src.startsWith('data:image/svg+xml,'),true);check('zero and prior numeric setting preserved',h.el(spec.output).textContent.includes('blur(2.5px) brightness(0%)'),true);
    h=open(spec);h.input('cfg-blur',3);const reader=await selection(h,'new');reader.deliver();const saves=h.persist.saved.length;h.frames(true);check('new selection invalidates queued save',h.persist.saved.length,saves);check('new selection remains',h.el('cfg-preview-img').src,reader.result);
    h=open(spec);h.el('cfg-file-input').files=[new File([new Uint8Array(5*1024*1024+1)],'large.png',{type:'image/png'})];h.el('cfg-file-input').dispatch('change');check('same 5MB rejection',h.alerts,['Max file size is 5 MB']);check('5MB rejection skips FileReader',h.readers.length,0);
    for(const key of ['blur','brightness','contrast','grayscale','hue-rotate','invert','opacity','saturate','sepia']) {h=open(spec);h.input('cfg-'+key,0);h.frames();check(key+' page preserves zero',h.el('cfg-'+key).value,'0');h.query('.cfg-reset-btn[data-key="'+key+'"]').click();h.frames();check(key+' Reset resumes CSS',h.el(spec.output).textContent,'.element {\n  filter: none;\n}');check(key+' saves numbers only',Object.values(h.persist.saved.at(-1).value).every(v=>typeof v==='number'),true);}
    h=open(spec);h.input('cfg-sepia',50);h.frames();h.click('cfg-reset-all');h.frames();check('Reset All preserves original defaults',h.el(spec.output).textContent,'.element {\n  filter: none;\n}');
  process.removeListener('unhandledRejection',onUnhandled);
  const bad=rows.filter(r=>!r.passed); for(const r of bad)console.log('FAIL: '+r.name+' '+JSON.stringify({actual:r.actual,expected:r.expected}));
  console.log('PAGE '+(rows.length-bad.length)+' passed, '+bad.length+' failed');
  if(process.env.ZT_B12_REPORT) (await import('node:fs')).writeFileSync(process.env.ZT_B12_REPORT,JSON.stringify({node:process.version,component:process.env.ZT_B12_COMPONENT||'repository',rows,passed:rows.length-bad.length,failed:bad.length},null,2)+'\n');
  if(bad.length)process.exitCode=1;
}


// ---------- v2 page layout ----------
{
  const vm = (await import('node:vm')).default;
  let passes=0, failures=0;
  const check=(name, ok, detail='') => {if(ok)passes++;else {failures++;console.log('FAIL: v2 '+name+' '+detail);}};
  const slug="css-filter-generator", prefix="cfg";
  const frontmatter=source.match(/^---\n([\s\S]*?)\n---/)[1];
  const strings=vm.runInNewContext(frontmatter.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
  const oldLabels=vm.runInNewContext('('+"{\n  en: {\n    blur: 'Blur',\n    brightness: 'Brightness',\n    contrast: 'Contrast',\n    grayscale: 'Grayscale',\n    hueRotate: 'Hue Rotate',\n    invert: 'Invert',\n    opacity: 'Opacity',\n    saturate: 'Saturate',\n    sepia: 'Sepia',\n    reset: 'Reset',\n    resetAll: 'Reset All',\n    preview: 'Preview',\n    uploadImage: 'Upload Image',\n    outputLabel: 'Generated CSS',\n    copy: 'Copy',\n    copied: 'Copied!',\n    pxUnit: 'px',\n    pctUnit: '%',\n    degUnit: 'deg',\n    uploadHint: 'Click to upload (max 5 MB)',\n  },\n  zh: {\n    blur: '模糊',\n    brightness: '亮度',\n    contrast: '对比度',\n    grayscale: '灰度',\n    hueRotate: '色相旋转',\n    invert: '反转',\n    opacity: '不透明度',\n    saturate: '饱和度',\n    sepia: '褐色',\n    reset: '重置',\n    resetAll: '全部重置',\n    preview: '预览',\n    uploadImage: '上传图片',\n    outputLabel: '生成的 CSS',\n    copy: '复制',\n    copied: '已复制！',\n    pxUnit: 'px',\n    pctUnit: '%',\n    degUnit: 'deg',\n    uploadHint: '点击上传（最大 5 MB）',\n  },\n  ja: {\n    blur: 'ぼかし',\n    brightness: '明るさ',\n    contrast: 'コントラスト',\n    grayscale: 'グレースケール',\n    hueRotate: '色相回転',\n    invert: '反転',\n    opacity: '不透明度',\n    saturate: '彩度',\n    sepia: 'セピア',\n    reset: 'リセット',\n    resetAll: 'すべてリセット',\n    preview: 'プレビュー',\n    uploadImage: '画像をアップロード',\n    outputLabel: '生成された CSS',\n    copy: 'コピー',\n    copied: 'コピーしました！',\n    pxUnit: 'px',\n    pctUnit: '%',\n    degUnit: 'deg',\n    uploadHint: 'クリックしてアップロード（最大 5 MB）',\n  },\n  ko: {\n    blur: '흐림',\n    brightness: '밝기',\n    contrast: '대비',\n    grayscale: '회색조',\n    hueRotate: '색조 회전',\n    invert: '반전',\n    opacity: '불투명도',\n    saturate: '채도',\n    sepia: '세피아',\n    reset: '초기화',\n    resetAll: '모두 초기화',\n    preview: '미리보기',\n    uploadImage: '이미지 업로드',\n    outputLabel: '생성된 CSS',\n    copy: '복사',\n    copied: '복사됨!',\n    pxUnit: 'px',\n    pctUnit: '%',\n    degUnit: 'deg',\n    uploadHint: '클릭하여 업로드 (최대 5 MB)',\n  },\n}"+')');
  const tips=[...source.matchAll(/<Toggletip\b([^>]+)>\{L\.tips\.(\w+)\}<\/Toggletip>/g)];
  check('SSR tips exist',tips.length>=6,String(tips.length));
  for(const lang of ['en','zh','ja','ko']) {
    for(const [key,value] of Object.entries(oldLabels[lang])) check(lang+' original label '+key,strings[lang][key]===value,key);
    check(lang+' empty result prose',typeof strings[lang].empty==='string'&&strings[lang].empty.length>0);
    for(const tip of tips) {check(lang+' bound tip '+tip[2],typeof strings[lang].tips[tip[2]]==='string'&&strings[lang].tips[tip[2]].length>0); const about=tip[1].match(/about=\{L\.(\w+)\}/);check(lang+' tip label '+tip[2],!!about&&typeof strings[lang][about[1]]==='string');}
  }
  const markup=source.replace(/^---\n[\s\S]*?\n---/,'').replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<style\b[\s\S]*?<\/style>/g,'');
  const script=[...source.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  check('tips excluded from client data',!script.includes('L.tips')&&!/data-[\w-]+\s*=\{L\.tips/.test(markup));
  check('one tool root owns flex height',source.includes('.'+prefix+'-wrap { min-height: 0; min-width: 0; flex: 1; }'));
  check('generate rail uses actual shared class',markup.includes('class="'+prefix+'-rail zt-rail"'));
  check('actual field header class has a valid CSS selector',markup.includes(prefix+'-field-header')&&source.includes('.'+prefix+'-field-header'));
  check('no invalid spaced tool class selector',!new RegExp('\\.\\s+'+prefix+'-').test(source));
  check('generate kind registered',new RegExp('[\"\']'+slug+'[\"\']\\s*:\\s*[\"\']generate[\"\']').test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
  check('300px desktop rail',source.includes('flex: 0 0 300px'));
  check('stack and phone breakpoints',source.includes('@media (max-width: 860px)')&&source.includes('@media (max-width: 640px)'));
  check('real bounded preview',source.includes('.'+prefix+'-preview-section { flex: 1; min-width: 0; min-height: 0; overflow: auto; }'));
  check('empty preview hides on stacked screens',source.includes('.'+prefix+'-wrap[data-empty="true"] .'+prefix+'-preview-section { display: none; }'));
  check('reserved status',markup.includes('role="status"')&&source.includes('min-height: 1.4rem'));
  check('scrollable selectable code',markup.includes('tabindex="0" role="region"')&&source.includes('max-height: 8rem'));
  check('phone Copy target',source.includes('.'+prefix+'-wrap .btn-copy { min-height: 44px; }'));
  for(const snap of [{"lang": "en"}, {"lang": "zh"}, {"lang": "ja"}, {"lang": "ko"}]) {
    const path=process.env.ZT_B12_MDX_PREFIX ? process.env.ZT_B12_MDX_PREFIX+snap.lang+'.mdx' : join(root,'src/content/tools/'+slug+'/'+snap.lang+'.mdx');
    const page=readFileSync(path,'utf8');const fm=page.match(/^---\n([\s\S]*?)\n---/)[1];
    const steps=[...fm.matchAll(/^  - ("[^\n]*")$/gm)].map(m=>JSON.parse(m[1]));
    check(snap.lang+' plain bounded steps',steps.length>0&&steps.length<=8&&steps.every(s=>s.length<=280)&&steps.reduce((n,s)=>n+s.length,0)<=1200);
    check(snap.lang+' MDX content contract', !contractProblems('css-filter-generator', snap.lang), contractProblems('css-filter-generator', snap.lang));
    let body=page.slice(page.indexOf('\n---')+4);
    if(snap.lang==='en') body=body.replace("\n<h2>Example: Zero Brightness and Opacity</h2>\n<p>Set Brightness and Opacity to zero while leaving the other seven controls at their defaults. The generator preserves both zero values and writes brightness before opacity. Reset Opacity alone to 100 to remove opacity() from the rule; brightness(0%) stays.</p>\n\n{/* cfg-check: {\"values\":{\"brightness\":0,\"opacity\":0},\"out\":\"brightness(0%) opacity(0%)\"} */}\n```css\n.element {\n  filter: brightness(0%) opacity(0%);\n}\n```\n",'');
    check(snap.lang+' old Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(page));
  }
    check('native secondary disclosure',markup.includes('<details id="cfg-more"')&&script.includes("moreFilters.open = false"));
    check('uploaded result scrolls on phones',script.includes("scrollIntoView({ block: 'start', behavior: 'smooth' })"));
    check('no empty image address',!markup.includes('src=""'));
    const page=readFileSync(process.env.ZT_B12_MDX_PREFIX?process.env.ZT_B12_MDX_PREFIX+'en.mdx':join(root,'src/content/tools/'+slug+'/en.mdx'),'utf8');
    const m=page.match(/\{\/\* cfg-check: (\{[^\n]+\}) \*\/\}/);check('worked example annotation',!!m);
    if(m) {const c=JSON.parse(m[1]);const block=source.match(/\/\* ── engine:start ── \*\/([\s\S]*?)\/\* ── engine:end ── \*\//)[1];const make=new Function('state',block+';return {DEFAULTS,buildFilter};');const state={};for(const [k,v]of Object.entries(make({}).DEFAULTS))state[k]=v.default;Object.assign(state,c.values);check('actual worked example output',make(state).buildFilter()===c.out);check('worked output shown',page.includes('filter: '+c.out+';'));}
  console.log('V2 '+passes+' passed, '+failures+' failed');
  if(process.env.ZT_B12_LAYOUT_REPORT)(await import('node:fs')).writeFileSync(process.env.ZT_B12_LAYOUT_REPORT,JSON.stringify({node:process.version,passes,failures,tips:tips.length},null,2)+'\n');
  if(failures)process.exitCode=1;
}
