// Aspect Ratio Calculator — ratio display, locked ratio, presets and resize fields
//
// Read:  src/components/tools/AspectRatioTool.astro (runs the page script against a small
//        stand-in for the elements it reads)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the simplified ratio and the 4-decimal value; Lock Ratio keeps the ratio that was
// locked, so typing several widths in a row does not drift (the ratio used to be recomputed
// from each rounded height: 1920×1080 → width 1000 → 563 → width 1920 → 1081); presets set
// 120 × the ratio numbers; the resize fields round to whole pixels; the examples on the
// English page.
//
// Run: node scripts/test-aspect-ratio.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AspectRatioTool.astro'), 'utf8');
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in AspectRatioTool.astro');
  process.exit(1);
}

function makePage() {
  const els = {};
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', checked: false, textContent: '', className: '', style: {},
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
        getAttribute(name) { return this.attrs ? this.attrs[name] : null; },
        classList: { add() {}, remove() {} },
      };
    }
    return els[id];
  }
  const chips = [[16, 9], [4, 3], [21, 9], [1, 1], [9, 16], [3, 2], [2, 3]].map(([w, h]) => {
    const c = el('chip-' + w + 'x' + h);
    c.attrs = { 'data-w': String(w), 'data-h': String(h) };
    return c;
  });
  const document = {
    documentElement: { lang: 'en' },
    getElementById: el,
    querySelectorAll(sel) { return sel === '.ar-chip' ? chips : []; },
  };
  new Function('document', 'window', scriptMatch[1])(document, {});
  return {
    els: el,
    type(id, v) { el(id).value = String(v); el(id).fire('input'); },
    lock(on) { el('ar-lock').checked = on; el('ar-lock').fire('change'); },
    preset(w, h) { el('chip-' + w + 'x' + h).fire('click'); },
    ratio() { return el('ar-ratio').textContent; },
    decimal() { return el('ar-decimal').textContent; },
  };
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

let p = makePage();
eq('initial ratio', p.ratio(), '16:9');
eq('initial decimal', p.decimal(), '1.7778');

for (const [w, h, r, d] of [
  [2560, 1080, '64:27', '2.3704'],
  [3440, 1440, '43:18', '2.3889'],
  [1366, 768, '683:384', '1.7786'],
  [1080, 1350, '4:5', '0.8000'],
  [1170, 2532, '195:422', '0.4621'],
]) {
  p = makePage();
  p.type('ar-width', w);
  p.type('ar-height', h);
  eq(`${w}x${h} ratio`, p.ratio(), r);
  eq(`${w}x${h} decimal`, p.decimal(), d);
}

// lock keeps the original ratio
p = makePage();
p.lock(true);
p.type('ar-width', 1000);
eq('locked: width 1000', p.els('ar-height').value, 563);
p.type('ar-width', 1920);
eq('locked: back to 1920 does not drift', p.els('ar-height').value, 1080);
p.type('ar-height', 720);
eq('locked: height 720', p.els('ar-width').value, 1280);
p.lock(false);
p.type('ar-width', 1000);
eq('unlocked: height stays', p.els('ar-height').value, '720');
eq('unlocked: ratio follows inputs', p.ratio(), '25:18');

// presets
p = makePage();
p.preset(21, 9);
eq('preset 21:9 width', p.els('ar-width').value, 2520);
eq('preset 21:9 height', p.els('ar-height').value, 1080);
eq('preset 21:9 ratio', p.ratio(), '7:3');

// resize fields
p = makePage();
p.type('ar-new-width', 1280);
eq('resize 1280 wide', p.els('ar-new-height').value, 720);
p.type('ar-new-width', 1000);
eq('resize 1000 wide rounds 562.5 up', p.els('ar-new-height').value, 563);
p.type('ar-new-height', 2160);
eq('resize 2160 high', p.els('ar-new-width').value, 3840);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
