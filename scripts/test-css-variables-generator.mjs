// CSS Variables Generator — declarations and escaped highlight markup
//
// Read:  src/components/tools/CssVariablesGeneratorTool.astro (runs the real tokenDecls(),
//        plainCss() and highlightCss() between the `engine:start` / `engine:end` markers),
//        src/content/tools/css-variables-generator/en.mdx,
//        src/content/blog/css-variables-generator-guide/en.mdx (the default output, `cvg-check`
//        prefix/rows → css block, and the `cvg-sass` example compiled with the installed Dart Sass)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix generate() built the CSS string and put it into innerHTML without escaping, so a
// token value such as `<img src=x onerror=…>` became an element. The highlight output is parsed with
// parse5: only span elements, and its text equals the plain CSS that Copy uses. The default output is
// the example quoted on the English tool page. A prefix without -- gets it and spaces inside a name
// become hyphens (both used to produce declarations the browser drops).
//
// Run: node scripts/test-css-variables-generator.mjs

import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssVariablesGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { tokenDecls, plainCss, highlightCss } = new Function(source.slice(s, e) + '\nreturn { tokenDecls, plainCss, highlightCss };')();

let failures = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + detail); } }
function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function inspect(html) {
  const tags = []; let text = '';
  walk(parseFragment(html), (n) => { if (n.tagName) tags.push(n.tagName); if (n.nodeName === '#text') text += n.value; });
  return { tags, text };
}

const colors = [{ name: 'primary', value: '#3b82f6' }, { name: 'secondary', value: '#6366f1' }, { name: 'bg', value: '#ffffff' }, { name: 'text', value: '#111827' }];
check('default prefix', plainCss(tokenDecls('--', colors)) === ':root {\n  --primary: #3b82f6;\n  --secondary: #6366f1;\n  --bg: #ffffff;\n  --text: #111827;\n}', plainCss(tokenDecls('--', colors)));
check('prefix without trailing hyphen gets one', tokenDecls('--brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('prefix with trailing hyphen', tokenDecls('--brand-', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('empty prefix falls back to --', tokenDecls('', [{ name: 'x', value: '1' }])[0][0] === '--x');
// A custom property name must start with -- (CSS Custom Properties Level 1 §2); a prefix typed
// without it used to produce declarations the browser drops
check('prefix without -- gets it', tokenDecls('brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary', tokenDecls('brand', [{ name: 'primary', value: 'red' }])[0][0]);
check('prefix with one hyphen', tokenDecls('-brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('prefix with spaces around', tokenDecls('  --ds ', [{ name: 'gap', value: '4px' }])[0][0] === '--ds-gap');
check('spaces inside a name become hyphens', tokenDecls('--', [{ name: 'primary  color', value: 'red' }])[0][0] === '--primary-color');
check('page no longer says a prefix without -- is dropped', !/a prefix without <code>--<\/code> produces/.test(readFileSync(join(root, 'src/content/tools/css-variables-generator/en.mdx'), 'utf8')));
check('rows without a name are skipped', tokenDecls('--', [{ name: '  ', value: '1' }, { name: 'a', value: '' }]).length === 1);
check('empty root block', plainCss([]) === ':root {\n}');

const attack = [{ name: 'x', value: '</span><img src=x onerror=alert(1)>' }, { name: 'font-mono', value: '"Fira Code", monospace' }, { name: 'q<b>', value: 'a & b; c' }];
const decls = tokenDecls('--', attack);
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
check('highlight text equals the plain CSS', r.text === plainCss(decls), JSON.stringify(r.text));
const d = inspect(highlightCss(tokenDecls('--', colors)));
check('default highlight text', d.text === plainCss(tokenDecls('--', colors)), JSON.stringify(d.text));
check('empty highlight text', inspect(highlightCss([])).text === ':root {\n}');

// ---------- the css variables guide (en) ----------
// `cvg-default`: the next css block equals the output for the component's pre-filled rows (read from
// the GROUPS defaults in the source). `cvg-check`: prefix and rows → the next css block.
// `cvg-sass`: the next scss block compiled with the installed Dart Sass equals the css block after it.
{
  const guide = readFileSync(join(root, 'src/content/blog/css-variables-generator-guide/en.mdx'), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check('en guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('en guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));

  const defaults = [...source.matchAll(/\{ name: '([^']+)', value: '([^']*)' \}/g)].map((m) => ({ name: m[1], value: m[2] }));
  check('component has 16 pre-filled rows', defaults.length === 16, defaults.length);
  const def = guide.match(/\{\/\* cvg-default \*\/\}\s*```css\n([\s\S]*?)```/);
  check('en guide has cvg-default', !!def);
  if (def) check('default output in the guide', def[1].trimEnd() === plainCss(tokenDecls('--', defaults)), def[1]);

  const marks = [...guide.matchAll(/\{\/\* cvg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check('en guide has cvg-check annotations', marks.length >= 1 && marks.length === (guide.match(/cvg-check:/g) || []).length, marks.length);
  for (const m of marks) {
    const c = JSON.parse(m[1]);
    const out = plainCss(tokenDecls(c.prefix, c.tokens.map(([name, value]) => ({ name, value }))));
    check('guide output ' + m[1], out === m[2].trimEnd(), JSON.stringify(out));
  }

  const sassBlock = guide.match(/\{\/\* cvg-sass \*\/\}\s*```scss\n([\s\S]*?)```\s*```css\n([\s\S]*?)```/);
  check('en guide has cvg-sass', !!sassBlock);
  if (sassBlock) {
    const sass = await import('sass');
    const version = JSON.parse(readFileSync(join(root, 'node_modules/sass/package.json'), 'utf8')).version;
    check('guide names the installed Dart Sass version', guide.includes('Dart Sass ' + version), version);
    const css = sass.compileString(sassBlock[1]).css;
    check('Sass output in the guide', css.trim() === sassBlock[2].trim(), css);
  }
}

// Actual complete script and ToolLayout shortcuts; only browser boundaries are controlled.
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcuts=layout.slice(layout.indexOf('      // ── Keyboard shortcuts:'),layout.indexOf('      // ── Copy button visual feedback'));
const spec={"slug": "css-variables-generator", "name": "CssVariablesGeneratorTool", "root": ".cvg-wrap", "copy": "cvg-copy", "input": "cvg-prefix", "output": "cvg-code", "preview": null, "status": "cvg-status"};
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

  assertEq(name+'actual default sixteen dynamic rows',h.all('.cvg-token-row').length,16);
  const defaultBlock=readFileSync(join(root,'src/content/blog/css-variables-generator-guide/en.mdx'),'utf8').match(/\{\/\* cvg-default \*\/\}\s*```css\n([\s\S]*?)```/)[1].trimEnd();
  assertEq(name+'actual page default matches guide golden',h.el(spec.output).textContent,defaultBlock);
  const value=h.query('.cvg-token-value'),swatch=h.query('.cvg-swatch');value.value='#abc';value.dispatch('input');assertEq(name+'three digit HEX synchronizes native swatch',swatch.value,'#aabbcc');
  swatch.value='#123456';swatch.dispatch('input');assertEq(name+'native swatch synchronizes value',value.value,'#123456');
  h.query('.cvg-add-btn').click();assertEq(name+'Add preserves independent row creation',h.all('.cvg-token-row').length,17);
  h.query('.cvg-remove-btn').click();assertEq(name+'Remove preserves independent row deletion',h.all('.cvg-token-row').length,16);

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
  const P='cvg';
  check('v2 root takes available height',css.includes('.'+P+'-wrap { display: flex; flex-direction: column; min-width: 0; min-height: 0; }'));
  check('270–320px shared rail and remaining result',markup.includes('class="'+P+'-rail zt-rail"')&&css.includes('grid-template-columns: clamp(270px, 24vw, 320px) minmax(0, 1fr)'));
  check('860px stack and 640px phone rules',css.includes('@media (max-width: 860px)')&&css.includes('@media (max-width: 640px)'));
  check('native details preserve all secondary controls',markup.includes('<details')&&!/<details[^>]*\sopen/.test(markup));
  check('Copy keeps a stable 44px target',new RegExp('#'+P+'-copy \\{[^}]*height: 44px').test(css));
  check('phone main inputs keep 44px targets',css.includes('.cvg-prefix-input { min-height: 44px; }'));
  check('runtime-created rows and syntax have global styles',source.includes('<style is:global>'));
  check('status space stays reserved',css.includes('#'+P+'-status { height: 2.8em; flex: none; margin: 0; overflow: auto; }'));
  check('result can scroll inside a bounded region',css.includes('overflow: auto;')&&(css.includes('height: 15rem;')||css.includes('max-height: 3.8rem;')));
  check('code accepts keyboard focus',/tabindex="0" role="region" aria-label=\{L.outputLabel\}/.test(markup));
  check('empty results hide on stacked screens',css.includes('[data-empty="true"] { display: none; }'));
  check('localized SSR prose stays out of client data',source.includes('// strings:start')&&source.includes('// strings:end')&&!source.includes('define:vars')&&!source.includes('data-strings')&&!source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1].includes('.tips'));
  assertEq('each actual control has its SSR tip', [...markup.matchAll(/<Toggletip id=/g)].length,7);
  const hashes={"en":"5b8e0d090358a6136085a9d9341e1bfed3c5d8b347da2c8e10c6ea351514e65a","zh":"93e00cd53127df3a41538c00ccff0a0698dda362a13adf19fc7d76007281b8bc","ja":"c44a38c74eff8bde1febb7d312e4c2e1ef82f76d46e04906625a2b5b6060e2f7","ko":"0841eab1748e5795b25f74d073e127a8cbe67425f9a6445657bf10942e5be073"},reference={"en": {"frontmatterWithoutSteps": "469d1fc7075a6529471d4192f88161116bcb9bd7c58b24dadbb4c8dc97865bd0", "nonUsageBody": "971b77cfca8c9cfd35842031ed161e64442b4238a3162b1e92c54f88d5b235f2", "steps": 5, "maxStepChars": 108, "totalStepChars": 388, "mdxSHA": "88c561f97fd2913e210f2f64927e735eb559498f0004da9a515d4b02f82c0d4d"}, "zh": {"frontmatterWithoutSteps": "4770cc9fe08b164c3c234aa4386ca2820afedf4a5f79767577d5a2ec6b43af8e", "nonUsageBody": "4fdaecd2b92eafb8b70c703d83aee51693205d59ad20a8bdbd9d0c925522f9f3", "steps": 5, "maxStepChars": 132, "totalStepChars": 273, "mdxSHA": "d586a67967fea20520404eece5d4140fc99c62edcaee0303b396b33e7cb922ef"}, "ja": {"frontmatterWithoutSteps": "9fb47fd75b27a014291a3ec32c7d3bd74854821250368c0fa222d6791ebefe34", "nonUsageBody": "7f9c1772e25bef1b9fead1a5495066cddac438348ea087d1749c48cb23f2a062", "steps": 5, "maxStepChars": 169, "totalStepChars": 355, "mdxSHA": "2d9c547d7a5977e568526f8d9d65b6cb9ef31d6817ab0e43b77fbc23b0f52a14"}, "ko": {"frontmatterWithoutSteps": "10d150e8aa43a332fce1fee55019e3200b2846c07f6f28c541000278b85d211d", "nonUsageBody": "8d4c3c28cc232e2714d0bb73e07e61100050660c129df4bf0cde68a7c9488d99", "steps": 5, "maxStepChars": 180, "totalStepChars": 365, "mdxSHA": "849febcfb7cd201bc499e4be626c8006a76f73a1f053a22363d8b198b2b3a11d"}};
  const digest=text=>createHash('sha256').update(text).digest('hex');
  for(const lang of ['en','zh','ja','ko']){
    const h=open(spec,lang);const old=Object.fromEntries(Object.entries(h.L).filter(([key])=>!['editor','removeLabel','options','empty','tips'].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    assertEq(lang+' old localized values stay exact',digest(JSON.stringify(old)),hashes[lang]);
    const mdx=readFileSync(join(root,'src/content/tools/css-variables-generator/'+lang+'.mdx'),'utf8'),fm=mdx.match(/^---\n([\s\S]*?)\n---/),front=fm[1],body=mdx.slice(fm[0].length);
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

check('registered generate layout',readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').includes("  'css-variables-generator': 'generate',"));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
