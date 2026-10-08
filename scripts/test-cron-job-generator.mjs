// Cron Job Generator — field parsing, next runs in UTC and local time, day-field rule
//
// Read:  src/components/tools/CronJobGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/cron-job-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: parseField takes whole decimal numbers only (1.5, 5abc and the Quartz form 1#2 used to be
// read by parseInt as 1 or 5), a step needs * or a range before it (cronie get_range), names for
// months and weekdays; nextRuns in UTC matches a minute-by-minute reference that applies the
// cronie day rule (a day field starting with * does not restrict; when neither does, either field
// may match) for a set of expressions; the "UTC" list used to evaluate the schedule in the
// browser's time zone and only print it in UTC, so with TZ=Asia/Tokyo `0 9 * * 1-5` showed
// 00:00 UTC; local mode still evaluates in local time; the description says "or" when either day
// field may match; checkExpression accepts weekday 7 (cronie: 0 and 7 are Sunday; the typed
// expression used to reject it) and reports the field and value of the first bad field, which the
// page uses for the free-text Minute box (it used to be copied unchecked); 4-language
// exprErrorField; the next-run examples on the English page; analytics only on a committed change;
// step and range boxes keep the typed value (no clamping or swapping); tool pages: cjg-check worked
// examples in all four languages, typed into the real page (description, run times, messages).
//
// Run: node scripts/test-cron-job-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems, fencedBlocks, withoutCode } from './lib/tool-mdx-contract.mjs';

process.env.TZ = 'Asia/Tokyo';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CronJobGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/cron-job-generator/en.mdx'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CronJobGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { parseField, humanizeCron, nextRuns, checkExpression, MONTH_ABBR, WDAY_ABBR };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- parseField ----------
for (const bad of ['1.5', '5abc', '1#2', '5/10', '*/5abc', '1-2-3', 'L', '?', '', '*/0', '60', '3-1', '*/2/3']) {
  eq('minute field rejects ' + JSON.stringify(bad), E.parseField(bad, 0, 59, null, 0), null);
}
eq('*/15', E.parseField('*/15', 0, 59, null, 0), [0, 15, 30, 45]);
eq('1-10/3', E.parseField('1-10/3', 0, 59, null, 0), [1, 4, 7, 10]);
eq('list and range', E.parseField('30,0,5-7', 0, 59, null, 0), [0, 5, 6, 7, 30]);
eq('mon-fri', E.parseField('mon-fri', 0, 7, E.WDAY_ABBR, 0), [1, 2, 3, 4, 5]);
eq('jan,jul', E.parseField('jan,jul', 1, 12, E.MONTH_ABBR, 1), [1, 7]);
eq('monday is not a name', E.parseField('monday', 0, 7, E.WDAY_ABBR, 0), null);

// ---------- reference: minute by minute, cronie day rule ----------
function reference(expr, from, count) {
  const f = expr.split(' ');
  const [mins, hrs, doms, mons] = [
    E.parseField(f[0], 0, 59, null, 0), E.parseField(f[1], 0, 23, null, 0),
    E.parseField(f[2], 1, 31, null, 0), E.parseField(f[3], 1, 12, E.MONTH_ABBR, 1),
  ];
  const dows = E.parseField(f[4], 0, 7, E.WDAY_ABBR, 0).map((v) => (v === 7 ? 0 : v));
  const domStar = f[2][0] === '*';
  const dowStar = f[4][0] === '*';
  const out = [];
  let t = Math.floor(from / 60000) * 60000 + 60000;
  for (let i = 0; i < 6 * 366 * 1440 && out.length < count; i++, t += 60000) {
    const d = new Date(t);
    const domOk = doms.includes(d.getUTCDate());
    const dowOk = dows.includes(d.getUTCDay());
    const dayOk = domStar || dowStar ? domOk && dowOk : domOk || dowOk;
    if (mins.includes(d.getUTCMinutes()) && hrs.includes(d.getUTCHours()) && mons.includes(d.getUTCMonth() + 1) && dayOk) {
      out.push(d.toISOString());
    }
  }
  return out;
}

const FROM = Date.UTC(2026, 9, 1, 10, 0, 0); // Thursday 2026-10-01 10:00 UTC
for (const expr of [
  '0 9 * * 1-5', '*/15 * * * *', '0 0 1,15 * 1', '0 0 */2 * 1', '0 0 * * 1', '30 2 29 2 *',
  '0 12 1 jan,jul *', '5 4 * * sun', '0 0 31 * *', '0 */6 * * *', '0 8-17/3 * * mon-fri', '0 0 1-7 * 5',
]) {
  const runs = E.nextRuns(expr.split(' '), 10, true, FROM).map((d) => d.toISOString());
  const ref = reference(expr, FROM, 10); // a six-year window: fewer than 10 for 29 Feb
  eq('reference finds runs for ' + expr, ref.length >= 2, true);
  eq('UTC runs for ' + expr, runs.slice(0, ref.length), ref);
}
eq('never matches: empty list', E.nextRuns('0 0 30 2 *'.split(' '), 10, true, FROM), []);

// ---------- UTC list is evaluated in UTC, local list in local time ----------
eq('UTC: 0 9 * * 1-5 runs at 09:00 UTC',
  E.nextRuns('0 9 * * 1-5'.split(' '), 2, true, FROM).map((d) => d.toISOString()),
  ['2026-10-02T09:00:00.000Z', '2026-10-05T09:00:00.000Z']);
eq('local (Asia/Tokyo): 0 9 * * 1-5 runs at 09:00 JST = 00:00 UTC',
  E.nextRuns('0 9 * * 1-5'.split(' '), 2, false, FROM).map((d) => d.toISOString()),
  ['2026-10-02T00:00:00.000Z', '2026-10-05T00:00:00.000Z']);

// ---------- description ----------
eq('either day field: or', E.humanizeCron('0 0 1,15 * 1'.split(' ')), 'At midnight, on day 1, 15 of the month or on Monday');
eq('day field starts with *: and', /and on Monday$/.test(E.humanizeCron('0 0 */2 * 1'.split(' '))), true);
eq('weekdays 9', E.humanizeCron('0 9 * * 1-5'.split(' ')), 'At 9:00, on Monday through Friday');
// A day-of-month step used to read "on day every 2 days of the month"; the parser already drops
// "day " before "every …" (CronParserTool.astro humanizeCron).
for (const [expr, want] of [
  ['0 0 */2 * *', 'At midnight, on every 2 days of the month'],
  ['0 0 */2 * 1', 'At midnight, on every 2 days of the month and on Monday'],
  ['0 9 */3 * 1-5', 'At 9:00, on every 3 days of the month and on Monday through Friday'],
  ['0 0 */1 * */2', 'At midnight, on every 1 day of the month and on every 2 days of week'],
]) {
  eq('day step description ' + expr, E.humanizeCron(expr.split(' ')), want);
  eq('no "on day every" in ' + expr, / on day every /.test(E.humanizeCron(expr.split(' '))), false);
}
// Engine block guard: changed 2026-10-08 (S2-3c, approved) only in the three description lines
// above (", on day " → ", on " + "day " unless the day text starts with "every"); was b002beba….
{
  const { createHash } = await import('node:crypto');
  eq('engine block SHA-256', createHash('sha256').update(source.slice(startIndex, endIndex)).digest('hex'), 'a754f1902dfff4910e010ab76802218634433ef2789265cf0c1257056379f980');
}
eq('day list keeps "on day"', E.humanizeCron('0 0 1,15 * */2'.split(' ')), 'At midnight, on day 1, 15 of the month and on every 2 days of week');

// ---------- typed expression and the Minute box ----------
// cronie crontab(5): day of week 0–7, 0 or 7 is Sunday. The typed expression used to reject 7.
eq('weekday 7 accepted', E.checkExpression('0 9 * * 7').parts, ['0', '9', '*', '*', '7']);
eq('weekday range to 7', E.checkExpression('0 9 * * 5-7').parts, ['0', '9', '*', '*', '5-7']);
eq('weekday 8 rejected', E.checkExpression('0 9 * * 8'), { error: 'val', field: 4, value: '8' });
eq('minute 75 rejected with its field', E.checkExpression('75 * * * *'), { error: 'val', field: 0, value: '75' });
eq('four fields', E.checkExpression('* * * *'), { error: 'len' });
eq('extra spaces', E.checkExpression('  0  9 * * 1 ').parts, ['0', '9', '*', '*', '1']);
eq('7 and 0 run on the same days', E.nextRuns('0 9 * * 7'.split(' '), 3, true, Date.UTC(2026, 9, 1)).map((d) => d.toISOString()), E.nextRuns('0 9 * * 0'.split(' '), 3, true, Date.UTC(2026, 9, 1)).map((d) => d.toISOString()));
eq('5-7 means Friday to Sunday', E.nextRuns('0 9 * * 5-7'.split(' '), 3, true, Date.UTC(2026, 9, 1)).map((d) => d.getUTCDay()), [5, 6, 0]);
const stringsRegion = source.split('// strings:start')[1]?.split('// strings:end')[0];
if (!stringsRegion) throw Error('Missing SSR strings boundary');
const STR = new Function(stringsRegion + ';return STRINGS;')();
const SSR_STRINGS=STR;
for (const lang of ['en', 'zh', 'ja', 'ko']) eq(lang + ' has exprErrorField with placeholders', /\{field\}/.test(STR[lang].exprErrorField || '') && /\{value\}/.test(STR[lang].exprErrorField || ''), true);
eq('page no longer says 7 is rejected', page.includes('it rejects 7'), false);
eq('page no longer says the Minute box is copied as is', page.includes('without an error message'), false);

// ---------- English page examples ----------
for (const [expr, runs] of [
  ['0 9 * * 1-5', ['2026-10-02 09:00 UTC', '2026-10-05 09:00 UTC', '2026-10-06 09:00 UTC']],
  ['0 0 1,15 * 1', ['2026-10-05 00:00 UTC', '2026-10-12 00:00 UTC', '2026-10-15 00:00 UTC', '2026-10-19 00:00 UTC']],
  ['0 0 */2 * 1', ['2026-10-05 00:00 UTC', '2026-10-19 00:00 UTC', '2026-11-09 00:00 UTC']],
]) {
  const got = E.nextRuns(expr.split(' '), runs.length, true, FROM).map((d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC');
  eq('page runs for ' + expr, got, runs);
  eq('page shows runs for ' + expr, page.includes(runs.map((r) => '`' + r + '`').join(', ')), true);
  eq('page shows description for ' + expr, page.includes(E.humanizeCron(expr.split(' '))), true);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exitCode = failures ? 1 : 0;

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
const SLUG='cron-job-generator',component='src/components/tools/CronJobGeneratorTool.astro';
const templates={};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function lifecyclePage(lang='en',order='shared-after',noClipboard=false,saved={}){
  const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],downloads=[],urls=new Map(),tracks=[];let stored=structuredClone(saved);
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
  const labels=SSR_STRINGS;
  const chipSource=/const chipHtml = ([\s\S]*?)\n---/.exec(source)[1];
  const chips=Function('const chipHtml = '+chipSource+';return CHIP_HTML;')();
  const escaped=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  widget.innerHTML=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/(<div[^>]*?) set:html=\{CHIP_HTML\.(\w+)\}(><\/div>)/g,(_,open,key)=>open+'>'+chips[key]+'</div>').replace(/\{L\.tips\.(\w+)\}/g,(_,k)=>escaped(labels[lang]?.tips?.[k]??'')).replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(labels?.[lang]?.[k]??''));
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('#document-fragment');doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);throw Error('Native clipboard prohibited');};
  const persist={clear(slug){if(slug!=='cron-job-generator')stored={};persistCalls.push(['clear',slug]);},save(slug,data){stored=JSON.parse(JSON.stringify(data));persistCalls.push(['save',slug,stored]);},load(){return structuredClone(stored);}};
  const globals={CLIENT_T:Object.fromEntries(['copy','copied','copyFailed','nextLabelUtc','nextLabelLocal','exprErrorLen','exprErrorVal','exprErrorField','fieldMinute','fieldHour','fieldDay','fieldMonth','fieldWeekday'].map(k=>[k,SSR_STRINGS[lang][k]])),document:doc,Date:class extends Date{constructor(...a){super(...(a.length?a:['2026-10-05T08:00:00Z']));}static now(){return Date.parse('2026-10-05T08:00:00Z');}},Blob,crypto:webcrypto,URL:{createObjectURL(blob){const url='blob:probe-'+urls.size;urls.set(url,blob);return url;},revokeObjectURL(url){urls.delete(url);}},require(name){if(name==='../../data/gitignore-templates')return templates;throw Error('Unreviewed import '+name);},fetch(){throw Error('Network prohibited');},
    _slug:SLUG,ztPersist:persist,trackTool(...a){tracks.push(a);},
    navigator:noClipboard?{}:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:SLUG},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(component,{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,SLUG+' ID '+id);return el;};
  const errors=[];activePage={errors};
  return{errors,doc,get,widget,clipboard,timers,persistCalls,tracks,execCalls,downloads,stored:()=>structuredClone(stored),actual,
    input(id,value,event='input'){get(id).value=value;get(id).dispatch(event);},
    ctrlL(id,key='l',mod='ctrlKey'){const el=get(id);el.focus();el.dispatch('keydown',{key,[mod]:true});},
    choose(id,checked){get(id).checked=checked;get(id).dispatch('change');},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}

const LABELS={en:{copy:'Copy',copied:'Copied!',failed:'Copy failed',download:'Download'},zh:{copy:'复制',copied:'已复制！',failed:'复制失败',download:'下载'},ja:{copy:'コピー',copied:'コピー済み！',failed:'コピーに失敗しました',download:'ダウンロード'},ko:{copy:'복사',copied:'복사됨!',failed:'복사 실패',download:'다운로드'}};
const COPY='cjg-copy',INPUT='cjg-expr',DELAY=1800,ACTIONS=['CtrlL','new result','invalid'],CLEAR_STORE={expression:'0 9 * * 1-5'};
const output=p=>p.get(INPUT).value;
const settings=p=>[p.doc.querySelectorAll('.cjg-num').map(e=>[e.id,e.value]),p.doc.querySelectorAll('.cjg-mode-btn.active,.cjg-chip.active,.cjg-tz-btn.active').map(e=>[e.className,e.dataset])];
function ready(lang='en',order='shared-after',noClipboard=false){return lifecyclePage(lang,order,noClipboard);}
function act(p,action){if(action==='CtrlL')p.ctrlL(INPUT);else p.input(INPUT,action==='invalid'?'75 * * * *':'*/15 10 * * 1');}
const feedbackState=p=>[output(p),p.get(COPY).textContent,p.get(COPY).disabled,p.get('cjg-error').textContent,p.get('cjg-desc').textContent,p.get('cjg-next-list').textContent];
const empty=p=>output(p)===''&&p.get(COPY).disabled&&p.get('cjg-error').textContent===''&&p.get('cjg-desc').textContent===''&&p.get('cjg-next-list').textContent==='';
function restoreResult(p){p.input(INPUT,'*/15 10 * * 1');}
const recover=p=>output(p)==='*/15 10 * * 1'&&p.get('cjg-desc').textContent==='At every 15 minutes past 10, on Monday'&&p.get('cjg-next-list').children.filter(c=>c.tagName==='LI').length===10;
let p=ready();assert('actual default expression/description',[output(p),p.get('cjg-desc').textContent],['0 9 * * 1-5','At 9:00, on Monday through Friday']);assert('actual fixed-clock runs',[p.get('cjg-next-list').children.filter(c=>c.tagName==='LI').length,p.get('cjg-next-list').firstElementChild?.textContent],[10,'2026-10-05 09:00 UTC']);p.doc.querySelector('.cjg-btn-preset[data-expr="*/5 * * * *"]').click();assert('preset actual expression/first run',[output(p),p.get('cjg-next-list').firstElementChild?.textContent],['*/5 * * * *','2026-10-05 08:05 UTC']);restoreResult(p);assert('direct expression actual fields/description',recover(p),true);const minute=p.doc.querySelector('.cjg-field[data-field="minute"]');minute.querySelector('.cjg-mode-btn[data-mode="step"]').click();const step=minute.querySelector('[data-role="step"]');step.value='5';step.dispatch('input');assert('mode and numeric input rebuild',output(p),'*/5 10 * * 1');const hour=p.doc.querySelector('.cjg-field[data-field="hour"]');hour.querySelector('.cjg-chip[data-val="11"]').click();assert('actual delegated chip',output(p),'*/5 10,11 * * 1');p.input(INPUT,'75 * * * *');assert('invalid clears description/runs',[!!p.get('cjg-error').textContent,p.get('cjg-desc').textContent,p.get('cjg-next-list').textContent],[true,'','']);p.ctrlL(INPUT);assert('CtrlL clears prior validation error',empty(p),true);

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

const checkV2=(ok,name)=>assert(name,ok,true);
const equalV2=(actual,expected,name)=>assert(name,actual,expected);
// v2 SSR and generate layout contract. The original 72 assertions and all FIX lifecycle cases above remain active.
const markup=source.split(/<script\b/)[0],style=source.split('<style')[1]||'';
checkV2(/class="cjg-rail zt-rail"/.test(markup),'v2 shared generate rail');
checkV2(/grid-template-columns: 300px minmax\(0, 1fr\)/.test(style),'v2 rail width and bounded result column');
checkV2(/min-height: 2\.8em/.test(style),'v2 status space reserved');
checkV2(/max-width: 860px/.test(style)&&/max-width: 640px/.test(style),'v2 stack and phone breakpoints');
checkV2(/min-height: 44px/.test(style)&&/min-height: 24px; min-width: 24px/.test(style),'v2 main and dense touch sizes');
checkV2(/\.cjg-next-list \{[^}]*overflow: auto/.test(style),'v2 result list scrolls internally');
checkV2(/\.cjg-output\[data-empty="true"\] \{ display: none/.test(style),'v2 phone empty result hidden');
checkV2(!/\[data-i18n\]/.test(source),'v2 labels no runtime translation loop');
equalV2((markup.match(/<Toggletip /g)||[]).length,9,'v2 nine SSR tips');
equalV2((markup.match(/<details class="cjg-options">/g)||[]).length,2,'v2 two options disclosures default closed');
equalV2((markup.match(/data-expr=/g)||[]).length,8,'v2 all eight preset actions retained');
checkV2(!/Generate/.test(markup),'v2 automatic Cron keeps no Generate action');
const clientKeys=/const CLIENT_T = Object.fromEntries\(\[([^\]]+)\]/.exec(source)?.[1]||'';
checkV2(!clientKeys.includes('tips'),'v2 tips excluded from client data');
for(const lang of ['en','zh','ja','ko']){
 equalV2(Object.keys(SSR_STRINGS[lang].tips).length,9,lang+' nine localized tips');
 checkV2(Object.values(SSR_STRINGS[lang].tips).every(v=>typeof v==='string'&&v.length>0),lang+' tip text complete');
 const p=ready(lang);equalV2(p.get('cjg-result').getAttribute('data-empty'),'false',lang+' initial real result visible');
 equalV2(p.get('cjg-result-content').hidden,false,lang+' initial real content shown');equalV2(p.get('cjg-empty').hidden,true,lang+' initial empty hint hidden');
 equalV2(p.doc.querySelectorAll('.cjg-chip').length,74,lang+' 74 SSR chips bound to actual delegates');
 p.input(INPUT,'75 9 * * 1-5');equalV2(p.get('cjg-result').getAttribute('data-empty'),'true',lang+' invalid hides derived container');
 p.input(INPUT,'0 9 * * 1-5');equalV2(p.get('cjg-result').getAttribute('data-empty'),'false',lang+' valid restores derived container');
 for(const order of ['shared-before','shared-after']){const q=ready(lang,order);q.ctrlL(INPUT);equalV2(q.get('cjg-result').getAttribute('data-empty'),'true',lang+' '+order+' clear hides derived container');equalV2(q.get('cjg-result-content').hidden,true,lang+' '+order+' clear hides content');equalV2(q.get('cjg-empty').hidden,false,lang+' '+order+' desktop localized hint ready');}
 const md=readFileSync(join(root,'src/content/tools/cron-job-generator/'+lang+'.mdx'),'utf8');
 const block=/^steps:\n([\s\S]*?)(?=^faqItems:)/m.exec(md)?.[1]||'';
 const steps=block.split('\n').filter(x=>x.startsWith('  - ')).map(x=>JSON.parse(x.slice(4)));
 equalV2(steps.length,4,lang+' four usage steps before FAQ');checkV2(steps.every(v=>v.length<=280)&&steps.join('').length<=1200,lang+' usage limits');
 checkV2(!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(md),lang+' Usage removed from prose');
 if(lang==='en'){const words=md.replace(/^---[\s\S]*?---/, '').replace(/<[^>]*>/g,' ').replace(/[^\p{L}\p{N}'’]+/gu,' ').trim().split(/\s+/).length;checkV2(words>=400,'English prose retains 400 words');}
}
// ---------- S2-3c: analytics only on a committed change ----------
// The page used to send 'update' on load and on every input event (each keystroke in the
// expression box or the Minute box, each step of a number field).
{
  const updates=p=>p.tracks.filter(t=>t[1]==='update').length;
  let p=ready('en');
  assert('analytics: no event on load',updates(p),0);
  p.input(INPUT,'*/15 10 * * 1');assert('analytics: no event while typing the expression',updates(p),0);
  p.get(INPUT).dispatch('change');assert('analytics: one event when the typed expression is committed',updates(p),1);
  p.input(INPUT,'75 * * * *');p.get(INPUT).dispatch('change');assert('analytics: no event for an invalid committed expression',updates(p),1);
  p=ready('en');
  const minute=p.doc.querySelector('.cjg-field[data-field="minute"]');
  minute.querySelector('.cjg-mode-btn[data-mode="step"]').click();assert('analytics: mode button click sends one event',updates(p),1);
  const step=minute.querySelector('[data-role="step"]');step.value='10';step.dispatch('input');assert('analytics: no event on number input',updates(p),1);
  step.dispatch('change');assert('analytics: one event on number change',updates(p),2);
  p.doc.querySelector('.cjg-field[data-field="hour"] .cjg-chip[data-val="11"]').click();assert('analytics: chip click sends one event',updates(p),3);
  p.doc.querySelector('.cjg-btn-preset[data-expr="0 0 * * 0"]').click();assert('analytics: preset click sends one event',updates(p),4);
  p.doc.querySelector('.cjg-tz-btn[data-tz="local"]').click();assert('analytics: time zone click sends one event',updates(p),5);
  p.ctrlL(INPUT);assert('analytics: Ctrl+L sends no event',updates(p),5);
}

// Clicking a control that is already selected (same mode, same time zone, the preset that is
// already loaded) or committing the same text does not change the schedule: no event.
{
  const updates=p=>p.tracks.filter(t=>t[1]==='update').length;
  const p=ready('en');
  p.doc.querySelector('.cjg-field[data-field="minute"] .cjg-mode-btn[data-mode="specific"]').click();
  assert('analytics: re-clicking the selected mode sends no event',updates(p),0);
  p.doc.querySelector('.cjg-tz-btn[data-tz="utc"]').click();assert('analytics: re-clicking the selected time zone sends no event',updates(p),0);
  p.doc.querySelector('.cjg-btn-preset[data-expr="0 9 * * 1-5"]').click();assert('analytics: the preset already loaded sends no event',updates(p),0);
  p.get(INPUT).dispatch('change');assert('analytics: committing the same expression sends no event',updates(p),0);
  p.doc.querySelector('.cjg-tz-btn[data-tz="local"]').click();assert('analytics: a new time zone still sends one event',updates(p),1);
  p.doc.querySelector('.cjg-tz-btn[data-tz="utc"]').click();assert('analytics: switching back sends one more',updates(p),2);
}

// ---------- S2-3c: field controls do not change the value silently ----------
// Step and range values used to be clamped, swapped or replaced: step 0 became */1, step 75 in
// Minute became */59 (runs at :00 and :59 instead of :00), weekday step 7 became */6, hour
// range 17 to 9 became 9-17, hour range 9 to 30 became 9-23. Now the field gives what was typed
// and the expression check reports what is not valid.
{
  const field=(p,name)=>p.doc.querySelector('.cjg-field[data-field="'+name+'"]');
  const setNum=(p,name,role,value)=>{const el=field(p,name).querySelector('[data-role="'+role+'"]');el.value=value;el.dispatch('input');};
  const runs=p=>p.get('cjg-next-list').children.filter(c=>c.tagName==='LI').map(c=>c.textContent);
  let p=ready('en');p.doc.querySelector('.cjg-btn-preset[data-expr="* * * * *"]').click();
  field(p,'minute').querySelector('.cjg-mode-btn[data-mode="step"]').click();
  setNum(p,'minute','step','0');
  assert('step 0 is reported, not replaced by 1',[output(p),p.get('cjg-error').textContent,p.get('cjg-desc').textContent],['*/0 * * * *','Minute: "*/0" is not valid. Use numbers from 0 to 59, *, -, / and commas.','']);
  setNum(p,'minute','step','1.5');assert('step 1.5 is reported, not read as 1',output(p),'*/1.5 * * * *');
  setNum(p,'minute','step','75');
  assert('step 75 in Minute stays 75 (runs once an hour at :00)',[output(p),p.get('cjg-error').textContent,runs(p).slice(0,2)],['*/75 * * * *','',['2026-10-05 09:00 UTC','2026-10-05 10:00 UTC']]);
  p=ready('en');p.doc.querySelector('.cjg-btn-preset[data-expr="* * * * *"]').click();
  field(p,'hour').querySelector('.cjg-mode-btn[data-mode="range"]').click();
  setNum(p,'hour','from','17');setNum(p,'hour','to','9');
  assert('reversed hour range is reported, not swapped',[output(p),p.get('cjg-error').textContent],['* 17-9 * * *','Hour: "17-9" is not valid. Use numbers from 0 to 23, *, -, / and commas.']);
  setNum(p,'hour','from','9');setNum(p,'hour','to','30');
  assert('hour range end 30 is reported, not clamped to 23',[output(p),!!p.get('cjg-error').textContent],['* 9-30 * * *',true]);
  setNum(p,'hour','to','17');assert('valid range recovers',[output(p),p.get('cjg-error').textContent,p.get('cjg-desc').textContent],['* 9-17 * * *','','At every minute past 9 through 17']);
  p=ready('en');p.input(INPUT,'*/75 * * * *');
  assert('typed */75 keeps its schedule (first runs 09:00 and 10:00 UTC)',[output(p),runs(p).slice(0,2),p.get('cjg-desc').textContent],['*/75 * * * *',['2026-10-05 09:00 UTC','2026-10-05 10:00 UTC'],'At every 75 minutes past every hour']);
  p=ready('en');p.input(INPUT,'0 9 * * */7');
  assert('typed weekday */7 runs on Sundays only',[runs(p).slice(0,2)],[['2026-10-11 09:00 UTC','2026-10-18 09:00 UTC']]);
}

// ---------- S2-3c review: an invalid expression cannot be copied ----------
// The copy button stayed enabled for an invalid expression (typed or built from the field
// controls) and copied it; the description and run list were already cleared.
{
  let p=ready('en');
  p.input(INPUT,'75 * * * *');
  assert('invalid typed expression: copy disabled, result cleared',[p.get(COPY).disabled,p.get('cjg-desc').textContent,p.get('cjg-next-list').textContent],[true,'','']);
  let n=p.clipboard.length;p.get(COPY).click();assert('invalid typed expression: nothing copied',p.clipboard.length,n);
  p.input(INPUT,'0 9 * * 1-5');assert('valid expression re-enables copy',[p.get(COPY).disabled,p.get('cjg-desc').textContent],[false,'At 9:00, on Monday through Friday']);
  p.input(INPUT,'0 9 * *');assert('wrong field count: copy disabled',p.get(COPY).disabled,true);
  p=ready('en');
  const minute=p.doc.querySelector('.cjg-field[data-field="minute"]');
  minute.querySelector('.cjg-mode-btn[data-mode="step"]').click();
  const step=minute.querySelector('[data-role="step"]');step.value='0';step.dispatch('input');
  assert('invalid field value: copy disabled, result cleared',[output(p),p.get(COPY).disabled,p.get('cjg-desc').textContent,p.get('cjg-next-list').textContent],['*/0 9 * * 1-5',true,'','']);
  n=p.clipboard.length;p.get(COPY).click();assert('invalid field value: nothing copied',p.clipboard.length,n);
  step.value='5';step.dispatch('input');assert('fixed field value re-enables copy',[output(p),p.get(COPY).disabled],['*/5 9 * * 1-5',false]);
}

// ---------- tool pages: cjg-check worked examples (S2-3c) ----------
// {/* cjg-check: {"expr","from","utc","tz","runs","error"} */} or {"from","utc","tz","cases":[{...}]}
// (case keys override the outer ones; "utc" defaults to true). The expression is typed into the
// real page (lifecycle harness): for a valid one, the page's description must equal the engine's
// description of the typed fields (so the field controls did not rewrite it) and must appear in
// code after the comment, with the first `runs` run times from the instant `from` (exclusive):
// `YYYY-MM-DD HH:MM UTC` as the page prints in UTC mode, or `YYYY-MM-DD HH:MM` in time zone `tz`
// for Local mode (the page itself prints the browser's date format plus the zone name). For an
// invalid one ("error": true is required) the page's error text must appear. "In code" means a line
// of a code block or an inline code span, up to the next cjg-check or H2.
{
  const codeSpans = (text) => {
    const out = [];
    for (const b of fencedBlocks(text)) out.push(...b.text.split('\n').map((l) => l.trim()));
    for (const m of withoutCode(text).matchAll(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)) out.push(m[2].trim());
    return out;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const savedTz = process.env.TZ;
  const covered = { en: [], zh: [], ja: [], ko: [] };
  const expected = (c, lang) => {
    const p = ready(lang);
    p.input(INPUT, c.expr);
    const err = p.get('cjg-error').textContent, desc = p.get('cjg-desc').textContent;
    const checked = E.checkExpression(c.expr);
    if (checked.error) return c.error ? (err ? [err] : { problem: c.expr + ': the page shows no error' }) : { problem: c.expr + ' is invalid: ' + err };
    if (c.error) return { problem: c.expr + ' is valid but the annotation expects an error' };
    const engineDesc = E.humanizeCron(checked.parts);
    if (desc !== engineDesc) return { problem: c.expr + ': the page describes it as "' + desc + '", the typed fields give "' + engineDesc + '"' };
    const utc = c.utc !== false;
    process.env.TZ = utc ? 'UTC' : c.tz;
    const runs = E.nextRuns(checked.parts, c.runs || 0, utc, Date.parse(c.from)).map((d) => utc
      ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()));
    process.env.TZ = savedTz;
    return (c.desc === false ? [] : [desc]).concat(runs);
  };
  const verify = ({ spec, after, lang }) => {
    const cases = spec.cases ? spec.cases.map((c) => ({ from: spec.from, utc: spec.utc, tz: spec.tz, ...c })) : [spec];
    const shown = codeSpans(after);
    for (const c of cases) {
      const want = expected(c, lang);
      if (want.problem) return want.problem;
      for (const w of want) {
        if (!shown.includes(w)) return c.expr + ': "' + w + '" is not shown in code after the annotation';
        covered[lang].push(w);
      }
    }
    return null;
  };
  const opts = { annotations: [{ tag: 'cjg-check', min: 2, verify }] };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    assert('cjg-check ' + lang + ' MDX contract and worked examples', contractProblems(SLUG, lang, opts), '');
    const body = readFileSync(join(root, 'src/content/tools/cron-job-generator', lang + '.mdx'), 'utf8').split(/^---$/m).slice(2).join('---');
    const loose = codeSpans(body).filter((x) => /^At |^\d{4}-\d\d-\d\d \d\d:\d\d/.test(x) && !covered[lang].includes(x));
    assert('cjg-check ' + lang + ' every description and run time in code is recomputed', loose, []);
  }
  process.env.TZ = savedTz;
}
// Every Markdown table in the four MDX files is rendered as one table with the same number of
// body rows (a blank line after the separator row used to end the table, and the rows became a
// paragraph). Reads the built pages: run after `npm run build`.
{
  const { existsSync } = await import('node:fs');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const html = join(root, 'dist', ...(lang === 'en' ? [] : [lang]), 'tools', 'cron-job-generator', 'index.html');
    if (!existsSync(html)) { assert('built page exists for the table check: ' + lang + ' (run npm run build first)', false, true); continue; }
    const page = readFileSync(html, 'utf8');
    const text = readFileSync(join(root, 'src/content/tools/cron-job-generator', lang + '.mdx'), 'utf8');
    const body = text.slice(text.indexOf('\n---\n', 4) + 5);
    let heading = '', tables = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const h = /^##\s+(.+?)\s*$/.exec(lines[i]) || /^<h2>(.+?)<\/h2>$/.exec(lines[i]);
      if (h) heading = h[1];
      if (/^\|/.test(lines[i]) && /^\|[-| :]+\|$/.test(lines[i + 1] || '')) {
        let rows = 0, j = i + 2;
        // count data rows up to the first line that is not a table row (blank lines included)
        for (; j < lines.length && lines[j].trim() !== ''; j++) if (/^\|/.test(lines[j])) rows++;
        // rows written after a blank line are the defect this check catches
        let stray = 0;
        for (let k = j; k < lines.length && !/^##\s|^<h2>/.test(lines[k]); k++) if (/^\| `/.test(lines[k])) stray++;
        tables.push({ heading, rows: rows + stray });
        i = j;
      }
    }
    for (const t of tables) {
      const at = page.indexOf('>' + t.heading + '</h2>');
      const table = at < 0 ? '' : (page.slice(at).match(/<table[\s\S]*?<\/table>/) || [''])[0];
      const rendered = (table.match(/<tbody>[\s\S]*?<\/tbody>/) || [''])[0].split('<tr').length - 1;
      assert('built ' + lang + ' table under "' + t.heading + '" has all ' + t.rows + ' rows', rendered, t.rows);
    }
  }
}
// The four MDX files compile (an annotation that contains */ ends the MDX comment early).
{
  const mdx = await import(requireFromRoot.resolve('@mdx-js/mdx'));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const text = readFileSync(join(root, 'src/content/tools/cron-job-generator', lang + '.mdx'), 'utf8');
    let error = '';
    try { await mdx.compile(text.slice(text.indexOf('\n---\n', 4) + 5)); } catch (e) { error = String(e.message || e); }
    assert('cron-job-generator ' + lang + ' MDX compiles', error, '');
  }
}

console.log(`v2 total: ${passes} PASS, ${failures} FAIL`);process.exitCode=failures?1:0;
