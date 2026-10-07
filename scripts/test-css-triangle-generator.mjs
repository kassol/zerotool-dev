// CSS Triangle Generator — border widths for odd sizes
//
// Read:  src/components/tools/CssTriangleGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/css-triangle-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: for every width / height from 1 to 400, the two transparent borders of the top, bottom,
// left and right triangles add up to exactly that size (they used to round each half up, so width
// 25 gave 13px + 13px, a 26px base), and differ by at most 1px; the coloured border keeps the
// other size; corner triangles are unchanged; the example on the English page.
//
// Run: node scripts/test-css-triangle-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = process.env.ZT_B12_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B12_COMPONENT || join(root, 'src/components/tools/CssTriangleGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/css-triangle-generator/en.mdx'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in CssTriangleGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { computeBorders };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}
const px = (rules) => Object.fromEntries(rules.map((r) => { const m = /^(border-\w+): (\d+)px solid (\S+)$/.exec(r); return [m[1], [Number(m[2]), m[3]]]; }));

eq('width 25, top', E.computeBorders('top', 25, 20, '#3b82f6'), ['border-left: 12px solid transparent', 'border-right: 13px solid transparent', 'border-bottom: 20px solid #3b82f6']);
eq('height 15, right', E.computeBorders('right', 30, 15, '#000000'), ['border-top: 7px solid transparent', 'border-bottom: 8px solid transparent', 'border-left: 30px solid #000000']);
eq('corner unchanged', E.computeBorders('top-left', 25, 15, '#000000'), ['border-top: 15px solid #000000', 'border-right: 25px solid transparent']);

let ok = true;
for (let n = 1; n <= 400 && ok; n++) {
  for (const dir of ['top', 'bottom']) {
    const b = px(E.computeBorders(dir, n, 37, '#111111'));
    const l = b['border-left'][0], r = b['border-right'][0];
    if (l + r !== n || Math.abs(l - r) > 1 || (b['border-bottom'] || b['border-top'])[0] !== 37) { ok = false; eq(dir + ' width ' + n, [l, r], 'sum ' + n); }
  }
  for (const dir of ['left', 'right']) {
    const b = px(E.computeBorders(dir, 37, n, '#111111'));
    const t = b['border-top'][0], bo = b['border-bottom'][0];
    if (t + bo !== n || Math.abs(t - bo) > 1 || (b['border-left'] || b['border-right'])[0] !== 37) { ok = false; eq(dir + ' height ' + n, [t, bo], 'sum ' + n); }
  }
}
if (ok) passes++;

eq('page no longer says odd widths become one pixel wider', page.includes('Odd widths become one pixel wider'), false);

console.log(passes + ' passed, ' + failures + ' failed');
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
  const spec = {"slug": "css-triangle-generator", "name": "CssTriangleGeneratorTool", "root": ".ctg-wrap", "copy": "ctg-copy-css", "input": "ctg-hex", "output": "ctg-code-css"};
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
    h.input('ctg-width', 125);
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
    {h=open(spec,lang);h.click(); const text=h.el('ctg-hex');text.value='#';text.dispatch('input');const before=h.state();h.requests[0].resolve();await settle();check(lang+' partial input invalidates copy',h.state(),before);}
  }
    const h=open(spec); h.key();h.click('ctg-copy-html');check('HTML constant available after clear',h.requests[0].text,'<div class="triangle"></div>');h.requests[0].resolve();await settle();check('HTML copy success',h.el('ctg-copy-html').textContent,h.L.copied);h.input('ctg-width',25);h.input('ctg-height',11);
    for(const dir of ['top','right','bottom','left','top-left','top-right','bottom-left','bottom-right']) {h.query('.ctg-dir-btn[data-dir="'+dir+'"]').click();check('direction '+dir,h.el(spec.output).textContent.includes('.triangle {'),true);}
  for(const lang of ['en','zh','ja','ko']) {
    let h=open(spec,lang);h.click('ctg-copy-html');check(lang+' HTML complete copy',h.requests[0].text,'<div class="triangle"></div>');h.requests[0].reject(new Error('HTML current reject'));await settle();check(lang+' HTML rejection visible',h.el('ctg-copy-html').textContent,failedLabels[lang]);h.click('ctg-copy-html');h.requests[1].resolve();await settle();check(lang+' HTML retry succeeds',h.el('ctg-copy-html').textContent,h.L.copied);
    h.advance(1499);h.click('ctg-copy-html');h.requests[2].resolve();await settle();h.advance(1);check(lang+' HTML old timer invalid',h.el('ctg-copy-html').textContent,h.L.copied);h.advance(1500);check(lang+' HTML newest timer expires',h.el('ctg-copy-html').textContent,h.L.copy);
    h=open(spec,lang);h.click('ctg-copy-html');h.click('ctg-copy-css');h.requests[1].resolve();await settle();const before=h.state();h.requests[0].reject(new Error('HTML stale after CSS'));await settle();check(lang+' HTML stale rejection after CSS',[h.state(),h.el('ctg-copy-html').textContent,h.unhandled.length],[before,h.L.copy,0]);
    h=open(spec,lang);h.click('ctg-copy-css');h.click('ctg-copy-html');h.requests[1].resolve();await settle();h.requests[0].resolve();await settle();check(lang+' CSS stale success after HTML',[h.el('ctg-copy-css').textContent,h.el('ctg-copy-html').textContent],[h.L.copy,h.L.copied]);
  }
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
  const slug="css-triangle-generator", prefix="ctg";
  const frontmatter=source.match(/^---\n([\s\S]*?)\n---/)[1];
  const strings=vm.runInNewContext(frontmatter.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
  const oldLabels=vm.runInNewContext('('+"{\n  en: {\n    direction: 'Direction',\n    width: 'Width (px)',\n    height: 'Height (px)',\n    color: 'Color',\n    preview: 'Preview',\n    outputLabel: 'Generated CSS',\n    htmlLabel: 'HTML Usage',\n    copy: 'Copy',\n    copied: 'Copied!',\n    top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left',\n    topLeft: 'Top-Left', topRight: 'Top-Right',\n    bottomLeft: 'Bottom-Left', bottomRight: 'Bottom-Right',\n  },\n  zh: {\n    direction: '方向',\n    width: '宽度 (px)',\n    height: '高度 (px)',\n    color: '颜色',\n    preview: '预览',\n    outputLabel: '生成的 CSS',\n    htmlLabel: 'HTML 用法',\n    copy: '复制',\n    copied: '已复制！',\n    top: '上', right: '右', bottom: '下', left: '左',\n    topLeft: '左上', topRight: '右上',\n    bottomLeft: '左下', bottomRight: '右下',\n  },\n  ja: {\n    direction: '方向',\n    width: '幅 (px)',\n    height: '高さ (px)',\n    color: '色',\n    preview: 'プレビュー',\n    outputLabel: '生成された CSS',\n    htmlLabel: 'HTML 使用例',\n    copy: 'コピー',\n    copied: 'コピーしました！',\n    top: '上', right: '右', bottom: '下', left: '左',\n    topLeft: '左上', topRight: '右上',\n    bottomLeft: '左下', bottomRight: '右下',\n  },\n  ko: {\n    direction: '방향',\n    width: '너비 (px)',\n    height: '높이 (px)',\n    color: '색상',\n    preview: '미리보기',\n    outputLabel: '생성된 CSS',\n    htmlLabel: 'HTML 사용법',\n    copy: '복사',\n    copied: '복사됨!',\n    top: '위', right: '오른쪽', bottom: '아래', left: '왼쪽',\n    topLeft: '왼쪽 위', topRight: '오른쪽 위',\n    bottomLeft: '왼쪽 아래', bottomRight: '오른쪽 아래',\n  },\n}"+')');
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
  for(const snap of [{"lang": "en", "frontmatterSha": "136ffa43b3e8974fdf0e1efdcb4b351ce393cf162622e6e0421c7a77dceef203", "nonUsageBodySha": "8e12879c1d761c2eb748f6dde20201ad32836c4a9a6ee3ae3a51f9b997bf05d3"}, {"lang": "zh", "frontmatterSha": "3626e0456e5ad08f7c742faa44316efa805933dc29cf4a09a362bfc2de3585dd", "nonUsageBodySha": "68ffd9fefaf24219a2ac99ca220c226fbd0d0565adccc1e8a0356fae259eb049"}, {"lang": "ja", "frontmatterSha": "dfc9f0a0ff201ec9787d8377c0dbf0f08d023028f2394404f91380e7a842f468", "nonUsageBodySha": "6c47ee1210e0f7bd6cb16b05d5d02f0b7cd0bc12cee0c16b3d5025ccd474afa4"}, {"lang": "ko", "frontmatterSha": "ffa834aa4d704812aaecc36f50f637bd2126241028efb2ab54bc598abb929e20", "nonUsageBodySha": "aa242b623d2a6fd53304d7b02c14cbdffcb3f1e01e24e200fcf13b9c43fd1f55"}]) {
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
