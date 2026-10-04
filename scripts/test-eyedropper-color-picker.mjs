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
    const ids=new Map(),timers=new Map(),images=[],picks=[],saved=[],cleared=[],revoked=[],urls=new Map(),copies=[];
    let seq=0,prefs=structuredClone(initial);
    const doc={listeners:{},activeElement:null};
    function matches(n,s){return s.split(',').some(raw=>{let sel=raw.trim();const attrs=[...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];sel=sel.replace(/\[[^\]]+\]/g,'');const id=/#([\w-]+)/.exec(sel),classes=[...sel.matchAll(/\.([\w-]+)/g)],tag=/^[\w-]+/.exec(sel);return(!id||n.id===id[1])&&classes.every(c=>n.classList.contains(c[1]))&&(!tag||n.tagName===tag[0].toUpperCase())&&attrs.every(a=>a[2]===undefined?n.getAttribute(a[1])!==null:n.getAttribute(a[1])===a[2]);});}
    class Element {
      constructor(tag='div'){Object.assign(this,{tagName:tag.toUpperCase(),id:'',className:'',attributes:{},style:{},children:[],parentNode:null,listeners:{},value:'',type:tag==='input'?'text':'',hidden:false,disabled:false,files:[],clientWidth:300,clientHeight:200});}
      get classList(){const n=this;return{contains:c=>n.className.split(/\s+/).includes(c),add(c){if(!this.contains(c))n.className+=' '+c;},remove(c){n.className=n.className.split(/\s+/).filter(x=>x!==c).join(' ');},toggle(c,on){if(on??!this.contains(c))this.add(c);else this.remove(c);}};}
      setAttribute(k,v){this.attributes[k]=String(v);if(['id','class','type','value'].includes(k))this[k==='class'?'className':k]=String(v);}
      getAttribute(k){return k==='type'?this.type:this.attributes[k]??null;}
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
      constructor(){super('canvas');this.width=300;this.height=150;this.pixel=[0,0,0,255];this.context={clearRect(){},drawImage:img=>{this.pixel=img.pixel||[0,0,0,255];},getContextAttributes:()=>({colorSpace:'srgb'}),getImageData:(x,y,w,h)=>{const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4)data.set(this.pixel,i);return{data};},fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}};}
      getContext(){return this.context;}
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
    const context={document:doc,console,t:STRINGS[lang],Image:ControlledImage,AbortController,Uint8ClampedArray,Promise,innerHeight:900,innerWidth:1366,scrollBy(){},addEventListener(){},CSS:{supports:()=>true},
      EyeDropper:class{open(options){const job=deferred();job.options=options;picks.push(job);return job.promise;}},
      navigator:{clipboard:{writeText(text){copies.push(text);return Promise.resolve();}}},
      URL:{createObjectURL(file){const url='blob:fixture-'+(++seq);urls.set(url,file);return url;},revokeObjectURL(url){revoked.push(url);}},
      setTimeout(fn,ms=0){const id=++seq;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
      ztPersist:{load:()=>structuredClone(prefs),save:(slug,value)=>{prefs=structuredClone(value);saved.push({slug,value:structuredClone(value)});},clear:slug=>{prefs={};cleared.push(slug);}},_slug:'eyedropper-color-picker'};
    context.window=context;vm.createContext(context);if(shellFirst)vm.runInContext(shortcut,context);vm.runInContext(pageScript,context);if(!shellFirst)vm.runInContext(shortcut,context);
    function zeros(){for(const[id,t]of[...timers])if(t.ms===0){timers.delete(id);t.fn();}}
    function startFile(name='sample.png'){get('ecp-file').files=[{name,type:'image/png'}];get('ecp-file').dispatch('change');return images.at(-1);}
    function release(job,error=false){if(error)job.image.onerror();else{Object.assign(job.image,{naturalWidth:4,naturalHeight:2,pixel:[255,0,0,255]});job.image.onload();}}
    function shortcutClear(inside=true){(inside?get('ecp-hex'):body).focus();return doc.dispatch('keydown',{ctrlKey:true,key:'l'});}
    function snapshot(){return{fields:fields.map(f=>get('ecp-'+f).value),status:get('ecp-status').textContent,viewer:get('ecp-viewer').hidden,drop:get('ecp-drop').hidden,info:get('ecp-imginfo').textContent,pixel:[...get('ecp-canvas').pixel],size:[get('ecp-canvas').width,get('ecp-canvas').height],recent:get('ecp-recent-grid').children.length};}
    return{get,doc,picks,images,saved,cleared,revoked,copies,zeros,startFile,release,shortcutClear,snapshot};
  }
  const compare=(label,actual,expected)=>eq(label,JSON.stringify(actual),JSON.stringify(expected));
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

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
