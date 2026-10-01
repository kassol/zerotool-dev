// Box Shadow Generator — output format and the examples in the box-shadow guide
//
// Read:  src/components/tools/BoxShadowGeneratorTool.astro (runs the page script against a
//        stand-in DOM); src/content/blog/box-shadow-generator-guide/{en,ja}.mdx;
//        node_modules/tailwindcss/theme.css (the Tailwind tokens quoted in the en guide)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the output on load; `bsg-check` annotations (slider values → the generated
// declaration, which must also appear in the guide text); an invalid hex code leaves the
// color unchanged; `bsg-radius` annotations against the spread-radius rule in CSS Backgrounds
// and Borders Level 3 §6.1.1 (radius + spread × (1 + (r − 1)^3) when r = radius / spread < 1);
// the Gaussian values quoted in the en guide (σ = blur / 2); the Tailwind tokens quoted in the
// en guide match tailwindcss's theme.css; both guides are indexable with no template headings.
//
// Run: node scripts/test-box-shadow-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/BoxShadowGeneratorTool.astro'), 'utf8');

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

// ---------- page script with a stand-in DOM ----------
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
const els = {};
function el(id) {
  if (!els[id]) {
    const handlers = {};
    let html = '';
    els[id] = {
      id, value: '', textContent: '', checked: false, disabled: false, style: {}, dataset: {},
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, ''); },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], {})); },
    };
  }
  return els[id];
}
const defaults = { 'bsg-h': '5', 'bsg-v': '5', 'bsg-blur': '10', 'bsg-spread': '0', 'bsg-opacity': '30', 'bsg-color': '#000000', 'bsg-color-hex': '#000000' };
for (const [id, v] of Object.entries(defaults)) el(id).value = v;
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const document = { currentScript: null, querySelector: () => wrap, getElementById: el };
new Function('document', 'window', 'navigator', 'setTimeout', scriptMatch[1])(document, {}, {}, () => {});

eq('output on load', el('bsg-code').textContent, 'box-shadow: 5px 5px 10px 0px rgba(0, 0, 0, 0.30);');
eq('preview uses the same shadow', el('bsg-preview-box').style.boxShadow, '5px 5px 10px 0px rgba(0, 0, 0, 0.30)');

function generate(c) {
  el('bsg-h').value = String(c.h);
  el('bsg-v').value = String(c.v);
  el('bsg-blur').value = String(c.blur);
  el('bsg-spread').value = String(c.spread);
  el('bsg-opacity').value = String(c.opacity);
  el('bsg-color').value = c.color;
  el('bsg-color-hex').value = c.color;
  el('bsg-inset').checked = c.inset;
  el('bsg-h').fire('input');
  return el('bsg-code').textContent;
}

// Invalid hex: the swatch keeps its color.
el('bsg-color').value = '#1a73e8';
el('bsg-color-hex').value = '#abc';
el('bsg-color-hex').fire('input');
check('3-digit hex is ignored', el('bsg-code').textContent.includes('rgba(26, 115, 232,'), el('bsg-code').textContent);

// ---------- guides ----------
function erfc(x) {
  // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}
const tail = (d, sigma) => 0.5 * erfc(d / (sigma * Math.SQRT2));
const spreadRadius = (r, s) => (r >= s ? r + s : r + s * (1 + (r / s - 1) ** 3));

for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/box-shadow-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String));
  const body = guide.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  const checks = [...guide.matchAll(/\{\/\* bsg-check: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ' guide has bsg-check annotations', checks.length >= 3, checks.length);
  for (const c of checks) {
    eq(`${lang} generator ${JSON.stringify(c)}`, generate(c), c.out);
    check(`${lang} guide shows ${c.out}`, body.includes(c.out));
  }

  const radii = [...guide.matchAll(/\{\/\* bsg-radius: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ' guide has bsg-radius annotations', radii.length >= 2, radii.length);
  for (const c of radii) {
    eq(`${lang} spread radius r=${c.r} s=${c.s}`, spreadRadius(c.r, c.s), c.out);
    if (c.out) check(`${lang} guide shows ${c.out}px`, body.includes(c.out + 'px'));
  }
  // The diagonal reach measured in the guides follows from those radii on a 100px box
  // (corner at 0, shadow corner centre at −s + R, reach = s − R + R/√2 … floor of the distance).
  const reach = (s, R) => Math.floor(-(-s + R - R / Math.SQRT2));
  eq(lang + ' diagonal reach, radius 0', reach(40, 0), 40);
  eq(lang + ' diagonal reach, radius 10 (adjusted)', reach(40, spreadRadius(10, 40)), 30);
  eq(lang + ' diagonal reach, radius 10 without the adjustment', reach(40, 50), 25);
  // radius 60 clamps to 50 on a 100px box; the shadow is a circle of radius 90 around the centre
  eq(lang + ' diagonal reach, circle', Math.floor(-(50 - 90 / Math.SQRT2)), 13);

  // Gaussian with σ = 5px (blur 10px), the values quoted next to the measurements
  const predicted = [0, 2, 5, 8, 10].map((d) => tail(d, 5).toFixed(2).replace(/^0\.(\d)0$/, '0.$1'));
  const quoted = lang === 'en' ? 'predicts 0.5, 0.34, 0.16, 0.05, 0.02 and 0.001' : '0.5、0.34、0.16、0.05、0.02、0.001';
  check(lang + ' Gaussian prediction quoted', body.includes(quoted));
  eq(lang + ' Gaussian prediction values', predicted, ['0.5', '0.34', '0.16', '0.05', '0.02']);
  eq(lang + ' Gaussian at 15px', tail(15, 5).toFixed(3), '0.001');
}

// Tailwind tokens quoted in the en guide
{
  const guide = readFileSync(join(root, 'src/content/blog/box-shadow-generator-guide/en.mdx'), 'utf8');
  const theme = readFileSync(join(root, 'node_modules/tailwindcss/theme.css'), 'utf8');
  const version = JSON.parse(readFileSync(join(root, 'node_modules/tailwindcss/package.json'), 'utf8')).version;
  check('en guide names the installed Tailwind version', guide.includes('Tailwind CSS ' + version), version);
  const block = guide.match(/\{\/\* bsg-tailwind \*\/\}\s*```css\n([\s\S]*?)```/)[1];
  for (const line of block.trim().split('\n')) check('Tailwind token ' + line.split(':')[0], theme.includes(line.trim()), line);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
