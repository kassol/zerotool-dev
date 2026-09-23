// SQLite Viewer — engine regression test
//
// Read:  src/components/tools/SqliteViewerTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); node_modules/sql.js (the same engine the page loads)
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
