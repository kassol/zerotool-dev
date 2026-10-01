// CSS Filter Generator — value clamping and filter string
//
// Read:  src/components/tools/CssFilterGeneratorTool.astro (runs the real DEFAULTS, clampValue() and
//        buildFilter() between the `engine:start` / `engine:end` markers)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the slider handler used `parseFloat(v) || default`, so moving Brightness, Contrast,
// Opacity or Saturate to 0 snapped back to 100%. The filter string keeps the function order of the
// Filter Effects Level 1 list and omits functions at their default value; the strings checked here are
// the examples quoted on the English tool page.
//
// Run: node scripts/test-css-filter-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssFilterGeneratorTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in CssFilterGeneratorTool.astro');
  process.exit(1);
}
const make = new Function('state', source.slice(start, end) + '\nreturn { DEFAULTS, clampValue, buildFilter };');

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const probe = make({});
const keys = Object.keys(probe.DEFAULTS);
function filterOf(overrides) {
  const state = {};
  for (const k of keys) state[k] = probe.DEFAULTS[k].default;
  Object.assign(state, overrides);
  return make(state).buildFilter();
}

for (const k of keys) {
  check(`${k}: slider value "0" stays 0`, probe.clampValue(k, '0') === 0, probe.clampValue(k, '0'));
  check(`${k}: empty field falls back to the default`, probe.clampValue(k, '') === probe.DEFAULTS[k].default);
  check(`${k}: value above the maximum is clamped`, probe.clampValue(k, String(probe.DEFAULTS[k].max + 50)) === probe.DEFAULTS[k].max);
  check(`${k}: negative value is clamped to the minimum`, probe.clampValue(k, '-5') === probe.DEFAULTS[k].min);
}
check('blur keeps one decimal', probe.clampValue('blur', '2.5') === 2.5);

check('all defaults → none', filterOf({}) === 'none', filterOf({}));
check('brightness 0 is written', filterOf({ brightness: 0 }) === 'brightness(0%)', filterOf({ brightness: 0 }));
check('opacity 0 is written', filterOf({ opacity: 0 }) === 'opacity(0%)', filterOf({ opacity: 0 }));
check('hover example', filterOf({ grayscale: 100, contrast: 110 }) === 'contrast(110%) grayscale(100%)', filterOf({ grayscale: 100, contrast: 110 }));
check('dark-mode example', filterOf({ invert: 100, 'hue-rotate': 180 }) === 'hue-rotate(180deg) invert(100%)', filterOf({ invert: 100, 'hue-rotate': 180 }));
check('fixed function order', filterOf({ sepia: 60, blur: 1.5, saturate: 140 }) === 'blur(1.5px) saturate(140%) sepia(60%)', filterOf({ sepia: 60, blur: 1.5, saturate: 140 }));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
