// CSV ↔ JSON — JSON → CSV output for nested values, arrays and null; CSV parsing regression test
//
// Read:  src/components/tools/CsvJsonTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Also reads ToolLayout.astro and executes the real page with controlled DOM/time/clipboard.
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: jsonToCsv — nested objects become dot-path columns (no "[object Object]"), deep
// nesting, arrays written as JSON text, null / undefined / missing keys as empty fields, empty
// objects as {}, columns are the union of all rows in first-seen order, booleans and numbers,
// RFC 4180 quoting (comma, quote, LF, CR), input validation (not an array, empty array,
// non-object items with their index); parseCsv / inferValue round trip of the flattened output.
//
// Run: node scripts/test-csv-json.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadPage, readComponent, frontmatterStrings } from './astro-page-harness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CsvJsonTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CsvJsonTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { jsonToCsv, parseCsv, inferValue, escapeCsvField };')();

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
function throws(name, fn, pattern) {
  try { fn(); check(name, false, 'did not throw'); }
  catch (e) { check(name, pattern.test(e.message), 'message: ' + e.message); }
}
const csv = (data) => E.jsonToCsv(data);

// ---------- the reported defect: nested objects ----------
const nested = [{ id: 1, user: { name: 'Alice', city: 'London' } }];
check('no [object Object]', !csv(nested).includes('[object Object]'), csv(nested));
eq('nested object → dot-path columns', csv(nested), 'id,user.name,user.city\n1,Alice,London');
eq('deep nesting', csv([{ a: { b: { c: 1 } } }]), 'a.b.c\n1');

// ---------- arrays, null, empty objects ----------
eq('array → JSON text', csv([{ tags: ['x', 'y'] }]), 'tags\n"[""x"",""y""]"');
eq('array of objects → JSON text', csv([{ items: [{ sku: 'A1' }] }]), 'items\n"[{""sku"":""A1""}]"');
eq('empty array → []', csv([{ tags: [] }]), 'tags\n[]');
eq('array inside nested object', csv([{ a: { tags: [1, 2] } }]), 'a.tags\n"[1,2]"');
eq('null → empty field', csv([{ a: null, b: 1 }]), 'a,b\n,1');
eq('nested null → empty field', csv([{ a: { b: null } }]), 'a.b\n');
eq('empty object → {}', csv([{ meta: {} }]), 'meta\n{}');
eq('booleans and numbers', csv([{ ok: true, no: false, n: 1.5, z: 0 }]), 'ok,no,n,z\ntrue,false,1.5,0');
eq('empty string', csv([{ a: '' }]), 'a\n');

// ---------- columns: union of all rows, first-seen order ----------
eq('key only in later row is exported', csv([{ a: 1 }, { a: 2, b: 3 }]), 'a,b\n1,\n2,3');
eq('nested keys differ per row', csv([{ u: { a: 1 } }, { u: { b: 2 } }]), 'u.a,u.b\n1,\n,2');
eq('missing nested object → empty', csv([{ id: 1, u: { a: 1 } }, { id: 2 }]), 'id,u.a\n1,1\n2,');
eq('object in one row, scalar in another', csv([{ u: { a: 1 } }, { u: 'x' }]), 'u.a,u\n1,\n,x');

// ---------- RFC 4180 quoting ----------
eq('comma quoted', csv([{ a: 'x,y' }]), 'a\n"x,y"');
eq('quote doubled', csv([{ a: 'say "hi"' }]), 'a\n"say ""hi"""');
eq('LF quoted', csv([{ a: 'l1\nl2' }]), 'a\n"l1\nl2"');
eq('CR quoted', csv([{ a: 'l1\rl2' }]), 'a\n"l1\rl2"');
eq('header with comma quoted', csv([{ 'x,y': 1 }]), '"x,y"\n1');

// ---------- validation ----------
throws('not an array', () => csv({ a: 1 }), /array/i);
throws('empty array', () => csv([]), /empty/i);
throws('first item not an object', () => csv([1]), /item 1/i);
throws('later item is an array', () => csv([{ a: 1 }, [1]]), /item 2/i);
throws('later item is null', () => csv([{ a: 1 }, null]), /item 2/i);

// ---------- round trip through the CSV parser ----------
const out = csv([{ id: 7, user: { name: 'Bob, Jr.', tags: ['a'] }, note: null }]);
const parsed = E.parseCsv(out);
eq('round trip header', parsed.rows[0], ['id', 'user.name', 'user.tags', 'note']);
eq('round trip values', parsed.rows[1], ['7', 'Bob, Jr.', '["a"]', '']);

eq('engine byte protection', createHash('sha256').update(source.slice(source.indexOf('      '+START_MARK), source.indexOf('      '+END_MARK)+'      '.length+END_MARK.length)).digest('hex'), 'e87896cdb21292ad09516b68bb49503cf2f8bcbeaf541ff70eae2056298d7b32');

// ---------- full page lifecycle: real IIFE and actual shared keydown ----------
// DOM, clipboard promises and time are controlled boundaries; conversion code is real.
const sharedSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shared = sharedSource.slice(sharedSource.indexOf("document.addEventListener('keydown'", sharedSource.indexOf('// ── Keyboard shortcuts')), sharedSource.indexOf('// ── Copy button visual feedback'));
const unhandled = [];
const onUnhandled = e => unhandled.push(String(e));
process.on('unhandledRejection', onUnhandled);
const settle = () => new Promise(resolve => setImmediate(resolve));
const copyFailures = { en: 'Copy failed', zh: '复制失败', ja: 'コピー失敗', ko: '복사 실패' };
const s = {"slug": "csv-json", "file": "CsvJsonTool", "p": "cj", "left": "cj-csv", "right": "cj-json", "input": "n\n1", "expected": "[\n  {\n    \"n\": 1\n  }\n]", "copy": ["cj-copy-csv", "cj-copy-json"], "delay": 300};
function page(lang='en', order='shared-after') {
  const rel='src/components/tools/'+s.file+'.astro', comp=readComponent(rel), source=comp.src;
  const strings=frontmatterStrings(comp.frontmatter)?.[lang];
  const nodes=[], byId=new Map(), docs={}, jobs=new Map(), copies=[], tracks=[], cleared=[];
  let now=0,seq=0,doc;
  function el(tag='div', attrs={}) {
    const events={}; let text='';
    const e={tagName:tag.toUpperCase(),id:attrs.id||'',attributes:attrs,value:attrs.value||'',checked:'checked' in attrs,disabled:'disabled' in attrs,hidden:'hidden'in attrs,className:attrs.class||'',dataset:{},style:{},children:[],files:[],
      get textContent(){return text;},set textContent(v){text=String(v);this.children=[];},
      getAttribute(n){return this.attributes[n]??null;},setAttribute(n,v){this.attributes[n]=String(v);},removeAttribute(n){delete this.attributes[n];},
      addEventListener(k,fn){(events[k]??=[]).push(fn);},dispatchEvent(event){return this.fire(event.type,event);},
      fire(k,init={}){const ev={type:k,target:this,currentTarget:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...init};for(const fn of events[k]||[])fn.call(this,ev);if(k==='keydown'&&!ev.stopped)for(const fn of docs[k]||[])fn(ev);return ev;},
      click(){if(!this.disabled)this.fire('click');},focus(){doc.activeElement=this;},appendChild(c){this.children.push(c);return c;},remove(){},querySelectorAll(sel){return queryAll(sel);},contains(other){return nodes.includes(other);}
    };
    for(const [k,v]of Object.entries(attrs))if(k.startsWith('data-'))e.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=v;
    e.classList={contains:c=>e.className.split(/\s+/).includes(c),add(...cs){e.className=[...new Set([...e.className.split(/\s+/).filter(Boolean),...cs])].join(' ');},remove(...cs){e.className=e.className.split(/\s+/).filter(x=>!cs.includes(x)).join(' ');},toggle(c,v){v=v??!this.contains(c);if(v)this.add(c);else this.remove(c);}};
    return e;
  }
  const markup=source.slice(source.indexOf('\n---',4)+4,source.indexOf('<script'));
  for(const m of markup.matchAll(/<(div|span|input|textarea|select|button|label)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/g)){
    const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{[^}]*\}))?/g))attrs[a[1]]=a[2]??a[3]??'';
    const e=el(m[1],attrs), tail=markup.slice(m.index+m[0].length);
    if(m[1]==='select')e.value=/<option\b[^>]*value="([^"]*)"/.exec(tail)?.[1]||'';
    if(['button','span'].includes(m[1])){let text=tail.split('<')[0];if(strings)text=text.replace(/\{T\.(\w+)\}/g,(_,k)=>strings[k]);e.textContent=text;}
    nodes.push(e);if(e.id)byId.set(e.id,e);
  }
  function queryAll(sel){if(sel==='textarea, input[type="text"]')return nodes.filter(e=>e.tagName==='TEXTAREA'||e.tagName==='INPUT'&&e.attributes.type==='text');if(sel.includes('[data-i18n]'))return nodes.filter(e=>'data-i18n'in e.attributes);if(sel.startsWith('.'))return nodes.filter(e=>e.classList.contains(sel.slice(1)));throw Error('unsupported selector '+sel);}
  const get=id=>{if(!byId.has(id))throw Error('missing actual markup id '+id);return byId.get(id);};
  const widget=el();doc={documentElement:{lang},body:el('body'),activeElement:null,getElementById:get,querySelector(sel){if(sel==='.tool-widget')return widget;if(sel==='.tool-widget .btn-primary')return nodes.find(e=>e.classList.contains('btn-primary'))||null;return queryAll(sel)[0]||null;},querySelectorAll:queryAll,createElement:el,addEventListener(k,fn){(docs[k]??=[]).push(fn);},execCommand(){throw Error('native clipboard forbidden');}};doc.activeElement=doc.body;
  if(strings){const root=doc.querySelector('.cj-wrap');const {tips,...client}=strings;root.dataset={strings:JSON.stringify(client),lang};}
  const setTimeout=(fn,ms=0)=>{const id=++seq;jobs.set(id,{id,fn,ms,due:now+ms});return id;};
  const globals={document:doc,Event:class{constructor(type){this.type=type;}},setTimeout,clearTimeout:id=>jobs.delete(id),trackTool:(...a)=>tracks.push(a),ztPersist:{clear:slug=>cleared.push(slug)},
    navigator:{clipboard:{writeText(text){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});copies.push({text,resolve,reject});return promise;}}}};
  const addShared=()=>vm.runInNewContext(shared,{document:doc,window:globals,_slug:s.slug});
  if(order==='shared-before')addShared();loadPage(rel,{lang,globals});if(order==='shared-after')addShared();
  function advance(ms){const end=now+ms;for(let i=0;i<100;i++){const next=[...jobs.values()].filter(j=>j.due<=end).sort((a,b)=>a.due-b.due||a.id-b.id)[0];if(!next)break;jobs.delete(next.id);now=next.due;next.fn();}now=end;}
  return {get,doc,copies,tracks,cleared,jobs,advance,navigator:globals.navigator,type(id,value){get(id).value=value;get(id).fire('input');},key(id,key='l',mod='ctrlKey'){get(id).focus();return get(id).fire('keydown',{key,[mod]:true});},clear(){get(s.p+'-clear').click();},golden(){this.type(s.left,s.input);advance(s.delay);},state(){return {left:get(s.left).value,right:get(s.right).value,status:get(s.p+'-status').textContent,statusClass:get(s.p+'-status').className,copy:s.copy.map(id=>({id,label:get(id).textContent,disabled:get(id).disabled}))};}};
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const order of ['shared-before', 'shared-after']) {
    const p = page(lang, order); p.golden();
    eq(lang + order + ' real conversion', p.get(s.right).value, s.expected);
    p.type(s.left, 'n\n2'); p.key(s.right, 'L', 'metaKey');
    eq(lang + order + ' CtrlL clears synchronously', [p.get(s.left).value, p.get(s.right).value, p.get(s.p+'-status').textContent], ['', '', '']);
    eq(lang + order + ' CtrlL moves focus to stable input', p.doc.activeElement.id, s.left);
    eq(lang + order + ' shared storage clear runs once', p.cleared, [s.slug]);
    check(lang + order + ' cancels queued conversion', ![...p.jobs.values()].some(j => j.ms === 300));
    p.advance(300); eq(lang + order + ' no late result', p.get(s.right).value, '');
    p.golden(); const before = p.state(); p.doc.body.focus(); p.doc.body.fire('keydown', {key:'l',ctrlKey:true});
    eq(lang + order + ' outside CtrlL leaves state', p.state(), before);
    p.key(s.left, 'l', 'shiftKey'); eq(lang + order + ' unmodified L leaves state', p.state(), before);
  }
  for (const id of s.copy) {
    let p = page(lang); p.golden(); const base = p.get(id).textContent;
    p.get(id).click(); const expected = id === s.copy[0] && s.copy.length === 2 ? s.input : s.expected;
    eq(lang + id + ' complete copied bytes', p.copies.at(-1).text, expected);
    const rejectedBefore = unhandled.length; p.copies.at(-1).reject(Error('clipboard denied')); await settle();
    eq(lang + id + ' current rejection handled', unhandled.length, rejectedBefore);
    eq(lang + id + ' failure visible in locale', p.get(id).textContent, copyFailures[lang]);
    const status = p.get(s.p+'-status').textContent;
    p.get(id).click(); p.copies.at(-1).resolve(); await settle();
    check(lang + id + ' same-output direct retry succeeds', p.get(id).textContent !== base && p.get(id).textContent !== copyFailures[lang]);
    eq(lang + id + ' retry preserves conversion status', p.get(s.p+'-status').textContent, status);
    eq(lang + id + ' retry copies unchanged bytes', p.copies.at(-1).text, expected);
    for (const mode of ['unavailable', 'throw']) {
      p = page(lang); p.golden(); if (mode === 'unavailable') p.navigator.clipboard = undefined;
      else p.navigator.clipboard.writeText = () => { throw Error('clipboard blocked'); };
      let escaped = false; try { p.get(id).click(); } catch { escaped = true; }
      eq(lang + id + mode + ' does not throw', escaped, false);
      eq(lang + id + mode + ' visible failure', p.get(id).textContent, copyFailures[lang]);
    }
    for (const action of ['clear', 'CtrlL', 'same-input', 'new-input', 'new-output']) for (const outcome of ['resolve', 'reject']) {
      p = page(lang); p.golden(); p.get(id).click(); const old = p.copies.at(-1);
      if (action === 'clear') p.clear();
      else if (action === 'CtrlL') p.key(s.right);
      else if (action === 'same-input') p.type(s.left, s.input);
      else if (action === 'new-input') p.type(s.left, 'n\n2');
      else { p.get('cj-parse-types').fire('change'); p.advance(300); }
      const snapshot = p.state(), errors = unhandled.length;
      old[outcome](outcome === 'reject' ? Error('stale clipboard failure') : undefined); await settle();
      eq(lang + id + action + outcome + ' stale completion leaves current UI', p.state(), snapshot);
      eq(lang + id + action + outcome + ' no unhandled rejection', unhandled.length, errors);
    }
    for (const outcome of ['resolve', 'reject']) for (const order of ['old-first', 'new-first']) {
      p = page(lang); p.golden(); p.get(id).click(); const old = p.copies.at(-1);
      p.get(id).click(); const current = p.copies.at(-1);
      if (order === 'new-first') { current.resolve(); await settle(); }
      const snapshot = p.state(), errors = unhandled.length;
      old[outcome](outcome === 'reject' ? Error('old request failed') : undefined); await settle();
      eq(lang + id + order + outcome + ' same text old request cannot update label', p.state(), snapshot);
      eq(lang + id + order + outcome + ' old reject handled', unhandled.length, errors);
      if (order === 'old-first') { current.resolve(); await settle(); }
      check(lang + id + order + outcome + ' current copy succeeds', p.get(id).textContent !== base && p.get(id).textContent !== copyFailures[lang]);
    }
    p = page(lang); p.golden(); p.get(id).click(); p.copies.at(-1).resolve(); await settle();
    p.advance(100); p.get(id).click(); p.copies.at(-1).resolve(); await settle();
    const copied = p.get(id).textContent; p.advance(1400);
    eq(lang + id + ' first timer cannot erase second feedback', p.get(id).textContent, copied);
    p.advance(100); eq(lang + id + ' current timer restores label', p.get(id).textContent, base);
    p = page(lang); p.golden(); p.get(id).click(); p.copies.at(-1).resolve(); await settle();
    p.advance(100); p.get(id).click(); p.copies.at(-1).reject(Error('current failure')); await settle();
    p.advance(1400); eq(lang + id + ' old success timer cannot hide current failure', p.get(id).textContent, copyFailures[lang]);
  }
}
await settle(); process.removeListener('unhandledRejection', onUnhandled);

for (const lang of ['en','zh','ja','ko']) {
  for (const direction of ['left','right']) for (const mode of ['live','superseded-queue']) for (const value of ['', '{']) {
    const p=page(lang);p.golden();const input=direction==='left'?s.left:s.right,output=direction==='left'?s.right:s.left;
    if(mode==='superseded-queue')p.type(output,direction==='left'?'[{"n":2}]':'n\n2');p.type(input,value);p.advance(300);
    eq(lang+direction+mode+value+' empty/error removes derived output',p.get(output).value,'');
    if(!value)eq(lang+direction+mode+' empty clears status',p.get('cj-status').textContent,'');
    else check(lang+direction+mode+' invalid shows error',p.get('cj-status').classList.contains('error'));
    p.golden();eq(lang+direction+mode+' recovery',p.get(s.right).value,s.expected);
  }
  for(const direction of ['left','right']) {
    const p=page(lang); const json='[ { "n" : 2 } ]';
    if(direction==='right'){p.type(s.left,s.input);p.advance(50);p.type(s.right,json);p.advance(300);eq(lang+' latest JSON source bytes stay exact',p.get(s.right).value,json);eq(lang+' JSON wins queue',p.get(s.left).value,'n\n2');}
    else{p.type(s.right,json);p.advance(50);p.type(s.left,s.input);p.advance(300);eq(lang+' latest CSV source stays exact',p.get(s.left).value,s.input);eq(lang+' CSV wins queue',p.get(s.right).value,s.expected);}
  }
  const p=page(lang);p.golden();p.get('cj-parse-types').checked=false;p.get('cj-parse-types').fire('change');p.advance(300);eq(lang+' parse type option preserved',JSON.parse(p.get(s.right).value),[{n:'1'}]);
  p.type(s.left,'n,z\n,x');p.get('cj-empty-null').checked=true;p.get('cj-empty-null').fire('change');p.advance(300);eq(lang+' empty null option preserved',JSON.parse(p.get(s.right).value),[{n:null,z:'x'}]);p.clear();eq(lang+' Clear preserves settings',[p.get('cj-parse-types').checked,p.get('cj-empty-null').checked],[false,true]);
  p.type(s.left,s.input);p.key(s.left,'Enter');eq(lang+' CtrlEnter leaves pending automatic output empty',p.get(s.right).value,'');p.advance(300);eq(lang+' queued conversion still uses preserved settings',JSON.parse(p.get(s.right).value),[{n:'1'}]);
}


/* ── v2 page layout ── */
const hash = text => createHash('sha256').update(text).digest('hex');
const requireRoot = createRequire(join(root, 'package.json'));
const allStrings = frontmatterStrings(readComponent('src/components/tools/CsvJsonTool.astro').frontmatter);
const markupSource = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = source.slice(source.indexOf('<script is:inline>') + '<script is:inline>'.length, source.indexOf('</script>'));
eq('reviewed FIX script preserves all bytes except i18n and removed buttons', hash(script), 'ccd9c3d1b1ceff5c8be3690b26ef920c98877ede09057e505418d17d4aaf8d81');
check('direct zero-minimum flex column root', /^\s*<div class="cj-wrap"/.test(markupSource) && /\.cj-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css));
check('controls then reserved status then panels', /class="cj-(?:toolbar|controls)"[\s\S]*id="cj-status"[\s\S]*class="cj-panels zt-io"/.test(markupSource));
eq('two shared panes', (markupSource.match(/zt-io-pane/g)||[]).length, 2);
check('both editors use zero-basis shared filling', (markupSource.match(/zt-io-fill/g)||[]).length >= 2 && /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(readFileSync(join(root,'src/styles/tool-common.css'),'utf8')));
check('reserved status has fixed height and overflow', /\.cj-status\s*\{[^}]*height: 2\.6rem;[^}]*min-height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css));
check('editors scroll inside bounded layout', /\.cj-box\s*\{[^}]*min-width: 0;[^}]*overflow: auto;/.test(css));
check('860 stacking and 640 touch targets', /@media \(max-width: 860px\)/.test(css) && /@media \(max-width: 640px\)[\s\S]*44px/.test(css));
check('copy failure width remains reserved', /\.cj-head \.btn-copy\s*\{[^}]*min-width: 6\.75rem;/.test(css));
check('tips stay outside labels and buttons', !/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markupSource));
eq('exact bound tip IDs', [...markupSource.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]), ["cj-tip-parse-types", "cj-tip-empty-null", "cj-tip-clear", "cj-tip-csv", "cj-tip-copy-csv", "cj-tip-json", "cj-tip-copy-json"]);
check('build-time labels replace runtime i18n', !/data-i18n|var STRINGS|document.documentElement.lang/.test(source));
check('only selected client strings are serialized', /const \{ tips: TIPS, \.\.\.CLIENT \} = T;/.test(source) && /data-strings=\{JSON.stringify\(CLIENT\)\}/.test(markupSource));
eq('registered convert kind', readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').match(/['"]csv-json['"]\s*:\s*['"]([^'"]+)['"]/)?.[1], 'convert');
const ORIGINAL_CLIENT_STRINGS = {
  "en": {
    "copy": "Copy",
    "copied": "Copied!",
    "copyFailed": "Copy failed",
    "clear": "Clear",
    "convertedToJson": "Converted {n} row{s} to JSON.",
    "convertedToCsv": "Converted {n} row{s} to CSV.",
    "errorPrefix": "Error: ",
    "parseTypes": "Parse numbers & booleans",
    "emptyNull": "Empty → null"
  },
  "zh": {
    "copy": "复制",
    "copied": "已复制！",
    "copyFailed": "复制失败",
    "clear": "清除",
    "convertedToJson": "已将 {n} 行转换为 JSON。",
    "convertedToCsv": "已将 {n} 行转换为 CSV。",
    "errorPrefix": "错误：",
    "parseTypes": "推断数字和布尔值",
    "emptyNull": "空字段 → null"
  },
  "ja": {
    "copy": "コピー",
    "copied": "コピー済み！",
    "copyFailed": "コピー失敗",
    "clear": "クリア",
    "convertedToJson": "{n} 行を JSON に変換しました。",
    "convertedToCsv": "{n} 行を CSV に変換しました。",
    "errorPrefix": "エラー：",
    "parseTypes": "数値・真偽値を自動変換",
    "emptyNull": "空フィールド → null"
  },
  "ko": {
    "copy": "복사",
    "copied": "복사됨!",
    "copyFailed": "복사 실패",
    "clear": "지우기",
    "convertedToJson": "{n}행을 JSON으로 변환했습니다.",
    "convertedToCsv": "{n}행을 CSV로 변환했습니다.",
    "errorPrefix": "오류: ",
    "parseTypes": "숫자 및 불리언 추론",
    "emptyNull": "빈 필드 → null"
  }
};
const PROTECTED_CONTENT = {
  "en": {
    "front": "522431c694597be3d9613ea7408143cb31e2153c05924bdf8e8855039ca67c8d",
    "body": "0e45b434f9f82277ce1698820f749180e01fc8fc71799263b103f2920aa0f146"
  },
  "zh": {
    "front": "cadef054c24a5bb3702149ac3166c673fd77b21fc1233f8e8f861cb0997075e4",
    "body": "5f15a4792b9cae1fa12b708b40786ceedaa731812d8d46091bfaeb995906cf69"
  },
  "ja": {
    "front": "c09bf22f93d2dc526c5d1385eb60b0391dc11fa853d4117f6796d9895a9bf724",
    "body": "2a67a06843448e370a49d80369c59e6352e7548e7f63965e96f9600b9eaa5f8c"
  },
  "ko": {
    "front": "5cbe47329c4b278a884f2f42d01c32655ae6058ab8ce5e9f6f22871a04baf282",
    "body": "12a930d77ec1895959b39ae28f045857973ffb0dcd6782248549975b0c7735ca"
  }
};
const yaml = requireRoot('js-yaml');
const mdxCompiler = await import(requireRoot.resolve('@mdx-js/mdx'));
for (const lang of ['en','zh','ja','ko']) {
  const S = allStrings[lang], p = page(lang), client = JSON.parse(p.doc.querySelector('.cj-wrap').dataset.strings);
  eq(lang+' original FIX messages and labels unchanged', Object.fromEntries(Object.keys(ORIGINAL_CLIENT_STRINGS[lang]).map(k=>[k,client[k]])), ORIGINAL_CLIENT_STRINGS[lang]);
  eq(lang+' tip key parity', Object.keys(S.tips), ["csv", "json", "parseTypes", "emptyNull", "clear", "copyCsv", "copyJson"]);
  check(lang+' tips are bounded plain text', Object.values(S.tips).every(t=>typeof t==='string'&&t.length>0&&[...t].length<=280&&!/[<>]/.test(t)));
  check(lang+' client payload excludes tips', !Object.hasOwn(client,'tips') && Object.values(S.tips).every(t=>!JSON.stringify(client).includes(t)));
  const text = readFileSync(join(root,'src/content/tools/csv-json',lang+'.mdx'),'utf8');
  const [,front,body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/), data = yaml.load(front);
  eq(lang+' step count', data.steps.length, 5);
  check(lang+' steps within 8/280/1200 before FAQ', data.steps.length<=8&&data.steps.every(s=>typeof s==='string'&&[...s].length<=280)&&data.steps.reduce((n,s)=>n+[...s].length,0)<=1200&&front.indexOf('steps:')<front.indexOf('faqItems:'));
  eq(lang+' FAQ and SEO byte protection', hash(front.replace(/steps:\n[\s\S]*?(?=faqItems:)/,'')), PROTECTED_CONTENT[lang].front);
  eq(lang+' protected remaining body with explicit removed-button exceptions', hash(body), PROTECTED_CONTENT[lang].body);
  check(lang+' Usage removed', !/<h2>(?:How to Use|How to use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  let error='';try{await mdxCompiler.compile(body);}catch(e){error=String(e);}eq(lang+' MDX compiles',error,'');
}
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const compiled = await transform(source, { filename: join(root, 'src/components/tools/CsvJsonTool.astro') });
eq('Astro no error diagnostics', compiled.diagnostics.filter(d=>d.severity===1), []);
let compileError='';try{await requireRoot('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compileError=String(e);}eq('Astro generated JavaScript parses',compileError,'');
check('client script excludes all tip bodies', Object.values(allStrings).every(S=>Object.values(S.tips).every(t=>!script.includes(t))));

check('both directions are editable and never hidden', !/readonly|hidden|data-empty/.test(markupSource) && !/display: none/.test(css));
check('both automatic conversion buttons and labels removed', !/cj-to-(json|csv)|csvToJson["']:|jsonToCsv["']:|btn-primary/.test(markupSource+JSON.stringify(allStrings)));
for(const lang of ['en','zh','ja','ko'])for(const side of ['left','right']) {
 const p=page(lang);p.type(s[side],side==='left'?s.input:'[{"n":2}]');p.advance(100);p.key(s[side],'Enter','metaKey');
 eq(lang+side+' MetaEnter does not rush conversion',p.get(s[side==='left'?'right':'left']).value,'');p.advance(199);eq(lang+side+' debounce still waits 300ms',p.get(s[side==='left'?'right':'left']).value,'');p.advance(1);check(lang+side+' conversion runs after 300ms',p.get(s[side==='left'?'right':'left']).value.length>0);
}

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
