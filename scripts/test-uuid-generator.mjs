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
// version / variant digits quoted on the English page; the English guide
// (src/content/blog/uuid-generator-guide/en.mdx): the generator value it dissects, the RFC 9562
// test vectors in the versions table (v3, v5 and the SHA-256 v8 example are recomputed from the
// DNS namespace), the collision table and figures, and code blocks marked
// {/* uuid-run: {"lang":"node|python","expect":"…"} */} are run (python3 missing: SKIP).
//
// Run: node scripts/test-uuid-generator.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
let skips = 0;
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
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

// guide
{
  const guide = readFileSync(join(root, 'src/content/blog/uuid-generator-guide/en.mdx'), 'utf8');
  const has = (name, text) => eq('guide: ' + name, guide.includes(text), true);
  const tv = /uuid-check: tool-value \*\/\}\n```text\n([^\n]+)\n/.exec(guide)[1];
  eq('guide tool value is v4', V4.test(tv), true);
  const hex = tv.replace(/-/g, '');
  has('13th digit row', '| 13th digit | `' + hex[12] + '` | `' + parseInt(hex[12], 16).toString(2).padStart(4, '0') + '` |');
  has('17th digit row', '| 17th digit | `' + hex[16] + '` | `' + parseInt(hex[16], 16).toString(2).padStart(4, '0') + '` |');

  // name-based vectors
  const ns = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const named = (algo, version) => {
    const b = createHash(algo).update(Buffer.concat([ns, Buffer.from('www.example.com')])).digest().subarray(0, 16);
    b[6] = (b[6] & 0x0f) | (version << 4);
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  };
  has('v3 vector', '| 3 | MD5 of namespace UUID + name | `' + named('md5', 3) + '` |');
  has('v5 vector', '`' + named('sha1', 5) + '`');
  has('v8 SHA-256 vector', '`' + named('sha256', 8) + '` (SHA-256 name-based example)');
  for (const v of ['c232ab00-9414-11ec-b3c8-9f6bdeced846', '919108f7-52d1-4320-9bac-f847db4148a8', '1ec9414c-232a-6b00-b3c8-9f6bdeced846', '017f22e2-79b0-7cc3-98c4-dc0c0c07398f']) has('RFC vector ' + v, '`' + v + '`');
  eq('v7 vector timestamp', new Date(0x017f22e279b0).toISOString(), '2022-02-22T19:22:22.000Z');

  // collision figures
  const N = 2 ** 122;
  const p = (n, M = N) => -Math.expm1(-n * n / 2 / M);
  const sci = (x, d) => {
    const [m, e] = x.toExponential(d).split('e');
    const n = Number(e);
    return m + ' × 10<sup>' + (n < 0 ? '−' + -n : n) + '</sup>';
  };
  const n50 = Math.sqrt(2 * N * Math.LN2);
  has('N', 'N = 2<sup>122</sup> ≈ ' + sci(N, 2));
  has('n50', 'n = √(2N ln 2) ≈ ' + sci(n50, 2) + ' UUIDs');
  eq('86 years', Math.round(n50 / 1e9 / (365.25 * 86400)), 86);
  has('86 years text', 'takes about 86 years');
  const year = 1e6 * 365.25 * 86400;
  has('row: a year at 1M/s', '| One million per second for a year | ' + sci(year, 2) + ' | ' + sci(p(year), 1) + ' |');
  has('row: 103 trillion', '| 103 trillion | ' + sci(1.03e14, 2) + ' | ' + sci(p(1.03e14), 0) + ' |');
  has('row: 8e15', '| ' + sci(8e15, 0) + ' | ' + sci(p(8e15), 1) + ' |');
  has('row: 50%', '| ' + sci(n50, 2) + ' | 0.5 |');
  has('v7 same millisecond', 'about ' + sci(p(1000, 2 ** 74), 1));

  // code blocks
  let py = false;
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); py = true; } catch {}
  const re = /\{\/\* uuid-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
  let m; let runs = 0;
  while ((m = re.exec(guide))) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = 'guide ' + spec.lang + ' block ' + runs;
    if (spec.lang === 'python' && !py) { skip(name, 'python3 not installed'); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'uuid-run-'));
    try {
      const file = join(dir, spec.lang === 'node' ? 'main.mjs' : 'main.py');
      writeFileSync(file, m[2]);
      eq(name, execFileSync(spec.lang === 'node' ? process.execPath : 'python3', [file]).toString().trim(), spec.expect);
    } catch (e) {
      eq(name, String(e.stderr || e.message).slice(0, 300), spec.expect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  eq('guide has 3 runnable blocks', runs, 3);
}

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
