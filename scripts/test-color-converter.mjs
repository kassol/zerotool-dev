// Color Converter — HEX / RGB / HSL engine
//
// Read:  src/components/tools/ColorConverterTool.astro (runs the real conversion functions between
//        the `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// CSS Color 4 §7 (HSL): the hue is an angle and wraps around the circle; saturation and lightness
// clamp to 0–100%. Before the fix hsl(720, 100%, 50%) came out black and saturation above 100%
// produced RGB channels above 255 (an invalid hex string). Values in this file are the CSS named
// colors from CSS Color 4 §6.1 and the examples quoted on the English tool page.
//
// Run: node scripts/test-color-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorConverterTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in ColorConverterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(start, end) + '\nreturn { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, parseRgb, parseHsl };')();

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function hslToHex(str) {
  const h = E.parseHsl(str);
  if (!h) return null;
  const c = E.hslToRgb(h.h, h.s, h.l);
  return E.rgbToHex(c.r, c.g, c.b);
}
function hexToHsl(hex) {
  const c = E.hexToRgb(hex);
  const h = E.rgbToHsl(c.r, c.g, c.b);
  return `hsl(${h.h}, ${h.s}%, ${h.l}%)`;
}

// Named colors (CSS Color 4 §6.1) and their HSL forms.
const named = [
  ['#008000', 'hsl(120, 100%, 25%)'], ['#ff0000', 'hsl(0, 100%, 50%)'], ['#ffffff', 'hsl(0, 0%, 100%)'],
  ['#000000', 'hsl(0, 0%, 0%)'], ['#808080', 'hsl(0, 0%, 50%)'], ['#0000ff', 'hsl(240, 100%, 50%)'],
];
for (const [hex, hsl] of named) {
  check(`${hex} → ${hsl}`, hexToHsl(hex) === hsl, hexToHsl(hex));
  check(`${hsl} → ${hex}`, hslToHex(hsl) === hex, hslToHex(hsl));
}

// Page examples.
const c = E.hexToRgb('#1a73e8');
check('#1a73e8 → rgb(26, 115, 232)', c.r === 26 && c.g === 115 && c.b === 232, JSON.stringify(c));
check('#1a73e8 → hsl(214, 82%, 51%)', hexToHsl('#1a73e8') === 'hsl(214, 82%, 51%)', hexToHsl('#1a73e8'));
check('hsl(214, 82%, 51%) → #1c74e9 (rounding)', hslToHex('hsl(214, 82%, 51%)') === '#1c74e9', hslToHex('hsl(214, 82%, 51%)'));
check('#f53 expands to #ff5533', JSON.stringify(E.hexToRgb('#f53')) === '{"r":255,"g":85,"b":51}');
check('8-digit hex is rejected', E.hexToRgb('#1a73e880') === null);
check('rgba alpha is ignored', JSON.stringify(E.parseRgb('rgba(26, 115, 232, 0.5)')) === '{"r":26,"g":115,"b":232}');
check('space-separated rgb() is rejected', E.parseRgb('rgb(26 115 232)') === null);
check('channel above 255 is rejected', E.parseRgb('rgb(300, 0, 0)') === null);

// Hue wraps, saturation and lightness clamp (CSS Color 4 §7).
check('hsl(720, 100%, 50%) is red', hslToHex('hsl(720, 100%, 50%)') === '#ff0000', hslToHex('hsl(720, 100%, 50%)'));
check('hsl(360, 100%, 50%) is red', hslToHex('hsl(360, 100%, 50%)') === '#ff0000', hslToHex('hsl(360, 100%, 50%)'));
check('hsl(480, 100%, 25%) equals hsl(120, 100%, 25%)', hslToHex('hsl(480, 100%, 25%)') === '#008000', hslToHex('hsl(480, 100%, 25%)'));
check('saturation above 100% clamps', hslToHex('hsl(0, 150%, 50%)') === '#ff0000', hslToHex('hsl(0, 150%, 50%)'));
check('lightness above 100% clamps to white', hslToHex('hsl(0, 100%, 130%)') === '#ffffff', hslToHex('hsl(0, 100%, 130%)'));

// Every hex value round-trips through RGB, and every HSL output is a valid 6-digit hex.
let rt = 0, bad = 0;
for (let i = 0; i < 20000; i++) {
  const n = Math.floor(Math.random() * 0x1000000);
  const hex = '#' + n.toString(16).padStart(6, '0');
  const rgb = E.hexToRgb(hex);
  if (E.rgbToHex(rgb.r, rgb.g, rgb.b) !== hex) rt++;
  const h = E.rgbToHsl(rgb.r, rgb.g, rgb.b);
  const back = E.hslToRgb(h.h, h.s, h.l);
  if (!/^#[0-9a-f]{6}$/.test(E.rgbToHex(back.r, back.g, back.b))) bad++;
}
check('20,000 random hex values round-trip through RGB', rt === 0, rt);
check('HSL output always converts back to a valid hex', bad === 0, bad);
for (let h = -720; h <= 720; h += 37) for (const s of [-20, 0, 55, 100, 180]) for (const l of [-5, 0, 40, 100, 140]) {
  const x = E.hslToRgb(h, s, l);
  check(`hsl(${h}, ${s}%, ${l}%) channels in range`, [x.r, x.g, x.b].every((v) => v >= 0 && v <= 255), JSON.stringify(x));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
