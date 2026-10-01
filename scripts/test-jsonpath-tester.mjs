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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
