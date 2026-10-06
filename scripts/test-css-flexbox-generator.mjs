// CSS Flexbox Generator — escaped highlight markup and the tool output quoted in the flexbox guides
//
// Read:  src/components/tools/CssFlexboxGeneratorTool.astro (extracts the real `highlightCss`
//        between the `engine:start` / `engine:end` markers, and runs the page script against a
//        stand-in DOM); src/content/blog/css-flexbox-generator-guide/{en,ja}.mdx
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the gap field was inserted into innerHTML as written, so
// `<img src=x onerror=…>` in a field became an element. The output is parsed with parse5:
// no element other than the highlight spans, and its text equals the plain CSS that Copy uses.
// The guides: each `cfg-check` annotation (field values) must be followed by the css block the
// tool produces; `cfg-grow` / `cfg-shrink` annotations recompute the flex-grow and scaled
// flex-shrink distributions quoted next to the Chrome measurements (§9.7, no min-size clamping);
// both guides indexable and without template headings.
//
// Run: node scripts/test-css-flexbox-generator.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssFlexboxGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { highlightCss } = new Function(source.slice(s, e) + '\nreturn { highlightCss };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + detail); } }

function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function inspect(html) {
  const tags = [];
  let text = '';
  walk(parseFragment(html), (n) => {
    if (n.tagName) tags.push(n.tagName);
    if (n.nodeName === '#text') text += n.value;
  });
  return { tags, text };
}

const attack = '1rem</span><img src=x onerror=alert(1)>';
const decls = [['display', 'flex'], ['flex-direction', 'row'], ['justify-content', 'center'], ['gap', attack], ['align-content', '1rem & "x"']];
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
const plain = '.container {\n' + decls.map((d) => '  ' + d[0] + ': ' + d[1] + ';').join('\n') + '\n}';
check('text equals the plain CSS', r.text === plain, JSON.stringify(r.text));
const normal = inspect(highlightCss([['display', 'flex'], ['gap', '1rem']]));
check('normal output text', normal.text === '.container {\n  display: flex;\n  gap: 1rem;\n}', JSON.stringify(normal.text));

// ---------- page script with a stand-in DOM: the tool output quoted in the css flexbox guides ----------
// `cfg-check` annotations in src/content/blog/css-flexbox-generator-guide/{en,ja}.mdx give the field
// values; the next ```css block in the guide must equal what Copy would put on the clipboard.
const els = {};
function makeEl(id) {
  const handlers = {};
  let html = '';
  const node = {
    id, value: '', textContent: '', className: '', style: {}, dataset: {}, children: [], classList: { remove() {} },
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); },
    get lastChild() { return this.children[this.children.length - 1]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    querySelectorAll(sel) { return this.children.filter((c) => '.' + c.className === sel); },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type) { (handlers[type] || []).forEach((fn) => fn.call(this, {})); },
  };
  return node;
}
function el(id) { return (els[id] ||= makeEl(id)); }
// The drop-down defaults are the CSS initial values, so the copied rule changes nothing the
// browser would not do anyway: flex-direction row and flex-wrap nowrap (CSS Flexbox Level 1
// §5.1, §5.2), justify-content / align-items / align-content normal (CSS Box Alignment Level 3
// §6.1, §6.3, §5.4; in a flex container align-items normal and align-content normal behave as
// stretch, and justify-content normal as flex-start).
const fieldDefaults = { 'cfg-direction': 'row', 'cfg-wrap': 'nowrap', 'cfg-justify': 'normal', 'cfg-align-items': 'normal', 'cfg-align-content': 'normal', 'cfg-gap': '1rem', 'cfg-items': '4' };
for (const [id, v] of Object.entries(fieldDefaults)) el(id).value = v;
// The select defaults above must be the ones marked `selected` in the component.
for (const [id, v] of Object.entries(fieldDefaults)) {
  const sel = new RegExp('<select id="' + id + '"[\\s\\S]*?</select>').exec(source);
  if (sel) check(`${id} default is ${v}`, new RegExp('<option value="' + v + '" selected>').test(sel[0]));
}
check('gap field default', /id="cfg-gap"[^>]*value="1rem"/.test(source));
check('items field default', /id="cfg-items"[^>]*min="1" max="8" value="4"/.test(source));
const pageScript = /<script is:inline>([\s\S]*?)<\/script>/.exec(source)[1];
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const doc = { currentScript: null, querySelector: () => wrap, getElementById: el, createElement: () => makeEl(''), addEventListener() {} };
new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', pageScript)(doc, { matchMedia: () => ({ matches: false }) }, {}, () => {}, () => {});

const onLoad = el('cfg-code').textContent;
check('output on load', onLoad === '.container {\n  display: flex;\n  flex-direction: row;\n  flex-wrap: nowrap;\n  justify-content: normal;\n  align-items: normal;\n  align-content: normal;\n  gap: 1rem;\n}', JSON.stringify(onLoad));
check('preview uses the initial values on load', el('cfg-preview').style.alignItems === 'normal' && el('cfg-preview').style.alignContent === 'normal' && el('cfg-preview').style.justifyContent === 'normal');
for (const id of ['cfg-justify', 'cfg-align-items', 'cfg-align-content']) {
  const sel = new RegExp('<select id="' + id + '"[\\s\\S]*?</select>').exec(source)[0];
  check(id + ' keeps flex-start as an option', /<option value="flex-start">flex-start<\/option>/.test(sel));
  check(id + ' lists normal first', /^<select[^>]*>\s*<option value="normal" selected>normal/.test(sel), sel.slice(0, 120));
}
check('preview has 4 items on load', el('cfg-preview').children.length === 4);

function generate(c) {
  const map = { dir: 'cfg-direction', wrap: 'cfg-wrap', justify: 'cfg-justify', alignItems: 'cfg-align-items', alignContent: 'cfg-align-content', gap: 'cfg-gap', items: 'cfg-items' };
  const full = { dir: 'row', wrap: 'nowrap', justify: 'normal', alignItems: 'normal', alignContent: 'normal', gap: '1rem', items: 4, ...c };
  for (const [k, id] of Object.entries(map)) { el(id).value = String(full[k]); el(id).fire(k === 'gap' || k === 'items' ? 'input' : 'change'); }
  return el('cfg-code').textContent;
}
generate({ items: 9 });
check('items are capped at 8', el('cfg-preview').children.length === 8);
generate({ items: 2 });
check('items can go down to 2', el('cfg-preview').children.length === 2);

// Simple flex resolution without min-size clamping (CSS Flexbox Level 1 §9.7), for the numbers the
// guides quote next to the Chrome measurements: grow shares free space by flex-grow; shrink takes
// the overflow in proportion to flex-shrink × flex base size (the scaled flex shrink factor).
function grow(container, bases, factors) {
  const free = container - bases.reduce((a, b) => a + b, 0);
  const sum = factors.reduce((a, b) => a + b, 0);
  return bases.map((b, i) => b + (free * factors[i]) / sum);
}
function shrink(container, bases, factors) {
  const over = bases.reduce((a, b) => a + b, 0) - container;
  const scaled = bases.map((b, i) => b * factors[i]);
  const sum = scaled.reduce((a, b) => a + b, 0);
  return bases.map((b, i) => b - (over * scaled[i]) / sum);
}

const TEMPLATE_H2 = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m];
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/css-flexbox-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = TEMPLATE_H2.filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  const marks = [...guide.matchAll(/\{\/\* cfg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check(lang + ' guide has cfg-check annotations', marks.length >= 2, marks.length);
  check(lang + ' every cfg-check is followed by a css block', marks.length === (guide.match(/cfg-check:/g) || []).length);
  for (const m of marks) {
    const out = generate(JSON.parse(m[1]));
    check(`${lang} generator output ${m[1]}`, out === m[2].trimEnd(), JSON.stringify(out) + ' vs ' + JSON.stringify(m[2]));
  }
  for (const m of guide.matchAll(/\{\/\* cfg-(grow|shrink): (\{.*?\}) \*\/\}/g)) {
    const c = JSON.parse(m[2]);
    const got = (m[1] === 'grow' ? grow : shrink)(c.container, c.bases, c.factors).map((x) => +x.toFixed(2));
    check(`${lang} ${m[1]} ${m[2]}`, JSON.stringify(got) === JSON.stringify(c.out), JSON.stringify(got));
  }
  check(lang + ' guide has grow and shrink checks', /cfg-grow:/.test(guide) && /cfg-shrink:/.test(guide));
}

// Actual complete script and ToolLayout shortcuts; only browser boundaries are controlled.
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcuts=layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'),layout.indexOf('      // ── Copy button visual feedback'));
const spec={"slug": "css-flexbox-generator", "name": "CssFlexboxGeneratorTool", "root": ".cfg-wrap", "copy": "cfg-copy", "input": "cfg-gap", "output": "cfg-code", "preview": "cfg-preview", "status": "cfg-status"};
let active=null;
const unhandled=error=>{if(active)active.unhandled.push(String(error));};
process.on('unhandledRejection',unhandled);
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function open(s,lang='en',order='component-first'){
  const comp={src:source,frontmatter:source.match(/^---\n([\s\S]*?)\n---/)[1]};
  const table=comp.frontmatter.includes('const STRINGS =')?'STRINGS':'labels';
  const labels=vm.runInNewContext(comp.frontmatter.slice(comp.frontmatter.indexOf('const '+table+' ='),comp.frontmatter.indexOf('const L ='))+';'+table);
  const L=labels[lang], escaped=x=>String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  // Parse actual static markup, resolving only its build-time localized expressions.
  const html=comp.src.replace(/^---\n[\s\S]*?\n---/,'').replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<style\b[\s\S]*?<\/style>/g,'').replace(/([\w-]+)=\{L\.(\w+)\}/g,(_,a,k)=>a+'="'+escaped(L[k])+'"').replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(L[k]));
  const tree=parseFragment(html), all=[],ids=new Map();let document;
  const plain=n=>n.nodeName==='#text'?n.value:(n.childNodes||[]).map(plain).join('');
  function adapt(n){
    if(!n.tagName){(n.childNodes||[]).forEach(adapt);return;}
    all.push(n); const attrs=Object.fromEntries(n.attrs.map(a=>[a.name,a.value])); const handlers={};
    n.id=attrs.id||'';n.tagName=n.tagName.toUpperCase();n.type=attrs.type||'';let value=attrs.value||'';Object.defineProperty(n,'value',{get:()=>value,set:v=>{value=String(v);}});n.checked='checked'in attrs;n.disabled='disabled'in attrs;n.hidden='hidden'in attrs;n.className=attrs.class||'';n.style={};n.dataset={};
    for(const [k,v] of Object.entries(attrs))if(k.startsWith('data-'))n.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;
    if(n.id)ids.set(n.id,n);
    Object.defineProperty(n,'textContent',{get(){return plain(this);},set(v){this.childNodes=[{nodeName:'#text',value:String(v),parentNode:this}];}});
    Object.defineProperty(n,'innerHTML',{get(){return this._html||'';},set(v){this._html=String(v);this.childNodes=parseFragment(String(v)).childNodes;for(const c of this.childNodes){c.parentNode=this;adapt(c);}}});
    n.setAttribute=(k,v)=>{attrs[k]=String(v);};n.getAttribute=k=>attrs[k]??null;n.removeAttribute=k=>{delete attrs[k];};
    n.addEventListener=(k,f)=>(handlers[k]??=[]).push(f);
    n.dispatch=(type,init={})=>{const e={type,target:n,currentTarget:n,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of handlers[type]||[])f.call(n,e);if(!e.cancelBubble)document.dispatch(type,e);return e;};
    n.click=()=>{if(!n.disabled)n.dispatch('click');};n.focus=()=>{document.activeElement=n;};n.select=()=>{};n.remove=()=>{};n.appendChild=c=>c;n.scrollIntoView=()=>{h.scrolls++;};
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
  const h={s,L,document,ids,scrolls:0,timers,requests,assertions,persist,readers,query:sel=>query(sel,wrap),all:sel=>queryAll(sel,wrap),frames(){for(const f of rafs.splice(0))f();},unhandled:[],syncErrors:[],el:id=>{if(!ids.has(id))throw new Error('Missing actual element '+id);return ids.get(id);},input(id,value,type='input'){const e=this.el(id);e.value=String(value);e.dispatch(type);},click(id=s.copy){try{this.el(id).click();}catch(e){this.syncErrors.push(String(e));}},key(key){this.el(s.input).focus();document.dispatch('keydown',{key,ctrlKey:true,metaKey:false,preventDefault(){},stopPropagation(){}});},advance(ms){now+=ms;for(const t of timers.filter(t=>!t.cancelled&&!t.ran&&t.due<=now)){t.ran=true;t.fn();}},state(){return {output:this.el(s.output).textContent,label:this.el(s.copy).textContent,aria:this.el(s.copy).getAttribute('aria-label'),disabled:this.el(s.copy).disabled,status:ids.get(s.status)?.textContent||'',preview:s.preview?{html:this.el(s.preview).innerHTML,children:this.el(s.preview).children.length,style:{...this.el(s.preview).style}}:null};}};
  active=h;
  class LocalReader {constructor(){readers.push(this);}readAsDataURL(file){this.ready=file.arrayBuffer().then(bytes=>{this.result='data:'+file.type+';base64,'+Buffer.from(bytes).toString('base64');});}deliver(){this.onload?.({target:this});}}
  const globals={document,isSecureContext:true,FileReader:LocalReader,File,Blob,requestAnimationFrame:f=>{rafs.push(f);return rafs.length;},alert:message=>{h.alerts??=[];h.alerts.push(message);},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>requests.push({text,resolve,reject}))}},setTimeout:(fn,ms)=>{const id=++seq;timers.push({id,fn,ms,due:now+ms});return id;},clearTimeout:id=>{const t=timers.find(t=>t.id===id);if(t)t.cancelled=true;},addEventListener:(k,f)=>(events[k]??=[]).push(f),console:{...console,assert:(ok,...message)=>assertions.push({passed:!!ok,message})},ztPersist:{load:()=>null,save:(slug,value)=>persist.saved.push({slug,value}),clear:slug=>persist.cleared.push(slug)},trackTool(){}};
  globals.window=globals;globals.matchMedia=()=>({matches:false});const ctx=vm.createContext(globals);const page={ctx,run:code=>vm.runInContext(code,ctx)};
  if(order==='shared-first')page.run('var _slug='+JSON.stringify(s.slug)+';\n'+shortcuts);
  page.run(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1]);
  if(order==='component-first')page.run('var _slug='+JSON.stringify(s.slug)+';\n'+shortcuts);h.page=page;
  return h;
}

function assertEq(name,actual,expected){check(name,JSON.stringify(actual)===JSON.stringify(expected),JSON.stringify({actual,expected}));}
function changePage(h){h.input(spec.input,spec.slug==='css-variables-generator'?'brand':'24px');}
for(const lang of ['en','zh','ja','ko'])for(const order of ['component-first','shared-first']){
  const name=lang+' '+order+' ';let h=open(spec,lang,order);

  assertEq(name+'actual default four preview cells',h.el('cfg-preview').children.length,4);
  for(const dir of ['column','column-reverse','row-reverse','row']){h.input('cfg-direction',dir,'change');assertEq(name+'direction '+dir,[h.el('cfg-preview').style.flexDirection,h.el(spec.output).textContent.includes('flex-direction: '+dir+';')],[dir,true]);}
  h.input('cfg-wrap','wrap','change');h.input('cfg-justify','space-between','change');assertEq(name+'wrap/justify survive existing select behavior',[h.el('cfg-preview').style.flexWrap,h.el('cfg-preview').style.justifyContent],['wrap','space-between']);
  h.input('cfg-items',99);assertEq(name+'items clamp to8',h.el('cfg-preview').children.length,8);h.input('cfg-items',1);assertEq(name+'items can reduce to1',h.el('cfg-preview').children.length,1);

  changePage(h);const original=h.state();
  h.key('Enter');assertEq(name+'CtrlEnter keeps the independent Copy path',h.state(),original);
  const kept=h.all('input[type="number"],input[type="color"],select').map(n=>[n.id,n.value]);
  const rows=h.all('.cvg-token-row').length;
  h.key('l');assertEq(name+'CtrlL clears every real text field',h.all('input[type="text"]').map(n=>n.value),h.all('input[type="text"]').map(()=>''));
  assertEq(name+'CtrlL clears derived output',h.el(spec.output).textContent,'');
  assertEq(name+'CtrlL disables copy',h.el(spec.copy).disabled,true);
  assertEq(name+'CtrlL restores original copy label',h.el(spec.copy).textContent,h.L.copy);
  assertEq(name+'CtrlL retains numeric/native color/select settings',h.all('input[type="number"],input[type="color"],select').map(n=>[n.id,n.value]),kept);
  if(spec.preview){assertEq(name+'CtrlL clears preview children',h.el(spec.preview).children.length,0);assertEq(name+'CtrlL clears preview styles',Object.values(h.el(spec.preview).style).every(v=>v===''),true);}
  else assertEq(name+'CtrlL retains current token rows',h.all('.cvg-token-row').length,rows);
  assertEq(name+'shared persistence clear runs once',h.persist.cleared,[spec.slug]);
  h=open(spec,lang,order);changePage(h);const outside=h.state();h.document.activeElement=h.document.body;h.document.dispatch('keydown',{key:'l',ctrlKey:true,preventDefault(){}});assertEq(name+'tool-external CtrlL preserves result',h.state(),outside);
  h=open(spec,lang,order);h.click();assertEq(name+'copy uses real exact snapshot',h.requests[0].text,h.el(spec.output).textContent);h.requests[0].reject(new Error('current failure'));await settle();
  assertEq(name+'current rejection is handled',h.unhandled,[]);assertEq(name+'current rejection is localized',h.el(spec.copy).textContent,h.L.copyFailed);check(name+'four-language failure exists',typeof h.L.copyFailed==='string'&&h.L.copyFailed.length>0);
  const same=h.el(spec.output).textContent;h.click();h.requests[1].resolve();await settle();assertEq(name+'direct same-result retry',[h.el(spec.copy).textContent,h.el(spec.output).textContent],[h.L.copied,same]);
  for(const mode of ['missing','throw']){h=open(spec,lang,order);h.page.ctx.navigator.clipboard=mode==='missing'?undefined:{writeText(){throw new Error('clipboard unavailable');}};h.click();await settle();assertEq(name+mode+' API handled',h.unhandled,[]);assertEq(name+mode+' API visible',h.el(spec.copy).textContent,h.L.copyFailed);}
  for(const event of ['input','CtrlL'])for(const outcome of ['resolve','reject']){h=open(spec,lang,order);h.click();if(event==='input')changePage(h);else h.key('l');const before=h.state();h.requests[0][outcome](outcome==='reject'?new Error('stale failure'):undefined);await settle();assertEq(name+'late '+outcome+' after '+event,h.state(),before);assertEq(name+'late '+outcome+' rejection handled',h.unhandled,[]);}
  for(const outcome of ['resolve','reject']){h=open(spec,lang,order);h.click();h.click();h.requests[1].resolve();await settle();const before=h.state();h.requests[0][outcome](outcome==='reject'?new Error('older copy'):undefined);await settle();assertEq(name+'older same-button '+outcome,h.state(),before);assertEq(name+'older request handled',h.unhandled,[]);}
  h=open(spec,lang,order);h.click();h.requests[0].resolve();await settle();const timer=h.timers.find(t=>t.ms===1500);h.advance(1499);h.click();h.requests[1].resolve();await settle();h.advance(1);assertEq(name+'old deadline keeps newest copied',h.el(spec.copy).textContent,h.L.copied);timer.fn();assertEq(name+'forced old timer is harmless',h.el(spec.copy).textContent,h.L.copied);h.advance(1500);assertEq(name+'latest timer restores original label',h.el(spec.copy).textContent,h.L.copy);
  for(const event of ['input','CtrlL']){h=open(spec,lang,order);h.click();h.requests[0].resolve();await settle();const timer=h.timers.find(t=>t.ms===1500);if(event==='input')changePage(h);else h.key('l');const before=h.state();timer.fn();assertEq(name+'old timer after '+event,h.state(),before);}
  h=open(spec,lang,order);h.key('l');h.click();assertEq(name+'empty result is never copied',h.requests.length,0);
}
active=null;process.removeListener('unhandledRejection',unhandled);

// ---------- generate layout and four-language reference protection ----------
{
  const markup=source.slice(source.indexOf('\n---\n',4)+5,source.indexOf('<script'));
  const css=source.slice(source.indexOf('<style'));
  const P='cfg';
  check('v2 root takes available height',css.includes('.'+P+'-wrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; }'));
  check('270–320px shared rail and remaining result',markup.includes('class="'+P+'-rail zt-rail"')&&css.includes('grid-template-columns: clamp(270px, 24vw, 320px) minmax(0, 1fr)'));
  check('860px stack and 640px phone rules',css.includes('@media (max-width: 860px)')&&css.includes('@media (max-width: 640px)'));
  check('native details preserve all secondary controls',markup.includes('<details')&&!/<details[^>]*\sopen/.test(markup));
  check('Copy keeps a stable 44px target',new RegExp('#'+P+'-copy \\{[^}]*height: 44px').test(css));
  check('phone main inputs keep 44px targets',css.includes('.cfg-num-input, .cfg-text-input, .cfg-select { min-height: 44px; }'));
  check('runtime-created rows and syntax have global styles',css.includes(':global(.cfg-cell)')&&css.includes(':global(.cfg-hl-val)'));
  check('status space stays reserved',css.includes('#'+P+'-status { height: 2.8em; flex: none; margin: 0; overflow: auto; }'));
  check('result can scroll inside a bounded region',css.includes('overflow: auto;')&&(css.includes('height: 15rem;')||css.includes('max-height: 3.8rem;')));
  check('code accepts keyboard focus',/tabindex="0" role="region" aria-label=\{L.outputLabel\}/.test(markup));
  check('empty results hide on stacked screens',css.includes('[data-empty="true"] { display: none; }'));
  check('localized SSR prose stays out of client data',source.includes('// strings:start')&&source.includes('// strings:end')&&!source.includes('define:vars')&&!source.includes('data-strings')&&!source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1].includes('.tips'));
  assertEq('each actual control has its SSR tip', [...markup.matchAll(/<Toggletip id=/g)].length,8);
  const hashes={"en": "92ff9e64c488c2028f61e99d37299cb129c9bde46c3297a6216234e8324e73c0", "zh": "42cd799f787f2aaa343b8e22ad77e64dde6ac940f0ea67899961462b2d25c47b", "ja": "60a07281a34314d536be44bb67ba5dbb2b80f47acb5c2b64dce117f54ab3783f", "ko": "631abfeefc57f3a296fa7b5817fa89686af1190fcfb96ec5f0690e0dc4643265"},reference={"en": {"frontmatterWithoutSteps": "a58bf46fb209a544b779c417e80703b6a1a86fc8a2618b26614abeeb6fe52062", "nonUsageBody": "acf1c24b6b6ff9270e6bad62e81ba31b861ae9619216552ee710c3bc0ff63a31", "steps": 8, "maxStepChars": 107, "totalStepChars": 603, "mdxSHA": "f1eb1c3d2edd9c6e000fd8e84f5cc2c6eee4626a461525161a5e26b59199ca6c"}, "zh": {"frontmatterWithoutSteps": "27c5ebd78ee294f0fd9379db44574f773ba2657787dc0dacc17d48b6d44be39a", "nonUsageBody": "02dc993c9cc28c9dad66fe181db639280fda720b7fec19f63b5f0c53e80e673e", "steps": 8, "maxStepChars": 52, "totalStepChars": 236, "mdxSHA": "3f5a4f11d5a3c69ad0a6dc76c42cd991c1ad84870b27fc3fca4457ca27fa028c"}, "ja": {"frontmatterWithoutSteps": "4e28f8d7b7830b48b46117e50ba1844c33b200c67b130ec0393cc65c58d3d2eb", "nonUsageBody": "8eb93a3645bebf5b0e4545ffdebe71b88e1d901a4622c823ab195bbc2c54e0fb", "steps": 8, "maxStepChars": 73, "totalStepChars": 308, "mdxSHA": "03b8410ad4328da6fc98f06f0d1711b4ddab5c5b03487b9277a545403699652d"}, "ko": {"frontmatterWithoutSteps": "082dc9d32b3f89265ac35f92d41ea9c1697b1acf6f15de3c63cd3aac4e8e11bb", "nonUsageBody": "38138b1712d0d92e7acf2a971893784d5187fa8a617304e049c9ae26bce4448e", "steps": 8, "maxStepChars": 71, "totalStepChars": 326, "mdxSHA": "85ad09e94b8dfbb73239815e3402cf83414d06425befdf0842605d7aecf375a5"}};
  const digest=text=>createHash('sha256').update(text).digest('hex');
  for(const lang of ['en','zh','ja','ko']){
    const h=open(spec,lang);const old=Object.fromEntries(Object.entries(h.L).filter(([key])=>!['editor','removeLabel','options','empty','tips'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    assertEq(lang+' old localized values stay exact',digest(JSON.stringify(old)),hashes[lang]);
    const mdx=readFileSync(join(root,'src/content/tools/css-flexbox-generator/'+lang+'.mdx'),'utf8'),fm=mdx.match(/^---\n([\s\S]*?)\n---/),front=fm[1],body=mdx.slice(fm[0].length);
    const section=front.slice(front.indexOf('\nsteps:\n'),front.indexOf('\nfaqItems:'));
    const steps=[...section.matchAll(/^  - (".*")$/gm)].map(m=>JSON.parse(m[1]));
    assertEq(lang+' Usage moved into plain steps',steps.length,reference[lang].steps);
    check(lang+' step limits',steps.every(step=>[...step].length<=280)&&steps.reduce((n,step)=>n+[...step].length,0)<=1200);
    check(lang+' Copy and clear instructions are concrete',steps.at(-1).includes(h.L.copy)&&steps.at(-1).includes('Ctrl/⌘+L'));
    assertEq(lang+' all nonUsage body including Limits stays exact',digest(body),reference[lang].nonUsageBody);
    assertEq(lang+' FAQ and SEO stay exact',digest(front.replace(/\nsteps:\n(?:  - .*\n)*/,'\n')),reference[lang].frontmatterWithoutSteps);
    check(lang+' tips are factual plain localized prose',Object.keys(h.L.tips).length===8&&Object.values(h.L.tips).every(text=>typeof text==='string'&&text.length>0&&!/[<>]|https?:/.test(text)));
    assertEq(lang+' initial rendering does not scroll',h.scrolls,0);
    h.key('l');assertEq(lang+' clear hides real result and shows empty hint',[h.el(P+'-result').dataset.empty,h.el(P+'-empty').hidden],['true',false]);
    h.page.ctx.matchMedia=()=>({matches:true});changePage(h);assertEq(lang+' real phone input restores result',[h.el(P+'-result').dataset.empty,h.el(P+'-empty').hidden],['false',true]);
    assertEq(lang+' phone real input scrolls result into view',h.scrolls,1);
    const c=open(spec,lang);c.click();c.requests[0].reject(new Error('current clipboard denial'));await settle();assertEq(lang+' current failure also appears in reserved status',c.el(P+'-status').textContent,c.L.copyFailed);
    c.click();assertEq(lang+' retry clears only current copy status',c.el(P+'-status').textContent,'');c.requests[1].resolve();await settle();
  }
}

check('registered generate layout',readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').includes("  'css-flexbox-generator': 'generate',"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
