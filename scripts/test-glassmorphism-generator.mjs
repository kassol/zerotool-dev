// Read the real component and tool pages; write stdout only.
// Public boundaries: color input, CSS/Tailwind output, preview pixels → contrast.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from 'tailwindcss';
import { transform } from 'esbuild';
const source = readFileSync(new URL('../src/components/tools/GlassmorphismGeneratorTool.astro', import.meta.url), 'utf8');
const engine = source.split('// engine:start')[1].split('// engine:end')[0];
const ctx = vm.createContext({});
vm.runInContext(engine, ctx);
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
test('3-digit HEX expands without a hash', () => {
  const color = ctx.parseColor('abc');
  assert.equal(color.hex, '#aabbcc');
});
test('invalid input reports character position and prevents stale output', () => {
  assert.equal(ctx.parseColor('#abz123').error, 'character');
  assert.equal(ctx.parseColor('#abz123').position, 3);
  assert.equal(ctx.parseColor('#1234').error, 'length');
  assert.doesNotMatch(source, /maxlength="7"/);
  assert.match(source, /copyBtn.disabled = true/);
});
const defaults = { bg: '#ffffff', alpha: 15, blur: 12, saturation: 180, border: '#ffffff', borderAlpha: 30, borderWidth: 1, radius: 16, shadow: '#000000', shadowAlpha: 20, text: '#111111', fallback: '#ffffff', opaque: false };
test('CSS starts opaque, enhances in @supports, and restores opaque accessibility states', () => {
  const css = ctx.exportCode(defaults, 'css');
  assert.ok(css.indexOf('background: #ffffff') < css.indexOf('@supports'));
  assert.match(css, /blur\(12px\) saturate\(180%\)/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /background: Canvas/);
  assert.match(css, /color: CanvasText/);
  assert.match(css, /\.glass\.glass-opaque/);
  assert.doesNotMatch(ctx.exportCode({ ...defaults, opaque: true }, 'css'), /blur\(12px\)/);
});
test('actual preview pixels include worst point and alpha compositing in all three states', () => {
  const pixels = [0,0,0,255, 255,255,255,255];
  const result = ctx.worstContrast(pixels, '#ffffff', 50, '#000000');
  // WCAG relative luminance of encoded sRGB 0.5 = 0.2140411405.
  assert.ok(Math.abs(result.ratio - 5.2808228) < 0.001);
  assert.equal(result.pixel, 0);
  assert.equal(result.aa, true);
  assert.equal(ctx.worstContrast(pixels, '#ffffff', 100, '#000000').ratio, 21);
  assert.equal(ctx.worstContrast(pixels, '#ffffff', 0, '#ffffff').ratio, 1);
});
test('forced colors also overrides the explicit opaque class', () => {
  assert.match(ctx.exportCode(defaults, 'css'), /@media \(forced-colors: active\) \{\n  \.glass, \.glass\.glass-opaque/);
  assert.match(ctx.exportCode(defaults, 'tailwind'), /@media \(forced-colors: active\) \{\n    &, &\.glass-opaque/);
});
const tw = await compile('@tailwind utilities;\n' + ctx.exportCode(defaults, 'tailwind'));
const compiled = tw.build(['glass']);
test('Tailwind v4 actually emits the utility and its state rules', () => {
  assert.match(compiled, /\.glass/);
  assert.match(compiled, /blur\(12px\) saturate\(180%\)/);
  assert.match(compiled, /forced-colors: active/);
  assert.doesNotMatch(compiled, /@utility/);
});
for (const format of ['css', 'tailwind']) {
  const css = format === 'css' ? ctx.exportCode(defaults, format) : compiled;
  const result = await transform(css, { loader: 'css', target: 'chrome100' });
  test(`${format} compiles without CSS warnings`, () => {
    assert.equal(result.warnings.length, 0);
    assert.match(result.code, /\.glass\.glass-opaque/);
  });
}
for (const [input, expected] of [['#FFF', '#ffffff'], ['000', '#000000'], ['＃ＡＢＣ', '#aabbcc'], ['  abcDEF  ', '#abcdef'], ['#123', '#112233']]) {
  test(`HEX normalization ${input}`, () => assert.equal(ctx.parseColor(input).hex, expected));
}
for (const input of ['', '#', '12', '1234', '12345', '1234567', '#12345678']) {
  test(`invalid HEX length ${input}`, () => assert.equal(ctx.parseColor(input).error, 'length'));
}
for (const [input, position] of [['12x', 3], ['a🙂c', 2], ['##abc', 1], ['abc def', 4], ['rgb(1,2,3)', 1]]) {
  test(`invalid HEX character ${input}`, () => assert.equal(ctx.parseColor(input).position, position));
}
test('black, white, #777 and red match WCAG published calculations', () => {
  assert.equal(ctx.luminance([0, 0, 0]), 0);
  assert.equal(ctx.luminance([255, 255, 255]), 1);
  assert.equal(ctx.luminance([255, 0, 0]), 0.2126);
  assert.ok(Math.abs(ctx.worstContrast([119,119,119,255], '#fff', 0, '#fff').ratio - 4.47808945) < 1e-7);
});
test('4.499 cannot pass by rounding, and large text uses 3:1', () => {
  const channel = (1.055 * ((1.05 / 4.499 - 0.05) ** (1 / 2.4)) - 0.055) * 255;
  const result = ctx.worstContrast([channel,channel,channel,255], '#000', 0, '#fff');
  assert.equal(result.aa, false);
  assert.equal(result.large, true);
});
test('worst point can be in the middle, not an endpoint or average', () => {
  const result = ctx.worstContrast([0,0,0,255, 120,120,120,255, 255,255,255,255], '#fff', 0, '#777');
  assert.equal(result.pixel, 1);
  assert.ok(result.ratio < 1.02);
});
for (const format of ['css', 'tailwind']) {
  for (const opaque of [false, true]) {
    test(`${format} preserves explicit settings, opaque=${opaque}`, () => {
      const code = ctx.exportCode({ ...defaults, opaque, bg: '#abc', text: '#123', fallback: '#fed', radius: 0, blur: 0, saturation: 0, borderWidth: 0.5, borderAlpha: 0, shadowAlpha: 0 }, format);
      assert.match(code, /border: 0.5px solid rgba\(255, 255, 255, 0.00\)/);
      assert.match(code, /border-radius: 0px/);
      assert.match(code, /color: #123/);
      assert.match(code, /background: #fed/);
      assert.match(code, /0 4px 24px rgba\(0, 0, 0, 0.00\)/);
      if (opaque) assert.doesNotMatch(code, /@supports/); else assert.match(code, /blur\(0px\) saturate\(0%\)/);
    });
  }
}
const strings = vm.runInNewContext('(' + source.split('const STRINGS = ')[1].split('\nconst L =')[0].replace(/;\s*$/, '') + ')');
for (const lang of ['zh','ja','ko']) {
  test(`${lang} UI keys and message placeholders are complete`, () => {
    assert.deepEqual(Object.keys(strings[lang]).sort(), Object.keys(strings.en).sort());
    for (const key of Object.keys(strings.en)) assert.deepEqual(strings[lang][key].match(/\{\w+\}/g), strings.en[key].match(/\{\w+\}/g));
  });
}
test('generated code highlights keep unscoped styles; local images and settings are not stored or uploaded', () => {
  assert.match(source, /<style is:global>/);
  assert.match(source, /\.gsg-hl-prop/);
  const script = source.split('<script is:inline')[1].split('</script>')[0];
  assert.doesNotMatch(script, /innerHTML|fetch\(|XMLHttpRequest|localStorage|sessionStorage|ztPersist|sendBeacon/);
});
console.log(`${count} passed`);
