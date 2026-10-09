// Keycode Explorer — the mobile input fallback does not invent a `code` value
//
// Read:  src/components/tools/KeycodeExplorerTool.astro (extracts the real `captureFromMobileInput`
//        between the `engine:start` / `engine:end` markers and runs it with stub DOM helpers),
//        src/content/tools/keycode-explorer/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// An input event only carries the inserted text (InputEvent.data). Before the fix the fallback
// showed code "KeyA" for the letter "a", which is the physical key only on QWERTY-like
// layouts (UI Events KeyboardEvent code spec: on AZERTY the key that types "a" is "KeyQ"), and
// charCode as the first UTF-16 code unit. Now code / keyCode / which / charCode are shown as
// "—" and only `key` (the typed text) is filled.
//
// Run: node scripts/test-keycode-explorer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadPage } from './astro-page-harness.mjs';
import { contractProblems, reportContract, fencedBlocks } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/KeycodeExplorerTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in KeycodeExplorerTool.astro');
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

function runCapture(text) {
  const shown = {};
  const fields = new Proxy({}, { get: (_, k) => k });
  const env = {
    capturedCount: 0,
    padCount: {}, padKey: {}, padGlyph: { classList: { add() {}, remove() {} } },
    fields,
    setText: (k, v) => { shown[k] = v; },
    setMods() {}, buildSnippet() {}, pushHistory() {},
    mobileInput: { value: text },
    window: { setTimeout() {} },
  };
  const fn = new Function(...Object.keys(env), source.slice(startIndex, endIndex) + '\nreturn captureFromMobileInput;')(...Object.values(env));
  fn({ data: text });
  return shown;
}

for (const ch of ['a', 'Q', 'é', '😀', '中']) {
  const shown = runCapture(ch);
  check('key for ' + ch, shown.key === JSON.stringify(ch), shown.key);
  for (const f of ['code', 'keyCode', 'which', 'charCode', 'location']) {
    check(f + ' is not guessed for ' + ch, shown[f] === '—', String(shown[f]));
  }
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const note = keyStrings(lang).mobileNote;
  check(lang + ': mobile note says code is not available', /code/.test(note) && /keyCode/.test(note), note);
  const mdx = readFileSync(join(root, 'src/content/tools/keycode-explorer', lang + '.mdx'), 'utf8');
  check(lang + ': page explains code on non-QWERTY layouts (KeyQ on AZERTY)', mdx.includes('KeyQ'), lang);
}

// ---------- actual full page + shared shortcut lifecycle ----------
const require = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = require('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const must = (ok, message) => { if (!ok) throw Error(message); };
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function keyStrings(lang){return vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS[lang]',{lang},{timeout:1000});}
function keyLabels(lang){const {tips,capturePad,mobileNote,...labels}=keyStrings(lang);return labels;}
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function eq(name,actual,expected){check(name,JSON.stringify(actual)===JSON.stringify(expected),JSON.stringify({actual,expected}));}
function pageVM(lang='en',order='shared-after',noClipboard=false,coarse=true){
  const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],tracks=[];
  let timerId=0,clock=0,doc,execResult=false;
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
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false, isTrusted: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return (this.querySelectorAll('option').find(o=>o.selected)||this.querySelector('option'))?.value ?? '';
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
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
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
    click() { if(!this.disabled){this.focus();this.dispatch('click');} }
    select() { doc.selectedElement=this; }
    focus() { if(doc.activeElement===this)return;const old=doc.activeElement;doc.activeElement=this;if(old)old.dispatchEvent(new EventStub('blur'));this.dispatchEvent(new EventStub('focus')); }
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
  let markup=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
  const T=keyStrings(lang),CLIENT_T=keyLabels(lang);
  markup=markup.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_,id,label,key)=>'<span class="zt-tip"><button type="button" id="'+id+'-trigger" data-zt-tip="'+id+'">'+escape(T[label])+'</button><span id="'+id+'" hidden>'+escape(T.tips[key])+'</span></span>');
  markup=markup.replace(/=\{T\.(\w+)\}/g,(_,k)=>'="'+escape(T[k])+'"').replace(/\{T\.(\w+)\}/g,(_,k)=>escape(T[k]));
  widget.innerHTML=markup;
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push({command,text:doc.selectedElement?.value??null});return execResult;}; // Pure memory boundary, no native clipboard.
  const persist={clear(slug){persistCalls.push(['clear',slug]);}};
  const location=new URL('https://zerotool.dev/tools/'+'keycode-explorer'+'/');

  const windowListeners={};
  const globals={document:doc,lang,CLIENT_T,URL,URLSearchParams,location,history:{replaceState(_s,_title,url){location.href=new URL(url,location.href).href;}},addEventListener(type,fn){(windowListeners[type]??=[]).push(fn);},matchMedia(){return{matches:coarse};},
    _slug:'keycode-explorer',ztPersist:persist,trackTool(...args){tracks.push(args);},
    navigator:noClipboard?{}:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:'keycode-explorer'},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage('src/components/tools/KeycodeExplorerTool.astro',{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,'ID '+id);return el;};
  return{doc,get,widget,clipboard,timers,persistCalls,execCalls,tracks,location,
    fallback(value){execResult=value;},
    input(id,value){get(id).value=value;get(id).dispatch('input');},
    ctrlL(id,key='l',mod='ctrlKey'){const el=get(id);el.focus();el.dispatch('keydown',{key,[mod]:true});},
    change(id,value){get(id).value=value;get(id).dispatch('change');},
    key(id,extra){const el=get(id);el.focus();el.dispatch('keydown',{key:'a',code:'KeyA',keyCode:65,which:65,charCode:0,location:0,repeat:false,isComposing:false,ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,...extra});},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}

const getState=p=>({count:p.get('kce-pad-count').textContent,fields:['key','code','keycode','which','charcode','location','repeat','composing'].map(k=>p.get('kce-'+k).textContent),history:p.get('kce-history').textContent,snippet:p.get('kce-snippet-code').textContent,status:p.get('kce-status').textContent,copy:p.get('kce-copy').textContent,copied:p.get('kce-copy').classList.contains('copied')});
const ready=(lang,order='shared-after',noClipboard=false)=>{const p=pageVM(lang,order,noClipboard);p.tick(60);p.key('kce-pad',{key:'Enter',code:'Enter',keyCode:13,which:13});return p;};
const emptySnippet="document.addEventListener('keydown', (e) => {\n  // press a key in the pad above to generate a snippet\n});";
const enterSnippet="document.addEventListener('keydown', (e) => {\n  if (e.key === 'Enter') {\n    // your handler\n  }\n});";
for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const tag=lang+'/'+order,p=ready(lang,order),L=keyLabels(lang);
 eq(tag+' actual main Enter capture',getState(p).fields,['"Enter"','"Enter"','13','13','0','0','false','false']);eq(tag+' actual snippet',getState(p).snippet,enterSnippet);
 p.ctrlL('kce-copy');await settle();let got=getState(p);
 eq(tag+' non-pad CtrlL clears fields/count/history/snippet/status',[got.count,got.fields,got.history,got.snippet,got.status],['0',Array(8).fill('—'),'',emptySnippet,'']);
 eq(tag+' non-pad clear keeps pad focus',p.doc.activeElement.id,'kce-pad');eq(tag+' actual shared clear runs once',p.persistCalls.filter(x=>x[0]==='clear').length,1);
 const q=ready(lang,order);q.key('kce-pad',{key:'l',code:'KeyL',keyCode:76,which:76,ctrlKey:true});
 eq(tag+' CtrlL on pad remains key capture',[q.get('kce-key').textContent,q.get('kce-pad-count').textContent],['"l"','2']);eq(tag+' pad CtrlL snippet preserves modifier',q.get('kce-snippet-code').textContent.includes("e.key === 'l' && e.ctrlKey"),true);
 q.ctrlL('kce-clear','L','metaKey');await settle();eq(tag+' MetaL outside pad clears capture',getState(q).count,'0');
 const r=ready(lang,order);r.get('kce-clear').click();eq(tag+' explicit Clear preserves existing behavior',[getState(r).count,getState(r).history,getState(r).snippet,getState(r).status],['0','',emptySnippet,'']);
}
for(const lang of ['en','zh','ja','ko']){
 const tag=lang+'/copy',L=keyLabels(lang),p=ready(lang),b=p.get('kce-copy');b.click();eq(tag+' copies complete generated snippet',p.clipboard[0].value,enterSnippet);p.clipboard[0].reject(Error('denied'));await settle();eq(tag+' current failure visible',p.get('kce-status').textContent,L.copyFailed);
 b.click();eq(tag+' same-result retry copies same bytes',p.clipboard[1].value,enterSnippet);p.clipboard[1].resolve();await settle();eq(tag+' retry marks success',b.textContent,L.copied);eq(tag+' retry clears own prior error',p.get('kce-status').textContent,'');p.tick(1500);eq(tag+' current timer resets original label',b.textContent,L.copy);
 for(const success of [false,true]){const q=ready(lang,'shared-after',true);q.fallback(success);q.get('kce-copy').click();eq(tag+'/fallback '+success+' truthful success',q.get('kce-copy').textContent,success?L.copied:L.copy);eq(tag+'/fallback '+success+' visible failure',q.get('kce-status').textContent,success?L.padBlurred:L.copyFailed);}
 const boundaries={clear:q=>q.get('kce-clear').click(),CtrlL:q=>q.ctrlL('kce-copy'),keyboard:q=>q.key('kce-pad',{key:'Tab',code:'Tab',keyCode:9,which:9}),mobile:q=>q.input('kce-mobile-input','中')};
 for(const [name,invalidate]of Object.entries(boundaries))for(const completion of ['resolve','reject']){
  const q=ready(lang),copy=q.get('kce-copy');copy.click();invalidate(q);await settle();const before=getState(q);q.clipboard[0][completion](Error('late'));await settle();eq(tag+'/'+name+'/'+completion+' late callback preserves current state',getState(q),before);q.tick(1500);eq(tag+'/'+name+'/'+completion+' late timer preserves current state',getState(q),before);eq(tag+'/'+name+'/'+completion+' no fallback',q.execCalls.length,0);
 }
 const q=ready(lang),qb=q.get('kce-copy');qb.click();q.clipboard[0].resolve();await settle();q.tick(100);qb.click();q.clipboard[1].resolve();await settle();q.tick(1400);eq(tag+' old timer preserves fresh success',qb.textContent,L.copied);q.tick(100);eq(tag+' newest timer restores Copy',qb.textContent,L.copy);
 for(const completion of ['resolve','reject']){const r=ready(lang),rb=r.get('kce-copy');rb.click();rb.click();r.clipboard[1].resolve();await settle();const current=getState(r);r.clipboard[0][completion](Error('old'));await settle();eq(tag+'/same-output stale '+completion,getState(r),current);}
 const r=ready(lang),rb=r.get('kce-copy');rb.click();r.get('kce-pad').focus();const focused=r.get('kce-status').textContent;r.clipboard[0].resolve();await settle();eq(tag+' success preserves newer focus status',r.get('kce-status').textContent,focused);
}
// ---------- statistics and copy fallback (S2-9b) ----------
// Every captured key used to send a `keydown` event, and Copy sent `copy_snippet` even when the
// copy failed. Now one `keydown` per capture run (page load or Clear), and copy_snippet only on a
// successful copy. A rejected Clipboard API write now tries the textarea fallback.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = pageVM(lang); p.tick(60);
  for (const k of ['a', 'b', 'c']) p.key('kce-pad', { key: k, code: 'Key' + k.toUpperCase() });
  eq(lang + ' three keys send one keydown event', p.tracks.filter(a => a[1] === 'keydown').length, 1);
  p.get('kce-clear').click(); p.key('kce-pad', { key: 'd', code: 'KeyD' });
  eq(lang + ' a key after Clear sends one more', p.tracks.filter(a => a[1] === 'keydown').length, 2);
  p.get('kce-copy').click(); p.clipboard[0].reject(Error('denied')); await settle();
  eq(lang + ' failed copy is not tracked', p.tracks.filter(a => a[1] === 'copy_snippet').length, 0);
  p.get('kce-copy').click(); p.clipboard[1].resolve(); await settle();
  eq(lang + ' successful copy is tracked once', p.tracks.filter(a => a[1] === 'copy_snippet').length, 1);
  const q = ready(lang); q.fallback(true); q.get('kce-copy').click(); q.clipboard[0].reject(Error('denied')); await settle();
  eq(lang + ' rejected write falls back to the textarea copy', [q.execCalls.length, q.execCalls[0]?.text, q.get('kce-copy').textContent], [1, enterSnippet, keyLabels(lang).copied]);
  eq(lang + ' fallback success is tracked', q.tracks.filter(a => a[1] === 'copy_snippet').length, 1);
}

// ---------- worked examples on the tool pages (kce-check) ----------
// {/* kce-check: {"event": {key, code, keyCode, ctrlKey, ...}} */} The event is dispatched on the
// real capture pad. Every code block after the note must be either a field table, whose lines are
// `<label> <value>` with a label from the Event properties grid and the value exactly as the page
// shows it, or the generated snippet, verbatim. At least one block is required.
const FIELD_IDS = { 'event.key': 'kce-key', 'event.code': 'kce-code', keyCode: 'kce-keycode', which: 'kce-which', charCode: 'kce-charcode', location: 'kce-location', repeat: 'kce-repeat', isComposing: 'kce-composing' };
function verifyKey({ spec, after, lang }) {
  if (!spec || typeof spec.event !== 'object') return 'kce-check needs "event"';
  const p = pageVM(lang); p.tick(60); p.key('kce-pad', spec.event);
  const blocks = fencedBlocks(after);
  if (!blocks.length) return 'no code block after the note';
  for (const b of blocks) {
    const lines = b.text.split('\n');
    const rows = lines.map((l) => l.match(/^(event\.key|event\.code|keyCode|which|charCode|location|repeat|isComposing)\s+(.+)$/));
    if (rows.every(Boolean)) {
      for (const [, label, value] of rows) {
        const shown = p.get(FIELD_IDS[label]).textContent;
        if (shown !== value.trim()) return label + ' shows ' + shown + ', page says ' + value.trim();
      }
    } else if (b.text !== p.get('kce-snippet-code').textContent) {
      return 'block is neither a field table nor the snippet: ' + JSON.stringify(b.text);
    }
  }
  return null;
}
reportContract(check, 'keycode-explorer', { limits: true, requireFaqIds: true, annotations: [{ tag: 'kce-check', min: 2, verify: verifyKey }] });
check('kce-check rejects a wrong field', verifyKey({ spec: { event: { key: 'a', code: 'KeyQ' } }, after: '```\nevent.code  "KeyA"\n```', lang: 'en' }) !== null);
check('kce-check rejects a wrong snippet', verifyKey({ spec: { event: { key: 'a', code: 'KeyQ' } }, after: "```js\ndocument.addEventListener('keydown', (e) => {\n  if (e.key === 'q') {\n    // your handler\n  }\n});\n```", lang: 'en' }) !== null);
check('kce-check accepts the right field', verifyKey({ spec: { event: { key: 'a', code: 'KeyQ' } }, after: '```\nevent.key   "a"\nevent.code  "KeyQ"\n```', lang: 'en' }) === null);

// Preserve both the marked mobile engine and unmarked physical-key/snippet code.
for(const [name,startMark,endMark,bytes,hash,includeEnd] of [
 ['mobile','      /* ── engine:start ── */','      /* ── engine:end ── */',1412,'eb1b5b7b2298a4583d41e5f2cc74245484ddd3b9c18713100c417f97a0996a10',true],
 // S2-9b (2026-10-09): the keydown statistics event is sent once per capture run, not per key.
 ['physical key capture','      function captureFromKeyboardEvent','      /* ── engine:start ── */',1134,'8b9d72e437ba3f35a301405597009d9661bff6376e4fa1801720a334d9cade5f',false],
 ['snippet/modifiers/history','      function setText','      function captureFromKeyboardEvent',2234,'36ac5072cbfee1018f281161c90ac1f06d13392b4056176c443c2f34b5bb345d',false],
]){const block=source.slice(source.indexOf(startMark),source.indexOf(endMark)+(includeEnd?endMark.length:0));eq(name+' protected bytes',Buffer.byteLength(block),bytes);eq(name+' protected SHA',createHash('sha256').update(block).digest('hex'),hash);}

// ---------- v2 page layout ----------
const hash=value=>createHash('sha256').update(value).digest('hex');
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/KeycodeExplorerTool.astro')});
eq('v2 Astro diagnostics',compiled.diagnostics.filter(d=>d.severity===1),[]);
let moduleError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(error){moduleError=String(error);}
eq('v2 compiled module parses',moduleError,'');
const style=compiled.css.join('\n');
// S2-9b (2026-10-09): updated for the statistics and copy-fallback fixes tested above.
eq('v2 complete logic after localization unchanged',hash(source.slice(source.indexOf('      var pad = document.getElementById'),source.indexOf('  </script>'))),'bd2526348e3811a16237d192e843d0314f7f36576d23629dd6a5d9a6454aaa71');
eq('v2 analyze registry',/['"]keycode-explorer['"]\s*:\s*['"]analyze['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')),true);
eq('v2 outermost tool root',/^<div class="kce-wrap">/.test(source.split('\n---\n')[1].trim()),true);
eq('v2 no runtime i18n',source.includes('data-i18n'),false);
eq('v2 localize before script',source.indexOf('// strings:end')<source.indexOf('<script'),true);
eq('v2 status before pad',source.indexOf('id="kce-status"')<source.indexOf('id="kce-pad"'),true);
eq('v2 all controls before status',Math.max(source.indexOf('id="kce-clear"'),source.indexOf('id="kce-copy"'))<source.indexOf('id="kce-status"'),true);
for(const [name,re]of [
 ['root minimum',/\.kce-wrap\s*\{[^}]*min-height:\s*0/],
 ['bounded result',/\.kce-results\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/],
 ['bounded snippet',/\.kce-snippet\s*\{[^}]*overflow:\s*auto[^}]*max-height:\s*12rem/],
 ['bounded history',/\.kce-history\s*\{[^}]*max-height:\s*5rem[^}]*overflow:\s*auto/],
 ['fixed status',/#kce-status\s*\{[^}]*height:\s*4\.2em[^}]*overflow:\s*auto/],
 ['stable empty and captured key alignment',/\.kce-pad-display\s*\{[^}]*align-items:\s*center/],
 ['44px fixed copy feedback',/\.kce-toolbar[^}]*> button\s*\{[^}]*min-height:\s*44px;\s*height:\s*44px/],
 ['860 result height',/@media\s*\(max-width:\s*860px\)[\s\S]*?\.kce-results\s*\{[^}]*height:\s*28rem/],
 ['640 result height',/@media\s*\(max-width:\s*640px\)[\s\S]*?\.kce-results\s*\{[^}]*height:\s*26rem/],
 ['coarse fallback honors hidden',/\.kce-mobile-fallback\[hidden\]\s*\{\s*display:\s*none/],
])eq('v2 '+name,re.test(style),true);
const bindings={pad:'capturePad',mobile:'mobileInputLabel',properties:'eventProps',modifiers:'modifiers',snippet:'snippet',copy:'copy',history:'recentKeys',clear:'clear'};
const originalLabelHashes={"en": "ecfb232b89ccb99b9a025ef8d06b9d8859fa32d73ae51f09008765b9aeda30d2", "zh": "77f4888f79fea060a1f687082fb957d91966b5ab40c853013850f9483693741a", "ja": "2137be2f49ae36466829cd8876db93161eb528e609e52cf979924754b21f5af2", "ko": "cf7398b9b2b8109639f1381b9597f99228192489f134c0183de3fff4b2ed8bd8"};
for(const lang of ['en','zh','ja','ko']){
 const T=keyStrings(lang),L=keyLabels(lang),p=pageVM(lang);
 eq('v2 '+lang+' eight translated fact groups',Object.keys(T.tips).sort(),Object.keys(bindings).sort());
 const {tips,capturePad,...originalLabels}=T;
 eq('v2 '+lang+' all original label values',hash(JSON.stringify(originalLabels)),originalLabelHashes[lang]);
 eq('v2 '+lang+' client excludes facts',Object.keys(L).some(k=>k==='tips'||k==='capturePad'||k==='mobileNote'),false);
 eq('v2 '+lang+' original mobile warning preserved',T.tips.mobile,T.mobileNote);
 eq('v2 '+lang+' coarse pointer enables fallback',p.get('kce-mobile-fallback').hidden,false);
 eq('v2 '+lang+' fine pointer keeps fallback hidden',pageVM(lang,'shared-after',false,false).get('kce-mobile-fallback').hidden,true);
 eq('v2 '+lang+' pad named in locale',p.get('kce-pad').getAttribute('aria-label'),T.capturePad);
 for(const [key,label]of Object.entries(bindings)){
  eq('v2 '+lang+' '+key+' visible text',p.get('kce-tip-'+key).textContent,T.tips[key]);
  eq('v2 '+lang+' '+key+' actual control',p.get('kce-tip-'+key+'-trigger').textContent,T[label]);
 }
 for(const sel of ['#kce-results','.kce-snippet','#kce-history'])eq('v2 '+lang+' '+sel+' keyboard scroll entry',p.widget.querySelector(sel).getAttribute('tabindex'),'0');
 for(const id of ['kce-clear','kce-copy'])eq('v2 '+lang+' keeps '+id,p.get(id).tagName,'BUTTON');
 const content=readFileSync(join(root,'src/content/tools/keycode-explorer/'+lang+'.mdx'),'utf8');
 const match=content.match(/^steps:\n((?:  - .*\n)+)/m);const steps=match?[...match[1].matchAll(/^  - (.*)$/gm)].map(m=>JSON.parse(m[1])):[];
 eq('v2 '+lang+' five bounded steps',steps.length===5&&steps.every(t=>t.length<=280)&&steps.join('').length<=1200,true);
 eq('v2 '+lang+' steps precede FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'),true);
 eq('v2 '+lang+' MDX content contract', contractProblems('keycode-explorer', lang), '');
 for(const order of ['shared-before','shared-after']){
  const q=ready(lang,order);q.ctrlL('kce-tip-properties-trigger');await settle();
  eq('v2 '+lang+'/'+order+' result tip CtrlL clears',getState(q).fields,Array(8).fill('—'));
  eq('v2 '+lang+'/'+order+' result tip focus reaches surviving pad',q.doc.activeElement.id,'kce-pad');
  eq('v2 '+lang+'/'+order+' result tip shared persistence clears',q.persistCalls.filter(c=>c[0]==='clear').length,1);
 }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
