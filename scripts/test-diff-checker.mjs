// Diff Checker — line splitting and Side-by-Side pairing
//
// Read:  src/components/tools/DiffCheckerTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers), src/content/tools/diff-checker/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: CR LF, lone CR and LF all end a line (a textarea already turns pasted CR LF into LF —
// HTML "normalize newlines" — and the engine does the same, so a CR never shows up as a change);
// LCS diff keeps the line count of both sides; Side-by-Side pairs the removed and added lines of a
// change block by position (it used to pair only a removal that was directly followed by an
// addition, so two removals followed by two additions were drawn as del/empty, del/add,
// empty/add), with empty partners only for the extra lines of the longer side; line numbers on
// each side run 1..n; 2,000 random line lists keep both sides intact after pairing; the English
// page example.
//
// Run: node scripts/test-diff-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/DiffCheckerTool.astro'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in DiffCheckerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { splitLines, lcs, pairRows };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}

// ---------- line endings ----------
eq('LF', E.splitLines('a\nb'), ['a', 'b']);
eq('CR LF', E.splitLines('a\r\nb'), ['a', 'b']);
eq('lone CR', E.splitLines('a\rb'), ['a', 'b']);
eq('mixed', E.splitLines('a\r\nb\nc\rd'), ['a', 'b', 'c', 'd']);
eq('trailing newline keeps an empty last line', E.splitLines('a\r\n'), ['a', '']);
const diffOf = (a, b) => E.lcs(E.splitLines(a), E.splitLines(b));
eq('CR LF text equals LF text', diffOf('x\r\ny\r\nz', 'x\ny\nz').every((op) => op.type === 'equal'), true);

// ---------- pairing ----------
const sbs = (a, b) => E.pairRows(diffOf(a, b)).map((r) => [r.left.type, r.left.ln, r.left.val, r.right.type, r.right.ln, r.right.val]);
eq('two removals, two additions pair by position', sbs('k\na\nb\nz', 'k\nA\nB\nz'), [
  ['equal', 1, 'k', 'equal', 1, 'k'],
  ['del', 2, 'a', 'add', 2, 'A'],
  ['del', 3, 'b', 'add', 3, 'B'],
  ['equal', 4, 'z', 'equal', 4, 'z'],
]);
eq('three removals, one addition', sbs('a\nb\nc', 'X'), [
  ['del', 1, 'a', 'add', 1, 'X'],
  ['del', 2, 'b', 'empty', null, ''],
  ['del', 3, 'c', 'empty', null, ''],
]);
eq('one removal, two additions', sbs('a\nk', 'X\nY\nk'), [
  ['del', 1, 'a', 'add', 1, 'X'],
  ['empty', null, '', 'add', 2, 'Y'],
  ['equal', 2, 'k', 'equal', 3, 'k'],
]);
eq('pure addition', sbs('a', 'a\nb'), [['equal', 1, 'a', 'equal', 1, 'a'], ['empty', null, '', 'add', 2, 'b']]);
eq('two separate blocks', sbs('a\nk\nb', 'A\nk\nB'), [
  ['del', 1, 'a', 'add', 1, 'A'],
  ['equal', 2, 'k', 'equal', 2, 'k'],
  ['del', 3, 'b', 'add', 3, 'B'],
]);

// ---------- random invariants ----------
let seed = 7;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 2000; t++) {
  const a = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const b = Array.from({ length: rand(12) }, () => 'abcd'[rand(4)]);
  const rows = E.pairRows(E.lcs(a, b));
  const left = rows.filter((r) => r.left.type !== 'empty');
  const right = rows.filter((r) => r.right.type !== 'empty');
  const ok = JSON.stringify(left.map((r) => r.left.val)) === JSON.stringify(a)
    && JSON.stringify(right.map((r) => r.right.val)) === JSON.stringify(b)
    && left.every((r, i) => r.left.ln === i + 1) && right.every((r, i) => r.right.ln === i + 1)
    && rows.every((r) => !(r.left.type === 'empty' && r.right.type === 'empty'));
  if (!ok) { eq('random ' + t + ' ' + JSON.stringify([a, b]), false, true); break; }
  // no row pairs an empty cell while the other side of the same block still has an unpaired line
  let i = 0;
  let bad = false;
  while (i < rows.length) {
    if (rows[i].left.type === 'equal') { i++; continue; }
    let j = i;
    while (j < rows.length && rows[j].left.type !== 'equal') j++;
    const block = rows.slice(i, j);
    const dels = block.filter((r) => r.left.type === 'del').length;
    const adds = block.filter((r) => r.right.type === 'add').length;
    if (block.length !== Math.max(dels, adds)) bad = true;
    i = j;
  }
  if (bad) { eq('block rows = max(dels, adds) ' + JSON.stringify([a, b]), false, true); break; }
  passes++;
}

// ---------- page ----------
const page = readFileSync(join(root, 'src/content/tools/diff-checker/en.mdx'), 'utf8');
eq('page no longer says pairing is adjacent-only', page.includes('pairs only adjacent lines'), false);
eq('page no longer says CR LF marks every line', page.includes('marks **every** line as changed'), false);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
