// Markdown Table Generator — JSON import takes every key and writes nested values as JSON
//
// Read:  src/components/tools/MarkdownTableGeneratorTool.astro (extracts the real `jsonToTable`
//        between the `engine:start` / `engine:end` markers)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the columns were only the first object's keys (later keys were dropped) and a
// nested object or array became "[object Object]" / "a,b". Expected: columns are all keys in
// first-seen order, missing keys and null are empty cells, objects and arrays are JSON text,
// items that are not objects are an error naming the item.
//
// Run: node scripts/test-markdown-table-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownTableGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { jsonToTable } = new Function(source.slice(s, e) + '\nreturn { jsonToTable };')();

let failures = 0;
let passes = 0;
function eq(name, a, b) {
  const x = JSON.stringify(a); const y = JSON.stringify(b);
  if (x === y) passes++; else { failures++; console.log('FAIL: ' + name + ' — got ' + x + ', expected ' + y); }
}
function throws(name, fn, re) {
  try { fn(); failures++; console.log('FAIL: ' + name + ' — no error'); }
  catch (err) { if (re.test(err.message)) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + err.message); } }
}

eq('keys from all objects', jsonToTable([{ a: 1 }, { b: 2, a: 3 }]), { headers: ['a', 'b'], rows: [['1', ''], ['3', '2']] });
eq('nested values are JSON text', jsonToTable([{ user: { name: 'Alice' }, tags: ['x', 'y'], n: null, ok: true }]).rows,
  [['{"name":"Alice"}', '["x","y"]', '', 'true']]);
eq('prototype key names', jsonToTable([{ constructor: 1 }, { toString: 'x' }]), { headers: ['constructor', 'toString'], rows: [['1', ''], ['', 'x']] });
throws('not an array', () => jsonToTable({ a: 1 }), /array/);
throws('empty array', () => jsonToTable([]), /empty/);
throws('second item not an object', () => jsonToTable([{ a: 1 }, 2]), /Item 2/);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
