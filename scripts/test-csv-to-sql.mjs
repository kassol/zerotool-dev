// CSV to SQL — leading zeros stay text, MySQL backslashes are escaped, extra cells are kept,
// optional CREATE TABLE
//
// Read:  src/components/tools/CsvToSqlTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source);
//        node_modules/sql.js (SQLite compiled to WebAssembly, already a dependency of sqlite-viewer);
//        src/content/tools/csv-to-sql/*.mdx (input / output <pre> pairs after {/* sql: … */} markers)
// Write: stdout only (test results)
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

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
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
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
    eq(lang + ' page example ' + n, tpl(m[3]), conv(tpl(m[2]), JSON.parse(m[1])).sql);
  }
  check(lang + ' page has at least 2 checked examples', n >= 2, n);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
