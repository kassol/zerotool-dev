// CSS Grid Generator — escaped highlight markup and the tool output quoted in the css grid guides
//
// Read:  src/components/tools/CssGridGeneratorTool.astro (extracts the real `highlightCss`
//        between the `engine:start` / `engine:end` markers, and runs the page script against a
//        stand-in DOM); src/content/blog/css-grid-generator-guide/{en,ja}.mdx
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the template and gap fields were inserted into innerHTML as written, so
// `<img src=x onerror=…>` in a field became an element. The output is parsed with parse5:
// no element other than the highlight spans, and its text equals the plain CSS that Copy uses.
// The guides: each `cgg-check` annotation (field values) must be followed by the css block the
// tool produces; the auto-fill / fr arithmetic quoted next to the Chrome measurements; both
// guides indexable and without template headings.
//
// Run: node scripts/test-css-grid-generator.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssGridGeneratorTool.astro'), 'utf8');
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

const attack = '1fr</span><img src=x onerror=alert(1)>';
const decls = [['display', 'grid'], ['grid-template-columns', attack], ['grid-template-rows', 'repeat(2, 1fr)'], ['column-gap', '1rem & "x"'], ['row-gap', '16px']];
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
const plain = '.container {\n' + decls.map((d) => '  ' + d[0] + ': ' + d[1] + ';').join('\n') + '\n}';
check('text equals the plain CSS', r.text === plain, JSON.stringify(r.text));
const normal = inspect(highlightCss([['display', 'grid'], ['grid-template-columns', 'repeat(3, 1fr)']]));
check('normal output text', normal.text === '.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n}', JSON.stringify(normal.text));

// ---------- page script with a stand-in DOM: the tool output quoted in the css grid guides ----------
// `cgg-check` annotations in src/content/blog/css-grid-generator-guide/{en,ja}.mdx give the
// field values; the next ```css block in the guide must equal what Copy would put on the clipboard.
const els = {};
function makeEl(id) {
  const handlers = {};
  let html = '';
  return {
    id, value: '', textContent: '', style: {}, dataset: {}, children: [], classList: { remove() {} },
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); if (v === '') this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type) { (handlers[type] || []).forEach((fn) => fn.call(this, {})); },
  };
}
function el(id) { return (els[id] ||= makeEl(id)); }
const fieldDefaults = { 'cgg-cols': '3', 'cgg-rows': '2', 'cgg-col-gap': '1rem', 'cgg-row-gap': '1rem', 'cgg-tmpl-cols': 'repeat(3, 1fr)', 'cgg-tmpl-rows': 'repeat(2, 1fr)' };
for (const [id, v] of Object.entries(fieldDefaults)) el(id).value = v;
const pageScript = /<script is:inline>([\s\S]*?)<\/script>/.exec(source)[1];
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const doc = { currentScript: null, querySelector: () => wrap, getElementById: el, createElement: () => makeEl(''), addEventListener() {} };
new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', pageScript)(doc, { matchMedia: () => ({ matches: false }) }, {}, () => {}, () => {});

const onLoad = el('cgg-code').textContent;
check('output on load', onLoad === '.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  grid-template-rows: repeat(2, 1fr);\n  column-gap: 1rem;\n  row-gap: 1rem;\n}', JSON.stringify(onLoad));
check('preview draws Columns × Rows cells', el('cgg-preview').children.length === 6, el('cgg-preview').children.length);
check('preview gap is row gap then column gap', el('cgg-preview').style.gap === '1rem 1rem');

function generate(c) {
  el('cgg-cols').value = String(c.cols); el('cgg-cols').fire('input');
  el('cgg-rows').value = String(c.rows); el('cgg-rows').fire('input');
  el('cgg-col-gap').value = c.colGap; el('cgg-col-gap').fire('input');
  el('cgg-row-gap').value = c.rowGap; el('cgg-row-gap').fire('input');
  if (c.tmplCols !== undefined) { el('cgg-tmpl-cols').value = c.tmplCols; el('cgg-tmpl-cols').fire('input'); }
  if (c.tmplRows !== undefined) { el('cgg-tmpl-rows').value = c.tmplRows; el('cgg-tmpl-rows').fire('input'); }
  return el('cgg-code').textContent;
}
// Changing a count after typing a template rewrites the template (the guides tell readers to type it last).
generate({ cols: 2, rows: 1, colGap: '0', rowGap: '0', tmplCols: '240px 1fr' });
el('cgg-cols').value = '4'; el('cgg-cols').fire('input');
check('changing Columns rewrites a typed template', el('cgg-tmpl-cols').value === 'repeat(4, 1fr)', el('cgg-tmpl-cols').value);
check('preview cell count follows the counts, not the template', (generate({ cols: 3, rows: 1, colGap: '0', rowGap: '0', tmplCols: 'repeat(auto-fill, minmax(180px, 1fr))' }), el('cgg-preview').children.length === 3));

const TEMPLATE_H2 = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m];
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/css-grid-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = TEMPLATE_H2.filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  const marks = [...guide.matchAll(/\{\/\* cgg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check(lang + ' guide has cgg-check annotations', marks.length >= 2, marks.length);
  for (const m of marks) {
    const c = JSON.parse(m[1]);
    const out = generate(c);
    check(`${lang} generator output ${m[1]}`, out === m[2].trimEnd(), JSON.stringify(out) + ' vs ' + JSON.stringify(m[2]));
  }
  check(lang + ' every cgg-check is followed by a css block', marks.length === (guide.match(/cgg-check:/g) || []).length);
}

// auto-fill arithmetic quoted in the guides (§7.2.3.2): repetitions = floor((W + gap) / (min + gap))
{
  const W = 1000, gap = 16, min = 180;
  const n = Math.floor((W + gap) / (min + gap));
  check('auto-fill repetitions in 1000px', n === 5, n);
  check('auto-fill column width', ((W - (n - 1) * gap) / n).toFixed(1) === '187.2');
  check('auto-fill second item x', (187.2 + gap).toFixed(1) === '203.2');
  check('auto-fit with two items', (W - gap) / 2 === 492);
  check('auto-fit second item x', 492 + gap === 508);
  check('1fr share with two 16px gaps', ((W - 2 * gap) / 3).toFixed(2) === '322.67');
  for (const lang of ['en', 'ja']) {
    const g = readFileSync(join(root, `src/content/blog/css-grid-generator-guide/${lang}.mdx`), 'utf8');
    for (const s of ['187.2', '492', '322.67', '203.2']) check(`${lang} guide quotes ${s}`, g.includes(s));
  }
}

// Actual complete script and ToolLayout shortcuts; only browser boundaries are controlled.
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcuts=layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'),layout.indexOf('      // ── Copy button visual feedback'));
const spec={"slug": "css-grid-generator", "name": "CssGridGeneratorTool", "root": ".cgg-wrap", "copy": "cgg-copy", "input": "cgg-col-gap", "output": "cgg-code", "preview": "cgg-preview", "status": "cgg-status"};
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

  assertEq(name+'actual default preview cells',h.el('cgg-preview').children.length,6);
  h.input('cgg-tmpl-cols','200px 1fr');h.input('cgg-row-gap','8px');assertEq(name+'manual columns survive gap edit',h.el('cgg-preview').style.gridTemplateColumns,'200px 1fr');
  h.input('cgg-tmpl-rows','auto 1fr');h.input('cgg-col-gap','0');assertEq(name+'manual rows survive gap edit',h.el('cgg-preview').style.gridTemplateRows,'auto 1fr');
  h.input('cgg-cols',4);assertEq(name+'Columns deliberately replace manual column template',h.el('cgg-tmpl-cols').value,'repeat(4, 1fr)');assertEq(name+'Columns keep manual row template',h.el('cgg-tmpl-rows').value,'auto 1fr');
  h.input('cgg-rows',3);assertEq(name+'Rows deliberately replace manual row template',h.el('cgg-tmpl-rows').value,'repeat(3, 1fr)');
  h.input('cgg-cols',99);h.input('cgg-rows',99);assertEq(name+'counts clamp to12x8',h.el('cgg-preview').children.length,96);h.input('cgg-cols',1);h.input('cgg-rows',1);assertEq(name+'counts can reduce to1x1',h.el('cgg-preview').children.length,1);

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
  const P='cgg';
  check('v2 root takes available height',css.includes('.'+P+'-wrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; }'));
  check('270–320px shared rail and remaining result',markup.includes('class="'+P+'-rail zt-rail"')&&css.includes('grid-template-columns: clamp(270px, 24vw, 320px) minmax(0, 1fr)'));
  check('860px stack and 640px phone rules',css.includes('@media (max-width: 860px)')&&css.includes('@media (max-width: 640px)'));
  check('native details preserve all secondary controls',markup.includes('<details')&&!/<details[^>]*\sopen/.test(markup));
  check('Copy keeps a stable 44px target',new RegExp('#'+P+'-copy \\{[^}]*height: 44px').test(css));
  check('phone main inputs keep 44px targets',css.includes('.cgg-num-input, .cgg-text-input { min-height: 44px; }'));
  check('runtime-created rows and syntax have global styles',css.includes(':global(.cgg-cell)')&&css.includes(':global(.cgg-hl-val)'));
  check('status space stays reserved',css.includes('#'+P+'-status { height: 2.8em; flex: none; margin: 0; overflow: auto; }'));
  check('result can scroll inside a bounded region',css.includes('overflow: auto;')&&(css.includes('height: 15rem;')||css.includes('max-height: 3.8rem;')));
  check('code accepts keyboard focus',/tabindex="0" role="region" aria-label=\{L.outputLabel\}/.test(markup));
  check('empty results hide on stacked screens',css.includes('[data-empty="true"] { display: none; }'));
  check('localized SSR prose stays out of client data',source.includes('// strings:start')&&source.includes('// strings:end')&&!source.includes('define:vars')&&!source.includes('data-strings')&&!source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1].includes('.tips'));
  assertEq('each actual control has its SSR tip', [...markup.matchAll(/<Toggletip id=/g)].length,7);
  const hashes={"en": "db3a72f37e0fcefbbf3de32bd9105bb06e6090a98e59f9e3f42efa81acf2a128", "zh": "cf11ec23e811c505f491f70a5ef8321dc5638b5220b4d665af3f68f78e16a765", "ja": "5193fca37fecb3abb25e87d7e51d11397ac9debf59f091cd4bed5ab48b19da2c", "ko": "111dac126e9c7490d84e66cf78894c42e85ad135d325176b6c22acf5bd47c9d8"},reference={"en": {"frontmatterWithoutSteps": "99926b40ebd04e75eaa69bb56d27b833c1bc0b7d451834e3ea59abeef032f75e", "nonUsageBody": "9130310b7030b91c65837119ae4ba6507d4c894349ca32e346aa35e54bcf9742", "steps": 5, "maxStepChars": 245, "totalStepChars": 619, "mdxSHA": "3eddd81bad609149eefa59f2de5d854a76eb8dd3f17215623ac04c5adc4b5ce0"}, "zh": {"frontmatterWithoutSteps": "2c57657fb705d1a6190c475199475ff8311c947c89a2e511bfe08e6c02470dcc", "nonUsageBody": "bc7fa1964117fb6474c577ec2c9376c0176dfcbc0febf4b74f230a4e04a15674", "steps": 5, "maxStepChars": 95, "totalStepChars": 211, "mdxSHA": "1dbe27908e6651cf5ff39481a8406b38278afc54673c9ca432064b6fbc7361c4"}, "ja": {"frontmatterWithoutSteps": "0126ac53a47b4b5e9fa69f90aa751f0a80c8bd140da82b2373d6b4c312813979", "nonUsageBody": "2d8b9ba98802eb958b9cd3b6a58749b953f58a3194c72905ec78239b9344c393", "steps": 5, "maxStepChars": 125, "totalStepChars": 296, "mdxSHA": "963aec1f5ba05a1bae580e33df1ca990d63b520f491320ad7bbadf1ef56eb201"}, "ko": {"frontmatterWithoutSteps": "5dbef7227248052fa77cc5c02f8db94ae05fd607b042051bc0a8086cfab40ceb", "nonUsageBody": "cacd2ad65c2839d7e60800e0e3bbc23f9577ffb9be44ffd48502b821ed05b99e", "steps": 5, "maxStepChars": 133, "totalStepChars": 317, "mdxSHA": "0c46f5b2d4f81d7f0a2ec0535512d62686838bcf5d598d8238965f9dc505cb0b"}};
  const digest=text=>createHash('sha256').update(text).digest('hex');
  for(const lang of ['en','zh','ja','ko']){
    const h=open(spec,lang);const old=Object.fromEntries(Object.entries(h.L).filter(([key])=>!['editor','removeLabel','options','empty','tips'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    assertEq(lang+' old localized values stay exact',digest(JSON.stringify(old)),hashes[lang]);
    const mdx=readFileSync(join(root,'src/content/tools/css-grid-generator/'+lang+'.mdx'),'utf8'),fm=mdx.match(/^---\n([\s\S]*?)\n---/),front=fm[1],body=mdx.slice(fm[0].length);
    const section=front.slice(front.indexOf('\nsteps:\n'),front.indexOf('\nfaqItems:'));
    const steps=[...section.matchAll(/^  - (".*")$/gm)].map(m=>JSON.parse(m[1]));
    assertEq(lang+' Usage moved into plain steps',steps.length,reference[lang].steps);
    check(lang+' step limits',steps.every(step=>[...step].length<=280)&&steps.reduce((n,step)=>n+[...step].length,0)<=1200);
    check(lang+' Copy and clear instructions are concrete',steps.at(-1).includes(h.L.copy)&&steps.at(-1).includes('Ctrl/⌘+L'));
    assertEq(lang+' all nonUsage body including Limits stays exact',digest(body),reference[lang].nonUsageBody);
    assertEq(lang+' FAQ and SEO stay exact',digest(front.replace(/\nsteps:\n(?:  - .*\n)*/,'\n')),reference[lang].frontmatterWithoutSteps);
    check(lang+' tips are factual plain localized prose',Object.keys(h.L.tips).length===7&&Object.values(h.L.tips).every(text=>typeof text==='string'&&text.length>0&&!/[<>]|https?:/.test(text)));
    assertEq(lang+' initial rendering does not scroll',h.scrolls,0);
    h.key('l');assertEq(lang+' clear hides real result and shows empty hint',[h.el(P+'-result').dataset.empty,h.el(P+'-empty').hidden],['true',false]);
    h.page.ctx.matchMedia=()=>({matches:true});changePage(h);assertEq(lang+' real phone input restores result',[h.el(P+'-result').dataset.empty,h.el(P+'-empty').hidden],['false',true]);
    assertEq(lang+' phone real input scrolls result into view',h.scrolls,1);
    const c=open(spec,lang);c.click();c.requests[0].reject(new Error('current clipboard denial'));await settle();assertEq(lang+' current failure also appears in reserved status',c.el(P+'-status').textContent,c.L.copyFailed);
    c.click();assertEq(lang+' retry clears only current copy status',c.el(P+'-status').textContent,'');c.requests[1].resolve();await settle();
  }
}

check('registered generate layout',readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').includes("  'css-grid-generator': 'generate',"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
