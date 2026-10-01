// File Hash Checker — streaming hash worker, expected-hash parsing and verification
//
// Read:  public/vendor/file-hash-worker.js and public/vendor/hash-wasm.min.js (run in a
//        vm context the way a browser worker runs them), and
//        src/components/tools/FileHashCheckerTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS table), so the
//        test cannot drift from the shipped source
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Run: node scripts/test-file-hash-checker.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workerSrc = readFileSync(join(root, 'public/vendor/file-hash-worker.js'), 'utf8');
const vendorSrc = readFileSync(join(root, 'public/vendor/hash-wasm.min.js'), 'utf8');
const componentSrc = readFileSync(join(root, 'src/components/tools/FileHashCheckerTool.astro'), 'utf8');

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

// ---------- worker in a vm context, as a browser worker runs it ----------
const posted = [];
const ctx = {
  console, Uint8Array, ArrayBuffer, DataView, WebAssembly, TextEncoder, Promise, Error,
  importScripts(path) {
    if (path !== '/vendor/hash-wasm.min.js') throw new Error('unexpected importScripts ' + path);
    vm.runInContext(vendorSrc, ctx, { filename: path });
  },
  postMessage(m) { posted.push(m); },
};
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(workerSrc, ctx, { filename: 'file-hash-worker.js' });
const hashBlob = (blob, algo, onProgress) => vm.runInContext('hashBlob', ctx)(blob, algo, onProgress);

const ALGOS = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'];
const NODE = { 'MD5': 'md5', 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512' };
function crc32Ref(buf) {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
const ref = (algo, buf) => algo === 'CRC32' ? crc32Ref(buf) : createHash(NODE[algo]).update(buf).digest('hex');

// A Blob whose stream has no BYOB support, to cover the default-reader path.
function plainStreamBlob(buf, pieces) {
  return {
    size: buf.length,
    stream() {
      let i = 0;
      return new ReadableStream({
        pull(controller) {
          if (i >= pieces.length) { controller.close(); return; }
          controller.enqueue(new Uint8Array(buf.subarray(pieces[i][0], pieces[i][1])));
          i++;
        },
      });
    },
  };
}

// FIPS 180-2 / RFC 1321 / CRC-32 check values, written out literally.
const abc = Buffer.from('abc');
const empty = Buffer.alloc(0);
const two = Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
const million = Buffer.alloc(1000000, 'a');
const VECTORS = [
  ['MD5', empty, 'd41d8cd98f00b204e9800998ecf8427e'],
  ['MD5', abc, '900150983cd24fb0d6963f7d28e17f72'],
  ['MD5', million, '7707d6ae4e027c70eea2a935c2296f21'],
  ['SHA-1', empty, 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
  ['SHA-1', abc, 'a9993e364706816aba3e25717850c26c9cd0d89d'],
  ['SHA-1', two, '84983e441c3bd26ebaae4aa1f95129e5e54670f1'],
  ['SHA-1', million, '34aa973cd4c4daa4f61eeb2bdbad27316534016f'],
  ['SHA-256', empty, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['SHA-256', abc, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['SHA-256', two, '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
  ['SHA-256', million, 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ['SHA-384', abc, 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7'],
  ['SHA-384', million, '9d0e1809716474cb086e834e310a4a1ced149e9c00f248527972cec5704c2a5b07b8b3dc38ecc4ebae97ddd87f3d8985'],
  ['SHA-512', abc, 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f'],
  ['SHA-512', million, 'e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b'],
  ['CRC32', Buffer.from('123456789'), 'cbf43926'],
  ['CRC32', empty, '00000000'],
];
for (const [algo, data, hex] of VECTORS) {
  eq('vector ' + algo + ' (' + data.length + ' bytes)', await hashBlob(new Blob([data]), algo), hex);
  eq('vector ' + algo + ' (' + data.length + ' bytes, default reader)', await hashBlob(plainStreamBlob(data, data.length ? [[0, data.length]] : []), algo), hex);
}

// Random data across chunk boundaries and odd piece sizes, against node:crypto.
const big = randomBytes(3 * 1048576 + 12345);
for (const algo of ALGOS) {
  eq('random 3 MB ' + algo, await hashBlob(new Blob([big]), algo), ref(algo, big));
  const pieces = [];
  for (let o = 0, k = 1; o < big.length; k = (k * 7 + 3) % 200003 + 1) { pieces.push([o, Math.min(big.length, o + k)]); o += k; }
  eq('random 3 MB ' + algo + ' in ' + pieces.length + ' uneven pieces', await hashBlob(plainStreamBlob(big, pieces), algo), ref(algo, big));
}

// Progress reports increase and end at the size; a stream shorter than blob.size is an error.
{
  const seen = [];
  const big2 = randomBytes(40 * 1048576);
  await hashBlob(new Blob([big2]), 'CRC32', (n) => seen.push(n));
  check('progress is increasing', seen.every((n, i) => i === 0 || n > seen[i - 1]), JSON.stringify(seen));
  eq('progress ends at the size', seen[seen.length - 1], big2.length);
  check('progress reported a few times for 40 MB', seen.length >= 2 && seen.length <= 5, seen.length);
  const short = plainStreamBlob(abc, [[0, 2]]);
  let err = null;
  try { await hashBlob(short, 'SHA-256'); } catch (e) { err = e; }
  check('a stream shorter than the file size is an error', err && /2 of 3 bytes/.test(err.message), err && err.message);
  let err2 = null;
  try { await hashBlob(new Blob([abc]), 'SHA-224'); } catch (e) { err2 = e; }
  check('unknown algorithm is an error', err2 && /Unsupported algorithm/.test(err2.message));
}

// Message protocol.
{
  posted.length = 0;
  ctx.onmessage({ data: { id: 7, file: new Blob([abc]), algo: 'MD5' } });
  await new Promise((r) => setTimeout(r, 50));
  const done = posted.find((m) => m.type === 'done');
  eq('worker posts done with id and hex', done, { id: 7, type: 'done', hex: '900150983cd24fb0d6963f7d28e17f72' });
  posted.length = 0;
  ctx.onmessage({ data: { id: 8, file: new Blob([abc]), algo: 'BLAKE3' } });
  await new Promise((r) => setTimeout(r, 50));
  check('worker posts error for an unsupported algorithm', posted.some((m) => m.id === 8 && m.type === 'error'));
}

// ---------- component engine: expected-hash parsing, verification, output ----------
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const si = componentSrc.indexOf(START_MARK);
const ei = componentSrc.indexOf(END_MARK);
check('component has an engine block', si >= 0 && ei > si);
const E = si >= 0 && ei > si ? new Function(componentSrc.slice(si, ei) + `
return { ALGOS, MAX_LIST_BYTES, normalizeHexInput, parseExpected, verify, checksumLines, checksumFileName,
  firstDiff, formatBytes, formatDuration, fill, plural, listHint, relPathKey };`)() : null;
const P = (text, listName) => E.parseExpected(text, listName);
const pick = (r) => r.entries.map((e) => [e.algo, e.hex, e.name]);
const codes = (r) => r.problems.map((p) => p.code + '@' + p.line);

const H256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const H256B = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const MD5E = 'd41d8cd98f00b204e9800998ecf8427e';
const SHA1E = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const SHA384A = 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7';
const SHA512A = 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f';

if (E) {
  eq('algorithm table', E.ALGOS.map((a) => a.id + ':' + a.hex), ['SHA-256:64', 'SHA-1:40', 'SHA-384:96', 'SHA-512:128', 'MD5:32', 'CRC32:8']);

  // Bare values: case, whitespace, full-width (NFKC), length decides the algorithm.
  eq('bare SHA-256', pick(P(H256)), [['SHA-256', H256, null]]);
  eq('uppercase hex', pick(P(H256.toUpperCase())), [['SHA-256', H256, null]]);
  eq('surrounding spaces and newlines', pick(P('\n  ' + H256 + '  \n')), [['SHA-256', H256, null]]);
  eq('full-width digits and letters', pick(P(H256.replace(/[0-9a-f]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)))), [['SHA-256', H256, null]]);
  eq('MD5 / SHA-1 / SHA-384 / SHA-512 / CRC32 by length', pick(P([MD5E, SHA1E, SHA384A, SHA512A, 'CBF43926'].join('\n'))),
    [['MD5', MD5E, null], ['SHA-1', SHA1E, null], ['SHA-384', SHA384A, null], ['SHA-512', SHA512A, null], ['CRC32', 'cbf43926', null]]);
  eq('empty input', [P('').entries.length, P('').problems.length], [0, 0]);
  eq('text without a hash', codes(P('see the release page')), ['none@0']);
  eq('an 8-letter hex word inside a sentence is not a CRC32', pick(P('the deadbeef test file ' + H256)), [['SHA-256', H256, null]]);
  eq('hex inside a URL path is ignored', P('https://example.com/' + H256 + '/x.iso').entries.length, 0);

  // Wrong lengths and typos are reported, never matched as a substring (the old checker
  // stripped spaces and looked for the computed hash inside the pasted text, so a value
  // with an extra character still "matched").
  eq('65 hex digits', codes(P(H256 + 'a')), ['length@1']);
  eq('63 hex digits', codes(P(H256.slice(1))), ['length@1']);
  eq('65 hex digits gives the count', P(H256 + 'a').problems[0].len, 65);
  eq('one letter O inside a SHA-256', codes(P(H256.slice(0, 10) + 'O' + H256.slice(11))), ['badChar@1']);
  eq('badChar position is 1-based', P(H256.slice(0, 10) + 'O' + H256.slice(11)).problems[0].pos, 11);

  // GNU coreutils lines and SHA256SUMS files.
  eq('sha256sum line', pick(P(H256 + '  ubuntu.iso')), [['SHA-256', H256, 'ubuntu.iso']]);
  eq('binary-mode marker', pick(P(H256 + ' *ubuntu.iso')), [['SHA-256', H256, 'ubuntu.iso']]);
  eq('name with spaces', pick(P(H256 + '  My Setup 1.0.exe')), [['SHA-256', H256, 'My Setup 1.0.exe']]);
  eq('escaped name (coreutils backslash form)', pick(P('\\' + H256 + '  a\\\\b\\nc')), [['SHA-256', H256, 'a\\b\nc']]);
  const sums = '# comment\r\n' + H256 + '  empty.bin\r\n\r\n' + H256B + '  abc.txt\r\n';
  eq('SHA256SUMS with CRLF, blank line and comment', pick(P(sums)), [['SHA-256', H256, 'empty.bin'], ['SHA-256', H256B, 'abc.txt']]);
  eq('entries keep their line numbers', P(sums).entries.map((e) => e.line), [2, 4]);

  // BSD / OpenSSL tagged lines name the algorithm.
  eq('shasum --tag', pick(P('SHA256 (node.tar.gz) = ' + H256)), [['SHA-256', H256, 'node.tar.gz']]);
  eq('OpenSSL 3 dgst', pick(P('SHA2-256(node.tar.gz)= ' + H256)), [['SHA-256', H256, 'node.tar.gz']]);
  eq('BSD md5', pick(P('MD5 (a b.txt) = ' + MD5E)), [['MD5', MD5E, 'a b.txt']]);
  eq('tagged entries are marked hinted', P('SHA512 (x) = ' + SHA512A).entries[0].hinted, true);
  eq('label and length disagree', codes(P('SHA256 (x) = ' + SHA1E)), ['label@1']);
  eq('SHA3 is unsupported', codes(P('SHA3-256 (x) = ' + H256)), ['unsupported@1']);
  eq('SHA-224 by length is unsupported', codes(P('d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f')), ['unsupported@1']);
  eq('b2sums list is unsupported', codes(P(SHA512A + '  x.iso', 'b2sums.txt')), ['unsupported@1']);
  eq('SHA384 tag is not SHA3', pick(P('SHA384 (x) = ' + SHA384A)), [['SHA-384', SHA384A, 'x']]);
  eq('SHA384SUMS hint is not SHA3', E.listHint('SHA384SUMS'), 'SHA-384');
  eq('sha3-256sums hint', E.listHint('sha3-256sums.txt'), 'unsupported:SHA3');
  eq('8 hex digits then words is not a CRC32 line', P('cafebabe is a magic number').entries.length, 0);
  eq('list name gives the algorithm', P(SHA512A + '  x.iso', 'SHA512SUMS').entries[0].hinted, true);

  // Windows: certutil (Windows 10+ and the older spaced form) and Get-FileHash.
  const certutil = 'SHA256 hash of C:\\Users\\me\\Downloads\\x.iso:\r\n' + H256 + '\r\nCertUtil: -hashfile command completed successfully.\r\n';
  eq('certutil output', pick(P(certutil)), [['SHA-256', H256, 'x.iso']]);
  const spaced = 'SHA256 hash of x.iso:\n' + H256.match(/../g).join(' ') + '\nCertUtil: -hashfile command completed successfully.';
  eq('certutil spaced bytes', pick(P(spaced)), [['SHA-256', H256, 'x.iso']]);
  eq('Get-FileHash list', pick(P('Algorithm : SHA256\nHash      : ' + H256.toUpperCase() + '\nPath      : C:\\x\\file.iso')), [['SHA-256', H256, 'file.iso']]);
  eq('Get-FileHash table', pick(P('Algorithm       Hash                                                                   Path\n---------       ----                                                                   ----\nSHA256          ' + H256.toUpperCase() + '       C:\\x\\file.iso')), [['SHA-256', H256, null]]);
  const gpg = 'apache.tar.gz: ' + SHA512A.toUpperCase().match(/.{8}/g).slice(0, 8).join(' ') + '\n               ' + SHA512A.toUpperCase().match(/.{8}/g).slice(8).join(' ');
  eq('gpg --print-md, wrapped', pick(P(gpg)), [['SHA-512', SHA512A, 'apache.tar.gz']]);

  // Base64, SRI, prefixed digests.
  eq('Base64 SHA-256', pick(P('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')), [['SHA-256', H256, null]]);
  eq('Base64 MD5', pick(P('1B2M2Y8AsgTpgAmY7PhCfg==')), [['MD5', MD5E, null]]);
  eq('Base64url without padding', pick(P('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU')), [['SHA-256', H256, null]]);
  eq('SRI sha512 in package-lock', pick(P('"integrity": "sha512-' + Buffer.from(SHA512A, 'hex').toString('base64') + '",')), [['SHA-512', SHA512A, null]]);
  eq('SRI sha384', pick(P('sha384-' + Buffer.from(SHA384A, 'hex').toString('base64'))), [['SHA-384', SHA384A, null]]);
  eq('docker digest', pick(P('ubuntu@sha256:' + H256)), [['SHA-256', H256, null]]);
  eq('64 hex digits are hex, not Base64 SHA-384', pick(P(H256)), [['SHA-256', H256, null]]);
  eq('SFV line', pick(P('; made by a tool\ngame.zip 1A2B3C4D')), [['CRC32', '1a2b3c4d', 'game.zip']]);

  // ---------- verification ----------
  const f = (key, path, hashes, size) => ({ key, name: path.split('/').pop(), path, size: size || 0, hashes });
  const v1 = E.verify(P(H256B), [f('a', 'abc.txt', { 'SHA-256': H256B })]);
  eq('bare match', v1.files.a.status, 'ok');
  eq('bare match reason', v1.files.a.notes[0].code, 'okBare');
  const v2 = E.verify(P(H256), [f('a', 'abc.txt', { 'SHA-256': H256B })]);
  eq('bare mismatch', v2.files.a.status, 'fail');
  eq('first difference (1-based)', v2.files.a.notes[0].pos, E.firstDiff(H256, H256B) + 1);
  eq('pending until the algorithm is computed', E.verify(P(MD5E), [f('a', 'x', { 'SHA-256': H256 })]).files.a.status, 'pending');
  eq('needed algorithms', [...E.verify(P(MD5E + '\n' + SHA512A), [f('a', 'x', {})]).need].sort(), ['MD5', 'SHA-512']);

  const list = P(H256 + '  empty.bin\n' + H256B + '  abc.txt\n' + SHA1E.padEnd(64, '0') + '  other.iso\n');
  const v3 = E.verify(list, [f('a', 'abc.txt', { 'SHA-256': H256B }), f('b', 'empty.bin', { 'SHA-256': H256B })]);
  eq('named entry OK', v3.files.a.status, 'ok');
  eq('named entry FAILED', v3.files.b.status, 'fail');
  eq('summary counts', [v3.summary.ok, v3.summary.fail, v3.summary.missing], [1, 1, 1]);
  eq('missing names', v3.summary.missingNames, ['other.iso']);
  const v4 = E.verify(list, [f('a', 'abc (1).txt', { 'SHA-256': H256B })]);
  eq('renamed download matches by value', [v4.files.a.status, v4.files.a.notes[0].code, v4.files.a.notes[0].name], ['ok', 'okRenamed', 'abc.txt']);
  const v5 = E.verify(list, [f('a', 'readme.md', { 'SHA-256': H256B.replace('b', 'c') })]);
  eq('file not in the list', v5.files.a.status, 'nolist');
  eq('path match: ./ prefix and folder suffix', E.verify(P(H256 + '  ./iso/empty.bin'), [f('a', 'downloads/iso/empty.bin', { 'SHA-256': H256 })]).files.a.notes[0].code, 'okNamed');
  eq('path match: Windows separators', E.verify(P(H256 + '  iso\\empty.bin'), [f('a', 'iso/empty.bin', { 'SHA-256': H256 })]).files.a.status, 'ok');
  eq('path match: case-insensitive fallback', E.verify(P(H256 + '  EMPTY.BIN'), [f('a', 'empty.bin', { 'SHA-256': H256 })]).files.a.status, 'ok');
  // Same base name in several folders of a list (Firefox SHA512SUMS: win64/ja/… and win64/ko/…):
  // a file chosen without its folder must be compared with every entry of that name.
  const ffList = P(SHA512A + '  win64/ja/Firefox Setup 157.0.exe\n' + SHA512A.replace('d', 'e') + '  win64/ko/Firefox Setup 157.0.exe\n', 'SHA512SUMS');
  const vff = E.verify(ffList, [f('a', 'Firefox Setup 157.0.exe', { 'SHA-512': SHA512A.replace('d', 'e') })]);
  eq('same base name in two folders: the matching entry wins', [vff.files.a.status, vff.files.a.notes[0].name], ['ok', 'win64/ko/Firefox Setup 157.0.exe']);
  const vff2 = E.verify(ffList, [f('a', 'ja/Firefox Setup 157.0.exe', { 'SHA-512': SHA512A.replace('d', 'e') })]);
  eq('a longer path picks its own entry', vff2.files.a.status, 'fail');
  const hOf = (i) => createHash('sha256').update(String(i)).digest('hex');
  const many = P(Array.from({ length: 5000 }, (_, i) => hOf(i) + '  dir/file-' + i + '.bin').join('\n'));
  const manyFiles = Array.from({ length: 1000 }, (_, i) => f('k' + i, 'file-' + i + '.bin', { 'SHA-256': hOf(i) }));
  const t0 = performance.now();
  const vm2 = E.verify(many, manyFiles);
  const ms = performance.now() - t0;
  check('5,000-line list × 1,000 files verifies in under 1 s', ms < 1000, ms.toFixed(0) + ' ms');
  eq('5,000-line list × 1,000 files', [vm2.summary.ok, vm2.summary.missing], [1000, 4000]);
  const v6 = E.verify(P(H256), [f('a', 'x', { 'SHA-256': H256B }), f('b', 'y', { 'SHA-256': H256B })]);
  eq('bare value with several files: none match', [v6.files.a.status, v6.summary.bareNoMatch], ['nomatch', 1]);
  const v7 = E.verify(P(H256), [f('a', 'x', { 'SHA-256': H256B }), f('b', 'y', { 'SHA-256': H256 })]);
  eq('bare value with several files: one matches', [v7.files.a.status, v7.files.b.status], ['nomatch', 'ok']);
  eq('unhinted 64-digit mismatch mentions other algorithms', v2.files.a.notes[0].maybeOther, true);
  eq('a named list line does not', v3.files.b.notes[0].maybeOther, false);
  eq('tagged mismatch does not', E.verify(P('SHA256 (abc.txt) = ' + H256), [f('a', 'abc.txt', { 'SHA-256': H256B })]).files.a.notes[0].maybeOther, false);

  // ---------- output ----------
  const files = [f('a', 'abc.txt', { 'SHA-256': H256B }), f('b', 'dir/empty.bin', { 'SHA-256': H256 }), f('c', 'pending', {})];
  eq('checksum lines (GNU format, two spaces)', E.checksumLines(files, 'SHA-256', false), H256B + '  abc.txt\n' + H256 + '  dir/empty.bin\n');
  eq('uppercase output', E.checksumLines(files.slice(0, 1), 'SHA-256', true), H256B.toUpperCase() + '  abc.txt\n');
  eq('escaped names', E.checksumLines([f('a', 'a\\b\nc', { 'MD5': MD5E })], 'MD5', false), '\\' + MD5E + '  a\\\\b\\nc\n');
  eq('round trip through the parser', pick(P(E.checksumLines([f('a', 'a\\b\nc', { 'MD5': MD5E })], 'MD5', false))), [['MD5', MD5E, 'a\\b\nc']]);
  eq('checksum file names', ['SHA-256', 'SHA-1', 'SHA-384', 'SHA-512', 'MD5', 'CRC32'].map(E.checksumFileName), ['SHA256SUMS', 'SHA1SUMS', 'SHA384SUMS', 'SHA512SUMS', 'MD5SUMS', 'checksums.sfv']);
  eq('CRC32 output is SFV', E.checksumLines([f('a', 'game.zip', { 'CRC32': '1a2b3c4d' })], 'CRC32', false), 'game.zip 1a2b3c4d\n');
  eq('list hints', ['SHA256SUMS', 'node-v22.tar.gz.sha256', 'MD5SUMS', 'x.sha512', 'b2sums.txt', 'game.sfv', 'notes.txt'].map(E.listHint),
    ['SHA-256', 'SHA-256', 'MD5', 'SHA-512', 'unsupported:BLAKE2', 'CRC32', null]);
  eq('relative path key strips ./ and backslashes', E.relPathKey('.\\iso\\x.iso'), 'iso/x.iso');
  eq('format bytes', [0, 1023, 1536, 1073741824, 3221225472].map((n) => E.formatBytes(n, 'en')), ['0 B', '1,023 B', '1.5 KB', '1 GB', '3 GB']);
  eq('format duration', [0.4, 4.05, 75, 3725].map((x) => E.formatDuration(x)), ['0.4 s', '4.1 s', '1 min 15 s', '1 h 2 min']);

  // Real interoperability: shasum -c accepts what the tool writes.
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const probe = spawnSync('shasum', ['--version']);
  if (probe.status === 0) {
    const dir = mkdtempSync(join(tmpdir(), 'fhc-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'abc.txt'), 'abc');
      writeFileSync(join(dir, 'sub', 'a b.bin'), '');
      const out = E.checksumLines([f('a', 'abc.txt', { 'SHA-256': H256B }), f('b', 'sub/a b.bin', { 'SHA-256': H256 })], 'SHA-256', false);
      writeFileSync(join(dir, 'SHA256SUMS'), out);
      const r = spawnSync('shasum', ['-a', '256', '-c', 'SHA256SUMS'], { cwd: dir });
      eq('shasum -a 256 -c accepts the output', [r.status, r.stdout.toString()], [0, 'abc.txt: OK\nsub/a b.bin: OK\n']);
      const r2 = spawnSync('shasum', ['-a', '256', 'abc.txt'], { cwd: dir });
      eq('shasum output parses', pick(P(r2.stdout.toString())), [['SHA-256', H256B, 'abc.txt']]);
      const r3 = spawnSync('shasum', ['-a', '256', '--tag', 'abc.txt'], { cwd: dir });
      eq('shasum --tag output parses', pick(P(r3.stdout.toString())), [['SHA-256', H256B, 'abc.txt']]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  } else {
    console.log('SKIP: shasum not found');
  }
}

// ---------- 4-language strings ----------
{
  const s0 = componentSrc.indexOf('const STRINGS = ');
  const s1 = componentSrc.indexOf('} as const;');
  check('component has a STRINGS table', s0 >= 0 && s1 > s0);
  if (s0 >= 0 && s1 > s0) {
    const STRINGS = new Function('return ' + componentSrc.slice(s0 + 'const STRINGS = '.length, s1 + 1))();
    const keys = Object.keys(STRINGS.en).sort();
    for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' has the same keys as en', Object.keys(STRINGS[lang]).sort(), keys);
    const ph = (v) => JSON.stringify([...new Set((Array.isArray(v) ? v.join('|') : v).match(/\{[a-z]+\}/gi) || [])].sort());
    for (const lang of ['zh', 'ja', 'ko']) {
      for (const k of keys) check(lang + '.' + k + ' placeholders', ph(STRINGS[lang][k]) === ph(STRINGS.en[k]), ph(STRINGS[lang][k]) + ' vs ' + ph(STRINGS.en[k]));
    }
  }
}

// ---------- privacy: no network, no storage ----------
for (const [name, src] of [['worker', workerSrc], ['component', componentSrc]]) {
  for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'localStorage', 'sessionStorage', 'indexedDB', 'caches.', 'document.cookie', 'ztPersist', 'WebSocket', 'EventSource']) {
    check(name + ' does not use ' + bad, !src.includes(bad));
  }
}
check('worker imports only the vendored hash-wasm', (workerSrc.match(/importScripts\(/g) || []).length === 1);
check('component never reads a whole file into memory', !/\.arrayBuffer\(\)/.test(componentSrc));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
