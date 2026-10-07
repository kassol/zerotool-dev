// Color Palette Generator — color parsing, harmony, gamut mapping, value formats and code export
//
// Read:  src/components/tools/ColorPaletteGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the STRINGS table between
//        `strings:start` / `strings:end`, so this test cannot drift from the shipped source);
//        src/content/tools/color-palette-generator/{en,zh,ja,ko}.mdx (examples marked with
//        `{/* palette: {...} */}` are recomputed here and must appear in the page text)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Reference implementation: culori 4.0.2 (devDependency). It parses CSS Color 4 syntax, converts
// sRGB ↔ HSL ↔ OKLCH and implements CSS Color 4 gamut mapping (`toGamut('rgb', 'oklch')`). The
// expected values below come from culori, from hand-checked literals (WCAG 2.2 relative luminance:
// #3B82F6 on white is 3.68:1), or from the parsers of the export formats (css-tree for CSS and
// Tailwind v4 `@theme`, node:vm for the Tailwind v3 config, JSON.parse). When the environment
// variable PALETTE_TOOLCHAIN_DIR points at a directory with `sass` and `tailwindcss@4` installed,
// the SCSS output is compiled with Dart Sass and the `@theme` block with Tailwind v4; otherwise
// those two checks are SKIP (CI does not install them).
//
// Before this test the tool only accepted `#` + 6 hex digits (`3b82f6`, `#abc`, `rgb()`, `hsl()`
// and color names were ignored without a message, and `maxlength=7` cut pasted values); a gray
// base gave four cards of identical grays with no notice; the card called "Tetradic" was the
// square scheme (90° steps); split-complementary and monochromatic were missing; and copy
// failures were silent.
//
// Run: node scripts/test-color-palette-generator.mjs

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import * as culori from 'culori';
import * as csstree from 'css-tree';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorPaletteGeneratorTool.astro'), 'utf8');

function between(text, a, b, what) {
  const i = text.indexOf(a);
  const j = text.indexOf(b);
  if (i < 0 || j <= i) {
    console.error('FAIL: could not locate the ' + what + ' block in ColorPaletteGeneratorTool.astro');
    process.exit(1);
  }
  return text.slice(i + a.length, j);
}

const block = between(source, '/* ── engine:start ── */', '/* ── engine:end ── */', 'engine');
const E = new Function(block + '\nreturn { SCHEMES, NAMED, parseColor, harmonies, formatValue, exportCode, rgbToOklch, oklchToRgbFloat, gamutMap, relativeLuminance, contrastRatio, textColor, randomBase, toHex };')();
const stringsSrc = between(source, '/* ── strings:start ── */', '/* ── strings:end ── */', 'strings')
  .replace(/^\s*const STRINGS = /, 'return ')
  .replace(/\}\s*as const;\s*$/, '}');
const STRINGS = new Function(stringsSrc)();

let failures = 0;
let passes = 0;
let skips = 0;
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
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

// Deterministic PRNG (mulberry32) so failures are reproducible.
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261001);
const randomRgb = () => [0, 0, 0].map(() => Math.floor(rand() * 256));
const hexOf = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const culoriHex = (c) => culori.formatHex(c).toUpperCase();
const toRgb = culori.converter('rgb');
const toHsl = culori.converter('hsl');
const toOklch = culori.converter('oklch');
const toGamut = culori.toGamut('rgb', 'oklch');
const rgbObj = (rgb) => ({ mode: 'rgb', r: rgb[0] / 255, g: rgb[1] / 255, b: rgb[2] / 255 });
const channelDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const hexToArr = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// CSS Color 4 §5.1 rounds halves towards +∞; culori's floats land on either side of an exact half
// (72.4999… for #512810 + 30°), so the oracle rounds culori's float with the CSS rule.
const cssHex = (c) => { const r = toRgb(c); return hexOf([r.r, r.g, r.b].map((v) => Math.floor(Math.max(0, Math.min(1, v)) * 255 + 0.5 + 1e-7))); };
const dEok = (a, b) => culori.differenceEuclidean('oklab')(culori.parse(a), culori.parse(b));

// ---------- schemes ----------
eq('scheme ids in page order', E.SCHEMES.map((s) => s.id),
  ['complementary', 'splitComplementary', 'analogous', 'triadic', 'tetradic', 'square', 'monochromatic']);
const offsets = Object.fromEntries(E.SCHEMES.filter((s) => s.offsets).map((s) => [s.id, s.offsets]));
eq('complementary offsets', offsets.complementary, [0, 180]);
eq('split-complementary offsets (180° ± 30°)', offsets.splitComplementary, [0, 150, 210]);
eq('analogous offsets', offsets.analogous, [-30, 0, 30]);
eq('triadic offsets', offsets.triadic, [0, 120, 240]);
eq('tetradic is the rectangle (two complementary pairs 60° apart)', offsets.tetradic, [0, 60, 180, 240]);
eq('square is 90° steps', offsets.square, [0, 90, 180, 270]);
eq('export keys are kebab-case', E.SCHEMES.map((s) => s.key),
  ['complementary', 'split-complementary', 'analogous', 'triadic', 'tetradic', 'square', 'monochromatic']);

// ---------- parsing ----------
const parsed = (s) => { const r = E.parseColor(s); return r.ok ? r.hex : 'ERR:' + r.error; };
const PARSE_OK = [
  ['#3b82f6', '#3B82F6'],
  ['3b82f6', '#3B82F6'],
  ['#3B82F6', '#3B82F6'],
  ['#abc', '#AABBCC'],
  ['abc', '#AABBCC'],
  ['#3b82f680', '#3B82F6'],
  ['#abcd', '#AABBCC'],
  ['  #3b82f6;  ', '#3B82F6'],
  ['"#3b82f6"', '#3B82F6'],
  ["'rgb(59, 130, 246)'", '#3B82F6'],
  ['＃３Ｂ８２Ｆ６', '#3B82F6'],
  ['rgb(59, 130, 246)', '#3B82F6'],
  ['rgb(59 130 246)', '#3B82F6'],
  ['rgba(59, 130, 246, 0.5)', '#3B82F6'],
  ['rgb(59 130 246 / 50%)', '#3B82F6'],
  ['RGB(59 130 246)', '#3B82F6'],
  ['rgb(100% 0% 0%)', '#FF0000'],
  ['rgb(300, -20, 128)', '#FF0080'],
  ['hsl(217 91% 60%)', '#3C83F6'],
  ['hsl(217, 91%, 60%)', '#3C83F6'],
  ['hsl(217deg 91% 60%)', '#3C83F6'],
  ['hsl(0.5turn 100% 50%)', '#00FFFF'],
  ['hsla(120, 100%, 25%, 0.3)', '#008000'],
  ['hsl(none 0% 50%)', '#808080'],
  ['oklch(62.3% 0.214 259.815)', null],
  ['oklch(0.7 0.1 30)', null],
  ['oklch(70% 25% 30deg)', null],
  ['rebeccapurple', '#663399'],
  ['RebeccaPurple', '#663399'],
  ['tomato', '#FF6347'],
  ['grey', '#808080'],
];
for (const [input, expected] of PARSE_OK) {
  const want = expected || culoriHex(toGamut(culori.parse(input)));
  eq('parse ' + JSON.stringify(input), parsed(input), want);
}
// Cross-check against culori's CSS parser for in-gamut values.
for (const input of ['#3b82f6', '#abc', '#3b82f680', 'rgb(59 130 246)', 'rgb(59, 130, 246)', 'rgb(20% 40% 60%)',
  'hsl(217 91% 60%)', 'hsl(217, 91%, 60%)', 'hsl(0.5turn 100% 50%)', 'hsl(3.14159rad 50% 50%)', 'hsl(200grad 50% 50%)',
  'oklch(0.7 0.1 30)', 'oklch(50% 0.05 200)', 'tomato', 'rebeccapurple', 'hsl(none 0% 50%)']) {
  eq('parse matches culori: ' + input, parsed(input), culoriHex(culori.parse(input)));
}
const notesOf = (s) => (E.parseColor(s).notes || []).slice().sort();
eq('alpha below 1 is ignored with a note', notesOf('rgb(59 130 246 / 50%)'), ['alphaIgnored']);
eq('8-digit hex alpha is ignored with a note', notesOf('#3b82f680'), ['alphaIgnored']);
eq('opaque 8-digit hex has no note', notesOf('#3b82f6ff'), []);
eq('out-of-range rgb is clamped with a note', notesOf('rgb(300, -20, 128)'), ['clamped']);
eq('out-of-gamut oklch is gamut mapped with a note', notesOf('oklch(70% 0.35 30)'), ['mapped']);
eq('oklch lightness above 100% is clamped (CSS) with a note', notesOf('oklch(62.3 0.2 260)'), ['clamped']);
eq('oklch L > 1 gives white like CSS', parsed('oklch(62.3 0.2 260)'), '#FFFFFF');

const err = (s) => { const r = E.parseColor(s); return r.ok ? 'OK' : r; };
eq('empty input', err('   ').error, 'empty');
eq('5 hex digits', [err('#3b82f').error, err('#3b82f').n], ['hexLength', 5]);
eq('7 hex digits', [err('3b82f6a').error, err('3b82f6a').n], ['hexLength', 7]);
eq('bad hex digit reports char and position', [err('#3b82fg').error, err('#3b82fg').ch, err('#3b82fg').pos], ['hexChar', 'g', 7]);
eq('bad hex digit position counts code points', [err('#3b8😀f6').ch, err('#3b8😀f6').pos], ['😀', 5]);
eq('unsupported function', [err('lab(50% 20 30)').error, err('lab(50% 20 30)').fn], ['unsupportedFn', 'lab']);
eq('color() is unsupported', err('color(display-p3 1 0 0)').error, 'unsupportedFn');
eq('rgb with two values', [err('rgb(1, 2)').error, err('rgb(1, 2)').fn], ['fnArgs', 'rgb']);
eq('legacy syntax is not valid for oklch', err('oklch(0.7, 0.1, 30)').error, 'fnArgs');
eq('bad hsl value', [err('hsl(abc 1% 2%)').error, err('hsl(abc 1% 2%)').value], ['fnValue', 'abc']);
eq('angle unit in rgb', err('rgb(10deg 0 0)').error, 'fnValue');
eq('unknown word', err('hello').error, 'unknown');
eq('transparent is not an opaque color', err('transparent').error, 'unknown');

// ---------- named colors ----------
const named = Object.keys(E.NAMED).sort();
eq('148 CSS named colors', named.length, 148);
eq('named color list equals culori', named, Object.keys(culori.colorsNamed).sort());
let namedBad = 0;
for (const name of Object.keys(culori.colorsNamed)) {
  if (parsed(name) !== culoriHex(culori.parse(name))) namedBad++;
}
eq('every named color parses to the CSS value', namedBad, 0);

// ---------- HSL harmonies against culori ----------
let hslBad = 0; let hslFirst = '';
let baseBad = 0;
for (let n = 0; n < 3000; n++) {
  const rgb = randomRgb();
  const hex = hexOf(rgb);
  const res = E.harmonies(rgb, 'hsl');
  const h = toHsl(rgbObj(rgb));
  for (const scheme of res.schemes) {
    if (scheme.id === 'monochromatic') continue;
    const def = E.SCHEMES.find((s) => s.id === scheme.id);
    scheme.colors.forEach((c, i) => {
      const off = def.offsets[i];
      if (off === 0) { if (c.hex !== hex || !c.base) baseBad++; return; }
      const want = cssHex({ mode: 'hsl', h: (((h.h || 0) + off) % 360 + 360) % 360, s: h.s, l: h.l });
      if (c.hex !== want) { hslBad++; if (!hslFirst) hslFirst = hex + ' ' + scheme.id + ' ' + off + ': ' + c.hex + ' vs ' + want; }
    });
  }
}
eq('HSL rotations equal culori for 3000 random bases', hslBad, 0);
if (hslFirst) console.log('  first difference: ' + hslFirst);
eq('base swatch is the input color exactly and marked base', baseBad, 0);

const blue = E.harmonies([0x3b, 0x82, 0xf6], 'hsl');
const hexes = (res, id) => res.schemes.find((s) => s.id === id).colors.map((c) => c.hex);
eq('#3B82F6 complementary (HSL)', hexes(blue, 'complementary'), ['#3B82F6', '#F6AF3B']);
eq('#3B82F6 triadic (HSL)', hexes(blue, 'triadic'), ['#3B82F6', '#F63B82', '#82F63B']);
// 210° lands on red = 246 − 187 × 7.2192…/60 = 223.5 exactly; CSS rounds the half up to E0 (culori's float gives DF).
eq('#3B82F6 split-complementary (HSL)', hexes(blue, 'splitComplementary'), ['#3B82F6', '#F6523B', '#E0F63B']);
eq('#3B82F6 complementary (OKLCH, gamut mapped)', hexes(E.harmonies([0x3b, 0x82, 0xf6], 'oklch'), 'complementary'), ['#3B82F6', '#B57A00']);

// ---------- achromatic and low-chroma bases ----------
const gray = E.harmonies([128, 128, 128], 'hsl');
check('gray base is reported as achromatic', gray.notes.includes('achromatic'), JSON.stringify(gray.notes));
check('gray: hue schemes repeat the same gray', gray.schemes.filter((s) => s.id !== 'monochromatic')
  .every((s) => s.colors.every((c) => c.hex === '#808080')));
eq('gray: monochromatic gives 5 different grays', new Set(hexes(gray, 'monochromatic')).size, 5);
const grayOk = E.harmonies([128, 128, 128], 'oklch');
check('gray is achromatic in OKLCH mode too', grayOk.notes.includes('achromatic'));
check('gray OKLCH hue schemes repeat the gray', grayOk.schemes.filter((s) => s.id !== 'monochromatic')
  .every((s) => s.colors.every((c) => c.hex === '#808080')));
const nearGray = E.harmonies([0x80, 0x82, 0x85], 'hsl');
check('near-gray base gets a low-chroma note', nearGray.notes.includes('lowChroma') && !nearGray.notes.includes('achromatic'), JSON.stringify(nearGray.notes));
check('saturated base has no achromatic / low-chroma note', !blue.notes.includes('achromatic') && !blue.notes.includes('lowChroma'));

// ---------- monochromatic ----------
let monoBad = 0; let monoFirst = '';
for (let n = 0; n < 3000; n++) {
  const rgb = randomRgb();
  for (const space of ['hsl', 'oklch']) {
    const cs = E.harmonies(rgb, space).schemes.find((s) => s.id === 'monochromatic').colors;
    const bases = cs.filter((c) => c.base);
    const ls = cs.map((c) => toOklch(culori.parse(c.hex)).l);
    const sorted = ls.every((l, i) => i === 0 || l >= ls[i - 1] - 1e-9);
    const ok = cs.length === 5 && bases.length === 1 && bases[0].hex === hexOf(rgb) && sorted;
    if (!ok) { monoBad++; if (!monoFirst) monoFirst = space + ' ' + hexOf(rgb) + ' ' + cs.map((c) => c.hex + (c.base ? '*' : '')).join(' '); }
  }
}
eq('monochromatic: 5 colors, base once, dark to light (3000 bases × 2 spaces)', monoBad, 0);
if (monoFirst) console.log('  first: ' + monoFirst);
// Steps 15 / 32.5 / 50 / 67.5 / 85; the base (L 59.8) replaces the closest step, 67.5.
const bh = toHsl(culori.parse('#3b82f6'));
eq('#3B82F6 monochromatic (HSL lightness 15 / 32.5 / 50 / base / 85)', hexes(blue, 'monochromatic'),
  [cssHex({ mode: 'hsl', h: bh.h, s: bh.s, l: 0.15 }),
    cssHex({ mode: 'hsl', h: bh.h, s: bh.s, l: 0.325 }),
    cssHex({ mode: 'hsl', h: bh.h, s: bh.s, l: 0.5 }),
    '#3B82F6',
    cssHex({ mode: 'hsl', h: bh.h, s: bh.s, l: 0.85 })]);

// ---------- OKLCH conversion and gamut mapping ----------
let okConvBad = 0;
for (let n = 0; n < 5000; n++) {
  const rgb = randomRgb();
  const mine = E.rgbToOklch(rgb);
  const ref = toOklch(rgbObj(rgb));
  const dh = Math.abs((((mine.h - (ref.h || 0)) % 360) + 540) % 360 - 180);
  if (Math.abs(mine.l - ref.l) > 1e-6 || Math.abs(mine.c - ref.c) > 1e-6 || (ref.c > 1e-4 && dh > 1e-3)) okConvBad++;
}
eq('sRGB → OKLCH matches culori within 1e-6 (5000 colors)', okConvBad, 0);

let gmBad = 0; let gmExact = 0; let gmTotal = 0; let gmFirst = '';
let gmInGamut = 0; let gmLightness = 0;
for (let n = 0; n < 6000; n++) {
  const l = 0.05 + rand() * 0.9;
  const c = rand() * 0.37;
  const h = rand() * 360;
  const mine = E.gamutMap({ l, c, h });
  const mine8 = mine.map((v) => Math.round(v * 255));
  const ref = toGamut({ mode: 'oklch', l, c, h });
  const ref8 = [ref.r, ref.g, ref.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  gmTotal++;
  if (channelDiff(mine8, ref8) === 0) gmExact++;
  if (dEok(hexOf(mine8), hexOf(ref8)) > 0.01) { gmBad++; if (!gmFirst) gmFirst = `oklch(${l} ${c} ${h}): ${mine8} vs ${ref8}`; }
  if (mine.some((v) => v < 0 || v > 1)) gmInGamut++;
  const back = toOklch(rgbObj(mine8));
  if (Math.abs(back.l - l) > 0.02) gmLightness++;
}
// culori's loop differs slightly from the CSS Color 4 §14.2.2 pseudocode (no initial clip check, no
// min_inGamut shortcut), so a few results land on a neighboring 8-bit value; all stay within half a JND.
eq('gamut mapping within ΔEOK 0.01 of culori toGamut (6000 OKLCH colors)', gmBad, 0);
if (gmFirst) console.log('  first: ' + gmFirst);
check('gamut mapping equals culori exactly for at least 97% of colors', gmExact / gmTotal >= 0.97, gmExact + '/' + gmTotal);
console.log('  gamut mapping identical to culori for ' + gmExact + ' / ' + gmTotal + ' colors');
eq('gamut-mapped results stay inside sRGB', gmInGamut, 0);
eq('gamut mapping keeps OKLCH lightness within one JND (0.02)', gmLightness, 0);
eq('L ≥ 1 maps to white', E.gamutMap({ l: 1.2, c: 0.2, h: 30 }).map((v) => Math.round(v * 255)), [255, 255, 255]);
eq('L ≤ 0 maps to black', E.gamutMap({ l: -0.1, c: 0.2, h: 30 }).map((v) => Math.round(v * 255)), [0, 0, 0]);

let okRotBad = 0; let okMappedFlag = 0;
for (let n = 0; n < 1500; n++) {
  const rgb = randomRgb();
  if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) continue;
  const res = E.harmonies(rgb, 'oklch');
  const base = toOklch(rgbObj(rgb));
  for (const scheme of res.schemes) {
    if (scheme.id === 'monochromatic') continue;
    const def = E.SCHEMES.find((s) => s.id === scheme.id);
    scheme.colors.forEach((col, i) => {
      const off = def.offsets[i];
      if (off === 0) return;
      const target = { mode: 'oklch', l: base.l, c: base.c, h: (base.h + off) % 360 };
      const ref = toGamut(target);
      const ref8 = [ref.r, ref.g, ref.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
      if (dEok(col.hex, hexOf(ref8)) > 0.01) okRotBad++;
      if (col.mapped !== !culori.displayable(target)) okMappedFlag++;
    });
  }
}
eq('OKLCH rotations within ΔEOK 0.01 of culori (1500 bases)', okRotBad, 0);
eq('mapped flag set exactly when the rotated color is outside sRGB', okMappedFlag, 0);
const blueOk = E.harmonies([0x3b, 0x82, 0xf6], 'oklch');
check('OKLCH mode reports how many colors were mapped', blueOk.mapped === blueOk.schemes.reduce((n, s) => n + s.colors.filter((c) => c.mapped).length, 0) && blueOk.mapped > 0, String(blueOk.mapped));
check('OKLCH notes include mapped when any color was mapped', blueOk.notes.includes('mapped'));

// ---------- value formats ----------
const fv = (hex, f) => E.formatValue(hexToArr(hex), f);
eq('hex format', fv('#3b82f6', 'hex'), '#3B82F6');
eq('rgb format (comma syntax)', fv('#3B82F6', 'rgb'), 'rgb(59, 130, 246)');
eq('hsl format', fv('#3B82F6', 'hsl'), 'hsl(217.2, 91.2%, 59.8%)');
eq('gray hsl format', fv('#808080', 'hsl'), 'hsl(0, 0%, 50.2%)');
eq('gray oklch has chroma 0 and hue 0', fv('#808080', 'oklch'), 'oklch(59.99% 0 0)');
eq('white oklch', fv('#FFFFFF', 'oklch'), 'oklch(100% 0 0)');
eq('black oklch', fv('#000000', 'oklch'), 'oklch(0% 0 0)');
let fmtBad = 0; let fmtFirst = '';
const fmtSamples = [];
for (let n = 0; n < 20000; n++) fmtSamples.push(randomRgb());
for (let r = 0; r < 16; r++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) fmtSamples.push([r * 17, g * 17, b * 17]);
for (const rgb of fmtSamples) {
  for (const f of ['hex', 'rgb', 'hsl', 'oklch']) {
    const s = E.formatValue(rgb, f);
    const c = culori.parse(s);
    const back = c ? culoriHex(c) : 'unparsed';
    const mine = parsed(s);
    if (back !== hexOf(rgb) || mine !== hexOf(rgb)) { fmtBad++; if (!fmtFirst) fmtFirst = hexOf(rgb) + ' ' + f + ' ' + s + ' → culori ' + back + ', tool ' + mine; }
  }
}
eq('every formatted value parses back to the same hex in culori and in the tool (24096 colors × 4 formats)', fmtBad, 0);
if (fmtFirst) console.log('  first: ' + fmtFirst);
// Coolors rounds HSL to integers; that loses the color. The tool keeps one decimal (more if needed).
eq('integer HSL of #3A86FF does not round-trip (why the tool keeps decimals)', culoriHex(culori.parse('hsl(217, 100%, 61%)')), '#3884FF');
eq('tool HSL of #3A86FF round-trips', culoriHex(culori.parse(fv('#3A86FF', 'hsl'))), '#3A86FF');

// ---------- WCAG ----------
const lum = (hex) => E.relativeLuminance(...hexToArr(hex));
check('#3B82F6 on white is 3.68:1 (WCAG 2.2)', E.contrastRatio(lum('#3B82F6'), lum('#FFFFFF')).toFixed(2) === '3.68', E.contrastRatio(lum('#3B82F6'), lum('#FFFFFF')));
check('#3B82F6 on black is 5.71:1', E.contrastRatio(lum('#3B82F6'), 0).toFixed(2) === '5.71', E.contrastRatio(lum('#3B82F6'), 0));
check('white luminance is 1', Math.abs(lum('#FFFFFF') - 1) < 1e-12);
check('relative luminance uses the WCAG 2.2 threshold 0.04045', block.includes('0.04045') && !block.includes('0.03928'));
let lumBad = 0;
for (let n = 0; n < 3000; n++) {
  const rgb = randomRgb();
  const ref = culori.wcagLuminance(rgbObj(rgb));
  if (Math.abs(E.relativeLuminance(...rgb) - ref) > 1e-9) lumBad++;
}
eq('relative luminance equals culori wcagLuminance (3000 colors)', lumBad, 0);
let textBad = 0;
for (let n = 0; n < 3000; n++) {
  const rgb = randomRgb();
  const t = E.textColor(rgb);
  const other = t === '#000000' ? '#F9FAFB' : '#000000';
  const L = E.relativeLuminance(...rgb);
  if (E.contrastRatio(L, lum(t)) < E.contrastRatio(L, lum(other))) textBad++;
}
eq('swatch label color is the higher-contrast option (3000 colors)', textBad, 0);
eq('label on #3B82F6 is black (5.71 > 3.48)', E.textColor([0x3b, 0x82, 0xf6]), '#000000');

// ---------- code export ----------
const allSchemes = E.harmonies([0x3b, 0x82, 0xf6], 'hsl').schemes;
const one = [allSchemes[0]];
function cssDeclarations(css, ruleName) {
  const errors = [];
  const ast = csstree.parse(css, { onParseError: (e) => errors.push(e.message) });
  const decls = [];
  let rule = '';
  csstree.walk(ast, (node) => {
    if (node.type === 'Rule') rule = csstree.generate(node.prelude);
    if (node.type === 'Atrule') rule = '@' + node.name;
    if (node.type === 'Declaration') decls.push([node.property, csstree.generate(node.value).trim()]);
  });
  return { errors, decls, rule };
}
for (const f of ['hex', 'rgb', 'hsl', 'oklch']) {
  const css = E.exportCode(allSchemes, 'css', f);
  const p = cssDeclarations(css);
  eq('CSS export parses without errors (' + f + ')', p.errors, []);
  check('CSS export wraps variables in :root (' + f + ')', /^:root \{\n/.test(css) && p.rule === ':root');
  eq('CSS export has one variable per color (' + f + ')', p.decls.length, allSchemes.reduce((n, s) => n + s.colors.length, 0));
  const vals = p.decls.map(([, v]) => culoriHex(culori.parse(v)));
  eq('CSS export values parse back to the palette (' + f + ')', vals, allSchemes.flatMap((s) => s.colors.map((c) => c.hex)));
  eq('CSS variable names (' + f + ')', p.decls.slice(0, 3).map(([k]) => k), ['--complementary-1', '--complementary-2', '--split-complementary-1']);

  const tw4 = E.exportCode(allSchemes, 'tw4', f);
  const q = cssDeclarations(tw4);
  eq('Tailwind v4 export parses without errors (' + f + ')', q.errors, []);
  check('Tailwind v4 export is an @theme block (' + f + ')', /^@theme \{\n/.test(tw4) && q.rule === '@theme');
  eq('Tailwind v4 names use the --color- namespace (' + f + ')', q.decls[0][0], '--color-complementary-1');

  const scss = E.exportCode(allSchemes, 'scss', f);
  const lines = scss.split('\n').filter((l) => l.trim() && !l.startsWith('//'));
  check('SCSS export is one `$name: value;` per line (' + f + ')', lines.every((l) => /^\$[a-z]+(-[a-z]+)*-\d+: [^;]+;$/.test(l)), lines.find((l) => !/^\$[a-z]+(-[a-z]+)*-\d+: [^;]+;$/.test(l)));
  eq('SCSS values parse back (' + f + ')', lines.map((l) => culoriHex(culori.parse(l.replace(/^[^:]+: /, '').replace(/;$/, '')))), allSchemes.flatMap((s) => s.colors.map((c) => c.hex)));

  const tw3 = E.exportCode(allSchemes, 'tw3', f);
  const sandbox = { module: { exports: {} } };
  let tw3err = '';
  try { vm.runInNewContext(tw3, sandbox); } catch (e) { tw3err = e.message; }
  eq('Tailwind v3 config runs as CommonJS (' + f + ')', tw3err, '');
  const colors = sandbox.module.exports.theme && sandbox.module.exports.theme.extend && sandbox.module.exports.theme.extend.colors;
  check('Tailwind v3 config has theme.extend.colors (' + f + ')', !!colors);
  if (colors) {
    eq('Tailwind v3 color groups (' + f + ')', Object.keys(colors), E.SCHEMES.map((s) => s.key));
    eq('Tailwind v3 shades are 1..n (' + f + ')', Object.keys(colors.analogous), ['1', '2', '3']);
    eq('Tailwind v3 values parse back (' + f + ')', Object.values(colors).flatMap((g) => Object.values(g)).map((v) => culoriHex(culori.parse(v))), allSchemes.flatMap((s) => s.colors.map((c) => c.hex)));
  }

  const json = E.exportCode(allSchemes, 'json', f);
  let obj = null;
  try { obj = JSON.parse(json); } catch (e) { /* reported below */ }
  check('JSON export parses (' + f + ')', obj !== null);
  if (obj) eq('JSON export maps scheme → values (' + f + ')', Object.values(obj).flat().map((v) => culoriHex(culori.parse(v))), allSchemes.flatMap((s) => s.colors.map((c) => c.hex)));

  const list = E.exportCode(one, 'list', f);
  eq('single-scheme list is one value per line (' + f + ')', list.split('\n'), one[0].colors.map((c) => E.formatValue(hexToArr(c.hex), f)));
}
eq('CSS export of one scheme', E.exportCode(one, 'css', 'hex'), ':root {\n  --complementary-1: #3B82F6;\n  --complementary-2: #F6AF3B;\n}');
eq('Tailwind v4 export of one scheme', E.exportCode(one, 'tw4', 'oklch'),
  '@theme {\n  --color-complementary-1: ' + fv('#3B82F6', 'oklch') + ';\n  --color-complementary-2: ' + fv('#F6AF3B', 'oklch') + ';\n}');
eq('JSON export of one scheme', JSON.parse(E.exportCode(one, 'json', 'hex')), { complementary: ['#3B82F6', '#F6AF3B'] });

// Optional: compile with the real Dart Sass and Tailwind v4 when a toolchain directory is given.
const tcDir = process.env.PALETTE_TOOLCHAIN_DIR;
if (tcDir && existsSync(join(tcDir, 'node_modules'))) {
  const req = createRequire(join(tcDir, 'package.json'));
  try {
    const sass = req('sass');
    for (const f of ['hex', 'rgb', 'hsl', 'oklch']) {
      const scss = E.exportCode(allSchemes, 'scss', f) + '\n.probe { color: $split-complementary-2; background: $monochromatic-5; }\n';
      const out = sass.compileString(scss).css;
      const m = /color: ([^;]+);\s*background: ([^;]+);/.exec(out);
      const want = [allSchemes[1].colors[1].hex, allSchemes[6].colors[4].hex];
      eq('Dart Sass ' + sass.info.split('\t')[1] + ' compiles the SCSS export (' + f + ')', m ? [culoriHex(culori.parse(m[1])), culoriHex(culori.parse(m[2]))] : out, want);
    }
  } catch (e) { check('Dart Sass compile', false, e.message); }
  try {
    const twPath = req.resolve('tailwindcss');
    const tw = await import(twPath);
    const twCss = readFileSync(req.resolve('tailwindcss/theme.css'), 'utf8');
    const compile = tw.compile || (tw.default && tw.default.compile);
    const compiler = await compile('@import "tailwindcss/theme.css" layer(theme);\n' + E.exportCode(allSchemes, 'tw4', 'oklch') + '\n@tailwind utilities;', {
      loadStylesheet: async (id, base) => ({ path: id, base, content: id.includes('theme') ? twCss : '' }),
    });
    const css = compiler.build(['bg-complementary-2', 'text-split-complementary-3']);
    check('Tailwind v4 generates bg-complementary-2 from the @theme export', /\.bg-complementary-2\s*\{\s*background-color: var\(--color-complementary-2\)/.test(css), css.slice(-400));
    check('Tailwind v4 generates text-split-complementary-3', /\.text-split-complementary-3\s*\{\s*color: var\(--color-split-complementary-3\)/.test(css));
  } catch (e) { check('Tailwind v4 compile', false, e.message); }
} else {
  skip('Dart Sass compile of the SCSS export', 'PALETTE_TOOLCHAIN_DIR not set');
  skip('Tailwind v4 compile of the @theme export', 'PALETTE_TOOLCHAIN_DIR not set');
}

// ---------- random base ----------
const r1 = E.randomBase(rng(1));
const r2 = E.randomBase(rng(1));
eq('random base is reproducible with the same random source', r1, r2);
let randBad = 0;
const rr = rng(7);
for (let n = 0; n < 2000; n++) {
  const rgb = E.randomBase(rr);
  const ok = toOklch(rgbObj(rgb));
  if (!rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) || ok.l < 0.43 || ok.l > 0.82 || ok.c < 0.03) randBad++;
}
eq('random bases are mid-lightness, colored sRGB colors (2000 draws)', randBad, 0);

// ---------- strings ----------
const langs = ['en', 'zh', 'ja', 'ko'];
const keys = Object.keys(STRINGS.en).sort();
for (const lang of langs) {
  eq('STRINGS.' + lang + ' has the same keys as en', Object.keys(STRINGS[lang]).sort(), keys);
  for (const k of keys) {
    const ph = (s) => (String(s).match(/\{[a-z]+\}/g) || []).sort();
    eq('placeholders of ' + lang + '.' + k, ph(STRINGS[lang][k]), ph(STRINGS.en[k]));
  }
}
for (const id of E.SCHEMES.map((s) => s.id)) {
  check('scheme ' + id + ' has a name and description', keys.includes('scheme_' + id) && keys.includes('desc_' + id));
}
for (const code of ['empty', 'hexLength', 'hexChar', 'unsupportedFn', 'fnArgs', 'fnValue', 'unknown']) {
  check('error ' + code + ' has a message', keys.includes('err_' + code));
}
for (const note of ['alphaIgnored', 'clamped', 'mapped', 'achromatic', 'lowChroma']) {
  check('note ' + note + ' has a message', keys.includes('note_' + note));
}

// ---------- page script ----------
const script = source.slice(source.indexOf('/* ── engine:end ── */'));
check('page script never writes innerHTML', !/innerHTML\s*=/.test(script));
check('page script does not use fetch / XHR / cookies', !/fetch\(|XMLHttpRequest|document\.cookie/.test(source));
check('GA event is sent on change, not on every input event', /addEventListener\('change'/.test(script) && !/addEventListener\('input'[\s\S]{0,200}trackTool/.test(script));
check('copy has an execCommand fallback', /execCommand\('copy'\)/.test(script));
check('settings are saved through ztPersist', /ztPersist\.save\(/.test(script));
const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
check('persistence policy is preference', /'color-palette-generator': 'preference'/.test(persistence));

// ---------- page lifecycle: an invalid base color must not leave the old palette copyable ----------
// Runs the real page script against the real markup in a small DOM stand-in. Before 2026-10-07 the
// failure branch of applyInput only set the status: the cards, the export code and every copy
// button kept the previous color (on zerotool.dev: #3B82F6, then #3b82f, still showed and copied
// the #3B82F6 schemes).
{
  const pageScript = /<script is:inline define:vars=\{\{ t: T \}\}>([\s\S]*?)<\/script>/.exec(source)[1];
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  function matches(n, s) {
    return s.split(',').some((raw) => {
      let sel = raw.trim();
      const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      sel = sel.replace(/\[[^\]]+\]/g, '');
      const id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)], tag = /^[\w-]+/.exec(sel);
      return (!id || n.id === id[1]) && classes.every((c) => n.classList.contains(c[1])) && (!tag || n.tagName === tag[0].toUpperCase())
        && attrs.every((a) => (a[2] === undefined ? n.getAttribute(a[1]) !== null : n.getAttribute(a[1]) === a[2]));
    });
  }
  function page(lang, persisted = {}) {
    const doc = { listeners: {}, activeElement: null };
    const timers = new Map();
    const copies = [];
    let seq = 0;
    class Element {
      constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', attributes: {}, style: {}, children: [], parentNode: null, listeners: {}, value: '', title: '', disabled: false, text: '' }); }
      get classList() { const n = this; return { contains: (c) => n.className.split(/\s+/).includes(c), add(c) { if (!this.contains(c)) n.className += ' ' + c; }, remove(c) { n.className = n.className.split(/\s+/).filter((x) => x !== c).join(' '); } }; }
      setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; }
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
      removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; }
      get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
      set textContent(v) { for (const c of this.children) c.parentNode = null; this.children = []; this.text = String(v); }
      get firstChild() { return this.children[0] || null; }
      appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
      removeChild(n) { this.children = this.children.filter((c) => c !== n); n.parentNode = null; return n; }
      querySelectorAll(s) { return this.children.flatMap((c) => [...(matches(c, s) ? [c] : []), ...c.querySelectorAll(s)]); }
      querySelector(s) { return this.querySelectorAll(s)[0] || null; }
      closest(s) { for (let p = this; p; p = p.parentNode) if (p.tagName && matches(p, s)) return p; return null; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      dispatch(type, extra = {}) { const e = { type, target: this, preventDefault() {}, ...extra }; for (const fn of this.listeners[type] || []) fn(e); return e; }
      click() { if (!this.disabled) this.dispatch('click'); }
    }
    const body = new Element('body');
    const stack = [body], voids = new Set(['input', 'br', 'hr', 'img', 'meta', 'link']);
    for (const m of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)) {
      const tag = m[1];
      if (m[0].startsWith('</')) { if (stack.at(-1)?.tagName === tag.toUpperCase()) stack.pop(); continue; }
      const n = new Element(tag);
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) n.setAttribute(a[1], a[2]);
      stack.at(-1).appendChild(n);
      if (!voids.has(tag) && !m[2].endsWith('/')) stack.push(n);
    }
    const wrap = body.querySelector('.cpal-wrap');
    Object.assign(doc, {
      body, currentScript: { closest: () => wrap },
      createElement: (tag) => new Element(tag),
      querySelector: (s) => body.querySelector(s),
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      dispatch(type, extra = {}) { const e = { type, target: this.activeElement, ...extra }; for (const fn of this.listeners[type] || []) fn(e); return e; },
      execCommand: () => false,
    });
    const context = {
      document: doc, console, t: STRINGS[lang], Promise, Math, URLSearchParams, location: { search: '' },
      navigator: { clipboard: { writeText(text) { copies.push(text); return Promise.resolve(); } } },
      setTimeout(fn, ms = 0) { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id),
      ztPersist: { load: () => structuredClone(persisted), save() {}, clear() {} },
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(pageScript, context);
    const get = (id) => wrap.querySelector('#' + id);
    const flush = () => { for (let i = 0; i < 50 && timers.size; i++) for (const [id, tm] of [...timers]) { timers.delete(id); tm.fn(); } };
    const type = (text) => { get('cpal-input').value = text; get('cpal-input').dispatch('input'); };
    const enter = () => get('cpal-input').dispatch('keydown', { key: 'Enter' });
    const cards = () => get('cpal-palettes').querySelectorAll('.cpal-card');
    const copyButtons = () => wrap.querySelectorAll('.btn-copy').filter((b) => !b.disabled);
    return { doc, wrap, get, flush, type, enter, cards, copyButtons, copies };
  }
  const microtasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  for (const lang of langs) {
    const p = page(lang);
    eq(lang + ' initial page shows 7 scheme cards', p.cards().length, 7);
    check(lang + ' initial export code is filled', p.get('cpal-export-code').textContent.includes('#3B82F6'));
    eq(lang + ' initial copy buttons enabled (7 cards + export)', p.copyButtons().length, 8);
    for (const bad of ['#3b82f', '#3b82fg', 'lab(50% 20 30)', 'rgb(1, 2)', 'hello']) {
      p.type('#3B82F6'); p.enter(); p.flush();
      p.type(bad);
      eq(`${lang} "${bad}" while typing: old cards removed`, p.cards().length, 0);
      eq(`${lang} "${bad}" while typing: export code empty`, p.get('cpal-export-code').textContent, '');
      eq(`${lang} "${bad}" while typing: no copy button enabled`, p.copyButtons().length, 0);
      check(`${lang} "${bad}" while typing: status no longer describes the old color`, !p.get('cpal-status').textContent.includes('#3B82F6'), p.get('cpal-status').textContent);
      p.flush();
      const res = E.parseColor(bad);
      const msg = STRINGS[lang]['err_' + res.error].replace(/\{([a-z]+)\}/g, (m, k) => (res[k] !== undefined ? res[k] : m));
      eq(`${lang} "${bad}" after the pause: localized error with the reason`, p.get('cpal-status').textContent, msg);
      check(`${lang} "${bad}": empty-palette note is shown`, p.get('cpal-palettes').textContent === STRINGS[lang].noPalette, p.get('cpal-palettes').textContent);
      // Option changes must not bring the old color back.
      p.get('cpal-format').value = 'rgb'; p.get('cpal-format').dispatch('change');
      p.wrap.querySelector('[data-space="oklch"]').click();
      eq(`${lang} "${bad}": format / wheel change keeps the palette empty`, [p.cards().length, p.get('cpal-export-code').textContent, p.copyButtons().length], [0, '', 0]);
      p.get('cpal-format').value = 'hex'; p.get('cpal-format').dispatch('change');
      p.wrap.querySelector('[data-space="hsl"]').click();
    }
    // A valid color restores everything.
    p.type('#FF0000'); p.flush();
    eq(lang + ' valid color after an error restores 7 cards', p.cards().length, 7);
    check(lang + ' valid color after an error refills export code', p.get('cpal-export-code').textContent.includes('#FF0000'));
    eq(lang + ' valid color after an error re-enables copy', p.copyButtons().length, 8);
    p.get('cpal-export-copy').click(); await microtasks();
    check(lang + ' export copy copies the new color', p.copies.at(-1)?.includes('#FF0000') && !p.copies.at(-1)?.includes('#3B82F6'));
    // Ctrl/Cmd+L empties the field without an input event; the palette goes with it.
    p.get('cpal-input').value = '';
    p.doc.dispatch('keydown', { ctrlKey: true, key: 'l' }); p.flush();
    eq(lang + ' Ctrl+L leaves no cards and no enabled copy', [p.cards().length, p.get('cpal-export-code').textContent, p.copyButtons().length], [0, '', 0]);
    eq(lang + ' Ctrl+L shows the empty prompt', p.get('cpal-status').textContent, STRINGS[lang].err_empty);
  }
}

// ---------- examples on the tool pages ----------
for (const lang of langs) {
  const mdxPath = join(root, 'src/content/tools/color-palette-generator', lang + '.mdx');
  const mdx = readFileSync(mdxPath, 'utf8');
  const re = /\{\/\* palette: (\{.*?\}) \*\/\}/g;
  let m; let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    const spec = JSON.parse(m[1]);
    const p = E.parseColor(spec.base);
    check(lang + ' example base parses: ' + spec.base, p.ok);
    if (!p.ok) continue;
    const res = E.harmonies(p.rgb, spec.space);
    const sch = res.schemes.find((s) => s.id === spec.scheme);
    const got = sch.colors.map((c) => E.formatValue(hexToArr(c.hex), spec.format || 'hex'));
    eq(lang + ' example ' + spec.base + ' ' + spec.space + ' ' + spec.scheme, got, spec.expect);
    for (const v of spec.expect) check(lang + ' example value ' + v + ' appears in the page', mdx.includes(v));
    if (spec.mapped !== undefined) eq(lang + ' example mapped count ' + spec.base, sch.colors.filter((c) => c.mapped).length, spec.mapped);
  }
  check(lang + ' page has at least 2 checked examples', count >= 2, String(count));
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
