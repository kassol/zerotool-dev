// Read: actual component, ToolLayout shortcuts and local templates (gitignore only).
// Write: stdout only. Clipboard, timers and persistence use controlled boundaries.
// Exit: 0 if all PASS; 1 on any FAIL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/GitignoreGeneratorTool.astro'), 'utf8');
let passes=0,failures=0;

// Lifecycle regression: runs the complete actual page scripts and shared shortcuts.
// DOM, timers, clipboard promises and persistence are controlled; no native clipboard or network.
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { loadPage } from './astro-page-harness.mjs';
const requireFromRoot = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = requireFromRoot('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const must=(ok,message)=>{if(!ok)throw Error(message);};
const assert=(name,actual,expected)=>{if(same(actual,expected)){passes++;return;}failures++;console.log('FAIL: '+name+' expected '+JSON.stringify(expected)+' actual '+JSON.stringify(actual));};
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
let activePage;const onUnhandled=e=>activePage?.errors.push(String(e));process.on('unhandledRejection',onUnhandled);
const SLUG='gitignore-generator',component='src/components/tools/GitignoreGeneratorTool.astro';
const ts=requireFromRoot('typescript'), templateModule={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(join(root,'src/data/gitignore-templates.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:templateModule.exports,module:templateModule});const templates=templateModule.exports;
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function lifecyclePage(lang='en',order='shared-after',noClipboard=false,saved={}){
  const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],downloads=[],urls=new Map();let stored=structuredClone(saved);
  let timerId=0,clock=0,doc;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const matchOne = (el, selector) => {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchOne(parent, parts.join(' '))) return true;
      return false;
    }
    const not=selector.match(/:not\(([^)]+)\)/);if(not){if(matchOne(el,not[1]))return false;selector=selector.replace(not[0],'');}
    if(selector.endsWith(':checked')){if(!el.checked)return false;selector=selector.slice(0,-8);}
    const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    const plain=selector.replace(/\[[^\]]+\]/g,'');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  };
  const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
  class EventStub {
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return (this.querySelector('option[selected]') || this.querySelector('option'))?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true; }
    get firstChild() { return this.children[0]??null; }
    get firstElementChild() { return this.children.find(c=>!c.tagName.startsWith('#'))??null; }
    get previousElementSibling() { const a=this.parentNode?.children.filter(c=>!c.tagName.startsWith('#'))||[];return a[a.indexOf(this)-1]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { if(child.tagName==='#DOCUMENT-FRAGMENT'){for(const c of [...child.children])this.appendChild(c);child.children=[];return child;}this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child; }
    matches(selector) { return matches(this,selector); }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (matches(el, selector)) return el; return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentNode) {
        event.currentTarget = el;
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(this.disabled)return;if(this.tagName==='A'){must(urls.has(this.href),'download Blob exists');downloads.push({name:this.download,url:this.href,blob:urls.get(this.href)});return;}this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { doc.activeElement = this; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }

  doc=new Element('#document');doc.documentElement=new Element('html');doc.documentElement.lang=lang;doc.appendChild(doc.documentElement);
  doc.body=new Element('body');doc.documentElement.appendChild(doc.body);
  const widget=new Element('section');widget.className='tool-widget';doc.body.appendChild(widget);
  const fm=/^---\n([\s\S]*?)\n---/.exec(source)?.[1]||'';
  const labels=fm.includes('const labels =')?vm.runInNewContext(fm.slice(fm.indexOf('const labels ='),fm.indexOf('const L ='))+';labels'):null;
  const escaped=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  widget.innerHTML=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(labels?.[lang]?.[k]??''));
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('#document-fragment');doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);throw Error('Native clipboard prohibited');};
  const persist={clear(slug){if(slug!=='cron-job-generator')stored={};persistCalls.push(['clear',slug]);},save(slug,data){stored=JSON.parse(JSON.stringify(data));persistCalls.push(['save',slug,stored]);},load(){return structuredClone(stored);}};
  const globals={document:doc,Date:class extends Date{constructor(...a){super(...(a.length?a:['2026-10-05T08:00:00Z']));}static now(){return Date.parse('2026-10-05T08:00:00Z');}},Blob,crypto:webcrypto,URL:{createObjectURL(blob){const url='blob:probe-'+urls.size;urls.set(url,blob);return url;},revokeObjectURL(url){urls.delete(url);}},require(name){if(name==='../../data/gitignore-templates')return templates;throw Error('Unreviewed import '+name);},fetch(){throw Error('Network prohibited');},
    _slug:SLUG,ztPersist:persist,trackTool(){},
    navigator:noClipboard?{}:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:SLUG},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(component,{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,SLUG+' ID '+id);return el;};
  const errors=[];activePage={errors};
  return{errors,doc,get,widget,clipboard,timers,persistCalls,execCalls,downloads,stored:()=>structuredClone(stored),actual,
    input(id,value,event='input'){get(id).value=value;get(id).dispatch(event);},
    ctrlL(id,key='l',mod='ctrlKey'){const el=get(id);el.focus();el.dispatch('keydown',{key,[mod]:true});},
    choose(id,checked){get(id).checked=checked;get(id).dispatch('change');},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}

const LABELS={en:{copy:'Copy',copied:'Copied!',failed:'Copy failed',download:'Download'},zh:{copy:'复制',copied:'已复制！',failed:'复制失败',download:'下载'},ja:{copy:'コピー',copied:'コピー済み！',failed:'コピーに失敗しました',download:'ダウンロード'},ko:{copy:'복사',copied:'복사됨!',failed:'복사 실패',download:'다운로드'}};
const COPY='gig-copy',INPUT='gig-custom',DELAY=1500,CLEAR_STORE={},ACTIONS=['CtrlL','new result','Clear all'];
const output=p=>p.get('gig-output').textContent;
const settings=p=>[];
function ready(lang='en',order='shared-after',noClipboard=false){const p=lifecyclePage(lang,order,noClipboard);p.choose('gig-cb-l-ada',true);return p;}
function act(p,action){if(action==='CtrlL')p.ctrlL(INPUT);else if(action==='Clear all')p.get('gig-clear-all').click();else p.input(INPUT,'new-result/');}
const feedbackState=p=>[output(p),p.get(COPY).textContent,p.get(COPY).disabled,p.get('gig-custom').value,p.get('gig-chips').textContent];
const empty=p=>p.get(INPUT).value===''&&p.get('gig-search').value===''&&p.doc.querySelectorAll('.gig-item-cb:checked').length===0&&p.get('gig-chips').textContent===''&&p.get(COPY).disabled&&p.get('gig-download').disabled;
function restoreResult(p){p.input(INPUT,'restored/');}
const recover=p=>output(p).includes('### Custom additions\nrestored/');
const ADA='# .gitignore generated at https://zerotool.dev/tools/gitignore-generator/\n# Source templates: github/gitignore (CC0-1.0)\n\n### Ada.gitignore\n# Object file\n*.o\n\n# Ada Library Information\n*.ali\n';
let p=ready();assert('real imported template count',p.doc.querySelectorAll('.gig-item-cb').length,templates.gitignoreTemplates.length);assert('Ada exact template',output(p),ADA);p.input(INPUT,'*.o\nlocal-cache/\n# keep');assert('real dedupe and comments',output(p),ADA.trimEnd()+'\n\n### Custom additions\nlocal-cache/\n# keep\n');p.tick(400);assert('real persistence snapshot',p.stored(),{selected:['l-ada'],custom:'*.o\nlocal-cache/\n# keep'});const restored=lifecyclePage('en','shared-after',false,p.stored());assert('restore selected/custom',output(restored),output(p));p.doc.querySelector('.gig-chip[data-id="l-ada"]').click();assert('real chip removal',p.get('gig-cb-l-ada').checked,false);assert('chip removal keeps custom rule',output(p).includes('*.o\nlocal-cache/'),true);
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 p=ready(lang,order);p.input('gig-search','not-found');p.input(INPUT,'pending/');const oldSave=[...p.timers.values()].find(t=>t.ms===400)?.fn;p.ctrlL(INPUT);oldSave?.();p.tick(1000);assert(lang+'/'+order+' forced stale save inert',p.stored(),{});assert(lang+'/'+order+' search and filter reset',[p.get('gig-search').value,p.get('gig-no-results').hidden],['',true]);p=ready(lang,order);p.input(INPUT,'pending/');p.get('gig-clear-all').click();p.tick(1000);assert(lang+'/'+order+' explicit Clear all',empty(p)&&Object.keys(p.stored()).length===0,true);
 p=ready(lang,order);const first=output(p);p.get('gig-download').click();const d=p.downloads.at(-1);assert(lang+'/'+order+' exact download',[d.name,d.blob.type,await d.blob.text()],['.gitignore','text/plain;charset=utf-8',first]);p.input(INPUT,'new/');assert(lang+'/'+order+' issued Blob immutable',await d.blob.text(),first);
}

for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const id=SLUG+'/'+lang+'/'+order;
 let primary=ready(lang,order);const beforeEnter=output(primary);primary.ctrlL(INPUT,'Enter');assert(id+' shared primary behavior',output(primary),beforeEnter);
 let p=ready(lang,order);const copy=p.get(COPY),first=output(p);copy.click();assert(id+' exact copy snapshot',p.clipboard.at(-1)?.value,first);p.clipboard.at(-1)?.resolve();await settle();assert(id+' normal success',copy.textContent,LABELS[lang].copied);p.tick(DELAY);assert(id+' restore label',copy.textContent,LABELS[lang].copy);
 p=ready(lang,order);const opts=settings(p);p.ctrlL(INPUT,'L','metaKey');assert(id+' text and results cleared',empty(p),true);assert(id+' options retained',settings(p),opts);assert(id+' shared persistence clear once',p.persistCalls.filter(c=>c[0]==='clear').length,1);const n=p.clipboard.length;p.get(COPY).click();assert(id+' empty result cannot copy',p.clipboard.length,n);p.tick(1000);assert(id+' late save stays clear',p.stored(),CLEAR_STORE);
 p=ready(lang,order);const old=output(p);p.doc.body.focus();p.doc.body.dispatch('keydown',{key:'l',ctrlKey:true});assert(id+' outside tool unchanged',output(p),old);assert(id+' outside tool no persistence clear',p.persistCalls.filter(c=>c[0]==='clear').length,0);p.get(INPUT).dispatch('keydown',{key:'l'});assert(id+' unmodified L unchanged',output(p),old);
 p=ready(lang,order);const beforeReject=output(p);p.get(COPY).click();p.clipboard.at(-1)?.reject(Error('controlled rejection'));await settle();assert(id+' reject handled',p.errors,[]);assert(id+' localized failure',p.get(COPY).textContent,LABELS[lang].failed);assert(id+' rejected result intact',output(p),beforeReject);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();assert(id+' retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
 for(const mode of ['absent','own undefined','sync throw']){
  p=ready(lang,order,mode==='absent');if(mode==='own undefined'){Object.defineProperty(p.actual.ctx.navigator,'clipboard',{value:undefined,writable:true,configurable:true});}if(mode==='sync throw')p.actual.ctx.navigator.clipboard.writeText=()=>{throw Error('controlled synchronous throw');};let thrown='';try{p.get(COPY).click();}catch(e){thrown=e.name;}await settle();assert(id+'/'+mode+' handled',thrown,'');assert(id+'/'+mode+' visible',p.get(COPY).textContent,LABELS[lang].failed);assert(id+'/'+mode+' no native clipboard',p.execCalls,[]);assert(id+'/'+mode+' no unhandled',p.errors,[]);p.actual.ctx.navigator.clipboard={writeText(value){const d=deferred();p.clipboard.push({...d,value:String(value)});return d.promise;}};p.get(COPY).click();assert(id+'/'+mode+' retry copies intact output',p.clipboard.at(-1)?.value,output(p));p.clipboard.at(-1)?.resolve();await settle();assert(id+'/'+mode+' same-result retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
 }
 for(const action of ACTIONS)for(const outcome of ['resolve','reject']){
  p=ready(lang,order);p.get(COPY).click();const job=p.clipboard.at(-1);act(p,action);const state=feedbackState(p);job?.[outcome](outcome==='reject'?Error('controlled late rejection'):undefined);await settle();assert(id+'/'+action+'/'+outcome+' old callback inert',feedbackState(p),state);assert(id+'/'+action+'/'+outcome+' handled',p.errors,[]);
 }
 for(const outcome of ['resolve','reject']){
  p=ready(lang,order);p.get(COPY).click();const oldJob=p.clipboard.at(-1);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();oldJob?.[outcome](outcome==='reject'?Error('old concurrent reject'):undefined);await settle();assert(id+'/'+outcome+' old request inert',p.get(COPY).textContent,LABELS[lang].copied);assert(id+'/'+outcome+' no unhandled',p.errors,[]);
 }
 p=ready(lang,order);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();const stale=[...p.timers.values()].find(t=>t.ms===DELAY)?.fn;p.tick(100);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();stale?.();assert(id+' forced old timer inert',p.get(COPY).textContent,LABELS[lang].copied);p.tick(DELAY-100);assert(id+' old deadline inert',p.get(COPY).textContent,LABELS[lang].copied);p.tick(100);assert(id+' newest timer restores',p.get(COPY).textContent,LABELS[lang].copy);
 p=ready(lang,order);p.ctrlL(INPUT);restoreResult(p);assert(id+' real input recovers result',recover(p),true);assert(id+' recovery copy enabled',p.get(COPY).disabled,false);
}
process.removeListener('unhandledRejection',onUnhandled);
console.log(passes+' passed, '+failures+' failed');process.exitCode=failures?1:0;
