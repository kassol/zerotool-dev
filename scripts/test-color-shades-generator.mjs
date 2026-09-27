// Color Shades Generator — swatch label contrast regression test
//
// Read:  src/components/tools/ColorShadesGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: relativeLuminance() against WCAG reference values, contrastRatio() symmetry and
// bounds, textColor() picking the higher-contrast text color (including saturated mid-tones
// such as #3b82f6 where the old 0.299r+0.587g+0.114b > 140 threshold picked white at 3.68:1),
// labelBackground() matching textColor(), and >= 4.5:1 for the label text over its
// translucent backing composited on every sampled swatch color.
//
// Run: node scripts/test-color-shades-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorShadesGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ColorShadesGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { relativeLuminance, contrastRatio, textColor, labelBackground, DARK_TEXT, LIGHT_TEXT };')();

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function near(name, actual, expected, eps) {
  check(name, Math.abs(actual - expected) <= eps, 'got ' + actual + ', expected ' + expected + ' ± ' + eps);
}

function hexRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function lumHex(hex) {
  return E.relativeLuminance(...hexRgb(hex));
}
function ratioHex(a, b) {
  return E.contrastRatio(lumHex(a), lumHex(b));
}
function parseRgba(css) {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css.replace(/\s+/g, ''));
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: +m[4] } : null;
}
// Browsers composite translucent backgrounds per channel in sRGB space.
function composite(rgba, bg) {
  return bg.map((c, i) => Math.round(rgba.a * rgba.rgb[i] + (1 - rgba.a) * c));
}

// ---------- 1. relativeLuminance(): WCAG reference values ----------
near('luminance black', E.relativeLuminance(0, 0, 0), 0, 1e-12);
near('luminance white', E.relativeLuminance(255, 255, 255), 1, 1e-12);
near('luminance pure red', E.relativeLuminance(255, 0, 0), 0.2126, 1e-12);
near('luminance pure green', E.relativeLuminance(0, 255, 0), 0.7152, 1e-12);
near('luminance pure blue', E.relativeLuminance(0, 0, 255), 0.0722, 1e-12);
near('luminance #808080', lumHex('#808080'), 0.2158605, 1e-6);

// ---------- 2. contrastRatio() ----------
near('contrast black/white = 21', ratioHex('#000000', '#ffffff'), 21, 1e-9);
near('contrast same color = 1', ratioHex('#3b82f6', '#3b82f6'), 1, 1e-12);
equal('contrast is symmetric', ratioHex('#3b82f6', '#000000'), ratioHex('#000000', '#3b82f6'));
near('contrast #767676 on white ≈ 4.54', ratioHex('#767676', '#ffffff'), 4.54, 0.01);

// ---------- 3. textColor(): known swatches ----------
// #3b82f6: the old brightness threshold (≈ 129.9 < 140) picked light text at 3.68:1.
equal('#3b82f6 picks dark text', E.textColor(...hexRgb('#3b82f6')), E.DARK_TEXT);
check('#3b82f6 dark text >= 4.5:1', ratioHex('#3b82f6', E.DARK_TEXT) >= 4.5, ratioHex('#3b82f6', E.DARK_TEXT).toFixed(2));
check('#3b82f6 light text would fail 4.5:1', ratioHex('#3b82f6', E.LIGHT_TEXT) < 4.5, ratioHex('#3b82f6', E.LIGHT_TEXT).toFixed(2));
for (const hex of ['#ef4444', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#06b6d4']) {
  const picked = E.textColor(...hexRgb(hex));
  check(hex + ' picked text >= 4.5:1', ratioHex(hex, picked) >= 4.5, picked + ' ' + ratioHex(hex, picked).toFixed(2));
}
equal('white picks dark text', E.textColor(255, 255, 255), E.DARK_TEXT);
equal('black picks light text', E.textColor(0, 0, 0), E.LIGHT_TEXT);
equal('#1e3a8a picks light text', E.textColor(...hexRgb('#1e3a8a')), E.LIGHT_TEXT);

// ---------- 4. sweep: choice, backing, and composited contrast ----------
{
  const DARK_BACKING = parseRgba('rgba(0,0,0,0.30)');
  const LIGHT_BACKING = parseRgba('rgba(255,255,255,0.64)');
  let notBetter = 0, backingMismatch = 0, compositedFail = 0, rawMin = Infinity, compMin = Infinity, count = 0;
  let firstNotBetter = '', firstMismatch = '', firstCompFail = '';
  for (let r = 0; r <= 255; r += 5) {
    for (let g = 0; g <= 255; g += 5) {
      for (let b = 0; b <= 255; b += 5) {
        count++;
        const bgLum = E.relativeLuminance(r, g, b);
        const picked = E.textColor(r, g, b);
        const other = picked === E.DARK_TEXT ? E.LIGHT_TEXT : E.DARK_TEXT;
        const pickedRatio = E.contrastRatio(bgLum, lumHex(picked));
        const otherRatio = E.contrastRatio(bgLum, lumHex(other));
        const tag = 'rgb(' + r + ',' + g + ',' + b + ')';
        if (pickedRatio < otherRatio) { notBetter++; firstNotBetter = firstNotBetter || tag; }
        rawMin = Math.min(rawMin, pickedRatio);

        const backing = E.labelBackground(r, g, b);
        const expected = picked === E.DARK_TEXT ? LIGHT_BACKING : DARK_BACKING;
        const parsed = parseRgba(backing);
        if (!parsed || JSON.stringify(parsed) !== JSON.stringify(expected)) {
          backingMismatch++; firstMismatch = firstMismatch || tag + ' ' + backing;
          continue;
        }
        const comp = composite(parsed, [r, g, b]);
        const compRatio = E.contrastRatio(E.relativeLuminance(...comp), lumHex(picked));
        compMin = Math.min(compMin, compRatio);
        if (compRatio < 4.5) { compositedFail++; firstCompFail = firstCompFail || tag + ' ' + compRatio.toFixed(2); }
      }
    }
  }
  equal('sweep: textColor picks the higher-contrast text (' + count + ' colors)', notBetter, 0);
  if (notBetter) console.log('      first: ' + firstNotBetter);
  // max(contrast vs black, contrast vs #f9fafb) bottoms out at ≈ 4.48 for luminance ≈ 0.174.
  check('sweep: raw swatch contrast >= 4.4 everywhere', rawMin >= 4.4, rawMin.toFixed(3));
  equal('sweep: labelBackground matches textColor', backingMismatch, 0);
  if (backingMismatch) console.log('      first: ' + firstMismatch);
  equal('sweep: label text over its backing >= 4.5:1', compositedFail, 0);
  if (compositedFail) console.log('      first: ' + firstCompFail + ' (min ' + compMin.toFixed(3) + ')');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
