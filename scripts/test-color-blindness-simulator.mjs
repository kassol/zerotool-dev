// Color Blindness Simulator — Machado 2009 matrices applied in linear RGB
//
// Read:  src/components/tools/ColorBlindnessSimulatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the CVD matrices are the Machado, Oliveira & Fernandes (2009) table at severities
// 0.1–1.0 (matrices read back from culori 4.0.2's `filterDeficiency*`, which ships the same
// published table), applied to linear RGB (sRGB EOTF → matrix → clip → sRGB OETF). Before
// the fix the tool multiplied ad-hoc matrices directly on the 0–255 gamma-encoded values.
// Expected values come from:
//   - the R package colorspace 2.1-3 documentation example (linear = TRUE):
//     tritan(c("#005000", "blue", "#00BB00"), severity = 0.6) → "#004F2C" "#0046D7" "#00B96F"
//   - culori's own `lrgb` / `rgb` converters plus the matrices above, for 3,000 seeded colours
//   - Chromium's DevTools vision-deficiency filters (vision_deficiency.cc): the severity-1.0
//     matrices rounded to 3 decimals, and achromatopsia as Rec. 709 luminance in linear RGB
// plus image pixels (alpha untouched, same result as single colours), severity 0 = identity,
// and the example table on each tool page.
//
// Run: node scripts/test-color-blindness-simulator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { converter, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit } from 'culori';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorBlindnessSimulatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ColorBlindnessSimulatorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { cvdMatrix, simulateRgb, simulatePixels, CVD_TYPES };')();

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
const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const sim = (hex, type, severity) => hexOf(E.simulateRgb(rgbOf(hex), E.cvdMatrix(type, severity)));

// ── 1. colorspace documentation example (linear = TRUE) ──
eq('colorspace tritan 0.6 #005000', sim('#005000', 'tritanomaly', 0.6), '#004F2C');
eq('colorspace tritan 0.6 blue', sim('#0000FF', 'tritanomaly', 0.6), '#0046D7');
eq('colorspace tritan 0.6 #00BB00', sim('#00BB00', 'tritanomaly', 0.6), '#00B96F');

// ── 2. matrices equal the Machado table (via culori) ──
const filters = { protan: filterDeficiencyProt, deutan: filterDeficiencyDeuter, tritan: filterDeficiencyTrit };
function culoriMatrix(kind, severity) {
  const f = filters[kind](severity);
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([r, g, b]) => f({ mode: 'rgb', r, g, b }));
  return [0, 1, 2].flatMap((row) => cols.map((c) => [c.r, c.g, c.b][row]));
}
const typeFor = { protan: ['protanopia', 'protanomaly'], deutan: ['deuteranopia', 'deuteranomaly'], tritan: ['tritanopia', 'tritanomaly'] };
for (const kind of Object.keys(filters)) {
  const full = E.cvdMatrix(typeFor[kind][0], 0.6);
  const ref = culoriMatrix(kind, 1);
  check(kind + ' dichromacy matrix = Machado severity 1.0', full.every((v, i) => Math.abs(v - ref[i]) < 1e-9), JSON.stringify(full));
  for (let s = 1; s <= 9; s++) {
    const m = E.cvdMatrix(typeFor[kind][1], s / 10);
    const r = culoriMatrix(kind, s / 10);
    check(kind + ' anomaly matrix severity ' + s / 10, m.every((v, i) => Math.abs(v - r[i]) < 1e-9), JSON.stringify(m));
  }
}
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
eq('severity 0 is identity', E.cvdMatrix('protanomaly', 0).map((v) => Math.abs(v)), identity);

// Chromium vision_deficiency.cc (3-decimal Machado severity 1.0)
const chromium = {
  protanopia: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  deuteranopia: [0.367, 0.861, -0.228, 0.280, 0.673, 0.047, -0.012, 0.043, 0.969],
  tritanopia: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
};
for (const [t, ref] of Object.entries(chromium)) {
  const m = E.cvdMatrix(t, 0.6);
  check(t + ' matches Chromium DevTools to 3 decimals', m.every((v, i) => Math.abs(v - ref[i]) <= 0.0005), JSON.stringify(m));
}

// ── 3. linear-light pipeline against culori converters ──
const toLrgb = converter('lrgb');
const toRgb = converter('rgb');
function reference(rgb, m) {
  const l = toLrgb({ mode: 'rgb', r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 });
  const v = [l.r, l.g, l.b];
  const out = [0, 1, 2].map((row) => Math.min(1, Math.max(0, m[row * 3] * v[0] + m[row * 3 + 1] * v[1] + m[row * 3 + 2] * v[2])));
  const s = toRgb({ mode: 'lrgb', r: out[0], g: out[1], b: out[2] });
  return [s.r, s.g, s.b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
}
let seed = 20261001;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const severities = [0.1, 0.3, 0.6, 0.9];
let mismatches = 0;
let firstMismatch = '';
for (let i = 0; i < 3000; i++) {
  const rgb = [0, 0, 0].map(() => Math.floor(rand() * 256));
  for (const kind of Object.keys(filters)) {
    const pairs = [[typeFor[kind][0], 1], [typeFor[kind][1], severities[i % 4]]];
    for (const [type, sev] of pairs) {
      const m = culoriMatrix(kind, sev);
      const got = E.simulateRgb(rgb, E.cvdMatrix(type, sev));
      const exp = reference(rgb, m);
      if (JSON.stringify(got) !== JSON.stringify(exp)) {
        mismatches++;
        if (!firstMismatch) firstMismatch = type + ' ' + sev + ' ' + hexOf(rgb) + ' got ' + hexOf(got) + ' expected ' + hexOf(exp);
      }
    }
  }
}
check('3,000 random colours × 6 types match culori lrgb pipeline', mismatches === 0, mismatches + ' mismatches, first: ' + firstMismatch);

// Gamma-space multiplication gives a different (darker) result for saturated red
check('protanopia of #FF0000 is computed in linear light', sim('#FF0000', 'protanopia') === hexOf(reference([255, 0, 0], culoriMatrix('protan', 1))), sim('#FF0000', 'protanopia'));

// ── 4. achromatopsia: Rec. 709 luminance in linear RGB ──
function lin(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function enc(c) { return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); }
for (const hex of ['#E74C3C', '#00FF00', '#0000FF', '#808080', '#123456']) {
  const [r, g, b] = rgbOf(hex);
  const y = enc(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
  eq('achromatopsia ' + hex, sim(hex, 'achromatopsia'), hexOf([y, y, y]));
}
eq('achromatopsia keeps white', sim('#FFFFFF', 'achromatopsia'), '#FFFFFF');
eq('achromatopsia keeps black', sim('#000000', 'achromatopsia'), '#000000');
{
  const [r, g, b] = rgbOf('#E74C3C');
  const lr = lin(r), lg = lin(g), lb = lin(b);
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  eq('achromatomaly is a 50% linear-light mix with achromatopsia', sim('#E74C3C', 'achromatomaly'), hexOf([lr, lg, lb].map((c) => enc((c + y) / 2))));
}
for (const t of E.CVD_TYPES) {
  eq('white stays white under ' + t, sim('#FFFFFF', t, 0.6), '#FFFFFF');
  eq('black stays black under ' + t, sim('#000000', t, 0.6), '#000000');
}

// ── 5. image pixels ──
{
  const px = new Uint8ClampedArray(4 * 500);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(rand() * 256);
  for (const t of E.CVD_TYPES) {
    const m = E.cvdMatrix(t, 0.6);
    const out = new Uint8ClampedArray(px);
    E.simulatePixels(out, m);
    let bad = 0;
    for (let i = 0; i < px.length; i += 4) {
      const exp = E.simulateRgb([px[i], px[i + 1], px[i + 2]], m);
      if (out[i] !== exp[0] || out[i + 1] !== exp[1] || out[i + 2] !== exp[2] || out[i + 3] !== px[i + 3]) bad++;
    }
    check('simulatePixels equals simulateRgb and keeps alpha (' + t + ')', bad === 0, bad + ' pixels differ');
  }
}

// ── 6. tool page example tables ──
const order = ['protanopia', 'protanomaly', 'deuteranopia', 'deuteranomaly', 'tritanopia', 'tritanomaly', 'achromatopsia', 'achromatomaly'];
const expectedTable = order.map((t) => sim('#E74C3C', t, 0.6));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/color-blindness-simulator', lang + '.mdx'), 'utf8');
  const table = mdx.slice(mdx.indexOf('<table>'), mdx.indexOf('</table>'));
  const codes = [...table.matchAll(/<code>(#[0-9A-F]{6})<\/code>/g)].map((m) => m[1]);
  eq(lang + ' example table matches the engine (#E74C3C, severity 0.6)', codes, expectedTable);
  check(lang + ' page no longer says the matrix skips linear light', !/without converting to linear|不先换算到线性光|线性光へ変換せず|線形光への変換はせず|선형광으로 변환하지 않/.test(mdx));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
