// UUID Generator — page script against a stand-in DOM
//
// Read:  src/components/tools/UuidGeneratorTool.astro (runs the inline page script against a small
//        stand-in for the elements it reads), src/content/tools/uuid-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: one UUID on load; every generated value is a lowercase RFC 9562 version 4 UUID; the
// batch count is clamped to 1–100, decimals are cut off, an empty or non-numeric count gives 5 and
// 0 gives 1 (0 used to give 5 because `parseInt(...) || 5` treated 0 as missing); the UUIDs and the
// version / variant digits quoted on the English page.
//
// Run: node scripts/test-uuid-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UuidGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/uuid-generator/en.mdx'), 'utf8');
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in UuidGeneratorTool.astro');
  process.exit(1);
}

function makePage() {
  const els = {};
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', textContent: '', placeholder: '',
        classList: { add() {}, remove() {} },
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
      };
    }
    return els[id];
  }
  const document = { documentElement: { lang: 'en' }, getElementById: el, querySelectorAll() { return []; } };
  new Function('document', 'window', 'crypto', 'navigator', scriptMatch[1])(document, {}, webcrypto, {});
  return el;
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let el = makePage();
eq('UUID on load', V4.test(el('uuid-output').textContent), true);
const first = el('uuid-output').textContent;
el('uuid-generate').fire('click');
eq('Generate gives a new v4 UUID', V4.test(el('uuid-output').textContent) && el('uuid-output').textContent !== first, true);

for (const [count, expected] of [['5', 5], ['1', 1], ['100', 100], ['250', 100], ['0', 1], ['-3', 1], ['2.9', 2], ['', 5], ['abc', 5]]) {
  el = makePage();
  el('uuid-count').value = count;
  el('uuid-batch-gen').fire('click');
  const lines = el('uuid-batch-output').value.split('\n');
  eq('batch count ' + JSON.stringify(count), lines.length, expected);
  eq('batch ' + JSON.stringify(count) + ' all v4', lines.every((l) => V4.test(l)), true);
  eq('batch ' + JSON.stringify(count) + ' no duplicates', new Set(lines).size, lines.length);
}

// UUIDs quoted on the English page are well-formed v4 values
const quoted = page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
eq('page quotes 4 UUIDs', quoted.length, 4);
for (const u of quoted) eq('page UUID ' + u + ' is v4', V4.test(u), true);
const dissected = 'd4b151b4-c1d3-41ac-9d4c-d413b112aaa1';
eq('13th digit', dissected.replace(/-/g, '')[12], '4');
eq('17th digit', dissected.replace(/-/g, '')[16], '9');
eq('17th digit bits', parseInt('9', 16).toString(2), '1001');
eq('remaining digits', dissected.replace(/-/g, '').split('').filter((_, i) => i !== 12 && i !== 16).join(''), 'd4b151b4c1d31acd4cd413b112aaa1');
eq('page remaining digits', page.includes('<code>d4b151b4 c1d3 1ac d4c d413b112aaa1</code>'), true);

// birthday-bound numbers on the page
const n50 = Math.sqrt(2 * Math.LN2 * 2 ** 122);
eq('50% at about 2.7e18', n50.toExponential(1), '2.7e+18');
eq('86 years at 1e9/s', Math.round(n50 / 1e9 / (365.25 * 86400)), 86);
eq('103 trillion: about 1e-9', (1 - Math.exp(-(103e12 ** 2) / 2 / 2 ** 122)).toExponential(0), '1e-9');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
