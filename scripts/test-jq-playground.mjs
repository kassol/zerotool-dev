// jq Playground — output stream, value count, empty output and large integers match the jq CLI
//
// Read:  src/components/tools/JqPlaygroundTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), node_modules/jq-web (the same jq.js /
//        jq.wasm build that `sync-jq-web.mjs` copies to public/jq-web/),
//        src/content/tools/jq-playground/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the page called jq-web's json(): the input went through JSON.parse (integers
// above 2^53 changed), several outputs were merged into one array (indistinguishable from a
// filter that outputs one array, and counted by array length), and a filter with no output
// (`empty`) threw "Cannot read properties of undefined (reading 'trim')". The page now passes
// the input text to raw() and shows jq's own output stream. The value count is checked against
// the number of lines jq prints with -c (one value per line), an independent count.
//
// Run: node scripts/test-jq-playground.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const source = readFileSync(join(root, 'src/components/tools/JqPlaygroundTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JqPlaygroundTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { countJsonValues, jqErrorText };')();

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

// ── counting ──
eq('count: empty', E.countJsonValues(''), 0);
eq('count: scalars', E.countJsonValues('1\n"a"\ntrue\nnull\n-2.5e3'), 5);
eq('count: one pretty array', E.countJsonValues('[\n  1,\n  2\n]'), 1);
eq('count: strings with brackets and escapes', E.countJsonValues('"[\\"]"\n"}{"\n{"a":"]"}'), 3);
eq('count: nested', E.countJsonValues('{"a":[{"b":[1,{"c":"}"}]}]}\n[]\n{}'), 3);

// ── against the real jq-web build ──
const jq = await require('jq-web');
const ORDER = '{"order_id": 9007199254740993, "items": [{"sku":"A","qty":2},{"sku":"B","qty":1}]}';
const cases = [
  ['.items | map(.qty) | add', '3'],
  ['.items[] | .sku', '"A"\n"B"'],
  ['[.items[] | .sku]', '[\n  "A",\n  "B"\n]'],
  ['.order_id', '9007199254740993'],
  ['empty', undefined],
  ['.items[] | select(.qty > 5)', undefined],
  ['.items[0], .items[1].qty', '{\n  "sku": "A",\n  "qty": 2\n}\n1'],
];
for (const [filter, expected] of cases) {
  const out = jq.raw(ORDER, filter, []);
  eq('jq output for ' + filter, out, expected);
  const compact = jq.raw(ORDER, filter, ['-c']);
  const lines = compact === undefined ? 0 : compact.split('\n').filter(Boolean).length;
  eq('count for ' + filter + ' equals jq -c line count', E.countJsonValues(out || ''), lines);
}
{
  let msg = null;
  try { jq.raw(ORDER, '.a +', []); } catch (e) { msg = E.jqErrorText(e); }
  check('compile error is jq\'s own message', /^jq: error: syntax error, unexpected end of file/.test(msg || '') && /compile error/.test(msg), msg);
  try { jq.raw('{}', 'error("boom")', []); } catch (e) { msg = E.jqErrorText(e); }
  eq('runtime error text', msg, 'jq: error (at inputString:0): boom');
}

// ── the page script uses raw() on the input text, never json() ──
check('page calls jq.raw', /jq\.raw\(jsonText,/.test(source));
check('page no longer calls jq.json', !/jq\.json\(/.test(source));

// ── tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/jq-playground', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer describes the old trim error', !mdx.includes("reading 'trim'"), lang);
  check(lang + ': page shows the full order_id', mdx.includes('9007199254740993') && !mdx.includes('9007199254740992'), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
