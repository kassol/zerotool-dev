// Read: actual component, ToolLayout shortcuts and local templates (gitignore only).
// Write: stdout only. Clipboard, timers and persistence use controlled boundaries.
// Exit: 0 if all PASS; 1 on any FAIL.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
const root = process.env.ZT_B13_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B13_SOURCE || join(root, 'src/components/tools/FakeDataGeneratorTool.astro'), 'utf8');
let passes=0,failures=0;

// Lifecycle regression: runs the complete actual page scripts and shared shortcuts.
// DOM, timers, clipboard promises and persistence are controlled; no native clipboard or network.
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const {loadPage}=await import(pathToFileURL(join(root,'scripts/astro-page-harness.mjs')));
const requireFromRoot = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = requireFromRoot('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const must=(ok,message)=>{if(!ok)throw Error(message);};
const assert=(name,actual,expected)=>{if(same(actual,expected)){passes++;return;}failures++;console.log('FAIL: '+name+' expected '+JSON.stringify(expected)+' actual '+JSON.stringify(actual));};
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
let activePage;const onUnhandled=e=>activePage?.errors.push(String(e));process.on('unhandledRejection',onUnhandled);
const SLUG='fake-data-generator',component=process.env.ZT_B13_SOURCE?relative(root,process.env.ZT_B13_SOURCE):'src/components/tools/FakeDataGeneratorTool.astro';
const templates={};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function lifecyclePage(lang='en',order='shared-after',noClipboard=false,saved={},opts={}){
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
  const labels=vm.runInNewContext(fm.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
  const escaped=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  widget.innerHTML=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/data-strings=\{JSON.stringify\(CLIENT_T\)\}/g,()=> 'data-strings="'+escaped(JSON.stringify(Object.fromEntries(['copy','download','copied','downloaded','noField','copyFailed','countNote'].map(key=>[key,labels[lang][key]]))))+'"').replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(labels?.[lang]?.[k]??''));
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('#document-fragment');doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push({command,text:doc.selectedElement?.value});if(opts.exec===undefined)throw Error('Native clipboard prohibited');return opts.exec;};
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
const COPY='fdg-copy',INPUT='fdg-output',DELAY=1500,CLEAR_STORE={},ACTIONS=['CtrlL','new result','no fields'];
const output=p=>p.get('fdg-output').value;
const settings=p=>[p.get('fdg-count').value,p.doc.querySelector('.fdg-fmt.active').dataset.fmt,p.get('fdg-fields').querySelectorAll('input:checked').map(c=>c.value)];
function ready(lang='en',order='shared-after',noClipboard=false,opts={}){const p=lifecyclePage(lang,order,noClipboard,{},opts);p.get('fdg-count').value='2';p.get('fdg-generate').click();return p;}
function fields(p,names){for(const c of p.get('fdg-fields').querySelectorAll('input'))c.checked=names.includes(c.value);}
function act(p,action){if(action==='CtrlL')p.ctrlL(INPUT);else{if(action==='no fields')fields(p,[]);p.get('fdg-generate').click();}}
const feedbackState=p=>[output(p),p.get(COPY).textContent,p.get(COPY).disabled,p.get('fdg-download').textContent,p.get('fdg-download').disabled];
const empty=p=>output(p)===''&&p.get(COPY).disabled&&p.get('fdg-download').disabled;
function restoreResult(p){p.get('fdg-generate').click();}
const recover=p=>JSON.parse(output(p)).length===2;
async function download(p){const before=p.downloads.length;p.get('fdg-download').click();const d=p.downloads.length>before?p.downloads.at(-1):null;return d?{name:d.name,mime:d.blob.type,text:await d.blob.text()}:null;}
let p=ready();let rows=JSON.parse(output(p));assert('default real random rows',rows.length===2&&rows.every(r=>Object.keys(r).join(',')==='fullName,email'&&/^\S+ \S+$/.test(r.fullName)&&/^[^@]+@[^@]+$/.test(r.email)),true);assert('real Math untouched',p.actual.run('Math')===Math,true);
const all=p.get('fdg-fields').querySelectorAll('input').map(c=>c.value);fields(p,all);p.get('fdg-count').value='1';p.get('fdg-generate').click();const r=JSON.parse(output(p))[0];assert('all 17 fields',Object.keys(r),all);assert('UUID/date/color/IP structures',/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.uuid)&&/^#[0-9a-f]{6}$/.test(r.color)&&/^202[0-6]-\d{2}-\d{2}$/.test(r.date)&&r.ip.split('.').every(x=>+x>=0&&+x<=255),true);
for(const [value,count]of [['-3',1],['101',100],['',10],['0',10]]){p.get('fdg-count').value=value;p.get('fdg-generate').click();assert('count '+JSON.stringify(value),JSON.parse(output(p)).length,count);}
for(const lang of ['en','zh','ja','ko']){
 p=ready(lang);const json=output(p);p.doc.querySelector('.fdg-fmt[data-fmt="csv"]').click();assert(lang+' format remains manual',output(p),json);assert(lang+' export matches generated format',await download(p),{name:'fake-data.json',mime:'application/json',text:json});const issued=p.downloads.at(-1);fields(p,[]);p.get('fdg-generate').click();const n=p.clipboard.length;p.get(COPY).click();assert(lang+' no-field prevents stale copy',p.clipboard.length,n);assert(lang+' no-field prevents stale download',await download(p),null);assert(lang+' no-field notice retained',output(p).length>0,true);fields(p,['uuid','color']);p.get('fdg-count').value='3';p.get('fdg-generate').click();const csv=output(p);assert(lang+' CSV real structure',csv.split('\n').length===4&&csv.startsWith('uuid,color\n'),true);assert(lang+' CSV exact download',await download(p),{name:'fake-data.csv',mime:'text/csv',text:csv});assert(lang+' issued Blob immutable',await issued.blob.text(),json);
 p=ready(lang);p.get('fdg-download').click();const oldTimer=[...p.timers.values()].find(t=>t.ms===1500)?.fn;p.tick(100);p.get('fdg-download').click();oldTimer?.();assert(lang+' old download feedback timer inert',p.get('fdg-download').textContent,({en:'Downloaded!',zh:'已下载！',ja:'ダウンロード済み！',ko:'다운로드됨!'})[lang]);p.ctrlL(INPUT);const nDownloads=p.downloads.length;p.get('fdg-download').click();assert(lang+' CtrlL prevents download',p.downloads.length,nDownloads);assert(lang+' clear resets download feedback',p.get('fdg-download').textContent,LABELS[lang].download);
}

for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const id=SLUG+'/'+lang+'/'+order;
 let primary=ready(lang,order);const beforeEnter=output(primary);primary.ctrlL(INPUT,'Enter');assert(id+' shared primary behavior',JSON.parse(output(primary)).length===2,true);
 let p=ready(lang,order);const copy=p.get(COPY),first=output(p);copy.click();assert(id+' exact copy snapshot',p.clipboard.at(-1)?.value,first);p.clipboard.at(-1)?.resolve();await settle();assert(id+' normal success',copy.textContent,LABELS[lang].copied);p.tick(DELAY);assert(id+' restore label',copy.textContent,LABELS[lang].copy);
 p=ready(lang,order);const opts=settings(p);p.ctrlL(INPUT,'L','metaKey');assert(id+' text and results cleared',empty(p),true);assert(id+' options retained',settings(p),opts);assert(id+' shared persistence clear once',p.persistCalls.filter(c=>c[0]==='clear').length,1);const n=p.clipboard.length;p.get(COPY).click();assert(id+' empty result cannot copy',p.clipboard.length,n);p.tick(1000);assert(id+' late save stays clear',p.stored(),CLEAR_STORE);
 p=ready(lang,order);const old=output(p);p.doc.body.focus();p.doc.body.dispatch('keydown',{key:'l',ctrlKey:true});assert(id+' outside tool unchanged',output(p),old);assert(id+' outside tool no persistence clear',p.persistCalls.filter(c=>c[0]==='clear').length,0);p.get(INPUT).dispatch('keydown',{key:'l'});assert(id+' unmodified L unchanged',output(p),old);
 p=ready(lang,order);const beforeReject=output(p);p.get(COPY).click();p.clipboard.at(-1)?.reject(Error('controlled rejection'));await settle();assert(id+' reject handled',p.errors,[]);assert(id+' localized failure',p.get(COPY).textContent,LABELS[lang].failed);assert(id+' rejected result intact',output(p),beforeReject);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();assert(id+' retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
 for(const mode of ['absent','own undefined','sync throw']){
  p=ready(lang,order,mode==='absent');if(mode==='own undefined'){Object.defineProperty(p.actual.ctx.navigator,'clipboard',{value:undefined,writable:true,configurable:true});}if(mode==='sync throw')p.actual.ctx.navigator.clipboard.writeText=()=>{throw Error('controlled synchronous throw');};let thrown='';try{p.get(COPY).click();}catch(e){thrown=e.name;}await settle();assert(id+'/'+mode+' handled',thrown,'');assert(id+'/'+mode+' visible',p.get(COPY).textContent,LABELS[lang].failed);assert(id+'/'+mode+' fallback tried once with the output',p.execCalls.map(c=>[c.command,c.text]),[['copy',output(p)]]);assert(id+'/'+mode+' helper textarea removed',p.doc.body.children.filter(c=>c.tagName==='TEXTAREA').length,0);assert(id+'/'+mode+' focus back on Copy',p.doc.activeElement===p.get(COPY),true);assert(id+'/'+mode+' no unhandled',p.errors,[]);p.actual.ctx.navigator.clipboard={writeText(value){const d=deferred();p.clipboard.push({...d,value:String(value)});return d.promise;}};p.get(COPY).click();assert(id+'/'+mode+' retry copies intact output',p.clipboard.at(-1)?.value,output(p));p.clipboard.at(-1)?.resolve();await settle();assert(id+'/'+mode+' same-result retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
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
// ---------- S2-9c: copy fallback succeeds; Count is read as a number and shown ----------
const NOTE={en:'Enter a whole number from 1 to 100. Records generated: {n}.',zh:'数量须为 1–100 的整数，本次生成了 {n} 条。',ja:'件数は 1〜100 の整数で指定してください。今回は {n} 件を生成しました。',ko:'개수는 1~100 사이의 정수로 입력하세요. 이번에는 {n}개를 생성했습니다.'};
for(const lang of ['en','zh','ja','ko'])for(const mode of ['absent','reject','sync throw']){
 const id=SLUG+'/'+lang+'/fallback '+mode;
 const p=ready(lang,'shared-after',mode==='absent',{exec:true});if(mode==='sync throw')p.actual.ctx.navigator.clipboard.writeText=()=>{throw Error('controlled synchronous throw');};
 p.get(COPY).click();if(mode==='reject')p.clipboard.at(-1)?.reject(Error('controlled rejection'));await settle();
 assert(id+' fallback copies the output',p.execCalls.map(c=>c.text),[output(p)]);assert(id+' shows copied',p.get(COPY).textContent,LABELS[lang].copied);assert(id+' textarea removed',p.doc.body.children.filter(c=>c.tagName==='TEXTAREA').length,0);assert(id+' focus back',p.doc.activeElement===p.get(COPY),true);assert(id+' no unhandled',p.errors,[]);
}
for(const lang of ['en','zh','ja','ko']){
 for(const [value,count,note] of [['1e1',10,false],['007',7,false],['10',10,false],['2.9',2,true],['150',100,true],['-3',1,true],['',10,true],['0',10,true],['100',100,false]]){
  const p=lifecyclePage(lang);p.get('fdg-count').value=value;p.get('fdg-generate').click();
  const id=SLUG+'/'+lang+' count '+JSON.stringify(value);
  assert(id+' records',JSON.parse(output(p)).length,count);
  assert(id+' field shows the number used',p.get('fdg-count').value,String(count));
  assert(id+' note',p.get('fdg-status').textContent,note?NOTE[lang].replace('{n}',String(count)):'');
 }
 const p=lifecyclePage(lang);p.get('fdg-count').value='150';p.get('fdg-generate').click();p.get('fdg-generate').click();
 assert(SLUG+'/'+lang+' note cleared once the field holds a valid count',p.get('fdg-status').textContent,'');
}
// ---------- v2 page layout ----------
const ssr=vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
for(const lang of ['en','zh','ja','ko']){
 const q=lifecyclePage(lang),L=ssr[lang];
 assert(lang+' initial empty preview state',q.doc.querySelector('.fdg-wrap').dataset.empty,'true');
 q.get('fdg-generate').click();assert(lang+' real Generate shows result marker',q.doc.querySelector('.fdg-wrap').dataset.empty,'false');
 q.ctrlL(INPUT);assert(lang+' real CtrlL restores empty marker',q.doc.querySelector('.fdg-wrap').dataset.empty,'true');
 assert(lang+' SSR labels present before runtime replacement',q.get('fdg-generate').textContent,L.generate);
 assert(lang+' five SSR tip keys',Object.keys(L.tips).sort(),['count','export','fields','format','generate']);
 assert(lang+' client only the feedback strings',Object.keys(JSON.parse(q.doc.querySelector('.fdg-wrap').dataset.strings)).sort(),['copied','copy','copyFailed','countNote','download','downloaded','noField']);
 const prefix=process.env.ZT_B13_MDX_PREFIX,mdx=readFileSync(prefix?prefix+'-'+lang+'.mdx':join(root,'src/content/tools/fake-data-generator',lang+'.mdx'),'utf8');const y=requireFromRoot('js-yaml').load(mdx.split('---')[1]);
 assert(lang+' steps limits and position',y.steps.length<=8&&y.steps.every(x=>x.length<=280)&&y.steps.join('').length<=1200&&mdx.indexOf('steps:')<mdx.indexOf('faqItems:'),true);
 assert(lang+' Usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx),true);
}
assert('generate rail/result bounded structure',source.includes('fdg-controls zt-rail')&&source.includes('grid-template-columns: 300px minmax(0, 1fr)')&&source.includes('overflow: auto'),true);
assert('SSR replaces every runtime label/placeholder',!source.includes('data-i18n')&&!source.includes('var STRINGS'),true);
assert('five static localized tips',[...source.matchAll(/<Toggletip id="fdg-tip-/g)].length,5);
assert('all three business actions retained', ['fdg-generate','fdg-copy','fdg-download'].every(id=>source.includes('id="'+id+'"')),true);
assert('status before settings and minimum 2.8em',source.indexOf('id="fdg-status"')<source.indexOf('id="fdg-count"')&&source.includes('min-height: 2.8em'),true);
assert('stacked empty result hidden/phone targets',source.includes('@media (max-width: 860px)')&&source.includes('@media (max-width: 640px)')&&source.includes('min-height: 44px')&&source.includes('min-height: 24px')&&source.includes('.fdg-wrap[data-empty="true"] .fdg-result { display: none; }'),true);
if(!/['"]fake-data-generator['"]\s*:\s*['"]generate['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')))console.log('PENDING: root generate registration, compile and native layout acceptance');
// ---------- Worked examples on the four tool pages (S2-9c) ----------
// The output is random, so a sample is checked for what is fixed (S2-PLAN §2.3): the selected
// fields in order, the record count, the JSON / CSV shape, and that every value is one the
// generator code can produce (its word lists and number ranges). Count notes come from the real
// page; duplicate probabilities are computed from the sizes of the word lists.
// Annotations: {/* fdg-check: {"fields":[...],"count":n,"format":"json"|"csv"} */} before a code
// block; {/* fdg-count: {"count":"150"} */} before inline code holding the status note and the
// number of records; {/* fdg-dup: {"field":"fullName","n":100,"digits":1} */} before inline code
// holding the probability that n records contain a repeated value.
{
  const { reportContract, fencedBlocks } = await import(pathToFileURL(join(root, 'scripts/lib/tool-mdx-contract.mjs')));
  const code = source.slice(source.indexOf('  var FIRST'), source.indexOf('  var currentFmt'));
  const G = new Function('crypto', code + '\nreturn { FIRST, LAST, DOMAINS, COMPANIES, STREETS, CITIES, STATES, COUNTRIES, TLDS, PATHS, LOREM_WORDS, generators };')(webcrypto);
  const lower = (a) => a.map((x) => x.toLowerCase());
  const int = (s, lo, hi) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
  const VALID = {
    fullName: (v) => { const m = /^(\S+) (\S+)$/.exec(v); return !!m && G.FIRST.includes(m[1]) && G.LAST.includes(m[2]); },
    firstName: (v) => G.FIRST.includes(v), lastName: (v) => G.LAST.includes(v),
    email: (v) => { const m = /^([a-z]+)\.([a-z]+)(\d{2})@(.+)$/.exec(v); return !!m && lower(G.FIRST).includes(m[1]) && lower(G.LAST).includes(m[2]) && int(m[3], 10, 99) && G.DOMAINS.includes(m[4]); },
    phone: (v) => { const m = /^\((\d{3})\) (\d{3})-(\d{4})$/.exec(v); return !!m && int(m[1], 200, 999) && int(m[2], 200, 999); },
    company: (v) => G.COMPANIES.includes(v),
    street: (v) => { const m = /^(\d+) (.+)$/.exec(v); return !!m && int(m[1], 1, 9999) && G.STREETS.includes(m[2]); },
    city: (v) => G.CITIES.includes(v), state: (v) => G.STATES.includes(v), country: (v) => G.COUNTRIES.includes(v),
    zip: (v) => /^\d{5}$/.test(v) && int(v, 10000, 99999),
    uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v),
    date: (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v); return !!m && int(m[1], 2020, 2026) && int(m[2], 1, 12) && int(m[3], 1, 28); },
    ip: (v) => { const o = v.split('.'); return o.length === 4 && int(o[0], 1, 254) && int(o[1], 0, 255) && int(o[2], 0, 255) && int(o[3], 1, 254); },
    url: (v) => { const m = /^https:\/\/([a-z]+)\.([a-z]+)\/([a-z]+)$/.exec(v); return !!m && G.TLDS.includes(m[2]) && G.PATHS.includes(m[3]) && G.FIRST.some((f) => m[1].startsWith(f.toLowerCase()) && lower(G.LAST).includes(m[1].slice(f.length))); },
    color: (v) => /^#[0-9a-f]{6}$/.test(v),
    lorem: (v) => { const w = v.replace(/\.$/, '').split(' '); return v.endsWith('.') && w.length >= 6 && w.length <= 14 && w.every((x, i) => G.LOREM_WORDS.includes(i ? x : x.charAt(0).toLowerCase() + x.slice(1))) && /^[A-Z]/.test(v); },
  };
  assert('every field has a validator', Object.keys(G.generators).sort(), Object.keys(VALID).sort());
  for (const f of Object.keys(G.generators)) for (let i = 0; i < 300; i++) { const v = G.generators[f](); if (!VALID[f](v)) { assert('validator accepts generated ' + f, v, 'a valid value'); break; } }
  // Number of distinct values a field can take (from the word lists and ranges above)
  const SIZE = { fullName: G.FIRST.length * G.LAST.length, email: G.FIRST.length * G.LAST.length * 90 * G.DOMAINS.length, phone: 800 * 800 * 10000, company: G.COMPANIES.length };
  const dup = (N, n) => { let q = 1; for (let i = 0; i < n; i++) q *= 1 - i / N; return 1 - q; };
  const inlineCode = (text) => [...text.matchAll(/`([^`\n]+)`|<code>([^<]*)<\/code>/g)].map((m) => m[1] ?? m[2]);
  function sample(spec, after) {
    const block = fencedBlocks(after)[0];
    if (!block) return 'no code block after the annotation';
    let rows;
    if (spec.format === 'csv') {
      const lines = block.text.split('\n');
      if (lines[0] !== spec.fields.join(',')) return 'CSV header ' + JSON.stringify(lines[0]);
      rows = lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [spec.fields[i], v])));
      if (lines.slice(1).some((l) => l.split(',').length !== spec.fields.length)) return 'CSV row has the wrong number of fields';
    } else {
      try { rows = JSON.parse(block.text); } catch { return 'JSON does not parse'; }
      if (block.text !== JSON.stringify(rows, null, 2)) return 'JSON is not written the way the tool writes it (2-space indent)';
    }
    if (rows.length !== spec.count) return rows.length + ' records, not ' + spec.count;
    for (const r of rows) {
      if (JSON.stringify(Object.keys(r)) !== JSON.stringify(spec.fields)) return 'fields ' + Object.keys(r).join(',');
      for (const f of spec.fields) if (!VALID[f](r[f])) return f + ' value ' + JSON.stringify(r[f]) + ' cannot come from the generator';
    }
    return null;
  }
  function countNote(spec, after, lang) {
    const p = lifecyclePage(lang);
    p.get('fdg-count').value = spec.count;
    p.get('fdg-generate').click();
    const n = JSON.parse(output(p)).length, note = p.get('fdg-status').textContent;
    const codes = inlineCode(after);
    if (note && !codes.includes(note)) return 'status note ' + JSON.stringify(note) + ' not shown';
    if (!codes.includes(String(n))) return 'record count ' + n + ' not shown';
    return null;
  }
  function dupNote(spec, after) {
    const want = (dup(SIZE[spec.field], spec.n) * 100).toFixed(spec.digits) + '%';
    return inlineCode(after).includes(want) ? null : want + ' not shown';
  }
  reportContract((name, ok) => assert(name, ok, true), SLUG, { annotations: [
    { tag: 'fdg-check', min: 1, verify: ({ spec, after }) => sample(spec, after) },
    { tag: 'fdg-count', min: 1, verify: ({ spec, after, lang }) => countNote(spec, after, lang) },
    { tag: 'fdg-dup', verify: ({ spec, after }) => dupNote(spec, after) },
  ] });
  // Each language has at least two annotated examples in total
  const { readToolMdx, annotations } = await import(pathToFileURL(join(root, 'scripts/lib/tool-mdx-contract.mjs')));
  const docs = readToolMdx(SLUG);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const n = ['fdg-check', 'fdg-count', 'fdg-dup'].reduce((s, tag) => s + annotations(docs[lang].body, tag).length, 0);
    assert(lang + ' has at least 2 worked examples', n >= 2, true);
  }
}
process.removeListener('unhandledRejection',onUnhandled);
console.log(passes+' passed, '+failures+' failed');process.exitCode=failures?1:0;
