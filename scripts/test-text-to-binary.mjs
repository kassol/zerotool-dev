// Text to Binary — UTF-8 encode / decode regression test
//
// Read:  src/components/tools/TextToBinaryTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, and the STRINGS table in
//        the frontmatter, so this test cannot drift from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: encode equals the RFC 3629 section 7 examples and TextEncoder byte for byte
// (ASCII, CJK, Hangul, emoji with surrogate pairs, ZWJ sequences, combining marks);
// separators; character / code point / byte counts; unpaired surrogates are reported.
// Decode: spaced, continuous, line breaks, commas, semicolons, 0b prefixes, full-width
// digits; groups shorter than 8 bits (Python bin() output) are read as bytes only when
// no group is longer than 8 bits; bit counts that are not a multiple of 8, non-binary
// characters and every class of invalid UTF-8 give an error with the position and never
// output text; a leading BOM is kept; control characters are reported. The UTF-8
// validator agrees with TextDecoder({ fatal: true }) on 20,000 random byte strings.
// Before this test: 7-bit groups gave "Binary length must be a multiple of 8" or the
// English-only TextDecoder message, a leading EF BB BF was silently dropped, and
// UTF-16 input decoded to text with hidden NUL characters without a warning.
//
// Run: node scripts/test-text-to-binary.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TextToBinaryTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TextToBinaryTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { encodeText, parseBinary, findUtf8Error, decodeBinary, countCodePoints };')();

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
const hexToBits = (hex) => hex.split(' ').map((h) => parseInt(h, 16).toString(2).padStart(8, '0')).join(' ');
const enc = (text, sep = 'space') => E.encodeText(text, sep);

// ---------- encode: RFC 3629 section 7 examples ----------
eq('RFC 3629: A≢Α.', enc('A\u2262\u0391.').binary, hexToBits('41 E2 89 A2 CE 91 2E'));
eq('RFC 3629: 한국어', enc('한국어').binary, hexToBits('ED 95 9C EA B5 AD EC 96 B4'));
eq('RFC 3629: 日本語', enc('日本語').binary, hexToBits('E6 97 A5 E6 9C AC E8 AA 9E'));
eq('RFC 3629: U+233B4', enc('\u{233B4}').binary, hexToBits('F0 A3 8E B4'));

// ---------- encode: page examples ----------
eq('A', enc('A').binary, '01000001');
eq('中', enc('中').binary, '11100100 10111000 10101101');
eq('😀', enc('😀').binary, '11110000 10011111 10011000 10000000');
eq('é precomposed', enc('\u00E9').binary, '11000011 10101001');
eq('é combining', enc('e\u0301').binary, '01100101 11001100 10000001');
eq('ZWJ family', enc('👨‍👩‍👧').binary, hexToBits('F0 9F 91 A8 E2 80 8D F0 9F 91 A9 E2 80 8D F0 9F 91 A7'));

// ---------- encode: matches TextEncoder byte for byte ----------
const samples = ['Hello, World!', '你好，世界', 'こんにちは、ｶﾀｶﾅ', '안녕하세요', '🇯🇵🇰🇷', '👍🏽', 'Ω≈ç√∫', '\t\n\r', '\u0000\u007F\u0080\u07FF\u0800\uFFFF\u{10000}\u{10FFFF}'];
for (const s of samples) {
  const expected = [...new TextEncoder().encode(s)].map((b) => b.toString(2).padStart(8, '0')).join(' ');
  eq('TextEncoder parity: ' + JSON.stringify(s), enc(s).binary, expected);
}

// ---------- encode: separators ----------
eq('separator none', enc('Hi', 'none').binary, '0100100001101001');
eq('separator comma', enc('Hi', 'comma').binary, '01001000,01101001');
eq('separator newline', enc('Hi', 'newline').binary, '01001000\n01101001');
eq('unknown separator falls back to space', enc('Hi', 'constructor').binary, '01001000 01101001');
eq('empty text', enc('').binary, '');

// ---------- encode: counts ----------
const fam = enc('👨‍👩‍👧');
eq('ZWJ family counts', [fam.characters, fam.codePoints, fam.bytes], [1, 5, 18]);
const mix = enc('A中😀');
eq('A中😀 counts', [mix.characters, mix.codePoints, mix.bytes], [3, 3, 8]);
eq('combining mark counts', [enc('e\u0301').characters, enc('e\u0301').codePoints], [1, 2]);
eq('flag counts', [enc('🇯🇵').characters, enc('🇯🇵').codePoints, enc('🇯🇵').bytes], [1, 2, 8]);
eq('no replacement for valid text', enc('😀').replaced, 0);

// ---------- encode: unpaired surrogates ----------
const lone = enc('a\uD83Db');
eq('lone high surrogate → EF BF BD', lone.binary, hexToBits('61 EF BF BD 62'));
eq('lone high surrogate reported', lone.replaced, 1);
eq('lone low surrogate reported', enc('\uDE00').replaced, 1);
eq('two lone surrogates in wrong order', enc('\uDE00\uD83D').replaced, 2);

// ---------- decode: accepted formats ----------
const dec = (s) => E.decodeBinary(s);
const text = (s) => { const r = dec(s); return r.error ? 'ERROR:' + r.error : r.text; };
eq('spaced', text('01001000 01101001'), 'Hi');
eq('continuous', text('0100100001101001'), 'Hi');
eq('line breaks', text('01001000\n01101001\r\n'), 'Hi');
eq('commas', text('01001000,01101001'), 'Hi');
eq('comma and space', text('01001000, 01101001'), 'Hi');
eq('semicolons', text('01001000;01101001'), 'Hi');
eq('tabs and extra spaces', text('  01001000\t\t01101001  '), 'Hi');
eq('0b prefixes', text('0b01001000 0b01101001'), 'Hi');
eq('continuous split per line at byte boundaries', text('0100100001101001\n0010000100100001'), 'Hi!!');
eq('full-width digits and comma', text('０１００１０００，０１１０１００１'), 'Hi');
eq('ideographic comma', text('01001000、01101001'), 'Hi');
eq('empty input', dec('   '), { text: '', bytes: 0, codePoints: 0, characters: 0, padded: 0, controls: 0, firstControl: -1 });

// ---------- decode: groups shorter than 8 bits ----------
const py = [...'Zero'].map((c) => c.charCodeAt(0).toString(2)).join(' '); // Python / JS bin() without padding
eq('bin() output without padding', text(py), 'Zero');
eq('7-bit groups are counted as padded', dec(py).padded, 4);
eq('Python bin() with 0b', text('0b1001000 0b1101001'), 'Hi');
eq('mixed 7 and 8 bit groups', text('1001000 01101001'), 'Hi');
eq('single short group', text('1000001'), 'A');
eq('8 groups of 7 bits (56 bits)', text('1001000 1101001 1001000 1101001 1001000 1101001 1001000 1101001'), 'HiHiHiHi');

// ---------- decode: errors ----------
eq('15 continuous bits', dec('010010000110100'), { error: 'bitCount', bits: 15, rest: 7 });
eq('long group not multiple of 8', dec('01001000 011010010'), { error: 'groupLength', group: 2, text: '011010010', bits: 9 });
eq('wrapped stream leaves a short group', dec('0100100001101001\n01'), { error: 'mixedGroups', group: 2, text: '01', bits: 2 });
eq('non-binary character', dec('01001000 0110100x'), { error: 'invalidChar', char: 'x', position: 17 });
eq('digit 2', dec('0120'), { error: 'invalidChar', char: '2', position: 3 });
eq('emoji position counts code points', dec('😀 01x'), { error: 'invalidChar', char: '😀', position: 1 });
eq('position after an emoji', dec('01😀'), { error: 'invalidChar', char: '😀', position: 3 });
eq('hex is rejected', dec('0x48')?.error, 'invalidChar');
eq('bare 0b is rejected', dec('0b')?.error, 'invalidChar');
eq('dot separator is rejected', dec('01001000.01101001')?.error, 'invalidChar');

// ---------- decode: invalid UTF-8 never outputs text ----------
eq('truncated 3-byte character', dec('11100100 10111000'),
  { error: 'incomplete', byte: 1, end: 2, bitsText: '11100100 10111000', length: 3, got: 2 });
eq('lead byte followed by ASCII', dec('11100100 01000001')?.error, 'incomplete');
eq('lone continuation byte', dec('01000001 10111000'),
  { error: 'continuation', byte: 2, end: 2, bitsText: '10111000', length: undefined, got: 1 });
eq('C0 lead byte', dec('11000000 10000001')?.error, 'invalidLead');
eq('F5 lead byte', dec('11110101 10000000 10000000 10000000')?.error, 'invalidLead');
eq('FF byte', dec('11111111')?.error, 'invalidLead');
eq('overlong E0 80', dec('11100000 10000000 10000000'),
  { error: 'overlong', byte: 1, end: 2, bitsText: '11100000 10000000', length: undefined, got: 2 });
eq('overlong F0 8F', dec('11110000 10001111 10111111 10111111')?.error, 'overlong');
eq('surrogate ED A0 80', dec('11101101 10100000 10000000')?.error, 'surrogate');
eq('above U+10FFFF', dec('11110100 10010000 10000000 10000000')?.error, 'tooLarge');
check('error result has no text', !('text' in dec('11100100 10111000')));

// ---------- decode: round trip, BOM, control characters ----------
for (const s of samples) {
  for (const sep of ['space', 'none', 'comma', 'newline']) {
    eq('round trip ' + sep + ' ' + JSON.stringify(s), text(enc(s, sep).binary), s);
  }
}
eq('BOM is kept', text('11101111 10111011 10111111 01000001'), '\uFEFFA');
const u16 = dec('00000000 01001000 00000000 01101001');
eq('UTF-16BE input shows NUL controls', [u16.text, u16.controls, u16.firstControl], ['\u0000H\u0000i', 2, 0]);
eq('tab and newline are not reported', dec(enc('a\tb\nc\r').binary).controls, 0);
eq('DEL is reported', dec('01111111').controls, 1);
eq('decode counts', [dec(enc('👨‍👩‍👧').binary).characters, dec(enc('👨‍👩‍👧').binary).bytes], [1, 18]);

// ---------- UTF-8 validator agrees with TextDecoder ----------
let seed = 12345;
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
const interesting = [0x00, 0x41, 0x7F, 0x80, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0, 0xC1, 0xC2, 0xDF, 0xE0, 0xE1, 0xEC, 0xED, 0xEE, 0xEF, 0xF0, 0xF1, 0xF3, 0xF4, 0xF5, 0xFF];
let disagree = 0;
let firstDisagree = null;
for (let n = 0; n < 20000; n++) {
  const len = 1 + (rand() % 6);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = rand() % 3 ? interesting[rand() % interesting.length] : rand() % 256;
  let valid = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { valid = false; }
  if ((E.findUtf8Error(bytes) === null) !== valid) { disagree++; if (!firstDisagree) firstDisagree = [...bytes]; }
}
eq('validator vs TextDecoder on 20,000 random strings', disagree, 0);
if (firstDisagree) console.log('  first disagreement:', firstDisagree.map((b) => b.toString(16)).join(' '));

// ---------- 100,000 characters ----------
const big = '中文ABC😀 '.repeat(12500); // 100,000 UTF-16 units
let t0 = performance.now();
const bigEnc = enc(big);
const encMs = performance.now() - t0;
t0 = performance.now();
const bigDec = dec(bigEnc.binary);
const decMs = performance.now() - t0;
eq('100k round trip', bigDec.text === big, true);
check('100k encode under 1 s', encMs < 1000, encMs.toFixed(0) + ' ms');
check('100k decode under 1 s', decMs < 1000, decMs.toFixed(0) + ' ms');
console.log(`100k units: ${bigEnc.bytes} bytes, encode ${encMs.toFixed(0)} ms, decode ${decMs.toFixed(0)} ms`);

// ---------- 4-language STRINGS ----------
const stringsMatch = source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/);
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const STRINGS = new Function('return ' + stringsMatch[1] + ';')();
  const shape = (o) => Object.keys(o).sort().map((k) => (typeof o[k] === 'object' && !Array.isArray(o[k]) ? k + '{' + shape(o[k]) + '}' : k)).join(',');
  ['zh', 'ja', 'ko'].forEach((lang) => eq('STRINGS ' + lang + ' keys', shape(STRINGS[lang]), shape(STRINGS.en)));
  const errorKinds = ['invalidChar', 'bitCount', 'groupLength', 'mixedGroups', 'continuation', 'invalidLead', 'incomplete', 'overlong', 'surrogate', 'tooLarge'];
  eq('every engine error has a message', Object.keys(STRINGS.en.err).sort(), [...errorKinds].sort());
  // Every placeholder in an error template is a field that the engine returns.
  const sampleErrors = {
    invalidChar: dec('0x'), bitCount: dec('010010000'), groupLength: dec('0 010010000'), mixedGroups: dec('0100100001101001 01'),
    continuation: dec('10000000'), invalidLead: dec('11111111'), incomplete: dec('11100100'), overlong: dec('11100000 10000000 10000000'),
    surrogate: dec('11101101 10100000 10000000'), tooLarge: dec('11110100 10010000 10000000 10000000')
  };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    for (const kind of errorKinds) {
      check('sample for ' + kind, sampleErrors[kind].error === kind, JSON.stringify(sampleErrors[kind]));
      const missing = [...STRINGS[lang].err[kind].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((f) => sampleErrors[kind][f] === undefined);
      eq(lang + ' ' + kind + ' placeholders', missing, []);
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
