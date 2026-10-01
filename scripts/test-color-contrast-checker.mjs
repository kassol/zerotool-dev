// Color Contrast Checker — the suggested colour passes AA after it is rounded to a hex value
//
// Read:  src/components/tools/ColorContrastCheckerTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the suggestion for a failing pair is an 8-bit colour whose contrast with the
// background is at least 4.5:1 when measured on the rounded hex value (before the fix the
// search accepted unrounded floats and `target * 0.99`, so about half of the suggestions
// were just below 4.5:1, e.g. #D97706 on #FFF7ED → #b75800 at 4.4857:1); 20,000 seeded
// random pairs plus grey / pure-hue / near-black / near-white edges; the displayed ratio
// is truncated, not rounded (WCAG Understanding 1.4.3: 4.499:1 does not meet 4.5:1).
// The reference contrast is computed here independently from the WCAG 2.2 definition of
// relative luminance (threshold 0.04045; no 8-bit value lies between 0.03928 and 0.04045).
//
// Run: node scripts/test-color-contrast-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorContrastCheckerTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ColorContrastCheckerTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { suggestFix, rgbToHex, hexToRgb, contrast, formatRatio: typeof formatRatio === "function" ? formatRatio : null };')();

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

// Independent WCAG 2.2 reference
function lin(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function refRatio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
function suggestHex(fg, bg) {
  const s = E.suggestFix(E.hexToRgb(fg), E.hexToRgb(bg), 4.5);
  return { hex: E.rgbToHex(s.rgb.r, s.rgb.g, s.rgb.b), ratio: s.ratio };
}

// ---------- the reported case ----------
{
  const s = suggestHex('#d97706', '#fff7ed');
  check('#D97706 on #FFF7ED: suggestion passes on its hex value', refRatio(s.hex, '#fff7ed') >= 4.5,
    s.hex + ' → ' + refRatio(s.hex, '#fff7ed'));
  check('#D97706 on #FFF7ED: reported ratio is the hex value\'s ratio',
    Math.abs(s.ratio - refRatio(s.hex, '#fff7ed')) < 1e-9, s.ratio + ' vs ' + refRatio(s.hex, '#fff7ed'));
  check('#D97706 on #FFF7ED: suggestion stays orange (R > G > B)', (() => {
    const c = E.hexToRgb(s.hex); return c.r > c.g && c.g >= c.b;
  })(), s.hex);
}

// ---------- seeded random pairs ----------
let seed = 0x2f6e2b1;
function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 8; }
let tried = 0, failed = 0, firstBad = null, ratioMismatch = 0, changedNothing = 0;
while (tried < 20000) {
  const fg = hex(rnd() & 255, rnd() & 255, rnd() & 255);
  const bg = hex(rnd() & 255, rnd() & 255, rnd() & 255);
  if (refRatio(fg, bg) >= 4.5) continue;
  tried++;
  const s = suggestHex(fg, bg);
  const r = refRatio(s.hex, bg);
  if (!(r >= 4.5)) { failed++; if (!firstBad) firstBad = fg + ' on ' + bg + ' → ' + s.hex + ' ' + r.toFixed(4); }
  if (Math.abs(s.ratio - r) > 1e-9) ratioMismatch++;
  if (s.hex === fg) changedNothing++;
}
check('20,000 random failing pairs: every suggestion ≥ 4.5:1 on its hex value', failed === 0,
  failed + ' below 4.5; first: ' + firstBad);
check('20,000 random failing pairs: displayed ratio equals the hex value\'s ratio', ratioMismatch === 0, ratioMismatch);
check('20,000 random failing pairs: suggestion differs from the input', changedNothing === 0, changedNothing);

// ---------- edges: greys, pure hues, near-black / near-white backgrounds ----------
{
  const fgs = [];
  for (let v = 0; v <= 255; v += 15) fgs.push(hex(v, v, v));
  fgs.push('#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#7f00ff', '#1a73e8');
  const bgs = ['#000000', '#0a0a0a', '#333333', '#777777', '#767676', '#808080', '#959595', '#cccccc', '#f5f5f5', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  let n = 0, bad = [];
  for (const fg of fgs) for (const bg of bgs) {
    if (refRatio(fg, bg) >= 4.5) continue;
    n++;
    const s = suggestHex(fg, bg);
    if (!(refRatio(s.hex, bg) >= 4.5)) bad.push(fg + '/' + bg + '→' + s.hex);
  }
  check('edge pairs (' + n + '): every suggestion ≥ 4.5:1', bad.length === 0, bad.slice(0, 5).join(', '));
}

// ---------- displayed ratio is truncated ----------
check('formatRatio exists in the engine', typeof E.formatRatio === 'function');
if (E.formatRatio) {
  eq('4.4999 shows 4.49', E.formatRatio(4.4999), '4.49');
  eq('4.5 shows 4.50', E.formatRatio(4.5), '4.50');
  eq('21 shows 21.00', E.formatRatio(21), '21.00');
  eq('1 shows 1.00', E.formatRatio(1), '1.00');
  eq('#777777 on white (4.4784) shows 4.47', E.formatRatio(E.contrast(E.hexToRgb('#777777'), E.hexToRgb('#ffffff'))), '4.47');
  eq('#767676 on white (4.5422) shows 4.54', E.formatRatio(E.contrast(E.hexToRgb('#767676'), E.hexToRgb('#ffffff'))), '4.54');
  // floating error must not push an exact value down a step: 3 / 1 etc.
  eq('2.9999999999999996 shows 3.00 (float noise)', E.formatRatio(2.9999999999999996), '3.00');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
