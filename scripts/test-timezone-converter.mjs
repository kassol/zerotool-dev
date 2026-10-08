// Timezone Converter — zone names, wall-clock conversion across DST, "Now" in the source zone
//
// Read:  src/components/tools/TimezoneConverterTool.astro (extracts the code from the zoneSet line
//        to zoneCity), src/content/tools/timezone-converter/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: isZone accepts names that Intl.DateTimeFormat accepts even when
// Intl.supportedValuesOf leaves them out (V8 lists Asia/Calcutta and no UTC, so UTC and the
// mumbai / delhi aliases used to be rejected as "Unknown timezone"); wall-clock to UTC in the
// spring-forward gap (02:30 → 03:30, RFC 5545 3.3.5; it used to give 01:30) and the fall-back
// overlap (first occurrence), checked against a brute-force search over every minute; "Now"
// gives the wall-clock time in the source zone (it used to give the browser's local time even
// after the source zone was changed); the examples on the English page.
//
// Run: node scripts/test-timezone-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadPage } from './astro-page-harness.mjs';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TimezoneConverterTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/timezone-converter/en.mdx'), 'utf8');
const start = source.indexOf('  const zoneSet = new Set(allZones);');
const end = source.indexOf('  function zoneCity(');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the conversion code in TimezoneConverterTool.astro');
  process.exit(1);
}
const E = new Function('allZones', 'datalist', source.slice(start, end) +
  '\nreturn { isZone, wallClockToUtc, formatInZone, dstSummary, nowInZone, getOffsetMin };')(
  Intl.supportedValuesOf('timeZone'), {});

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- zone names ----------
for (const z of ['UTC', 'Asia/Kolkata', 'Asia/Calcutta', 'Europe/Kyiv', 'America/New_York', 'Asia/Tokyo']) eq('isZone ' + z, E.isZone(z), true);
for (const z of ['Mars/Olympus', '', 'Asia/Tokio']) eq('not a zone ' + JSON.stringify(z), E.isZone(z), false);
const aliasBlock = source.slice(source.indexOf('const ALIASES = {'), source.indexOf('};', source.indexOf('const ALIASES = {')));
for (const [, alias, zone] of aliasBlock.matchAll(/'([^']+)': '([^']+)'/g)) eq('alias ' + alias + ' is a zone', E.isZone(zone), true);
eq('typing utc resolves', /if \(lc === 'utc' \|\| lc === 'gmt'\) return 'UTC';/.test(source), true);

// ---------- wall clock → UTC against a brute-force search ----------
// All UTC minutes whose wall clock in `zone` equals the given one
function bruteForce(wall, zone) {
  const [y, mo, d, h, mi] = wall.match(/\d+/g).map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const want = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  const hits = [];
  for (let t = guess - 15 * 3600000; t <= guess + 15 * 3600000; t += 60000) {
    if (fmt.format(new Date(t)) === want) hits.push(t);
  }
  return hits;
}
const cases = [];
for (const zone of ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Australia/Lord_Howe', 'America/Sao_Paulo', 'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Chatham', 'America/St_Johns']) {
  for (const day of ['2026-03-08', '2026-03-29', '2026-04-05', '2026-10-04', '2026-11-01', '2026-10-25', '2026-06-15', '2026-09-27', '2026-04-05']) {
    for (const time of ['00:30', '01:30', '02:00', '02:30', '03:30', '12:00']) cases.push([day + 'T' + time, zone]);
  }
}
let gapCount = 0;
let overlapCount = 0;
let mismatch = 0;
for (const [wall, zone] of cases) {
  const got = E.wallClockToUtc(wall, zone).getTime();
  const hits = bruteForce(wall, zone);
  let want;
  if (hits.length) {
    want = hits[0];
    if (hits.length > 1) overlapCount++;
  } else {
    gapCount++;
    // skipped time: read with the offset before the gap (RFC 5545 3.3.5)
    const guess = Date.parse(wall + ':00Z');
    want = guess - E.getOffsetMin(new Date(guess - 86400000), zone) * 60000;
  }
  if (got !== want) { mismatch++; if (mismatch < 5) console.log('  mismatch', wall, zone, new Date(got).toISOString(), new Date(want).toISOString()); }
}
eq('wall clock matches brute force (' + cases.length + ' cases)', mismatch, 0);
eq('cases include gaps and overlaps', gapCount > 3 && overlapCount > 3, true);

// ---------- page examples ----------
const show = (wall, src, zone) => {
  const f = E.formatInZone(E.wallClockToUtc(wall, src), zone);
  return f.local + ', ' + f.offset + (f.abbr ? ' (' + f.abbr + ')' : '');
};
for (const [wall, src, zone, want] of [
  ['2026-10-01T09:00', 'Asia/Shanghai', 'Europe/Berlin', '2026-10-01 03:00:00, UTC+02:00'],
  ['2026-10-01T09:00', 'Asia/Shanghai', 'America/Los_Angeles', '2026-09-30 18:00:00, UTC-07:00 (PDT)'],
  ['2026-10-01T09:00', 'Asia/Shanghai', 'Asia/Seoul', '2026-10-01 10:00:00, UTC+09:00'],
  ['2026-03-25T15:00', 'Europe/London', 'America/New_York', '2026-03-25 11:00:00, UTC-04:00 (EDT)'],
  ['2026-03-25T15:00', 'Europe/London', 'Asia/Kolkata', '2026-03-25 20:30:00, UTC+05:30'],
  ['2026-03-25T15:00', 'Europe/London', 'Australia/Sydney', '2026-03-26 02:00:00, UTC+11:00'],
]) {
  eq('page: ' + wall + ' ' + src + ' → ' + zone, show(wall, src, zone), want);
  eq('page shows ' + want, page.includes('<td>' + want + '</td>'), true);
}
eq('gap: 02:30 New York → 07:30 UTC', E.wallClockToUtc('2026-03-08T02:30', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
eq('overlap: 01:30 New York → 05:30 UTC', E.wallClockToUtc('2026-11-01T01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
eq('no DST badge zones', ['Asia/Tokyo', 'Asia/Shanghai', 'Australia/Brisbane'].map((z) => E.dstSummary(new Date(Date.UTC(2026, 5, 1)), z).observesDst), [false, false, false]);
eq('DST badge 3 days before the US change', E.dstSummary(E.wallClockToUtc('2026-03-05T12:00', 'America/New_York'), 'America/New_York').shiftDays, 3);

// ---------- Now in the source zone ----------
const instant = new Date(Date.UTC(2026, 9, 1, 0, 0, 5));
eq('now in Tokyo', E.nowInZone('Asia/Tokyo', instant), '2026-10-01T09:00:05');
eq('now in Los Angeles', E.nowInZone('America/Los_Angeles', instant), '2026-09-30T17:00:05');
eq('Now button uses the source zone', /state\.base = nowInZone\(state\.source\);/.test(source), true);

// ---------- actual full page + shared shortcut lifecycle ----------
const require = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = require('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const must = (ok, message) => { if (!ok) throw Error(message); };
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const escape=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function tzStrings(lang){return vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS[lang]',{lang},{timeout:1000});}
function tzLabels(lang){const {tips,emptyResult,...labels}=tzStrings(lang);return labels;}
function pageVM(lang='en',order='shared-after',noClipboard=false){
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
  const L=tzLabels(lang);
  const T=tzStrings(lang);
  markup=markup.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g,(_,id,label,key)=>'<span class="zt-tip"><button id="'+id+'-trigger" type="button" data-zt-tip="'+id+'">'+escape(L[label])+'</button><span id="'+id+'" hidden>'+escape(T.tips[key])+'</span></span>');
  markup=markup.replace(/=\{L\.(\w+)\}/g,(_,k)=>'="'+escape(L[k])+'"').replace(/\{L\.(\w+)\}/g,(_,k)=>escape(L[k])).replace(/\{emptyResult\}/g,escape(T.emptyResult));
  widget.innerHTML=markup;
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push({command,text:doc.selectedElement?.value??null});return execResult;}; // Pure memory boundary, no native clipboard.
  let saved={};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(slug,data){saved=JSON.parse(JSON.stringify(data));persistCalls.push(['save',slug,saved]);},load(){return saved;}};
  const location=new URL('https://zerotool.dev/tools/'+'timezone-converter'+'/');
  location.hash='t=2026-10-01T12%3A00%3A00&s=UTC&z=UTC%2CAsia%2FTokyo';
  const windowListeners={};
  const globals={document:doc,lang,L,URL,URLSearchParams,location,history:{replaceState(_s,_title,url){location.href=new URL(url,location.href).href;}},addEventListener(type,fn){(windowListeners[type]??=[]).push(fn);},matchMedia(){return{matches:true};},
    _slug:'timezone-converter',ztPersist:persist,trackTool(...args){tracks.push(args);},
    navigator:noClipboard?{}:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:'timezone-converter'},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage('src/components/tools/TimezoneConverterTool.astro',{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,'ID '+id);return el;};
  return{doc,get,widget,clipboard,timers,persistCalls,execCalls,tracks,location,
    fallback(value){execResult=value;},preferences(){return saved;},
    input(id,value){get(id).value=value;get(id).dispatch('input');},
    ctrlL(id,key='l',mod='ctrlKey'){const el=get(id);el.focus();el.dispatch('keydown',{key,[mod]:true});},
    change(id,value){get(id).value=value;get(id).dispatch('change');},
    key(id,extra){const el=get(id);el.focus();el.dispatch('keydown',{key:'a',code:'KeyA',keyCode:65,which:65,charCode:0,location:0,repeat:false,isComposing:false,ctrlKey:false,shiftKey:false,altKey:false,metaKey:false,...extra});},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}

const rows = p => p.get('tzc-results').querySelectorAll('.tzc-result').map(r => [r.dataset.zone, r.querySelector('.tzc-time').textContent, r.querySelector('.tzc-offset').textContent]);
const snapshot = p => ({base:p.get('tzc-base').value,source:p.get('tzc-source').value,add:p.get('tzc-add').value,status:p.get('tzc-status').textContent,rows:rows(p),copy:p.get('tzc-copy-all').textContent,share:p.get('tzc-share').textContent});
for (const lang of ['en','zh','ja','ko']) for (const order of ['shared-before','shared-after']) {
  const tag = lang+'/'+order, p=pageVM(lang,order), L=tzLabels(lang);
  eq(tag+' real Intl initial golden',rows(p),[['UTC','2026-10-01 12:00:00','UTC+00:00'],['Asia/Tokyo','2026-10-01 21:00:00','UTC+09:00']]);
  p.change('tzc-base','');
  eq(tag+' empty base clears rendered values',rows(p),[]);
  eq(tag+' empty base clears status',p.get('tzc-status').textContent,'');
  p.get('tzc-copy-all').click();eq(tag+' empty base cannot copy old summary',p.clipboard.length,0);
  p.change('tzc-base','2026-10-01T12:00:00');
  eq(tag+' valid time recovers both rows',rows(p).length,2);
  p.input('tzc-add','singapore');p.key('tzc-add',{key:'Enter',ctrlKey:true});
  eq(tag+' modified Enter adds once without error',p.get('tzc-status').textContent,'');
  eq(tag+' modified Enter preserves selected targets',rows(p).map(r=>r[0]),['UTC','Asia/Tokyo','Asia/Singapore']);
  const prefs=p.preferences();p.ctrlL('tzc-copy-all');await settle();
  eq(tag+' CtrlL clears base/add/results/status',[p.get('tzc-base').value,p.get('tzc-add').value,p.get('tzc-results').textContent,p.get('tzc-status').textContent],['','','','']);
  eq(tag+' CtrlL retains source and target preferences',[p.get('tzc-source').value,p.preferences()],['UTC',prefs]);
  eq(tag+' CtrlL focus survives result removal',p.doc.activeElement.id,'tzc-base');
  eq(tag+' shared clear still executes once',p.persistCalls.filter(c=>c[0]==='clear').length,1);
  p.get('tzc-copy-all').click();eq(tag+' CtrlL cannot copy stale summary',p.clipboard.length,0);
  p.change('tzc-base','2026-10-01T13:00:00');eq(tag+' settings recover after CtrlL',rows(p).map(r=>r[0]),['UTC','Asia/Tokyo','Asia/Singapore']);
  const q=pageVM(lang,order);q.input('tzc-add','mumbai');q.key('tzc-add',{key:'Enter'});eq(tag+' plain Enter still adds alias',rows(q).at(-1),['Asia/Kolkata','2026-10-01 17:30:00','UTC+05:30']);
  q.ctrlL('tzc-share','L','metaKey');await settle();eq(tag+' MetaL shares same clear behavior',[q.get('tzc-base').value,rows(q).length,q.get('tzc-status').textContent],['',0,'']);
}

// Typed names: a partial name matches the start of a word in the zone name, so an abbreviation such
// as EST or IST is rejected with "Unknown timezone." instead of picking America/Creston or
// America/Boa_Vista (the old substring match); kolkata and kyiv resolve although V8 lists
// Asia/Calcutta and Europe/Kiev.
for (const lang of ['en','zh','ja','ko']) {
  const L = tzLabels(lang);
  for (const [typed, zone] of [['york','America/New_York'],['los','America/Los_Angeles'],['paulo','America/Sao_Paulo'],['seoul','Asia/Seoul'],['kolkata','Asia/Kolkata'],['kyiv','Europe/Kyiv'],['america/new','America/New_York']]) {
    const q = pageVM(lang); q.input('tzc-add', typed); q.key('tzc-add', {key:'Enter'});
    eq(lang+' typed '+typed+' adds '+zone, [rows(q).at(-1)?.[0], q.get('tzc-status').textContent], [zone, '']);
  }
  for (const typed of ['EST','IST','PST','CST','北京','東京','서울','est']) {
    const q = pageVM(lang); const before = rows(q).map(r => r[0]); q.input('tzc-add', typed); q.key('tzc-add', {key:'Enter'});
    eq(lang+' typed '+typed+' is rejected', [rows(q).map(r => r[0]), q.get('tzc-status').textContent], [before, L.invalidZone]);
  }
}

// Copy uses complete real page output; only the clipboard Promise and timer delivery are controlled.
const failureLabels={en:'Copy failed.',zh:'复制失败。',ja:'コピーに失敗しました。',ko:'복사 실패.'};
const button=(p,id)=>id==='row'?p.get('tzc-results').querySelector('.tzc-copy'):p.get(id);
const feedback=p=>({status:p.get('tzc-status').textContent,className:p.get('tzc-status').className,copy:p.get('tzc-copy-all').textContent,share:p.get('tzc-share').textContent,rows:rows(p)});
for(const lang of ['en','zh','ja','ko']){
 const L=tzLabels(lang),tag=lang+'/copy';
 for(const id of ['tzc-copy-all','tzc-share','row']){
  const p=pageVM(lang),b=button(p,id),initial=b.textContent;b.click();const text=p.clipboard[0].value;
  eq(tag+'/'+id+' nonempty actual payload',text.length>0,true);
  if(id==='tzc-copy-all')eq(tag+' summary includes fixed real values',text.includes('2026-10-01T12:00:00 (UTC)')&&text.includes('Asia/Tokyo): 2026-10-01 21:00:00 · UTC+09:00'),true);
  if(id==='tzc-share')eq(tag+' share URL matches actual location',text,p.location.href);
  if(id==='row')eq(tag+' row payload matches complete row copy text',text,b.getAttribute('data-text'));
  p.clipboard[0].reject(Error('denied'));await settle();
  eq(tag+'/'+id+' current fallback false is visible failure',p.get('tzc-status').textContent,failureLabels[lang]);
  eq(tag+'/'+id+' failed fallback never marks Copied',b.textContent,initial);
  b.click();eq(tag+'/'+id+' direct retry uses unchanged bytes',p.clipboard[1].value,text);p.clipboard[1].resolve();await settle();
  eq(tag+'/'+id+' direct retry marks success',b.textContent,L.copied);
  eq(tag+'/'+id+' direct retry clears owned failure',p.get('tzc-status').textContent,'');
  p.tick(1500);eq(tag+'/'+id+' original button label restored',b.textContent,initial);
 }
 for(const success of [false,true]){
  const p=pageVM(lang,'shared-after',true),b=p.get('tzc-copy-all'),initial=b.textContent;p.fallback(success);b.click();
  eq(tag+'/API unavailable fallback '+success,p.get('tzc-status').textContent,success?'':failureLabels[lang]);
  eq(tag+'/API unavailable label '+success,b.textContent,success?L.copied:initial);
 }
 const boundaries={baseInput:p=>p.input('tzc-base','2026-10-01T13:00:00'),sourceInput:p=>p.input('tzc-source','Asia/Tokyo'),addInput:p=>p.input('tzc-add','mumbai'),newResult:p=>p.change('tzc-base','2026-10-01T13:00:00'),empty:p=>p.change('tzc-base',''),CtrlL:p=>p.ctrlL('tzc-copy-all')};
 for(const [name,invalidate]of Object.entries(boundaries))for(const completion of ['resolve','reject']){
  const p=pageVM(lang),b=p.get('tzc-copy-all');b.click();invalidate(p);await settle();const before=feedback(p),fallback=p.execCalls.length;
  p.clipboard[0][completion](completion==='reject'?Error('late denial'):undefined);await settle();
  eq(tag+'/'+name+'/'+completion+' late completion preserves current UI',feedback(p),before);
  eq(tag+'/'+name+'/'+completion+' no stale fallback',p.execCalls.length,fallback);
  p.tick(1500);eq(tag+'/'+name+'/'+completion+' late timer preserves current UI',feedback(p),before);
 }
 for(const completion of ['resolve','reject']){
  const p=pageVM(lang),old=button(p,'row');old.click();p.change('tzc-base','2026-10-01T13:00:00');const after=feedback(p),label=old.textContent;
  p.clipboard[0][completion](completion==='reject'?Error('detached'):undefined);await settle();eq(tag+'/detached row '+completion,feedback(p),after);eq(tag+'/detached label '+completion,old.textContent,label);eq(tag+'/detached no fallback '+completion,p.execCalls.length,0);
 }
 {
  const p=pageVM(lang),b=p.get('tzc-copy-all'),original=b.textContent;b.click();p.clipboard[0].resolve();await settle();p.tick(100);b.click();p.clipboard[1].resolve();await settle();p.tick(1400);eq(tag+'/old timer retains newest success',b.textContent,L.copied);p.tick(100);eq(tag+'/current timer restores original text',b.textContent,original);
 }
 for(const oldCompletion of ['resolve','reject']){
  const p=pageVM(lang),b=p.get('tzc-copy-all');b.click();b.click();p.clipboard[1].resolve();await settle();const latest=feedback(p);p.clipboard[0][oldCompletion](Error('old'));await settle();eq(tag+'/same output stale '+oldCompletion,feedback(p),latest);eq(tag+'/same output stale fallback '+oldCompletion,p.execCalls.length,0);
 }
 {
  const p=pageVM(lang),copy=p.get('tzc-copy-all');copy.click();p.clipboard[0].reject(Error('denied'));await settle();p.get('tzc-share').click();p.clipboard[1].resolve();await settle();eq(tag+'/other button success preserves owning error',p.get('tzc-status').textContent,failureLabels[lang]);copy.click();p.clipboard[2].resolve();await settle();eq(tag+'/own direct retry clears error',p.get('tzc-status').textContent,'');
  copy.click();p.input('tzc-source','Mars/Olympus');p.change('tzc-source','Mars/Olympus');p.clipboard[3].resolve();await settle();eq(tag+'/late success preserves true validation error',p.get('tzc-status').textContent,L.invalidZone);
 }
}
// No marked engine exists here; protect the existing real Intl conversion functions verbatim.
eq('unmarked Intl core byte length',Buffer.byteLength(source.slice(start,end)),4876);
eq('unmarked Intl core SHA',createHash('sha256').update(source.slice(start,end)).digest('hex'),'2f5fb452eb9901fbf8b2c08d4f4c067ce6e8ac0dc5fc4a282b420fd90448c813');

// ---------- v2 page layout ----------
const hash=value=>createHash('sha256').update(value).digest('hex');
const astroRequire=createRequire(require.resolve('astro/package.json'));
const compiled=await astroRequire('@astrojs/compiler').transform(source,{filename:join(root,'src/components/tools/TimezoneConverterTool.astro')});
eq('v2 Astro diagnostics',compiled.diagnostics.filter(d=>d.severity===1),[]);
let moduleError='';try{await require('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(error){moduleError=String(error);}
eq('v2 compiled module parses',moduleError,'');
const style=compiled.css.join('\n');
const mainScript=source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
eq('v2 complete FIX script exact',hash(mainScript),'406dda2a4f3f32e494c3482b5d477cb758e11cff99b3e3be9a9cc8fc9a9e27db');
eq('v2 analyze registry',/['"]timezone-converter['"]\s*:\s*['"]analyze['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')),true);
eq('v2 outermost root',/^<div class="tzc-wrap">/.test(source.split('\n---\n')[1].trim()),true);
eq('v2 no runtime i18n',source.includes('data-i18n'),false);
eq('v2 status follows all controls',source.indexOf('id="tzc-status"')>source.indexOf('id="tzc-share"'),true);
eq('v2 status precedes results',source.indexOf('id="tzc-status"')<source.indexOf('class="tzc-result-section"'),true);
for(const [name,re] of [
 ['root minimum',/\.tzc-wrap\s*\{[^}]*min-height:\s*0/],
 ['results fill bounded space',/\.tzc-results\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*0[^}]*overflow:\s*auto/],
 ['rows do not shrink',/\.tzc-result\s*\{[^}]*flex:\s*none/],
 ['fixed status',/#tzc-status\s*\{[^}]*height:\s*2\.8em[^}]*overflow:\s*auto/],
 ['860 empty pane hidden',/@media\s*\(max-width:\s*860px\)[\s\S]*?\.tzc-result-section:has\(\.tzc-results:empty\)\s*\{\s*display:\s*none/],
 ['640 compact height',/@media\s*\(max-width:\s*640px\)[\s\S]*?\.tzc-result-section\s*\{\s*height:\s*22rem/],
 ['44px primary controls',/\.tzc-actions \.btn-secondary\s*\{\s*min-height:\s*44px/],
])eq('v2 '+name,re.test(style),true);
const expectedTipKeys=['base','now','source','add','copy','share','results'];
const tipBindings={base:'baseTime',now:'now',source:'sourceZone',add:'addZone',copy:'copySummary',share:'shareLink',results:'targets'};
const originalLabelHashes={"en":"b520294f233fa5ed9d1ee9758f84ddd38d39b5eb58778530d873bc16327b2eb2","zh":"0cdc1955d6dca986420b982a078c2c32ca860e51422574d23e91923feac8b9b4","ja":"492f3bfad83cbcee1470aac434759a66057482bb6255d0f360daa5916d62ad45","ko":"be90df0197fd0f874914f349a071831fe1b46544222061b3d15c4c99e66ba2e5"};
for(const lang of ['en','zh','ja','ko']){
 const T=tzStrings(lang),L=tzLabels(lang),p=pageVM(lang);
 eq('v2 '+lang+' same seven fact groups',Object.keys(T.tips),expectedTipKeys);
 eq('v2 '+lang+' all original labels retained',hash(JSON.stringify(L)),originalLabelHashes[lang]);
 eq('v2 '+lang+' client excludes tips/empty',Object.keys(L).some(k=>k==='tips'||k==='emptyResult'),false);
 eq('v2 '+lang+' translated empty hint',p.get('tzc-empty-result').textContent,T.emptyResult);
 eq('v2 '+lang+' result keyboard focus',p.get('tzc-results').getAttribute('tabindex'),'0');
 eq('v2 '+lang+' results named',p.get('tzc-results').getAttribute('aria-label'),L.targets);
 for(const [key,label]of Object.entries(tipBindings)){
  eq('v2 '+lang+' '+key+' visible text',p.get('tzc-tip-'+key).textContent,T.tips[key]);
  eq('v2 '+lang+' '+key+' actual label',p.get('tzc-tip-'+key+'-trigger').textContent,L[label]);
 }
 for(const id of ['tzc-now','tzc-add-btn','tzc-copy-all','tzc-share'])eq('v2 '+lang+' retains '+id,p.get(id).tagName,'BUTTON');
 const content=readFileSync(join(root,'src/content/tools/timezone-converter/'+lang+'.mdx'),'utf8');
 const match=content.match(/^steps:\n((?:  - .*\n)+)/m);const steps=match?[...match[1].matchAll(/^  - (.*)$/gm)].map(m=>JSON.parse(m[1])):[];
 eq('v2 '+lang+' six bounded steps',steps.length===6&&steps.every(t=>t.length<=280)&&steps.join('').length<=1200,true);
 eq('v2 '+lang+' steps before FAQ',content.indexOf('steps:')<content.indexOf('faqItems:'),true);
 eq('v2 '+lang+' MDX content contract', contractProblems('timezone-converter', lang), '');
 for(const order of ['shared-before','shared-after']){
  const q=pageVM(lang,order);q.ctrlL('tzc-tip-results-trigger');await settle();
  eq('v2 '+lang+'/'+order+' result tip CtrlL clears values',[q.get('tzc-base').value,q.get('tzc-add').value,q.get('tzc-results').textContent],['','','']);
  eq('v2 '+lang+'/'+order+' result tip focus survives empty pane',q.doc.activeElement.id,'tzc-base');
  eq('v2 '+lang+'/'+order+' result tip shared storage clears',q.persistCalls.filter(c=>c[0]==='clear').length,1);
 }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
