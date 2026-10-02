// Password Generator — character sets, uniform sampling, strength labels
//
// Read:  src/components/tools/PasswordGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, and the STRINGS table);
//        src/content/blog/password-generator-guide/{en,ja}.mdx (`pw-*` annotations, code blocks)
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

// ── password-generator-guide (en, ja) ──────────────────────────────────────────────────
// Annotations in the guides are recomputed here: `pw-bits` (length × log2 size to 1 decimal,
// and the generator's strength label), `pw-set` (charset size for an option combination),
// `pw-time` (size^length / guesses per second, in the stated unit), `pw-dice` (words ×
// log2 7776), `pw-miss` (chance that a password from the four-set charset has no digit /
// lacks at least one of the four sets, inclusion–exclusion over the generator's set sizes),
// `pw-sha1` (SHA-1 shown for a breach lookup), `pw-bias` (256 % 88 and the 3:2 frequency
// ratio of byte % 88), `pw-nfc` (NFC / NFKC of a full-width string), `pw-utf8` (characters and
// UTF-8 bytes). The en JavaScript block marked `pw-run-js` is executed with Node's Web Crypto;
// the en Python block marked `pw-run-py` runs when python3 is installed.
{
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const sizeOf = { upper: 26, lower: 26, digits: 10, symbols: E.SYMBOLS.length };
  const fmtCheck = (computed, value) => {
    const v = Number(value.replace(/,/g, ''));
    const dec = value.includes('.') ? value.split('.')[1].length : 0;
    if (dec > 0) return computed.toFixed(dec) === value.replace(/,/g, '');
    if (/00$/.test(value)) return Math.abs(computed - v) / v < 0.005;
    return Math.round(computed) === v;
  };
  const YEAR = 365.25 * 86400;
  const units = { seconds: 1, hours: 3600, years: YEAR, millionYears: YEAR * 1e6, billionYears: YEAR * 1e9 };
  for (const lang of ['en', 'ja']) {
    const guide = readFileSync(join(root, `src/content/blog/password-generator-guide/${lang}.mdx`), 'utf8');
    const body = stripComments(guide);
    const ann = (name) => [...guide.matchAll(new RegExp('\\{/\\* ' + name + ': (\\{.*?\\}) \\*/\\}', 'g'))].map((m) => JSON.parse(m[1]));
    const bitsList = ann('pw-bits');
    check(lang + ' guide has pw-bits annotations', bitsList.length >= 6, String(bitsList.length));
    for (const c of bitsList) {
      const b = bits(c.len, c.size);
      check(`${lang} ${c.len} chars from ${c.size} = ${c.bits} bits`, b.toFixed(1) === c.bits, b.toFixed(3));
      check(`${lang} guide shows ${c.bits}`, body.includes(c.bits));
      if (c.label) check(`${lang} ${c.len} chars from ${c.size} labelled ${c.label}`, E.strengthInfo(b).key === c.label, E.strengthInfo(b).key);
    }
    for (const c of ann('pw-set')) {
      const o = Object.fromEntries(c.opts.map((k) => [k, true]));
      check(`${lang} charset ${c.opts.join('+')} = ${c.size}`, E.charsetFor(o).length === c.size, String(E.charsetFor(o).length));
    }
    for (const c of ann('pw-time')) {
      const t = Math.pow(c.size, c.len) / c.rate / units[c.unit];
      check(`${lang} ${c.len} chars from ${c.size} at ${c.rate}/s = ${c.value} ${c.unit}`, fmtCheck(t, c.value), String(t));
    }
    for (const c of ann('pw-dice')) {
      const b = c.words * Math.log2(7776);
      check(`${lang} ${c.words} Diceware words = ${c.bits} bits`, b.toFixed(1) === c.bits, b.toFixed(3));
    }
    const missList = ann('pw-miss');
    check(lang + ' guide has pw-miss annotations', missList.length >= 1);
    for (const c of missList) {
      const keys = Object.keys(sizeOf);
      const N = keys.reduce((a, k) => a + sizeOf[k], 0);
      check(lang + ' four-set charset is 88', N === 88 && E.charsetFor(all).length === N);
      let any = 0;
      for (let m = 1; m < 16; m++) {
        const sub = keys.filter((_, i) => (m >> i) & 1);
        const sz = sub.reduce((a, k) => a + sizeOf[k], 0);
        any += (sub.length % 2 ? 1 : -1) * Math.pow((N - sz) / N, c.len);
      }
      check(`${lang} ${c.len} chars: some set missing ${c.anyMissing}%`, (any * 100).toFixed(1) === c.anyMissing, (any * 100).toFixed(3));
      if (c.noDigit) {
        const nd = Math.pow((N - sizeOf.digits) / N, c.len) * 100;
        check(`${lang} ${c.len} chars: no digit ${c.noDigit}%`, nd.toFixed(1) === c.noDigit, nd.toFixed(3));
      }
    }
    for (const c of ann('pw-sha1')) {
      check(`${lang} SHA-1 of ${c.pw}`, createHash('sha1').update(c.pw).digest('hex').toUpperCase() === c.sha1);
      check(`${lang} guide shows ${c.pw}`, body.includes('`' + c.pw + '`'));
    }
    for (const c of ann('pw-bias')) {
      check(`${lang} 256 % 88 = ${c.byteRemainder}`, 256 % 88 === c.byteRemainder);
      check(`${lang} byte % 88 frequency ratio ${c.ratio}`, Math.ceil(256 / 88) / Math.floor(256 / 88) === c.ratio);
    }
    for (const c of ann('pw-nfc')) {
      check(`${lang} NFC of ${c.in}`, c.in.normalize('NFC') === c.nfc);
      check(`${lang} NFKC of ${c.in}`, c.in.normalize('NFKC') === c.nfkc);
    }
    for (const c of ann('pw-utf8')) {
      check(`${lang} ${c.text} has ${c.chars} characters`, [...c.text].length === c.chars);
      check(`${lang} ${c.text} is ${c.bytes} UTF-8 bytes`, Buffer.byteLength(c.text, 'utf8') === c.bytes);
    }
    check(`${lang} guide lists the generator's symbols`, body.includes('`' + E.SYMBOLS + '`'));
    if (lang === 'en') {
      const js = guide.match(/\{\/\* pw-run-js \*\/\}\s*```js\n([\s\S]*?)```/);
      check('en JavaScript block found', !!js);
      if (js) {
        const logs = [];
        new Function('console', 'crypto', js[1])({ log: (...a) => logs.push(a.join(' ')) }, globalThis.crypto);
        check('en JavaScript block prints 20 letters/digits', /^[A-Za-z0-9]{20}$/.test(logs[0] || ''), logs[0]);
        check('en JavaScript block uses the generator limit', js[1].includes('2 ** 32 - (2 ** 32 % n)') && block.includes('4294967296 - (4294967296 % n)'));
      }
      const py = guide.match(/\{\/\* pw-run-py \*\/\}\s*```python\n([\s\S]*?)```/);
      check('en Python block found', !!py);
      let havePy = true;
      try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { havePy = false; }
      if (py && havePy) {
        const out = execFileSync('python3', ['-c', py[1]], { encoding: 'utf8' }).trim();
        check('en Python block prints "94 20"', out === '94 20', out);
      } else if (!havePy) console.log('SKIP en Python block (python3 not installed)');
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
