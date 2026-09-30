// CSV to Markdown — fields beyond the header are kept under added "Column N" headers
//
// Read:  src/components/tools/CsvToMarkdownTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: rows with more fields than the header get extra columns named "Column N" (N is the
// 1-based column position) and the added names are reported (these fields were dropped before),
// short rows padded with empty cells, alignment separators, pipe escaping, quoted fields with
// commas / quotes / line breaks, CRLF input, header-only input, 4-language STRINGS keys.
//
// Run: node scripts/test-csv-to-markdown.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CsvToMarkdownTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CsvToMarkdownTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { csvToMarkdown };')();

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
const md = (csv, align) => E.csvToMarkdown(csv, align || 'left');

// ---------- the reported defect: extra fields dropped ----------
{
  const r = md('name,age\nAlice,30,London\nBob,25');
  eq('extra field kept under Column 3', r.markdown.split('\n'), [
    '| name  | age | Column 3 |',
    '| :------ | :---- | :--------- |',
    '| Alice | 30  | London   |',
    '| Bob   | 25  |          |',
  ]);
  eq('added header reported', r.addedColumns, ['Column 3']);
}
{
  const r = md('a\n1,2,3\n4');
  eq('several extra columns', r.markdown.split('\n')[0], '| a   | Column 2 | Column 3 |');
  eq('several added headers reported', r.addedColumns, ['Column 2', 'Column 3']);
  eq('values in extra columns', r.markdown.split('\n')[2], '| 1   | 2        | 3        |');
}
eq('no extra fields → nothing added', md('a,b\n1,2').addedColumns, []);
eq('empty trailing field still counts as a field', md('a\n1,').markdown.split('\n')[0], '| a   | Column 2 |');
eq('header longer than rows: rows padded', md('a,b,c\n1').markdown.split('\n')[2], '| 1   |     |     |');

// ---------- unchanged behavior ----------
eq('header only', md('a,b').markdown, '| a   | b   |\n| :---- | :---- |');
eq('row count', md('a\n1\n2').rowCount, 2);
eq('center alignment', md('a\n1', 'center').markdown.split('\n')[1], '| :---: |');
eq('right alignment', md('a\n1', 'right').markdown.split('\n')[1], '| ----: |');
eq('pipe escaped', md('a\nx|y').markdown.split('\n')[2], '| x\\|y |');
eq('quoted comma, quote and line break', md('a,b\n"x,y","say ""hi""\nthere"').markdown.split('\n')[2],
  '| x,y | say "hi" there |');
eq('quoted comma does not add a column', md('a,b\n"x,y",z').addedColumns, []);
eq('CRLF input', md('a,b\r\n1,2\r\n').markdown.split('\n'), ['| a   | b   |', '| :---- | :---- |', '| 1   | 2   |']);
let threw = false;
try { md(''); } catch (e) { threw = /No data/.test(e.message); }
check('empty input throws No data', threw);

// ---------- STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/);
  const S = new Function('return ' + m[1])();
  const keys = Object.keys(S.en).sort().join(',');
  ['zh', 'ja', 'ko'].forEach((l) => eq('STRINGS keys ' + l, Object.keys(S[l]).sort().join(','), keys));
  ['en', 'zh', 'ja', 'ko'].forEach((l) => check('addedColumns has {cols} in ' + l, S[l].addedColumns.includes('{cols}')));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
