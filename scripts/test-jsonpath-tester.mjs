// JSONPath Tester — RFC 9535 query evaluation and errors for syntax outside the RFC
//
// Read:  src/components/tools/JsonpathTesterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the examples of RFC 9535 (Tables 2, 3, 5, 6, 7, 9, 11, 12, 14, 15, 16, 17) with the
// JSON documents given next to them in the RFC. Before the fix, negative indexes, slices,
// unions, filters on nested paths and filters without parentheses returned "No match" with no
// error. Where the RFC allows more than one order (object members), results are compared as
// multisets. Queries that RFC 9535 does not allow (or that are not well-typed, Table 14) must
// throw a JsonPathError with a position instead of returning an empty result. Also the tool's
// example pills against the sample bookstore JSON.
//
// Guide: tables, error messages and the Python block of src/content/blog/jsonpath-tester-guide/en.mdx
// are recomputed (see the block at the end).
//
// Run: node scripts/test-jsonpath-tester.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonpathTesterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonpathTesterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { jsonpath };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function run(doc, q) {
  try { return E.jsonpath(doc, q); } catch (e) { return { error: e.name + ': ' + e.message }; }
}
// ordered comparison
function q(doc, query, expected) {
  const a = JSON.stringify(run(doc, query));
  const e = JSON.stringify(expected);
  check(query, a === e, 'got ' + a + ', expected ' + e);
}
// multiset comparison (RFC leaves object member order open)
function qs(doc, query, expected) {
  const r = run(doc, query);
  const norm = (x) => Array.isArray(x) ? x.map((v) => JSON.stringify(v)).sort() : x;
  const a = JSON.stringify(norm(r));
  const e = JSON.stringify(norm(expected));
  check(query + ' (any order)', a === e, 'got ' + JSON.stringify(r) + ', expected ' + JSON.stringify(expected));
}
function err(doc, query) {
  let threw = null;
  try { E.jsonpath(doc, query); } catch (e) { threw = e; }
  check('rejects ' + query, threw && threw.name === 'JsonPathError' && typeof threw.pos === 'number',
    threw ? threw.name + ': ' + threw.message : 'no error');
}

// ---------- RFC 9535 Figure 1 / Table 2 ----------
const store = { store: {
  book: [
    { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
    { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
    { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
    { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
  ],
  bicycle: { color: 'red', price: 399 },
} };
const B = store.store.book;
const authors = B.map((b) => b.author);
q(store, '$.store.book[*].author', authors);
q(store, '$..author', authors);
q(store, '$.store.*', [B, store.store.bicycle]);
qs(store, '$.store..price', [8.95, 12.99, 8.99, 22.99, 399]);
q(store, '$..book[2]', [B[2]]);
q(store, '$..book[2].author', ['Herman Melville']);
q(store, '$..book[2].publisher', []);
q(store, '$..book[-1]', [B[3]]);
q(store, '$..book[0,1]', [B[0], B[1]]);
q(store, '$..book[:2]', [B[0], B[1]]);
q(store, '$..book[?@.isbn]', [B[2], B[3]]);
q(store, '$..book[?@.price<10]', [B[0], B[2]]);
check('$..* count', run(store, '$..*').length === 27, 'got ' + run(store, '$..*').length);

// ---------- Table 3: root ----------
q({ k: 'v' }, '$', [{ k: 'v' }]);

// ---------- Table 5: name selector ----------
const t5 = { o: { 'j j': { 'k.k': 3 } }, "'": { '@': 2 } };
q(t5, "$.o['j j']", [{ 'k.k': 3 }]);
q(t5, "$.o['j j']['k.k']", [3]);
q(t5, '$.o["j j"]["k.k"]', [3]);
q(t5, `$["'"]["@"]`, [2]);
q({ 'a\u00e9\ud83c\udc41': 1 }, "$['a\\u00e9\\uD83C\\uDC41']", [1]);

// ---------- Table 6: wildcard ----------
const t6 = { o: { j: 1, k: 2 }, a: [5, 3] };
qs(t6, '$[*]', [{ j: 1, k: 2 }, [5, 3]]);
qs(t6, '$.o[*]', [1, 2]);
qs(t6, '$.o[*, *]', [1, 2, 2, 1]);
q(t6, '$.a[*]', [5, 3]);

// ---------- Table 7: index ----------
q(['a', 'b'], '$[1]', ['b']);
q(['a', 'b'], '$[-2]', ['a']);
q(['a', 'b'], '$[-3]', []);
q(['a', 'b'], '$[2]', []);
q({ 0: 'x' }, '$[0]', []);

// ---------- Table 9: slice ----------
const t9 = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
q(t9, '$[1:3]', ['b', 'c']);
q(t9, '$[5:]', ['f', 'g']);
q(t9, '$[1:5:2]', ['b', 'd']);
q(t9, '$[5:1:-2]', ['f', 'd']);
q(t9, '$[::-1]', ['g', 'f', 'e', 'd', 'c', 'b', 'a']);
q(t9, '$[::0]', []);
q(t9, '$[-2:]', ['f', 'g']);
q(t9, '$[:100]', t9);
q(t9, '$[ 1 : 3 ]', ['b', 'c']);

// ---------- Table 11: comparisons (as filters over {obj, arr}) ----------
const t11 = { obj: { x: 'y' }, arr: [2, 3] };
const cmp = (expr, result) => q(t11, '$[?' + expr + ']', result ? [t11.obj, t11.arr] : []);
cmp('$.absent1 == $.absent2', true);
cmp('$.absent1 <= $.absent2', true);
cmp("$.absent == 'g'", false);
cmp('$.absent1 != $.absent2', false);
cmp("$.absent != 'g'", true);
cmp('1 <= 2', true);
cmp('1 > 2', false);
cmp("13 == '13'", false);
cmp("'a' <= 'b'", true);
cmp("'a' > 'b'", false);
cmp('$.obj == $.arr', false);
cmp('$.obj != $.arr', true);
cmp('$.obj == $.obj', true);
cmp('$.obj != $.obj', false);
cmp('$.arr == $.arr', true);
cmp('$.arr != $.arr', false);
cmp('$.obj == 17', false);
cmp('$.obj != 17', true);
cmp('$.obj <= $.arr', false);
cmp('$.obj < $.arr', false);
cmp('$.obj <= $.obj', true);
cmp('$.arr <= $.arr', true);
cmp('1 <= $.arr', false);
cmp('1 >= $.arr', false);
cmp('1 > $.arr', false);
cmp('1 < $.arr', false);
cmp('true <= true', true);
cmp('true > true', false);

// ---------- Table 12: filters ----------
const t12 = {
  a: [3, 5, 1, 2, 4, 6, { b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }],
  o: { p: 1, q: 2, r: 3, s: 5, t: { u: 6 } },
  e: 'f',
};
const A = t12.a;
q(t12, "$.a[?@.b == 'kilo']", [A[9]]);
q(t12, "$.a[?(@.b == 'kilo')]", [A[9]]);
q(t12, '$.a[?@>3.5]', [5, 4, 6]);
q(t12, '$.a[?@.b]', [A[6], A[7], A[8], A[9]]);
qs(t12, '$[?@.*]', [t12.a, t12.o]);
q(t12, '$[?@[?@.b]]', [t12.a]);
qs(t12, '$.o[?@<3, ?@<3]', [1, 2, 2, 1]);
q(t12, '$.a[?@<2 || @.b == "k"]', [1, A[7]]);
q(t12, '$.a[?match(@.b, "[jk]")]', [A[6], A[7]]);
q(t12, '$.a[?search(@.b, "[jk]")]', [A[6], A[7], A[9]]);
qs(t12, '$.o[?@>1 && @<4]', [2, 3]);
q(t12, '$.o[?@.u || @.x]', [{ u: 6 }]);
q(t12, '$.a[?@.b == $.x]', [3, 5, 1, 2, 4, 6]);
q(t12, '$.a[?@ == @]', A);

// ---------- Section 2.4 functions / Table 14 well-typedness ----------
q([[1, 2], 'ab', [1, 2, 3], { a: 1 }, 5], '$[?length(@) < 3]', [[1, 2], 'ab', { a: 1 }]);
err([], '$[?length(@.*) < 3]');
q([[1], [1, 2], { a: 1 }], '$[?count(@.*) == 1]', [[1], { a: 1 }]);
err([], '$[?count(1) == 1]');
err([], '$[?count(foo(@.*)) == 1]');
q([{ timezone: 'Europe/Paris' }, { timezone: 'Asia/Tokyo' }], "$[?match(@.timezone, 'Europe/.*')]", [{ timezone: 'Europe/Paris' }]);
err([], "$[?match(@.timezone, 'Europe/.*') == true]");
q([{ c: { color: 'red' } }, { c: [{ color: 'red' }, { color: 'blue' }] }], '$[?value(@..color) == "red"]', [{ c: { color: 'red' } }]);
err([], '$[?value(@..color)]');
err([], '$[?bar(@.a)]');
q(['🁁', 'ab'], '$[?length(@) == 1]', ['🁁']);
q(['a\nb', 'axb'], '$[?match(@, "a.b")]', ['axb']);
q(['xaby'], '$[?match(@, "ab")]', []);
q(['xaby'], '$[?search(@, "ab")]', ['xaby']);
q(['a'], '$[?match(@, "(")]', []);
q([{ date: '1974-05-01' }, { date: '1974-06-01' }], '$[?match(@.date, "1974-05-..")]', [{ date: '1974-05-01' }]);
q([{ author: 'Bob' }, { author: 'Rob' }, { author: 'Tom' }], '$[?search(@.author, "[BR]ob")]', [{ author: 'Bob' }, { author: 'Rob' }]);

// ---------- Table 15: child segment ----------
q(t9, '$[0, 3]', ['a', 'd']);
q(t9, '$[0:2, 5]', ['a', 'b', 'f']);
q(t9, '$[0, 0]', ['a', 'a']);

// ---------- Table 16: descendant segment ----------
const t16 = { o: { j: 1, k: 2 }, a: [5, 3, [{ j: 4 }, { k: 6 }]] };
qs(t16, '$..j', [1, 4]);
q(t16, '$..[0]', [5, { j: 4 }]);
qs(t16, '$..[*]', [t16.o, t16.a, 1, 2, 5, 3, t16.a[2], { j: 4 }, { k: 6 }, 4, 6]);
qs(t16, '$..*', [t16.o, t16.a, 1, 2, 5, 3, t16.a[2], { j: 4 }, { k: 6 }, 4, 6]);
q(t16, '$..o', [{ j: 1, k: 2 }]);
qs(t16, '$.o..[*, *]', [1, 2, 2, 1]);
q(t16, '$.a..[0, 1]', [5, 3, { j: 4 }, { k: 6 }]);
{
  // RFC ordering constraints for $..*: arrays in order, nodes before their descendants
  const r = run(t16, '$..*').map((v) => JSON.stringify(v));
  const pos = (v) => r.indexOf(JSON.stringify(v));
  check('$..* keeps 5 before 3 before [...]', pos(5) < pos(3) && pos(3) < pos(t16.a[2]));
  check('$..* keeps {"j":4} before {"k":6} before 4 before 6', pos({ j: 4 }) < pos({ k: 6 }) && pos({ k: 6 }) < pos(4) && pos(4) < pos(6));
}

// ---------- Table 17: null ----------
const t17 = { a: null, b: [null], c: [{}], null: 1 };
q(t17, '$.a', [null]);
q(t17, '$.a[0]', []);
q(t17, '$.a.d', []);
q(t17, '$.b[0]', [null]);
q(t17, '$.b[*]', [null]);
q(t17, '$.b[?@]', [null]);
q(t17, '$.b[?@==null]', [null]);
q(t17, '$.c[?@.d==null]', []);
q(t17, '$.null', [1]);

// ---------- the reported cases on the tool's sample JSON ----------
q(store, '$.store.book[-1].title', ['The Lord of the Rings']);
q(store, '$.store.book[0:2].title', ['Sayings of the Century', 'Sword of Honour']);
q(store, '$.store.book[0,2].title', ['Sayings of the Century', 'Moby Dick']);
q(store, "$.store.book[?@.category == 'fiction' && @.price < 10].title", ['Moby Dick']);
q(store, '$[?@.bicycle.color == "red"].book[0].price', [8.95]);
q(store, "$.store.book[?(@.author == 'J. R. R. Tolkien')].title", ['The Lord of the Rings']);
q(store, '$.store.book[?!@.isbn].title', ['Sayings of the Century', 'Sword of Honour']);
q(store, '$.store.book[?(@.price < 10)]', [B[0], B[2]]);
q(store, '$.store.bicycle.color', ['red']);
q(store, '$.store.book[?@.price > $.store.book[0].price].author', ['Evelyn Waugh', 'Herman Melville', 'J. R. R. Tolkien']);
q(JSON.parse('{"__proto__": 1, "constructor": 2}'), "$['__proto__']", [1]);
q({}, '$.constructor', []);
q({ a: 1 }, '$ .a', [1]);
// tool page examples
q(store, '$.store.book.length', []);
q(store, '$[?length(@.book) > 3]', [store.store]);
q(store, '$.store.book[-1]', [B[3]]);
err(store, '$.store.book[?(@.category in ["fiction"])]');
err(store, '$.store.*~');

// ---------- syntax outside RFC 9535 is an error, not "No match" ----------
[
  '$[01]', '$[-0]', '$.1', '$. a', '$.', '$..', '$[', '$[0', "$['a", '$[]', '$[1,]',
  '$[(@.length-1)]', '$[?(@.a =~ /x/)]', '$[?@.a = 1]', '$[?foo(@)]', '@.a', 'store.book',
  '$[?!@.a == 1]', '$[?@.a && 1]', '$[?1]', '$[?@.* == 1]', '$[?@..a == 1]', '$[?@[0:1] == 1]',
  '$[?(@.a == 1]', "$['\\x']", "$['a\\ud800']", '$[9007199254740992]', '$[?@.a == 01]',
  '$[?length(@.a, 1) == 1]', '$[?True]', '$[?@.a == 1 == 2]', '$.a b', '$[?price < 10]',
].forEach((query) => err(store, query));
{
  let e = null;
  try { E.jsonpath(store, '$.store.book[(@.length-1)]'); } catch (x) { e = x; }
  check('error position points at the script expression', e && e.pos === 13, e && e.pos);
}

// ---------- result / error elements are created with innerHTML ----------
// They have no Astro scope attribute, so their rules must use :global(...) (AGENTS.md rule 11).
{
  const style = source.slice(source.indexOf('<style>'), source.indexOf('</style>'));
  const dynamic = ['jpt-hl-key', 'jpt-hl-str', 'jpt-hl-num', 'jpt-hl-bool', 'jpt-hl-null', 'jpt-error', 'jpt-no-match'];
  dynamic.forEach((cls) => {
    const all = style.match(new RegExp('\\.' + cls + '\\b', 'g')) || [];
    const wrapped = style.match(new RegExp(':global\\(\\.' + cls + '\\)', 'g')) || [];
    check('.' + cls + ' rules use :global()', all.length > 0 && all.length === wrapped.length, wrapped.length + ' of ' + all.length);
  });
}

// ---------- match count text in 4 languages ----------
{
  const EC = new Function(block + '\nreturn { matchCountText };')();
  const labels = {};
  ['en', 'zh', 'ja', 'ko'].forEach((l) => {
    const m = source.match(new RegExp('\\n  ' + l + ": \\{[\\s\\S]*?matchOne: '([^']*)',\\s*matchMany: '([^']*)'"));
    labels[l] = m ? { one: m[1], many: m[2] } : null;
    check('matchOne / matchMany labels in ' + l, !!labels[l]);
  });
  if (labels.en) {
    check('en 1 match', EC.matchCountText(1, labels.en.one, labels.en.many) === '1 match');
    check('en 3 matches', EC.matchCountText(3, labels.en.one, labels.en.many) === '3 matches');
  }
  if (labels.zh) check('zh 3 条匹配', EC.matchCountText(3, labels.zh.one, labels.zh.many) === '3 条匹配');
  if (labels.ja) check('ja 1 件マッチ', EC.matchCountText(1, labels.ja.one, labels.ja.many) === '1 件マッチ');
  if (labels.ko) check('ko 2개 매칭', EC.matchCountText(2, labels.ko.one, labels.ko.many) === '2개 매칭');
  check('count element uses matchCountText', /countEl\.textContent = matchCountText\(/.test(source));
}

// ---------- English page examples and the invalid-JSON message ----------
{
  const EJ = new Function(block + '\nreturn { jsonpath };')();
  const page = readFileSync(join(root, 'src/content/tools/jsonpath-tester/en.mdx'), 'utf8');
  const sample = JSON.parse(source.split('const SAMPLE_JSON = `')[1].split('`')[0]);
  const run = (q) => EJ.jsonpath(sample, q);
  check('page: price < 10 titles', JSON.stringify(run('$.store.book[?@.price < 10].title')) === '["Sayings of the Century","Moby Dick"]');
  check('page: last author', JSON.stringify(run('$.store.book[-1].author')) === '["J. R. R. Tolkien"]');
  check('page: ..price', JSON.stringify(run('$..price')) === '[8.95,12.99,8.99,22.99,19.95]');
  check('page: isbn filter is empty', run('$.store.book[?@.isbn].title').length === 0);
  let msg = '';
  try { run('$.store.book[(@.length-1)]'); } catch (e) { msg = e.message; }
  check('page: script expression message', page.includes(msg) && msg.includes('(at character 14)'));
  check('invalid JSON message set as text', !/innerHTML = '<span class="jpt-error">' \+ INVALID_JSON/.test(source));
}

// ---------- guide (src/content/blog/jsonpath-tester-guide/en.mdx) ----------
// Tables after {/* jp-syntax */}, {/* jp-filters */} and {/* jp-compare */} (ZeroTool column) are
// recomputed with the engine on the document after {/* jp-doc */}; "error" cells must throw a
// JsonPathError and "3 titles" means three results. The jsonpath-ng column and the jp-run Python
// block are rerun when jsonpath-ng 1.8.0 is installed (SKIP otherwise); jsonpath-plus, jsonpath and
// Jayway columns were measured once (see the guide). jp-errors rows must equal the tool's messages.
{
  const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
  const { execFileSync } = await import('node:child_process');
  const rel = 'src/content/blog/jsonpath-tester-guide/en.mdx';
  const text = readFileSync(join(root, rel), 'utf8');
  const doc = JSON.parse(text.match(/\{\/\* jp-doc \*\/\}\s*```json\n([\s\S]*?)```/)[1]);
  const tableAfter = (mark) => {
    const lines = text.slice(text.indexOf(mark)).split('\n').slice(1);
    const first = lines.findIndex((l) => l.startsWith('|'));
    const out = [];
    for (let i = first; i >= 0 && i < lines.length && lines[i].startsWith('|'); i++) out.push(lines[i]);
    return out.slice(2).map((l) => l.slice(2, -2).split(' | ').map((c) => c.trim()));
  };
  const code = (c) => { const m = c.match(/^`([\s\S]*)`$/); return m ? m[1] : null; };
  const evalCell = (q) => { try { return JSON.stringify(E.jsonpath(doc, q)); } catch (e) { return e.name === 'JsonPathError' ? 'error' : 'THROW ' + e.message; } };
  const expectCell = (c) => (c === 'error' ? 'error' : c === '3 titles' ? null : JSON.stringify(JSON.parse(code(c))));
  for (const mark of ['{/* jp-syntax */}', '{/* jp-filters */}']) {
    const rows = tableAfter(mark);
    check('guide ' + mark + ' has rows', rows.length >= 9, rows.length);
    for (const r of rows) eq('guide ' + mark + ' ' + r[0], evalCell(code(r[0])), JSON.stringify(JSON.parse(code(r[2]))));
  }
  const compare = tableAfter('{/* jp-compare */}');
  check('guide comparison table has 16 rows', compare.length === 16, compare.length);
  let ngVersion = null;
  try { ngVersion = execFileSync('python3', ['-c', 'import importlib.metadata as m;print(m.version("jsonpath-ng"))'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { ngVersion = null; }
  const ngOk = ngVersion === '1.8.0';
  if (!ngOk) console.log('SKIP jsonpath-ng checks (installed: ' + (ngVersion || 'none') + ', guide measured 1.8.0)');
  let ng = null;
  if (ngOk) {
    const py = 'import json,sys\nfrom jsonpath_ng.ext import parse\nd=json.loads(sys.argv[1])\nout=[]\nfor q in json.load(sys.stdin):\n    try: out.append(json.dumps([m.value for m in parse(q).find(d)], separators=(",",":")))\n    except Exception: out.append("error")\nprint(json.dumps(out))';
    ng = JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify(doc)], { input: JSON.stringify(compare.map((r) => code(r[0]))) }).toString());
  }
  compare.forEach((r, i) => {
    const q = code(r[0]);
    const got = evalCell(q);
    const want = expectCell(r[1]);
    if (want === null) eq('guide compare ZeroTool ' + q, JSON.parse(got).length, 3);
    else eq('guide compare ZeroTool ' + q, got, want);
    if (ng) {
      const w = expectCell(r[4]);
      if (w === null) eq('guide compare jsonpath-ng ' + q, JSON.parse(ng[i]).length, 3);
      else eq('guide compare jsonpath-ng ' + q, ng[i], w);
    }
  });
  for (const r of tableAfter('{/* jp-errors */}')) {
    let msg = '';
    try { E.jsonpath(doc, code(r[0])); } catch (e) { msg = 'Unsupported syntax: ' + e.message; }
    eq('guide error message ' + r[0], msg, r[1]);
  }
  const run = text.match(/\{\/\* jp-run: \{"lang":"python"\} \*\/\}\s*```python\n([\s\S]*?)```/);
  check('guide has the Python block', !!run);
  if (run && ngOk) {
    const out = execFileSync('python3', ['-c', run[1]]).toString().trim();
    const shown = [...run[1].matchAll(/^# (\$.+)$/gm)].map((x) => x[1]).join('\n');
    eq('guide Python block output matches its comments', out, shown);
  }
  const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion)/mi].filter((re) => re.test(text));
  check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
}

// ---------- real page controls and shared shortcuts ----------
// Run the complete inline IIFE and actual shared keydown in both registration orders.
// parse5 reads the real markup/highlighted HTML; clipboard and timers are local boundaries.
console.log('Existing checks: ' + passes + ' passed, ' + failures + ' failed');
const pageStart = passes;
const requireFromRoot = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = requireFromRoot('parse5');
const labels = vm.runInNewContext(source.slice(source.indexOf('const labels ='), source.indexOf('const L =')) + ';labels;');
const sampleJson = source.match(/const SAMPLE_JSON = `([\s\S]*?)`;/)[1];
const inline = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw Error('Actual shared shortcut not found');
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + ' expected ' + JSON.stringify(b));
const settle = () => new Promise(setImmediate);
const copyErrors = { en: 'Copy failed — retry', zh: '复制失败，请重试', ja: 'コピー失敗・再試行', ko: '복사 실패 — 다시 시도' };
const unhandled = [], onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
function page(lang, sharedFirst = false) {
  const copies = [], timers = [], tracks = [], clears = [], events = {};
  let copyMode = 'pending';
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const match = (el, selector) => selector.split(',').some(s => {
    const token = s.trim(), attrs = [...token.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = token.replace(/\[[^\]]+\]/g, '');
    return (!/^[a-z]/i.test(plain) || el.tagName === plain.match(/^[a-z]+/i)[0].toUpperCase())
      && (!plain.includes('.') || el.className.split(/\s+/).includes(plain.split('.')[1]))
      && attrs.every(m => el.attrs[m[1]] === m[2]);
  });
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attrs: {}, className: '', id: '', text: '', disabled: false, events: {}, _value: null }); }
    get value() { return this._value ?? (this.tagName === 'TEXTAREA' ? this.textContent : this.attrs.value || ''); }
    set value(value) { this._value = String(value); }
    get dataset() { const el = this; return new Proxy({}, { get(_, key) { return el.attrs['data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())]; }, set(_, key, value) { el.attrs['data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())] = String(value); return true; } }); }
    get firstChild() { return this.children[0] || null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this.text = String(value); }
    set innerHTML(value) {
      this.textContent = '';
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(value)).childNodes) this.appendChild(from(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    contains(node) { return node === this || descendants(this).includes(node); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (match(el, selector)) return el; return null; }
    querySelectorAll(selector) { return descendants(this).filter(el => match(el, selector)); }
    addEventListener(type, fn) { (this.events[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const e = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (let el = this; el; el = el.parentNode) for (const fn of el.events[type] || []) fn.call(el, e);
      for (const fn of events[type] || []) fn(e);
      return e;
    }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  function from(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const a of node.attrs || []) { el.attrs[a.name] = a.value; if (a.name === 'class') el.className = a.value; if (a.name === 'id') el.id = a.value; if (a.name === 'disabled') el.disabled = true; }
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(from(child));
    return el;
  }
  const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const markup = source.replace(/^---\n[\s\S]*?\n---\s*/, '').split('<script')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/=\{L\.(\w+)\}/g, (_,key) => '="'+escape(labels[lang][key])+'"').replace(/\{L\.(\w+)\}/g, (_,key) => escape(labels[lang][key])).replace('{SAMPLE_JSON}',escape(sampleJson));
  const body = new Element('body'), widget = body.appendChild(new Element('section')); widget.className = 'tool-widget'; widget.innerHTML = markup;
  const wrap = widget.querySelectorAll('.jpt-wrap')[0], script = wrap.appendChild(new Element('script'));
  const document = { body, activeElement: body, currentScript: script,
    getElementById(id) { return descendants(body).find(el => el.id === id) || null; },
    querySelectorAll(selector) { return descendants(body).filter(el => match(el, selector)); },
    querySelector(selector) { return selector === '.tool-widget .btn-primary' ? null : this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, fn) { (events[type] ??= []).push(fn); }
  };
  const clipboard = { writeText(text) { if (copyMode === 'throw') throw Error('Synchronous denial'); return new Promise((resolve,reject) => copies.push({ text: String(text), resolve, reject })); } };
  const context = vm.createContext({ document, console, navigator: { clipboard }, _slug: 'jsonpath-tester',
    setTimeout(fn, ms) { timers.push({ fn, ms, cancelled: false }); return timers.length; }, clearTimeout(id) { if (timers[id-1]) timers[id-1].cancelled = true; },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) }
  }); context.window = context;
  if (sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(inline, context, { filename: 'JsonpathTesterTool.astro:complete-inline', timeout: 1000 });
  if (!sharedFirst) vm.runInContext(shortcut, context);
  document.currentScript = null;
  const get = id => { const el = document.getElementById(id); if (!el) throw Error('Missing real element '+id); return el; };
  return { get, document, copies, timers, tracks, clears, wrap,
    input(id, value) { get(id).value = value; get(id).dispatch('input'); },
    query(value=1, expr='$.value') { this.input('jpt-json',JSON.stringify({value})); this.input('jpt-expr',expr); },
    key(key='l', mod='ctrlKey', id='jpt-json') { const el = id === 'outside' ? body : get(id); el.focus(); return el.dispatch('keydown',{key,[mod]:true}); },
    copyMode(mode) { copyMode = mode; context.navigator.clipboard = mode === 'missing' ? undefined : clipboard; },
    snapshot() { return [get('jpt-json').value,get('jpt-expr').value,get('jpt-code').textContent,get('jpt-count').textContent,get('jpt-copy').disabled,get('jpt-copy').textContent]; }
  };
}
for (const lang of ['en','zh','ja','ko']) {
  const L = labels[lang];
  eq(lang+' copy failure text',L.copyFailed,copyErrors[lang]);
  for (const sharedFirst of [false,true]) {
    const h = page(lang,sharedFirst);
    eq(lang+' initial actual sample authors',JSON.parse(h.get('jpt-code').textContent),authors);
    h.query(); eq(lang+' query golden',[h.get('jpt-code').textContent,h.get('jpt-count').textContent,h.get('jpt-copy').disabled],['1',L.matchOne.replace('{n}','1'),false]);
    const before = h.snapshot();
    eq(lang+' outside shortcut not prevented',h.key('l','ctrlKey','outside').defaultPrevented,false);eq(lang+' outside shortcut unchanged',h.snapshot(),before);
    eq(lang+' unmodified l unchanged',h.key('l','shiftKey').defaultPrevented,false);eq(lang+' plain shortcut unchanged',h.snapshot(),before);
    h.key('Enter');eq(lang+' no primary CtrlEnter is inert',h.snapshot(),before);
    for (const mod of ['ctrlKey','metaKey']) for (const key of ['l','L']) {
      h.query(); h.get('jpt-copy').click();const pending=h.copies.at(-1);
      check(lang+' inside clear prevents browser default',h.key(key,mod,'jpt-copy').defaultPrevented);
      const empty=['','','','',true,L.copy];eq(lang+' shortcut synchronously clears input/output/count/copy',h.snapshot(),empty);
      eq(lang+' shared persistence clear retained',h.clears.at(-1),'jsonpath-tester');
      pending.resolve();await settle();eq(lang+' old copy after shortcut is inert',h.snapshot(),empty);
      const count=h.copies.length;h.get('jpt-copy').click();h.get('jpt-copy').dispatch('click');eq(lang+' empty export cannot copy',h.copies.length,count);
    }
    h.query(2);eq(lang+' query recovers after clear',h.get('jpt-code').textContent,'2');
    h.input('jpt-json','{"bad":"<img src=x>"');check(lang+' invalid JSON is text and copy disabled',h.get('jpt-copy').disabled&&h.get('jpt-code').textContent.startsWith(L.invalidJson+':'));
    h.query(1,'$.absent');eq(lang+' no match original message',[h.get('jpt-code').textContent,h.get('jpt-copy').disabled],[L.noMatch,true]);
    h.query(1,'');eq(lang+' empty query original semantics',[h.get('jpt-code').textContent,h.get('jpt-count').textContent,h.get('jpt-copy').disabled],['','',true]);
    h.query(1,'$.');check(lang+' unsupported syntax remains visible',h.get('jpt-copy').disabled&&h.get('jpt-code').textContent.startsWith(L.unsupported+':'));
  }
  for (const mode of ['reject','throw','missing']) {
    const h=page(lang);h.query();h.copyMode(mode);let threw=false;try{h.get('jpt-copy').click();}catch{threw=true;}
    if(mode==='reject')h.copies[0].reject(Error('Denied'));await settle();
    check(lang+' '+mode+' copy does not throw',!threw);eq(lang+' '+mode+' current copy failure is localized',h.get('jpt-copy').textContent,copyErrors[lang]);
    h.copyMode('pending');h.get('jpt-copy').click();eq(lang+' '+mode+' retry restores label',h.get('jpt-copy').textContent,L.copy);eq(lang+' '+mode+' copies full result',h.copies.at(-1).text,'1');
    h.copies.at(-1).resolve();await settle();eq(lang+' '+mode+' direct retry succeeds',h.get('jpt-copy').textContent,L.copied);
  }
  const edits={ clear:h=>h.key(), json:h=>h.input('jpt-json','{"value":2}'), expr:h=>h.input('jpt-expr','$'), invalid:h=>h.input('jpt-json','{'), noMatch:h=>h.input('jpt-expr','$.missing'), emptyExpr:h=>h.input('jpt-expr',''), example:h=>h.wrap.querySelectorAll('.jpt-pill')[0].click() };
  for(const [name,edit]of Object.entries(edits))for(const outcome of ['resolve','reject']){
    const h=page(lang);h.query();h.get('jpt-copy').click();const pending=h.copies[0];edit(h);const current=h.snapshot();
    pending[outcome](outcome==='reject'?Error('Old denial'):undefined);await settle();eq(lang+' late '+outcome+' after '+name+' leaves current state',h.snapshot(),current);
  }
  const h=page(lang);h.query([1,2]);h.get('jpt-copy').click();eq(lang+' array copy complete JSON',h.copies[0].text,'[\n  1,\n  2\n]');h.copies[0].resolve();await settle();const oldTimer=h.timers.at(-1);
  h.get('jpt-copy').click();h.copies[1].resolve();await settle();const newTimer=h.timers.at(-1);
  oldTimer.fn();eq(lang+' old real 1500ms timer preserves new feedback',h.get('jpt-copy').textContent,L.copied);
  eq(lang+' timer deadline unchanged',newTimer.ms,1500);newTimer.fn();eq(lang+' new timer restores Copy',h.get('jpt-copy').textContent,L.copy);
  h.get('jpt-copy').click();h.copies.at(-1).resolve();await settle();const stale=h.timers.at(-1);h.input('jpt-expr','$.missing');stale.fn();eq(lang+' timer after new no-match cannot revive copied',h.get('jpt-copy').textContent,L.copy);
  for(const oldOutcome of ['resolve','reject']){
    const p=page(lang);p.query();p.get('jpt-copy').click();p.get('jpt-copy').click();p.copies[1].resolve();await settle();p.copies[0][oldOutcome](Error('Old denial'));await settle();eq(lang+' newest copy wins old '+oldOutcome,p.get('jpt-copy').textContent,L.copied);
  }
}
await settle();eq('no unhandled copy rejections',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
eq('protected engine byte-exact',[Buffer.byteLength(source.slice(startIndex,endIndex+END_MARK.length)),createHash('sha256').update(source.slice(startIndex,endIndex+END_MARK.length)).digest('hex')],[23622,'b43418c33b1a8b84b34daf2956c4197e6ffe1b35cd0d19c1365dd90c8340d153']);
console.log('Page lifecycle: '+(passes-pageStart)+' passed, '+failures+' total failures');

// ---------- v2 page layout ----------
const v2Start = passes;
const markup = source.replace(/^---\n[\s\S]*?\n---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
check('v2 direct flex root', /^<div\s+class="jpt-wrap"/.test(markup) && /\.jpt-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
check('v2 registered analyze', /'jsonpath-tester':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
check('v2 expression/options then stable status/input/full-width results', ['class="jpt-controls"','id="jpt-count"','class="jpt-input-section"','id="jpt-results"'].map(x=>markup.indexOf(x)).every((n,i,a)=>n>=0&&(!i||n>a[i-1])));
eq('v2 nine example queries and only original Copy action', [...markup.matchAll(/<button\b/g)].length,10);
check('v2 examples remain a native closed disclosure', /<details id="jpt-examples" class="jpt-examples">\s*<summary>\{L.examples\}<\/summary>/.test(markup));
check('v2 examples stay bounded when open', /\.jpt-pills\s*\{[^}]*max-height: 8rem;[^}]*overflow: auto/.test(css));
check('v2 inputs still editable and labeled', ['jpt-json','jpt-expr'].every(id=>new RegExp('<label[^>]*for="'+id+'"').test(markup))&&!/<(?:textarea|input)[^>]*(?:readonly|disabled)/.test(markup));
check('v2 status has reserved height and scrolls long errors', /id="jpt-count"[^>]*role="status"[^>]*aria-live="polite"/.test(markup)&&/\.jpt-count\s*\{[^}]*flex: none;[^}]*height: 3rem;[^}]*overflow: auto/.test(css));
check('v2 populated input is 180px and internally scrolls', /\.jpt-textarea\s*\{[^}]*resize: none;[^}]*height: 180px;[^}]*min-height: 0;[^}]*overflow: auto/.test(css));
check('v2 desktop empty input fills available height', /@media \(min-width: 861px\)[\s\S]*\.jpt-wrap\[data-empty="true"\] \.jpt-input-section\s*\{ flex: 1 1 0; \}/.test(css)&&/\.jpt-wrap\[data-empty="true"\] \.jpt-textarea\s*\{ flex: 1 1 0; height: 0; \}/.test(css));
check('v2 empty hint is content-height', /\.jpt-wrap\[data-empty="true"\] \.jpt-results\s*\{ flex: none; \}/.test(css)&&markup.includes('{L.emptyResult}'));
for(const selector of ['.jpt-results','.jpt-pre']) {
  const rule=css.match(new RegExp('^  '+selector.replaceAll('.','\\.')+'\\s*\\{([^}]+)\\}', 'm'))?.[1]||'';
  check('v2 zero-basis bounded '+selector,/flex: 1 1 0/.test(rule)&&/min-width: 0/.test(rule)&&/min-height: 0/.test(rule));
}
check('v2 result keyboard scrolling and accessible name', /id="jpt-pre"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label=\{L.results\}/.test(markup)&&/\.jpt-pre\s*\{[^}]*overflow: auto/.test(css));
check('v2 <=860 input/result sizes and empty hiding', /@media \(max-width: 860px\)[\s\S]*\.jpt-textarea\s*\{ height: 140px; \}/.test(css)&&/\.jpt-results\s*\{ flex: none; height: 24rem; \}/.test(css)&&/\.jpt-wrap\[data-empty="true"\] \.jpt-results\s*\{ display: none; \}/.test(css));
check('v2 <=640 controls and results stay bounded', /@media \(max-width: 640px\)[\s\S]*min-height: 44px/.test(css)&&/\.jpt-results\s*\{ height: 22rem; \}/.test(css));
const tips=[...markup.matchAll(/<Toggletip id="(jpt-tip-[^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)].map(m=>[m[1],m[2],m[3]]);
eq('v2 five tips tied to their controls',tips.sort(),[['jpt-tip-input','jsonInput','input'],['jpt-tip-expression','expression','expression'],['jpt-tip-examples','examples','examples'],['jpt-tip-results','results','results'],['jpt-tip-copy','copy','copy']].sort());
check('v2 tips stay in build-time HTML and out of client dataset',source.includes('const { tips: TIPS } = L;')&&!/TIPS|labels|\.tips/.test(inline)&&!/data-[\w-]+=\{[^}]*tips/i.test(markup));
function leaves(value,path=''){return Object.entries(value).flatMap(([key,item])=>typeof item==='object'?leaves(item,path+key+'.'):[[path+key,item]]);}
const enLeaves=Object.fromEntries(leaves(labels.en));
for(const lang of ['en','zh','ja','ko']) {
  const local=Object.fromEntries(leaves(labels[lang]));eq(lang+' v2 recursive locale keys',Object.keys(local).sort(),Object.keys(enLeaves).sort());
  for(const [key,value]of Object.entries(local)) {check(lang+' v2 nonempty '+key,typeof value==='string'&&!!value.trim());eq(lang+' v2 placeholders '+key,[...value.matchAll(/\{[^}]+\}/g)].map(m=>m[0]).sort(),[...enLeaves[key].matchAll(/\{[^}]+\}/g)].map(m=>m[0]).sort());}
  const mdx=readFileSync(join(root,'src/content/tools/jsonpath-tester',lang+'.mdx'),'utf8');
  const steps=(mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1]||'').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x.trim().slice(2)));
  eq(lang+' v2 five steps',steps.length,5);check(lang+' v2 step lengths and plain text',steps.every(x=>[...x].length<=280&&!/[<>]|\]\(|\*\*|`/.test(x))&&steps.reduce((n,x)=>n+[...x].length,0)<=1200);
  check(lang+' v2 steps match actual controls',['jsonInput','expression','examples','results','copy'].every(key=>steps.join(' ').includes(labels[lang][key])));
  check(lang+' v2 usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));
  eq(lang+' MDX content contract', contractProblems('jsonpath-tester', lang), '');
  const h=page(lang);eq(lang+' v2 initial example produces results',h.wrap.dataset.empty,'false');
  h.key('L','metaKey','jpt-pre');eq(lang+' v2 keyboard clear restores empty/focus',[h.wrap.dataset.empty,h.document.activeElement===h.get('jpt-json')],['true',true]);
  h.query(1,'');eq(lang+' v2 empty expression hides empty result',h.wrap.dataset.empty,'true');
  h.input('jpt-json','{');eq(lang+' v2 JSON error visible in status and results',[h.wrap.dataset.empty,h.get('jpt-count').textContent],[ 'false',h.get('jpt-code').textContent]);
  h.query(1,'$.');eq(lang+' v2 query error visible in fixed status',h.get('jpt-count').textContent,h.get('jpt-code').textContent);
  h.query('kept');h.wrap.querySelectorAll('.jpt-pill')[0].click();eq(lang+' v2 example changes expression only',[h.get('jpt-json').value,h.get('jpt-expr').value],['{"value":"kept"}','$']);
  const long=Array.from({length:600},(_,i)=>({id:i,text:'value '+i}));h.input('jpt-json',JSON.stringify(long));h.input('jpt-expr','$[*]');
  eq(lang+' v2 long result retains every byte',h.get('jpt-code').textContent,JSON.stringify(long,null,2));h.get('jpt-copy').click();eq(lang+' v2 long copy retains every byte',h.copies.at(-1).text,JSON.stringify(long,null,2));h.copies.at(-1).resolve();await settle();
  h.key();eq(lang+' v2 clear keeps empty state',h.wrap.dataset.empty,'true');
}
console.log('v2 page layout: '+(passes-v2Start)+' passed, '+failures+' total failures');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
