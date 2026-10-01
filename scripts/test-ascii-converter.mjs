// ASCII Converter — code formats and strict reading of code tokens
//
// Read:  src/components/tools/AsciiConverterTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: formatCode for decimal / hex / octal / binary; parseCode reads 0x / 0o / 0b /
// decimal tokens only when the whole token is digits of that base (parseInt used to stop
// at the first bad digit, so 72abc read as 72 and 0b102 as 2), rejects surrogate code
// points (U+D800–U+DFFF) and values above U+10FFFF; the examples on the English page.
//
// Run: node scripts/test-ascii-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AsciiConverterTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in AsciiConverterTool.astro');
  process.exit(1);
}
const { formatCode, parseCode } = new Function(source.slice(startIndex, endIndex) + '\nreturn { formatCode, parseCode };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
function throws(name, fn, message) {
  try { fn(); } catch (e) { eq(name, e.message, message); return; }
  failures++;
  console.log('FAIL: ' + name + ' did not throw');
}
const toCodes = (s, fmt) => [...s].map((c) => formatCode(c.codePointAt(0), fmt)).join(' ');
const toText = (s) => s.trim().split(/[\s,]+/).filter(Boolean).map((t) => String.fromCodePoint(parseCode(t))).join('');

eq('decimal', toCodes('Hi!', 'dec'), '72 105 33');
eq('hex', toCodes('Hi!', 'hex'), '0x48 0x69 0x21');
eq('octal', toCodes('Hi!', 'oct'), '0o110 0o151 0o41');
eq('binary', toCodes('Hi!', 'bin'), '0b1001000 0b1101001 0b100001');
eq('non-ASCII uses the code point', toCodes('é€😀', 'hex'), '0xE9 0x20AC 0x1F600');
eq('mixed formats and commas', toText('72, 0x69 0o41 0b100001'), 'Hi!!');
eq('upper-case prefix', toText('0X41 0B1000010'), 'AB');
eq('emoji code point', toText('128512'), '😀');
eq('zero', parseCode('0'), 0);
throws('trailing letters', () => parseCode('72abc'), 'Invalid code: 72abc');
throws('bad hex digit', () => parseCode('0x4G'), 'Invalid code: 0x4G');
throws('bad binary digit', () => parseCode('0b102'), 'Invalid code: 0b102');
throws('decimal point', () => parseCode('1.5'), 'Invalid code: 1.5');
throws('negative', () => parseCode('-1'), 'Invalid code: -1');
throws('empty prefix', () => parseCode('0x'), 'Invalid code: 0x');
throws('above U+10FFFF', () => parseCode('0x110000'), 'Code point out of range: 0x110000');
throws('surrogate', () => parseCode('55357'), 'Code point out of range: 55357');
eq('last code point', parseCode('0x10FFFF'), 0x10ffff);

// examples on the English page
eq('page: Hello decimal', toCodes('Hello', 'dec'), '72 101 108 108 111');
eq('page: café hex', toCodes('café ☕', 'hex'), '0x63 0x61 0x66 0xE9 0x20 0x2615');
eq('page: CRLF', toCodes('a\r\nb', 'dec'), '97 13 10 98');
eq('page: decode binary', toText('0b1001111 0b1001011'), 'OK');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
