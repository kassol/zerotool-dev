// Nano ID Generator — custom alphabets by code point
//
// Read:  src/components/tools/NanoIdGeneratorTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers), src/content/tools/nano-id-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: a custom alphabet is split into code points and deduplicated, so emoji and other
// characters above U+FFFF are whole symbols (nanoid's customAlphabet works per UTF-16 code unit
// and produced lone surrogates); IDs have `size` symbols, all from the alphabet, and are
// well-formed UTF-16; alphabets above 256 symbols use every symbol (nanoid uses one byte per
// symbol and never picks the 257th and later); random values at or above the largest multiple of
// the alphabet size are discarded (no modulo bias), checked with a stub random source; a
// chi-square test over 300 symbols × 300,000 draws; the English page no longer states the
// UTF-16 and 256-symbol limits.
//
// Run: node scripts/test-nano-id-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/NanoIdGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/nano-id-generator/en.mdx'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in NanoIdGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { alphabetSymbols, randomId };')();
const rand = (n) => webcrypto.getRandomValues(new Uint32Array(n));

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}

eq('emoji alphabet by code point', E.alphabetSymbols('😀😃😀ab'), ['😀', '😃', 'a', 'b']);
eq('CJK and ASCII', E.alphabetSymbols('猫犬猫01'), ['猫', '犬', '0', '1']);
const emoji = E.alphabetSymbols('😀😃😄😁🐱🐶');
let ok = true;
for (let i = 0; i < 2000 && ok; i++) {
  const id = E.randomId(emoji, 8, rand);
  const cps = Array.from(id);
  if (cps.length !== 8 || !cps.every((c) => emoji.includes(c)) || !id.isWellFormed()) { ok = false; eq('emoji id ' + JSON.stringify(id), 'well-formed, 8 symbols', id); }
}
if (ok) passes++;

// rejection sampling: with 3 symbols the largest multiple below 2^32 is 4294967295 - (2^32 % 3)
const three = ['a', 'b', 'c'];
const limit = Math.floor(4294967296 / 3) * 3;
const queue = [limit, limit + 0, 4294967295, 0, 1, 2];
const stub = (n) => { const out = new Uint32Array(n); for (let i = 0; i < n; i++) out[i] = queue.length ? queue.shift() : 0; return out; };
eq('values at or above the limit are discarded', E.randomId(three, 3, stub), 'abc');

// 300 distinct symbols: every one is used, roughly evenly
const big = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4E00 + i));
const counts = new Map();
const N = 300000;
const ids = E.randomId(big, N, rand);
for (const c of ids) counts.set(c, (counts.get(c) || 0) + 1);
eq('all 300 symbols used', counts.size, 300);
const exp = N / 300;
let chi = 0;
for (const c of big) chi += ((counts.get(c) || 0) - exp) ** 2 / exp;
// df = 299: mean 299, sd ≈ 24.5; 450 is beyond 6 sd
eq('chi-square below 450', chi < 450, true);

eq('page no longer says custom alphabets must stay below U+FFFF', page.includes('Use ASCII or other characters below U+FFFF'), false);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
