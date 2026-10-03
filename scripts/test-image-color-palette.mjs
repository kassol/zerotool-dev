// Image Color Palette Extractor — histogram, deterministic OKLab k-means, exports, palette files
//
// Read:  src/components/tools/ImageColorPaletteTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers, the STRINGS table between `strings:start` /
//        `strings:end`, the page script), ColorPaletteGeneratorTool.astro and
//        ColorBlindnessSimulatorTool.astro (engine blocks, to compare the copied declarations),
//        ColorShadesGeneratorTool.astro / ColorPaletteGeneratorTool.astro (they read `?color=`),
//        src/data/persistence.ts, public/images/icp-*.{png,jpg} (decoded with sharp), the 4 tool
//        page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
//   1. Declarations copied from ColorPaletteGeneratorTool.astro (sRGB / HSL / OKLab / OKLCH, value
//      formats) and ColorBlindnessSimulatorTool.astro (sampling limit, P3 matrices, out-of-sRGB
//      count) are identical to their source (Function#toString / values).
//   2. Histogram: 5-bit groups, alpha weighting (fully transparent pixels are not counted; before
//      this rewrite, turning off "Skip transparent" counted them as black), majority exact color,
//      first sample position, totals.
//   3. Extraction on real files: the flat banner gives its 3 exact source colors and exact shares,
//      asking for 8 colors reports 3 groups; the transparent logo gives no black; same result on
//      every run and for a shuffled pixel order (the old k-means used Math.random seeds);
//      a 2% accent in a noisy image survives at k = 3; cluster averages equal the weighted OKLab
//      mean (culori); near-identical clusters merge below ΔEOK 0.02; filters and shares.
//   4. Sorting by share, hue and lightness; marker positions; share formatting.
//   5. Value formats read back to the same 8-bit color with culori (3,000 seeded colors).
//   6. Exports: CSS (postcss), Tailwind v4 (`compile()` from tailwindcss), Tailwind v3 (vm), SCSS
//      (Dart Sass), JSON and the value list read back to the palette.
//   7. Palette files: .gpl and .ase read back by ports of GIMP's loaders
//      (app/core/gimppalette-load.c) and by an independent ASE reader written from the format
//      description; colors survive the float32 round trip.
//   8. Links to the shades / palette generators, and both tools read `?color=` with their parser.
//   9. STRINGS: 4 languages with the same keys and placeholders; every key the script uses exists.
//  10. Static: the page script writes no HTML, does not use storage or the network directly, and
//      persistence.ts stores only preferences for this tool.
//  11. Tool pages: every `{/* icp-check: {...} */}` annotation is recomputed from the image in
//      public/images and the expected values appear in the page text.
//
// Run: node scripts/test-image-color-palette.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { compile as twCompile } from 'tailwindcss';
import * as sass from 'sass';
import sharp from 'sharp';
import { converter, formatHex, parse as culoriParse } from 'culori';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(root, p), 'utf8');
const source = read('src/components/tools/ImageColorPaletteTool.astro');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
function engineOf(src, file) {
  const s = src.indexOf(START_MARK), e = src.indexOf(END_MARK);
  if (s < 0 || e <= s) { console.error('FAIL: could not locate the engine block in ' + file); process.exit(1); }
  return src.slice(s, e);
}
const engineSrc = engineOf(source, 'ImageColorPaletteTool.astro');
const NAMES = ['buildHistogram', 'extractPalette', 'kmeans', 'mergeClose', 'sortColors', 'pickRgb', 'pickPos', 'posToXY', 'fmtShare',
  'formatValue', 'exportCode', 'gplFile', 'aseFile', 'paletteName', 'toolLink', 'binKey', 'isNearWhite', 'isNearBlack', 'rgbToOklab',
  'oklabToRgb01', 'toHex', 'fitImageSize', 'countOutOfSrgb', 'SAMPLE_AREA', 'BIN_BITS', 'MIN_COLORS', 'MAX_COLORS', 'MERGE_DE',
  'NEUTRAL_C', 'WHITE_L', 'BLACK_L'];
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
const hexOf = (rgb) => E.toHex(rgb);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
let seed = 20261002;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function gauss() { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

async function decode(file) {
  const { data, info } = await sharp(join(root, 'public/images', file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}
function paletteOf(px, opts) { return E.extractPalette(E.buildHistogram(px), opts); }
function summary(res, pick = 'common', sort = 'share') {
  return E.sortColors(res.colors, sort, pick).map((c) => hexOf(E.pickRgb(c, pick)) + ' ' + E.fmtShare(c.share));
}
function solid(list) {   // [[hex, count, alpha?], ...] → RGBA bytes
  const n = list.reduce((s, x) => s + x[1], 0), px = new Uint8ClampedArray(n * 4);
  let o = 0;
  for (const [hex, count, a = 255] of list) {
    const rgb = rgbOf(hex);
    for (let i = 0; i < count; i++) { px[o++] = rgb[0]; px[o++] = rgb[1]; px[o++] = rgb[2]; px[o++] = a; }
  }
  return px;
}

// ── 1. Copied declarations are identical to their source ──
function engineFns(file, names) {
  const src = engineOf(read(file), file);
  return new Function(src + '\nreturn {' + names.map((n) => n + ': ' + n).join(', ') + '};')();
}
{
  const fnNames = ['clamp', 'mod360', 'toHex', 'rgbToHsl', 'hslToRgbFloat', 'round8', 'toLinear', 'fromLinear', 'rgbToOklab', 'oklabToRgb01',
    'rgbToOklch', 'oklchToLab', 'oklchToRgbFloat', 'deltaEOK', 'num', 'formatValue'];
  const P = engineFns('src/components/tools/ColorPaletteGeneratorTool.astro', fnNames);
  const C = new Function(engineSrc + '\nreturn {' + fnNames.map((n) => n + ': ' + n).join(', ') + '};')();
  for (const n of fnNames) check('copied from color-palette-generator: ' + n, typeof C[n] === 'function' && C[n].toString() === P[n].toString());
  const cbsFns = ['fitImageSize', 'countOutOfSrgb'];
  const cbsVals = ['TO_LINEAR', 'GAMUT_TOLERANCE', 'M_XYZ_LSRGB', 'M_LP3_XYZ', 'M_P3_SRGB'];
  const B = engineFns('src/components/tools/ColorBlindnessSimulatorTool.astro', cbsFns.concat(cbsVals));
  const Z = new Function(engineSrc + '\nreturn {' + cbsFns.concat(cbsVals).map((n) => n + ': ' + n).join(', ') + '};')();
  for (const n of cbsFns) check('copied from color-blindness-simulator: ' + n, Z[n].toString() === B[n].toString());
  for (const n of cbsVals) check('copied from color-blindness-simulator: ' + n, JSON.stringify(Array.from(Z[n].length ? Z[n] : [Z[n]]).flat()) === JSON.stringify(Array.from(B[n].length ? B[n] : [B[n]]).flat()));
}

// ── 2. Histogram ──
{
  eq('BIN_BITS is 5 (MMCQ sigbits)', E.BIN_BITS, 5);
  eq('binKey groups 8 levels per channel', [E.binKey(0, 0, 0), E.binKey(7, 7, 7), E.binKey(8, 0, 0), E.binKey(255, 255, 255)], [0, 0, 1024, 32767]);
  const px = solid([['#1E3A8A', 6], ['#1F3B8B', 2], ['#E11D48', 3, 128], ['#000000', 5, 0]]);
  const h = E.buildHistogram(px);
  eq('pixel counts: 16 pixels, 5 fully transparent', [h.pixels, h.transparent], [16, 5]);
  check('alpha-weighted total: 8 + 3 × 128/255', Math.abs(h.total - (8 + 3 * 128 / 255)) < 1e-12, h.total);
  eq('two groups (navy shades share one group, transparent black is not a group)', h.groups.length, 2);
  const navy = h.groups.find((g) => g.shade[2] > 100);
  eq('majority exact color of the navy group', [hexOf(navy.shade), navy.exact], ['#1E3A8A', true]);
  const noMaj = E.buildHistogram(solid([['#1E3A8A', 2], ['#1F3B8B', 2], ['#203C8C', 2]])).groups[0];
  eq('no majority color: the shade is the rounded mean', [hexOf(noMaj.shade), noMaj.exact], ['#1F3B8B', false]);
  const lateMaj = E.buildHistogram(solid([['#203C8C', 2], ['#1E3A8A', 3]])).groups[0];
  eq('majority found even when it comes last (second pass counts it)', [hexOf(lateMaj.shade), lateMaj.exact], ['#1E3A8A', true]);
  check('group mean is the weighted mean', Math.abs(navy.mean[0] - (6 * 30 + 2 * 31) / 8) < 1e-12, navy.mean);
  eq('middle sample of each group (scan order)', h.groups.map((g) => g.pos).sort((a, b) => a - b), [3, 9]);
  const empty = E.buildHistogram(solid([['#ffffff', 4, 0]]));
  eq('fully transparent image: no groups, total 0', [empty.groups.length, empty.total], [0, 0]);
  const pal = E.extractPalette(empty, { k: 6 });
  eq('fully transparent image: no colors, transparent share 1', [pal.colors.length, pal.transparent], [0, 1]);
}

// ── 3. Extraction ──
const banner = await decode('icp-banner.png');
const logo = await decode('icp-logo-transparent.png');
{
  eq('banner is 400 × 300', [banner.w, banner.h], [400, 300]);
  const r3 = paletteOf(banner.px, { k: 3 });
  eq('banner k = 3: exact source colors and shares', summary(r3), ['#1E3A8A 72.0%', '#F8FAFC 25.0%', '#F97316 3.0%']);
  eq('banner k = 3: averages equal the source colors too (no blended edge pixels)', summary(r3, 'average'), ['#1E3A8A 72.0%', '#F8FAFC 25.0%', '#F97316 3.0%']);
  const r8 = paletteOf(banner.px, { k: 8 });
  eq('banner k = 8: only 3 groups, 3 colors', [r8.groups, r8.colors.length, r8.k], [3, 3, 8]);
  const rw = paletteOf(banner.px, { k: 3, ignoreWhite: true });
  eq('ignore near-white: shares stay of the whole image', summary(rw), ['#1E3A8A 72.0%', '#F97316 3.0%']);
  check('ignore near-white: ignored share 25%', Math.abs(rw.ignored - 0.25) < 1e-12, rw.ignored);
  const runs = Array.from({ length: 5 }, () => JSON.stringify(paletteOf(banner.px, { k: 3 })));
  check('same palette on every run', runs.every((x) => x === runs[0]));

  const lr = paletteOf(logo.px, { k: 4 });
  check('logo: no black from transparent pixels', !summary(lr).some((s) => s.startsWith('#000000')), summary(lr));
  check('logo: transparent share reported (> 60%)', lr.transparent > 0.6, lr.transparent);
  const shares = lr.colors.reduce((s, c) => s + c.share, 0);
  check('logo: shares of visible pixels sum to 1', Math.abs(shares - 1) < 1e-9, shares);
  check('logo: the two fills are found', ['#E11D48', '#FACC15'].every((hx) => summary(lr).some((s) => s.startsWith(hx))), summary(lr));

  // Order independence: shuffle the pixels; shares and averages stay the same.
  const photo = await decode('icp-starry-night.jpg');
  const a = paletteOf(photo.px, { k: 6 });
  const idx = Array.from({ length: photo.w * photo.h }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const sh = new Uint8ClampedArray(photo.px.length);
  idx.forEach((from, to) => { for (let c = 0; c < 4; c++) sh[to * 4 + c] = photo.px[from * 4 + c]; });
  const b = paletteOf(sh, { k: 6 });
  eq('shuffled pixels: same averages and shares', summary(b, 'average'), summary(a, 'average'));
  const again = paletteOf(photo.px, { k: 6 });
  eq('photo: same palette twice (common pick, positions)', again.colors.map((c) => [c.common, c.commonPos]), a.colors.map((c) => [c.common, c.commonPos]));
  for (let k = E.MIN_COLORS; k <= E.MAX_COLORS; k++) {
    const r = paletteOf(photo.px, { k });
    check('photo k = ' + k + ': k colors (minus merges)', r.colors.length === k - r.merged, r.colors.length + ' / merged ' + r.merged);
  }

  // Vivid accents: The Starry Night's yellow gets its own cluster at k = 6 only with vivid on.
  const yellowish = (r) => r.colors.some((c) => { const o = converter('oklch')({ mode: 'rgb', r: c.average[0] / 255, g: c.average[1] / 255, b: c.average[2] / 255 }); return o.c > 0.06 && o.h > 90 && o.h < 125; });
  check('starry night k = 6, vivid on: a yellow cluster', yellowish(paletteOf(photo.px, { k: 6 })));
  check('starry night k = 6, vivid off: no yellow cluster (area only)', !yellowish(paletteOf(photo.px, { k: 6, vivid: false })));
  const dano = await decode('icp-dano-pungjeong.jpg');
  const red = (r) => r.colors.some((c) => c.average[0] > 170 && c.average[1] < 100);
  check('dano k = 8, vivid on: the red skirt is a color', red(paletteOf(dano.px, { k: 8 })));
  check('dano k = 8, vivid off: no red color', !red(paletteOf(dano.px, { k: 8, vivid: false })));

  // Accent: 98% noisy navy + 2% orange; k = 3 keeps the orange.
  const n = 50000, px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const base = i < n * 0.02 ? [249, 115, 22] : [30, 58, 138];
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.max(0, Math.min(255, Math.round(base[c] + gauss() * 10)));
    px[i * 4 + 3] = 255;
  }
  const acc = paletteOf(px, { k: 3 });
  const okl = converter('oklab');
  const orange = acc.colors.find((c) => c.average[0] > 200);
  check('2% accent survives at k = 3', orange && Math.abs(orange.share - 0.02) < 0.003, JSON.stringify(acc.colors.map((c) => [hexOf(c.average), c.share])));

  // Cluster average = weighted mean in OKLab of its groups (checked against culori's conversion).
  const three = E.extractPalette(E.buildHistogram(solid([['#336699', 3], ['#3A6EA0', 1], ['#FFCC00', 4]])), { k: 2 });
  const l1 = okl('#336699'), l2 = okl('#3A6EA0');
  const meanLab = { mode: 'oklab', l: (3 * l1.l + l2.l) / 4, a: (3 * l1.a + l2.a) / 4, b: (3 * l1.b + l2.b) / 4 };
  const blue = three.colors.find((c) => c.common[2] > 100);
  eq('k = 2 over 3 groups: blue cluster average is the OKLab mean (culori)', hexOf(blue.average), formatHex(converter('rgb')(meanLab)).toUpperCase());
  eq('k = 2 over 3 groups: real pixel pick is the heavier group', hexOf(blue.common), '#336699');
  check('k = 2 over 3 groups: blue share 50%', Math.abs(blue.share - 0.5) < 1e-12, blue.share);
  const close = [{ w: 3, members: [0], lab: { l: 0.5, a: 0, b: 0 } }, { w: 1, members: [1], lab: { l: 0.515, a: 0.01, b: 0 } }];
  eq('ΔEOK 0.018 apart: merged', E.mergeClose(close, []), 1);
  check('merged cluster is the weighted mean', Math.abs(close[0].lab.l - (0.5 * 3 + 0.515) / 4) < 1e-12 && close[0].w === 4);
  const far = [{ w: 3, members: [0], lab: { l: 0.5, a: 0, b: 0 } }, { w: 1, members: [1], lab: { l: 0.52, a: 0.01, b: 0 } }];
  eq('ΔEOK 0.022 apart: not merged', E.mergeClose(far, []), 0);
  eq('MERGE_DE is 0.02', E.MERGE_DE, 0.02);

  // Filters (OKLCH thresholds).
  const isW = (h) => E.isNearWhite(E.rgbToOklab(rgbOf(h).map((v) => v / 255)));
  const isB = (h) => E.isNearBlack(E.rgbToOklab(rgbOf(h).map((v) => v / 255)));
  eq('near-white: #FFFFFF #F8FAFC #F5F5F5 #FDF6E3 yes; #E5E7EB #FEF3C7 no', ['#FFFFFF', '#F8FAFC', '#F5F5F5', '#FDF6E3', '#E5E7EB', '#FEF3C7'].map(isW), [true, true, true, true, false, false]);
  eq('near-black: #000000 #0A0A0A #171717 #111827 yes; #1F2937 #1E3A8A no', ['#000000', '#0A0A0A', '#171717', '#111827', '#1F2937', '#1E3A8A'].map(isB), [true, true, true, true, false, false]);
  const allIgnored = paletteOf(solid([['#FFFFFF', 10]]), { k: 3, ignoreWhite: true });
  eq('everything ignored: no colors, ignored share 1', [allIgnored.colors.length, allIgnored.ignored], [0, 1]);
  eq('k is clamped to 2–16', [paletteOf(banner.px, { k: 1 }).k, paletteOf(banner.px, { k: 99 }).k, paletteOf(banner.px, { k: 'x' }).k], [2, 16, 6]);

  // Wide gamut: sRGB colors read through a P3 canvas are never flagged; P3 green is.
  const toP3 = converter('p3');
  const srgbAsP3 = new Uint8ClampedArray(4000 * 4);
  for (let i = 0; i < 4000; i++) {
    const p = toP3({ mode: 'rgb', r: rnd(), g: rnd(), b: rnd() });
    srgbAsP3.set([p.r, p.g, p.b].map((v) => Math.round(v * 255)).concat(255), i * 4);
  }
  eq('sRGB colors in P3 bytes: none outside sRGB', E.countOutOfSrgb(srgbAsP3).out, 0);
  eq('P3 green (0 255 0) is outside sRGB', E.countOutOfSrgb(new Uint8ClampedArray([0, 255, 0, 255])).out, 1);
  eq('SAMPLE_AREA and fitImageSize: 4000 × 3000 sampled at 591 × 443', (() => { const s = E.fitImageSize(4000, 3000, E.SAMPLE_AREA); return [s.w, s.h, s.w * s.h <= E.SAMPLE_AREA]; })(), [591, 443, true]);
}

// ── 4. Sorting, markers, shares ──
{
  const res = paletteOf(solid([['#1E3A8A', 50], ['#F97316', 30], ['#FFFFFF', 15], ['#16A34A', 5]]), { k: 4 });
  eq('sort by share', E.sortColors(res.colors, 'share', 'common').map((c) => hexOf(c.common)), ['#1E3A8A', '#F97316', '#FFFFFF', '#16A34A']);
  eq('sort by lightness (light to dark)', E.sortColors(res.colors, 'light', 'common').map((c) => hexOf(c.common)), ['#FFFFFF', '#F97316', '#16A34A', '#1E3A8A']);
  eq('sort by hue (neutrals last)', E.sortColors(res.colors, 'hue', 'common').map((c) => hexOf(c.common)), ['#F97316', '#16A34A', '#1E3A8A', '#FFFFFF']);
  eq('posToXY: pixel centre', E.posToXY(401, 400, 300), { x: 1.5 / 400, y: 1.5 / 300 });
  const r = paletteOf(banner.px, { k: 3 });
  const orange = r.colors.find((c) => hexOf(c.common) === '#F97316');
  const p = E.posToXY(orange.commonPos, 400, 300);
  check('orange marker lies inside the orange square', p.x * 400 >= 40 && p.x * 400 <= 100 && p.y * 300 >= 40 && p.y * 300 <= 100, JSON.stringify(p));
  eq('fmtShare truncates to one decimal', [E.fmtShare(0.71999), E.fmtShare(0.25), E.fmtShare(0.0004), E.fmtShare(0), E.fmtShare(1)], ['71.9%', '25.0%', '<0.1%', '0.0%', '100.0%']);
}

// ── 5. Value formats read back to the same color ──
{
  const toRgb = converter('rgb');
  let bad = [];
  for (let i = 0; i < 3000; i++) {
    const rgb = [0, 0, 0].map(() => Math.floor(rnd() * 256));
    for (const f of ['hex', 'rgb', 'hsl', 'oklch']) {
      const v = E.formatValue(rgb, f);
      const back = toRgb(culoriParse(v));
      const hex = formatHex({ mode: 'rgb', r: Math.min(1, Math.max(0, back.r)), g: Math.min(1, Math.max(0, back.g)), b: Math.min(1, Math.max(0, back.b)) }).toUpperCase();
      if (hex !== hexOf(rgb)) bad.push(f + ' ' + v);
    }
  }
  eq('3,000 colors × 4 formats read back with culori', bad.slice(0, 5), []);
}

// ── 6. Exports ──
const photoRes = paletteOf((await decode('icp-great-wave.jpg')).px, { k: 6 });
const entries = E.sortColors(photoRes.colors, 'share', 'common').map((c) => ({ rgb: c.common, share: c.share }));
const want = entries.map((e) => hexOf(e.rgb));
function readBack(values) {
  return values.map((v) => {
    const c = converter('rgb')(culoriParse(String(v).trim()));
    return c ? formatHex({ mode: 'rgb', r: Math.min(1, Math.max(0, c.r)), g: Math.min(1, Math.max(0, c.g)), b: Math.min(1, Math.max(0, c.b)) }).toUpperCase() : 'unparsable ' + v;
  });
}
for (const vf of ['hex', 'rgb', 'hsl', 'oklch']) {
  const n = entries.length, idx = entries.map((_, i) => i + 1);
  eq('list ' + vf, readBack(E.exportCode(entries, 'list', vf).split('\n')), want);
  const css = postcss.parse(E.exportCode(entries, 'css', vf));
  const decls = []; css.walkDecls((d) => decls.push(d));
  eq('css ' + vf + ': names', decls.map((d) => d.prop), idx.map((i) => '--palette-' + i));
  eq('css ' + vf + ': values', readBack(decls.map((d) => d.value)), want);
  const comments = []; css.walkComments((c) => comments.push(c.text));
  eq('css ' + vf + ': share comments', comments, entries.map((e) => E.fmtShare(e.share)));
  const tw4 = E.exportCode(entries, 'tw4', vf);
  const compiled = (await twCompile(tw4 + '\n@tailwind utilities;\n', { base: root })).build(idx.map((i) => 'bg-palette-' + i));
  const vars = {}; postcss.parse(compiled).walkDecls((d) => { if (d.prop.startsWith('--color-palette-')) vars[d.prop] = d.value; });
  eq('tw4 ' + vf + ': variables', Object.keys(vars), idx.map((i) => '--color-palette-' + i));
  eq('tw4 ' + vf + ': values', readBack(Object.values(vars)), want);
  check('tw4 ' + vf + ': bg-palette-N utilities', idx.every((i) => compiled.includes('.bg-palette-' + i + ' {')));
  const mod = { exports: {} };
  vm.runInNewContext(E.exportCode(entries, 'tw3', vf), { module: mod, exports: mod.exports });
  const pal = mod.exports?.theme?.extend?.colors?.palette || {};
  eq('tw3 ' + vf + ': keys', Object.keys(pal), idx.map(String));
  eq('tw3 ' + vf + ': values', readBack(Object.values(pal)), want);
  const probe = E.exportCode(entries, 'scss', vf) + '\n.probe {\n' + idx.map((i) => '  v' + i + ': $palette-' + i + ';').join('\n') + '\n}\n';
  let out = '';
  try { out = sass.compileString(probe).css; } catch (err) { out = 'ERROR ' + err.message; }
  check('scss ' + vf + ': compiles', !out.startsWith('ERROR'), out.slice(0, 160));
  const sv = {}; if (!out.startsWith('ERROR')) postcss.parse(out).walkDecls((d) => { sv[d.prop] = d.value; });
  eq('scss ' + vf + ': values', readBack(idx.map((i) => sv['v' + i])), want);
  check('n > 3 for this export check', n > 3);
}
{
  const json = JSON.parse(E.exportCode(entries, 'json', 'hex'));
  eq('json: hex', json.map((x) => x.hex), want);
  eq('json: rgb arrays', json.map((x) => x.rgb), entries.map((e) => e.rgb));
  eq('json: oklch reads back', readBack(json.map((x) => x.oklch)), want);
  check('json: shares are fractions with 4 decimals', json.every((x, i) => Math.abs(x.share - entries[i].share) <= 0.00005));
}

// ── 7. Palette files ──
// Port of GIMP's gimp_palette_load (app/core/gimppalette-load.c, GIMP master 2026-10): magic,
// optional "Name: " and "Columns: " (0–256), comments and blank lines skipped, components by
// strtok(" \t") + atoi clamped to 0–255, the rest of the line is the name.
function gimpLoadGpl(text) {
  const lines = text.split('\n');
  if (!lines[0].startsWith('GIMP Palette')) throw new Error('Missing magic header.');
  let i = 1, name = null, columns = 0;
  if (lines[i] && lines[i].startsWith('Name: ')) { name = lines[i].slice(6).trim(); i++;
    if (lines[i] && lines[i].startsWith('Columns: ')) { columns = parseInt(lines[i].slice(9).trim(), 10); if (!(columns >= 0 && columns <= 256)) throw new Error('Invalid number of columns'); i++; } }
  const colors = [];
  for (; i < lines.length; i++) {
    const s = lines[i];
    if (s[0] === '#' || s === '') continue;
    const toks = s.split(/[ \t]+/).filter(Boolean);
    const comp = toks.slice(0, 3).map((x) => { const v = parseInt(x, 10); if (!(v >= 0 && v <= 255)) throw new Error('component out of range'); return v; });
    if (comp.length < 3) throw new Error('Missing component in line ' + (i + 1));
    const rest = s.replace(/^\s*\S+\s+\S+\s+\S+/, '').trim();
    colors.push({ rgb: comp, name: rest });
  }
  return { name, columns, colors };
}
// Port of GIMP's gimp_palette_load_ase (same file): "ASEF", version byte 5 = 1, block count > 1,
// first block: a group start (name) or a color; group markers (negative type) skip 4 bytes.
function gimpLoadAse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic !== 'ASEF' || bytes[5] !== 1) throw new Error('Invalid ASE header');
  o = 8;
  let num = dv.getInt32(o); o += 4;
  if (num <= 1) throw new Error('Invalid number of colors');
  function blockName() {
    const len = dv.getInt32(o); o += 4;
    if (len <= 0 || len > bytes.length - o) throw new Error('Invalid ASE block size.');
    const nlen = dv.getUint16(o); o += 2;
    let s = '';
    for (let i = 0; i < nlen; i++) { s += String.fromCharCode(dv.getUint16(o)); o += 2; }
    return s;
  }
  let group = dv.getInt16(o); o += 2;
  let palName = null, skipFirst = false;
  if (group !== 1) { palName = blockName(); num -= 1; } else { skipFirst = true; }
  const colors = [];
  for (let i = 0; i < num; i++) {
    if (!skipFirst) { group = dv.getInt16(o); o += 2; }
    skipFirst = false;
    if (group < 0) { o += 4; num--; i--; continue; }
    const name = blockName();
    const model = String.fromCharCode(...bytes.slice(o, o + 4)); o += 4;
    if (model.trim() !== 'RGB') throw new Error('model ' + model);
    const v = [0, 1, 2].map(() => { const f = dv.getFloat32(o); o += 4; return f; });
    const type = dv.getInt16(o); o += 2;
    colors.push({ name: name.replace(/\u0000$/, ''), rgb: v.map((x) => Math.round(x * 255)), float: v, type });
  }
  return { name: palName && palName.replace(/\u0000$/, ''), colors, end: o };
}
// Independent reader written from the ASE description (block = type u16, length u32, payload).
function readAseBlocks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = { version: [dv.getUint16(4), dv.getUint16(6)], count: dv.getUint32(8), blocks: [] };
  let o = 12;
  for (let i = 0; i < out.count; i++) {
    const type = dv.getUint16(o), len = dv.getUint32(o + 2);
    out.blocks.push({ type, len, payload: bytes.slice(o + 6, o + 6 + len) });
    o += 6 + len;
  }
  out.end = o;
  return out;
}
{
  const gpl = E.gplFile(entries, 'great-wave');
  const g = gimpLoadGpl(gpl);
  eq('gpl: GIMP loader reads the name', g.name, 'great-wave');
  eq('gpl: columns', g.columns, entries.length);
  eq('gpl: colors', g.colors.map((c) => hexOf(c.rgb)), want);
  check('gpl: entry names carry hex and share', g.colors.every((c, i) => c.name === want[i] + ' (' + (i + 1) + ', ' + E.fmtShare(entries[i].share) + ')'), g.colors[0].name);
  check('gpl: newline in a name cannot add lines', gimpLoadGpl(E.gplFile(entries.slice(0, 2), 'a\nGIMP Palette')).colors.length === 2);
  const ase = E.aseFile(entries, 'great-wave');
  const a = gimpLoadAse(ase);
  eq('ase: GIMP loader reads the group name', a.name, 'great-wave');
  eq('ase: GIMP loader reads every color (float32 round trip)', a.colors.map((c) => hexOf(c.rgb)), want);
  eq('ase: color names are the hex values', a.colors.map((c) => c.name), want);
  eq('ase: color type 2 (normal)', a.colors.map((c) => c.type), entries.map(() => 2));
  const r = readAseBlocks(ase);
  eq('ase: version 1.0 and block count (group start + colors + group end)', [r.version, r.count], [[1, 0], entries.length + 2]);
  eq('ase: block types', r.blocks.map((b) => b.type.toString(16)), ['c001'].concat(entries.map(() => '1'), ['c002']));
  eq('ase: blocks end at the file end', r.end, ase.length);
  check('ase: color block length = 2 + name + 4 + 12 + 2', r.blocks.slice(1, -1).every((b) => b.len === 2 + 8 * 2 + 4 + 12 + 2));
  const one = E.aseFile(entries.slice(0, 1), 'one');
  eq('ase: a single color still has 3 blocks, so GIMP (which needs more than 1) reads it', gimpLoadAse(one).colors.length, 1);
  eq('paletteName', [E.paletteName('Starry Night.jpg'), E.paletteName('a/b:c?.png'), E.paletteName(''), E.paletteName('...')], ['Starry Night', 'a-b-c-', 'palette', 'palette'].map((s) => s.replace(/-$/, '')));
}

// ── 8. Links to the other color tools ──
{
  eq('toolLink en', E.toolLink('', 'color-shades-generator', [30, 58, 138]), '/tools/color-shades-generator/?color=%231E3A8A');
  eq('toolLink ja', E.toolLink('/ja', 'color-palette-generator', [249, 115, 22]), '/ja/tools/color-palette-generator/?color=%23F97316');
  for (const f of ['ColorShadesGeneratorTool.astro', 'ColorPaletteGeneratorTool.astro']) {
    const s = read('src/components/tools/' + f);
    check(f + ' reads ?color= from the URL', /URLSearchParams\(location\.search\)\.get\('color'\)/.test(s));
  }
  const P = engineFns('src/components/tools/ColorPaletteGeneratorTool.astro', ['parseColor']);
  eq('the palette generator parses the linked value', P.parseColor(decodeURIComponent('%231E3A8A')).hex, '#1E3A8A');
}

// ── 9. STRINGS ──
const sStart = source.indexOf('const STRINGS = {');
const sEnd = source.indexOf('\n};', sStart);
const STRINGS = new Function(source.slice(sStart, sEnd + 3) + '\nreturn STRINGS;')();
{
  const keys = (o) => Object.keys(o).sort();
  const ph = (o) => keys(o).map((k) => k + ':' + ((o[k].match(/\{\w+\}/g) || []).sort().join(',')));
  for (const l of ['zh', 'ja', 'ko']) {
    eq('STRINGS.' + l + ' has the same keys as en', keys(STRINGS[l]), keys(STRINGS.en));
    eq('STRINGS.' + l + ' has the same placeholders as en', ph(STRINGS[l]), ph(STRINGS.en));
  }
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  const used = [...new Set([...script.matchAll(/\bt\.(\w+)/g)].map((m) => m[1]))];
  eq('every t.key used by the script exists', used.filter((k) => !(k in STRINGS.en)), []);
  for (const k of ['list', 'css', 'scss', 'tw4', 'tw3', 'json']) check('code format name ' + k, ('code_' + k) in STRINGS.en);
}

// ── 10. Static checks ──
{
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  for (const word of ['innerHTML', 'insertAdjacentHTML', 'outerHTML', 'document.write', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'document.cookie']) {
    check('page script does not use ' + word, !script.includes(word));
  }
  check('Math.random is not used (deterministic palette)', !engineSrc.includes('Math.random'));
  const persistence = read('src/data/persistence.ts');
  check("persistence.ts: 'image-color-palette': 'preference'", /'image-color-palette':\s*'preference'/.test(persistence));
  check('saved preferences are settings only', /ztPersist\.save\(SLUG, state\)/.test(script) && /var state = \{ k: 6, sort: 'share', pick: 'common', vivid: true, ignoreWhite: false, ignoreBlack: false, code: 'css', values: 'hex' \}/.test(script));
}

// ── 11. Tool pages ──
{
  const dir = join(root, 'src/content/tools/image-color-palette');
  let annotations = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mdx'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/\{\/\* icp-check: (\{.*?\}) \*\/\}/g)) {
      annotations++;
      const spec = JSON.parse(m[1]);
      const img = await decode(spec.image);
      const res = paletteOf(img.px, { k: spec.k, vivid: spec.vivid !== false, ignoreWhite: !!spec.ignoreWhite, ignoreBlack: !!spec.ignoreBlack });
      const got = summary(res, spec.pick || 'common', spec.sort || 'share');
      eq(f + ' ' + spec.image + ' k=' + spec.k + ' palette', got, spec.expect);
      if (spec.groups !== undefined) eq(f + ' ' + spec.image + ' groups', res.groups, spec.groups);
      if (spec.transparent !== undefined) eq(f + ' ' + spec.image + ' transparent share', E.fmtShare(res.transparent), spec.transparent);
      if (spec.ignored !== undefined) eq(f + ' ' + spec.image + ' ignored share', E.fmtShare(res.ignored), spec.ignored);
      const after = text.slice(m.index, m.index + 3000);
      for (const s of spec.expect) {
        const [hex, share] = s.split(' ');
        check(f + ': ' + hex + ' ' + share + ' appears after the annotation', after.includes(hex) && after.includes(share), s);
      }
    }
  }
  check('tool pages carry icp-check annotations (≥ 8)', annotations >= 8, annotations);
}

// ── 12. Real page script: P3 work, cancellation and message isolation ──
// Canvas supplies controlled P3 bytes; the actual copied countOutOfSrgb runs in the vm.
function pageHarness({ p3 = true, readError = false } = {}) {
  const timers = [], nodes = new Map(), reads = [], images = [];
  let countCalls = 0;
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.listeners = {}; this.children = []; this.style = {};
      this.attrs = {}; this.value = ''; this.hidden = false; this.classes = new Set();
      this.classList = { add: (x) => this.classes.add(x), remove: (x) => this.classes.delete(x), toggle() {} };
    }
    set textContent(v) { this.text = v; this.children = []; }
    get textContent() { return this.text || ''; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, e = {}) { for (const fn of this.listeners[type] || []) fn({ target: this, ...e }); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    appendChild(n) { this.children.push(n); return n; }
    contains(n) { return n === this || [...nodes.values()].includes(n); }
    querySelector(sel) { return this.children.flatMap((n) => n.children).find((n) => n.className === sel.slice(1)) || null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { bottom: 0, top: 0 }; }
    remove() {} select() {} click() { this.dispatch('click'); }
    getContext(type, opts = {}) {
      const node = this;
      return {
        getContextAttributes: () => ({ colorSpace: p3 ? opts.colorSpace || 'srgb' : 'srgb' }),
        drawImage(source, ...args) { this.source = source; this.y = args.length === 4 ? -args[1] : 0; },
        clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, lineTo() {}, closePath() {},
        getImageData(x, y, w, h) {
          if (opts.colorSpace === 'display-p3') {
            if (readError) throw new Error('read failed');
            reads.push({ w, h, canvasHeight: node.height });
          }
          const d = new Uint8ClampedArray(w * h * 4);
          for (let i = 0; i < d.length; i += 4) {
            d[i] = opts.colorSpace === 'display-p3' ? 255 : 30; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
          }
          return { data: d };
        },
      };
    }
  }
  const document = new Node();
  document.getElementById = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  document.createElement = (tag) => new Node(tag);
  document.querySelector = () => null;
  document.body = new Node('body');
  const window = { innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener() {} }), scrollBy() {},
    ztPersist: { load() {}, save() {}, clear() {} } };
  let script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  const countSignature = 'function countOutOfSrgb(px) {';
  assert.equal(script.split(countSignature).length - 1, 1, 'instrument exactly one real P3 counter');
  script = script.replace(countSignature, countSignature + ' recordCount();');
  const ctx = vm.createContext({ document, window, t: STRINGS.en, navigator: { clipboard: { writeText: () => Promise.resolve() } },
    Uint8ClampedArray, Uint8Array, ArrayBuffer, DataView, Blob, TextEncoder,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class { constructor() { this.naturalWidth = 6000; this.naturalHeight = 4752; images.push(this); } decode() { return Promise.resolve(); } },
    setTimeout: (fn) => { const timer = { fn }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    recordCount: () => countCalls++, console,
  });
  vm.runInContext(script, ctx);
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { nodes, reads, document, window, flush, get countCalls() { return countCalls; },
    async open(name = 'photo.jpg', type = 'image/jpeg') {
      const n = document.getElementById('icp-file'); n.files = [{ name, type }]; n.dispatch('change');
      if (type.startsWith('image/')) { images.at(-1).onload(); await flush(); }
    },
    async step() { const timer = timers.shift(); if (timer && !timer.cancelled) timer.fn(); await flush(); },
    async drain() { for (let i = 0; timers.length && i < 1000; i++) await this.step(); },
    clear() { document.activeElement = document.getElementById('icp-open'); document.dispatch('keydown', { key: 'l', ctrlKey: true }); },
  };
}
{
  const h = pageHarness(); await h.open();
  const exportBefore = h.nodes.get('icp-code-out').textContent;
  await h.step();
  check('P3 scan yields before processing the whole sample', h.countCalls === 0 || h.reads.reduce((n, r) => n + r.w * r.h, 0) < 261625);
  await h.drain();
  check('real countOutOfSrgb is reached more than once', h.countCalls > 1, h.countCalls);
  check('P3 reads are bounded strips', h.reads.length > 1 && h.reads.every((r) => r.h <= 16), h.reads);
  check('controlled opaque P3 red produces the unchanged 100% warning', h.nodes.get('icp-status').textContent.includes('100.0%'));
  eq('P3 scan leaves full export bytes unchanged', h.nodes.get('icp-code-out').textContent, exportBefore);

  const c = pageHarness(); await c.open(); c.clear(); await c.drain();
  check('global clear hides palette and export', c.nodes.get('icp-main').hidden && c.nodes.get('icp-export').hidden);
  eq('global clear prevents the pending P3 read', c.reads.length, 0);

  const m = pageHarness(); await m.open(); await m.step();
  m.nodes.get('icp-copy-code').click(); await m.flush();
  const copyMsg = m.nodes.get('icp-status').textContent; await m.drain();
  eq('P3 completion does not overwrite a newer copy message', m.nodes.get('icp-status').textContent, copyMsg);
  const u = pageHarness({ p3: false }); await u.open(); await u.drain();
  check('unsupported P3 is explicit', /Display P3.*unavailable/i.test(u.nodes.get('icp-status').textContent));
}

console.log((failures ? 'FAIL' : 'PASS') + ': image-color-palette — ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
