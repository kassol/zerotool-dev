// Hash Generator — MD5 implementation and the values quoted on the English page
//
// Read:  src/components/tools/HashGeneratorTool.astro (extracts the page's md5() function),
//        src/content/tools/hash-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: md5() equals node:crypto MD5 of the TextEncoder bytes for 3,000 random strings that mix
// ASCII, CJK, emoji and lone surrogates (the old hand-written UTF-8 step encoded a lone surrogate
// differently from TextEncoder, so the MD5 row and the SHA rows hashed different bytes); RFC 1321
// test vectors; every hash quoted on the English page, recomputed with node:crypto.
//
// Run: node scripts/test-hash-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HashGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/hash-generator/en.mdx'), 'utf8');
const start = source.indexOf('function md5(str)');
const end = source.indexOf('async function sha');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate md5() in HashGeneratorTool.astro');
  process.exit(1);
}
const md5 = new Function(source.slice(start, end) + '\nreturn md5;')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
const hex = (algo, bytes) => createHash(algo).update(Buffer.from(bytes)).digest('hex');
const utf8 = (s) => new TextEncoder().encode(s);

// RFC 1321 appendix A.5
for (const [input, want] of [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['a', '0cc175b9c0f1b6a831c399e269772661'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
]) eq('RFC 1321 ' + JSON.stringify(input), md5(input), want);

// random strings, including lone surrogates
const pool = ['a', 'Z', ' ', '\n', 'é', '中', '文', '😀', '👨‍👩‍👧', '\ud800', '\udfff', '\ud83d', '\u0000', '\u07ff', '\uffff'];
let seed = 12345;
const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
let mismatches = 0;
for (let i = 0; i < 3000; i++) {
  let s = '';
  const len = rand(80);
  for (let j = 0; j < len; j++) s += pool[rand(pool.length)];
  if (md5(s) !== hex('md5', utf8(s))) mismatches++;
}
eq('md5 equals node:crypto on TextEncoder bytes (3,000 strings)', mismatches, 0);
eq('lone surrogate hashed as EF BF BD', md5('a\ud800b'), hex('md5', [0x61, 0xef, 0xbf, 0xbd, 0x62]));

// values on the English page
const quoted = (v) => page.includes('`' + v + '`');
for (const algo of ['md5', 'sha1', 'sha256', 'sha384', 'sha512']) {
  eq('page: ' + algo + ' of hello', quoted(hex(algo, utf8('hello'))), true);
}
eq('page: md5 of hello via page function', quoted(md5('hello')), true);
eq('page: sha256 of hello + LF', page.includes(hex('sha256', utf8('hello\n'))), true);
eq('page: sha256 of empty string', quoted(hex('sha256', [])), true);
eq('page: 你好 UTF-8 bytes', page.includes('`e4 bd a0 e5 a5 bd`'), Buffer.from(utf8('你好')).toString('hex') === 'e4bda0e5a5bd');
eq('page: 你好 md5', quoted(md5('你好')), true);
eq('page: 你好 sha256', quoted(hex('sha256', utf8('你好'))), true);
eq('page: 你好 GBK md5', quoted(hex('md5', [0xc4, 0xe3, 0xba, 0xc3])), true);
eq('page: hello with BOM', quoted(hex('sha256', [0xef, 0xbb, 0xbf, ...utf8('hello')])), true);
eq('page: git blob id', quoted(hex('sha1', utf8('blob 6\0hello\n'))), true);
eq('page: plain sha1 of hello + LF', quoted(hex('sha1', utf8('hello\n'))), true);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
