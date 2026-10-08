// CSV to SQL — leading zeros stay text, MySQL backslashes are escaped, extra cells are kept,
// optional CREATE TABLE
//
// Read:  src/components/tools/CsvToSqlTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source);
//        node_modules/sql.js (SQLite compiled to WebAssembly, already a dependency of sqlite-viewer);
//        src/content/tools/csv-to-sql/*.mdx (input / output <pre> pairs after {/* sql: … */} markers)
// Also reads ToolLayout.astro and executes the complete page with controlled DOM/time/clipboard/FileReader.
// Write: stdout and temporary CSV fixtures under os.tmpdir(), removed after the test.
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defects: `02134` was written as the number 2134, so the leading zero was lost
// on import; MySQL output escaped only single quotes, and MySQL's default mode reads `\` in a string
// literal as an escape (MySQL 8.4 manual, "String Literals", Table 11.1), so `C:\temp\new` was stored
// with a tab and a newline; cells beyond the header were dropped; there was no CREATE TABLE.
// SQLite output is executed with sql.js and read back; MySQL and PostgreSQL literals are decoded with
// independent decoders written from the manuals (MySQL Table 11.1; PostgreSQL 4.1.2.1 with
// standard_conforming_strings on, the default since 9.1) and compared with the CSV values,
// including 400 random rows with quotes, backslashes, commas, line breaks and non-ASCII text.
//
// Run: node scripts/test-csv-to-sql.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPage, readComponent, frontmatterStrings } from './astro-page-harness.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { contractProblems, annotations, fencedBlocks } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/CsvToSqlTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CsvToSqlTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { csvToSql, parseCsv };')();

const initSqlJs = require('sql.js');
const SQL = await initSqlJs({ locateFile: (f) => join(root, 'node_modules/sql.js/dist', f) });

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
const conv = (csv, o) => E.csvToSql(csv, Object.assign({ dialect: 'sqlite', table: 't', mode: 'batch', createTable: false }, o || {}));

// ---------- independent literal decoders ----------
// MySQL 8.4 Reference Manual 11.1.1 String Literals, Table 11.1 (NO_BACKSLASH_ESCAPES off).
const MYSQL_ESC = { 0: '\0', "'": "'", '"': '"', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', '\\': '\\' };
function readLiterals(sql, mysql) {
  // returns every value in VALUES (...) lists as JS values: strings, numbers (as source text), null
  const out = [];
  let i = sql.indexOf('VALUES');
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= sql.length) throw new Error('unterminated literal');
        const d = sql[i];
        if (mysql && d === '\\') { const n = sql[i + 1]; s += n in MYSQL_ESC ? MYSQL_ESC[n] : n; i += 2; continue; }
        if (d === "'") { if (sql[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += d; i++;
      }
      out.push(s);
      continue;
    }
    if (sql.startsWith('NULL', i)) { out.push(null); i += 4; continue; }
    const m = /^-?\d+(\.\d+)?/.exec(sql.slice(i));
    if (m && /[(\s,]/.test(sql[i - 1])) { out.push({ num: m[0] }); i += m[0].length; continue; }
    i++;
  }
  return out;
}

// ---------- the reported defects ----------
{
  const r = conv('zip,city\n02134,Boston\n10001,New York');
  eq('leading zero keeps the whole column as text', r.sql, 'INSERT INTO "t" ("zip", "city") VALUES\n  (\'02134\', \'Boston\'),\n  (\'10001\', \'New York\');');
  const db = new SQL.Database();
  db.run('CREATE TABLE "t" ("zip" TEXT, "city" TEXT);');
  db.run(r.sql);
  eq('SQLite reads 02134 back', db.exec('SELECT zip FROM t')[0].values, [['02134'], ['10001']]);
  db.close();
}
{
  const csv = 'path\n"C:\\temp\\new"';
  const my = conv(csv, { dialect: 'mysql' }).sql;
  eq('MySQL escapes backslashes', my, "INSERT INTO `t` (`path`) VALUES\n  ('C:\\\\temp\\\\new');");
  eq('MySQL literal decodes to the CSV value', readLiterals(my, true), ['C:\\temp\\new']);
  eq('PostgreSQL keeps single backslashes', conv(csv, { dialect: 'postgresql' }).sql, 'INSERT INTO "t" ("path") VALUES\n  (\'C:\\temp\\new\');');
  eq('SQLite keeps single backslashes', readLiterals(conv(csv).sql, false), ['C:\\temp\\new']);
}
{
  const r = conv('a,b\n1,2,3,4\n5,6');
  eq('extra cells become column_3, column_4', r.sql, 'INSERT INTO "t" ("a", "b", "column_3", "column_4") VALUES\n  (1, 2, 3, 4),\n  (5, 6, NULL, NULL);');
  eq('added columns reported', r.addedColumns, ['column_3', 'column_4']);
}
eq('no added columns normally', conv('a\n1').addedColumns, []);
{
  const r = conv('a,column_2\n1,2,3');
  eq('added name avoids an existing header', r.addedColumns, ['column_3']);
}

// ---------- quote rule (S2-7, approved engine change, same as csv-json and csv-to-markdown) ----------
// A double quote opened a quoted section anywhere in a field, so `5" pipe,x` swallowed the comma and
// the next line, and a quote that was never closed took the rest of the input with no error.
{
  eq('quote inside an unquoted field is text', conv('a,b\n5" pipe,x\ny,z').sql, 'INSERT INTO "t" ("a", "b") VALUES\n  (\'5" pipe\', \'x\'),\n  (\'y\', \'z\');');
  eq('x"y"z stays as written', readLiterals(conv('a\nx"y"z').sql, false), ['x"y"z']);
  eq('unclosed quote is an error with its line', conv('a,b\n1,2\n"x,y\nz,w'), { error: 'unclosed', line: 3 });
  eq('unclosed quote in the header is line 1', conv('"a,b\n1,2'), { error: 'unclosed', line: 1 });
  eq('quoted fields still work', readLiterals(conv('a,b\n"x, ""y""",2').sql, false), ['x, "y"', { num: '2' }]);
}
{
  // The three parseCsv copies agree on random input, including the unclosed-quote error.
  const { execFileSync } = await import('node:child_process');
  const sourceOf = (rel) => {
    const own = readFileSync(join(root, rel), 'utf8');
    if (own.includes('quoteStart')) return own;
    try { const m = execFileSync('git', ['show', 'master:' + rel], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return m.includes('quoteStart') ? m : null; } catch { return null; }
  };
  const fnOf = (src) => {
    const i = src.indexOf('function parseCsv(');
    const indent = src.slice(src.lastIndexOf('\n', i) + 1, i);
    const end = src.indexOf('\n' + indent + '}\n', i);
    return new Function(src.slice(i, end + indent.length + 2) + '\nreturn parseCsv;')();
  };
  const others = [['csv-json', 'src/components/tools/CsvJsonTool.astro', (r) => r.rows], ['csv-to-markdown', 'src/components/tools/CsvToMarkdownTool.astro', (r) => r]];
  const run = (fn, pick, s) => { try { return pick(fn(s)); } catch (e) { return 'ERR ' + e.message; } };
  let seed = 11;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const parts = ['"', '""', ',', '\n', '\r\n', '\r', 'a', 'b', ' ', '中'];
  const inputs = [];
  for (let k = 0; k < 5000; k++) { let s = ''; const n = 1 + rnd(12); for (let j = 0; j < n; j++) s += parts[rnd(parts.length)]; inputs.push(s); }
  for (const [name, rel, pick] of others) {
    const src = sourceOf(rel);
    if (!src) { console.log('SKIP: ' + name + ' parseCsv with the quote rule is not on this checkout or master'); continue; }
    const theirs = fnOf(src);
    const diffs = inputs.filter((s) => JSON.stringify(run(E.parseCsv, (r) => r, s)) !== JSON.stringify(run(theirs, pick, s)));
    check('parseCsv gives the same rows and errors as ' + name + ' (5,000 random inputs)', diffs.length === 0, JSON.stringify(diffs.slice(0, 3)));
  }
}

// ---------- number detection ----------
const NUMS = { '42': 42, '-7': -7, '0': 0, '3.14': 3.14, '0.5': 0.5, '-0.25': -0.25, '123456789012345': 123456789012345 };
for (const [v] of Object.entries(NUMS)) eq('number ' + v + ' unquoted', readLiterals(conv('n\n' + v).sql, false), [{ num: v }]);
for (const v of ['02134', '00', '-012', '+1', '1e5', '.5', '1.', '1,000', '0x1F', '1234567890123456', '12345678901234567890', '1.50 ', ' 7']) {
  const csv = 'n\n"' + v + '"';
  eq('text ' + JSON.stringify(v) + ' quoted', readLiterals(conv(csv).sql, false), [v]);
}
eq('a column with any text quotes its numbers too', readLiterals(conv('v\n1\nabc\n2').sql, false), ['1', 'abc', '2']);
eq('empty cell is NULL', readLiterals(conv('a,b\n,x').sql, false), [null, 'x']);

// ---------- quoting ----------
eq("O'Brien", conv("name\nO'Brien").sql, 'INSERT INTO "t" ("name") VALUES\n  (\'O\'\'Brien\');');
eq('identifier quoting (SQLite / PostgreSQL)', conv('"a""b"\n1').sql.split('\n')[0], 'INSERT INTO "t" ("a""b") VALUES');
eq('identifier quoting (MySQL)', conv('a`b\n1', { dialect: 'mysql' }).sql.split('\n')[0], 'INSERT INTO `t` (`a``b`) VALUES');
eq('individual mode', conv('a\n1\n2', { mode: 'individual' }).sql, 'INSERT INTO "t" ("a") VALUES (1);\nINSERT INTO "t" ("a") VALUES (2);');

// ---------- CREATE TABLE ----------
const SAMPLE = 'id,name,zip,price,note,big\n1,Ann,02134,9.5,,3000000000\n2,"O\'Brien, Pat",10001,12,"line1\nline2",4000000000';
{
  const r = conv(SAMPLE, { createTable: true });
  eq('SQLite CREATE TABLE', r.sql.split('\n')[0], 'CREATE TABLE "t" ("id" INTEGER, "name" TEXT, "zip" TEXT, "price" REAL, "note" TEXT, "big" INTEGER);');
  const db = new SQL.Database();
  db.run(r.sql);
  const res = db.exec('SELECT id, typeof(id), name, zip, typeof(zip), price, typeof(price), note, big FROM t ORDER BY id')[0].values;
  eq('SQLite round trip', res, [
    [1, 'integer', 'Ann', '02134', 'text', 9.5, 'real', null, 3000000000],
    [2, 'integer', "O'Brien, Pat", '10001', 'text', 12, 'real', 'line1\nline2', 4000000000],
  ]);
  db.close();
}
eq('MySQL CREATE TABLE', conv(SAMPLE, { dialect: 'mysql', createTable: true }).sql.split('\n')[0],
  'CREATE TABLE `t` (`id` INT, `name` TEXT, `zip` TEXT, `price` DOUBLE, `note` TEXT, `big` BIGINT);');
eq('PostgreSQL CREATE TABLE', conv(SAMPLE, { dialect: 'postgresql', createTable: true }).sql.split('\n')[0],
  'CREATE TABLE "t" ("id" INTEGER, "name" TEXT, "zip" TEXT, "price" DOUBLE PRECISION, "note" TEXT, "big" BIGINT);');
eq('no CREATE TABLE by default', conv(SAMPLE).sql.startsWith('INSERT'), true);

// ---------- random round trip ----------
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const pieces = ["'", '"', '\\', ',', '\n', '\r\n', ' ', 'a', 'Z', 'é', '中', '😀', '0', '7', '%', '_', '\t', "''", '\\n'];
  const rows = [];
  for (let r = 0; r < 400; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) {
      let s = '';
      const n = 1 + Math.floor(rnd() * 8);
      for (let k = 0; k < n; k++) s += pieces[Math.floor(rnd() * pieces.length)];
      row.push(s);
    }
    rows.push(row);
  }
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';
  const csv = 'a,b,c\n' + rows.map((r) => r.map(q).join(',')).join('\n');
  const parsed = E.parseCsv(csv).slice(1);
  eq('random CSV parses back', parsed, rows);
  const plain = (v) => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(v) && v.replace(/\D/g, '').length <= 15;
  const numericCol = [0, 1, 2].map((c) => rows.every((r) => plain(r[c])));
  const expected = rows.flatMap((r) => r.map((v, c) => (numericCol[c] ? { num: v } : v)));
  const my = conv(csv, { dialect: 'mysql' }).sql;
  eq('MySQL literals decode to the CSV values (400 rows)', readLiterals(my, true), expected);
  const pg = conv(csv, { dialect: 'postgresql' }).sql;
  eq('PostgreSQL literals decode to the CSV values (400 rows)', readLiterals(pg, false), expected);
  const db = new SQL.Database();
  const lite = conv(csv, { createTable: true }).sql;
  db.run(lite);
  eq('SQLite stores the CSV values (400 rows)', db.exec('SELECT a, b, c FROM t')[0].values.flat().map(String), rows.flat());
  db.close();
}

// ---------- 4-language STRINGS ----------
{
  const m = frontmatterStrings(readComponent('src/components/tools/CsvToSqlTool.astro').frontmatter);
  check('STRINGS block found', !!m);
  if (m) {
    const S = m;
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    check('addedColumns message has {cols}', S.en.addedColumns && S.en.addedColumns.includes('{cols}'));
  }
}

// ---------- examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/csv-to-sql', lang + '.mdx'), 'utf8');
  const re = /\{\/\* sql: (\{.*?\}) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>[\s\S]*?<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g;
  const tpl = (t) => new Function('return `' + t + '`')();
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const opts = JSON.parse(m[1]), csv = tpl(m[2]), sql = tpl(m[3]);
    eq(lang + ' page example ' + n, sql, conv(csv, opts).sql);
    // Execution level (S2-7): every value in the printed SQL reads back as the CSV cell.
    const rows = E.parseCsv(csv.trim()).filter((r) => r.some((c) => c !== ''));
    const width = Math.max(...rows.map((r) => r.length));
    const cells = rows.slice(1).flatMap((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
    const decoded = readLiterals(sql, opts.dialect === 'mysql');
    eq(lang + ' page example ' + n + ' literals decode to the CSV cells', decoded.map((v) => (v === null ? '' : typeof v === 'object' ? v.num : v)), cells);
    if (opts.dialect === 'sqlite') {
      const db = new SQL.Database();
      let got, err = '';
      try {
        // Without CREATE TABLE in the example, create the table the tool would have written.
        if (!opts.createTable) db.run(conv(csv, { ...opts, createTable: true }).sql.split('\n')[0]);
        db.run(sql);
        got = db.exec('SELECT * FROM ' + JSON.stringify(opts.table))[0].values.flat();
      } catch (e) { err = e.message; }
      db.close();
      eq(lang + ' page example ' + n + ' runs in SQLite (sql.js)', err, '');
      if (!err) check(lang + ' page example ' + n + ' SQLite stores the CSV cells', got.length === cells.length && got.every((v, i) => (v === null ? cells[i] === '' : typeof v === 'number' ? v === Number(cells[i]) : v === cells[i])), JSON.stringify(got));
    }
  }
  check(lang + ' page has at least 2 checked examples', n >= 2, n);
}

// Engine hash. S2-7 (2026-10-08) approved changes: quote rule.
eq('engine byte protection', createHash('sha256').update(source.slice(source.indexOf('      '+START_MARK), source.indexOf('      '+END_MARK)+'      '.length+END_MARK.length)).digest('hex'), 'a3e55534be8d2ed09a51f6e978cce3451bd2c65f449f48de5677ac18d60c446f');

// ---------- full page lifecycle: real IIFE and actual shared keydown ----------
// DOM, clipboard promises, FileReader and time are controlled boundaries; conversion code is real.
const sharedSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shared = sharedSource.slice(sharedSource.indexOf("document.addEventListener('keydown'", sharedSource.indexOf('// ── Keyboard shortcuts')), sharedSource.indexOf('// ── Copy button visual feedback'));
const unhandled = [];
const onUnhandled = e => unhandled.push(String(e));
process.on('unhandledRejection', onUnhandled);
const settle = () => new Promise(resolve => setImmediate(resolve));
const copyFailures = { en: 'Copy failed', zh: '复制失败', ja: 'コピー失敗', ko: '복사 실패' };
const s = {"slug": "csv-to-sql", "file": "CsvToSqlTool", "p": "cts", "left": "cts-csv", "right": "cts-sql", "input": "n\n1", "expected": "INSERT INTO `my_table` (`n`) VALUES\n  (1);", "copy": ["cts-copy"], "delay": 300};
function page(lang='en', order='shared-after') {
  const rel='src/components/tools/'+s.file+'.astro', comp=readComponent(rel), source=comp.src;
  const strings=frontmatterStrings(comp.frontmatter)?.[lang];
  const nodes=[], byId=new Map(), docs={}, jobs=new Map(), copies=[], readers=[], tracks=[], cleared=[];
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
  if(strings){const root=doc.querySelector('.cts-wrap');const {tips,...client}=strings;root.dataset={strings:JSON.stringify(client),lang};}
  const setTimeout=(fn,ms=0)=>{const id=++seq;jobs.set(id,{id,fn,ms,due:now+ms});return id;};
  const globals={document:doc,TextDecoder,Event:class{constructor(type){this.type=type;}},setTimeout,clearTimeout:id=>jobs.delete(id),trackTool:(...a)=>tracks.push(a),ztPersist:{clear:slug=>cleared.push(slug)},
    navigator:{clipboard:{writeText(text){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});copies.push({text,resolve,reject});return promise;}}},
    // readAsArrayBuffer: finish(text) hands the UTF-8 bytes of text, finish(Uint8Array) the bytes as given.
    FileReader:class{constructor(){readers.push(this);}readAsText(file){this.file=file;this.mode='text';}readAsArrayBuffer(file){this.file=file;this.mode='buffer';}finish(x){const u8=typeof x==='string'?new TextEncoder().encode(x):x;this.result=this.mode==='buffer'?u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength):(typeof x==='string'?x:new TextDecoder().decode(x));this.onload?.({target:this});}fail(){this.onerror?.({target:this});}}};
  const addShared=()=>vm.runInNewContext(shared,{document:doc,window:globals,_slug:s.slug});
  if(order==='shared-before')addShared();loadPage(rel,{lang,globals});if(order==='shared-after')addShared();
  function advance(ms){const end=now+ms;for(let i=0;i<100;i++){const next=[...jobs.values()].filter(j=>j.due<=end).sort((a,b)=>a.due-b.due||a.id-b.id)[0];if(!next)break;jobs.delete(next.id);now=next.due;next.fn();}now=end;}
  return {get,doc,copies,readers,tracks,cleared,jobs,advance,navigator:globals.navigator,type(id,value){get(id).value=value;get(id).fire('input');},key(id,key='l',mod='ctrlKey'){get(id).focus();return get(id).fire('keydown',{key,[mod]:true});},clear(){this.key(s.left);},golden(){this.type(s.left,s.input);advance(s.delay);},state(){return {left:get(s.left).value,right:get(s.right).value,status:get(s.p+'-status').textContent,statusClass:get(s.p+'-status').className,copy:s.copy.map(id=>({id,label:get(id).textContent,disabled:get(id).disabled}))};},open(file={name:'fixture.csv'}){get('cts-file-input').files=[file];get('cts-file-input').fire('change');return readers.at(-1);}};
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
    for (const action of ['CtrlL', 'same-input', 'new-input', 'new-output', 'new-file']) for (const outcome of ['resolve', 'reject']) {
      p = page(lang); p.golden(); p.get(id).click(); const old = p.copies.at(-1);
      if (action === 'CtrlL') p.key(s.right);
      else if (action === 'same-input') p.type(s.left, s.input);
      else if (action === 'new-input') p.type(s.left, 'n\n2');
      else if (action === 'new-file') p.open();
      else p.get('cts-dialect').fire('change');
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

// Real CSV fixture bytes are isolated under os.tmpdir(); no browser file picker is involved.
const fixtureDir=mkdtempSync(join(tmpdir(),'zerotool-csv-sql-'));
try {
  const files=['old','new'].map((name,i)=>{const path=join(fixtureDir,name+'.csv');writeFileSync(path,'n\n'+(i+1));return {name:name+'.csv',path};});
  for (const lang of ['en','zh','ja','ko']) {
    for (const order of ['shared-before','shared-after']) for(const action of ['CtrlL-sync','CtrlL-after-timers','new-input','new-file']) {
      const p=page(lang,order), reader=p.open(files[0]);
      if(action.startsWith('CtrlL')){p.key('cts-copy','L','metaKey');if(action==='CtrlL-after-timers')p.advance(0);}
      if(action==='new-input')p.type(s.left,'n\n9');
      if(action==='new-file')p.open(files[1]).finish(readFileSync(files[1].path,'utf8'));
      const before=p.state();reader.finish(readFileSync(files[0].path,'utf8'));
      eq(lang+order+action+' old reader cannot write synchronously',p.state(),before);
      if(action==='new-input'){p.advance(300);eq(lang+order+' manual input wins reader',p.get(s.right).value,'INSERT INTO `my_table` (`n`) VALUES\n  (9);');}
      if(action==='new-file')eq(lang+order+' latest file wins',p.get(s.right).value,'INSERT INTO `my_table` (`n`) VALUES\n  (2);');
      if(action.startsWith('CtrlL'))eq(lang+order+action+' table remains cleared by shared shortcut',p.get('cts-table').value,'');
    }
    let p=page(lang); const reader=p.open(files[1]);
    p.get('cts-dialect').value='postgresql';p.get('cts-dialect').fire('change');
    p.type('cts-table','next');reader.finish(readFileSync(files[1].path,'utf8'));
    eq(lang+' pending file honors latest options and table',p.get(s.right).value,'INSERT INTO "next" ("n") VALUES\n  (2);');
    check(lang+' file conversion cancels queued table run',![...p.jobs.values()].some(j=>j.ms===300));
    p=page(lang);p.golden();p.type(s.left,'""');p.advance(300);
    eq(lang+' no data clears prior SQL',p.get(s.right).value,'');check(lang+' no data reports error',p.get('cts-status').classList.contains('error'));
    p.type(s.left,'');p.advance(300);eq(lang+' empty clears error text',p.get('cts-status').textContent,'');check(lang+' empty clears error class',!p.get('cts-status').classList.contains('error'));
    p.golden();eq(lang+' recover real conversion',p.get(s.right).value,s.expected);
    p.get('cts-dialect').value='postgresql';p.get('cts-dialect').fire('change');eq(lang+' dialect immediate',p.get(s.right).value,'INSERT INTO "my_table" ("n") VALUES\n  (1);');
    p.get('cts-mode').value='individual';p.get('cts-mode').fire('change');eq(lang+' individual immediate',p.get(s.right).value,'INSERT INTO "my_table" ("n") VALUES (1);');
    p.get('cts-create').checked=true;p.get('cts-create').fire('change');eq(lang+' CREATE TABLE immediate',p.get(s.right).value,'CREATE TABLE "my_table" ("n" INTEGER);\nINSERT INTO "my_table" ("n") VALUES (1);');
    p.type('cts-table','next');p.advance(300);check(lang+' table name remains automatic',p.get(s.right).value.includes('"next"'));
    p.key('cts-table');eq(lang+' CtrlL preserves dialect/mode/create',[p.get('cts-dialect').value,p.get('cts-mode').value,p.get('cts-create').checked],['postgresql','individual',true]);
    eq(lang+' CtrlL clears CSV, SQL, table and file selection',[p.get(s.left).value,p.get(s.right).value,p.get('cts-table').value,p.get('cts-file-input').value],['','','','']);
  }
} finally { rmSync(fixtureDir,{recursive:true,force:true}); }

// ---------- analytics: one event per committed change (S2-7, 2026-10-08) ----------
// The page used to send csv_to_sql/convert on load (the sample) and after every 0.3 s typing pause.
{
  for (const lang of ['en','zh','ja','ko']) {
    const p = page(lang);
    eq(lang+' no event on page load', p.tracks.length, 0);
    p.type(s.left, 'n\n1'); p.advance(300); p.type(s.left, 'n\n12'); p.advance(300);
    eq(lang+' no event per typing pause', p.tracks.length, 0);
    p.get(s.left).fire('change');
    eq(lang+' one event on CSV change', p.tracks, [['csv_to_sql','convert']]);
    p.get(s.left).fire('change');
    eq(lang+' same input and options are not sent twice', p.tracks.length, 1);
    p.type(s.left, 'n\n7'); p.get(s.left).fire('change');
    eq(lang+' change before the debounce converts first', [p.get(s.right).value, p.tracks.length], ['INSERT INTO `my_table` (`n`) VALUES\n  (7);', 2]);
    p.get('cts-dialect').value='sqlite'; p.get('cts-dialect').fire('change');
    eq(lang+' dialect change sends', p.tracks.length, 3);
    p.get('cts-mode').value='individual'; p.get('cts-mode').fire('change');
    p.get('cts-create').checked=true; p.get('cts-create').fire('change');
    eq(lang+' mode and CREATE TABLE changes send', p.tracks.length, 5);
    p.type('cts-table','orders'); p.advance(300);
    eq(lang+' table typing pause does not send', p.tracks.length, 5);
    p.get('cts-table').fire('change');
    eq(lang+' table change sends', p.tracks.length, 6);
    p.open().finish('n\n9');
    eq(lang+' loaded file sends', p.tracks.length, 7);
    p.type(s.left, ''); p.advance(300); p.get(s.left).fire('change');
    eq(lang+' empty output does not send', p.tracks.length, 7);
    p.type(s.left, 'n\n9'); p.key(s.left); p.type(s.left, 'n\n9'); p.get(s.left).fire('change');
    eq(lang+' after Ctrl+L the same input sends again', p.tracks.length, 8);
  }
}

// ---------- unclosed quote on the page (S2-7 approved engine change) ----------
{
  const S = frontmatterStrings(readComponent('src/components/tools/CsvToSqlTool.astro').frontmatter);
  for (const lang of ['en','zh','ja','ko']) {
    const p = page(lang); p.golden();
    p.type(s.left, 'n\n1\n"x,2\n3'); p.advance(300);
    eq(lang+' unclosed quote is reported with its line and clears the SQL', [p.get('cts-status').textContent, p.get('cts-status').classList.contains('error'), p.get(s.right).value], [(S[lang].errUnclosed || 'errUnclosed').replace('{line}', '3'), true, '']);
    p.get(s.left).fire('change');
    eq(lang+' no event for an error', p.tracks.length, 0);
  }
}

// ---------- uploaded files must be UTF-8 (S2-7, 2026-10-08) ----------
// FileReader.readAsText(file, 'UTF-8') turned every byte that is not UTF-8 into U+FFFD, so a
// Shift_JIS or GBK CSV saved by Excel became SQL full of replacement characters with no warning.
{
  const fileMsgs = frontmatterStrings(readComponent('src/components/tools/CsvToSqlTool.astro').frontmatter);
  const fmtMsg = (t, o) => t.replace('{offset}', String(o));
  // "id,名前\n1,山田" in Shift_JIS (名 96 BC, 前 91 4F, 山 8E 52, 田 93 63) and GBK (名 C3 FB, 前 C7 B0)
  const sjis = Uint8Array.from([0x69,0x64,0x2c,0x96,0xbc,0x91,0x4f,0x0a,0x31,0x2c,0x8e,0x52,0x93,0x63]);
  const gbk = Uint8Array.from([0x69,0x64,0x2c,0xc3,0xfb,0xc7,0xb0,0x0a,0x31,0x2c,0x41]);
  const utf16 = Uint8Array.from([0xff,0xfe,0x61,0x00,0x0a,0x00,0x31,0x00]);
  const binary = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
  const utf8bom = Uint8Array.from([0xef,0xbb,0xbf,...new TextEncoder().encode('名前,年齢\n山田,30')]);
  for (const lang of ['en','zh','ja','ko']) {
    const S = fileMsgs?.[lang] || {};
    for (const [name, bytes, key, offset] of [['Shift_JIS', sjis, 'fileNotUtf8', 3], ['GBK', gbk, 'fileNotUtf8', 3], ['UTF-16LE', utf16, 'fileUtf16', 0], ['binary', binary, 'fileBinary', 8]]) {
      const p = page(lang); p.golden(); const before = [p.get(s.left).value, p.get(s.right).value];
      p.open({ name: 'x.csv' }).finish(bytes);
      eq(lang+' '+name+' file is refused in the page language', [p.get('cts-status').textContent, p.get('cts-status').classList.contains('error')], [fmtMsg(S[key] || key, offset), true]);
      eq(lang+' '+name+' file leaves CSV Input and SQL unchanged', [p.get(s.left).value, p.get(s.right).value], before);
      check(lang+' '+name+' file sends no event', p.tracks.length === 0);
    }
    const nul = Uint8Array.from([0x61,0x2c,0x62,0x0a,0x31,0x00,0x32]);
    let p = page(lang); p.golden(); p.open().finish(nul);
    eq(lang+' NUL byte is a binary file', p.get('cts-status').textContent, fmtMsg(S.fileBinary || 'fileBinary', 5));
    p = page(lang); p.open().finish(utf8bom);
    eq(lang+' UTF-8 file with BOM loads without the BOM', [p.get(s.left).value, p.get(s.right).value], ['名前,年齢\n山田,30', 'INSERT INTO `my_table` (`名前`, `年齢`) VALUES\n  (\'山田\', 30);']);
    p = page(lang); p.golden(); const r = p.open(); r.fail();
    eq(lang+' read error is reported', [p.get('cts-status').textContent, p.get(s.right).value], [S.fileError || 'fileError', s.expected]);
  }
  // The function text up to the closing brace at its own indentation, each line trimmed.
  const fnLines = (src, name) => {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) return '';
    const indent = src.slice(src.lastIndexOf('\n', i) + 1, i);
    const end = src.indexOf('\n' + indent + '}\n', i);
    return end < 0 ? '' : src.slice(i, end + indent.length + 2).split('\n').map((l) => l.trim()).join('\n');
  };
  const jf = readFileSync(join(root, 'src/components/tools/json-formatter-engine.js'), 'utf8');
  check('firstBadUtf8 is the same as in json-formatter-engine.js', fnLines(source, 'firstBadUtf8') !== '' && fnLines(source, 'firstBadUtf8') === fnLines(jf, 'firstBadUtf8'));

  // Page examples of a refused file: {/* cts-file: {"hex":"…"} */} followed by a code block that
  // holds the status line the page shows for those bytes, word for word.
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const body = readFileSync(join(root, 'src/content/tools/csv-to-sql', lang + '.mdx'), 'utf8');
    for (const note of annotations(body, 'cts-file')) {
      const bytes = Uint8Array.from(note.spec.hex.match(/../g).map((h) => parseInt(h, 16)));
      const p = page(lang); p.golden(); p.open().finish(bytes);
      const status = p.get('cts-status').textContent;
      check(lang + ' cts-file example shows the page status word for word', status !== '' && fencedBlocks(note.after).some((b) => b.text === status), status);
      if (note.spec.text !== undefined) {
        const enc = { gbk: 'gbk', shift_jis: 'shift_jis', 'euc-kr': 'euc-kr' }[note.spec.encoding];
        eq(lang + ' cts-file bytes are ' + note.spec.encoding + ' for the text shown', new TextDecoder(enc).decode(bytes), note.spec.text);
      }
    }
  }
}


/* ── v2 page layout ── */
const hash = text => createHash('sha256').update(text).digest('hex');
const requireRoot = createRequire(join(root, 'package.json'));
const allStrings = frontmatterStrings(readComponent('src/components/tools/CsvToSqlTool.astro').frontmatter);
const markupSource = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = source.slice(source.indexOf('<script is:inline>') + '<script is:inline>'.length, source.indexOf('</script>'));
// Pinned page script. S2-7 (2026-10-08) changed it outside the engine block: analytics only on
// committed changes, and uploaded files are checked for UTF-8; then the unclosed-quote message (tests above).
eq('reviewed page script is unchanged since S2-7', hash(script), '8cb6b243bf13d0844fb78b1a53928b6579a0aacb1ea509aa09cd7e21c024e1cb');
check('direct zero-minimum flex column root', /^\s*<div class="cts-wrap"/.test(markupSource) && /\.cts-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css));
check('controls then reserved status then panels', /class="cts-(?:toolbar|controls)"[\s\S]*id="cts-status"[\s\S]*class="cts-panels zt-io"/.test(markupSource));
eq('two shared panes', (markupSource.match(/zt-io-pane/g)||[]).length, 2);
check('both editors use zero-basis shared filling', (markupSource.match(/zt-io-fill/g)||[]).length >= 2 && /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(readFileSync(join(root,'src/styles/tool-common.css'),'utf8')));
check('reserved status has fixed height and overflow', /\.cts-status\s*\{[^}]*height: 2\.6rem;[^}]*min-height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css));
check('editors scroll inside bounded layout', /\.cts-box\s*\{[^}]*min-width: 0;[^}]*overflow: auto;/.test(css));
check('860 stacking and 640 touch targets', /@media \(max-width: 860px\)/.test(css) && /@media \(max-width: 640px\)[\s\S]*44px/.test(css));
check('copy failure width remains reserved', /\.cts-head \.btn-copy\s*\{[^}]*min-width: 6\.75rem;/.test(css));
check('tips stay outside labels and buttons', !/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markupSource));
eq('exact bound tip IDs', [...markupSource.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]), ["cts-tip-dialect", "cts-tip-table", "cts-tip-mode", "cts-tip-create", "cts-tip-file", "cts-tip-csv", "cts-tip-copy"]);
check('build-time labels replace runtime i18n', !/data-i18n|var STRINGS|document.documentElement.lang/.test(source));
check('only selected client strings are serialized', /const \{ tips: TIPS, \.\.\.CLIENT \} = T;/.test(source) && /data-strings=\{JSON.stringify\(CLIENT\)\}/.test(markupSource));
eq('registered convert kind', readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8').match(/['"]csv-to-sql['"]\s*:\s*['"]([^'"]+)['"]/)?.[1], 'convert');
const ORIGINAL_CLIENT_STRINGS = {
  "en": {
    "csvLabel": "CSV Input",
    "sqlLabel": "SQL Output",
    "uploadBtn": "Upload CSV",
    "tableNameLabel": "Table Name",
    "dialectLabel": "SQL Dialect",
    "insertModeLabel": "Insert Mode",
    "batchMode": "Batch INSERT",
    "individualMode": "Individual INSERT",
    "copy": "Copy",
    "copied": "Copied!",
    "copyFailed": "Copy failed",
    "placeholder": "name,age,city\nAlice,30,New York\nBob,25,London",
    "errNoData": "No valid data found. Please check your CSV input.",
    "errNoHeader": "CSV must have a header row.",
    "createTable": "Add CREATE TABLE",
    "addedColumns": "Some rows have more cells than the header; added columns: {cols}."
  },
  "zh": {
    "csvLabel": "CSV 输入",
    "sqlLabel": "SQL 输出",
    "uploadBtn": "上传 CSV",
    "tableNameLabel": "表名",
    "dialectLabel": "SQL 方言",
    "insertModeLabel": "插入模式",
    "batchMode": "批量 INSERT",
    "individualMode": "逐行 INSERT",
    "copy": "复制",
    "copied": "已复制！",
    "copyFailed": "复制失败",
    "placeholder": "name,age,city\nAlice,30,New York\nBob,25,London",
    "errNoData": "未找到有效数据，请检查 CSV 输入。",
    "errNoHeader": "CSV 必须包含表头行。",
    "createTable": "添加 CREATE TABLE",
    "addedColumns": "部分行的单元格比表头多，已补充列：{cols}。"
  },
  "ja": {
    "csvLabel": "CSV 入力",
    "sqlLabel": "SQL 出力",
    "uploadBtn": "CSV アップロード",
    "tableNameLabel": "テーブル名",
    "dialectLabel": "SQL 方言",
    "insertModeLabel": "挿入モード",
    "batchMode": "バッチ INSERT",
    "individualMode": "個別 INSERT",
    "copy": "コピー",
    "copied": "コピー済み！",
    "copyFailed": "コピー失敗",
    "placeholder": "name,age,city\nAlice,30,New York\nBob,25,London",
    "errNoData": "データが見つかりません。CSVを確認してください。",
    "errNoHeader": "CSVにはヘッダー行が必要です。",
    "createTable": "CREATE TABLE を追加",
    "addedColumns": "ヘッダーより多いセルがある行のため、列を追加しました：{cols}。"
  },
  "ko": {
    "csvLabel": "CSV 입력",
    "sqlLabel": "SQL 출력",
    "uploadBtn": "CSV 업로드",
    "tableNameLabel": "테이블명",
    "dialectLabel": "SQL 방언",
    "insertModeLabel": "삽입 모드",
    "batchMode": "배치 INSERT",
    "individualMode": "개별 INSERT",
    "copy": "복사",
    "copied": "복사됨!",
    "copyFailed": "복사 실패",
    "placeholder": "name,age,city\nAlice,30,New York\nBob,25,London",
    "errNoData": "유효한 데이터를 찾을 수 없습니다. CSV를 확인하세요.",
    "errNoHeader": "CSV에는 헤더 행이 필요합니다.",
    "createTable": "CREATE TABLE 추가",
    "addedColumns": "헤더보다 셀이 많은 행이 있어 열을 추가했습니다: {cols}."
  }
};
const yaml = requireRoot('js-yaml');
const mdxCompiler = await import(requireRoot.resolve('@mdx-js/mdx'));
for (const lang of ['en','zh','ja','ko']) {
  const S = allStrings[lang], p = page(lang), client = JSON.parse(p.doc.querySelector('.cts-wrap').dataset.strings);
  eq(lang+' original FIX messages and labels unchanged', Object.fromEntries(Object.keys(ORIGINAL_CLIENT_STRINGS[lang]).map(k=>[k,client[k]])), ORIGINAL_CLIENT_STRINGS[lang]);
  eq(lang+' tip key parity', Object.keys(S.tips), ["dialect", "table", "mode", "create", "file", "csv", "copy"]);
  check(lang+' tips are bounded plain text', Object.values(S.tips).every(t=>typeof t==='string'&&t.length>0&&[...t].length<=280&&!/[<>]/.test(t)));
  check(lang+' client payload excludes tips', !Object.hasOwn(client,'tips') && Object.values(S.tips).every(t=>!JSON.stringify(client).includes(t)));
  const text = readFileSync(join(root,'src/content/tools/csv-to-sql',lang+'.mdx'),'utf8');
  const [,front,body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/), data = yaml.load(front);
  eq(lang+' step count', data.steps.length, 6);
  check(lang+' steps within 8/280/1200 before FAQ', data.steps.length<=8&&data.steps.every(s=>typeof s==='string'&&[...s].length<=280)&&data.steps.reduce((n,s)=>n+[...s].length,0)<=1200&&front.indexOf('steps:')<front.indexOf('faqItems:'));
  eq(lang+' MDX content contract', contractProblems('csv-to-sql', lang), '');
  check(lang+' Usage removed', !/<h2>(?:How to Use|How to use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  let error='';try{await mdxCompiler.compile(body);}catch(e){error=String(e);}eq(lang+' MDX compiles',error,'');
}
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const compiled = await transform(source, { filename: join(root, 'src/components/tools/CsvToSqlTool.astro') });
eq('Astro no error diagnostics', compiled.diagnostics.filter(d=>d.severity===1), []);
let compileError='';try{await requireRoot('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compileError=String(e);}eq('Astro generated JavaScript parses',compileError,'');
check('client script excludes all tip bodies', Object.values(allStrings).every(S=>Object.values(S.tips).every(t=>!script.includes(t))));

check('readonly output has placeholder-based empty state', /readonly/.test(markupSource) && /placeholder=" "/.test(markupSource) && /:has\([^)]*:placeholder-shown\)/.test(css));
check('empty output hidden only at stacked width', /@media \(max-width: 860px\)[\s\S]*:has\([^)]*:placeholder-shown\)\s*\{ display: none;/.test(css));
check('no invented Clear or Convert button', !/cts-clear|btn-primary/.test(markupSource));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
