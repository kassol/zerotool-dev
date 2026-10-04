// Color Shades Generator — engine, export, page-example and DOM regression test
//
// Read:  src/components/tools/ColorShadesGeneratorTool.astro (the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter STRINGS table, so this
//        test cannot drift from the shipped source), node_modules/tailwindcss/theme.css
//        (Tailwind CSS v4 default palette, the source of the reference curves),
//        src/content/tools/color-shades-generator/{en,zh,ja,ko}.mdx (examples marked with
//        `{/* csg: {...} */}` are regenerated and compared), src/layouts/ToolLayout.astro
//        (the real page-wide keyboard shortcuts).
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: reference curves equal to the medians / per-palette values recomputed from Tailwind's
// theme.css; sRGB → OKLab against an independent implementation of the CSS Color 4 sample code
// (sRGB → XYZ → LMS → OKLab); 8-bit round trips (OKLCH and every value format read back through
// parseColor); parseColor accept / reject table; generateScale invariants over seeded random
// colors (base color unchanged at its step, OKLCH lightness and WCAG luminance strictly
// decreasing, one hue across the scale unless a hue shift is set, chroma reduction keeps
// lightness and hue, locked positions and collapsed steps, grays stay gray); Tailwind fidelity
// (each v4 palette's 500 reproduces that palette's lightness ladder); exports parsed by real
// tools (postcss for CSS, tailwindcss v4 `compile()` for @theme, a vm sandbox for the v3
// config, Dart Sass for SCSS, JSON.parse), every value read back to the same 8-bit color;
// WCAG contrast and label colors (the 2026-09-27 fix); 4-language STRINGS; page examples.
// DOM events: valid → invalid / empty → valid, all copy/download exits, format changes
// while invalid, and the page-wide Ctrl/Cmd+L shortcut with the component's deferred update.
//
// Run: node scripts/test-color-shades-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import postcss from 'postcss';
import { compile as twCompile } from 'tailwindcss';
import * as sass from 'sass';

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
const EXPORTS = ['relativeLuminance', 'contrastRatio', 'textColor', 'labelBackground', 'DARK_TEXT', 'LIGHT_TEXT',
  'STEPS', 'TW_CHROMATIC', 'LADDER_NEUTRAL', 'PROFILE_NEUTRAL', 'rgbToOklch', 'oklchToRgb8', 'oklchInGamut',
  'rgbToHex', 'formatColor', 'parseColor', 'generateScale', 'sanitizeName', 'buildExport', 'exportFileName',
  'EXPORT_FORMATS', 'contrastInfo'];
let E;
try {
  E = new Function(block + '\nreturn {' + EXPORTS.map((k) => k + ': typeof ' + k + ' === "undefined" ? undefined : ' + k).join(', ') + '};')();
} catch (err) {
  console.error('FAIL: engine block does not evaluate — ' + err.message);
  process.exit(1);
}

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = stringsStart >= 0 && stringsEnd > stringsStart
  ? new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')()
  : null;

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function near(name, actual, expected, eps) {
  check(name, Math.abs(actual - expected) <= eps, 'got ' + actual + ', expected ' + expected + ' ± ' + eps);
}
function hasEngine(...names) {
  const missing = names.filter((n) => typeof E[n] === 'undefined');
  check('engine exports ' + names.join(', '), missing.length === 0, 'missing ' + missing.join(', '));
  return missing.length === 0;
}

// Seeded PRNG (mulberry32) so failures are reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomRgb(rand) { return [0, 1, 2].map(() => Math.floor(rand() * 256)); }
function hexRgb(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
function lumHex(hex) { return E.relativeLuminance(...hexRgb(hex)); }
function ratioHex(a, b) { return E.contrastRatio(lumHex(a), lumHex(b)); }
function parseRgba(css) {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css.replace(/\s+/g, ''));
  return m ? { rgb: [+m[1], +m[2], +m[3]], a: +m[4] } : null;
}
// Browsers composite translucent backgrounds per channel in sRGB space.
function composite(rgba, bg) {
  return bg.map((c, i) => Math.round(rgba.a * rgba.rgb[i] + (1 - rgba.a) * c));
}

// Independent sRGB → OKLab: CSS Color 4 §19 sample code (sRGB → XYZ D65 → LMS → OKLab).
function refOklch(rgb) {
  const lin = rgb.map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const XYZ = mul([
    [506752 / 1228815, 87881 / 245763, 12673 / 70218],
    [87098 / 409605, 175762 / 245763, 12673 / 175545],
    [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
  ], lin);
  const LMS = mul([
    [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
    [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
    [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
  ], XYZ).map(Math.cbrt);
  const [L, a, b] = mul([
    [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
    [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
    [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
  ], LMS);
  let h = Math.atan2(b, a) * 180 / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(a, b), h, a, b };
}
// Distance in the a/b plane between two hues at a given chroma (chord length).
function hueChord(c, h1, h2) {
  const d = (h1 - h2) * Math.PI / 180;
  return 2 * c * Math.abs(Math.sin(d / 2));
}

// ---------- 1. WCAG contrast (kept from the 2026-09-27 fix) ----------
near('luminance black', E.relativeLuminance(0, 0, 0), 0, 1e-12);
near('luminance white', E.relativeLuminance(255, 255, 255), 1, 1e-12);
near('luminance pure red', E.relativeLuminance(255, 0, 0), 0.2126, 1e-12);
near('luminance pure green', E.relativeLuminance(0, 255, 0), 0.7152, 1e-12);
near('luminance pure blue', E.relativeLuminance(0, 0, 255), 0.0722, 1e-12);
near('luminance #808080', lumHex('#808080'), 0.2158605, 1e-6);
near('contrast black/white = 21', ratioHex('#000000', '#ffffff'), 21, 1e-9);
near('contrast same color = 1', ratioHex('#3b82f6', '#3b82f6'), 1, 1e-12);
equal('contrast is symmetric', ratioHex('#3b82f6', '#000000'), ratioHex('#000000', '#3b82f6'));
near('contrast #767676 on white ≈ 4.54', ratioHex('#767676', '#ffffff'), 4.54, 0.01);
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

// contrastInfo: values floored to 2 decimals, grades by WCAG 2.2 thresholds (1.4.3 / 1.4.6).
if (hasEngine('contrastInfo')) {
  const ci = (hex) => E.contrastInfo(hexRgb(hex));
  equal('contrastInfo #767676 white', [ci('#767676').white, ci('#767676').whiteGrade], [4.54, 'AA']);
  equal('contrastInfo #777777 white (4.47, large text only)', [ci('#777777').white, ci('#777777').whiteGrade], [4.47, 'AA18']);
  equal('contrastInfo #ffffff black = 21 AAA', [ci('#ffffff').black, ci('#ffffff').blackGrade], [21, 'AAA']);
  equal('contrastInfo #ffffff white = 1 fail', [ci('#ffffff').white, ci('#ffffff').whiteGrade], [1, 'fail']);
  // #959595 on white is 2.997…: shown as 2.99, below the 3:1 large-text line.
  equal('contrastInfo floors instead of rounding up', [ci('#959595').white, ci('#959595').whiteGrade], [2.99, 'fail']);
  equal('contrastInfo 7:1 is AAA', ci('#595959').whiteGrade, 'AAA');
}

// ---------- 2. Reference curves = Tailwind v4 theme.css ----------
const STEP_NAMES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const themeCss = readFileSync(join(root, 'node_modules/tailwindcss/theme.css'), 'utf8');
const TW = {};
{
  const re = /--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\)/g;
  let m;
  while ((m = re.exec(themeCss))) (TW[m[1]] ??= {})[m[2]] = [+m[3] / 100, +m[4], m[5] === 'none' ? 0 : +m[5]];
}
const twNames = Object.keys(TW);
const chromaticNames = twNames.filter((k) => Math.max(...STEP_NAMES.map((s) => TW[k][s][1])) > 0.08);
const neutralNames = twNames.filter((k) => !chromaticNames.includes(k));
const r3 = (x) => +x.toFixed(3);
const median = (a) => { a = [...a].sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const peak = (k) => Math.max(...STEP_NAMES.map((s) => TW[k][s][1]));
equal('theme.css: every palette has 11 steps', twNames.filter((k) => Object.keys(TW[k]).length !== 11), []);
equal('theme.css: 17 chromatic palettes', chromaticNames.length, 17);
equal('theme.css: 9 neutral palettes', neutralNames.sort(), ['gray', 'mauve', 'mist', 'neutral', 'olive', 'slate', 'stone', 'taupe', 'zinc']);
if (hasEngine('STEPS', 'TW_CHROMATIC', 'LADDER_NEUTRAL', 'PROFILE_NEUTRAL')) {
  equal('STEPS are Tailwind steps', E.STEPS, STEP_NAMES.map(Number));
  const expectedRows = chromaticNames
    .map((k) => [r3(TW[k]['500'][2]), STEP_NAMES.map((s) => r3(TW[k][s][0])), STEP_NAMES.map((s) => r3(TW[k][s][1] / peak(k)))])
    .sort((a, b) => a[0] - b[0]);
  equal('TW_CHROMATIC = theme.css palettes (500 hue, lightness, chroma / peak)', E.TW_CHROMATIC, expectedRows);
  equal('LADDER_NEUTRAL = median lightness of the neutral palettes',
    E.LADDER_NEUTRAL, STEP_NAMES.map((s) => r3(median(neutralNames.map((k) => TW[k][s][0])))));
  const tinted = neutralNames.filter((k) => peak(k) > 0);
  equal('PROFILE_NEUTRAL = median chroma profile of the tinted neutral palettes',
    E.PROFILE_NEUTRAL, STEP_NAMES.map((s) => r3(median(tinted.map((k) => TW[k][s][1] / peak(k))))));
  check('neutral palettes peak at chroma <= 0.05 and chromatic ones >= 0.15 (blend thresholds)',
    Math.max(...neutralNames.map(peak)) <= 0.05 && Math.min(...chromaticNames.map(peak)) >= 0.15,
    'neutral max ' + Math.max(...neutralNames.map(peak)) + ', chromatic min ' + Math.min(...chromaticNames.map(peak)));
}

// ---------- 3. Color conversion ----------
if (hasEngine('rgbToOklch', 'oklchToRgb8', 'rgbToHex', 'formatColor', 'parseColor')) {
  // Published value: sRGB red is oklab(0.627955 0.224863 0.125846) (Ottosson, "A perceptual color space").
  const red = E.rgbToOklch([255, 0, 0]);
  near('red L', red.l, 0.627955, 2e-4);
  near('red C', red.c, Math.hypot(0.224863, 0.125846), 2e-4);
  near('white L = 1', E.rgbToOklch([255, 255, 255]).l, 1, 1e-6);
  equal('white is achromatic (c = 0)', E.rgbToOklch([255, 255, 255]).c, 0);
  equal('gray #777777 is achromatic', E.rgbToOklch([119, 119, 119]).c, 0);

  const rand = rng(1);
  let worstL = 0, worstAB = 0, roundTripFail = 0, firstRT = '';
  for (let i = 0; i < 20000; i++) {
    const rgb = randomRgb(rand);
    const o = E.rgbToOklch(rgb), ref = refOklch(rgb);
    worstL = Math.max(worstL, Math.abs(o.l - ref.l));
    const a = o.c * Math.cos(o.h * Math.PI / 180), b = o.c * Math.sin(o.h * Math.PI / 180);
    worstAB = Math.max(worstAB, Math.hypot(a - ref.a, b - ref.b));
    const back = E.oklchToRgb8(o.l, o.c, o.h);
    if (back.join() !== rgb.join()) { roundTripFail++; firstRT = firstRT || rgb.join() + ' → ' + back.join(); }
  }
  check('sRGB → OKLab matches CSS Color 4 reference (L, 20000 colors)', worstL < 2e-4, worstL);
  check('sRGB → OKLab matches CSS Color 4 reference (a/b, 20000 colors)', worstAB < 2e-4, worstAB);
  equal('rgb → oklch → rgb8 round trip (20000 colors)', roundTripFail, 0);
  if (roundTripFail) console.log('      first: ' + firstRT);

  for (const fmt of ['hex', 'oklch', 'rgb', 'hsl']) {
    let fail = 0, first = '';
    const rnd = rng(7);
    const samples = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [128, 128, 128]];
    for (let i = 0; i < 20000; i++) samples.push(randomRgb(rnd));
    for (const rgb of samples) {
      const text = E.formatColor(rgb, fmt);
      const p = E.parseColor(text);
      if (!p.ok || p.rgb.join() !== rgb.join() || p.note) { fail++; first = first || text + ' → ' + JSON.stringify(p); }
    }
    equal('formatColor(' + fmt + ') reads back to the same 8-bit color with no note (20007 colors)', fail, 0);
    if (fail) console.log('      first: ' + first);
  }
  equal('formatColor hex', E.formatColor([59, 130, 246], 'hex'), '#3b82f6');
  equal('formatColor rgb', E.formatColor([59, 130, 246], 'rgb'), 'rgb(59 130 246)');
  equal('formatColor oklch', E.formatColor([59, 130, 246], 'oklch'), 'oklch(62.31% 0.18801 259.81)');
  equal('formatColor hsl', E.formatColor([59, 130, 246], 'hsl'), 'hsl(217.22 91.22% 59.8%)');
  equal('formatColor oklch of gray has hue 0', E.formatColor([128, 128, 128], 'oklch'), 'oklch(59.99% 0 0)');
  check('out-of-gamut oklch(70% 0.4 145) is detected', !E.oklchInGamut(0.7, 0.4, 145));
  {
    const rgb = E.oklchToRgb8(0.7, 0.4, 145), o = E.rgbToOklch(rgb);
    near('chroma reduction keeps lightness', o.l, 0.7, 0.004);
    check('chroma reduction keeps hue', hueChord(o.c, o.h, 145) < 0.004, o.h);
    check('chroma reduction lands on the sRGB edge', rgb.some((v) => v === 0 || v === 255), rgb.join());
  }
}

// ---------- 4. parseColor ----------
if (hasEngine('parseColor')) {
  const ok = (input, rgb, note = null) => {
    const p = E.parseColor(input);
    equal('parse ' + JSON.stringify(input), p.ok ? { rgb: p.rgb, note: p.note || null } : p, { rgb, note });
  };
  const bad = (input, code) => {
    const p = E.parseColor(input);
    equal('reject ' + JSON.stringify(input), p.ok ? p : p.code, code);
  };
  ok('#3b82f6', [59, 130, 246]);
  ok('  #3B82F6 ', [59, 130, 246]);
  ok('3b82f6', [59, 130, 246]);
  ok('#39f', [51, 153, 255]);
  ok('#39f8', [51, 153, 255], 'alpha');
  ok('#3b82f6ff', [59, 130, 246]);
  ok('＃３ｂ８２ｆ６', [59, 130, 246]); // full-width input from a CJK IME
  ok('ｒｇｂ（５９　１３０　２４６）', [59, 130, 246]);
  ok('#3b82f680', [59, 130, 246], 'alpha');
  ok('rgb(59, 130, 246)', [59, 130, 246]);
  ok('rgb(59 130 246)', [59, 130, 246]);
  ok('RGB(59 130 246)', [59, 130, 246]);
  ok('rgba(59, 130, 246, 0.5)', [59, 130, 246], 'alpha');
  ok('rgb(59 130 246 / 50%)', [59, 130, 246], 'alpha');
  ok('rgb(59 130 246 / 1)', [59, 130, 246]);
  ok('rgb(100%, 0%, 0%)', [255, 0, 0]);
  ok('rgb(300 -5 128)', [255, 0, 128]);
  ok('hsl(217, 91%, 60%)', [60, 131, 246]);
  ok('hsl(217 91% 60%)', [60, 131, 246]);
  ok('hsl(217deg 91% 60%)', [60, 131, 246]);
  ok('hsl(0.6028turn 91% 60%)', [60, 131, 246]);
  ok('hsla(217, 91%, 60%, 0.3)', [60, 131, 246], 'alpha');
  ok('hsl(217.22 91.22% 59.8%)', [59, 130, 246]);
  ok('hsl(-143 91% 60%)', [60, 131, 246]);
  ok('oklch(62.31% 0.188 259.81)', [59, 130, 246]);
  ok('oklch(0.6231 0.188 259.81)', [59, 130, 246]);
  ok('oklch(62.31% 47% 259.81deg)', [59, 130, 246]);
  ok('oklch(100% 0 none)', [255, 255, 255]);
  {
    const p = E.parseColor('oklch(62.3% 0.214 259.815)'); // Tailwind v4 blue-500, outside sRGB
    equal('parse Tailwind v4 blue-500 notes gamut mapping', p.ok && p.note, 'gamut');
    const o = p.ok ? E.rgbToOklch(p.rgb) : { l: 0, h: 0, c: 0 };
    near('gamut-mapped blue-500 keeps lightness', o.l, 0.623, 0.004);
    check('gamut-mapped blue-500 keeps hue', hueChord(o.c, o.h, 259.815) < 0.004, o.h);
  }
  bad('', 'empty');
  bad('   ', 'empty');
  bad('#12345', 'hexLength');
  bad('#1234567', 'hexLength');
  bad('#12345g', 'hexChars');
  bad('#xyz', 'hexChars');
  bad('blue', 'format');
  bad('color(display-p3 1 0 0)', 'format');
  bad('rgb(59 130)', 'syntax');
  bad('rgb(59, 130 246)', 'syntax');
  bad('rgb(59, 50%, 246)', 'syntax');
  bad('rgb(59 130 246 / )', 'syntax');
  bad('hsl(217, 91, 60)', 'syntax');
  bad('oklch(62%, 0.19, 260)', 'syntax');
  bad('rgb(a b c)', 'syntax');
}

// ---------- 5. generateScale ----------
if (hasEngine('generateScale', 'rgbToOklch', 'relativeLuminance')) {
  const gen = (hex, opts) => E.generateScale(hexRgb(hex), opts);
  const hexes = (s) => s.steps.map((x) => x.hex);

  // Worked examples (values shown on the tool page; any change must be deliberate).
  equal('#3b82f6 → scale', hexes(gen('#3b82f6')),
    ['#f0f5fe', '#dee9fc', '#c4d9fb', '#9ec2fd', '#69a0fa', '#3b82f6', '#0866ea', '#0056cd', '#0046a9', '#123e85', '#0f2850']);
  equal('#3b82f6 sits at 500 (Tailwind v4 blue-500 has the same lightness)', gen('#3b82f6').anchorStep, 500);
  equal('#facc15 sits at 400', gen('#facc15').anchorStep, 400);
  equal('#16a34a sits at 600', gen('#16a34a').anchorStep, 600);
  equal('#ffffff sits at 50', gen('#ffffff').anchorStep, 50);
  equal('#000000 sits at 950', gen('#000000').anchorStep, 950);
  equal('#808080 → neutral gray scale', hexes(gen('#808080')),
    ['#fafafa', '#f5f5f5', '#e8e8e8', '#d8d8d8', '#aaaaaa', '#808080', '#5d5d5d', '#474747', '#2b2b2b', '#1a1a1a', '#0a0a0a']);

  const rand = rng(42);
  const stats = { anchorExact: 0, lMono: 0, yMono: 0, hue: 0, range: 0, collapsed: 0, gamutKeep: 0, mappedFlag: 0, gray: 0 };
  const first = {};
  const flag = (key, msg) => { stats[key]++; first[key] = first[key] || msg; };
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const rgb = randomRgb(rand);
    const s = E.generateScale(rgb);
    const tag = rgb.join(',');
    if (s.steps.length !== 11) { flag('range', tag + ' has ' + s.steps.length + ' steps'); continue; }
    const base = s.steps[s.anchorIndex];
    if (base.rgb.join() !== rgb.join() || !base.base || s.steps.filter((x) => x.base).length !== 1) flag('anchorExact', tag);
    const ok = s.steps.map((x) => E.rgbToOklch(x.rgb));
    const ys = s.steps.map((x) => E.relativeLuminance(...x.rgb));
    for (let j = 1; j < 11; j++) {
      if (!(ok[j].l < ok[j - 1].l)) flag('lMono', tag + ' step ' + s.steps[j].step);
      if (!(ys[j] < ys[j - 1])) flag('yMono', tag + ' step ' + s.steps[j].step);
    }
    for (const x of s.steps) {
      if (!x.rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) || x.hex !== E.rgbToHex(x.rgb)) flag('range', tag);
    }
    if (s.collapsed.length) flag('collapsed', tag + ' ' + s.collapsed);
    const b0 = E.rgbToOklch(rgb);
    s.steps.forEach((x, j) => {
      const o = ok[j];
      if (b0.c === 0) {
        if (!(x.rgb[0] === x.rgb[1] && x.rgb[1] === x.rgb[2])) flag('gray', tag + ' step ' + x.step + ' ' + x.hex);
        return;
      }
      // One hue across the scale: 8-bit rounding moves a color by at most ~0.002 in a/b.
      if (hueChord(Math.min(o.c, x.target.c), o.h, b0.h) > 0.004 && o.c > 0.004) flag('hue', tag + ' step ' + x.step + ' h ' + o.h.toFixed(1) + ' vs ' + b0.h.toFixed(1));
      if (!x.base && x.mapped) {
        if (Math.abs(o.l - x.target.l) > 0.004) flag('gamutKeep', tag + ' step ' + x.step + ' L ' + o.l.toFixed(4) + ' target ' + x.target.l.toFixed(4));
      }
      if (!x.base && x.mapped !== !E.oklchInGamut(x.target.l, x.target.c, x.target.h)) flag('mappedFlag', tag + ' step ' + x.step);
    });
  }
  equal('random: base color unchanged at its step (' + N + ' colors)', stats.anchorExact, 0);
  equal('random: OKLCH lightness strictly decreases from 50 to 950', stats.lMono, 0);
  equal('random: WCAG relative luminance strictly decreases from 50 to 950', stats.yMono, 0);
  equal('random: one hue across the scale (no hue shift set)', stats.hue, 0);
  equal('random: 11 valid 8-bit colors per scale', stats.range, 0);
  equal('random: Auto never produces two identical neighbouring steps', stats.collapsed, 0);
  equal('random: chroma reduction keeps lightness', stats.gamutKeep, 0);
  equal('random: mapped flag = target outside sRGB', stats.mappedFlag, 0);
  equal('random: gray input gives gray steps', stats.gray, 0);
  for (const k of Object.keys(first)) console.log('      first ' + k + ': ' + first[k]);

  // Hue shift: hue at 50 and 950 moves by the given degrees, linear in between, base unchanged.
  {
    let fail = 0, firstFail = '';
    const r2 = rng(9);
    for (let i = 0; i < 500; i++) {
      const rgb = randomRgb(r2);
      const b0 = E.rgbToOklch(rgb);
      if (b0.c < 0.06) continue;
      const s = E.generateScale(rgb, { hueShiftLight: 20, hueShiftDark: -35 });
      const k = s.anchorIndex;
      s.steps.forEach((x, j) => {
        if (j === k) return;
        const want = j < k ? b0.h + 20 * (k - j) / k : b0.h - 35 * (j - k) / (10 - k);
        const o = E.rgbToOklch(x.rgb);
        if (o.c > 0.02 && hueChord(Math.min(o.c, x.target.c), o.h, want) > 0.004) { fail++; firstFail = firstFail || rgb.join() + ' step ' + x.step + ' h ' + o.h.toFixed(1) + ' want ' + want.toFixed(1); }
      });
      if (s.steps[k].rgb.join() !== rgb.join()) { fail++; firstFail = firstFail || rgb.join() + ' base changed'; }
    }
    equal('hue shift: 50 → +20°, 950 → −35°, linear from the base step', fail, 0);
    if (fail) console.log('      first: ' + firstFail);
    const y = gen('#facc15', { hueShiftDark: -35 });
    near('#facc15 with −35° at 950: hue of 950', E.rgbToOklch(y.steps[10].rgb).h, E.rgbToOklch(hexRgb('#facc15')).h - 35, 1.5);
    equal('hue shift 0 is the same as no option', hexes(gen('#facc15', { hueShiftLight: 0, hueShiftDark: 0 })), hexes(gen('#facc15')));
  }

  // Locked positions.
  {
    let fail = 0, firstFail = '';
    const r3 = rng(11);
    for (let i = 0; i < 300; i++) {
      const rgb = randomRgb(r3);
      for (const step of E.STEPS) {
        const s = E.generateScale(rgb, { anchor: step });
        const ok = s.steps.map((x) => E.rgbToOklch(x.rgb).l);
        const dups = [];
        for (let j = 1; j < 11; j++) if (s.steps[j].hex === s.steps[j - 1].hex) dups.push(s.steps[j].step);
        const bad = s.anchorStep !== step || s.auto || s.steps[s.anchorIndex].rgb.join() !== rgb.join()
          || ok.some((l, j) => j > 0 && l > ok[j - 1] + 1e-9) || JSON.stringify(dups) !== JSON.stringify(s.collapsed);
        if (bad) { fail++; firstFail = firstFail || rgb.join() + ' @' + step; }
      }
    }
    equal('locked: base at the chosen step, lightness non-increasing, collapsed = identical neighbours (300 colors × 11)', fail, 0);
    if (fail) console.log('      first: ' + firstFail);
    const w = gen('#ffffff', { anchor: 500 });
    equal('white locked at 500: 100–500 collapse to white', w.collapsed, [100, 200, 300, 400, 500]);
    equal('anchor "auto" = no option', hexes(gen('#e4007f', { anchor: 'auto' })), hexes(gen('#e4007f')));
    equal('unknown anchor value falls back to Auto', gen('#e4007f', { anchor: '550' }).auto, true);
  }

  // Tailwind fidelity: a palette's own 500 (in sRGB) reproduces its lightness ladder.
  {
    let worst = 0, worstWhere = '', anchorOff = [];
    for (const k of twNames) {
      const [l, c, h] = TW[k]['500'];
      const rgb = E.oklchToRgb8(l, c, h);
      const s = E.generateScale(rgb);
      if (s.anchorStep !== 500) anchorOff.push(k + '→' + s.anchorStep);
      s.steps.forEach((x, j) => {
        const d = Math.abs(E.rgbToOklch(x.rgb).l - TW[k][STEP_NAMES[j]][0]);
        if (d > worst) { worst = d; worstWhere = k + '-' + x.step; }
      });
    }
    equal('Tailwind fidelity: every v4 palette\'s 500 sits at 500', anchorOff, []);
    const weightOff = twNames.filter((k) => {
      const [l, c, h] = TW[k]['500'];
      const w = E.generateScale(E.oklchToRgb8(l, c, h)).weight;
      return chromaticNames.includes(k) ? w !== 1 : w !== 0;
    });
    equal('Tailwind fidelity: neutral palettes use the neutral curves, chromatic ones the hue curves', weightOff, []);
    // Neutral palettes use the median neutral ladder, so their own ladders differ by up to ~0.02.
    check('Tailwind fidelity: lightness per step within 0.025 of the palette (' + twNames.length + ' palettes)', worst <= 0.025, worst.toFixed(4) + ' at ' + worstWhere);
    let chromWorst = 0, chromWhere = '';
    for (const k of chromaticNames) {
      const [l, c, h] = TW[k]['500'];
      const s = E.generateScale(E.oklchToRgb8(l, c, h));
      s.steps.forEach((x, j) => {
        const d = Math.abs(E.rgbToOklch(x.rgb).l - TW[k][STEP_NAMES[j]][0]);
        if (d > chromWorst) { chromWorst = d; chromWhere = k + '-' + x.step; }
      });
    }
    check('Tailwind fidelity: chromatic palettes within 0.006 lightness per step', chromWorst <= 0.006, chromWorst.toFixed(4) + ' at ' + chromWhere);
  }
}

// ---------- 6. Exports ----------
if (hasEngine('buildExport', 'sanitizeName', 'exportFileName', 'EXPORT_FORMATS')) {
  equal('export formats', E.EXPORT_FORMATS, ['css', 'tw4', 'tw3', 'scss', 'json']);
  equal('sanitizeName brand', E.sanitizeName('brand'), 'brand');
  equal('sanitizeName "Brand Blue"', E.sanitizeName('Brand Blue'), 'brand-blue');
  equal('sanitizeName "  --primary__color--  "', E.sanitizeName('  --primary__color--  '), 'primary-color');
  equal('sanitizeName CJK only → brand', E.sanitizeName('主色'), 'brand');
  equal('sanitizeName empty → brand', E.sanitizeName(''), 'brand');
  equal('sanitizeName leading digit gets c-', E.sanitizeName('2025 Primary'), 'c-2025-primary');
  equal('file names', E.EXPORT_FORMATS.map((f) => E.exportFileName('Brand Blue', f)),
    ['brand-blue.css', 'brand-blue-theme.css', 'tailwind.config.js', '_brand-blue.scss', 'brand-blue.json']);

  const cases = [['#3b82f6', 'brand'], ['#facc15', 'accent-yellow'], ['#808080', 'gray'], ['#e4007f', 'pink']];
  const steps = E.STEPS;
  for (const [hex, name] of cases) {
    const scale = E.generateScale(hexRgb(hex));
    for (const vf of ['hex', 'oklch', 'rgb', 'hsl']) {
      const want = scale.steps.map((x) => x.rgb.join());
      const tag = hex + ' ' + vf;
      const readBack = (vals) => vals.map((v) => { const p = E.parseColor(String(v).trim()); return p.ok ? p.rgb.join() : 'unparsed:' + v; });

      // CSS variables: postcss parses it; :root has exactly the 11 custom properties.
      const css = E.buildExport(scale, name, 'css', vf);
      const rootNode = postcss.parse(css);
      const decls = [];
      rootNode.walkDecls((d) => decls.push(d));
      equal('css ' + tag + ': one :root rule', rootNode.nodes.filter((n) => n.type === 'rule').map((n) => n.selector), [':root']);
      equal('css ' + tag + ': property names', decls.map((d) => d.prop), steps.map((s) => '--' + name + '-' + s));
      equal('css ' + tag + ': values read back', readBack(decls.map((d) => d.value)), want);

      // Tailwind v4: compile() generates the theme variables and utilities for every step.
      const tw4 = E.buildExport(scale, name, 'tw4', vf);
      const compiled = (await twCompile(tw4 + '\n@tailwind utilities;\n', { base: root }))
        .build(steps.map((s) => 'bg-' + name + '-' + s));
      const vars = {};
      postcss.parse(compiled).walkDecls((d) => { if (d.prop.startsWith('--color-')) vars[d.prop] = d.value; });
      equal('tw4 ' + tag + ': theme variables emitted', Object.keys(vars), steps.map((s) => '--color-' + name + '-' + s));
      equal('tw4 ' + tag + ': values read back', readBack(Object.values(vars)), want);
      const utils = steps.filter((s) => compiled.includes('.bg-' + name + '-' + s + ' {\n  background-color: var(--color-' + name + '-' + s + ');'));
      equal('tw4 ' + tag + ': bg-* utility for every step', utils, steps);

      // Tailwind v3 config: runs as CommonJS; theme.extend.colors[name] has the 11 steps.
      const tw3 = E.buildExport(scale, name, 'tw3', vf);
      const mod = { exports: {} };
      vm.runInNewContext(tw3, { module: mod, exports: mod.exports });
      const palette = mod.exports?.theme?.extend?.colors?.[name] || {};
      equal('tw3 ' + tag + ': keys', Object.keys(palette), steps.map(String));
      equal('tw3 ' + tag + ': values read back', readBack(Object.values(palette)), want);

      // SCSS: Dart Sass compiles it; each variable and map.get($name, step) resolves to the color.
      const scss = E.buildExport(scale, name, 'scss', vf);
      const probe = '@use "sass:map";\n' + scss + '\n.probe {\n' +
        steps.map((s) => '  v' + s + ': $' + name + '-' + s + ';\n  m' + s + ': map.get($' + name + ', ' + s + ');').join('\n') + '\n}\n';
      let out = '';
      try { out = sass.compileString(probe).css; } catch (err) { out = 'ERROR ' + err.message; }
      const sv = {};
      postcss.parse(out.startsWith('ERROR') ? '' : out).walkDecls((d) => { sv[d.prop] = d.value; });
      check('scss ' + tag + ': compiles', !out.startsWith('ERROR'), out.slice(0, 200));
      equal('scss ' + tag + ': variables read back', readBack(steps.map((s) => sv['v' + s])), want);
      equal('scss ' + tag + ': map.get read back', readBack(steps.map((s) => sv['m' + s])), want);

      // JSON.
      const json = JSON.parse(E.buildExport(scale, name, 'json', vf));
      equal('json ' + tag + ': shape', Object.keys(json), [name]);
      equal('json ' + tag + ': keys', Object.keys(json[name]), steps.map(String));
      equal('json ' + tag + ': values read back', readBack(Object.values(json[name])), want);
    }
  }
  // Every export names the base step so a reader can find the input color again.
  const s = E.generateScale(hexRgb('#3b82f6'));
  for (const f of ['css', 'tw4', 'tw3', 'scss']) {
    check('export ' + f + ' names the base step', E.buildExport(s, 'brand', f, 'hex').includes('base: brand-500'));
  }
  equal('export uses the sanitized name', E.buildExport(s, 'Brand Blue', 'css', 'hex').split('\n')[2], '  --brand-blue-50: #f0f5fe;');
}

// ---------- 7. STRINGS ----------
{
  check('STRINGS table found', STRINGS && STRINGS.en && STRINGS.zh && STRINGS.ja && STRINGS.ko);
  if (STRINGS) {
    const keys = (o, p = '') => Object.keys(o).flatMap((k) => typeof o[k] === 'object' ? keys(o[k], p + k + '.') : [p + k]).sort();
    const ph = (o) => keys(o).map((k) => k + ':' + (k.split('.').reduce((x, y) => x[y], o).match(/\{\w+\}/g) || []).sort().join(','));
    for (const l of ['zh', 'ja', 'ko']) {
      equal('STRINGS.' + l + ' has the same keys as en', keys(STRINGS[l]), keys(STRINGS.en));
      equal('STRINGS.' + l + ' has the same placeholders as en', ph(STRINGS[l]), ph(STRINGS.en));
    }
    const codes = ['empty', 'hexLength', 'hexChars', 'format', 'syntax'];
    equal('every parse error has a message', codes.filter((c) => !(c in STRINGS.en.err)), []);
    if (E.EXPORT_FORMATS) equal('every export format has a name', E.EXPORT_FORMATS.filter((f) => !(f in STRINGS.en.formats)), []);
  }
  // Privacy: the tool reads and writes nothing outside the page.
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  for (const word of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie', 'ztPersist']) {
    check('component script does not use ' + word, !script.includes(word));
  }
}

// ---------- 8. Tool page examples ----------
// A code block preceded by {/* csg: {"input":"#3b82f6","export":"css","values":"hex","name":"brand"} */}
// must equal buildExport() for that input; {/* csg-scale: {"input":"#e4007f"} */} before a table
// means its HEX column lists the generated scale from 50 to 950.
if (E.buildExport && E.parseColor) {
  let examples = 0;
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/color-shades-generator', lang + '.mdx'), 'utf8');
    const re = /\{\/\* csg: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(mdx))) {
      examples++;
      const spec = JSON.parse(m[1]);
      const p = E.parseColor(spec.input);
      const scale = E.generateScale(p.rgb, { anchor: spec.anchor || 'auto', hueShiftLight: spec.light || 0, hueShiftDark: spec.dark || 0 });
      equal(lang + '.mdx example ' + m[1], m[2], E.buildExport(scale, spec.name || 'brand', spec.export, spec.values || 'hex'));
    }
    const re2 = /\{\/\* csg-scale: (\{.*?\}) \*\/\}\s*\n((?:\|.*\|\n)+)/g;
    while ((m = re2.exec(mdx))) {
      examples++;
      const spec = JSON.parse(m[1]);
      const scale = E.generateScale(E.parseColor(spec.input).rgb, { anchor: spec.anchor || 'auto', hueShiftDark: spec.dark || 0 });
      const rows = m[2].trim().split('\n').slice(2).map((r) => r.split('|').map((c) => c.trim()).filter(Boolean));
      const col = spec.column ?? 1;
      equal(lang + '.mdx table ' + m[1], rows.map((r) => r[col].replace(/`/g, '')), scale.steps.map((x) => x.hex));
    }
    const re3 = /\{\/\* csg-contrast: (\{.*?\}) \*\/\}\s*\n((?:\|.*\|\n)+)/g;
    while ((m = re3.exec(mdx))) {
      examples++;
      const spec = JSON.parse(m[1]);
      const rows = m[2].trim().split('\n').slice(2).map((r) => r.split('|').map((c) => c.trim()).filter(Boolean));
      const scales = spec.inputs.map((hex) => E.generateScale(hexRgb(hex)));
      const got = rows.map((r) => [r[0]].concat(scales.map((s) => {
        const x = s.steps.find((y) => String(y.step) === r[0].replace(/\D/g, ''));
        return E.contrastInfo(x.rgb).white.toFixed(2);
      })));
      equal(lang + '.mdx contrast table ' + m[1], rows.map((r) => [r[0]].concat(r.slice(1, 1 + scales.length).map((c) => c.replace(/[^\d.]/g, '')))), got);
    }
  }
  check('tool pages carry checked examples', examples >= 8, examples);
}

// ---------- 9. Real client script with DOM events ----------
function makePage(lang) {
  const ids = {}, clipboard = [], downloads = [], timers = [];
  const blobs = new Map();
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.value = ''; this.disabled = false;
      this.children = []; this.listeners = {}; this.attributes = {}; this.style = {};
      this.className = ''; this.text = '';
      this.classList = {
        add: (c) => { this.className += ' ' + c; },
        remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x !== c).join(' '); }
      };
    }
    set textContent(text) { this.text = String(text); this.children = []; }
    get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    click() {
      if (this.disabled) return;
      if (this.tagName === 'A') downloads.push({ name: this.download, blob: blobs.get(this.href) });
      this.dispatch('click');
    }
    dispatch(type, extra = {}) {
      const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[type] || []) fn(event);
      return event;
    }
  }
  // Read input defaults from the component; the two mapped selects use their first list item.
  const markup = source.slice(source.indexOf('<div class="csg-wrap">'), source.indexOf('<script'));
  for (const m of markup.matchAll(/<(\w+)\b([^>]*\bid="(csg-[^"]+)"[^>]*)>/g)) {
    const el = ids[m[3]] = new Element(m[1]);
    el.value = m[2].match(/\bvalue="([^"]*)"/)?.[1] || '';
    el.disabled = /\bdisabled\b/.test(m[2]);
  }
  ids['csg-anchor'].value = 'auto';
  ids['csg-format'].value = source.match(/const FORMAT_LIST = \['([^']+)'/)[1];
  ids['csg-values'].value = source.match(/const VALUE_LIST = \['([^']+)'/)[1];
  const widget = {
    contains: (el) => Object.values(ids).includes(el),
    querySelectorAll: () => [ids['csg-input'], ids['csg-name']]
  };
  const document = new Element();
  Object.assign(document, {
    body: new Element('body'), activeElement: ids['csg-input'],
    getElementById: (id) => ids[id], createElement: (tag) => new Element(tag),
    querySelector: (selector) => selector === '.tool-widget' ? widget : null
  });
  const context = vm.createContext({
    document, S: STRINGS[lang], window: { ztPersist: { clear() {} } },
    navigator: { clipboard: { writeText: async (text) => { clipboard.push(text); } } },
    location: { search: '', pathname: '/tools/color-shades-generator/' }, URLSearchParams, Blob,
    URL: { createObjectURL: (blob) => { const url = 'blob:' + blobs.size; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    setTimeout: (fn) => { timers.push(fn); }
  });
  vm.runInContext(source.match(/<script is:inline define:vars=\{\{ S: CLIENT_L \}\}>([\s\S]*?)<\/script>/)[1], context);
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const ux = layout.slice(layout.indexOf('{/* Tool UX enhancements:'));
  vm.runInContext(ux.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], context);
  return {
    ids, clipboard, downloads, document,
    async flush() { await Promise.resolve(); while (timers.length) timers.shift()(); },
    change(id, value, type = 'input') { ids[id].value = value; ids[id].dispatch(type); }
  };
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const page = makePage(lang), el = page.ids;
  async function validOutputs(label, rgb) {
    const scale = E.generateScale(rgb);
    const expected = E.buildExport(scale, E.sanitizeName(el['csg-name'].value), el['csg-format'].value, el['csg-values'].value);
    equal(lang + ' ' + label + ': 11 clickable shades', el['csg-scale'].children.length, 11);
    equal(lang + ' ' + label + ': export text', el['csg-code'].textContent, expected);
    check(lang + ' ' + label + ': exports enabled', !el['csg-copy'].disabled && !el['csg-download'].disabled);
    check(lang + ' ' + label + ': error cleared', !el['csg-input'].attributes['aria-invalid']);
    for (const [i, li] of el['csg-scale'].children.entries()) {
      li.children[0].click();
      equal(lang + ' ' + label + ': shade ' + i + ' copies current value', page.clipboard.at(-1), E.formatColor(scale.steps[i].rgb, el['csg-values'].value));
    }
    el['csg-copy'].click(); el['csg-download'].click();
    await page.flush();
    equal(lang + ' ' + label + ': copy all bytes', page.clipboard.at(-1), expected);
    equal(lang + ' ' + label + ': download bytes', await page.downloads.at(-1).blob.text(), expected);
    equal(lang + ' ' + label + ': filename', page.downloads.at(-1).name, E.exportFileName(el['csg-name'].value, el['csg-format'].value));
  }
  async function invalidOutputs(label) {
    equal(lang + ' ' + label + ': old shades removed', el['csg-scale'].children.length, 0);
    equal(lang + ' ' + label + ': old code removed', el['csg-code'].textContent, '');
    equal(lang + ' ' + label + ': old notes removed', [el['csg-export-note'].textContent, el['csg-scale-note'].textContent], ['', '']);
    check(lang + ' ' + label + ': exports disabled', el['csg-copy'].disabled && el['csg-download'].disabled);
    equal(lang + ' ' + label + ': input marked invalid', el['csg-input'].attributes['aria-invalid'], 'true');
    equal(lang + ' ' + label + ': localized error', el['csg-status'].textContent, STRINGS[lang].err[E.parseColor(el['csg-input'].value).code]);
    const counts = [page.clipboard.length, page.downloads.length];
    for (const li of el['csg-scale'].children) li.children[0].click();
    el['csg-copy'].click(); el['csg-download'].click();
    // Dispatch also tests the handlers' empty-state guards independently of disabled buttons.
    el['csg-copy'].dispatch('click'); el['csg-download'].dispatch('click');
    await page.flush();
    equal(lang + ' ' + label + ': no clipboard or download writes', [page.clipboard.length, page.downloads.length], counts);
  }
  await validOutputs('initial', [59, 130, 246]);
  for (const input of ['#ZZZ', 'rgb(59 130)', '']) {
    page.change('csg-input', input);
    await invalidOutputs(JSON.stringify(input));
    page.change('csg-format', 'tw3', 'change');
    page.change('csg-values', 'oklch', 'change');
    await invalidOutputs(JSON.stringify(input) + ' after format change');
    page.change('csg-input', '#facc15');
    await validOutputs('recovered', [250, 204, 21]);
  }
  for (const modifier of ['ctrlKey', 'metaKey']) {
    const event = page.document.dispatch('keydown', { key: 'l', [modifier]: true });
    await page.flush();
    check(lang + ' ' + modifier + '+L: shortcut consumed', event.defaultPrevented);
    equal(lang + ' ' + modifier + '+L: page cleared text fields', [el['csg-input'].value, el['csg-name'].value], ['', '']);
    await invalidOutputs(modifier + '+L');
    page.change('csg-picker', '#16a34a');
    await validOutputs('picker recovery', [22, 163, 74]);
  }
}

// ---------- v2 page layout ----------
{
  const { default: yaml } = await import('js-yaml');
  const { createRequire } = await import('node:module');
  const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');
  const markup = source.split('---')[2].split('<script')[0];
  check('v2 registered as generate', /'color-shades-generator': 'generate'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('v2 direct root and shared control rail', /^\s*<div class="csg-wrap">/.test(markup) && /class="csg-rail zt-rail"/.test(markup));
  check('v2 preview follows control rail', markup.indexOf('class="csg-rail') < markup.indexOf('class="csg-preview'));
  check('v2 retains immediate input and two export actions', !markup.includes('btn-primary') && ['csg-copy','csg-download','csg-input','csg-picker','csg-anchor'].every(id => markup.includes(`id="${id}"`)));
  check('v2 keeps secondary settings closed initially', [...markup.matchAll(/<details\b([^>]*)>/g)].length === 3 && !/<details\b[^>]*\bopen\b/.test(markup));
  check('v2 tooltips stay in server HTML', /tips: TIPS[\s\S]*\.\.\.CLIENT_L/.test(source) && /define:vars=\{\{ S: CLIENT_L \}\}/.test(source) && !markup.includes('data-i18n'));
  check('v2 eight tips with localized labels', [...markup.matchAll(/<Toggletip /g)].length === 8 && [...markup.matchAll(/<Toggletip ([^>]+)>/g)].every(m => m[1].includes('lang={lang}') && m[1].includes('about={L.')));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, `src/content/tools/color-shades-generator/${lang}.mdx`), 'utf8');
    const meta = yaml.load(mdx.match(/^---\n([\s\S]*?)\n---/)[1]);
    check(lang + ' v2 four usage steps', meta.steps.length === 4 && meta.steps.every(step => typeof step === 'string' && step.length <= 300));
    check(lang + ' v2 usage facts and empty state localized', Object.keys(STRINGS[lang].tips).length === 8 && Object.values(STRINGS[lang].tips).every(tip => tip.length > 10) && !!STRINGS[lang].empty);
    check(lang + ' v2 keeps reference and removes HowTo', !/^## (How to use|使用方法|使い方|사용 방법)$/m.test(mdx) && /^## (Limits|限制|制限|제한 사항)$/m.test(mdx) && meta.faqItems.length >= 4 && /csg:/.test(mdx));
  }
  check('v2 scale and code scroll within bounded regions', /\.csg-scale \{[^}]*min-height: 0;[^}]*overflow: auto;/s.test(source) && /\.csg-code \{[^}]*height: 12rem;[^}]*overflow: auto;/s.test(source));
  check('v2 stack at shared breakpoint and hide empty mobile preview', /@media \(max-width: 860px\)/.test(source) && /\.csg-preview:has\(\.csg-scale:empty\) \{ display: none; \}/.test(source));
  const compiled = await transform(source, { filename: 'ColorShadesGeneratorTool.astro' });
  check('v2 Astro compiles', !compiled.diagnostics.some(d => d.severity === 1));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
