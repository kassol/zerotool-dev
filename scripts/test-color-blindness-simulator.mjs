// Color Blindness Simulator — Machado 2009 matrices in linear RGB, image pipeline, palette check
//
// Read:  src/components/tools/ColorBlindnessSimulatorTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers, the STRINGS table between `strings:start` /
//        `strings:end`, the page script), ColorPaletteGeneratorTool.astro and
//        EyedropperColorPickerTool.astro (engine blocks, to compare the copied declarations),
//        src/data/persistence.ts, tool-layouts.ts, ToolLayout.astro keyboard handler,
//        the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
//   1. Machado, Oliveira & Fernandes (2009) matrices at severities 0.1–1.0 (read back from culori
//      4.0.2's `filterDeficiency*`, which ships the same published table) applied to linear RGB;
//      the R package colorspace 2.1-3 documentation example (linear = TRUE); Chromium's DevTools
//      vision-deficiency matrices (vision_deficiency.cc, 3 decimals); 3,000 seeded colors against
//      culori's `lrgb` / `rgb` converters; achromatopsia as Rec. 709 luminance in linear light.
//   2. The fast image encoder (`encode8`, 4096 buckets + exact thresholds) equals `toSrgb8` at every
//      threshold, its neighbouring double and 2,000,000 random values; `simulatePixels` equals
//      `simulateRgb` for all 16,777,216 colors (protanopia) and a 3-step grid for every other type,
//      keeps alpha and gives the same bytes when run in slices (PNG downloads run in slices).
//   3. Declarations copied from ColorPaletteGeneratorTool.astro (CSS color parsing, OKLab, ΔEOK,
//      WCAG contrast) and EyedropperColorPickerTool.astro (canvas limit, P3 matrices, tolerance,
//      fitImageSize) are identical to their source (Function#toString / values).
//   4. Color list parsing: labels with `:` `：` `=`, trailing commas, quotes, full-width input,
//      error line numbers, notes, 12-color limit.
//   5. Palette check: ΔEOK between simulated colors equals culori `differenceEuclidean('oklab')`,
//      contrast equals culori `wcagContrast`, pairs sorted, verdict thresholds 0.02 / 0.06,
//      truncated display values.
//   6. Wide-gamut check: `countOutOfSrgb` agrees with colorjs.io 0.7.1 (Display P3 → linear sRGB)
//      for 20,000 random P3 pixels; sRGB colors read through a P3 canvas are never flagged.
//   7. Helpers: `fitWithin`, `downloadName`.
//   8. STRINGS: 4 languages with the same keys and placeholders, every key the script uses exists,
//      every parse error and note code has a message.
//   9. Static: the page script writes no HTML, does not touch storage or the network directly,
//      and persistence.ts stores only preferences for this tool.
//  10. Chrome DevTools "Emulate vision deficiencies" (Chrome 152, macOS, Display P3 screen,
//      2026-10-02): 24 measured swatches equal the 3-decimal Machado matrices applied in Display P3
//      linear light within ±2, and differ from this tool (sRGB linear light) by up to 32 levels.
//  11. Tool pages: every `{/* cbs-check: … */}` annotation is recomputed by the engine and the
//      expected values appear in the page text.
//  12. Full page lifecycle: actual script + shared shortcut, controlled file/media/PNG/clipboard
//      completion, synchronous clear to the initial sample, stale work and preference preservation.
//  13. v2 page layout: analyze registration, bounded result panels, preserved controls,
//      translated tips excluded from client strings, steps and retained non-usage MDX content.
//
// Run: node scripts/test-color-blindness-simulator.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { converter, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit, differenceEuclidean, wcagContrast } from 'culori';
import Color from 'colorjs.io';
import { load as loadYaml } from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');
const source = read('src/components/tools/ColorBlindnessSimulatorTool.astro');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
function engineOf(src, file) {
  const s = src.indexOf(START_MARK), e = src.indexOf(END_MARK);
  if (s < 0 || e <= s) { console.error('FAIL: could not locate the engine block in ' + file); process.exit(1); }
  return src.slice(s, e);
}
const NAMES = ['cvdMatrix', 'simulateRgb', 'simulatePixels', 'CVD_TYPES', 'ANOMALY_TYPES', 'toSrgb8', 'encode8', 'ENC_THRESH',
  'parseColor', 'parseColorList', 'analyzePalette', 'verdictOf', 'fmtDe', 'fmtCr', 'countOutOfSrgb', 'fitWithin', 'fitImageSize',
  'downloadName', 'MAX_COLORS', 'JND', 'SMALL_MARK_DE', 'GAMUT_TOLERANCE', 'MAX_CANVAS_AREA'];
const engineSrc = engineOf(source, 'ColorBlindnessSimulatorTool.astro');
const E = new Function(engineSrc + '\nreturn {' + NAMES.map((n) => n + ': ' + n).join(', ') + '};')();

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
let seed = 20261001;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };

// ── 1. Model ──
eq('colorspace tritan 0.6 #005000', sim('#005000', 'tritanomaly', 0.6), '#004F2C');
eq('colorspace tritan 0.6 blue', sim('#0000FF', 'tritanomaly', 0.6), '#0046D7');
eq('colorspace tritan 0.6 #00BB00', sim('#00BB00', 'tritanomaly', 0.6), '#00B96F');

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
eq('normal vision is identity', E.cvdMatrix('normal', 0.6), identity);
check('unknown type throws', (() => { try { E.cvdMatrix('foo', 1); return false; } catch { return true; } })());

const chromium = {
  protanopia: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  deuteranopia: [0.367, 0.861, -0.228, 0.280, 0.673, 0.047, -0.012, 0.043, 0.969],
  tritanopia: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
};
for (const [t, ref] of Object.entries(chromium)) {
  const m = E.cvdMatrix(t, 0.6);
  check(t + ' matches Chromium DevTools to 3 decimals', m.every((v, i) => Math.abs(v - ref[i]) <= 0.0005), JSON.stringify(m));
}

const toLrgb = converter('lrgb');
const toRgb = converter('rgb');
function reference(rgb, m) {
  const l = toLrgb({ mode: 'rgb', r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 });
  const v = [l.r, l.g, l.b];
  const out = [0, 1, 2].map((row) => Math.min(1, Math.max(0, m[row * 3] * v[0] + m[row * 3 + 1] * v[1] + m[row * 3 + 2] * v[2])));
  const s = toRgb({ mode: 'lrgb', r: out[0], g: out[1], b: out[2] });
  return [s.r, s.g, s.b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
}
{
  const severities = [0.1, 0.3, 0.6, 0.9];
  let mismatches = 0, firstMismatch = '';
  for (let i = 0; i < 3000; i++) {
    const rgb = [0, 0, 0].map(() => Math.floor(rand() * 256));
    for (const kind of Object.keys(filters)) {
      for (const [type, sev] of [[typeFor[kind][0], 1], [typeFor[kind][1], severities[i % 4]]]) {
        const got = E.simulateRgb(rgb, E.cvdMatrix(type, sev));
        const exp = reference(rgb, culoriMatrix(kind, sev));
        if (JSON.stringify(got) !== JSON.stringify(exp)) {
          mismatches++;
          if (!firstMismatch) firstMismatch = type + ' ' + sev + ' ' + hexOf(rgb) + ' got ' + hexOf(got) + ' expected ' + hexOf(exp);
        }
      }
    }
  }
  check('3,000 random colours × 6 types match culori lrgb pipeline', mismatches === 0, mismatches + ' mismatches, first: ' + firstMismatch);
}
check('protanopia of #FF0000 is computed in linear light', sim('#FF0000', 'protanopia') === hexOf(reference([255, 0, 0], culoriMatrix('protan', 1))), sim('#FF0000', 'protanopia'));

function lin(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function enc(c) { return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); }
for (const hex of ['#E74C3C', '#00FF00', '#0000FF', '#808080', '#123456']) {
  const [r, g, b] = rgbOf(hex);
  const y = enc(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b));
  eq('achromatopsia ' + hex, sim(hex, 'achromatopsia'), hexOf([y, y, y]));
}
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

// ── 2. Fast encoder and image pixels ──
{
  let bad = 0, first = '';
  for (let k = 0; k < 255; k++) {
    const th = E.ENC_THRESH[k];
    const below = th - Number.EPSILON * th; // a double just under the threshold
    const prev = th > 0 ? Math.max(0, below) : 0;
    if (E.toSrgb8(th) !== k + 1 || E.encode8(th) !== k + 1 || E.encode8(prev) !== E.toSrgb8(prev) || E.toSrgb8(prev) !== k) {
      bad++; if (!first) first = 'k=' + k + ' th=' + th;
    }
  }
  check('encode8 thresholds are exact for all 255 code boundaries', bad === 0, bad + ' bad, first ' + first);
  let mism = 0, firstM = '';
  for (let i = 0; i < 2000000; i++) {
    const c = i % 5 === 0 ? rand() * 0.004 : i % 7 === 0 ? -0.1 + rand() * 1.3 : rand();
    if (E.encode8(c) !== E.toSrgb8(c)) { mism++; if (!firstM) firstM = String(c); }
  }
  check('encode8 equals toSrgb8 for 2,000,000 random values (incl. < 0 and > 1)', mism === 0, mism + ' mismatches, first ' + firstM);
  check('encode8 handles NaN as 0', E.encode8(NaN) === 0);
}
function fullCube(type, step) {
  const n = Math.ceil(256 / step);
  const px = new Uint8ClampedArray(n * n * n * 4);
  let o = 0;
  for (let r = 0; r < 256; r += step) for (let g = 0; g < 256; g += step) for (let b = 0; b < 256; b += step) { px[o++] = r; px[o++] = g; px[o++] = b; px[o++] = (r + g + b) & 255; }
  const orig = new Uint8ClampedArray(px);
  const m = E.cvdMatrix(type, 0.6);
  E.simulatePixels(px, m);
  let bad = 0, first = '';
  for (let i = 0; i < px.length; i += 4) {
    const exp = E.simulateRgb([orig[i], orig[i + 1], orig[i + 2]], m);
    if (px[i] !== exp[0] || px[i + 1] !== exp[1] || px[i + 2] !== exp[2] || px[i + 3] !== orig[i + 3]) { bad++; if (!first) first = hexOf([orig[i], orig[i + 1], orig[i + 2]]); }
  }
  return { bad, first, n: px.length / 4 };
}
{
  const r = fullCube('protanopia', 1);
  check('simulatePixels = simulateRgb for all 16,777,216 colors (protanopia), alpha kept', r.bad === 0 && r.n === 16777216, r.bad + ' differ, first ' + r.first);
  for (const t of E.CVD_TYPES.filter((x) => x !== 'protanopia')) {
    const g = fullCube(t, 3);
    check('simulatePixels = simulateRgb on a 3-step grid (' + t + ')', g.bad === 0, g.bad + ' differ, first ' + g.first);
  }
  const px = new Uint8ClampedArray(4 * 10007);
  for (let i = 0; i < px.length; i++) px[i] = Math.floor(rand() * 256);
  const whole = new Uint8ClampedArray(px), sliced = new Uint8ClampedArray(px);
  const m = E.cvdMatrix('deuteranomaly', 0.3);
  E.simulatePixels(whole, m);
  for (let p = 0; p < sliced.length; p += 4 * 997) E.simulatePixels(sliced, m, p, Math.min(sliced.length, p + 4 * 997));
  check('simulatePixels in slices = in one pass', whole.every((v, i) => v === sliced[i]));
}

// ── 3. Copied declarations are identical to their source ──
function engineFns(file, names) {
  const src = engineOf(read(file), file);
  return new Function(src + '\nreturn {' + names.map((n) => n + ': ' + n).join(', ') + '};')();
}
{
  const fnNames = ['clamp', 'mod360', 'toHex', 'hexDigitsToRgb', 'rgbToHsl', 'hslToRgbFloat', 'round8', 'toLinear', 'fromLinear', 'rgbToOklab',
    'oklabToRgb01', 'rgbToOklch', 'oklchToLab', 'oklchToRgbFloat', 'inGamut', 'deltaEOK', 'gamutMap', 'oklchTo8bit', 'parseComponent', 'angle',
    'parseFunction', 'parseColor', 'relativeLuminance', 'contrastRatio'];
  const varNames = ['NAMED', 'NUM_RE', 'FUNCTIONS'];
  const P = engineFns('src/components/tools/ColorPaletteGeneratorTool.astro', fnNames.concat(varNames));
  const C = new Function(engineSrc + '\nreturn {' + fnNames.concat(varNames).map((n) => n + ': ' + n).join(', ') + '};')();
  for (const n of fnNames) check('copied from color-palette-generator: ' + n, typeof C[n] === 'function' && C[n].toString() === P[n].toString());
  check('copied NAMED (148 colors) equals color-palette-generator', JSON.stringify(C.NAMED) === JSON.stringify(P.NAMED) && Object.keys(C.NAMED).length === 148);
  check('copied NUM_RE equals color-palette-generator', String(C.NUM_RE) === String(P.NUM_RE));
  check('copied FUNCTIONS equals color-palette-generator', JSON.stringify(C.FUNCTIONS) === JSON.stringify(P.FUNCTIONS));
  const ecpNames = ['MAX_CANVAS_AREA', 'GAMUT_TOLERANCE', 'M_XYZ_LSRGB', 'M_LP3_XYZ', 'fitImageSize'];
  const Y = engineFns('src/components/tools/EyedropperColorPickerTool.astro', ecpNames);
  const Z = new Function(engineSrc + '\nreturn {' + ecpNames.map((n) => n + ': ' + n).join(', ') + '};')();
  for (const n of ecpNames) {
    const ws = (f) => f.toString().replace(/\s+/g, ' ');
    const same = typeof Y[n] === 'function' ? ws(Y[n]) === ws(Z[n]) : JSON.stringify(Y[n]) === JSON.stringify(Z[n]);
    check('copied from eyedropper-color-picker: ' + n, same);
  }
}

// ── 4. Color list parsing ──
{
  const r = E.parseColorList('Error: #D32F2F\n\nSuccess：#2e7d32\nInfo = rgb(2 136 209)\n  "#ED6C02",\nnavy\n');
  eq('labels with : ： = and plain colors', r.colors.map((c) => [c.line, c.label, c.hex]), [[1, 'Error', '#D32F2F'], [3, 'Success', '#2E7D32'], [4, 'Info', '#0288D1'], [5, '#ED6C02', '#ED6C02'], [6, '#000080', '#000080']]);
  eq('no errors', r.errors.length, 0);
  const f = E.parseColorList('＃Ｄ３２Ｆ２Ｆ\nＥｒｒｏｒ：　＃２Ｅ７Ｄ３２');
  eq('full-width input (IME) reads as ASCII', f.colors.map((c) => [c.label, c.hex]), [['#D32F2F', '#D32F2F'], ['Ｅｒｒｏｒ', '#2E7D32']]);
  const e = E.parseColorList('#D32F2F\nError: #ZZZ\nfoo\nrgb(1 2)\n#12345');
  eq('error lines and codes', e.errors.map((x) => [x.line, x.error.error, x.error.pos || x.error.n || x.error.fn || '']), [[2, 'hexChar', 2], [3, 'unknown', ''], [4, 'fnArgs', 'rgb'], [5, 'hexLength', 5]]);
  eq('a commas-only rgb() is one color', E.parseColorList('rgb(211, 47, 47)').colors.map((c) => c.hex), ['#D32F2F']);
  const n = E.parseColorList('#D32F2F80\noklch(0.7 0.4 140)\nrgb(300 0 0)');
  eq('notes with line numbers', n.notes.map((x) => [x.line, x.note]), [[1, 'alphaIgnored'], [2, 'mapped'], [3, 'clamped']]);
  const many = E.parseColorList(Array.from({ length: 15 }, (_, i) => '#' + (i * 1111 + 100000).toString(16).padStart(6, '0')).join('\n'));
  eq('at most 12 colors, truncated flag', [many.colors.length, many.truncated], [12, true]);
  eq('MAX_COLORS', E.MAX_COLORS, 12);
  check('long labels are cut to 40 characters', E.parseColorList('x'.repeat(60) + ': red').colors[0].label.length === 40);
  eq('empty input', E.parseColorList('  \n \n').colors.length, 0);
}

// ── 5. Palette check ──
{
  const toOklab = converter('oklab');
  const dEok = differenceEuclidean('oklab');
  let bad = 0, first = '';
  for (let n = 0; n < 500; n++) {
    const k = 2 + (n % 6);
    const colors = Array.from({ length: k }, () => { const rgb = [0, 0, 0].map(() => Math.floor(rand() * 256)); return { rgb, hex: hexOf(rgb), label: hexOf(rgb) }; });
    const sev = [0.1, 0.5, 0.9][n % 3];
    const rows = E.analyzePalette(colors, sev);
    if (rows.length !== 9 || rows[0].type !== 'normal') { bad++; first = 'rows'; break; }
    for (const row of rows) {
      const m = E.cvdMatrix(row.type, sev);
      if (row.pairs.length !== k * (k - 1) / 2) { bad++; if (!first) first = 'pair count'; }
      for (let p = 1; p < row.pairs.length; p++) if (row.pairs[p].de < row.pairs[p - 1].de) { bad++; if (!first) first = 'order'; }
      for (const p of row.pairs) {
        const a = E.simulateRgb(colors[p.i].rgb, m), b = E.simulateRgb(colors[p.j].rgb, m);
        const ca = { mode: 'rgb', r: a[0] / 255, g: a[1] / 255, b: a[2] / 255 }, cb = { mode: 'rgb', r: b[0] / 255, g: b[1] / 255, b: b[2] / 255 };
        const de = dEok(toOklab(ca), toOklab(cb));
        const cr = wcagContrast(ca, cb);
        if (Math.abs(de - p.de) > 1e-9 || Math.abs(cr - p.cr) > 1e-9 || p.verdict !== E.verdictOf(p.de)) { bad++; if (!first) first = row.type + ' ' + hexOf(a) + '/' + hexOf(b) + ' de ' + p.de + ' vs ' + de + ' cr ' + p.cr + ' vs ' + cr; }
      }
      if (row.closest !== row.pairs[0]) { bad++; if (!first) first = 'closest'; }
    }
  }
  check('500 random palettes: ΔEOK = culori differenceEuclidean(oklab), contrast = culori wcagContrast, sorted', bad === 0, bad + ' bad, first ' + first);
  eq('normal row keeps the input colors', E.analyzePalette([{ rgb: [211, 47, 47] }, { rgb: [46, 125, 50] }], 0.6)[0].sim, [[211, 47, 47], [46, 125, 50]]);
  eq('verdict thresholds', [E.verdictOf(0), E.verdictOf(0.0199), E.verdictOf(0.02), E.verdictOf(0.0599), E.verdictOf(0.06)], ['same', 'same', 'close', 'close', 'ok']);
  eq('JND and small-mark thresholds', [E.JND, E.SMALL_MARK_DE], [0.02, 0.06]);
  eq('ΔEOK display is truncated', [E.fmtDe(0.01999), E.fmtDe(0.0596), E.fmtDe(0.3)], ['0.019', '0.059', '0.300']);
  eq('contrast display is truncated', [E.fmtCr(4.499), E.fmtCr(1), E.fmtCr(2.999999)], ['4.49', '1.00', '2.99']);
  eq('one color gives no pair', E.analyzePalette([{ rgb: [1, 2, 3] }], 0.6)[3].closest, null);
}

// ── 6. Wide-gamut pixels ──
{
  let bad = 0, first = '';
  const px = new Uint8ClampedArray(4);
  const tol = E.GAMUT_TOLERANCE;
  for (let i = 0; i < 20000; i++) {
    const p3 = [0, 0, 0].map(() => Math.floor(rand() * 256));
    px[0] = p3[0]; px[1] = p3[1]; px[2] = p3[2]; px[3] = 255;
    const got = E.countOutOfSrgb(px).out === 1;
    const lin3 = new Color('p3', p3.map((v) => v / 255)).to('srgb-linear').coords;
    const exp = lin3.some((c) => c < -tol || c > 1 + tol);
    // Within 1e-9 of the tolerance edge either answer is acceptable (matrix rounding).
    const edge = lin3.some((c) => Math.abs(c + tol) < 1e-9 || Math.abs(c - 1 - tol) < 1e-9);
    if (got !== exp && !edge) { bad++; if (!first) first = p3.join(','); }
  }
  check('countOutOfSrgb agrees with colorjs.io for 20,000 random Display P3 pixels', bad === 0, bad + ' bad, first ' + first);
  let flagged = 0;
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (let b = 0; b < 256; b += 5) {
    const p3 = new Color('srgb', [r / 255, g / 255, b / 255]).to('p3').coords.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
    px[0] = p3[0]; px[1] = p3[1]; px[2] = p3[2]; px[3] = 255;
    flagged += E.countOutOfSrgb(px).out;
  }
  check('sRGB colors read through an 8-bit P3 canvas are never flagged (5-step grid)', flagged === 0, flagged + ' flagged');
  eq('transparent pixels are skipped', E.countOutOfSrgb(new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 255])), { out: 1, total: 1 });
  eq('P3 pure red is outside sRGB', E.countOutOfSrgb(new Uint8ClampedArray([255, 0, 0, 255])).out, 1);
}

// ── 7. Helpers ──
eq('fitWithin landscape', E.fitWithin(4000, 3000, 640), { w: 640, h: 480 });
eq('fitWithin portrait', E.fitWithin(1080, 2400, 640), { w: 288, h: 640 });
eq('fitWithin small images unchanged', E.fitWithin(300, 200, 640), { w: 300, h: 200 });
eq('fitWithin never 0', E.fitWithin(10000, 3, 640), { w: 640, h: 1 });
eq('fitImageSize over the canvas limit', E.fitImageSize(8000, 6000, E.MAX_CANVAS_AREA).scaled, true);
check('fitImageSize result fits the limit', (() => { const f = E.fitImageSize(8000, 6000, E.MAX_CANVAS_AREA); return f.w * f.h <= 16777216 && Math.abs(f.w / f.h - 4 / 3) < 0.001; })());
eq('downloadName dichromacy', E.downloadName('dashboard.png', 'deuteranopia', 0.6), 'dashboard-deuteranopia.png');
eq('downloadName anomaly has severity', E.downloadName('chart.final.JPEG', 'protanomaly', 0.3), 'chart.final-protanomaly-0.3.png');
eq('downloadName strips unsafe characters', E.downloadName('a/b:c?.webp', 'tritanopia', 0.6), 'a-b-c-tritanopia.png');
eq('downloadName fallback', E.downloadName('', 'achromatopsia', 0.6), 'image-achromatopsia.png');

// ── 8. STRINGS ──
const sStart = source.indexOf('/* ── strings:start ── */'), sEnd = source.indexOf('/* ── strings:end ── */');
const STRINGS = new Function(source.slice(sStart, sEnd).replace('const STRINGS =', 'return') )();
const clientStrings = new Function('STRINGS', 'lang', source.slice(source.indexOf('const T = STRINGS', sEnd), source.indexOf('const TYPES =', sEnd)) + '\nreturn { TIPS, CLIENT_T };');
{
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(STRINGS.en).sort();
  for (const l of langs) eq(l + ' has the same keys as en', Object.keys(STRINGS[l]).sort(), keys);
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of langs) for (const k of keys.filter(k => k !== 'tips')) check(l + '.' + k + ' placeholders', typeof STRINGS[l][k] === 'string' && ph(STRINGS[l][k]) === ph(STRINGS.en[k]), STRINGS[l][k]);
  const script = source.slice(source.indexOf('<script is:inline'), source.indexOf('</script>'));
  const used = new Set([...script.matchAll(/\bt\.([A-Za-z_]+)/g)].map((m) => m[1]));
  for (const k of used) check('script key t.' + k + ' exists', k in STRINGS.en);
  for (const code of ['empty', 'hexLength', 'hexChar', 'unsupportedFn', 'fnArgs', 'fnValue', 'unknown']) check('err_' + code + ' exists', ('err_' + code) in STRINGS.en);
  for (const note of ['alphaIgnored', 'clamped', 'mapped']) check('note_' + note + ' exists', ('note_' + note) in STRINGS.en);
  for (const tp of E.CVD_TYPES) for (const l of langs) check(l + ' label and sub for ' + tp, !!STRINGS[l][tp] && !!STRINGS[l][tp + 'Sub']);
  for (const v of ['same', 'close', 'ok']) check('verdict_' + v + ' exists', ('verdict_' + v) in STRINGS.en);

  // ── 9. Static checks ──
  check('page script writes no HTML (no innerHTML / insertAdjacentHTML / outerHTML)', !/innerHTML|insertAdjacentHTML|outerHTML/.test(script));
  check('page script does not use storage directly', !/localStorage|sessionStorage|document\.cookie/.test(script));
  check('page script makes no network requests', !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(script));
  check('persistence.ts stores preferences only', /'color-blindness-simulator': 'preference'/.test(read('src/data/persistence.ts')));
  check('saved preferences contain no image or colors', /ztPersist\.save\(SLUG, \{ mode: state\.mode, view: state\.view, compareType: state\.compareType, severity: state\.severity \}\)/.test(script));
  check('screen capture stops every track', /getTracks\(\)\.forEach\(function \(tr\) \{ tr\.stop\(\); \}\)/.test(script));
}

// ── 10. Chrome DevTools "Emulate vision deficiencies" (Chrome 152 on macOS with a Display P3
// screen, measured 2026-10-02) ──
// 24 swatches rendered with Emulation.setEmulatedVisionDeficiency and read from
// Page.captureScreenshot (sRGB). DevTools uses the Machado severity-1.0 matrices rounded to 3
// decimals (vision_deficiency.cc). The values match those matrices applied in *Display P3* linear
// light (the screen's color space) within ±2, not in sRGB linear light: on such a screen DevTools
// and this tool differ by up to DEVTOOLS_MAX_DIFF levels per channel. The tool pages quote this.
const DEVTOOLS = {
  protanopia: [['#E74C3C', [123,110,61]], ['#2E7D32', [129,113,43]], ['#D32F2F', [102,90,48]], ['#ED6C02', [149,129,0]], ['#0288D1', [93,138,211]], ['#FF0000', [112,97,6]], ['#00FF00', [255,228,0]], ['#0000FF', [0,86,255]], ['#FFFF00', [255,244,0]], ['#00FFFF', [235,241,254]], ['#FF00FF', [0,129,255]], ['#808080', [128,128,128]], ['#1F77B4', [85,122,181]], ['#FF7F0E', [169,146,0]], ['#2CA02C', [165,144,25]], ['#D62728', [100,88,41]], ['#9467BD', [74,122,192]], ['#8C564B', [100,94,75]], ['#E377C2', [121,147,197]], ['#17BECF', [170,181,207]], ['#BCBD22', [207,180,0]], ['#7F7F7F', [127,127,127]], ['#3B82F6', [40,143,249]], ['#22C55E', [201,178,85]]],
  deuteranopia: [['#E74C3C', [156,138,52]], ['#2E7D32', [121,109,56]], ['#D32F2F', [134,119,37]], ['#ED6C02', [174,153,0]], ['#0288D1', [69,125,208]], ['#FF0000', [158,137,0]], ['#00FF00', [246,217,62]], ['#0000FF', [0,59,252]], ['#FFFF00', [255,250,53]], ['#00FFFF', [211,224,255]], ['#FF00FF', [80,149,250]], ['#808080', [128,128,128]], ['#1F77B4', [67,110,179]], ['#FF7F0E', [194,169,0]], ['#2CA02C', [155,137,57]], ['#D62728', [135,119,24]], ['#9467BD', [86,123,187]], ['#8C564B', [111,102,75]], ['#E377C2', [146,159,191]], ['#17BECF', [152,168,207]], ['#BCBD22', [209,184,49]], ['#7F7F7F', [127,127,127]], ['#3B82F6', [0,128,244]], ['#22C55E', [186,169,103]]],
  tritanopia: [['#E74C3C', [254,33,78]], ['#2E7D32', [38,122,108]], ['#D32F2F', [232,0,57]], ['#ED6C02', [255,78,97]], ['#0288D1', [0,153,161]], ['#FF0000', [255,0,33]], ['#00FF00', [0,247,215]], ['#0000FF', [0,105,148]], ['#FFFF00', [255,238,219]], ['#00FFFF', [0,255,253]], ['#FF00FF', [255,76,152]], ['#808080', [128,128,128]], ['#1F77B4', [0,133,140]], ['#FF7F0E', [255,98,113]], ['#2CA02C', [32,155,136]], ['#D62728', [237,0,51]], ['#9467BD', [138,117,137]], ['#8C564B', [152,79,84]], ['#E377C2', [237,122,150]], ['#17BECF', [0,198,193]], ['#BCBD22', [205,177,162]], ['#7F7F7F', [127,127,127]], ['#3B82F6', [0,157,175]], ['#22C55E', [0,193,173]]],
  achromatopsia: [['#E74C3C', [128,128,128]], ['#2E7D32', [111,111,111]], ['#D32F2F', [109,109,109]], ['#ED6C02', [144,144,144]], ['#0288D1', [130,130,130]], ['#FF0000', [124,124,124]], ['#00FF00', [222,222,222]], ['#0000FF', [73,73,73]], ['#FFFF00', [248,248,248]], ['#00FFFF', [231,231,231]], ['#FF00FF', [141,141,141]], ['#808080', [128,128,128]], ['#1F77B4', [114,114,114]], ['#FF7F0E', [161,161,161]], ['#2CA02C', [141,141,141]], ['#D62728', [109,109,109]], ['#9467BD', [122,122,122]], ['#8C564B', [100,100,100]], ['#E377C2', [155,155,155]], ['#17BECF', [173,173,173]], ['#BCBD22', [183,183,183]], ['#7F7F7F', [127,127,127]], ['#3B82F6', [133,133,133]], ['#22C55E', [173,173,173]]],
};
const DEVTOOLS_ROUNDED = {
  protanopia: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  deuteranopia: [0.367, 0.861, -0.228, 0.280, 0.673, 0.047, -0.012, 0.043, 0.969],
  tritanopia: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
  achromatopsia: [0.213, 0.715, 0.072, 0.213, 0.715, 0.072, 0.213, 0.715, 0.072],
};
const DEVTOOLS_MAX_DIFF = { protanopia: 25, deuteranopia: 24, tritanopia: 32, achromatopsia: 4 };
for (const [type, rows] of Object.entries(DEVTOOLS)) {
  let worstP3 = 0, worstEngine = 0, at = '';
  const m = DEVTOOLS_ROUNDED[type];
  for (const [hex, got] of rows) {
    const p = new Color(hex).to('p3-linear').coords;
    const o = [0, 1, 2].map((r) => Math.min(1, Math.max(0, m[r * 3] * p[0] + m[r * 3 + 1] * p[1] + m[r * 3 + 2] * p[2])));
    const p3model = new Color('p3-linear', o).to('srgb').coords.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
    const dp = Math.max(...got.map((v, i) => Math.abs(v - p3model[i])));
    if (dp > worstP3) { worstP3 = dp; at = hex + ' devtools ' + got + ' model ' + p3model; }
    const exp = E.simulateRgb(rgbOf(hex), E.cvdMatrix(type, 1));
    worstEngine = Math.max(worstEngine, ...got.map((v, i) => Math.abs(v - exp[i])));
  }
  check('Chrome DevTools ' + type + ' = Machado in Display P3 linear light, ±2 (' + rows.length + ' swatches)', worstP3 <= 2, 'worst ' + worstP3 + ' at ' + at);
  eq('Chrome DevTools ' + type + ' largest difference from the engine', worstEngine, DEVTOOLS_MAX_DIFF[type]);
}
check('DevTools tritanopia of #2CA02C is rgb(32, 155, 136); the engine gives rgb(0, 155, 137)', JSON.stringify(DEVTOOLS.tritanopia.find((r) => r[0] === '#2CA02C')[1]) === '[32,155,136]' && JSON.stringify(E.simulateRgb(rgbOf('#2CA02C'), E.cvdMatrix('tritanopia', 1))) === '[0,155,137]');

// ── 11. Tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = read('src/content/tools/color-blindness-simulator/' + lang + '.mdx');
  const text = mdx.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const notes = [...mdx.matchAll(/\{\/\* cbs-check: (\{[\s\S]*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ' page has cbs-check annotations', notes.length >= 3, notes.length + ' found');
  for (const n of notes) {
    if (n.matrix) {
      // Another tool's 3×3 matrix (from its page source), applied to sRGB values or in linear light.
      const c = rgbOf(n.hex), m = n.matrix;
      const v = n.space === 'linear' ? c.map(lin) : c.map((x) => x / 255);
      const o = [0, 1, 2].map((r) => Math.min(1, Math.max(0, m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])));
      const out = n.space === 'linear' ? o.map(enc) : o.map((x) => Math.round(x * 255));
      eq(lang + ' other tool matrix on ' + n.hex, 'rgb(' + out.join(', ') + ')', n.out);
      check(lang + ' page shows ' + n.out, text.includes(n.out));
    } else if (n.hex) {
      const got = sim(n.hex, n.type, n.severity ?? 0.6);
      eq(lang + ' ' + n.hex + ' under ' + n.type, got, n.out);
      check(lang + ' page shows ' + n.out, text.includes(n.out));
    } else if (n.colors) {
      const colors = n.colors.map((h) => ({ rgb: rgbOf(h), hex: h, label: h }));
      const row = E.analyzePalette(colors, n.severity ?? 0.6).find((r) => r.type === n.type);
      const p = n.pair ? row.pairs.find((x) => x.i === n.pair[0] && x.j === n.pair[1]) : row.closest;
      eq(lang + ' palette ' + n.colors.join(',') + ' ' + n.type + (n.pair ? ' pair ' + n.pair : ' closest'), { de: E.fmtDe(p.de), cr: E.fmtCr(p.cr), verdict: p.verdict }, { de: n.de, cr: n.cr, verdict: n.verdict });
      if (n.closest) eq(lang + ' closest pair of ' + n.colors.join(','), [row.closest.i, row.closest.j], n.closest);
      check(lang + ' page shows ΔEOK ' + n.de, text.includes(n.de));
      if (n.cr) check(lang + ' page shows contrast ' + n.cr, text.includes(n.cr));
      if (n.sims) for (const [h, s] of Object.entries(n.sims)) {
        eq(lang + ' ' + h + ' under ' + n.type, sim(h, n.type, n.severity ?? 0.6), s);
        check(lang + ' page shows ' + s, text.includes(s));
      }
    }
  }
}

// ── 12. Real page lifecycle ──
// Canvas boundary retains fixture RGBA; sample vectors are no-ops, so only sample identity,
// dimensions and removal of private pixels are checked here. Real rendering uses browser QA.
{
const lifecycleStart = { passes, failures };
const src = source, component = 'ColorBlindnessSimulatorTool.astro', layoutFile = 'src/layouts/ToolLayout.astro';
const script = src.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const types = vm.runInNewContext(src.match(/const TYPES = (.*?) as const;/)[1]);
const layoutSource = read(layoutFile);
const shortcutStart = layoutSource.indexOf('// ── Keyboard shortcuts:');
const shortcutEnd = layoutSource.indexOf('// ── Copy button visual feedback', shortcutStart);
if (shortcutStart < 0 || shortcutEnd < shortcutStart) throw new Error('Actual shortcut block missing');
const shortcut = layoutSource.slice(shortcutStart, shortcutEnd);
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function page(lang = 'en', prefs = null, shellFirst = false) {
  const strings = clientStrings(STRINGS, lang).CLIENT_T;
  const defaults = vm.runInNewContext("const lang=" + JSON.stringify(lang) + ";\n" + src.slice(src.indexOf('const DEFAULT_COLORS = '), src.indexOf('\n---', src.indexOf('const DEFAULT_COLORS = '))) + '\nDEFAULT_COLORS');
  const clipboardJobs = [], faults = {};
  const nodes = [], ids = new Map(), timers = new Map(), imageJobs = [], mediaJobs = [], videos = [], blobs = [], downloads = [], revoked = [], urls = new Map(), tracks = [], savedPrefs = [], clearCalls = [];
  let timerId = 0, urlId = 0;
  const doc = { listeners: {}, activeElement: null };
  function matches(n,s) {
    return s.split(',').some(raw => {
      let selector=raw.trim();
      const attrs=[...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      selector=selector.replace(/\[[^\]]+\]/g,'');
      const id=/#([\w-]+)/.exec(selector), classes=[...selector.matchAll(/\.([\w-]+)/g)], tag=/^[\w-]+/.exec(selector);
      return (!id||n.id===id[1])&&classes.every(c=>n.classList.contains(c[1]))&&(!tag||n.tagName===tag[0].toUpperCase())&&attrs.every(a=>a[2]===undefined?n.getAttribute(a[1])!==null:n.getAttribute(a[1])===a[2]);
    });
  }
  class Element {
    constructor(tag='div') { Object.assign(this,{tagName:tag.toUpperCase(),id:'',className:'',attributes:{},style:{},children:[],parentNode:null,listeners:{},value:'',type:tag==='input'?'text':'',hidden:false,disabled:false,files:[]}); }
    get classList(){const self=this;return{contains:c=>self.className.split(/\s+/).includes(c),add(c){if(!this.contains(c))self.className+=' '+c;},remove(c){self.className=self.className.split(/\s+/).filter(v=>v!==c).join(' ');}};}
    setAttribute(k,v){v=String(v);this.attributes[k]=v;if(['id','class','type','value'].includes(k))this[k==='class'?'className':k]=v;}
    getAttribute(k){if(k==='type')return this.type;return this.attributes[k]??null;}
    get textContent(){return(this.text||'')+this.children.map(c=>c.textContent).join('');}
    set textContent(v){if(this.children.some(c=>c.contains(doc.activeElement)))doc.activeElement=doc.body;for(const c of this.children)c.parentNode=null;this.text=String(v);this.children=[];}
    get firstChild(){return this.children[0]||null;}
    appendChild(n){n.parentNode=this;this.children.push(n);return n;}
    remove(){if(this.contains(doc.activeElement))doc.activeElement=doc.body;if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
    contains(n){return n===this||this.children.some(c=>c.contains(n));}
    querySelectorAll(s){return this.children.flatMap(n=>[...(matches(n,s)?[n]:[]),...n.querySelectorAll(s)]);}
    querySelector(s){return this.querySelectorAll(s)[0]||null;}
    closest(s){for(let n=this;n;n=n.parentNode)if(matches(n,s))return n;return null;}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type,extra={}){const e={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(let n=this;n&&!e.stopped;n=n.parentNode)for(const fn of n.listeners[type]||[])fn(e);return e;}
    click(){if(this.disabled)return;if(this.tagName==='A')downloads.push({name:this.download,blob:urls.get(this.href)});this.dispatch('click');}
    focus(){doc.activeElement=this;}
    select(){}
    getBoundingClientRect(){return{left:0,top:0,width:300,height:200,bottom:200};}
  }
  class Canvas extends Element {
    constructor(){super('canvas');this.width=1;this.height=1;this.pixel=[0,0,0,255];this.pixels=null;this.context={
      drawImage:source=>{if(faults.draw){faults.draw=false;throw new Error('fixture draw');}this.pixel=source.pixel||[0,0,0,255];this.pixels=source.pixels&&new Uint8ClampedArray(source.pixels);},
      getImageData:(x,y,w,h)=>{const a=new Uint8ClampedArray(w*h*4);if(this.pixels?.length===a.length)a.set(this.pixels);else for(let i=0;i<a.length;i+=4)a.set(this.pixel,i);return{data:a,width:w,height:h};},
      putImageData:data=>{this.pixels=new Uint8ClampedArray(data.data);},
      getContextAttributes:()=>({colorSpace:'srgb'}),
      fillRect(){},beginPath(){},roundRect(){},rect(){},fill(){},moveTo(){},lineTo(){},stroke(){},arc(){},
      createLinearGradient:()=>({addColorStop(){}}),
    };}
    getContext(){return this.context;}
    toBlob(callback,type){if(faults.blob){faults.blob=false;throw new Error('fixture toBlob');}const data=this.context.getImageData(0,0,this.width,this.height).data;blobs.push({callback,blob:{type,width:this.width,height:this.height,data:new Uint8ClampedArray(data)}});}
  }
  const body = new Element('body'), widget = new Element('div');widget.className='tool-widget';body.appendChild(widget);
  let markup=src.slice(src.indexOf('\n---',4)+4,src.indexOf('<script'));
  markup=markup.replace(/\{TYPES\.map\(\(t\) => \(([\s\S]*?)\)\)\}/g,(_,template)=>types.map(type=>template.replace(/data-type=\{t\}/g,'data-type="'+type+'"').replace(/id=\{`cbs-canvas-\$\{t\}`\}/g,'id="cbs-canvas-'+type+'"')).join(''));
  const stack=[widget], voidTags=new Set(['input','br','hr','img','meta','link']);
  for(const match of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)){
    const tag=match[1];if(match[0].startsWith('</')){if(stack.at(-1)?.tagName===tag.toUpperCase())stack.pop();continue;}
    const attrs=match[2],n=tag==='canvas'?new Canvas():new Element(tag);
    for(const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g))n.setAttribute(a[1],a[2]);
    n.hidden=/\bhidden(?=\s|\/|$)/.test(attrs);n.disabled=/\bdisabled(?=\s|\/|$)/.test(attrs);
    stack.at(-1).appendChild(n);nodes.push(n);if(n.id)ids.set(n.id,n);if(!voidTags.has(tag)&&!attrs.endsWith('/'))stack.push(n);
  }
  const get=id=>{if(!ids.has(id))throw new Error('Unknown actual element '+id);return ids.get(id);};
  get('cbs-colors').value=defaults;
  function newElement(tag){if(tag==='canvas')return new Canvas();const n=new Element(tag);if(tag==='video'){n.videoWidth=4;n.videoHeight=2;n.pixel=[180,180,180,255];n.play=()=>{if(faults.play){faults.play=false;return Promise.reject(new Error('fixture play rejected'));}return Promise.resolve();};videos.push(n);}return n;}
  Object.assign(doc,{body,getElementById:get,createElement:newElement,
    querySelector:s=>s==='.tool-widget'?widget:s==='.tool-widget .btn-primary'?widget.querySelector('.btn-primary'):widget.querySelector(s),
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},
    dispatch(type,extra={}){const e={type,target:doc.activeElement,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners[type]||[])fn(e);return e;},execCommand:()=>false});
  class ControlledImage {set src(url){this.url=url;imageJobs.push({image:this,file:urls.get(url)});}}
  const sandbox={document:doc,console,t:strings,Image:ControlledImage,ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},Uint8ClampedArray,Uint8Array,ArrayBuffer,Blob,
    navigator:{mediaDevices:{getDisplayMedia(options){const job=deferred();job.options=options;mediaJobs.push(job);return job.promise;}},clipboard:{writeText(text){const job=deferred();job.text=text;clipboardJobs.push(job);return job.promise;}}},
    URL:{createObjectURL(value){const url='blob:fixture-'+(++urlId);urls.set(url,value);return url;},revokeObjectURL(url){revoked.push(url);}},
    setTimeout(fn,ms=0){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame(fn){const id=++timerId;timers.set(id,{fn,ms:0});return id;},cancelAnimationFrame:id=>timers.delete(id),
    innerHeight:900,scrollBy(){},trackTool(...args){tracks.push(args);},ztPersist:{load:()=>prefs,save:(slug,value)=>savedPrefs.push({slug,value}),clear:slug=>clearCalls.push(slug)},_slug:'color-blindness-simulator',
  };sandbox.window=sandbox;
  const context=vm.createContext(sandbox);
  if(shellFirst)vm.runInContext(shortcut,context,{filename:layoutFile});
  vm.runInContext(script,context,{filename:component,timeout:10000});
  if(!shellFirst)vm.runInContext(shortcut,context,{filename:layoutFile});
  function flushZeros(){let count=0;while([...timers.values()].some(t=>t.ms===0)){if(++count>30)throw new Error('Unexpected timer loop');for(const[id,t]of[...timers])if(t.ms===0){timers.delete(id);t.fn();}}}
  function startFile(name){get('cbs-file').files=[{name,type:'image/png'}];get('cbs-file').dispatch('change');return imageJobs.at(-1);}
  function releaseFile(job,{width=3,height=2,pixel=[72,72,72,255],error=false}={}){if(error){job.image.onerror();return;}Object.assign(job.image,{naturalWidth:width,naturalHeight:height,pixel});job.image.onload();}
  function clear(focus='cbs-colors',mod='ctrlKey'){get(focus).focus();return doc.dispatch('keydown',{[mod]:true,key:'l'});}
  function flushAll(){for(const[id,t]of[...timers]){timers.delete(id);t.fn();}flushZeros();}
  function colors(value='#FF0000\n#00FF00'){get('cbs-tab-colors').click();get('cbs-colors').value=value;get('cbs-colors').dispatch('input');}
  function snapshot(){return{status:get('cbs-status').textContent,info:get('cbs-imginfo').textContent,infoHidden:get('cbs-imginfo').hidden,imagePanelHidden:get('cbs-image-panel').hidden,colorsPanelHidden:get('cbs-colors-panel').hidden,colors:get('cbs-colors').value,tableHidden:get('cbs-table-wrap').hidden,tableChildren:get('cbs-table').children.length,gridHidden:get('cbs-grid').hidden,canvasWidth:get('cbs-canvas-original').width,canvasPixel:[...(get('cbs-canvas-original').pixels?.slice(0,4)||[])]};}
  function download(type='achromatopsia'){const b=get('cbs-wrap').querySelectorAll('.cbs-dl').find(b=>b.getAttribute('data-type')===type);if(!b)throw new Error('Actual download button absent');b.click();}
  function releaseBlob(ok=true){const job=blobs.shift();if(!job)throw new Error('No pending toBlob');job.callback(ok?job.blob:null);return job.blob;}
  return{get,doc,widget,context,clipboardJobs,faults,flushAll,mediaJobs,videos,imageJobs,blobs,downloads,revoked,tracks,savedPrefs,clearCalls,flushZeros,startFile,releaseFile,clear,colors,snapshot,download,releaseBlob};
}
async function scenario(name, fn) {
  try { await fn(); } catch (error) { check(name + ' completes without harness error', false, String(error.stack || error)); }
}
function checkSnapshot(name, p, expected) { eq(name, p.snapshot(), expected); }
function buttonsReady(p) { return p.get('cbs-wrap').querySelectorAll('.cbs-dl').every(b => !b.disabled); }
function prefsOf(p) { return { severity: p.get('cbs-severity').value, compareType: p.get('cbs-compare-type').value, modes: p.get('cbs-wrap').querySelectorAll('.cbs-tab').map(b => b.getAttribute('aria-pressed')), views: p.get('cbs-wrap').querySelectorAll('.cbs-seg-btn').map(b => b.getAttribute('aria-pressed')) }; }
function streamFixture() { const tracks = [{ stopped: 0, stop() { this.stopped++; } }, { stopped: 0, stop() { this.stopped++; } }]; return { stream: { getTracks: () => tracks }, tracks }; }
async function startCapture(p) { const n = p.mediaJobs.length; p.get('cbs-capture').click(); await microtasks(); return p.mediaJobs[n]; }
async function releaseStream(p, job, fixture) { const n = p.videos.length; job.resolve(fixture.stream); await microtasks(); return p.videos[n]; }
function clearImage(p) { p.clear('cbs-open'); }
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) await scenario(lang + ' synchronous clear order ' + shellFirst, async () => {
  const p = page(lang, null, shellFirst), initial = p.snapshot();
  check(lang + ' startup sample visible', initial.canvasWidth === 640 && initial.infoHidden && initial.status === '' && !initial.gridHidden);
  const first = p.startFile('private.png'); p.releaseFile(first, { pixel: [72,72,72,255] });
  const preferences = prefsOf(p), event = p.clear('cbs-open', shellFirst ? 'metaKey' : 'ctrlKey');
  const cleared = p.snapshot();
  check(lang + ' shortcut prevented at shared handler', event.defaultPrevented);
  check(lang + ' user image synchronously replaced with initial sample', cleared.canvasWidth === initial.canvasWidth && JSON.stringify(cleared.canvasPixel) === JSON.stringify(initial.canvasPixel) && cleared.info === initial.info && cleared.infoHidden && cleared.status === '');
  eq(lang + ' preferences unchanged by clear', prefsOf(p), preferences);
  eq(lang + ' selected file input cleared', p.get('cbs-file').value, '');
  check(lang + ' previous image object URL released', p.revoked.includes(first.image.url));
  eq(lang + ' shared persistence clear preserved', p.clearCalls, ['color-blindness-simulator']);
  p.download(); p.flushZeros(); p.releaseBlob();
  eq(lang + ' clear permits only new sample download name', p.downloads.at(-1).name, STRINGS[lang].sampleName + '-achromatopsia.png');
  eq(lang + ' sample download dimensions', [p.downloads.at(-1).blob.width, p.downloads.at(-1).blob.height], [960,600]);
  check(lang + ' sample export excludes private pixels', p.downloads.at(-1).blob.data[0] !== 72);
  p.releaseFile(p.startFile('private-again.png')); p.colors();
  check(lang + ' real palette engine creates table', !p.snapshot().tableHidden && p.snapshot().tableChildren === 2);
  p.clear('cbs-colors');
  check(lang + ' palette clears synchronously before timers', p.snapshot().colors === '' && p.snapshot().tableHidden && p.snapshot().tableChildren === 0 && p.snapshot().status === STRINGS[lang].colorsEmpty);
  p.get('cbs-tab-image').click();
  check(lang + ' returning from cleared colors shows sample', p.snapshot().infoHidden && p.snapshot().info === initial.info && p.snapshot().canvasWidth === initial.canvasWidth);
});
await scenario('stored preferences and outside focus', async () => {
  const p = page('en', { mode:'image', view:'compare', compareType:'tritanomaly', severity:0.3 });
  p.releaseFile(p.startFile('private.png')); const preferences = prefsOf(p);
  p.clear('cbs-open'); eq('stored preference values survive clear', prefsOf(p), preferences);
  eq('only existing preference fields are saved', p.savedPrefs, []);
  p.colors(); const before = p.snapshot(); p.doc.activeElement = p.doc.body;
  p.doc.dispatch('keydown', { ctrlKey:true, key:'l' }); p.flushZeros(); checkSnapshot('outside focus leaves palette/status unchanged', p, before);
});
for (const action of ['file', 'sample', 'clear', 'invalid', 'colors']) for (const error of [false, true]) await scenario('old file ' + action + ' ' + error, async () => {
  const p = page(), old = p.startFile('old.png');
  if(action === 'file') p.releaseFile(p.startFile('new.png'), { pixel:[110,110,110,255] });
  if(action === 'sample') p.get('cbs-sample').click();
  if(action === 'clear') clearImage(p);
  if(action === 'invalid') { p.get('cbs-file').files = [{name:'bad.txt',type:'text/plain'}]; p.get('cbs-file').dispatch('change'); }
  if(action === 'colors') { p.colors(); p.clear(); }
  const before = p.snapshot(); p.releaseFile(old, { error, pixel:[30,30,30,255] });
  checkSnapshot('old file completion cannot overwrite ' + action + ' error=' + error, p, before);
  check('obsolete object URL released ' + action + ' error=' + error, p.revoked.includes(old.image.url));
  p.get('cbs-tab-image').click(); p.releaseFile(p.startFile('recovery.png'));
  check('file recovery after ' + action + ' error=' + error, p.snapshot().info.startsWith('recovery.png'));
});
for (const phase of ['permission', 'loadeddata']) for (const action of ['clear', 'sample', 'file', 'colors']) await scenario('capture cancel ' + phase + ' ' + action, async () => {
  const p = page(), job = await startCapture(p), fixture = streamFixture();
  let video, lateFrame;
  if(phase === 'loadeddata') { video = await releaseStream(p, job, fixture); lateFrame = video.onloadeddata; }
  if(action === 'clear') clearImage(p);
  if(action === 'sample') p.get('cbs-sample').click();
  if(action === 'file') p.releaseFile(p.startFile('new.png'));
  if(action === 'colors') { p.colors(); p.clear(); }
  const before = p.snapshot();
  check('cancelled capture button immediately restored ' + phase + ' ' + action, !p.get('cbs-capture').disabled);
  if(phase === 'loadeddata') eq('existing tracks stop before frame event ' + action, fixture.tracks.map(t=>t.stopped), [1,1]);
  if(phase === 'permission') { video = await releaseStream(p, job, fixture); if(video?.onloadeddata) video.onloadeddata(); }
  else lateFrame();
  await microtasks();
  checkSnapshot('late capture preserves newer state ' + phase + ' ' + action, p, before);
  eq('every stale capture track stopped once ' + phase + ' ' + action, fixture.tracks.map(t=>t.stopped), [1,1]);
  check('capture button restored after settlement ' + phase + ' ' + action, !p.get('cbs-capture').disabled);
});
for (const reject of [false, true]) await scenario('old capture cannot unlock newer capture ' + reject, async () => {
  const p = page(), old = await startCapture(p); clearImage(p);
  const fresh = await startCapture(p);
  check('new capture can start after cancel', !!fresh);
  if(!fresh) return;
  const before = p.snapshot(), stale = streamFixture();
  if(reject) old.reject(Object.assign(new Error('old denied'), {name:'NotAllowedError'}));
  else { const v = await releaseStream(p, old, stale); if(v?.onloadeddata) v.onloadeddata(); }
  await microtasks(); check('old settlement leaves new button disabled', p.get('cbs-capture').disabled); checkSnapshot('old settlement leaves new status intact', p, before);
  const current = streamFixture(), video = await releaseStream(p, fresh, current); video.onloadeddata(); await microtasks();
  check('new capture supplies its frame', p.snapshot().info.startsWith(STRINGS.en.captureName) && p.snapshot().canvasWidth === 4);
  eq('new capture stops all tracks', current.tracks.map(t=>t.stopped), [1,1]);
  check('new capture releases own button', !p.get('cbs-capture').disabled);
});
for (const phase of ['permission', 'video']) await scenario('current capture error and recovery ' + phase, async () => {
  const p = page(), job = await startCapture(p), f = streamFixture();
  if(phase === 'permission') job.reject(Object.assign(new Error('denied'), {name:'NotAllowedError'}));
  else { const video = await releaseStream(p, job, f); video.onerror(); }
  await microtasks(); check('current capture error visible ' + phase, !!p.snapshot().status); check('capture error releases button ' + phase, !p.get('cbs-capture').disabled);
  if(phase === 'video') eq('failed video stops tracks', f.tracks.map(t=>t.stopped), [1,1]);
  const next = await startCapture(p), ok = streamFixture(), video = await releaseStream(p,next,ok); video.onloadeddata(); await microtasks();
  check('capture recovers after ' + phase, p.snapshot().canvasWidth === 4 && !p.get('cbs-capture').disabled);
});
for (const large of [false,true]) for (const action of ['file','sample','clear','colors']) await scenario('PNG snapshot ' + large + ' ' + action, async () => {
  const p = page(), width = large ? 600 : 3, height = large ? 500 : 2;
  p.releaseFile(p.startFile('old.png'), {width,height,pixel:[72,72,72,255]}); p.download();
  check('PNG starts with buttons disabled ' + large + ' ' + action, !buttonsReady(p));
  check('PNG async boundary reached ' + large + ' ' + action, large ? p.blobs.length === 0 : p.blobs.length === 1);
  if(action === 'file') p.releaseFile(p.startFile('new.png'), {pixel:[150,150,150,255]});
  if(action === 'sample') p.get('cbs-sample').click();
  if(action === 'clear') clearImage(p);
  if(action === 'colors') { p.colors(); p.clear(); }
  const before = p.snapshot(); p.flushZeros(); checkSnapshot('late slice progress suppressed ' + large + ' ' + action, p, before); p.releaseBlob();
  const result = p.downloads.at(-1);
  eq('click-time PNG name and dimensions ' + large + ' ' + action, [result.name,result.blob.width,result.blob.height], ['old-achromatopsia.png',width,height]);
  check('click-time PNG pixels ' + large + ' ' + action, [...result.blob.data].every((v,i)=>v===(i%4===3?255:72)));
  checkSnapshot('late PNG success leaves newer state ' + large + ' ' + action, p, before);
  check('PNG completion releases buttons ' + large + ' ' + action, buttonsReady(p));
  p.get('cbs-tab-image').click(); p.download(); p.flushZeros(); p.releaseBlob(); eq('PNG busy released for next request ' + large + ' ' + action, p.downloads.length, 2);
});
for (const stale of [false,true]) await scenario('null PNG and recovery ' + stale, async () => {
  const p = page(); p.releaseFile(p.startFile('tiny.png')); p.download(); if(stale) clearImage(p); const before = p.snapshot(); p.releaseBlob(false);
  eq('null blob does not download ' + stale, p.downloads.length, 0); check('null blob releases buttons ' + stale, buttonsReady(p));
  if(stale) checkSnapshot('old PNG error is silent',p,before); else check('current PNG error is visible', p.get('cbs-status').className.includes('is-error'));
  p.download(); p.flushZeros(); p.releaseBlob(); eq('download recovers from null blob ' + stale,p.downloads.length,1);
});
for (const fault of ['draw','blob']) await scenario('PNG synchronous exception ' + fault, async () => {
  const p = page(); p.releaseFile(p.startFile('tiny.png')); p.faults[fault] = true; p.download();
  check('PNG exception reports error ' + fault,p.get('cbs-status').className.includes('is-error')); check('PNG exception releases buttons ' + fault,buttonsReady(p));
  p.download();p.releaseBlob();eq('PNG exception recovery ' + fault,p.downloads.length,1);
});
for (const reject of [false,true]) for (const action of ['clear','edit']) await scenario('late copy ' + reject + ' ' + action,async()=>{
  const p=page();p.colors();p.get('cbs-table').querySelector('.cbs-swatch').click();const job=p.clipboardJobs[0];
  if(action==='clear')p.clear();else p.colors('#000000\n#FFFFFF');const before=p.snapshot();
  if(reject)job.reject(new Error('clipboard denied'));else job.resolve();await microtasks();
  checkSnapshot('copy settlement preserves newer palette '+reject+' '+action,p,before);
});
for (const reject of [false,true]) await scenario('current copy and recovery '+reject,async()=>{
  const p=page();p.colors();const swatch=p.get('cbs-table').querySelector('.cbs-swatch');swatch.click();
  eq('current copy sends displayed color '+reject,p.clipboardJobs[0].text,'#FF0000');
  if(reject)p.clipboardJobs[0].reject(new Error('clipboard denied'));else p.clipboardJobs[0].resolve();await microtasks();
  eq('current copy reports its own result '+reject,p.snapshot().status,reject?STRINGS.en.copyFailed:STRINGS.en.copied.replace('{value}','#FF0000'));
  swatch.click();p.clipboardJobs[1].resolve();await microtasks();
  eq('copy recovers after settlement '+reject,p.snapshot().status,STRINGS.en.copied.replace('{value}','#FF0000'));
});
await scenario('queued severity and palette work cleared',async()=>{
  const p=page();p.colors();p.get('cbs-severity').value='3';p.get('cbs-severity').dispatch('input');p.clear();const before=p.snapshot();p.flushAll();await microtasks();
  checkSnapshot('queued jobs do not restore cleared palette',p,before);check('cancelled palette analytics do not run',!p.tracks.some(t=>t[1]==='palette'));
});

// Review regressions: reject play without video events, preserve newer severity status,
// and keep shared shortcut focus after removing a dynamically focused swatch.
await scenario('play rejection without loadeddata or error',async()=>{
  const p=page();p.faults.play=true;const job=await startCapture(p),f=streamFixture();await releaseStream(p,job,f);await microtasks();
  check('play rejection reports capture failure',p.snapshot().status.includes('fixture play rejected'));
  eq('play rejection stops every track without a video event',f.tracks.map(t=>t.stopped),[1,1]);
  check('play rejection restores capture button without a video event',!p.get('cbs-capture').disabled);
});
for(const reject of [false,true]) await scenario('severity supersedes pending copy '+reject,async()=>{
  const p=page();p.colors();p.get('cbs-table').querySelector('.cbs-swatch').click();const job=p.clipboardJobs[0];
  p.get('cbs-severity').value='3';p.get('cbs-severity').dispatch('input');p.flushZeros();const before=p.snapshot();
  if(reject)job.reject(new Error('late copy'));else job.resolve();await microtasks();
  checkSnapshot('old copy cannot overwrite severity summary '+reject,p,before);
});
for(const large of [false,true]) for(const ok of [false,true]) await scenario('severity supersedes PNG status '+large+' '+ok,async()=>{
  const p=page(),rgb=[120,70,200];p.releaseFile(p.startFile('color.png'),{width:large?600:3,height:large?500:2,pixel:[...rgb,255]});p.download('protanomaly');
  p.get('cbs-severity').value='3';p.get('cbs-severity').dispatch('input');const before=p.snapshot();p.flushZeros();
  checkSnapshot('old PNG progress does not replace severity status '+large+' '+ok,p,before);p.releaseBlob(ok);
  checkSnapshot('old PNG settlement does not replace severity status '+large+' '+ok,p,before);
  check('severity change still lets PNG settle buttons '+large+' '+ok,buttonsReady(p));
  if(ok){const result=p.downloads.at(-1);eq('PNG filename retains click-time severity '+large,result.name,'color-protanomaly-0.6.png');eq('PNG pixels retain click-time severity '+large,[...result.blob.data.slice(0,4)],[...E.simulateRgb(rgb,E.cvdMatrix('protanomaly',0.6)),255]);}
  else eq('failed PNG still emits no file '+large,p.downloads.length,0);
});
for(const kind of ['file','capture']) await scenario('severity keeps pending input '+kind,async()=>{
  const p=page(),job=kind==='file'?p.startFile('pending.png'):await startCapture(p);
  p.get('cbs-severity').value='3';p.get('cbs-severity').dispatch('input');p.flushZeros();
  if(kind==='file')p.releaseFile(job);else{const f=streamFixture(),video=await releaseStream(p,job,f);check('severity keeps capture frame request',!!video);if(video?.onloadeddata)video.onloadeddata();await microtasks();}
  check('severity does not discard current '+kind,p.snapshot().info.startsWith(kind==='file'?'pending.png':STRINGS.en.captureName)&&!p.snapshot().infoHidden);
});
for(const shellFirst of [false,true]) await scenario('CtrlL focused swatch order '+shellFirst,async()=>{
  const p=page('en',null,shellFirst);p.colors();const swatch=p.get('cbs-table').querySelector('.cbs-swatch');swatch.focus();
  const event=p.doc.dispatch('keydown',{ctrlKey:true,key:'l'});
  check('focused swatch CtrlL prevents browser location shortcut '+shellFirst,event.defaultPrevented);
  eq('focused swatch still reaches shared clear '+shellFirst,p.clearCalls,['color-blindness-simulator']);
  check('focused swatch moves focus to color input '+shellFirst,p.doc.activeElement===p.get('cbs-colors'));
  check('focused swatch clears table synchronously '+shellFirst,p.snapshot().tableHidden&&p.snapshot().tableChildren===0&&p.snapshot().colors==='');
});

console.log(`Page lifecycle: ${passes-lifecycleStart.passes} passed, ${failures-lifecycleStart.failures} failed`);
}

// ── v2 page layout ──
{
  const layoutStart = { passes, failures };
  const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script is:inline')).trimStart();
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const css = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<\/?style\b[^>]*>/g, '');
  const rules = (selector) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => m[1].split(',').some(s => s.trim() === selector)).map(m => m[2]);
  const property = (body, name, value) => new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*' + value + '\\s*(?:;|$)').test(body);
  check('analyze layout registered', /'color-blindness-simulator':\s*'analyze'/.test(read('src/data/tool-layouts.ts')));
  check('tool root is the direct first element', /^<div class="cbs-wrap" id="cbs-wrap">/.test(template));
  check('root flex column can shrink with its available height', rules('.cbs-wrap').some(r => property(r, 'display', 'flex') && property(r, 'flex-direction', 'column') && property(r, 'min-height', '0')));
  for (const selector of ['.cbs-grid', '.cbs-compare', '.cbs-table-wrap']) {
    check(selector + ' has zero-basis flex and internal scrolling', rules(selector).some(r => property(r, 'flex', '1\\s+1\\s+0') && property(r, 'overflow', 'auto') && property(r, 'min-width', '0')));
    check(selector + ' has a bounded mobile height', rules(selector).some(r => property(r, 'flex', 'none') && property(r, 'height', '[1-9][\\d.]*(?:rem|px)') && property(r, 'min-height', '0')));
    check(selector + ' honors hidden mode', rules(selector + '[hidden]').some(r => property(r, 'display', 'none')));
  }
  check('860px stacks results and 640px adjusts phone controls', /@media\s*\(max-width:\s*860px\)/.test(css) && /@media\s*\(max-width:\s*640px\)/.test(css));
  check('phone comparison stacks original and simulation', /@media\s*\(max-width:\s*640px\)[\s\S]*?\.cbs-compare\s*\{[^}]*grid-template-columns:\s*1fr/.test(css));
  check('status reserves height even when empty', rules('.cbs-status').some(r => property(r, 'height', '[1-9][\\d.]*(?:em|rem|px)') && property(r, 'flex', 'none') && property(r, 'overflow', 'auto')) && !/\.cbs-status:empty/.test(css));
  check('color input stays short independently of its contents', rules('.cbs-colors').some(r => property(r, 'height', '[1-9][\\d.]*(?:rem|px)') && property(r, 'resize', 'none')));
  check('empty desktop colors mode gives its input the available height', rules('.cbs-wrap:has(#cbs-table-wrap[hidden]) #cbs-colors-panel').some(r => property(r, 'flex', '1')) && rules('.cbs-wrap:has(#cbs-table-wrap[hidden]) .cbs-colors').some(r => property(r, 'flex', '1') && property(r, 'height', 'auto')));
  check('controls and status precede full-width results', ['cbs-image-panel', 'cbs-colors-panel', 'cbs-viewctl', 'cbs-status'].every(id => template.indexOf('id="' + id + '"') >= 0 && template.indexOf('id="' + id + '"') < template.indexOf('id="cbs-grid"')));
  check('image notes stay after results and scroll within reserved space', template.indexOf('id="cbs-imginfo"') > template.indexOf('id="cbs-table-wrap"') && rules('.cbs-image-note').some(r => property(r, 'height', '[1-9][\\d.]*(?:em|rem|px)') && property(r, 'overflow', 'auto')));
  check('image note is hidden in colors mode', /\.cbs-wrap:has\(#cbs-image-panel\[hidden\]\)\s*>\s*\.cbs-image-note\s*\{\s*display:\s*none/.test(css));
  check('both mode and result-view switches use shared segmented controls', /class="cbs-tabs zt-segmented"/.test(template) && /class="cbs-seg zt-segmented"/.test(template));
  // Button identities read from e6748489, before the layout migration. The mapped PNG button
  // still expands once for each of the eight engine types; no render button is added or removed.
  const buttons = [...template.matchAll(/<button\b([^>]*)>/g)].map(m => m[1]);
  const buttonIdentity = a => /\bid="([^"]+)"/.exec(a)?.[1] || /\bdata-view="([^"]+)"/.exec(a)?.[1] || (/\bdata-type=\{t\}/.test(a) ? 'PNG per type' : 'unknown');
  eq('all previous action buttons remain', buttons.map(buttonIdentity).sort(), ['cbs-tab-image', 'cbs-tab-colors', 'cbs-open', 'cbs-capture', 'cbs-sample', 'all', 'compare', 'PNG per type', 'cbs-compare-dl'].sort());
  check('all action buttons retain explicit button type', buttons.every(a => /\btype="button"/.test(a)));
  eq('PNG card mapping retains eight types', vm.runInNewContext(source.match(/const TYPES = (.*?) as const;/)[1]), E.CVD_TYPES);
  check('PNG controls still expand inside mapped result cards', /\{TYPES\.map\(\(t\) => \([\s\S]*?<button[^>]*data-type=\{t\}[\s\S]*?\)\)\}/.test(template));
  check('file import remains available', /<input id="cbs-file" type="file" accept="image\/\*,\.svg,\.avif,\.webp"/.test(template));

  const tipKeys = ['mode', 'open', 'capture', 'sample', 'severity', 'view', 'compare', 'download', 'colors'].sort();
  const tips = [...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  eq('nine distinct control tips', tips.map(m => /id="cbs-tip-([^"]+)"/.exec(m[1])?.[1]).sort(), tipKeys);
  for (const tip of tips) {
    const key = /id="cbs-tip-([^"]+)"/.exec(tip[1])?.[1];
    check(key + ' tip has localized label and content', /lang=\{lang\}/.test(tip[1]) && /about=\{T\.\w+\}/.test(tip[1]) && tip[2].includes('{TIPS.' + key + '}'));
  }
  check('only client strings enter inline script', /<script is:inline define:vars=\{\{ t: CLIENT_T \}\}>/.test(source) && !/\bt\.tips\b|\bTIPS\b/.test(script));
  check('labels render at build time without runtime i18n rewriting', !source.includes('data-i18n'));
  const placeholders = text => (text.match(/\{\w+\}/g) || []).sort();
  function checkTipTree(lang, value, reference, path = 'tips') {
    if (reference && typeof reference === 'object') {
      check(lang + '.' + path + ' is an object', value !== null && typeof value === 'object' && !Array.isArray(value));
      eq(lang + '.' + path + ' keys match en', Object.keys(value || {}).sort(), Object.keys(reference).sort());
      for (const key of Object.keys(reference)) checkTipTree(lang, value?.[key], reference[key], path + '.' + key);
    } else {
      check(lang + '.' + path + ' is nonempty text', typeof value === 'string' && value.trim().length > 0);
      eq(lang + '.' + path + ' placeholders match en', placeholders(String(value)), placeholders(reference));
    }
  }
  // e6748489 snapshots: frontmatter without steps, and the complete body after removing only
  // its localized How to Use section. Keep FAQ, SEO, Limits, examples and cbs-check annotations.
  const retained = {
    en: ['f335d0678d73e840', 'e64ed6939c7a26ce'],
    zh: ['43f9b055b2143731', '3acc74e07943eb31'],
    ja: ['b62c8a214b840ecb', 'aea1e91bd77d49e2'],
    ko: ['76f7e8dd15702e06', 'e8b6f000b0091c1b'],
  };
  const hash = text => createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq(lang + ' tip keys cover all controls', Object.keys(STRINGS[lang].tips).sort(), tipKeys);
    checkTipTree(lang, STRINGS[lang].tips, STRINGS.en.tips);
    const { TIPS, CLIENT_T } = clientStrings(STRINGS, lang);
    eq(lang + ' frontmatter keeps tips for HTML', TIPS, STRINGS[lang].tips);
    eq(lang + ' client keys exclude tips only', Object.keys(CLIENT_T).sort(), Object.keys(STRINGS[lang]).filter(k => k !== 'tips').sort());
    check(lang + ' serialized client has no tip text', !('tips' in CLIENT_T) && Object.values(TIPS).every(tip => !JSON.stringify(CLIENT_T).includes(JSON.stringify(tip))));
    const mdx = read('src/content/tools/color-blindness-simulator/' + lang + '.mdx');
    const [, metadata, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx);
    const { steps } = loadYaml(metadata);
    check(lang + ' has one to eight plain-text steps', Array.isArray(steps) && steps.length > 0 && steps.length <= 8 && steps.every(s => typeof s === 'string' && s.trim() && !/<[^>]+>/.test(s)));
    check(lang + ' steps fit per-step and total limits', Array.isArray(steps) && steps.every(s => s.length <= 280) && steps.join('').length <= 1200);
    check(lang + ' usage heading removed', !/<h2>(?:How to Use|操作步骤|使い方|사용 방법)<\/h2>/.test(body));
    check(lang + ' Limits retained', /<h2>(?:Limits|限制|制限|제한 사항)<\/h2>/.test(body));
    eq(lang + ' SEO and FAQ unchanged from before layout', hash(metadata.replace(/^steps:\n(?:  .*\n)*/m, '')), retained[lang][0]);
    eq(lang + ' all non-usage body content unchanged', hash(body), retained[lang][1]);
  }
  console.log(`v2 page layout: ${passes-layoutStart.passes} passed, ${failures-layoutStart.failures} failed`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
