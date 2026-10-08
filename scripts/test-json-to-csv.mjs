// JSON to CSV — empty nested objects, formula guard (OWASP CSV Injection), UTF-8 BOM download
//
// Read:  src/components/tools/JsonToCsvTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers and the 4-language labels),
//        src/content/tools/json-to-csv/{en,zh,ja,ko}.mdx
// Write: stdout only (test results); when python3 is installed, runs `python3 -c` with the CSV
//        on stdin (no files)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: an empty nested object keeps its column and is written as {} (it used to produce no
// column with flatten on); flatten on / off, union of keys, non-object items; RFC 4180 quoting;
// formula guard per the OWASP CSV Injection page — string values (and header names) that start
// with = + - @, Tab, CR, LF or the full-width ＝＋－＠ are counted, left unchanged with the guard
// off, prefixed with ' or a Tab and quoted with the guard on; JSON numbers, booleans and
// arrays / objects (JSON text) are never changed; the download gets a UTF-8 BOM (EF BB BF) when
// the option is on and the copy text never does; every output is read back with Python's csv
// module when available; the English page examples; 4-language labels share the same keys.
//
// Run: node scripts/test-json-to-csv.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contractProblems, examplePairs } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToCsvTool.astro'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in JsonToCsvTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { toRows, buildCsv, withBom, FORMULA_START };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  check(name, a === x, 'got ' + a + ', expected ' + x);
}
const conv = (data, opts = {}) => E.buildCsv(E.toRows(data, opts.flatten !== false), opts.del || ',', opts.header !== false, opts.guard || 'off');

// ---------- empty nested object ----------
eq('empty nested object keeps its column', conv([{ id: 1, meta: {} }]).csv, 'id,meta\n1,{}');
eq('empty object next to a filled one', conv([{ meta: {} }, { meta: { a: 1 } }]).csv, 'meta,meta.a\n{},\n,1');
eq('empty object deep inside', conv([{ a: { b: {} } }]).csv, 'a.b\n{}');
eq('flatten off writes JSON text', conv([{ meta: {}, user: { n: 'x' } }], { flatten: false }).csv, 'meta,user\n{},"{""n"":""x""}"');
eq('flatten on, nested', conv([{ id: 1, address: { city: 'NY', zip: '10001' } }]).csv, 'id,address.city,address.zip\n1,NY,10001');
eq('non-object items', conv([1, 'two', null]).csv, 'value\n1\ntwo\n');

// ---------- formula guard ----------
const risky = ['=1+1', '+81 3 1234 5678', '-x', '@SUM(A1)', '\tx', '\rx', '\nx', '＝1+1', '＋1', '－1', '＠a'];
for (const v of risky) {
  const label = JSON.stringify(v);
  eq('pattern matches ' + label, E.FORMULA_START.test(v), true);
  const off = conv([{ v }]);
  eq(label + ' counted with guard off', off.formulaCells, 1);
  check(label + ' unchanged with guard off', !off.csv.includes("'" + v) && off.csv.includes(v.replace(/"/g, '""')), off.csv);
  eq(label + ' quote guard', conv([{ v }], { guard: 'quote' }).csv, 'v\n"\'' + v + '"');
  eq(label + ' tab guard', conv([{ v }], { guard: 'tab' }).csv, 'v\n"\t' + v + '"');
}
for (const v of ['a=1', 'A-1', 'x@y.com', ' =1', '1-2']) {
  eq('not risky: ' + JSON.stringify(v), conv([{ v }], { guard: 'quote' }).csv, 'v\n' + v);
}
eq('numbers are not guarded', conv([{ n: -5, f: -0.5 }], { guard: 'quote' }), { csv: 'n,f\n-5,-0.5', formulaCells: 0 });
eq('booleans and arrays are not guarded', conv([{ b: true, a: ['=x'] }], { guard: 'quote' }).csv, 'b,a\ntrue,"[""=x""]"');
eq('header name is guarded too', conv([{ '=cmd': 1 }], { guard: 'quote' }), { csv: '"\'=cmd"\n1', formulaCells: 1 });
eq('count over many cells', conv([{ a: '=1', b: '+2' }, { a: 'ok', b: '@3' }]).formulaCells, 3);
eq('guard and quotes in the value', conv([{ v: '=HYPERLINK("http://x")' }], { guard: 'quote' }).csv, 'v\n"\'=HYPERLINK(""http://x"")"');
eq('OWASP example with tab guard', conv([{ v: '=1+2";=1+2' }], { guard: 'tab' }).csv, 'v\n"\t=1+2"";=1+2"');

// ---------- BOM ----------
eq('BOM on', [...Buffer.from(E.withBom('a,b', true), 'utf8').subarray(0, 3)], [0xEF, 0xBB, 0xBF]);
eq('BOM off', E.withBom('a,b', false), 'a,b');
eq('BOM added once', E.withBom('\uFEFFa', true), '\uFEFFa');
check('copy button uses the text without BOM', /writeText\(text\)/.test(source) && !/writeText\(withBom/.test(source));
check('download uses withBom', /new Blob\(\[withBom\(/.test(source));

// ---------- page examples ----------
const page = readFileSync(join(root, 'src/content/tools/json-to-csv/en.mdx'), 'utf8');
eq('page example: arrays, missing keys and quotes',
  conv([{ id: 1, name: 'Ann', tags: ['a', 'b'], address: { city: 'Paris', geo: { lat: 48.85 } } }, { id: 2, name: 'Bo, Jr.', note: 'says "hi"' }]).csv,
  'id,name,tags,address.city,address.geo.lat,note\n1,Ann,"[""a"",""b""]",Paris,48.85,\n2,"Bo, Jr.",,,,"says ""hi"""');
eq('page example: semicolon', conv([{ sku: 'A-1', price: 9.5, active: true }, { sku: 'B-2', price: null }], { del: ';' }).csv, 'sku;price;active\nA-1;9.5;true\nB-2;;');
const ex = conv([{ name: 'Ann', comment: '=HYPERLINK("http://example.com","Click")' }], { guard: 'quote' }).csv;
check('page shows the formula guard example', page.includes(ex.split('\n')[1].replace(/"/g, '&quot;')) || page.includes(ex.split('\n')[1]), ex);
check('page no longer lists the empty-object limit', !page.includes('produces no column'));

// ---------- read back with Python's csv module ----------
const py = spawnSync('python3', ['-c', 'import csv,sys,json; print(json.dumps(list(csv.reader(sys.stdin.read().splitlines(True), delimiter=sys.argv[1]))))', ','], { input: '', encoding: 'utf8' });
if (py.status === 0) {
  const readBack = (text, del) => JSON.parse(spawnSync('python3', ['-c', 'import csv,sys,json,io; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read(), newline=""), delimiter=sys.argv[1]))))', del], { input: text, encoding: 'utf8' }).stdout);
  for (const v of risky) {
    for (const guard of ['off', 'quote', 'tab']) {
      for (const del of [',', ';', '\t']) {
        const out = conv([{ v, n: 1 }], { guard, del }).csv;
        const rows = readBack(out, del);
        const want = guard === 'off' ? v : (guard === 'quote' ? "'" : '\t') + v;
        eq('python reads ' + JSON.stringify(v) + ' ' + guard + ' ' + JSON.stringify(del), rows[1], [want, '1']);
      }
    }
  }
} else {
  console.log('SKIP: python3 not available (CSV read-back)');
}

// ---------- labels ----------
const fm = source.slice(0, source.indexOf('---', 4));
const keysOf = (lang) => {
  const m = fm.match(new RegExp('\\n  ' + lang + ': \\{([\\s\\S]*?)\\n  \\},'));
  return m ? [...m[1].matchAll(/\n    (\w+):/g)].map((x) => x[1]).sort() : [];
};
const enKeys = keysOf('en');
for (const k of ['formula', 'guardOff', 'guardQuote', 'guardTab', 'bom', 'msgFormulaRisk', 'msgFormulaGuarded']) check('en label ' + k, enKeys.includes(k));
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' labels match en', keysOf(lang), enKeys);

// ---------- real page lifecycle ----------
// Execute the complete production script and actual shared keyboard listener.
// Only DOM, timers, highlighting and clipboard delivery are controlled here.
{
  console.log('Original regression: ' + passes + ' passed, ' + failures + ' failed');
  const cfg = {"slug": "json-to-csv", "file": "JsonToCsvTool.astro", "input": "jtc-input", "output": "jtc-output", "status": "jtc-status", "copy": "jtc-copy", "clear": "jtc-clear", "example": "jtc-example", "operation": "jtc-convert", "invalid": "{\"bad\":", "sample": "[{\"fresh\": true}]", "valueOutput": true};
  const vm = await import('node:vm');
  const tsPage = (await import('typescript')).default;
  const { createRequire: pageRequire } = await import('node:module');
  const requirePage = pageRequire(join(root, 'src/components/tools/' + cfg.file));
  const labels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const js = tsPage.transpileModule(script, { compilerOptions: { target: tsPage.ScriptTarget.ES2022, module: tsPage.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  const unhandled = [], onUnhandled = error => unhandled.push(String(error));
  process.on('unhandledRejection', onUnhandled);
  const same = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) passes++;
    else { failures++; console.log('FAIL page ' + name + '\n got ' + JSON.stringify(got) + '\n expected ' + JSON.stringify(want)); }
  };
  function page(lang, shellFirst) {
    const copies = [], timers = new Map(), clears = [], tracks = [], blobs = [], highlights = [];
    let now = 0, timerID = 0, document;
    const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
    function simple(e, selector) {
      if (e.tagName === '#TEXT') return false;
      const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)], plain = selector.replace(/\[[^\]]+\]/g, '');
      const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
      return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
        && [...plain.matchAll(/\.([\w-]+)/g)].every(m => e.className.split(/\s+/).includes(m[1]))
        && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
    }
    function matches(e, selector) {
      return selector.split(',').some(part => {
        const parts = part.trim().split(/\s+(?![^\[]*\])/); if (!simple(e, parts.pop())) return false;
        let parent = e.parentNode;
        while (parts.length) { while (parent && !simple(parent, parts.at(-1))) parent = parent.parentNode; if (!parent) return false; parts.pop(); parent = parent.parentNode; }
        return true;
      });
    }
    class Element {
      constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, dataset: {}, listeners: {}, id: '', className: '', text: '', value: '', hidden: false, disabled: false, checked: false, scrollTop: 0, scrollLeft: 0 }); }
      get parentElement() { return this.parentNode; }
      setAttribute(key, value) { this.attributes[key] = String(value); if (['id','class','type','value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); if (['hidden','disabled','checked'].includes(key)) this[key] = true; if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = String(value); }
      getAttribute(key) { return this.attributes[key] ?? null; }
      removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]; }
      get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
      set textContent(value) { this.text = String(value); this.children = []; }
      get classList() { const el=this; return { add(...names) { el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...names])].join(' '); }, remove(...names) { el.className=el.className.split(/\s+/).filter(n=>!names.includes(n)).join(' '); }, contains(name) { return el.className.split(/\s+/).includes(name); } }; }
      appendChild(e) { this.children.push(e); e.parentNode=this; return e; }
      contains(e) { return this === e || descendants(this).includes(e); }
      querySelectorAll(selector) { return descendants(this).filter(e=>matches(e,selector)); }
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      dispatch(type, extra={}) { const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra}; for(let e=this;e;e=e.parentNode){event.currentTarget=e; for(const fn of e.listeners[type]||[]) fn.call(e,event); if(event.stopped)break;} return event; }
      click() { if(!this.disabled)return this.dispatch('click'); }
      focus() { document.activeElement=this; }
    }
    document=new Element('#document');document.documentElement={lang}; document.body=document.appendChild(new Element('body'));document.activeElement=document.body;
    const widget=document.body.appendChild(new Element('section'));widget.className='tool-widget';
    const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const decode=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    const markup=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0]
      .replace(/<Toggletip id="([^"]+)"[^>]*>[\s\S]*?<\/Toggletip>/g,(_,id)=>'<span class="zt-tip"><button type="button" class="zt-tip-btn" data-zt-tip="'+id+'">?</button></span>')
      .replace("data-del={'\\t'}", 'data-del="\t"')
      .replace(/<!--[\s\S]*?-->/g,'').replace(/placeholder=\{`[\s\S]*?`\}/g,'').replace(/placeholder='[^']*'/g,'')
      .replace(/=\{L\.(\w+)\}/g,(_,key)=>'="'+esc(labels[lang][key])+'"').replace(/\{L\.(\w+)\}/g,(_,key)=>esc(labels[lang][key])).replace(/=\{lang\}/g,'="'+lang+'"');
    const stack=[widget];
    for(const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) { const text=token[0]; if(text.startsWith('</'))stack.pop();else if(text.startsWith('<')){const tag=/^<([\w-]+)/.exec(text)[1],e=new Element(tag);for(const a of text.matchAll(/([\w-]+)="([^"]*)"/g))e.setAttribute(a[1],decode(a[2]));for(const a of ['hidden','disabled','readonly','checked'])if(new RegExp('\\s'+a+'(?=\\s|/?>)').test(text))e.setAttribute(a,'');stack.at(-1).appendChild(e);if(!/\/>$/.test(text)&&!['input','br','hr','img'].includes(tag))stack.push(e);}else{const e=new Element('#text');e.text=decode(text);stack.at(-1).appendChild(e);} }
    if(stack.length!==1)throw Error('Unbalanced source markup');
    document.getElementById=id=>descendants(document).find(e=>e.id===id)??null;document.createElement=tag=>new Element(tag);
    const get=id=>{const e=document.getElementById(id);if(!e)throw Error('Missing actual source ID '+id);return e;};
    const clipboard={writeText(value){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});copies.push({value:String(value),resolve,reject});return promise;}};
    const context={document,console,exports:{},Blob,Error,_slug:cfg.slug,navigator:{clipboard},
      require(name){if(name==='highlight.js/lib/core')return{registerLanguage(){},highlightElement(e){highlights.push(e.id);e.setAttribute('data-highlighted','yes');}};if(name.startsWith('highlight.js/lib/languages/'))return()=>({});return requirePage(name);},
      setTimeout(fn,ms=0){const id=++timerID;timers.set(id,{fn,ms,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
      URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},ztPersist:{clear(slug){clears.push(slug);}},trackTool(...args){tracks.push(args);}};
    context.window=context;vm.createContext(context);const shared=()=>vm.runInContext(shortcut,context);
    if(shellFirst)shared();vm.runInContext(js,context,{filename:cfg.file});if(!shellFirst)shared();
    function advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=target;}
    const out=()=>cfg.valueOutput?get(cfg.output).value:get(cfg.output).textContent;
    return{get,document,context,copies,timers,clears,tracks,blobs,highlights,advance,out,
      input(value,id=cfg.input){get(id).value=value;get(id).dispatch('input');},
      key(key='l',modifier='ctrlKey',target=cfg.input){(target?get(target):document.body).focus();return document.activeElement.dispatch('keydown',{key,[modifier]:true});},
      example(){get(cfg.example).click();},copy(){get(cfg.copy).click();return copies.at(-1);},
      snapshot(){return{input:get(cfg.input).value,output:out(),status:get(cfg.status).textContent,statusClass:get(cfg.status).className,copy:get(cfg.copy).textContent,copyClass:get(cfg.copy).className};}};
  }
  for(const lang of ['en','zh','ja','ko'])for(const shellFirst of [false,true]){
    const p=page(lang,shellFirst),tag=lang+'/'+shellFirst;
    p.example();same(tag+' actual Example creates output',!!p.out(),true);
    p.input(cfg.invalid);p.advance(300);same(tag+' invalid input clears old output',p.out(),'');same(tag+' invalid input shows error',p.get(cfg.status).classList.contains('error'),true);
    p.input('   ');p.advance(300);same(tag+' empty removes input error',p.get(cfg.input).classList.contains('error'),false);same(tag+' empty clears status/output',[p.out(),p.get(cfg.status).textContent],['','']);
    for(const [key,mod,target]of [['l','ctrlKey',cfg.input],['L','metaKey',cfg.copy]]){
      p.example();p.input(cfg.sample);const event=p.key(key,mod,target);
      same(tag+' shortcut synchronously clears '+key,[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent,event.defaultPrevented],['','','',true]);
      same(tag+' shortcut returns focus to input '+key,p.document.activeElement.id,cfg.input);p.advance(300);same(tag+' queued debounce stays cancelled '+key,[p.out(),p.get(cfg.status).textContent],['','']);
    }
    same(tag+' shared clear executes in both orders',p.clears,[cfg.slug,cfg.slug]);p.example();const outside=p.snapshot();p.key('l','ctrlKey',null);same(tag+' outside shortcut unchanged',p.snapshot(),outside);
    p.get(cfg.input).focus();p.get(cfg.input).dispatch('keydown',{key:'l'});same(tag+' unmodified key unchanged',p.snapshot(),outside);
    p.input(cfg.sample);p.get(cfg.clear).click();p.advance(300);same(tag+' Clear drops pending work',[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent],['','','']);
    p.example();const output=p.out(),status=p.get(cfg.status).textContent;
    const rejected=p.copy();same(tag+' exact full copy bytes',rejected.value,output);rejected.reject(Error('denied'));await settle();same(tag+' current rejection is localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);same(tag+' current failure keeps output/status',[p.out(),p.get(cfg.status).textContent],[output,status]);
    const retry=p.copy();retry.resolve();await settle();same(tag+' direct retry success',p.get(cfg.copy).textContent,labels[lang].copied);p.advance(1500);same(tag+' success settles to Copy',p.get(cfg.copy).textContent,labels[lang].copy);
    p.context.navigator.clipboard=undefined;let thrown;try{p.copy();}catch(e){thrown=String(e);}same(tag+' absent Clipboard API is handled',thrown,undefined);same(tag+' absent API localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);
    p.context.navigator.clipboard={writeText(){throw Error('sync failure');}};thrown=undefined;try{p.copy();}catch(e){thrown=String(e);}same(tag+' synchronous clipboard throw handled',thrown,undefined);
    for(const finish of ['resolve','reject'])for(const action of ['clear','shortcut','input','result']){
      const q=page(lang,shellFirst);q.example();const job=q.copy();
      if(action==='clear')q.get(cfg.clear).click();else if(action==='shortcut')q.key('L','metaKey',cfg.copy);else{q.input(cfg.sample);if(action==='result')q.advance(300);}
      const current=q.snapshot();job[finish](finish==='reject'?Error('late'):undefined);await settle();same(tag+' stale completion immediately preserves '+action+'/'+finish,q.snapshot(),current);q.advance(1500);same(tag+' stale '+finish+' after '+action,q.snapshot(),action==='input'?{...current,output:q.out(),status:q.get(cfg.status).textContent,statusClass:q.get(cfg.status).className}:current);same(tag+' stale feedback stays reset '+action+'/'+finish,q.get(cfg.copy).textContent,labels[lang].copy);
    }
    const q=page(lang,shellFirst);q.example();q.copy().resolve();await settle();const old=[...q.timers.values()].filter(t=>t.ms===1500).map(t=>t.fn);same(tag+' real success timer exists',old.length>0,true);q.advance(400);q.copy().resolve();await settle();old.forEach(fn=>fn());same(tag+' old timer cannot reset new Copied',q.get(cfg.copy).textContent,labels[lang].copied);q.advance(1500);same(tag+' latest timer settles',q.get(cfg.copy).textContent,labels[lang].copy);
    const r=page(lang,shellFirst);r.example();const one=r.copy(),two=r.copy();two.resolve();await settle();one.reject(Error('older request'));await settle();same(tag+' older rejection cannot replace new success',r.get(cfg.copy).textContent,labels[lang].copied);
    const queued=page(lang,shellFirst);queued.input(cfg.sample);queued.advance(30);queued.example();const generated=queued.tracks.length;queued.copy().resolve();await settle();queued.advance(300);same(tag+' Example cancels queued conversion before Copy',queued.get(cfg.copy).textContent,labels[lang].copied);same(tag+' Example does not run queued conversion again',queued.tracks.length,generated);
    queued.input(cfg.sample);queued.get('jtc-header-tabs').querySelector('[data-header="true"]').click();const manual=queued.tracks.length;queued.advance(300);same(tag+' immediate option update cancels queued conversion',queued.tracks.length,manual);
    const layout=page(lang,shellFirst);layout.example();same(tag+' actual nonempty output has visible state',layout.get(cfg.output).dataset.empty,'false');layout.input(cfg.invalid);layout.advance(300);same(tag+' invalid hides output pane',layout.get(cfg.output).dataset.empty,'true');layout.example();layout.get(cfg.clear).click();same(tag+' Clear hides output pane',layout.get(cfg.output).dataset.empty,'true');
    for(const focus of [layout.get(cfg.output),layout.document.querySelector('[data-zt-tip="jtc-tip-copy"]')]){layout.example();focus.focus();focus.dispatch('keydown',{key:'L',metaKey:true});same(tag+' output shortcut focuses input before hiding',[layout.document.activeElement.id,layout.out(),layout.get(cfg.output).dataset.empty],[cfg.input,'','true']);}
    layout.example();for(const id of ['jtc-del-tabs','jtc-flatten-tabs','jtc-header-tabs','jtc-guard-tabs','jtc-bom-tabs']){const tabs=layout.get(id).querySelectorAll('.jtc-tab');for(const selected of tabs){const before=layout.tracks.length;selected.click();same(tag+' option converts immediately '+id,layout.tracks.length,before+1);same(tag+' aria pressed matches active '+id,tabs.map(t=>[t.classList.contains('active'),t.getAttribute('aria-pressed')]),tabs.map(t=>[t===selected,t===selected?'true':'false']));}}
    layout.input(cfg.sample);const beforeEnter=layout.tracks.length;layout.key('Enter');same(tag+' no Generate means CtrlEnter has no primary action',layout.tracks.length,beforeEnter);layout.advance(300);same(tag+' CtrlEnter retains normal debounce',layout.tracks.length,beforeEnter+1);
    const csv=page(lang,shellFirst);csv.input('[{"v":"=1+1"}]');csv.advance(300);same(tag+' formula warning remains directly visible',csv.get(cfg.status).classList.contains('warn')&&csv.get(cfg.status).textContent.includes(labels[lang].msgFormulaRisk.replace('{n}','1')),true);csv.copy().resolve();same(tag+' Copy excludes BOM',csv.copies.at(-1).value,'v\n=1+1');csv.get('jtc-download').click();same(tag+' real Blob download includes BOM by default',Buffer.from(await csv.blobs.at(-1).arrayBuffer()).toString('hex'),Buffer.from('\uFEFFv\n=1+1').toString('hex'));csv.get('jtc-bom-tabs').querySelector('[data-bom="false"]').click();csv.get('jtc-download').click();same(tag+' real Blob download excludes BOM when off',Buffer.from(await csv.blobs.at(-1).arrayBuffer()).toString('utf8'),'v\n=1+1');csv.get('jtc-guard-tabs').querySelector('[data-guard="quote"]').click();same(tag+' formula guard changes actual output',csv.out(),"v\n\"'=1+1\"");await settle();
  }
  await settle();same('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
}

// ---------- v2 page layout ----------
{
  const equalLayout = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));
  const check = (name, passed) => equalLayout('v2 ' + name, !!passed, true);
  const strings = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const markup = source.split('\n---')[1].split('<script')[0], css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  check('registered convert', /'json-to-csv':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct flex root', /^\s*<div\s+class="jtc-wrap"/.test(markup) && /\.jtc-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
  check('actions then reserved status then panels', markup.indexOf('class="jtc-actions"') < markup.indexOf('id="jtc-status"') && markup.indexOf('id="jtc-status"') < markup.indexOf('class="jtc-panels zt-io"') && /\.jtc-status\s*\{[^}]*height:\s*2\.4rem/.test(css));
  equalLayout('v2 two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  check('input and output fill panes', markup.includes('id="jtc-input" class="zt-io-fill"') && markup.includes('class="jtc-output zt-io-fill"'));
  check('accessible output scroller', /id="jtc-output"[^>]*tabindex="0"[^>]*aria-labelledby="jtc-output-label"/.test(markup) && /\.jtc-output\s*\{[^}]*overflow:\s*auto/.test(css));
  check('segmented option groups', (markup.match(/zt-segmented/g)||[]).length===5 && (markup.match(/role="group"/g)||[]).length===5 && (markup.match(/aria-pressed="(?:true|false)"/g)||[]).length===12);
  check('secondary options default closed and warning stays outside', /<details id="jtc-options" class="jtc-options">/.test(markup) && markup.indexOf('id="jtc-status"')>markup.indexOf('</details>'));
  check('CSV wrapping disabled for horizontal scrolling', /id="jtc-output"[^>]*readonly wrap="off"/.test(markup));
  const mobile=css.slice(css.indexOf('@media (max-width: 860px)'));
  check('mobile input144 and output22rem', /#jtc-input\s*\{[^}]*height:\s*144px/.test(mobile) && /\.jtc-output\s*\{[^}]*height:\s*22rem/.test(mobile));
  check('empty output follows actual text and hides on mobile', css.includes('.jtc-output-pane:has(#jtc-output[data-empty="true"]) .jtc-empty { display: flex; }') && mobile.includes('.jtc-output-pane:has(#jtc-output[data-empty="true"]) { display: none; }'));
  check('phone touch sizing and global dark ancestors', css.includes('@media (max-width: 640px)') && css.includes('min-height: 44px') && css.includes(':global([data-theme="dark"])') && css.includes(':global(:root:not([data-theme="light"]))'));
  check('no automatic Generate control, binding or label', !source.includes('jtc-convert') && !Object.values(strings).some(v=>'convert' in v));
  equalLayout('v2 retained actual operation IDs', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m=>m[1]).sort(), ['jtc-clear','jtc-copy','jtc-download','jtc-example']);
  check('build-time strings and tips excluded from script data', source.includes("import Toggletip from '../Toggletip.astro'") && !/data-i18n|define:vars|JSON\.stringify\(STRINGS/.test(source) && !/STRINGS|L\.tips/.test(script));
  const map=[['input','jsonInput'],['delimiter','delimiter'],['flatten','flatten'],['header','header'],['formula','formula'],['bom','bom'],['example','example'],['clear','clear'],['copy','copy'],['download','download']];
  equalLayout('v2 ten tips', (markup.match(/<Toggletip\b/g)||[]).length, map.length);
  for(const lang of ['en','zh','ja','ko']){
    const L=strings[lang];equalLayout(lang+' v2 same tip keys',Object.keys(L.tips).sort(),map.map(x=>x[0]).sort());
    check(lang+' localized empty text',typeof L.empty==='string'&&!!L.empty.trim());
    for(const [key,about]of map){check(lang+' localized '+key,typeof L.tips[key]==='string'&&!!L.tips[key].trim()&&typeof L[about]==='string'&&!!L[about].trim());equalLayout(lang+' placeholder parity '+key,[...L.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]),[...strings.en.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]));check(lang+' binding '+key,markup.includes('<Toggletip id="jtc-tip-'+key+'" lang={lang} about={L.'+about+'}>{L.tips.'+key+'}</Toggletip>'));}
    const mdx=readFileSync(join(root,'src/content/tools/json-to-csv/'+lang+'.mdx'),'utf8'),[,fm,body]=mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
    const stepBlock=fm.match(/^steps:\n((?:  - .*\n)+)/m),steps=stepBlock[1].trimEnd().split('\n').map(line=>JSON.parse(line.slice(4)));
    check(lang+' step limits and before FAQ',steps.length>0&&steps.length<=8&&steps.every(v=>[...v].length<=280)&&steps.reduce((n,v)=>n+[...v].length,0)<=1200&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
    equalLayout(lang+' MDX content contract', contractProblems('json-to-csv', lang), '');
    // JSON → CSV examples, recomputed with some flatten / formula-guard setting. The formula-guard
    // example shows invalid JSON on the page (the MDX template literal drops the \" escapes), so it
    // is listed here; the check below fails once the page is fixed, and the entry must go.
    const KNOWN_INVALID_INPUT = ['[{"name":"Ann","comment":"=HYPERLINK("http://example.com","Click")"}]'];
    const csvPairs=examplePairs(body,b=>b.lang==='pre'&&/^[[{]/.test(b.text),b=>b.lang==='pre'&&!/^[[{]/.test(b.text));
    equalLayout(lang+' has JSON → CSV examples',csvPairs.length>0,true);
    equalLayout(lang+' known invalid example input is still invalid JSON',csvPairs.filter(([a])=>KNOWN_INVALID_INPUT.includes(a.text)).every(([a])=>{try{JSON.parse(a.text);return false;}catch{return true;}}),true);
    equalLayout(lang+' each CSV example equals the engine output',csvPairs.filter(([a])=>!KNOWN_INVALID_INPUT.includes(a.text)).filter(([a,b])=>![true,false].some(fl=>['off','quote','tab'].some(guard=>conv(JSON.parse(a.text),{flatten:fl,guard}).csv===b.text))).map(([,b])=>b.text),[]);
    check(lang+' Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
