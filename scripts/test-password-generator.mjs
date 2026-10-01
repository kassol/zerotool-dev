// Password Generator — character sets, uniform sampling, strength labels
//
// Read:  src/components/tools/PasswordGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, and the STRINGS table)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: charset sizes for each option combination (88 with all four sets, 83 with
// "Exclude ambiguous"); genPassword draws again when a 32-bit value is at or above the
// largest multiple of the charset size (before the fix it used value % size, which made
// the first 4294967296 % size characters slightly more likely); length and charset of
// the output; a chi-square check on 176,000 characters; strength thresholds and the bit
// counts quoted on the en tool page; STRINGS has the same keys in all four languages,
// including the five strength labels (before the fix they were English on every page).
//
// Run: node scripts/test-password-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/PasswordGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in PasswordGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const load = (cryptoImpl) =>
  new Function('crypto', block + '\nreturn { charsetFor, genPassword, strengthInfo, SYMBOLS };')(cryptoImpl);
const E = load(globalThis.crypto);

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Charset sizes
const all = { upper: true, lower: true, digits: true, symbols: true, ambiguous: false };
check('all four sets = 88 characters', E.charsetFor(all).length === 88, String(E.charsetFor(all).length));
check('symbol set is 26 characters', E.SYMBOLS.length === 26);
const noAmb = E.charsetFor({ ...all, ambiguous: true });
check('exclude ambiguous = 83 characters', noAmb.length === 83, String(noAmb.length));
check('exclude ambiguous removes 0 O l 1 I', !/[0Ol1I]/.test(noAmb));
check('lowercase + digits = 36', E.charsetFor({ lower: true, digits: true }).length === 36);
check('no set selected = empty', E.charsetFor({}) === '');
check('charset has no duplicates', new Set(E.charsetFor(all)).size === 88);

// Output length and alphabet
for (const len of [4, 20, 128]) {
  const pw = E.genPassword(len, E.charsetFor(all));
  check('length ' + len, pw.length === len, String(pw.length));
}
const digitsOnly = E.genPassword(200, '0123456789');
check('only charset characters', /^[0-9]{200}$/.test(digitsOnly));
check('empty charset returns empty string', E.genPassword(10, '') === '');

// Rejection sampling with a scripted random source
const n = 88;
const limit = 4294967296 - (4294967296 % n);
const scripted = [limit, 4294967295, 0, limit - 1, 5];
let pos = 0;
const fake = {
  getRandomValues(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = scripted[pos++ % scripted.length];
    return arr;
  },
};
const F = load(fake);
const cs = F.charsetFor(all);
const out = F.genPassword(3, cs);
check('values >= limit are rejected', out === cs[0] + cs[(limit - 1) % n] + cs[5], JSON.stringify(out));
check('limit is a multiple of 88', limit % n === 0);

// Uniformity: chi-square over 176,000 draws (88 bins, 2000 expected each)
const counts = new Map();
let big = '';
for (let i = 0; i < 1375; i++) big += E.genPassword(128, cs);
for (const ch of big) counts.set(ch, (counts.get(ch) || 0) + 1);
let chi = 0;
for (const ch of cs) { const c = counts.get(ch) || 0; chi += (c - 2000) ** 2 / 2000; }
// df = 87; p = 0.0001 critical value is about 144
check('chi-square over 88 characters < 144', chi < 144, chi.toFixed(1));

// Strength thresholds and the numbers on the en page
const bits = (len, size) => len * Math.log2(size);
const cases = [
  [20, 88, 129, 'veryStrong'],
  [16, 83, 102, 'veryStrong'],
  [12, 36, 62, 'fair'],
  [8, 88, 52, 'weak'],
  [14, 62, 83, 'strong'],
  [6, 26, 28, 'veryWeak'],
];
for (const [len, size, rounded, key] of cases) {
  const b = bits(len, size);
  check(`${len} chars from ${size} = ${rounded} bits`, Math.round(b) === rounded, b.toFixed(2));
  check(`${len} chars from ${size} is ${key}`, E.strengthInfo(b).key === key, E.strengthInfo(b).key);
}
check('80 bits is Strong', E.strengthInfo(80).key === 'strong');
check('79.9 bits is Fair', E.strengthInfo(79.9).key === 'fair');
check('100 bits is Very Strong', E.strengthInfo(100).key === 'veryStrong');

// STRINGS
const sm = source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/);
check('STRINGS table found', !!sm);
if (sm) {
  const S = new Function('return ' + sm[1])();
  const keys = Object.keys(S.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) {
    check(lang + ' STRINGS keys match en', Object.keys(S[lang]).sort().join(',') === keys);
  }
  for (const key of ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong']) {
    check('strength label ' + key + ' in all languages', ['en', 'zh', 'ja', 'ko'].every((l) => S[l][key]));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
