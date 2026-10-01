// Color Blindness Simulator — Machado 2009 matrices in linear RGB, image pipeline, palette check
//
// Read:  src/components/tools/ColorBlindnessSimulatorTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers, the STRINGS table between `strings:start` /
//        `strings:end`, the page script), ColorPaletteGeneratorTool.astro and
//        EyedropperColorPickerTool.astro (engine blocks, to compare the copied declarations),
//        src/data/persistence.ts, the 4 tool page mdx files
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
//
// Run: node scripts/test-color-blindness-simulator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { converter, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit, differenceEuclidean, wcagContrast } from 'culori';
import Color from 'colorjs.io';

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
{
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(STRINGS.en).sort();
  for (const l of langs) eq(l + ' has the same keys as en', Object.keys(STRINGS[l]).sort(), keys);
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of langs) for (const k of keys) check(l + '.' + k + ' placeholders', ph(STRINGS[l][k]) === ph(STRINGS.en[k]), STRINGS[l][k]);
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
    if (n.hex) {
      const got = sim(n.hex, n.type, n.severity ?? 0.6);
      eq(lang + ' ' + n.hex + ' under ' + n.type, got, n.out);
      check(lang + ' page shows ' + n.out, text.includes(n.out));
    } else if (n.colors) {
      const colors = n.colors.map((h) => ({ rgb: rgbOf(h), hex: h, label: h }));
      const row = E.analyzePalette(colors, n.severity ?? 0.6).find((r) => r.type === n.type);
      const p = n.pair ? row.pairs.find((x) => x.i === n.pair[0] && x.j === n.pair[1]) : row.closest;
      const got = { de: E.fmtDe(p.de), cr: E.fmtCr(p.cr), verdict: p.verdict };
      if (n.pair === undefined) got.pair = [p.i, p.j];
      const exp = { de: n.de, cr: n.cr, verdict: n.verdict };
      if (n.pair === undefined) exp.pair = got.pair && n.closest ? n.closest : got.pair;
      eq(lang + ' palette ' + n.colors.join(',') + ' ' + n.type, got, exp);
      check(lang + ' page shows ΔEOK ' + n.de, text.includes(n.de));
      if (n.cr) check(lang + ' page shows contrast ' + n.cr, text.includes(n.cr));
      if (n.sims) for (const [h, s] of Object.entries(n.sims)) {
        eq(lang + ' ' + h + ' under ' + n.type, sim(h, n.type, n.severity ?? 0.6), s);
        check(lang + ' page shows ' + s, text.includes(s));
      }
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
