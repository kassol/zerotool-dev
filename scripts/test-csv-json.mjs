// CSV ↔ JSON — JSON → CSV output for nested values, arrays and null; CSV parsing regression test
//
// Read:  src/components/tools/CsvJsonTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
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

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
