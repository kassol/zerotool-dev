// CSS Gradient Generator — gradient string
//
// Read:  src/components/tools/CssGradientGeneratorTool.astro (runs the real readAngle() and
//        gradientCss() between the `engine:start` / `engine:end` markers),
//        src/content/tools/css-gradient-generator/en.mdx
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the linear angle was read with `parseInt(v) || 90`, so the Top button (0deg) and a
// typed 0 produced linear-gradient(90deg, ...). The other strings are the examples quoted on the
// English tool page (CSS Images Level 3 / 4 syntax). stopList() writes stops in position order,
// stable for equal positions and clamped to 0–100 (an edited position used to leave the stops in
// list order, and CSS moved a smaller later position up to the one before it).
//
// Run: node scripts/test-css-gradient-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = process.env.ZT_B12_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B12_COMPONENT || join(root, 'src/components/tools/CssGradientGeneratorTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in CssGradientGeneratorTool.astro');
  process.exit(1);
}
const { gradientCss, stopList } = new Function(source.slice(start, end) + '\nreturn { readAngle, gradientCss, stopList };')();

let passes = 0, failures = 0;
function check(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log(`FAIL: ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

const two = '#3b82f6 0%, #8b5cf6 100%';
check('default linear', gradientCss('linear', { angle: '90' }, two), 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)');
check('0deg stays 0deg', gradientCss('linear', { angle: '0' }, two), 'linear-gradient(0deg, #3b82f6 0%, #8b5cf6 100%)');
check('180deg', gradientCss('linear', { angle: '180' }, two), 'linear-gradient(180deg, #3b82f6 0%, #8b5cf6 100%)');
check('empty angle falls back to 90deg', gradientCss('linear', { angle: '' }, two), 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)');
check('radial', gradientCss('radial', { shape: 'circle', position: 'top left' }, two), 'radial-gradient(circle at top left, #3b82f6 0%, #8b5cf6 100%)');
check('conic from 0', gradientCss('conic', { from: '0', position: 'center' }, two), 'conic-gradient(from 0deg at center, #3b82f6 0%, #8b5cf6 100%)');
check('conic pie example', gradientCss('conic', { from: '0', position: 'center' }, '#3b82f6 0%, #3b82f6 40%, #f59e0b 40%, #f59e0b 100%'),
  'conic-gradient(from 0deg at center, #3b82f6 0%, #3b82f6 40%, #f59e0b 40%, #f59e0b 100%)');

// Stops are written in position order whatever order the list is in (an edited position used to
// leave the list unsorted, and CSS then moves a smaller later position up to the one before it);
// equal positions keep their list order, so hard edges stay; positions are clamped to 0–100.
check('out-of-order stops sorted', stopList([{ color: '#ff0000', pos: '80' }, { color: '#00ff00', pos: '20' }, { color: '#0000ff', pos: '50' }]).join(', '), '#00ff00 20%, #0000ff 50%, #ff0000 80%');
check('equal positions keep list order', stopList([{ color: '#3b82f6', pos: '0' }, { color: '#f59e0b', pos: '40' }, { color: '#3b82f6', pos: '40' }, { color: '#f59e0b', pos: '100' }]).join(', '), '#3b82f6 0%, #f59e0b 40%, #3b82f6 40%, #f59e0b 100%');
check('clamped', stopList([{ color: '#000000', pos: '-5' }, { color: '#ffffff', pos: '150' }, { color: '#111111', pos: '' }]).join(', '), '#000000 0%, #111111 0%, #ffffff 100%');
check('page no longer says stops follow list order', /written in list order/.test(readFileSync(join(root, 'src/content/tools/css-gradient-generator/en.mdx'), 'utf8')), false);

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;


// Actual complete page entry points: shared shortcut orders, clipboard delivery and timers.
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
  const spec = {"slug": "css-gradient-generator", "name": "CssGradientGeneratorTool", "root": ".cgg-wrap", "copy": "cgg-copy", "input": "cgg-angle", "output": "cgg-code"};
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
  const timers=[],requests=[],assertions=[],persist={cleared:[],saved:[]},events={};let now=0,seq=0;
  const h={s,L,document,ids,timers,requests,assertions,persist,query:sel=>query(sel,wrap),all:sel=>queryAll(sel,wrap),unhandled:[],syncErrors:[],el:id=>{if(!ids.has(id))throw new Error('Missing actual element '+id);return ids.get(id);},input(id,value,type='input'){const e=this.el(id);e.value=String(value);e.dispatch(type);},click(id=s.copy){try{this.el(id).click();}catch(e){this.syncErrors.push(String(e));}},key(key='l',focus=s.input,meta=false){document.activeElement=focus==='outside'?{}:this.el(focus);document.dispatch('keydown',{key,ctrlKey:!meta,metaKey:meta,preventDefault(){},stopPropagation(){}});},advance(ms){now+=ms;for(const t of timers.filter(t=>!t.cancelled&&!t.ran&&t.due<=now)){t.ran=true;t.fn();}},state(){return {output:this.el(s.output).textContent,label:this.el(s.copy).textContent,aria:this.el(s.copy).getAttribute('aria-label')};}};
  active=h;
  const globals={document,isSecureContext:true,navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>requests.push({text,resolve,reject}))}},setTimeout:(fn,ms)=>{const id=++seq;timers.push({id,fn,ms,due:now+ms});return id;},clearTimeout:id=>{const t=timers.find(t=>t.id===id);if(t)t.cancelled=true;},addEventListener:(k,f)=>(events[k]??=[]).push(f),console:{...console,assert:(ok,...message)=>assertions.push({passed:!!ok,message})},ztPersist:{clear:slug=>persist.cleared.push(slug)},trackTool(){}};
  globals.window=globals;const ctx=vm.createContext(globals);const shared='var _slug='+JSON.stringify(s.slug)+';\n'+shortcuts;if(shellFirst)vm.runInContext(shared,ctx);for(const m of source.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],ctx);if(!shellFirst)vm.runInContext(shared,ctx);h.page={run:code=>vm.runInContext(code,ctx)};h.wrap=wrap;
  return h;
}

  function change(h) {
    h.input('cgg-angle', 180);
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
    // Even partial text input invalidates old feedback while preserving ordinary parse behavior.
    {h=open(spec,lang);h.click(); const text=h.query('.cgg-stop-hex');text.value='#';text.dispatch('input');const before=h.state();h.requests[0].resolve();await settle();check(lang+' partial input invalidates copy',h.state(),before);}
  }
    const h=open(spec);h.query('.cgg-dir-btn[data-deg="0"]').click();check('real zero-angle path',h.el('cgg-preview').style.background.startsWith('linear-gradient(0deg,'),true);
    h.query('.cgg-tab[data-type="radial"]').click();check('real radial path',h.el('cgg-preview').style.background.startsWith('radial-gradient('),true);h.query('.cgg-tab[data-type="conic"]').click();check('real conic zero path',h.el('cgg-preview').style.background.startsWith('conic-gradient(from 0deg'),true);
    for(let i=0;i<5;i++)h.click('cgg-add-stop');check('six stop maximum',h.all('.cgg-stop').length,6);for(let i=0;i<8;i++)h.query('.cgg-stop-remove').click();check('two stop minimum',h.all('.cgg-stop').length,2);
  process.removeListener('unhandledRejection',onUnhandled);
  const bad=rows.filter(r=>!r.passed); for(const r of bad)console.log('FAIL: '+r.name+' '+JSON.stringify({actual:r.actual,expected:r.expected}));
  console.log('PAGE '+(rows.length-bad.length)+' passed, '+bad.length+' failed');
  if(process.env.ZT_B12_REPORT) (await import('node:fs')).writeFileSync(process.env.ZT_B12_REPORT,JSON.stringify({node:process.version,component:process.env.ZT_B12_COMPONENT||'repository',rows,passed:rows.length-bad.length,failed:bad.length},null,2)+'\n');
  if(bad.length)process.exitCode=1;
}


// ---------- v2 page layout ----------
{
  const vm = (await import('node:vm')).default;
  const { createHash } = await import('node:crypto');
  const hash = s => createHash('sha256').update(s).digest('hex');
  let passes=0, failures=0;
  const check=(name, ok, detail='') => {if(ok)passes++;else {failures++;console.log('FAIL: v2 '+name+' '+detail);}};
  const slug="css-gradient-generator", prefix="cgg";
  const frontmatter=source.match(/^---\n([\s\S]*?)\n---/)[1];
  const strings=vm.runInNewContext(frontmatter.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
  const oldLabels=vm.runInNewContext('('+"{\n  en: {\n    type: 'Type',\n    linear: 'Linear',\n    radial: 'Radial',\n    conic: 'Conic',\n    angle: 'Angle (deg)',\n    direction: 'Direction',\n    shape: 'Shape',\n    circle: 'Circle',\n    ellipse: 'Ellipse',\n    position: 'Position',\n    fromAngle: 'From (deg)',\n    atPosition: 'At Position',\n    colorStops: 'Color Stops',\n    stopColor: 'Stop color',\n    stopHex: 'Stop hex value',\n    stopPos: 'Stop position (%)',\n    addStop: '+ Add Stop',\n    removeStop: '×',\n    preview: 'Preview',\n    outputLabel: 'Generated CSS',\n    copy: 'Copy',\n    copied: 'Copied!',\n  },\n  zh: {\n    type: '类型',\n    linear: '线性',\n    radial: '径向',\n    conic: '锥形',\n    angle: '角度 (deg)',\n    direction: '方向',\n    shape: '形状',\n    circle: '圆形',\n    ellipse: '椭圆',\n    position: '位置',\n    fromAngle: '起始角度 (deg)',\n    atPosition: '中心位置',\n    colorStops: '颜色节点',\n    stopColor: '节点颜色',\n    stopHex: '节点 HEX 值',\n    stopPos: '节点位置（%）',\n    addStop: '+ 添加',\n    removeStop: '×',\n    preview: '预览',\n    outputLabel: '生成的 CSS',\n    copy: '复制',\n    copied: '已复制！',\n  },\n  ja: {\n    type: 'タイプ',\n    linear: 'リニア',\n    radial: 'ラジアル',\n    conic: 'コニック',\n    angle: '角度 (deg)',\n    direction: '方向',\n    shape: '形状',\n    circle: '円形',\n    ellipse: '楕円',\n    position: '位置',\n    fromAngle: '開始角度 (deg)',\n    atPosition: '中心位置',\n    colorStops: 'カラーストップ',\n    stopColor: 'ストップの色',\n    stopHex: 'ストップの HEX 値',\n    stopPos: 'ストップの位置（%）',\n    addStop: '+ 追加',\n    removeStop: '×',\n    preview: 'プレビュー',\n    outputLabel: '生成された CSS',\n    copy: 'コピー',\n    copied: 'コピーしました！',\n  },\n  ko: {\n    type: '유형',\n    linear: '선형',\n    radial: '방사형',\n    conic: '원뿔형',\n    angle: '각도 (deg)',\n    direction: '방향',\n    shape: '모양',\n    circle: '원형',\n    ellipse: '타원',\n    position: '위치',\n    fromAngle: '시작 각도 (deg)',\n    atPosition: '중심 위치',\n    colorStops: '색상 정지점',\n    stopColor: '정지점 색상',\n    stopHex: '정지점 HEX 값',\n    stopPos: '정지점 위치（%）',\n    addStop: '+ 추가',\n    removeStop: '×',\n    preview: '미리보기',\n    outputLabel: '생성된 CSS',\n    copy: '복사',\n    copied: '복사됨!',\n  },\n}"+')');
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
  check('actual field header class has a valid CSS selector',markup.includes('class="'+prefix+'-field-header"')&&source.includes('.'+prefix+'-field-header'));
  check('no invalid spaced tool class selector',!new RegExp('\\.\\s+'+prefix+'-').test(source));
  check('generate kind registered',new RegExp('[\"\']'+slug+'[\"\']\\s*:\\s*[\"\']generate[\"\']').test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
  check('300px desktop rail',source.includes('flex: 0 0 300px'));
  check('stack and phone breakpoints',source.includes('@media (max-width: 860px)')&&source.includes('@media (max-width: 640px)'));
  check('real bounded preview',source.includes('.'+prefix+'-preview-section { flex: 1; min-width: 0; min-height: 0; overflow: auto; }'));
  check('empty preview hides on stacked screens',source.includes('.'+prefix+'-wrap[data-empty="true"] .'+prefix+'-preview-section { display: none; }'));
  check('reserved status',markup.includes('role="status"')&&source.includes('min-height: 1.4rem'));
  check('scrollable selectable code',markup.includes('tabindex="0" role="region"')&&source.includes('max-height: 8rem'));
  check('phone Copy target',source.includes('.'+prefix+'-wrap .btn-copy { min-height: 44px; }'));
  for(const snap of [{"lang": "en", "frontmatterSha": "1438d2601a69c8dae9845634e8db47fd8868f72a140a2d7bea8c16a6b82f7b17", "nonUsageBodySha": "a6f16726de1750e711be6e96931fb45d9355b606e8ec70526593b36efd949e18"}, {"lang": "zh", "frontmatterSha": "adbc456694df703e93b936f3cdb5cdd405bc7ed3fbc26778bb3e952828221178", "nonUsageBodySha": "f3cf509006ed616d30ea5418dc9873eb386cc0a745fde4f39ee45579bd97139a"}, {"lang": "ja", "frontmatterSha": "e84a2028edde0b1562c0ad21107e862d96f6da7f45157f625966a9e98a743c64", "nonUsageBodySha": "bf3135fbe8201afcc59e7f20adc1efafe549dbf956e69cbd938ba86ca5c2ac2b"}, {"lang": "ko", "frontmatterSha": "5c12e0715ef563957c7b02a0e45c9dc4f6b09da057bff574bbebe1313c9b59f6", "nonUsageBodySha": "7e804a3a51fa62a059a07e3a3346c23dc00ad289c75f1989299d1fb04349ddf5"}]) {
    const path=process.env.ZT_B12_MDX_PREFIX ? process.env.ZT_B12_MDX_PREFIX+snap.lang+'.mdx' : join(root,'src/content/tools/'+slug+'/'+snap.lang+'.mdx');
    const page=readFileSync(path,'utf8');const fm=page.match(/^---\n([\s\S]*?)\n---/)[1];
    const steps=[...fm.matchAll(/^  - ("[^\n]*")$/gm)].map(m=>JSON.parse(m[1]));
    check(snap.lang+' plain bounded steps',steps.length>0&&steps.length<=8&&steps.every(s=>s.length<=280)&&steps.reduce((n,s)=>n+s.length,0)<=1200);
    const withoutSteps=fm.replace(/^steps:\n(?:  - "[^\n]*"\n)+/m,'');
    check(snap.lang+' SEO/FAQ exact',hash(withoutSteps)===snap.frontmatterSha);
    let body=page.slice(page.indexOf('\n---')+4);
    check(snap.lang+' non-Usage body exact',hash(body)===snap.nonUsageBodySha);
    check(snap.lang+' old Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(page));
  }
  console.log('V2 '+passes+' passed, '+failures+' failed');
  if(process.env.ZT_B12_LAYOUT_REPORT)(await import('node:fs')).writeFileSync(process.env.ZT_B12_LAYOUT_REPORT,JSON.stringify({node:process.version,passes,failures,tips:tips.length},null,2)+'\n');
  if(failures)process.exitCode=1;
}
