// SQLite Viewer — engine regression test
//
// Read:  src/components/tools/SqliteViewerTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/layouts/ToolLayout.astro (actual shortcut handler);
//        node_modules/sql.js (the same engine the page loads)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: SQLite header check, identifier quoting with hostile names, schema listing
// (tables / views / hidden sqlite_* / row counts / WITHOUT ROWID), structure (columns,
// PK, composite index), paging SQL, CSV escaping (NULL, BLOB hex, quotes, commas,
// newlines), and runSql change / schema tracking on the in-memory copy.
//
// Run: node scripts/test-sqlite-viewer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import initSqlJs from 'sql.js';
import vm from 'node:vm';
import { load as loadYaml } from 'js-yaml';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SqliteViewerTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SqliteViewerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) +
  '\nreturn { PAGE_SIZE, isSqliteHeader, quoteIdent, toHex, csvField, toCsv, pageCount, pageSql, listObjects, describe, runSql };')();

let failures = 0;
let passes = 0;
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + ' — got ' + a + ', expected ' + e);
}

const SQL = await initSqlJs();
const WEIRD = 'we"ird name 表';
const src = new SQL.Database();
src.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, age INTEGER DEFAULT 18, avatar BLOB);
  CREATE INDEX idx_age_email ON users(age, email);
  CREATE TABLE ${E.quoteIdent(WEIRD)} (k TEXT, v TEXT, PRIMARY KEY (k, v)) WITHOUT ROWID;
  CREATE TABLE seq_t (id INTEGER PRIMARY KEY AUTOINCREMENT, x);
  INSERT INTO seq_t (x) VALUES (1);
  CREATE VIEW v_adults AS SELECT id FROM users WHERE age >= 18;
`);
const ins = src.prepare('INSERT INTO users (email, age, avatar) VALUES (?, ?, ?)');
for (let i = 1; i <= 250; i++) ins.run([`u${i}@x.io`, i % 10 === 0 ? null : i, i === 1 ? new Uint8Array([0, 15, 255]) : null]);
ins.free();
src.exec(`INSERT INTO ${E.quoteIdent(WEIRD)} VALUES ('a', 'b')`);
const bytes = src.export();
src.close();

// ---------- header ----------
equal('header: real file', E.isSqliteHeader(bytes.slice(0, 100)), true);
equal('header: too short', E.isSqliteHeader(bytes.slice(0, 99)), false);
equal('header: zip magic', E.isSqliteHeader(new Uint8Array(100).fill(0x50)), false);
const almost = bytes.slice(0, 100); almost[15] = 0x20;
equal('header: missing NUL terminator', E.isSqliteHeader(almost), false);

// ---------- quoting ----------
equal('quoteIdent doubles quotes', E.quoteIdent('a"b'), '"a""b"');
equal('pageSql', E.pageSql(WEIRD, 2), 'SELECT * FROM "we""ird name 表" LIMIT 100 OFFSET 200');
equal('pageCount 0 rows', E.pageCount(0), 1);
equal('pageCount 250 rows', E.pageCount(250), 3);
equal('pageCount 200 rows', E.pageCount(200), 2);

// ---------- schema ----------
const db = new SQL.Database(bytes);
const objs = E.listObjects(db);
equal('listObjects order + hidden sqlite_sequence', objs.map((o) => [o.type, o.name, o.count]),
  [['table', 'seq_t', 1], ['table', 'users', 250], ['table', WEIRD, 1], ['view', 'v_adults', null]]);
equal('listObjects keeps CREATE sql', objs[3].sql, 'CREATE VIEW v_adults AS SELECT id FROM users WHERE age >= 18');

const info = E.describe(db, 'users');
equal('describe columns', info.columns.map((c) => [c.name, c.type, c.notnull, c.dflt, c.pk]),
  [['id', 'INTEGER', false, null, 1], ['email', 'TEXT', true, null, 0], ['age', 'INTEGER', false, '18', 0], ['avatar', 'BLOB', false, null, 0]]);
equal('describe indexes', info.indexes.map((i) => [i.name, i.unique, i.origin, i.columns]),
  [['idx_age_email', false, 'c', ['age', 'email']], ['sqlite_autoindex_users_1', true, 'u', ['email']]]);
equal('describe WITHOUT ROWID composite PK', E.describe(db, WEIRD).columns.map((c) => [c.name, c.pk]), [['k', 1], ['v', 2]]);
equal('describe view columns', E.describe(db, 'v_adults').columns.map((c) => c.name), ['id']);

// ---------- paging ----------
const last = db.exec(E.pageSql('users', 2))[0].values;
equal('last page size', last.length, 50);
equal('last page first id', last[0][0], 201);
equal('paging a hostile name', db.exec(E.pageSql(WEIRD, 0))[0].values, [['a', 'b']]);

// ---------- CSV ----------
equal('csv NULL', E.csvField(null), '');
equal('csv BLOB hex', E.csvField(new Uint8Array([0, 15, 255])), '000FFF');
equal('csv empty BLOB', E.csvField(new Uint8Array([])), '');
equal('csv quote', E.csvField('say "hi"'), '"say ""hi"""');
equal('csv comma', E.csvField('a,b'), '"a,b"');
equal('csv newline', E.csvField('l1\nl2'), '"l1\nl2"');
equal('csv number', E.csvField(1.5), '1.5');
equal('csv unicode untouched', E.csvField('山田 🎉'), '山田 🎉');
const first = db.exec('SELECT id, age, avatar FROM users WHERE id IN (1, 10) ORDER BY id')[0];
equal('toCsv from real rows', E.toCsv(first.columns, first.values), 'id,age,avatar\r\n1,1,000FFF\r\n10,,\r\n');
equal('toHex preview limit', E.toHex(new Uint8Array([1, 2, 3]), 2), '0102');

// ---------- runSql on the in-memory copy ----------
let r = E.runSql(db, 'SELECT COUNT(*) AS n FROM users');
equal('select result', [r.result.columns, r.result.values, r.changes, r.schemaChanged], [['n'], [[250]], 0, false]);
r = E.runSql(db, 'UPDATE users SET age = 1 WHERE id <= 5');
equal('update changes', [r.result, r.changes, r.schemaChanged], [null, 5, false]);
r = E.runSql(db, 'CREATE TABLE t2 (a); SELECT 1 AS one; SELECT 2 AS two');
equal('multi-statement: last result set + schema change', [r.result.columns, r.changes, r.schemaChanged], [['two'], 0, true]);
r = E.runSql(db, 'SELECT id FROM users WHERE id < 0');
equal('zero-row select keeps columns', [r.result.columns, r.result.values, r.changes], [['id'], [], 0]);
r = E.runSql(db, 'CREATE TABLE t3 (a)');
equal('DDL after an UPDATE reports 0 changes', r.changes, 0);
let err = '';
try { E.runSql(db, 'SELEC 1'); } catch (e) { err = e.message; }
equal('syntax error surfaces SQLite message', err, 'near "SELEC": syntax error');
db.close();

// ---------- non-SQLite bytes ----------
err = '';
try { new SQL.Database(new Uint8Array(4096).fill(7)).exec('SELECT COUNT(*) FROM sqlite_master'); } catch (e) { err = e.message; }
equal('garbage body rejected by SQLite', err, 'file is not a database');

// ---------- complete page lifecycle with the real sql.js engine ----------
{
  const pageScript=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const layout=readFileSync(join(root,'src/layouts/ToolLayout.astro'),'utf8');
  const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
  const strings=new Function(source.slice(source.indexOf('const STRINGS = '),source.indexOf('\nconst T = STRINGS[lang]'))+';return STRINGS;')();
  const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
  const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
  function page(lang='en',shellFirst=false,width=1366){
    const ids=new Map(),scripts=[],downloads=[],urls=new Map(),databases=[],cleared=[],reveals=[];
    const doc={listeners:{},activeElement:null,documentElement:{lang}};
    function matches(node,selector){return selector.split(',').some(s=>{const parts=s.trim().split(/\s+/),last=parts.pop(),attrs=[...last.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)],bare=last.replace(/\[[^\]]*\]/g,''),id=/#([\w-]+)/.exec(bare),classes=[...bare.matchAll(/\.([\w-]+)/g)],tag=/^[\w-]+/.exec(bare);const own=(!id||node.id===id[1])&&(!tag||node.tagName===tag[0].toUpperCase())&&classes.every(c=>node.classList.contains(c[1]))&&attrs.every(a=>a[2]===undefined?node.getAttribute(a[1])!==null:node.getAttribute(a[1])===a[2]);if(!own)return false;let p=node.parentNode;while(parts.length&&p&&p!==doc){if(matches(p,parts.at(-1)))parts.pop();p=p.parentNode;}return!parts.length;});}
    class Element{
      constructor(tag='div'){Object.assign(this,{tagName:tag.toUpperCase(),id:'',className:'',attributes:{},children:[],parentNode:null,listeners:{},value:'',type:tag==='input'?'text':'',hidden:false,disabled:false,files:[]});}
      get classList(){const n=this;return{contains:c=>n.className.split(/\s+/).includes(c),add(c){if(!this.contains(c))n.className+=' '+c;},remove(c){n.className=n.className.split(/\s+/).filter(x=>x!==c).join(' ');}};}
      setAttribute(k,v){this.attributes[k]=String(v);if(['id','class','type','value'].includes(k))this[k==='class'?'className':k]=String(v);}
      getAttribute(k){return k==='type'?this.type:this.attributes[k]??null;}
      get textContent(){return(this.text||'')+this.children.map(c=>c.textContent).join('');}
      set textContent(v){if(this.children.some(c=>c.contains(doc.activeElement)))doc.activeElement=doc.body;for(const c of this.children)c.parentNode=null;this.children=[];this.text=String(v);this.html='';}
      get innerHTML(){return this.html||'';}
      set innerHTML(v){this.textContent='';this.html=String(v);parseMarkup(this.html,this);}
      appendChild(n){n.parentNode=this;this.children.push(n);if(n.tagName==='SCRIPT')scripts.push(n);return n;}
      removeChild(n){this.children=this.children.filter(c=>c!==n);n.parentNode=null;return n;}
      contains(n){return n===this||this.children.some(c=>c.contains(n));}
      querySelectorAll(s){return this.children.flatMap(c=>[...(matches(c,s)?[c]:[]),...c.querySelectorAll(s)]);}
      querySelector(s){return this.querySelectorAll(s)[0]||null;}
      closest(s){for(let p=this;p;p=p.parentNode)if(matches(p,s))return p;return null;}
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
      dispatch(type,extra={}){const e={type,target:this,preventDefault(){this.defaultPrevented=true;},...extra};for(let p=this;p;p=p.parentNode)for(const fn of p.listeners[type]||[])fn(e);return e;}
      click(){if(this.disabled)return;if(this.tagName==='A')downloads.push({name:this.download,blob:urls.get(this.href)});this.dispatch('click');}
      focus(){doc.activeElement=this;}
      scrollIntoView(options){reveals.push({id:this.id,options});}
    }
    function parseMarkup(markup,parent){const stack=[parent],voids=new Set(['input','br','hr','img','meta','link']);for(const m of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)){const tag=m[1];if(m[0].startsWith('</')){if(stack.at(-1)?.tagName===tag.toUpperCase())stack.pop();continue;}const n=new Element(tag);for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g))n.setAttribute(a[1],a[2]);n.hidden=/\bhidden(?=\s|\/|$)/.test(m[2]);n.disabled=/\bdisabled(?=\s|\/|$)/.test(m[2]);stack.at(-1).appendChild(n);if(n.id)ids.set(n.id,n);if(!voids.has(tag)&&!m[2].endsWith('/'))stack.push(n);}}
    const body=new Element('body'),widget=new Element();widget.className='tool-widget';body.appendChild(widget);parseMarkup(source.slice(source.indexOf('\n---',4)+4,source.indexOf('<script')),widget);
    const get=id=>{if(!ids.has(id))throw new Error('Actual markup ID missing '+id);return ids.get(id);};
    Object.assign(doc,{body,head:new Element('head'),getElementById:get,createElement:tag=>new Element(tag),querySelector:s=>s==='.tool-widget'?widget:widget.querySelector(s),querySelectorAll:s=>widget.querySelectorAll(s),addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},dispatch(type,extra={}){const e={type,target:this.activeElement,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners[type]||[])fn(e);return e;}});
    const trackedSQL={Database:function(data){const db=new SQL.Database(data),close=db.close.bind(db);db.closeCount=0;db.close=()=>{db.closeCount++;close();};databases.push(db);return db;}};
    const engine=deferred();const { tips, ...clientStrings } = strings[lang];
    const context={document:doc,console,t:clientStrings,pageLang:lang,innerWidth:width,Uint8Array,Promise,Blob,setTimeout(){},URL:{createObjectURL(blob){const url='blob:fixture-'+urls.size;urls.set(url,blob);return url;},revokeObjectURL(){}},initSqlJs:()=>engine.promise,ztPersist:{clear:slug=>cleared.push(slug)},_slug:'sqlite-viewer'};context.window=context;
    vm.createContext(context);if(shellFirst)vm.runInContext(shortcut,context);vm.runInContext(pageScript,context);if(!shellFirst)vm.runInContext(shortcut,context);
    function load(name='data.sqlite',data=bytes,size=data.byteLength){const head=deferred(),body=deferred();let reads=0;const file={name,size,slice:()=>({arrayBuffer:()=>head.promise}),arrayBuffer:()=>{reads++;return body.promise;}};get('sqv-file-input').files=[file];get('sqv-file-input').dispatch('change');return{head,body,file,readyHead(){head.resolve(data.slice(0,100).buffer);},readyBody(){body.resolve(data.slice().buffer);},get reads(){return reads;}};}
    async function ready(job){job.readyHead();await settle();if(scripts.at(-1))scripts.at(-1).onload();engine.resolve(trackedSQL);job.readyBody();await settle();}
    function key(focus='sqv-sql'){(focus==='outside'?body:get(focus)).focus();return doc.dispatch('keydown',{key:'l',ctrlKey:true});}
    function snapshot(){return{layout:get('sqv-layout').hidden,meta:get('sqv-meta').hidden,drop:get('sqv-dropzone').hidden,name:get('sqv-meta-name').textContent,status:get('sqv-status').textContent,sql:get('sqv-sql').value,rows:get('sqv-rows').innerHTML,result:get('sqv-result').innerHTML,resultHidden:get('sqv-result-wrap').hidden};}
    return{get,doc,scripts,engine,trackedSQL,databases,downloads,cleared,reveals,load,ready,key,snapshot,dispose(){for(const db of databases)if(!db.closeCount)db.close();}};
  }
  {
    const p=page();await p.ready(p.load('positive.sqlite'));
    equal('page opens a real SQLite database',p.get('sqv-layout').hidden,false);
    equal('page renders real rows',p.get('sqv-rows').innerHTML.includes('<td class="sqv-num">1</td>'),true);
    p.get('sqv-sql').value='SELECT COUNT(*) AS total FROM users';p.get('sqv-run').click();
    equal('page query computes with sql.js',p.get('sqv-result').innerHTML.includes('250'),true);
    p.get('sqv-export-query').click();equal('page CSV download bytes',await p.downloads[0].blob.text(),'total\r\n250\r\n');p.dispose();
  }
  for(const lang of ['en','zh','ja','ko'])for(const shellFirst of [false,true]){
    const p=page(lang,shellFirst);await p.ready(p.load());p.get('sqv-run').click();const event=p.key();
    equal(`${lang} shortcut hides loaded database, shellFirst=${shellFirst}`,p.get('sqv-layout').hidden,true);
    equal(`${lang} shortcut closes actual database`,p.databases[0].closeCount,1);
    equal(`${lang} shortcut clears output bytes`,[p.get('sqv-rows').innerHTML,p.get('sqv-result').innerHTML],['','']);
    equal(`${lang} shortcut leaves empty input`,p.get('sqv-sql').value,'');equal(`${lang} shared persistence clear retained`,p.cleared,['sqlite-viewer']);equal(`${lang} shortcut default prevented`,event.defaultPrevented,true);p.dispose();
  }
  for(const phase of ['header','body','engine'])for(const action of ['reset','shortcut','new','invalid']){
    const p=page(),old=p.load('old.sqlite');
    if(phase!=='header'){old.readyHead();await settle();if(phase==='body'){p.scripts[0].onload();p.engine.resolve(p.trackedSQL);await settle();}else old.readyBody();}
    if(action==='reset')p.get('sqv-reset').click();if(action==='shortcut')p.key('sqv-dropzone');if(action==='new')await p.ready(p.load('new.sqlite'));if(action==='invalid'){const bad=p.load('bad.sqlite',new Uint8Array(100));bad.readyHead();await settle();}
    const before=p.snapshot(),count=p.databases.length;old.readyHead();await settle();if(p.scripts[0])p.scripts[0].onload();p.engine.resolve(p.trackedSQL);old.readyBody();await settle();
    equal(`late ${phase} cannot replace state after ${action}`,p.snapshot(),before);
    equal(`late ${phase} avoids allocating old database after ${action}`,p.databases.length,count);p.dispose();
  }
  for(const phase of ['header','body'])for(const canceled of [false,true]){
    const p=page(),old=p.load('unreadable.sqlite'),unhandled=[];const collect=e=>unhandled.push(String(e));process.on('unhandledRejection',collect);
    try{
      if(phase==='body'){old.readyHead();await settle();p.scripts[0].onload();p.engine.resolve(p.trackedSQL);}
      if(canceled)p.get('sqv-reset').click();old[phase==='header'?'head':'body'].reject(new Error('fixture read failed'));await settle();await new Promise(r=>setImmediate(r));
      equal(`rejected ${phase} is handled, canceled=${canceled}`,unhandled,[]);
      equal(`rejected ${phase} reports file failure, canceled=${canceled}`,p.get('sqv-status').textContent,canceled?'':strings.en.openFailed.replace('{msg}','fixture read failed'));
    }finally{process.removeListener('unhandledRejection',collect);p.dispose();}
  }
  {
    const p=page(),old=p.load('old.sqlite');old.readyHead();await settle();p.get('sqv-reset').click();const before=p.snapshot();p.scripts[0].onerror();old.readyBody();await settle();equal('late engine rejection leaves reset status clear',p.snapshot(),before);p.dispose();
  }
  {
    const p=page();await p.ready(p.load());p.get('sqv-sql').value='SELECT 42 AS value';p.get('sqv-run').click();p.get('sqv-sql').value='';p.get('sqv-run').click();
    equal('empty SQL invalidates old result',p.get('sqv-result-wrap').hidden,true);equal('empty SQL disables old result export',p.get('sqv-export-query').disabled,true);equal('empty SQL clears old output bytes',p.get('sqv-result').innerHTML,'');p.dispose();
  }
  for(const shellFirst of [false,true]){
    const p=page('en',shellFirst);await p.ready(p.load());p.get('sqv-objects').querySelector('.sqv-object').focus();p.doc.dispatch('keydown',{key:'l',ctrlKey:true});
    equal(`CtrlL from dynamic object retains shared persistence clear, shellFirst=${shellFirst}`,p.cleared,['sqlite-viewer']);
    equal('CtrlL closes database from dynamic object',p.databases[0].closeCount,1);p.dispose();
  }
  {
    const p=page(),first=p.load('offline.sqlite');first.readyHead();await settle();p.scripts[0].onerror();first.readyBody();await settle();
    equal('active engine failure retains localized network message',p.get('sqv-status').textContent,strings.en.engineFailed);
    const next=p.load('retry.sqlite');await p.ready(next);equal('engine failure permits retry',p.get('sqv-meta-name').textContent,'retry.sqlite');p.dispose();
  }
  {
    const p=page();await p.ready(p.load('loaded.sqlite'));const good=p.databases[0],bad=p.load('broken.sqlite',new Uint8Array(100));bad.readyHead();await settle();
    equal('invalid new file preserves loaded database',good.closeCount,0);equal('invalid new file does not replace loaded name',p.get('sqv-meta-name').textContent,'loaded.sqlite');
    p.get('sqv-sql').value='SELECT COUNT(*) AS total FROM users';p.get('sqv-run').click();equal('loaded database remains queryable after invalid selection',p.get('sqv-result').innerHTML.includes('250'),true);p.dispose();
  }
  {
    const p=page('en',false,390);await p.ready(p.load());equal('phone open reveals bounded results',p.reveals.at(-1).id,'sqv-results');
    p.get('sqv-results').scrollTop=300;p.get('sqv-sql').value='SELECT 42 AS value';p.get('sqv-run').click();
    equal('new query resets inner result scroll',p.get('sqv-results').scrollTop,0);equal('phone query reveals current result',p.reveals.at(-1).id,'sqv-result-wrap');p.dispose();
  }
  {
    const p=page(),bad=p.load('bad.sqlite',new Uint8Array(100));bad.readyHead();await settle();equal('invalid header never loads SQLite engine',p.scripts.length,0);equal('invalid header never reads full file',bad.reads,0);p.dispose();
  }
  {
    const p=page();await p.ready(p.load());const before=p.snapshot();p.key('outside');equal('outside CtrlL leaves database loaded',p.snapshot(),before);equal('outside CtrlL does not close database',p.databases[0].closeCount,0);p.dispose();
  }
}

// ---------- v2 page layout ----------
{
  const before={passes,failures},check=(name,condition)=>equal(name,!!condition,true);
  const template=source.slice(source.indexOf('\n---\n')+5,source.indexOf('<script')).trim();
  const script=source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const css=source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g,'').replace(/<\/?style\b[^>]*>/g,'');
  const rules=selector=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].split(',').some(s=>s.trim()===selector)).map(m=>m[2]);
  const prop=(body,key,value)=>new RegExp('(?:^|;)\\s*'+key+'\\s*:\\s*'+value+'\\s*(?:;|$)').test(body);
  check('analyze layout registered',/'sqlite-viewer':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
  check('shell is direct root',/^<div class="sqv-shell">/.test(template));
  check('root flex column can shrink',rules('.sqv-shell').some(r=>prop(r,'display','flex')&&prop(r,'flex-direction','column')&&prop(r,'min-height','0')));
  check('drop uses shared empty state',/class="sqv-dropzone zt-empty-drop"/.test(template));
  check('loaded layout keeps flex chain',rules('.sqv-layout:not([hidden])').some(r=>prop(r,'flex','1\\s+1\\s+0')&&prop(r,'min-height','0')));
  check('full-width results have positive internal scroll area',rules('.sqv-results').some(r=>prop(r,'flex','1\\s+1\\s+0')&&prop(r,'min-width','0')&&prop(r,'min-height','280px')&&prop(r,'overflow','auto')));
  check('results have fixed mobile height',rules('.sqv-results').some(r=>prop(r,'flex','none')&&prop(r,'height','28rem')&&prop(r,'min-height','0')));
  check('query and table rows have fixed internal heights',rules('.sqv-results > #sqv-result-wrap').some(r=>prop(r,'height','18rem'))&&rules('.sqv-rows-wrap').some(r=>prop(r,'height','18rem')));
  check('query editor keeps bounded height',rules('.sqv-sql').some(r=>prop(r,'height','6rem')&&prop(r,'resize','none')));
  check('status stays visible and has reserved height',rules('.sqv-shell .tool-status').some(r=>prop(r,'height','3em')&&prop(r,'overflow','auto'))&&rules('.sqv-shell .tool-status.none').some(r=>prop(r,'display','block')));
  check('results accessible by keyboard',/id="sqv-results" tabindex="0" role="region" aria-label=\{T.results\}/.test(template));
  check('controls and SQL precede full-width results',template.indexOf('id="sqv-sql"')<template.indexOf('id="sqv-results"')&&template.indexOf('id="sqv-run"')<template.indexOf('id="sqv-results"'));
  check('860 stacks browser and 640 adjusts phone controls',/@media\s*\(max-width:\s*860px\)/.test(css)&&/@media\s*\(max-width:\s*640px\)/.test(css));
  check('hidden attributes retain precedence',/\.sqv-shell \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
  check('dynamic grids keep global styles',/<style is:global>/.test(source)&&css.includes('.tool-page .sqv-grid td')&&css.includes('.sqv-object'));
  check('structure keeps original open default',/<details class="sqv-structure" id="sqv-structure" open>/.test(template));
  check('network/privacy note stays directly visible',/<p class="sqv-hint sqv-engine-note">\{T.engineNote\}<\/p>/.test(template));
  check('in-memory mutation consequence stays directly visible',/<p class="sqv-hint">\{T.sqlHint\}<\/p>/.test(template));
  check('runtime i18n is replaced by build-time output',!source.includes('data-i18n')&&!script.includes('STRINGS')&&/define:vars=\{\{ t: CLIENT_T, pageLang: lang \}\}/.test(source));
  check('no persistence APIs introduced',!/localStorage|sessionStorage|indexedDB|document\.cookie|ztPersist\.save/.test(script));
  check('same-site lazy engine paths preserved',script.includes("s.src = '/sql-js/sql-wasm.js'")&&script.includes("return '/sql-js/' + f"));
  const buttons=[...template.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);
  equal('all existing button identities retained',buttons.map(a=>/\bid="([^"]+)"/.exec(a)?.[1]).sort(),['sqv-reset','sqv-prev','sqv-next','sqv-export-table','sqv-run','sqv-export-query'].sort());
  const keys=['open','reset','objects','structure','paging','sql','export','values'].sort();
  const tips=[...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  equal('eight control tips',tips.map(m=>/id="sqv-tip-([^"]+)"/.exec(m[1])?.[1]).sort(),keys);
  for(const tip of tips){const key=/id="sqv-tip-([^"]+)"/.exec(tip[1])[1];check(key+' tip is localized',/lang=\{lang\}/.test(tip[1])&&/(?:about|text)=\{T\.\w+\}/.test(tip[1])&&tip[2]==='{TIPS.'+key+'}');}
  const STRINGS=new Function(source.slice(source.indexOf('const STRINGS = '),source.indexOf('\nconst T = STRINGS[lang]'))+';return STRINGS;')();
  for(const lang of ['en','zh','ja','ko']){
    const strings=STRINGS[lang];equal(lang+' STRINGS keys match en',Object.keys(strings).sort(),Object.keys(STRINGS.en).sort());equal(lang+' tip keys match',Object.keys(strings.tips).sort(),keys);
    for(const key of keys)check(lang+'.'+key+' tip is nonempty plain text',typeof strings.tips[key]==='string'&&strings.tips[key].length>0&&!/<[^>]*>|\n/.test(strings.tips[key]));
    const client=vm.runInNewContext(source.slice(source.indexOf('const T = STRINGS[lang];'),source.indexOf('\n---',source.indexOf('const T = STRINGS[lang];')))+';({TIPS,CLIENT_T})',{STRINGS,lang});
    equal(lang+' client excludes only tips',Object.keys(client.CLIENT_T).sort(),Object.keys(strings).filter(k=>k!=='tips').sort());check(lang+' tip text absent from serialized client',Object.values(client.TIPS).every(tip=>!JSON.stringify(client.CLIENT_T).includes(JSON.stringify(tip))));
    const mdx=readFileSync(join(root,'src/content/tools/sqlite-viewer',lang+'.mdx'),'utf8'),[,meta,body]=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx),{steps}=loadYaml(meta);
    check(lang+' steps within plain-text limits',Array.isArray(steps)&&steps.length>0&&steps.length<=8&&steps.every(s=>typeof s==='string'&&s.trim()&&s.length<=280&&!/<[^>]*>/.test(s))&&steps.join('').length<=1200);
    check(lang+' usage removed and scope retained',!/<h2>(How to inspect a SQLite file|使用步骤|使い方|사용 방법)<\/h2>/.test(body)&&/<h2>(Scope|范围|対応範囲|지원 범위)<\/h2>/.test(body));
    equal(lang+' MDX content contract', contractProblems('sqlite-viewer', lang), '');
  }
  console.log(`v2 page layout: ${passes-before.passes} passed, ${failures-before.failures} failed`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
