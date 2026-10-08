// Eyedropper Color Picker — regression test for the color engine
//
// Read:  src/components/tools/EyedropperColorPickerTool.astro (the real engine block between
//        `engine:start` / `engine:end` and the frontmatter STRINGS table, so the test cannot
//        drift from the shipped source); src/data/persistence.ts; src/content/tools/
//        eyedropper-color-picker/*.mdx (examples marked `{/* ecp-check: … */}` are recomputed)
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

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { load as loadYaml } from 'js-yaml';
import Color from 'colorjs.io';
import { parse as culoriParse, converter, colorsNamed, inGamut as culoriInGamut } from 'culori';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

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

// ── 1b. A rejected value gets its reason and position ──
// Before 2026-10-07 every rejected value showed the same sentence ("Not a color this tool reads…"),
// whether it was a 5-digit hex, rgb() with two values or an unknown color() space. diagnoseColor()
// sits outside the protected engine block (between `diagnose:start` / `diagnose:end`) and runs
// only after parseColor() has rejected the value.
const D0 = source.indexOf('/* ── diagnose:start ── */'), D1 = source.indexOf('/* ── diagnose:end ── */');
check('diagnoseColor block exists outside the engine block', D0 > s1 && D1 > D0);
const diagnose = D0 > s1 && D1 > D0
  ? new Function(source.slice(s0, s1) + source.slice(D0, D1) + '\nreturn diagnoseColor;')()
  : () => ({ error: 'missing' });
const reasons = {
  '#12345': { error: 'hexLength', n: 5 }, '12345': { error: 'hexLength', n: 5 }, '#1234567': { error: 'hexLength', n: 7 },
  '#1a73eg': { error: 'hexChar', ch: 'g', pos: 7 }, '#1A7 3E8': { error: 'hexChar', ch: ' ', pos: 5 },
  '#１２': { error: 'hexChar', ch: '１', pos: 2 },
  '＃１ａ７３ｅ８': { error: 'fullWidth', value: '#1a73e8' }, 'ｒｇｂ(1 2 3)': { error: 'fullWidth', value: 'rgb(1 2 3)' },
  'blurple': { error: 'unknown' }, 'zz': { error: 'unknown' },
  'rgb(10%, 20, 30%)': { error: 'fnValue', fn: 'rgb', value: '20' }, 'rgb(1 2 3, 4)': { error: 'fnArgs', fn: 'rgb' },
  'rgb(1, 2)': { error: 'fnArgs', fn: 'rgb' }, 'rgb(1 2 3 / 0.5 / 1)': { error: 'fnArgs', fn: 'rgb' },
  'rgb(none, 0, 0)': { error: 'fnValue', fn: 'rgb', value: 'none' }, 'rgb(1deg 2 3)': { error: 'fnValue', fn: 'rgb', value: '1deg' },
  'hwb(200, 10%, 20%)': { error: 'fnArgs', fn: 'hwb' }, 'oklch(50%, 0.1, 20)': { error: 'fnArgs', fn: 'oklch' },
  'hsl(1px 2% 3%)': { error: 'fnValue', fn: 'hsl', value: '1px' }, 'hsl(abc 1% 2%)': { error: 'fnValue', fn: 'hsl', value: 'abc' },
  'hsl(214 82% 51% / x)': { error: 'fnValue', fn: 'hsl', value: 'x' },
  'color(rec2020 1 0 0)': { error: 'space', value: 'rec2020' }, 'color(foo 1 2 3)': { error: 'space', value: 'foo' },
  'color(display-p3 1 0)': { error: 'fnArgs', fn: 'color' }, 'rgb(1 2 3) x': { error: 'trailing', fn: 'rgb', value: 'x' },
  'rgb(1 2 3': { error: 'paren', fn: 'rgb' }, 'url(#a)': { error: 'unsupportedFn', fn: 'url' },
  'lab(50% 20 30)': { error: 'unsupportedFn', fn: 'lab' }, 'oklab(0.5 0.1)': { error: 'fnArgs', fn: 'oklab' },
};
for (const [s, want] of Object.entries(reasons)) {
  check('engine rejects ' + JSON.stringify(s), !!E.parseColor(s).error);
  eq('reason for ' + JSON.stringify(s), diagnose(s), want);
}
// More than four values in the comma form (2026-10-08). The engine's parseColor() reads the first
// four and drops the rest (alpha included), so readColor() (diagnose block) refuses them before
// the page shows a color; diagnoseColor() names the cause. Values with four or fewer still read.
const readColor = D0 > s1 && D1 > D0
  ? new Function(source.slice(s0, s1) + source.slice(D0, D1) + "\nreturn typeof readColor === 'function' ? readColor : () => ({ error: 'missing' });")()
  : () => ({ error: 'missing' });
for (const s of ['rgb(1,2,3,0.5,9)', 'hsl(10,20%,30%,0.5,1)', 'rgba(1, 2, 3, 0.5, 0.2)', 'hsla(10, 20%, 30%, 1, 1, 1)']) {
  check('readColor refuses ' + s, !!readColor(s).error);
  eq('reason for ' + s, diagnose(s), { error: 'fnArgs', fn: /^\w+/.exec(s)[0] });
}
for (const s of ['rgb(1,2,3,0.5)', 'hsl(10,20%,30%)', 'rgba(1, 2, 3, 50%)', '#1a73e8', 'rgb(1 2 3 / 0.5)', 'color(display-p3 1 0 0)']) {
  eq('readColor reads ' + s + ' as parseColor does', readColor(s), E.parseColor(s));
}
// Each reason has a localized message whose placeholders the diagnosis fills.
const reasonKey = (code) => 'err' + code[0].toUpperCase() + code.slice(1);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const want of Object.values(reasons)) {
    const key = want.error === 'unknown' ? 'invalid' : reasonKey(want.error);
    const msg = STRINGS[lang][key];
    check(`${lang} has message ${key}`, typeof msg === 'string' && msg.length > 0);
    const unfilled = (String(msg).match(/\{(\w+)\}/g) || []).filter((ph) => want[ph.slice(1, -1)] === undefined);
    eq(`${lang} ${key} placeholders are all filled`, unfilled, []);
  }
}
// Random edits of valid colors: whenever the engine rejects one, the diagnosis names a known reason.
{
  let seedD = 7, unknownCount = 0, total = 0, badCode = null;
  const r = () => { seedD = (seedD * 1103515245 + 12345) >>> 0; return seedD / 4294967296; };
  const alphabet = '#0123456789abcdefgxyz(),/% .-degturnoklchrgbhslwbcolordisplay-p3';
  const codes = new Set(Object.values(reasons).map((w) => w.error));
  for (let i = 0; i < 4000; i++) {
    const base = valid[Math.floor(r() * valid.length)].split('');
    const op = Math.floor(r() * 3), at = Math.floor(r() * (base.length + 1)), ch = alphabet[Math.floor(r() * alphabet.length)];
    if (op === 0) base.splice(at, 1); else if (op === 1) base.splice(at, 0, ch); else base[at] = ch;
    const s = base.join('');
    if (!s.trim() || !E.parseColor(s).error) continue;
    total++;
    let d;
    try { d = diagnose(s); } catch (e) { d = { error: 'threw ' + e.message }; }
    if (!codes.has(d.error)) badCode = badCode || [s, d];
    if (d.error === 'unknown') unknownCount++;
  }
  check(`random rejected edits (${total}) get a known reason`, badCode === null, JSON.stringify(badCode));
  check(`most random rejected edits get a specific reason (${unknownCount} / ${total} unknown)`, unknownCount < total * 0.2);
}
// The hex messages and codes are the ones Color Palette Generator already uses: same code, count
// and position for the same text, and the same message wording in every language.
{
  const cpalSrc = readFileSync(join(root, 'src/components/tools/ColorPaletteGeneratorTool.astro'), 'utf8');
  const cpal = new Function(cpalSrc.slice(cpalSrc.indexOf('/* ── engine:start ── */'), cpalSrc.indexOf('/* ── engine:end ── */')) + '\nreturn parseColor;')();
  const cpalStrings = new Function(cpalSrc.slice(cpalSrc.indexOf('/* ── strings:start ── */') + '/* ── strings:start ── */'.length, cpalSrc.indexOf('/* ── strings:end ── */')).replace(/^\s*const STRINGS = /, 'return ').replace(/\}\s*as const;\s*$/, '}'))();
  for (const s of ['#12345', '12345', '#1234567', '#1a73eg', '#1A7 3E8', '#12g', '#xyz', '1234567890']) {
    const a = cpal(s), b = diagnose(s);
    eq('same reason as Color Palette Generator for ' + JSON.stringify(s), [b.error, b.n, b.ch, b.pos], [a.error, a.n, a.ch, a.pos]);
  }
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const [mine, theirs] of [['errHexLength', 'err_hexLength'], ['errHexChar', 'err_hexChar'], ['errFnValue', 'err_fnValue']]) {
    eq(`${lang} ${mine} is the Color Palette Generator wording`, STRINGS[lang][mine], cpalStrings[lang][theirs]);
  }
}

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

// ── 10. Examples on the tool pages ──
const pageDir = join(root, 'src/content/tools/eyedropper-color-picker');
let examples = 0;
for (const f of readdirSync(pageDir)) {
  const text = readFileSync(join(pageDir, f), 'utf8');
  const re = /\{\/\* ecp-check: (.+?) => (\w+) => (.+?) \*\/\}/g;
  let m;
  while ((m = re.exec(text))) {
    examples++;
    const got = E.formatColor(E.parseColor(m[1]))[m[2]];
    eq(`${f}: ${m[1]} → ${m[2]}`, got, m[3]);
    check(`${f}: example value ${m[3]} appears in the page`, text.split(m[3]).length > 2);
  }
}
check('tool pages carry checked examples', examples >= 8, examples + ' found');

// ── 11. Complete page lifecycle, with controlled Image and EyeDropper boundaries ──
{
  const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
  const microtasks = async () => { for(let i=0;i<16;i++) await Promise.resolve(); };
  function page(lang='en', shellFirst=false, initial={}) {
    const ids=new Map(),timers=new Map(),images=[],picks=[],saved=[],cleared=[],revoked=[],urls=new Map(),copies=[],observers=[],windowEvents={};
    let seq=0,prefs=structuredClone(initial);
    const doc={listeners:{},activeElement:null};
    function matches(n,s){return s.split(',').some(raw=>{let sel=raw.trim();const attrs=[...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];sel=sel.replace(/\[[^\]]+\]/g,'');const id=/#([\w-]+)/.exec(sel),classes=[...sel.matchAll(/\.([\w-]+)/g)],tag=/^[\w-]+/.exec(sel);return(!id||n.id===id[1])&&classes.every(c=>n.classList.contains(c[1]))&&(!tag||n.tagName===tag[0].toUpperCase())&&attrs.every(a=>a[2]===undefined?n.getAttribute(a[1])!==null:n.getAttribute(a[1])===a[2]);});}
    class Element {
      constructor(tag='div'){Object.assign(this,{tagName:tag.toUpperCase(),id:'',className:'',attributes:{},style:{},children:[],parentNode:null,listeners:{},value:'',type:tag==='input'?'text':'',hidden:false,disabled:false,files:[],clientWidth:300,clientHeight:200});}
      get classList(){const n=this;return{contains:c=>n.className.split(/\s+/).includes(c),add(c){if(!this.contains(c))n.className+=' '+c;},remove(c){n.className=n.className.split(/\s+/).filter(x=>x!==c).join(' ');},toggle(c,on){if(on??!this.contains(c))this.add(c);else this.remove(c);}};}
      setAttribute(k,v){this.attributes[k]=String(v);if(['id','class','type','value'].includes(k))this[k==='class'?'className':k]=String(v);}
      getAttribute(k){return k==='type'?this.type:this.attributes[k]??null;}
      removeAttribute(k){delete this.attributes[k];}
      get textContent(){return(this.text||'')+this.children.map(c=>c.textContent).join('');}
      set textContent(v){if(this.children.some(c=>c.contains(doc.activeElement)))doc.activeElement=doc.body;for(const c of this.children)c.parentNode=null;this.children=[];this.text=String(v);}
      appendChild(n){n.parentNode=this;this.children.push(n);return n;}
      contains(n){return n===this||this.children.some(c=>c.contains(n));}
      querySelectorAll(s){return this.children.flatMap(c=>[...(matches(c,s)?[c]:[]),...c.querySelectorAll(s)]);}
      querySelector(s){return this.querySelectorAll(s)[0]||null;}
      closest(s){for(let p=this;p;p=p.parentNode)if(matches(p,s))return p;return null;}
      addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
      dispatch(type,extra={}){const e={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};for(let p=this;p&&!e.stopped;p=p.parentNode)for(const fn of p.listeners[type]||[])fn(e);return e;}
      click(){if(!this.disabled)this.dispatch('click');}
      focus(){doc.activeElement=this;}
      select(){}
      getBoundingClientRect(){return{left:0,top:0,width:300,height:200,bottom:200};}
    }
    class Canvas extends Element {
      constructor(){super('canvas');this.width=300;this.height=150;this.pixel=[0,0,0,255];this.context={clearRect(){},drawImage:img=>{this.pixel=img.pixel||[0,0,0,255];this.pixelAt=img.pixelAt;},getContextAttributes:()=>({colorSpace:'srgb'}),getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let row=0;row<h;row++)for(let col=0;col<w;col++)data.set(this.pixelAt?this.pixelAt(x+col,y+row):this.pixel,(row*w+col)*4);return{data};},fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};}
      getContext(){return this.context;}
      getBoundingClientRect(){const left=this.rectLeft||0,top=this.rectTop||0,width=parseFloat(this.style.width)||this.width,height=parseFloat(this.style.height)||this.height;return{left,top,width,height,right:left+width,bottom:top+height};}
    }
    const body=new Element('body'),widget=new Element();widget.className='tool-widget';body.appendChild(widget);
    let markup=source.slice(source.indexOf('\n---',4)+4,source.indexOf('<script'));
    const fields=vm.runInNewContext(source.match(/const FIELDS = (.*?);/)[1]);
    markup=markup.replace(/\{FIELDS\.slice\(1\)\.map\(\(f\) => \(([\s\S]*?)\)\)\}/g,(_,template)=>fields.slice(1).map(f=>template.replace(/\{`ecp-\$\{f\}`\}/g,'"ecp-'+f+'"').replace(/data-field=\{f\}/g,'data-field="'+f+'"').replace(/data-copy=\{f\}/g,'data-copy="'+f+'"')).join(''));
    const stack=[widget],voids=new Set(['input','br','hr','img','meta','link']);
    for(const m of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)){const tag=m[1];if(m[0].startsWith('</')){if(stack.at(-1)?.tagName===tag.toUpperCase())stack.pop();continue;}const n=tag==='canvas'?new Canvas():new Element(tag);for(const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g))n.setAttribute(a[1],a[2]);n.hidden=/\bhidden(?=\s|\/|$)/.test(m[2]);n.disabled=/\bdisabled(?=\s|\/|$)/.test(m[2]);stack.at(-1).appendChild(n);if(n.id)ids.set(n.id,n);if(!voids.has(tag)&&!m[2].endsWith('/'))stack.push(n);}
    const get=id=>{if(!ids.has(id))throw new Error('Actual markup ID missing '+id);return ids.get(id);};
    Object.assign(doc,{body,getElementById:get,createElement:tag=>tag==='canvas'?new Canvas():new Element(tag),querySelector:s=>s==='.tool-widget'?widget:s==='.tool-widget .btn-primary'?widget.querySelector('.btn-primary'):widget.querySelector(s),addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},dispatch(type,extra={}){const e={type,target:this.activeElement,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...extra};for(const fn of this.listeners[type]||[])fn(e);return e;},execCommand:()=>false});
    class ControlledImage{set src(url){this.url=url;images.push({image:this,file:urls.get(url)});}}
    class ControlledResizeObserver{constructor(callback){this.callback=callback;this.targets=new Set();observers.push(this);}observe(target){this.targets.add(target);}}
    const context={document:doc,console,t:STRINGS[lang],Image:ControlledImage,ResizeObserver:ControlledResizeObserver,AbortController,Uint8ClampedArray,Promise,innerHeight:900,innerWidth:1366,scrollBy(){},addEventListener(type,fn){(windowEvents[type]??=[]).push(fn);},CSS:{supports:()=>true},
      EyeDropper:class{open(options){const job=deferred();job.options=options;picks.push(job);return job.promise;}},
      navigator:{clipboard:{writeText(text){copies.push(text);return Promise.resolve();}}},
      URL:{createObjectURL(file){const url='blob:fixture-'+(++seq);urls.set(url,file);return url;},revokeObjectURL(url){revoked.push(url);}},
      setTimeout(fn,ms=0){const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
      ztPersist:{load:()=>structuredClone(prefs),save:(slug,value)=>{prefs=structuredClone(value);saved.push({slug,value:structuredClone(value)});},clear:slug=>{prefs={};cleared.push(slug);}},_slug:'eyedropper-color-picker'};
    context.window=context;vm.createContext(context);if(shellFirst)vm.runInContext(shortcut,context);vm.runInContext(pageScript,context);if(!shellFirst)vm.runInContext(shortcut,context);
    function zeros(){for(const[id,t]of[...timers])if(t.ms===0){timers.delete(id);t.fn();}}
    function startFile(name='sample.png'){get('ecp-file').files=[{name,type:'image/png'}];get('ecp-file').dispatch('change');return images.at(-1);}
    function release(job,error=false,fixture={}){if(error)job.image.onerror();else{Object.assign(job.image,{naturalWidth:4,naturalHeight:2,pixel:[255,0,0,255]},fixture);job.image.onload();}}
    function queueResize(width,height){const target=get('ecp-scroller');target.clientWidth=width;target.clientHeight=height;const pending=observers.filter(observer=>observer.targets.has(target));return()=>{for(const observer of pending)observer.callback([{target,contentRect:{width,height}}],observer);};}
    function resize(width,height){queueResize(width,height)();}
    function shortcutClear(inside=true){(inside?get('ecp-hex'):body).focus();return doc.dispatch('keydown',{ctrlKey:true,key:'l'});}
    function snapshot(){return{fields:fields.map(f=>get('ecp-'+f).value),status:get('ecp-status').textContent,viewer:get('ecp-viewer').hidden,drop:get('ecp-drop').hidden,info:get('ecp-imginfo').textContent,pixel:[...get('ecp-canvas').pixel],size:[get('ecp-canvas').width,get('ecp-canvas').height],recent:get('ecp-recent-grid').children.length};}
    function flushAll(){for(let i=0;i<20&&timers.size;i++)for(const[id,t]of[...timers]){timers.delete(id);t.fn();}}
    return{get,doc,picks,images,saved,cleared,revoked,copies,zeros,flushAll,startFile,release,resize,queueResize,shortcutClear,snapshot,windowResize(){for(const fn of windowEvents.resize||[])fn();}};
  }
  const compare=(label,actual,expected)=>eq(label,JSON.stringify(actual),JSON.stringify(expected));
  {
    const p=page();p.release(p.startFile('portrait.png'),false,{naturalWidth:40,naturalHeight:80});
    eq('Fit initially uses available container height',[p.get('ecp-canvas').style.width,p.get('ecp-canvas').style.height],['100px','200px']);
    p.resize(300,120);
    eq('Fit follows a shorter container without a window resize',[p.get('ecp-canvas').style.width,p.get('ecp-canvas').style.height],['60px','120px']);
    p.resize(300,240);
    eq('Fit fills a taller container again',[p.get('ecp-canvas').style.width,p.get('ecp-canvas').style.height],['120px','240px']);
    p.resize(80,240);
    eq('Fit follows container width changes',[p.get('ecp-canvas').style.width,p.get('ecp-canvas').style.height],['80px','160px']);
    p.get('ecp-scroller').clientHeight=100;p.windowResize();
    eq('window resize still updates Fit',[p.get('ecp-canvas').style.width,p.get('ecp-canvas').style.height],['50px','100px']);
  }
  {
    const p=page(),canvas=p.get('ecp-canvas'),marker=p.get('ecp-marker');
    // Pixel (10,20) is RGB(40,40,0) in this independent 40×80 source image.
    p.release(p.startFile('coordinates.png'),false,{naturalWidth:40,naturalHeight:80,pixelAt:(x,y)=>[x*4,y*2,0,255]});
    canvas.rectLeft=11;canvas.rectTop=23;
    canvas.dispatch('pointerup',{pointerType:'mouse',button:0,clientX:37.25,clientY:74.25});
    eq('Fit pointer picks the original image pixel',p.get('ecp-hex').value,'#282800');
    p.get('ecp-p3').value='color(display-p3 1 0 0)';p.get('ecp-p3').dispatch('input');
    check('typed P3 color exposes the actual layout-changing note',!p.get('ecp-note').hidden);
    const before=p.snapshot(),saved=structuredClone(p.saved);
    p.resize(300,120);
    compare('container resize leaves current fields and image state untouched',p.snapshot(),before);
    compare('container resize leaves stored preferences untouched',p.saved,saved);
    close('container resize keeps the marker on the selected source pixel',[parseFloat(marker.style.left),parseFloat(marker.style.top)],[26.25,25.625],1e-10);
    canvas.dispatch('pointerup',{pointerType:'mouse',button:0,clientX:26.75,clientY:53.75});
    eq('resized Fit pointer still selects the same source pixel',p.get('ecp-hex').value,'#282800');
    p.get('ecp-wrap').querySelector('[data-zoom="actual"]').click();
    p.resize(30,50);
    eq('Actual size stays one CSS pixel per source pixel after resize',[canvas.style.width,canvas.style.height],['40px','80px']);
    check('Actual size keeps its scrollable mode',p.get('ecp-scroller').classList.contains('is-actual'));
    canvas.dispatch('pointerup',{pointerType:'mouse',button:0,clientX:21.5,clientY:43.5});
    eq('Actual size pointer selects the same source pixel',p.get('ecp-hex').value,'#282800');
    p.get('ecp-wrap').querySelector('[data-zoom="fit"]').click();
    eq('switching back to Fit uses the current container',[canvas.style.width,canvas.style.height],['25px','50px']);
  }
  for(const action of ['close','clear','shortcut']){
    const p=page();p.release(p.startFile());const notify=p.queueResize(100,120);
    if(action==='shortcut'){p.shortcutClear();p.zeros();}else p.get(action==='close'?'ecp-close':'ecp-clear').click();
    const before=p.snapshot(),saved=structuredClone(p.saved);notify();
    compare(`queued resize after ${action} cannot restore image or color`,p.snapshot(),before);
    compare(`queued resize after ${action} does not write preferences`,p.saved,saved);
  }
  // Typed values: an invalid value in one field must not leave the previous color in the others.
  // Before 2026-10-07, #1a73e8 then #12345 in HEX kept rgb(26, 115, 232), hsl(…), oklch(…) and
  // color(display-p3 …) in the other fields with working Copy buttons, and every reason showed
  // the same sentence.
  const ALL=['hex','rgb','hsl','oklch','p3'];
  for(const lang of ['en','zh','ja','ko'])for(const field of ['hex','rgb','p3']){
    const p=page(lang),el=p.get('ecp-'+field),others=ALL.filter(f=>f!==field);
    const copyBtns=()=>p.get('ecp-wrap').querySelectorAll('[data-copy]');
    const enabled=()=>copyBtns().filter(b=>!b.disabled).map(b=>b.getAttribute('data-copy'));
    eq(`${lang} ${field}: initial fields filled`,ALL.map(f=>p.get('ecp-'+f).value).every(Boolean),true);
    eq(`${lang} ${field}: initial copy buttons enabled`,enabled().length,5);
    for(const bad of ['#12345','rgb(1, 2)','zz','hsl(abc 1% 2%)','color(foo 1 2 3)','＃１ａ７３ｅ８','rgb(1,2,3,0.5,9)','hsl(10,20%,30%,0.5,1)']){
      el.value='#1a73e8';el.dispatch('input');p.flushAll();
      el.value=bad;el.dispatch('input');
      eq(`${lang} ${field} "${bad}": other fields cleared at once`,others.map(f=>p.get('ecp-'+f).value),others.map(()=>''));
      eq(`${lang} ${field} "${bad}": typed text kept`,el.value,bad);
      eq(`${lang} ${field} "${bad}": no copy button enabled`,enabled(),[]);
      eq(`${lang} ${field} "${bad}": swatch emptied`,p.get('ecp-swatch-fill').style.background,'');
      eq(`${lang} ${field} "${bad}": field marked invalid`,el.getAttribute('aria-invalid'),'true');
      const before=p.copies.length;copyBtns().forEach(b=>b.click());
      eq(`${lang} ${field} "${bad}": copy buttons copy nothing`,p.copies.length,before);
      p.flushAll();
      const d=diagnose(bad),key=d.error==='unknown'?'invalid':reasonKey(d.error);
      const msg=String(STRINGS[lang][key]??'(missing '+key+')').replace(/\{(\w+)\}/g,(m,k)=>d[k]!==undefined?String(d[k]):m);
      eq(`${lang} ${field} "${bad}": status names the reason after the pause`,p.get('ecp-status').textContent,msg);
      el.dispatch('change');
      eq(`${lang} ${field} "${bad}": status names the reason on change`,p.get('ecp-status').textContent,msg);
      check(`${lang} ${field} "${bad}": status is an error`,p.get('ecp-status').className.includes('is-error'));
    }
    el.value='rgb(255 0 0)';el.dispatch('input');p.flushAll();
    eq(`${lang} ${field}: valid value restores the other fields`,p.get('ecp-'+(field==='hex'?'rgb':'hex')).value,field==='hex'?'rgb(255, 0, 0)':'#ff0000');
    eq(`${lang} ${field}: valid value re-enables every copy button`,enabled().length,5);
    eq(`${lang} ${field}: valid value clears the error`,[p.get('ecp-status').textContent,el.getAttribute('aria-invalid')],['',null]);
    el.value='';el.dispatch('input');p.flushAll();
    eq(`${lang} ${field}: empty field clears the others without an error`,[others.map(f=>p.get('ecp-'+f).value),p.get('ecp-status').textContent,enabled()],[others.map(()=>''),'',[]]);
    el.value='zz';el.dispatch('input');
    p.get('ecp-native').value='#00ff00';p.get('ecp-native').dispatch('input');
    eq(`${lang} ${field}: color dialog after an error refills every field`,p.get('ecp-hex').value,'#00ff00');
    eq(`${lang} ${field}: color dialog clears the pending error`,[p.get('ecp-status').textContent,el.getAttribute('aria-invalid')],['',null]);
    p.flushAll();
    eq(`${lang} ${field}: the pending error message does not come back later`,p.get('ecp-status').textContent,'');
  }
  {
    const p=page();p.get('ecp-clear').click();
    eq('Clear leaves no copy button enabled',p.get('ecp-wrap').querySelectorAll('[data-copy]').filter(b=>!b.disabled).length,0);
  }
  {
    const p=page();p.release(p.startFile('ready.png'));
    check('image positive control opens the actual viewer',!p.get('ecp-viewer').hidden&&p.get('ecp-imginfo').textContent.includes('ready.png'));
    p.get('ecp-pick').click();await microtasks();p.picks[0].resolve({sRGBHex:'#ff0000'});await microtasks();
    eq('screen positive control formats actual result',p.get('ecp-hex').value,'#ff0000');
    eq('screen positive control persists picked recent',p.saved.at(-1).value.recent[0],'#ff0000');
    eq('screen positive control re-enables picker',p.get('ecp-pick').disabled,false);
  }
  for(const shellFirst of [false,true])for(const action of ['clear','shortcut','close','new'])for(const error of [false,true]){
    const p=page('en',shellFirst),old=p.startFile('old.png');
    if(action==='clear')p.get('ecp-clear').click();if(action==='shortcut'){p.shortcutClear();p.zeros();}if(action==='close')p.get('ecp-close').click();if(action==='new')p.release(p.startFile('new.png'));
    const before=p.snapshot();p.release(old,error);
    compare(`image late ${error?'error':'load'} after ${action}, shellFirst=${shellFirst}`,p.snapshot(),before);
    check(`stale image URL revoked after ${action}, shellFirst=${shellFirst}, error=${error}`,p.revoked.includes(old.image.url));
  }
  for(const shellFirst of [false,true])for(const error of [false,true]){
    const p=page('en',shellFirst),old=p.startFile('before-timer.png');p.shortcutClear();const before=p.snapshot();p.release(old,error);
    compare(`shortcut cancels image before 0ms cleanup, shellFirst=${shellFirst}, error=${error}`,p.snapshot(),before);p.zeros();
  }
  {
    const p=page();p.get('ecp-pick').click();p.get('ecp-clear').click();await microtasks();
    eq('clear before picker microtask prevents opening system UI',p.picks.length,0);
  }
  for(const lang of ['en','zh','ja','ko'])for(const shellFirst of [false,true])for(const action of ['clear','shortcut'])for(const reject of [false,true]){
    const p=page(lang,shellFirst,{sample:3,recent:['#00ff00']});p.get('ecp-pick').click();await microtasks();const job=p.picks[0];
    if(action==='clear')p.get('ecp-clear').click();else p.shortcutClear();
    if(reject)job.reject({name:'OperationError',message:'old'});else job.resolve({sRGBHex:'#ff0000'});await microtasks();
    // A promise callback can run before the deferred shared-shortcut cleanup timer.
    eq(`${lang} late screen cannot persist after ${action}, shellFirst=${shellFirst}, reject=${reject}`,p.saved.length,0);
    check(`${lang} cleared pending screen is aborted after ${action}`,job.options?.signal?.aborted===true);
    p.zeros();
    compare(`${lang} late screen cannot refill fields after ${action}`,p.snapshot().fields,['','','','','']);
    eq(`${lang} late screen cannot refill status after ${action}`,p.snapshot().status,'');
    eq(`${lang} clear unlocks screen button`,p.get('ecp-pick').disabled,false);
  }
  for(const reject of [false,true]){
    const p=page();p.get('ecp-pick').click();await microtasks();const old=p.picks[0];p.get('ecp-clear').click();p.get('ecp-pick').click();await microtasks();
    eq('clear permits a new screen request',p.picks.length,2);
    if(reject)old.reject({name:'AbortError'});else old.resolve({sRGBHex:'#ff0000'});await microtasks();
    check('old screen completion cannot unlock new screen',p.get('ecp-pick').disabled);
    if(p.picks[1]){p.picks[1].resolve({sRGBHex:'#0000ff'});await microtasks();eq('new screen request remains usable',p.get('ecp-hex').value,'#0000ff');}
  }
  {
    const p=page(),old=p.startFile('still-valid.png');p.shortcutClear(false);p.zeros();p.release(old);
    check('outside shortcut leaves pending image valid',!p.get('ecp-viewer').hidden);
    eq('outside shortcut leaves persistence untouched',p.cleared.length,0);
    p.get('ecp-pick').click();await microtasks();p.picks[0].reject({name:'AbortError'});await microtasks();
    eq('active user-canceled picker reports localized status',p.get('ecp-status').textContent,STRINGS.en.canceled);
    eq('active rejection unlocks the screen button',p.get('ecp-pick').disabled,false);
  }
}

// ── v2 page layout ──
{
  const before={passes,failures};
  const template=source.slice(source.indexOf('\n---\n')+5,source.indexOf('<script')).trim();
  const css=source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g,'').replace(/<\/?style\b[^>]*>/g,'');
  const rules=selector=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m=>m[1].split(',').some(s=>s.trim()===selector)).map(m=>m[2]);
  const prop=(body,key,value)=>new RegExp('(?:^|;)\\s*'+key+'\\s*:\\s*'+value+'\\s*(?:;|$)').test(body);
  check('analyze layout registered',/'eyedropper-color-picker':\s*'analyze'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
  check('direct tool root',/^<div class="ecp-wrap" id="ecp-wrap">/.test(template));
  check('root flex column can shrink',rules('.ecp-wrap').some(r=>prop(r,'display','flex')&&prop(r,'flex-direction','column')&&prop(r,'min-height','0')));
  check('shared empty drop area fills input',/class="ecp-drop zt-empty-drop"/.test(template));
  check('image result uses full width with zero-basis growth',rules('.ecp-image').some(r=>prop(r,'flex','1\\s+1\\s+0')&&prop(r,'min-width','0')&&prop(r,'min-height','280px')));
  check('image preview has positive internal scroll area',rules('.ecp-scroller').some(r=>prop(r,'flex','1\\s+1\\s+0')&&prop(r,'overflow','auto')&&prop(r,'min-height','120px')));
  check('phone image area has fixed height for short and large images',rules('.ecp-image').some(r=>prop(r,'flex','none')&&prop(r,'height','25rem')&&prop(r,'min-height','0')));
  check('status height remains reserved',rules('.ecp-status').some(r=>prop(r,'height','3em')&&prop(r,'overflow','auto'))&&!css.includes('.ecp-status:empty'));
  check('actions, editable color and status precede image',template.indexOf('id="ecp-pick"')<template.indexOf('id="ecp-hex"')&&template.indexOf('id="ecp-hex"')<template.indexOf('id="ecp-status"')&&template.indexOf('id="ecp-status"')<template.indexOf('id="ecp-image"'));
  check('mobile uses 860 and 640 breakpoints',/@media\s*\(max-width:\s*860px\)/.test(css)&&/@media\s*\(max-width:\s*640px\)/.test(css));
  check('hidden image and controls stay hidden',/\.ecp-wrap \[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css));
  check('unsupported screen tip hides with its unavailable control',rules('.ecp-control:has(#ecp-pick[hidden])').some(r=>prop(r,'display','none')));
  check('dynamic recent colors remain globally styled',css.includes(':global(.ecp-chip)')&&css.includes(':global(.ecp-chip-fill)'));
  check('storage consequence remains directly visible',/<p class="ecp-recent-note">\{L.recentNote\}<\/p>/.test(template));
  check('only client strings are serialized',/define:vars=\{\{ t: CLIENT_T \}\}/.test(source)&&!source.slice(source.indexOf('<script')).includes('t.tips'));
  check('UI has no runtime i18n rewriting',!source.includes('data-i18n'));
  const buttons=[...template.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);
  const identity=a=>/\bid="([^"]+)"/.exec(a)?.[1]||/data-zoom="([^"]+)"/.exec(a)?.[1]||/data-copy="([^"]+)"/.exec(a)?.[1]||(/data-copy=\{f\}/.test(a)?'mapped format':'unknown');
  eq('all existing button identities retained',buttons.map(identity).sort(),['ecp-pick','ecp-open','ecp-dialog','ecp-clear','fit','actual','ecp-close','hex','mapped format','ecp-copy-all','ecp-recent-clear'].sort());
  const keys=['screen','open','dialog','clear','pixel','sample','zoom','color','copy','recent'].sort();
  const tips=[...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  eq('ten control tip IDs',tips.map(m=>/id="ecp-tip-([^"]+)"/.exec(m[1])?.[1]).sort(),keys);
  for(const tip of tips){const key=/id="ecp-tip-([^"]+)"/.exec(tip[1])[1];check(key+' tip is localized',/lang=\{lang\}/.test(tip[1])&&/about=\{L\.\w+\}/.test(tip[1])&&tip[2]==='{TIPS.'+key+'}');}
  // FAQ / step hashes updated 2026-10-07: the storage answer now names both saved settings and
  // the color-field step says what happens to an invalid value. The body hash is unchanged.
  // The storage answer must list what the code saves (W6): recent colors and the sample size.
  const savedKeys=/ztPersist\.save\(SLUG, \{ (recent): [^,]+, (sample): [^}]+\}\)/.exec(source);
  eq('page saves exactly recent colors and sample size',savedKeys&&[savedKeys[1],savedKeys[2]],['recent','sample']);
  const sampleWords={en:'sample size',zh:'取样大小',ja:'サンプルの大きさ',ko:'샘플 크기'};
  for(const lang of langs){
    const faq=loadYaml(/^---\n([\s\S]*?)\n---/.exec(readFileSync(join(pageDir,lang+'.mdx'),'utf8'))[1]).faqItems.map(f=>f.answer).filter(a=>a.includes('localStorage')).join('\n');
    check(lang+' storage answer names the sample size',faq.includes('localStorage')&&faq.includes(sampleWords[lang]));
    check(lang+' storage answer no longer says only HEX is kept',!/Only the last 16|だけで、|값\(이 브라우저의 localStorage\)뿐/.test(faq));
    check(lang+' recent note names the sample size',STRINGS[lang].recentNote.includes(sampleWords[lang]));
  }
  for(const lang of langs){
    const strings=STRINGS[lang];eq(lang+' tip keys match',Object.keys(strings.tips).sort(),keys);
    for(const key of keys)check(lang+'.'+key+' tip nonempty plain text',typeof strings.tips[key]==='string'&&strings.tips[key].length>0&&!/<[^>]*>|\n/.test(strings.tips[key]));
    const client=vm.runInNewContext(source.slice(source.indexOf('const L = STRINGS[lang];'),source.indexOf('const FIELDS = '))+';({TIPS,CLIENT_T})',{STRINGS,lang});
    eq(lang+' client excludes only tips',Object.keys(client.CLIENT_T).sort(),Object.keys(strings).filter(k=>k!=='tips').sort());
    check(lang+' tip text is absent from client JSON',Object.values(client.TIPS).every(tip=>!JSON.stringify(client.CLIENT_T).includes(JSON.stringify(tip))));
    const mdx=readFileSync(join(pageDir,lang+'.mdx'),'utf8'),[,meta,body]=/^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx),{steps}=loadYaml(meta);
    check(lang+' steps plain text within limits',Array.isArray(steps)&&steps.length>0&&steps.length<=8&&steps.every(s=>typeof s==='string'&&s.trim()&&s.length<=280&&!/<[^>]*>/.test(s))&&steps.join('').length<=1200);
    check(lang+' usage removed and limits retained',!/^## (How to pick a color|三种取色方式|使い方|추출 순서)$/m.test(body)&&/^## (Limits|限制|制限|제한)$/m.test(body));
    eq(lang+' MDX content contract', contractProblems('eyedropper-color-picker', lang), '');
  }
  console.log(`v2 page layout: ${passes-before.passes} passed, ${failures-before.failures} failed`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
