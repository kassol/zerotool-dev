// CSV to Markdown — fields beyond the header are kept under added "Column N" headers
//
// Read:  src/components/tools/CsvToMarkdownTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Also reads ToolLayout.astro and executes the real page with controlled DOM/time/clipboard.
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: rows with more fields than the header get extra columns named "Column N" (N is the
// 1-based column position) and the added names are reported (these fields were dropped before),
// short rows padded with empty cells, alignment separators, pipe escaping, quoted fields with
// commas / quotes / line breaks, CRLF input, header-only input, 4-language STRINGS keys.
//
// Run: node scripts/test-csv-to-markdown.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPage, readComponent, frontmatterStrings } from './astro-page-harness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CsvToMarkdownTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CsvToMarkdownTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { csvToMarkdown };')();

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
const md = (csv, align) => E.csvToMarkdown(csv, align || 'left');

// ---------- the reported defect: extra fields dropped ----------
{
  const r = md('name,age\nAlice,30,London\nBob,25');
  eq('extra field kept under Column 3', r.markdown.split('\n'), [
    '| name  | age | Column 3 |',
    '| :------ | :---- | :--------- |',
    '| Alice | 30  | London   |',
    '| Bob   | 25  |          |',
  ]);
  eq('added header reported', r.addedColumns, ['Column 3']);
}
{
  const r = md('a\n1,2,3\n4');
  eq('several extra columns', r.markdown.split('\n')[0], '| a   | Column 2 | Column 3 |');
  eq('several added headers reported', r.addedColumns, ['Column 2', 'Column 3']);
  eq('values in extra columns', r.markdown.split('\n')[2], '| 1   | 2        | 3        |');
}
eq('no extra fields → nothing added', md('a,b\n1,2').addedColumns, []);
eq('empty trailing field still counts as a field', md('a\n1,').markdown.split('\n')[0], '| a   | Column 2 |');
eq('header longer than rows: rows padded', md('a,b,c\n1').markdown.split('\n')[2], '| 1   |     |     |');

// ---------- unchanged behavior ----------
eq('header only', md('a,b').markdown, '| a   | b   |\n| :---- | :---- |');
eq('row count', md('a\n1\n2').rowCount, 2);
eq('center alignment', md('a\n1', 'center').markdown.split('\n')[1], '| :---: |');
eq('right alignment', md('a\n1', 'right').markdown.split('\n')[1], '| ----: |');
eq('pipe escaped', md('a\nx|y').markdown.split('\n')[2], '| x\\|y |');
eq('quoted comma, quote and line break', md('a,b\n"x,y","say ""hi""\nthere"').markdown.split('\n')[2],
  '| x,y | say "hi" there |');
eq('quoted comma does not add a column', md('a,b\n"x,y",z').addedColumns, []);
eq('CRLF input', md('a,b\r\n1,2\r\n').markdown.split('\n'), ['| a   | b   |', '| :---- | :---- |', '| 1   | 2   |']);
let threw = false;
try { md(''); } catch (e) { threw = /No data/.test(e.message); }
check('empty input throws No data', threw);

// ---------- STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/);
  const S = new Function('return ' + m[1])();
  const keys = Object.keys(S.en).sort().join(',');
  ['zh', 'ja', 'ko'].forEach((l) => eq('STRINGS keys ' + l, Object.keys(S[l]).sort().join(','), keys));
  ['en', 'zh', 'ja', 'ko'].forEach((l) => check('addedColumns has {cols} in ' + l, S[l].addedColumns.includes('{cols}')));
}

// ---------- BOM and CR inside quoted fields ----------
eq('UTF-8 BOM is not part of the first header', md('\uFEFFname,note\nAnn,x').markdown.split('\n')[0], '| name | note |');
eq('CRLF inside a quoted field becomes one space', md('name,note\r\nAnn,"line1\r\nline2"\r\n').markdown.split('\n')[2], '| Ann  | line1 line2 |');
eq('lone CR inside a quoted field becomes a space', md('a\n"x\ry"').markdown.split('\n')[2], '| x y |');
eq('en page example (center)', md('id,city,score\n1,東京,9.5\n2,"Paris, FR",\n3,Berlin', 'center').markdown.split('\n'), [
  '| id  | city      | score |', '| :---: | :---------: | :-----: |', '| 1   | 東京        | 9.5   |', '| 2   | Paris, FR |       |', '| 3   | Berlin    |       |',
]);

eq('engine byte protection', createHash('sha256').update(source.slice(source.indexOf('      '+START_MARK), source.indexOf('      '+END_MARK)+'      '.length+END_MARK.length)).digest('hex'), '0075c68c80e8b13b3c831c0cebdc72b80dae651b28ec1ab223bb368b87e3e041');

// ---------- full page lifecycle: real IIFE and actual shared keydown ----------
// DOM, clipboard promises and time are controlled boundaries; conversion code is real.
const sharedSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shared = sharedSource.slice(sharedSource.indexOf("document.addEventListener('keydown'", sharedSource.indexOf('// ── Keyboard shortcuts')), sharedSource.indexOf('// ── Copy button visual feedback'));
const unhandled = [];
const onUnhandled = e => unhandled.push(String(e));
process.on('unhandledRejection', onUnhandled);
const settle = () => new Promise(resolve => setImmediate(resolve));
const copyFailures = { en: 'Copy failed', zh: '复制失败', ja: 'コピー失敗', ko: '복사 실패' };
const s = {"slug": "csv-to-markdown", "file": "CsvToMarkdownTool", "p": "cm", "left": "cm-csv", "right": "cm-md", "input": "n\n1", "manual": "cm-convert", "expected": "| n   |\n| :---- |\n| 1   |", "copy": ["cm-copy-csv", "cm-copy-md"], "delay": 300};
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
  if(strings){const root=doc.querySelector('.cm-wrap');root.dataset={strings:JSON.stringify(strings),lang};}
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
      else p.get(s.manual).click();
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
  for (const mode of ['live','manual']) for (const value of ['', '""']) {
    const p=page(lang);p.golden();
    if(mode==='live'){p.type(s.left,value);p.advance(300);}else{p.get(s.left).value=value;p.get(s.manual).click();}
    eq(lang+mode+value+' empty/error removes old Markdown',p.get(s.right).value,'');
    if(!value)eq(lang+mode+' empty clears status',p.get('cm-status').textContent,'');
    else check(lang+mode+' no-data error visible',p.get('cm-status').classList.contains('error'));
    p.golden();eq(lang+mode+' recovery',p.get(s.right).value,s.expected);
  }
  const p=page(lang);p.golden();p.get('cm-align-center').click();
  eq(lang+' center immediately converts',p.get(s.right).value,'| n   |\n| :---: |\n| 1   |');
  p.clear();p.golden();eq(lang+' Clear keeps alignment',p.get(s.right).value,'| n   |\n| :---: |\n| 1   |');
  p.type(s.left,s.input);p.get('cm-align-right').click();
  eq(lang+' right immediately converts',p.get(s.right).value,'| n   |\n| ----: |\n| 1   |');
  check(lang+' immediate conversion cancels queued run',![...p.jobs.values()].some(j=>j.ms===300));
  p.type(s.left,'n\n2');p.clear();check(lang+' Clear cancels queued run',![...p.jobs.values()].some(j=>j.ms===300));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
