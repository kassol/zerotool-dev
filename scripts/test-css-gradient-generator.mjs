// CSS Gradient Generator — gradient string
//
// Read:  src/components/tools/CssGradientGeneratorTool.astro (runs the real readAngle() and
//        gradientCss() between the `engine:start` / `engine:end` markers)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the linear angle was read with `parseInt(v) || 90`, so the Top button (0deg) and a
// typed 0 produced linear-gradient(90deg, ...). The other strings are the examples quoted on the
// English tool page (CSS Images Level 3 / 4 syntax).
//
// Run: node scripts/test-css-gradient-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssGradientGeneratorTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in CssGradientGeneratorTool.astro');
  process.exit(1);
}
const { gradientCss } = new Function(source.slice(start, end) + '\nreturn { readAngle, gradientCss };')();

let passes = 0, failures = 0;
function check(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log(`FAIL: ${name}\n  expected ${expected}\n  actual   ${actual}`);
}

const two = '#3b82f6 0%, #8b5cf6 100%';
check('default linear', gradientCss('linear', { angle: '90' }, two), 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)');
check('0deg stays 0deg', gradientCss('linear', { angle: '0' }, two), 'linear-gradient(0deg, #3b82f6 0%, #8b5cf6 100%)');
check('180deg', gradientCss('linear', { angle: '180' }, two), 'linear-gradient(180deg, #3b82f6 0%, #8b5cf6 100%)');
check('empty angle falls back to 90deg', gradientCss('linear', { angle: '' }, two), 'linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)');
check('radial', gradientCss('radial', { shape: 'circle', position: 'top left' }, two), 'radial-gradient(circle at top left, #3b82f6 0%, #8b5cf6 100%)');
check('conic from 0', gradientCss('conic', { from: '0', position: 'center' }, two), 'conic-gradient(from 0deg at center, #3b82f6 0%, #8b5cf6 100%)');
check('conic pie example', gradientCss('conic', { from: '0', position: 'center' }, '#3b82f6 0%, #3b82f6 40%, #f59e0b 40%, #f59e0b 100%'),
  'conic-gradient(from 0deg at center, #3b82f6 0%, #3b82f6 40%, #f59e0b 40%, #f59e0b 100%)');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
