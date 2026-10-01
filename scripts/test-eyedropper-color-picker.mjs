// Eyedropper Color Picker — regression test for the color engine
//
// Read:  src/components/tools/EyedropperColorPickerTool.astro (the real engine block between
//        `engine:start` / `engine:end` and the frontmatter STRINGS table, so the test cannot
//        drift from the shipped source); src/data/persistence.ts
// Write: stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected values come from independent sources, not from the engine itself:
// - parsing and conversion are compared with colorjs.io (written by the CSS Color 4 editors)
//   and culori, both devDependencies used only here;
// - every HEX / RGB / HSL / OKLCH / Display P3 string the tool prints is read back by culori
//   (and a sample by colorjs.io) and must give the same 8-bit color;
// - sampling, coordinates and history use hand-built fixtures with known answers.
//
// Before this test the tool printed HSL rounded to whole numbers, which reads back as a
// different color for 89% of all 8-bit colors (#1a73e8 → hsl(214, 82%, 51%) → #1c74e9);
// hsl(720, 100%, 50%) gave #000000 instead of #ff0000, negative hues and the space-separated
// rgb() / hsl() syntax were rejected, and the system color dialog added every intermediate
// color to the history while the user dragged.
//
// Run: node scripts/test-eyedropper-color-picker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Color from 'colorjs.io';
import { parse as culoriParse, converter, colorsNamed, inGamut as culoriInGamut } from 'culori';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/EyedropperColorPickerTool.astro'), 'utf8');

const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s0 = source.indexOf(START), s1 = source.indexOf(END);
if (s0 < 0 || s1 <= s0) {
  console.error('FAIL: could not locate the engine block in EyedropperColorPickerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s0, s1) + `
return { parseColor, formatColor, pixelColor, sampleRegion, clientToPixel, fitImageSize, cleanRecent,
  pushRecent, eyeDropperErrorKey, srgbToP3, p3ToSrgb, srgbToOklab, oklabToOklch, NAMED, MAX_CANVAS_AREA,
  MAX_RECENT };`)();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function close(name, a, b, tol) {
  const ok = a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  check(name, ok, 'got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b));
}

const toRgb = converter('rgb');
const c8 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
// culori → [r8, g8, b8, a8]
// The tool also accepts HEX without "#" (as Figma copies it); the libraries need the "#".
const css = (str) => (/^[0-9a-f]+$/i.test(str) ? '#' + str : str);
function culori8(str) {
  const p = culoriParse(css(str));
  if (!p) return null;
  const r = toRgb(p);
  const v = (x) => (x === undefined || Number.isNaN(x) ? 0 : x); // CSS: none → 0
  return [c8(v(r.r)), c8(v(r.g)), c8(v(r.b)), c8(r.alpha === undefined ? 1 : r.alpha)];
}
function colorjs8(str) {
  const c = new Color(css(str)).to('srgb');
  return [...c.coords.map((v) => c8(Number.isNaN(v) || v === null ? 0 : v)), c8(c.alpha ?? 1)];
}
function engine8(str) {
  const p = E.parseColor(str);
  if (p.error) return null;
  return [...p.srgb.map(c8), c8(p.alpha)];
}

// ── 1. Parsing agrees with colorjs.io and culori ──
const valid = [
  '#1a73e8', '1A73E8', '#abc', '#abcd', '#1a73e880', 'RED', 'rebeccapurple', 'transparent',
  'rgb(26, 115, 232)', 'rgb(26 115 232)', 'rgba(26, 115, 232, 0.5)', 'rgb(26 115 232 / 50%)',
  'rgb(10%, 20%, 30%)', 'rgb(10% 20 30%)', 'rgb(300, -20, 128)', 'rgb(26.6 115.4 232.5)',
  'hsl(214, 82%, 51%)', 'hsl(214 82% 51%)', 'hsl(214deg 82% 51% / 0.25)', 'hsla(214, 82%, 51%, .3)',
  'hsl(720, 100%, 50%)', 'hsl(-120 100% 50%)', 'hsl(0.5turn 60% 40%)', 'hsl(3.14159rad 60% 40%)',
  'hsl(200grad 60% 40%)', 'hsl(90 120% 50%)', 'hsl(90 50 50)',
  'hwb(210 12% 21%)', 'hwb(0 60% 60%)', 'hwb(120deg 0% 0% / 40%)',
  'oklch(62.3% 0.214 259.815)', 'oklch(0.7 0.1 150)', 'oklch(70% 40% 150 / 0.5)', 'oklch(50% 0 0)',
  'oklab(0.6 -0.1 0.1)', 'oklab(60% 25% -25%)',
  'color(srgb 0.1 0.45 0.9)', 'color(srgb 10% 45% 90% / 0.5)', 'color(srgb-linear 0.2 0.5 0.8)',
  'color(display-p3 0.2 0.44 0.88)', 'color(display-p3 1 0 0)', 'color(display-p3 0 1 0 / 0.75)',
  'rgb(none 115 232)', 'hsl(none 50% 50%)'
];
for (const s of valid) {
  const mine = engine8(s);
  check('parses ' + s, mine !== null, JSON.stringify(E.parseColor(s)));
  if (!mine) continue;
  eq('colorjs.io agrees on ' + s, mine, colorjs8(s));
  const cu = culori8(s);
  if (cu) eq('culori agrees on ' + s, mine, cu);
}
// unclamped wide-gamut values agree with colorjs.io before clipping
for (const s of ['color(display-p3 1 0 0)', 'oklch(70% 0.35 145)', 'color(srgb 1.2 -0.1 0.5)']) {
  const c = new Color(s).to('srgb');
  close('unclipped sRGB of ' + s, E.parseColor(s).srgb, c.coords, 1e-6);
}
// every CSS named color
const named = Object.keys(colorsNamed);
eq('148 named colors', Object.keys(E.NAMED).length, 148);
eq('same names as culori', Object.keys(E.NAMED).sort(), named.slice().sort());
for (const n of named) eq('named ' + n, engine8(n), colorjs8(n));

// invalid input (CSS Color 4 grammar)
const invalid = {
  '': 'empty', '   ': 'empty', '#12345': 'hex', '#1234567': 'hex', 'blurple': 'syntax',
  'rgb(10%, 20, 30%)': 'syntax', 'rgb(1 2 3, 4)': 'syntax', 'rgb(1, 2)': 'syntax',
  'rgb(1 2 3 / 0.5 / 1)': 'syntax', 'rgb(none, 0, 0)': 'syntax', 'rgb(1deg 2 3)': 'syntax',
  'hwb(200, 10%, 20%)': 'syntax', 'oklch(50%, 0.1, 20)': 'syntax', 'hsl(1px 2% 3%)': 'syntax',
  'color(rec2020 1 0 0)': 'space', 'color(display-p3 1 0)': 'syntax', 'rgb(1 2 3) x': 'syntax',
  'url(#a)': 'syntax', 'lab(50% 20 30)': 'syntax'
};
for (const [s, code] of Object.entries(invalid)) eq('rejects ' + JSON.stringify(s), E.parseColor(s).error, code);
eq('trailing semicolon from a CSS declaration is ignored', engine8('#1a73e8;'), [26, 115, 232, 255]);

// ── 2. Fixed bugs ──
eq('hsl(720, 100%, 50%) is red', E.formatColor(E.parseColor('hsl(720, 100%, 50%)')).hex, '#ff0000');
eq('hsl(-120 100% 50%) is blue', E.formatColor(E.parseColor('hsl(-120 100% 50%)')).hex, '#0000ff');
const blue = E.formatColor(E.parseColor('#1a73e8'));
eq('#1a73e8 HSL', blue.hsl, 'hsl(214.1, 81.7%, 50.6%)');
eq('#1a73e8 HSL reads back as #1a73e8 (culori)', culori8(blue.hsl), [26, 115, 232, 255]);
eq('#1a73e8 OKLCH', blue.oklch, 'oklch(57.4% 0.195 257.9)');
eq('#1a73e8 Display P3', blue.p3, 'color(display-p3 0.218 0.444 0.879)');
eq('#1a73e8 RGB', blue.rgb, 'rgb(26, 115, 232)');

// ── 3. Every printed format reads back as the same 8-bit color ──
let bad = 0, n = 0, firstBad = null;
for (let r = 0; r < 256; r += 3) for (let g = 0; g < 256; g += 3) for (let b = 0; b < 256; b += 3) {
  n++;
  const f = E.formatColor({ srgb: [r / 255, g / 255, b / 255], alpha: 1 });
  for (const k of ['hex', 'rgb', 'hsl', 'oklch', 'p3']) {
    const back = engine8(f[k]);
    if (!back || back[0] !== r || back[1] !== g || back[2] !== b) { bad++; firstBad = firstBad || [r, g, b, k, f[k], back]; }
  }
}
check(`engine reads back every format for ${n} colors (step 3)`, bad === 0, JSON.stringify(firstBad));

let seed = 20261001;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
bad = 0; firstBad = null;
for (let i = 0; i < 30000; i++) {
  const r = Math.floor(rand() * 256), g = Math.floor(rand() * 256), b = Math.floor(rand() * 256);
  const a = rand() < 0.3 ? Math.floor(rand() * 255) + 1 : 255;
  const f = E.formatColor({ srgb: [r / 255, g / 255, b / 255], alpha: a / 255 });
  for (const k of ['hex', 'rgb', 'hsl', 'oklch', 'p3']) {
    const back = culori8(f[k]);
    if (!back || back[0] !== r || back[1] !== g || back[2] !== b || back[3] !== a) { bad++; firstBad = firstBad || [r, g, b, a, k, f[k], back]; }
  }
}
check('culori reads back every format for 30,000 random colors (30% with alpha)', bad === 0, JSON.stringify(firstBad));
bad = 0; firstBad = null;
for (let i = 0; i < 3000; i++) {
  const rgb = [0, 0, 0].map(() => Math.floor(rand() * 256));
  const f = E.formatColor({ srgb: rgb.map((v) => v / 255), alpha: 1 });
  for (const k of ['hsl', 'oklch', 'p3']) {
    const back = colorjs8(f[k]);
    if (back[0] !== rgb[0] || back[1] !== rgb[1] || back[2] !== rgb[2]) { bad++; firstBad = firstBad || [rgb, k, f[k], back]; }
  }
}
check('colorjs.io reads back HSL / OKLCH / P3 for 3,000 random colors', bad === 0, JSON.stringify(firstBad));

// ── 4. Conversions match colorjs.io ──
for (let i = 0; i < 500; i++) {
  const rgb = [rand(), rand(), rand()];
  const ok = E.oklabToOklch(E.srgbToOklab(rgb));
  const ref = new Color('srgb', rgb).to('oklch').coords;
  close('OKLCH L and C of random sRGB #' + i, ok.slice(0, 2), ref.slice(0, 2), 1e-9);
  if (ok[1] > 1e-4) check('OKLCH hue #' + i, Math.abs(((ok[2] - ref[2] + 540) % 360) - 180) < 1e-6, ok[2] + ' vs ' + ref[2]);
  close('sRGB → Display P3 #' + i, E.srgbToP3(rgb), new Color('srgb', rgb).to('p3').coords, 1e-9);
  close('Display P3 → sRGB #' + i, E.p3ToSrgb(rgb), new Color('p3', rgb).to('srgb').coords, 1e-9);
}

// ── 5. Gamut ──
for (const s of ['color(display-p3 1 0 0)', 'color(display-p3 0 1 0)', 'oklch(62.3% 0.214 259.815)', 'oklch(70% 0.1 150)', '#ff0000', 'color(srgb 1.01 0 0)']) {
  eq('in sRGB gamut: ' + s, E.formatColor(E.parseColor(s)).inGamut, new Color(s).inGamut('srgb'));
}
const p3red = E.formatColor(E.parseColor('color(display-p3 1 0 0)'));
eq('P3 red keeps its P3 value', p3red.p3, 'color(display-p3 1 0 0)');
eq('P3 red HEX is clipped', p3red.hex, '#ff0000');
check('P3 red OKLCH is the real color, not the clipped one (ΔEOK < 0.001 per colorjs.io)',
  new Color(p3red.oklch).deltaEOK(new Color('color(display-p3 1 0 0)')) < 0.001
  && new Color(p3red.oklch).deltaEOK(new Color('#ff0000')) > 0.02, p3red.oklch);
eq('P3 red OKLCH text', p3red.oklch, 'oklch(64.86% 0.2995 28.96)');

// pixelColor: canvas readouts → color
eq('fully transparent pixel has no color', E.pixelColor([0, 0, 0, 0], null), null);
const px = E.pixelColor([255, 0, 0, 255], [255, 0, 0, 255]);
check('P3 (255, 0, 0) readout is kept as out of gamut', Array.isArray(px.p3) && !E.formatColor(px).inGamut);
eq('its HEX comes from the sRGB readout', E.formatColor(px).hex, '#ff0000');
// Every 8-bit sRGB color, converted to 8-bit Display P3 the way a P3 canvas stores it, must count as
// in gamut; otherwise ordinary pixels would get the out-of-gamut warning.
bad = 0; firstBad = null;
for (let r = 0; r < 256; r += 3) for (let g = 0; g < 256; g += 3) for (let b = 0; b < 256; b += 3) {
  const p3 = E.srgbToP3([r / 255, g / 255, b / 255]).map(c8);
  const c = E.pixelColor([r, g, b, 255], [...p3, 255]);
  if (c.p3) { bad++; firstBad = firstBad || [r, g, b, p3]; }
}
check('8-bit P3 readouts of sRGB colors stay in gamut (no false warning)', bad === 0, JSON.stringify(firstBad));
eq('semi-transparent pixel keeps alpha', E.formatColor(E.pixelColor([26, 115, 232, 128], null)).hex, '#1a73e880');
eq('semi-transparent RGB', E.formatColor(E.pixelColor([26, 115, 232, 128], null)).rgb, 'rgba(26, 115, 232, 0.502)');

// ── 6. Sampling ──
function img(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}
const stripes = img(6, 3, (x) => (x % 2 ? [0, 0, 255, 255] : [255, 0, 0, 255]));
eq('1 px sample on a red column', E.sampleRegion(stripes, 6, 3, 2, 1, 1), [255, 0, 0, 255]);
eq('1 px sample on a blue column', E.sampleRegion(stripes, 6, 3, 3, 1, 1), [0, 0, 255, 255]);
eq('3×3 average over 1-px stripes (blue, red, blue)', E.sampleRegion(stripes, 6, 3, 2, 1, 3), [85, 0, 170, 255]);
eq('3×3 at the corner uses only pixels inside the image', E.sampleRegion(stripes, 6, 3, 0, 0, 3), [128, 0, 128, 255]);
const halfClear = img(2, 1, (x) => (x ? [0, 0, 0, 0] : [200, 100, 50, 255]));
eq('transparent pixels do not darken an average', E.sampleRegion(halfClear, 2, 1, 0, 0, 3), [200, 100, 50, 128]);
eq('all-transparent block', E.sampleRegion(img(3, 3, () => [9, 9, 9, 0]), 3, 3, 1, 1, 3), [0, 0, 0, 0]);
const ramp = img(5, 5, (x, y) => [x * 50, y * 50, 0, 255]);
eq('5×5 average of a ramp', E.sampleRegion(ramp, 5, 5, 2, 2, 5), [100, 100, 0, 255]);

eq('pointer at top-left', E.clientToPixel(0, 0, 400, 200, 4000, 2000), [0, 0]);
eq('pointer at bottom-right edge stays inside', E.clientToPixel(400, 200, 400, 200, 4000, 2000), [3999, 1999]);
eq('pointer maps through the display scale', E.clientToPixel(100.05, 50.05, 400, 200, 4000, 2000), [1000, 500]);
eq('pointer outside the box is clamped', E.clientToPixel(-5, 999, 400, 200, 4000, 2000), [0, 1999]);
eq('upscaled small image', E.clientToPixel(31.9, 16, 32, 32, 16, 16), [15, 8]);

eq('12 MP photo is not scaled', E.fitImageSize(4032, 3024, E.MAX_CANVAS_AREA), { w: 4032, h: 3024, scaled: false });
const big = E.fitImageSize(8064, 6048, E.MAX_CANVAS_AREA);
check('48 MP photo fits the canvas limit', big.scaled && big.w * big.h <= 16777216 && big.w * big.h > 16700000, JSON.stringify(big));
check('48 MP photo keeps its aspect ratio', Math.abs(big.w / big.h - 8064 / 6048) < 0.001, JSON.stringify(big));
const tall = E.fitImageSize(1, 40000000, E.MAX_CANVAS_AREA);
check('1-pixel-wide strip stays at least 1 px wide', tall.w >= 1 && tall.w * tall.h <= 16777216, JSON.stringify(tall));

// ── 7. History ──
eq('MAX_RECENT', E.MAX_RECENT, 16);
eq('clean list', E.cleanRecent(['#AABBCC', 'red', '#abc', '#aabbcc', '#11223344', 3, null]), ['#aabbcc', '#11223344']);
eq('non-array', E.cleanRecent('#aabbcc'), []);
eq('push moves an existing color to the front', E.pushRecent(['#111111', '#222222'], '#222222'), ['#222222', '#111111']);
const many = Array.from({ length: 20 }, (_, i) => '#0000' + (i + 10).toString(16).padStart(2, '0'));
eq('history keeps 16', E.pushRecent(many, '#ffffff').length, 16);
eq('newest first', E.pushRecent(many, '#FFFFFF')[0], '#ffffff');

// ── 8. EyeDropper errors (names from the EyeDropper spec and Chromium eye_dropper.cc) ──
eq('Esc → canceled', E.eyeDropperErrorKey({ name: 'AbortError' }), 'canceled');
eq('no user activation', E.eyeDropperErrorKey({ name: 'NotAllowedError' }), 'errNotAllowed');
eq('already open', E.eyeDropperErrorKey({ name: 'InvalidStateError' }), 'errBusy');
eq('not available (Linux Wayland)', E.eyeDropperErrorKey({ name: 'OperationError' }), 'errOperation');
eq('unknown error', E.eyeDropperErrorKey(new TypeError('x')), 'errOperation');

// ── 9. Strings, persistence, no network ──
const langs = ['en', 'zh', 'ja', 'ko'];
const keys = Object.keys(STRINGS.en).sort();
for (const l of langs) {
  eq(l + ' has the same STRINGS keys', Object.keys(STRINGS[l]).sort(), keys);
  for (const k of keys) {
    const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
    eq(`${l}.${k} placeholders`, ph(STRINGS[l][k]), ph(STRINGS.en[k]));
  }
}
for (const k of ['canceled', 'errNotAllowed', 'errBusy', 'errOperation']) check('string for ' + k, typeof STRINGS.en[k] === 'string');
const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
check('persistence policy is preference', /'eyedropper-color-picker':\s*'preference'/.test(persistence));
const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
check('script stores only through ztPersist', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(script));
check('script makes no network requests', !/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(script));
check('script never writes HTML', !/innerHTML|outerHTML|insertAdjacentHTML/.test(script));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
