// IBAN Validator & Parser — BBAN field layout matches the SWIFT IBAN registry
//
// Read:  src/components/tools/IbanValidatorParserTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers: the country table and splitBban)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: every country's BBAN fields add up to its IBAN length minus 4 (before the fix
// Guatemala and Nicaragua added up to 32 for a 28-character IBAN, so the account field was
// cut short without an error); the SWIFT IBAN registry examples for Mauritius, Guatemala and
// Nicaragua pass ISO 7064 MOD 97-10 (checked here independently) and split into the
// registry's fields. Mauritius before the fix: bank 4 letters, branch 4, account 15,
// "reserved" MUR; the registry structure is 4!a2!n2!n12!n3!n3!a (bank BOMM01, branch 01,
// account 12 digits, 000, currency MUR).
//
// Run: node scripts/test-iban-validator-parser.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';
import vm from 'node:vm';
import { parseFragment, defaultTreeAdapter } from 'parse5';
import { loadPage } from './astro-page-harness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/IbanValidatorParserTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in IbanValidatorParserTool.astro');
  process.exit(1);
}
const E = new Function('t', source.slice(startIndex, endIndex) + '\nreturn { REG, splitBban };')({});

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function mod97ok(iban) {
  const r = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of r) for (const d of String(parseInt(ch, 36))) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

for (const [cc, r] of Object.entries(E.REG)) {
  const sum = r.fields.reduce((a, f) => a + f[1], 0) + 4;
  check(cc + ': fields add up to the IBAN length', sum === r.len, sum + ' vs ' + r.len);
}

const CASES = [
  ['MU17BOMM0101101030300200000MUR', [['bank', 'BOMM01'], ['branch', '01'], ['account', '101030300200'], ['reserved', '000'], ['currency', 'MUR']]],
  ['GT82TRAJ01020000001210029690', [['bank', 'TRAJ'], ['currency', '01'], ['type', '02'], ['account', '0000001210029690']]],
  ['NI45BAPR00000013000003558124', [['bank', 'BAPR'], ['account', '00000013000003558124']]],
];
for (const [iban, fields] of CASES) {
  const cc = iban.slice(0, 2);
  check(cc + ' registry example passes MOD 97-10', mod97ok(iban));
  eq(cc + ' length', iban.length, E.REG[cc].len);
  const split = E.splitBban(iban.slice(4), E.REG[cc].fields);
  check(cc + ' splits without a type error', !split.error, JSON.stringify(split.error));
  eq(cc + ' fields', (split.parts || []).map((p) => [p.role, p.value]), fields);
}
// a letter where Mauritius has digits is reported
check('MU: letter in the account is a type error', !!E.splitBban('BOMM0101X01030300200000MUR', E.REG.MU.fields).error);

// Frozen protected source, including the unmarked validation and rendering code.
for(const [name,begin,end,hash] of [
  ['marked engine','/* ── engine:start ── */','/* ── engine:end ── */','c928cecae75fde60e474378a7954e5075fc619df9d8b8b6d5b737605ce2d2ff8'],
  ['validation','      function printFormat(s) {','      // ── Rendering','643e040de940f5cf6a8cd997cb15d2c8a7e891e467b7c7bcbc3ddee3fbd2ade1'],
  ['rendering','      function escapeHtml(s) {','      // ── State & wiring','4a981a8943c84663ac745160553e890c69dd49600fc78c59dc991d0775cf7004'],
]){
  const a=source.indexOf(begin),b=source.indexOf(end,a);
  eq(name+' byte protection',createHash('sha256').update(source.slice(a,b+(end.startsWith('/*')?end.length:0))).digest('hex'),hash);
}

const frontmatter=source.match(/^---\n([\s\S]*?)\n---/)[1];
const LOCALES=vm.runInNewContext(frontmatter.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
const markupTemplate=source.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0];
const tipBindings=[...markupTemplate.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function renderMarkup(lang){
  const T=LOCALES[lang],about=JSON.parse(readFileSync(join(root,'src/i18n/'+lang+'.json'),'utf8'))['tool.tipAbout'];
  return markupTemplate.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_,id,key,tip)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-label="'+escape(about.replace('{name}',T[key]))+'">?</button><span id="'+id+'" popover="auto">'+escape(T.tips[tip])+'</span></span>')
    .replace(/=\{T\.(\w+)\}/g,(_,key)=>'="'+escape(T[key])+'"').replace(/\{T\.(\w+)\}/g,(_,key)=>escape(T[key]));
}

// Complete page regression. The DOM adapter tokenizes real generated HTML with parse5;
// only clipboard settlement and timers are controlled. The real shared shortcut runs
// before and after the complete component script. No browser or native clipboard access.
const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
if(!shortcut.includes("widget.querySelectorAll('textarea"))throw Error('Shared shortcut not found');
const must=(value,message)=>{if(!value)throw Error(message);};
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const unhandled=[];
process.on('unhandledRejection',error=>unhandled.push(String(error)));
function page(lang='en',order='shared-after',clipboardMode='normal'){
  const key='iban',slugs={iban:'iban-validator-parser'},paths={iban:'src/components/tools/IbanValidatorParserTool.astro'};
  const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],tracks=[];
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
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
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
      if (!this.dirtyValue && this.tagName === 'SELECT') return this.querySelector('option')?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true; }
    get firstChild() { return this.children[0]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { if (doc?.activeElement && doc.activeElement !== this && this.contains(doc.activeElement)) doc.activeElement=doc.body; for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child; }
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
    click() { if(!this.disabled)this.dispatch('click'); }
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
  widget.innerHTML=renderMarkup(lang);
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);throw Error('Native clipboard prohibited');};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(...args){persistCalls.push(['save',...args]);},load(){return null;}};
  const globals={document:doc,
    _slug:slugs[key],ztPersist:persist,trackTool(...args){tracks.push(args);},t:Object.fromEntries(Object.entries(LOCALES[lang]).filter(([key])=>key!=='tips')),
    navigator:clipboardMode==='absent'?{}:{clipboard:{writeText(value){if(clipboardMode==='throw')throw Error('Controlled clipboard throw');const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:slugs[key]},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(paths[key],{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,key+' ID '+id);return el;};
  return{doc,get,widget,clipboard,timers,persistCalls,execCalls,tracks,
    input(id,value){get(id).value=value;get(id).dispatch('input');},
    ctrlL(el=get('ivp-input'),key='l',mod='ctrlKey'){el.focus();const event=new EventStub('keydown',{bubbles:true,key,[mod]:true});el.dispatchEvent(event);return event;},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}
const GB='GB82 WEST 1234 5698 7654 32', DE='DE89 3704 0044 0532 0130 00';
const COPY={en:'Copy',zh:'复制',ja:'コピー',ko:'복사'};
const COPIED={en:'Copied!',zh:'已复制！',ja:'コピー済み！',ko:'복사됨!'};
const COPY_FAILED={en:'Copy failed. Please try again.',zh:'复制失败，请重试。',ja:'コピーに失敗しました。再試行してください。',ko:'복사에 실패했습니다. 다시 시도해 주세요.'};
const snapshot=p=>({input:p.get('ivp-input').value,status:p.get('ivp-status').textContent,statusClass:p.get('ivp-status').className,hidden:p.get('ivp-results').hidden,result:p.get('ivp-results').textContent,copies:p.get('ivp-results').querySelectorAll('.ivp-copy').map(b=>[b.getAttribute('data-copy'),b.textContent])});
const copy=p=>p.get('ivp-results').querySelector('.ivp-copy');
function prepared(lang,order,mode){const p=page(lang,order,mode);p.input('ivp-input',GB);return p;}
const beforePagePasses=passes,beforePageFailures=failures;
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
  const label=lang+'/'+order;
  let p=prepared(lang,order);
  eq(label+' live GB fields and formats',snapshot(p).copies.map(x=>x[0]),['WEST','123456','98765432',GB,'GB82WEST12345698765432','WEST12345698765432']);
  const original=snapshot(p),trackCount=p.tracks.length;p.get('ivp-input').dispatch('keydown',{key:'Enter',ctrlKey:true});eq(label+' no primary action on Ctrl+Enter preserves result',snapshot(p),original);eq(label+' no duplicate automatic validation on Ctrl+Enter',p.tracks.length,trackCount);
  for(const btn of p.get('ivp-results').querySelectorAll('.ivp-copy')){
    btn.click();eq(label+' copies complete field',p.clipboard.at(-1).value,btn.getAttribute('data-copy'));
    p.clipboard.at(-1).resolve();await settle();eq(label+' current success',btn.textContent,COPIED[lang]);
    p.tick(1400);eq(label+' feedback returns to Copy',btn.textContent,COPY[lang]);
  }
  let exampleError=null;try{p.doc.querySelector('.ivp-example-item').click();}catch(e){exampleError=e.message;}
  eq(label+' example has no runtime exception',exampleError,null);
  eq(label+' example yields machine format',snapshot(p).copies[4]?.[0],'GB82WEST12345698765432');
  check(label+' example never saves sensitive input',p.persistCalls.every(x=>x[0]!=='save'));
  p.input('ivp-input','GB83 WEST 1234 5698 7654 32');
  check(label+' checksum error visible',p.get('ivp-status').className.includes('error'));
  eq(label+' invalid input has no old copy values',snapshot(p).copies,[]);
  p.input('ivp-input','');eq(label+' empty clears result',[p.get('ivp-results').hidden,p.get('ivp-status').textContent,p.get('ivp-results').textContent],[true,'','']);
  for(const [key,mod,focus] of [['l','ctrlKey','input'],['L','metaKey','copy']]){
    p=prepared(lang,order);const ev=p.ctrlL(focus==='copy'?copy(p):p.get('ivp-input'),key,mod);
    eq(label+' '+mod+key+' clears synchronously',[p.get('ivp-input').value,p.get('ivp-status').textContent,p.get('ivp-results').hidden,p.get('ivp-results').textContent],['','',true,'']);
    check(label+' shortcut prevents browser default',ev.defaultPrevented);
    eq(label+' shared clear survives removed focus',p.persistCalls,[['clear','iban-validator-parser']]);
  }
  p=prepared(lang,order);const outside=snapshot(p),ev=p.ctrlL(p.doc.body);eq(label+' outside shortcut no change',snapshot(p),outside);check(label+' outside default untouched',!ev.defaultPrevented);
  for(const mode of ['normal','absent','throw']){
    p=prepared(lang,order,mode);const b=copy(p);let error=null;try{b.click();if(mode==='normal')p.clipboard.at(-1).reject(Error('denied'));}catch(e){error=e.message;}await settle();
    eq(label+' '+mode+' failure handled',error,null);eq(label+' '+mode+' failure visible',b.textContent,COPY_FAILED[lang]);
    if(mode==='normal'){b.click();p.clipboard.at(-1).resolve();await settle();eq(label+' failure direct retry succeeds',b.textContent,COPIED[lang]);p.tick(1400);eq(label+' retry resets original label',b.textContent,COPY[lang]);}
  }
  for(const action of ['clear','shortcut','new-valid','invalid','empty'])for(const outcome of ['resolve','reject']){
    p=prepared(lang,order);copy(p).click();const job=p.clipboard.at(-1);
    if(action==='clear')p.get('ivp-clear').click();else if(action==='shortcut')p.ctrlL(copy(p));else p.input('ivp-input',action==='new-valid'?DE:action==='invalid'?'bad':'');
    const after=snapshot(p);job[outcome](outcome==='reject'?Error('late'):undefined);await settle();p.tick(2000);eq(label+' late '+outcome+' after '+action,snapshot(p),after);
  }
  for(const outcome of ['resolve','reject']){
    p=prepared(lang,order);const b=copy(p);b.click();const old=p.clipboard.at(-1);b.click();p.clipboard.at(-1).resolve();await settle();
    const current=snapshot(p);old[outcome](outcome==='reject'?Error('late same value'):undefined);await settle();eq(label+' same-value old '+outcome+' cannot replace latest success',snapshot(p),current);
    p.tick(1400);eq(label+' same-value latest feedback settles',b.textContent,COPY[lang]);
  }
  p=prepared(lang,order);const b=copy(p);b.click();p.clipboard.at(-1).resolve();await settle();p.tick(100);
  const oldTimers=[...p.timers.values()].filter(t=>t.ms===1400);check(label+' captured actual feedback timer',oldTimers.length>0);
  b.click();p.clipboard.at(-1).resolve();await settle();const fresh=snapshot(p);p.tick(1300);
  for(const timer of oldTimers)timer.fn();eq(label+' old delivered timer cannot reset new success',snapshot(p),fresh);
  p.tick(100);eq(label+' new timer restores fixed original label',b.textContent,COPY[lang]);
  check(label+' no native clipboard fallback',p.execCalls.length===0);
}
await settle();eq('no unhandled clipboard rejections',unhandled,[]);
console.log(`page lifecycle: ${passes-beforePagePasses} passed, ${failures-beforePageFailures} failed`);

// ---------- v2 page layout ----------
const beforeV2Passes=passes,beforeV2Failures=failures;
const frozen={
  "oldKeys": [
    "inputLabel",
    "placeholder",
    "loadExample",
    "clear",
    "copy",
    "copied",
    "copyFailed",
    "statusEmpty",
    "okValid",
    "okBbanUnavailable",
    "errFormat",
    "errCountry",
    "errLength",
    "errBbanType",
    "errChecksum",
    "errLong",
    "sectionStatus",
    "sectionBban",
    "sectionFormats",
    "rowResult",
    "rowCountry",
    "rowCheckDigits",
    "rowLength",
    "rowPrint",
    "rowMachine",
    "rowBbanOnly",
    "tagValid",
    "tagInvalid",
    "fieldBank",
    "fieldBranch",
    "fieldAccount",
    "fieldCheck",
    "fieldCheck2",
    "fieldType",
    "fieldHolder",
    "fieldCurrency",
    "fieldId",
    "fieldKennitala",
    "fieldReserved",
    "fieldOwner",
    "lengthExpected",
    "typeN",
    "typeA",
    "typeC"
  ],
  "oldStringHashes": {
    "en": "24d3da2a9e6ea19e68f27995efa80e467c6161715742f9ead6d270f08bee3c5d",
    "zh": "bdb652488731d7a7d27dc85bd4b9434e5621be35b051cfd38565fb780fd0b3b9",
    "ja": "7794ca90878f1cd607053bd3c224b5c91115e5ff75337a4f12c0d9f1c088a9bf",
    "ko": "cac1b8b023b9f8adc5bc59616f04bef9c5d3d0713a464ebb9c7f33a89798c351"
  },
  "contentHashes": {
    "en": "271a6ca9e3b9b0a4f0a2e48ab5d0485e7f8723fc265f2d8a74f0fe5db9742d42",
    "zh": "e3953f0e0c4a2046811b92adb576f733fc371e95c78f36f994526faebd1034b5",
    "ja": "713c5d169e5c0edb15e08a3e4b55053c90b8ee6933e4e8006286fa8f8998da1e",
    "ko": "d6b6867f6fc9d85098a27d55122b3a66c125f76396952abded6cb70357503d21"
  },
  "scriptHash": "9940a157c7a4c0e874de4a244e1c6fb2aea904f818e6ba5a37ffeb32f5191417"
};

const hash=value=>createHash('sha256').update(value).digest('hex');
const require=createRequire(join(root,'package.json'));
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/IbanValidatorParserTool.astro')});
check('v2 Astro compiles',!compiled.diagnostics.some(d=>d.severity===1));
const css=compiled.css.join('\n');
let compiledError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compiledError=String(e);}
eq('v2 compiled module parses',compiledError,'');
const {compile:compileMdx}=await import('@mdx-js/mdx');
const pageScript=source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
check('v2 tool root is direct flex column',/^<div class="ivp-wrap">/.test(markupTemplate)&&/\.ivp-wrap\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-height:\s*0/.test(css));
check('v2 no runtime i18n',!/data-i18n|document\.documentElement\.lang/.test(source));
check('v2 client receives only locale minus tips',/define:vars=\{\{ t: CLIENT_T \}\}/.test(source)&&!/STRINGS|TIPS|tips/.test(pageScript));
check('v2 removed redundant Validate and local Enter',!source.includes('ivp-validate')&&!/validate:\s*'/.test(frontmatter)&&!pageScript.includes("e.key === 'Enter'"));
check('v2 actions/status/input/result order',markupTemplate.indexOf('class="ivp-actions"')<markupTemplate.indexOf('id="ivp-status"')&&markupTemplate.indexOf('id="ivp-status"')<markupTemplate.indexOf('id="ivp-input"')&&markupTemplate.indexOf('id="ivp-input"')<markupTemplate.indexOf('class="ivp-output"'));
check('v2 status has fixed height and internal overflow',/#ivp-status\s*\{[^}]*flex:\s*none[^}]*height:\s*2.8em[^}]*overflow:\s*auto/.test(css));
check('v2 desktop empty input region fills first screen',/\.ivp-wrap:has\(#ivp-results\[hidden\]\) \.ivp-input-section\s*\{[^}]*flex:\s*1 1 0/.test(css));
check('v2 result zero basis and internal scroll',/\.ivp-output\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0/.test(css)&&/\.ivp-results\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/.test(css));
check('v2 compiled hidden results override display grid',/\.ivp-results\[hidden\]\s*\{\s*display:\s*none/.test(css));
check('v2 mobile empty result hidden and bounded populated output',/@media\s*\(max-width:\s*860px\)/.test(css)&&/\.ivp-output\s*\{\s*flex:\s*none;\s*height:\s*27rem/.test(css)&&/\.ivp-output:has\(#ivp-results\[hidden\]\)\s*\{\s*display:\s*none/.test(css)&&/@media\s*\(max-width:\s*640px\)/.test(css)&&/\.ivp-output\s*\{\s*height:\s*24rem/.test(css));
check('v2 main input and actions minimum44px',/#ivp-clear,\s*\.ivp-input,\s*\.ivp-example-summary\s*\{\s*min-height:\s*44px/.test(css));
check('v2 copy feedback wraps inside bounded results',/\.ivp-copy\s*\{[^}]*max-width:\s*42%[^}]*min-height:\s*44px[^}]*white-space:\s*normal/.test(css));
eq('v2 exact five tips',tipBindings.map(m=>m[1]),['ivp-tip-examples','ivp-tip-input','ivp-tip-status','ivp-tip-bban','ivp-tip-formats']);
const localeKeys=Object.keys(LOCALES.en).sort();
const placeholders=value=>(String(value).match(/\{\w+\}/g)||[]).sort();
for(const lang of ['en','zh','ja','ko']){
  const T=LOCALES[lang],{tips,...client}=T;
  eq('v2 '+lang+' same locale keys',Object.keys(T).sort(),localeKeys);
  eq('v2 '+lang+' original retained strings unchanged',hash(JSON.stringify(Object.fromEntries(frozen.oldKeys.map(k=>[k,T[k]])))),frozen.oldStringHashes[lang]);
  eq('v2 '+lang+' five tip keys',Object.keys(tips),['input','examples','status','bban','formats']);
  for(const key of Object.keys(tips)){
    check('v2 '+lang+' nonempty plain tip '+key,typeof tips[key]==='string'&&tips[key].trim()&&!/[<>\n]|https?:/.test(tips[key]));
    eq('v2 '+lang+' tip placeholders '+key,placeholders(tips[key]),placeholders(LOCALES.en.tips[key]));
  }
  check('v2 '+lang+' tips absent serialized client',!('tips' in client)&&Object.values(tips).every(text=>!JSON.stringify(client).includes(text)));
  const p=page(lang),localAbout=JSON.parse(readFileSync(join(root,'src/i18n/'+lang+'.json'),'utf8'))['tool.tipAbout'];
  eq('v2 '+lang+' SSR input label',p.doc.querySelector('label').textContent,T.inputLabel);
  eq('v2 '+lang+' SSR Clear',p.get('ivp-clear').textContent,T.clear);
  eq('v2 '+lang+' result named keyboard region',[p.get('ivp-results').getAttribute('tabindex'),p.get('ivp-results').getAttribute('role'),p.get('ivp-results').getAttribute('aria-label')],['0','region',T.resultsLabel]);
  eq('v2 '+lang+' privacy directly visible',p.doc.querySelector('.ivp-privacy').textContent,T.privacy);
  for(const [,id,aboutKey,key] of tipBindings){
    eq('v2 '+lang+' tip body '+key,p.get(id).textContent,tips[key]);
    eq('v2 '+lang+' tip about '+key,p.doc.querySelector('[data-zt-tip="'+id+'"]').getAttribute('aria-label'),localAbout.replace('{name}',T[aboutKey]));
  }
  eq('v2 '+lang+' retained eight actual examples',p.doc.querySelectorAll('.ivp-example-item').length,8);
  for(const example of p.doc.querySelectorAll('.ivp-example-item')){example.click();check('v2 '+lang+' published sample valid',p.get('ivp-status').className.includes('success'));}
  for(const order of ['shared-before','shared-after']){
    const q=prepared(lang,order);q.ctrlL(q.doc.querySelector('[data-zt-tip="ivp-tip-bban"]'));
    eq('v2 '+lang+'/'+order+' result tip CtrlL retains shared focus',[q.doc.activeElement.id,q.get('ivp-results').hidden,q.get('ivp-status').textContent,q.persistCalls],['ivp-input',true,'',[['clear','iban-validator-parser']]]);
  }
  const content=readFileSync(join(root,'src/content/tools/iban-validator-parser/'+lang+'.mdx'),'utf8');
  const meta=yaml.load(content.match(/^---\n([\s\S]*?)\n---/)[1]);
  eq('v2 '+lang+' exact five usage steps',meta.steps.length,5);
  check('v2 '+lang+' bounded plain steps',meta.steps.every(x=>typeof x==='string'&&x.length<=280&&!/[<>\n]/.test(x))&&meta.steps.join('').length<=1200);
  check('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'));
  check('v2 '+lang+' steps retain current example/formats labels',meta.steps.some(x=>x.includes(T.loadExample))&&meta.steps.some(x=>x.includes(T.sectionFormats)));
  eq('v2 '+lang+' all non-Usage content exact',hash(content.replace(/^steps:\n(?:  - .*\n)+/m,'')),frozen.contentHashes[lang]);
  let error='';try{await compileMdx(content.replace(/^---[\s\S]*?---\s*/,''));}catch(e){error=String(e);}
  eq('v2 '+lang+' MDX compiles',error,'');
}
const protectedTail=source.slice(source.indexOf('      // ── SWIFT IBAN Registry'),source.indexOf('  </script>')).replace("if (document.querySelector('.ivp-output').contains(document.activeElement)) inputEl.focus();","if (resultsEl.contains(document.activeElement)) inputEl.focus();");
eq('v2 script exact except deleted automatic button/Enter and output-focus adaptation',hash(protectedTail),frozen.scriptHash);
check('v2 registered analyze',/'iban-validator-parser':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
console.log(`v2 page layout: ${passes-beforeV2Passes} passed, ${failures-beforeV2Failures} failed`);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
