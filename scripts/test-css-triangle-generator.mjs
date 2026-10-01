// CSS Triangle Generator — border widths for odd sizes
//
// Read:  src/components/tools/CssTriangleGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/css-triangle-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: for every width / height from 1 to 400, the two transparent borders of the top, bottom,
// left and right triangles add up to exactly that size (they used to round each half up, so width
// 25 gave 13px + 13px, a 26px base), and differ by at most 1px; the coloured border keeps the
// other size; corner triangles are unchanged; the example on the English page.
//
// Run: node scripts/test-css-triangle-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssTriangleGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/css-triangle-generator/en.mdx'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in CssTriangleGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { computeBorders };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}
const px = (rules) => Object.fromEntries(rules.map((r) => { const m = /^(border-\w+): (\d+)px solid (\S+)$/.exec(r); return [m[1], [Number(m[2]), m[3]]]; }));

eq('width 25, top', E.computeBorders('top', 25, 20, '#3b82f6'), ['border-left: 12px solid transparent', 'border-right: 13px solid transparent', 'border-bottom: 20px solid #3b82f6']);
eq('height 15, right', E.computeBorders('right', 30, 15, '#000000'), ['border-top: 7px solid transparent', 'border-bottom: 8px solid transparent', 'border-left: 30px solid #000000']);
eq('corner unchanged', E.computeBorders('top-left', 25, 15, '#000000'), ['border-top: 15px solid #000000', 'border-right: 25px solid transparent']);

let ok = true;
for (let n = 1; n <= 400 && ok; n++) {
  for (const dir of ['top', 'bottom']) {
    const b = px(E.computeBorders(dir, n, 37, '#111111'));
    const l = b['border-left'][0], r = b['border-right'][0];
    if (l + r !== n || Math.abs(l - r) > 1 || (b['border-bottom'] || b['border-top'])[0] !== 37) { ok = false; eq(dir + ' width ' + n, [l, r], 'sum ' + n); }
  }
  for (const dir of ['left', 'right']) {
    const b = px(E.computeBorders(dir, 37, n, '#111111'));
    const t = b['border-top'][0], bo = b['border-bottom'][0];
    if (t + bo !== n || Math.abs(t - bo) > 1 || (b['border-left'] || b['border-right'])[0] !== 37) { ok = false; eq(dir + ' height ' + n, [t, bo], 'sum ' + n); }
  }
}
if (ok) passes++;

eq('page no longer says odd widths become one pixel wider', page.includes('Odd widths become one pixel wider'), false);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
