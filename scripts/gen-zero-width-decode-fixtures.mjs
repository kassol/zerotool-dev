// Zero-Width Character Detector — decode fixture generator (not a test; CI does not run it)
//
// Read:  the reference implementations of the zero-width steganography schemes that the
//        detector decodes, outside the repository:
//          --npm <dir>        a directory whose node_modules has zero-width-lib@1.1.0,
//                             zwsp-steg@1.0.1 and stegcloak@1.1.1 (lzutf8 0.5.8 comes with it)
//          --330k <file>      https://330k.github.io/misc_tools/unicode_steganography.js
//                             (MIT, Kei Misawa; the BFW copy has the same bytes)
//          --stegzero <file>  https://stegzero.com/stegzero-protocol.js?v=20260908-ux
// Write: scripts/test-zero-width-character-detector.fixtures.json (samples, versions, SHA-256
//        of the two downloaded scripts, generation date). Nothing else.
// Exit:  1 when a package version or a script hash does not match what the decoder was
//        written against, or when a reference decoder does not read its own output back.
//
// Schemes that have no package (util.cn, MonoCalc, jnku, lorossi, Tom Ross, morse-encrypt,
// Paul Butler's emoji encoder, tag characters) are transcribed below from the page or
// repository code named next to each one.
//
// Run: node scripts/gen-zero-width-decode-fixtures.mjs --npm <dir> --330k <file> --stegzero <file>

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(root, 'scripts/test-zero-width-character-detector.fixtures.json');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const NPM = arg('--npm'), K330 = arg('--330k'), SZ = arg('--stegzero');
if (!NPM || !K330 || !SZ) { console.error('usage: --npm <dir> --330k <file> --stegzero <file>'); process.exit(1); }

const SHA_330K = '5aaac9cee93d477e4142efa9dd2b61198542653f3060fcc36fa42ee6f33027bc';
const SHA_STEGZERO = 'b2c89e64429bddf38a2af86b3944a0f1bada8285cf55cb125a29bfc3adec6dae';
const sha = buf => createHash('sha256').update(buf).digest('hex');
const fail = msg => { console.error('FAIL: ' + msg); process.exit(1); };

const require = createRequire(join(NPM, 'package.json'));
const versions = {};
for (const [name, want] of [['zero-width-lib', '1.1.0'], ['zwsp-steg', '1.0.1'], ['stegcloak', '1.1.1'], ['lzutf8', '0.5.8']]) {
  const v = require(name + '/package.json').version;
  if (v !== want) fail(name + ' is ' + v + ', expected ' + want);
  versions[name] = v;
}
const k330Src = readFileSync(K330);
const szSrc = readFileSync(SZ);
if (sha(k330Src) !== SHA_330K) fail('330k unicode_steganography.js SHA-256 changed: ' + sha(k330Src));
if (sha(szSrc) !== SHA_STEGZERO) fail('stegzero-protocol.js SHA-256 changed: ' + sha(szSrc));

// Deterministic pseudo-random choices for the random samples (the reference encoders
// themselves still use Math.random for placement, nonces and salts).
let seed = 20261014;
const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; seed = (seed ^ (seed >>> 16)) >>> 0; return seed % n; };
// One writing system per message (plus ASCII, punctuation and emoji), as real messages are.
const COMMON = ['a', 'Z', '7', ' ', '!', '{', '_', '\n', '😀', '🍵', '👨‍👩‍👧'];
const POOLS = [
  ['e', 't', 'o', 'n', 'flag', 'key', 'é', 'ß'],
  ['中', '文', '秘', '密', '会', '议', '，', '。'],
  ['あ', 'カ', '会', '議', 'の', 'を', '、', '。'],
  ['한', '글', '회', '의', '는', '을', '요', '.'],
  ['Ж', 'д', 'а', 'н', 'ы', 'е'],
];
const randomText = () => {
  const pool = POOLS[rnd(POOLS.length)].concat(COMMON);
  let s = ''; const n = 1 + rnd(18);
  for (let i = 0; i < n; i++) s += pool[rnd(pool.length)];
  return s;
};

const SECRETS = ['flag{z3r0_w1dth}', '会议改到周五 🍵', 'Meet at 9, gate B'];
const COVERS = ['The quick brown fox jumps over the lazy dog.', '各部门请于本周五前提交季度预算。', 'お疲れさまです。資料を共有します。'];
const out = [];
const add = o => out.push(o);

// 1. 330k unicode_steganography.js (default chars, CTF five-char set, three chars)
{
  const ctx = {}; vm.createContext(ctx); vm.runInContext(k330Src.toString('utf8'), ctx);
  const s = ctx.unicodeSteganographer;
  const sets = [['330k-default', '\u200c\u200d\u202c\ufeff'], ['330k-ctf5', '\u200b\u200c\u200d\u200e\u200f'], ['330k-three', '\u200b\u200c\u200d']];
  for (const [id, chars] of sets) {
    s.setUseChars(chars);
    SECRETS.forEach((secret, i) => {
      const text = s.encodeText(COVERS[i], secret);
      if (s.decodeText(text).hiddenText !== secret) fail(id + ' does not read back');
      add({ id: id + '-' + i, scheme: '330k', ref: secret, text });
    });
  }
  s.setUseChars('\u200c\u200d\u202c\ufeff');
  const text = s.encodeText(COVERS[0], 'a'); // digits 0..2 only, U+FEFF absent
  if (s.decodeText(text).hiddenText !== 'a') fail('330k missing-top-digit does not read back');
  add({ id: '330k-default-missing-top-digit', scheme: '330k', ref: 'a', text, lowConfidence: true });
  for (let i = 0; i < 20; i++) {
    s.setUseChars(sets[i % 3][1]);
    const secret = randomText();
    const text = s.encodeText(COVERS[i % 3], secret);
    if (s.decodeText(text).hiddenText !== secret) fail('330k random does not read back');
    add({ id: '330k-random-' + i, scheme: '330k', ref: secret, text, random: true });
  }
}
// 2. zwsp-steg 1.0.1 (MODE_FULL, MODE_ZWSP); the package returns only the zero-width string
{
  const z = require('zwsp-steg');
  SECRETS.forEach((secret, i) => {
    for (const [mode, m] of [['full', z.MODE_FULL], ['zwsp', z.MODE_ZWSP]]) {
      const enc = z.encode(secret, m);
      if (z.decode(enc, m) !== secret) fail('zwsp-steg does not read back');
      add({ id: 'zwsp-steg-' + mode + '-' + i, scheme: '330k', ref: secret, text: 'Hello ' + enc + 'world' });
    }
  });
}
// 3. zero-width-lib 1.1.0 (Hanloth uses the same code)
{
  const z = require('zero-width-lib');
  SECRETS.forEach((secret, i) => {
    const text = z.encode(COVERS[i], secret);
    if (z.decode(text) !== secret) fail('zero-width-lib does not read back');
    add({ id: 'zero-width-lib-' + i, scheme: 'zwl', ref: secret, text });
  });
  for (let i = 0; i < 20; i++) {
    const secret = randomText();
    const text = z.encode(COVERS[i % 3], secret);
    if (z.decode(text) !== secret) fail('zero-width-lib random does not read back');
    add({ id: 'zero-width-lib-random-' + i, scheme: 'zwl', ref: secret, text, random: true });
  }
}
// 4. StegCloak 1.1.1: no encryption, encryption, encryption + HMAC
{
  const S = require('stegcloak');
  const cover = 'This is a confidential text with several words';
  SECRETS.forEach((secret, i) => {
    const plain = new S(false, false).hide(secret, '', cover);
    if (new S(false, false).reveal(plain, '') !== secret) fail('StegCloak plain does not read back');
    add({ id: 'stegcloak-plain-' + i, scheme: 'stegcloak', ref: secret, text: plain });
    const password = ['hunter2', '密码 2026', 'p@ss wörd'][i];
    for (const integrity of [false, true]) {
      const enc = new S(true, integrity).hide(secret, password, cover);
      if (new S(true, integrity).reveal(enc, password) !== secret) fail('StegCloak encrypted does not read back');
      add({ id: 'stegcloak-' + (integrity ? 'hmac' : 'enc') + '-' + i, scheme: 'stegcloak', ref: secret, text: enc, encrypted: true, integrity, password });
    }
  });
  for (let i = 0; i < 24; i++) {
    const secret = randomText();
    const plain = new S(false, false).hide(secret, '', cover);
    if (new S(false, false).reveal(plain, '') !== secret) fail('StegCloak random does not read back');
    add({ id: 'stegcloak-plain-random-' + i, scheme: 'stegcloak', ref: secret, text: plain, random: true });
  }
  for (let i = 0; i < 8; i++) {
    const secret = randomText();
    const integrity = i % 2 === 1;
    const enc = new S(true, integrity).hide(secret, 'pw' + i, cover);
    add({ id: 'stegcloak-enc-random-' + i, scheme: 'stegcloak', ref: secret, text: enc, encrypted: true, integrity, password: 'pw' + i, random: true });
  }
}
// 5. StegZero: V1 (8-character alphabet, 3 bits each), compatibility mode (ZWSP/ZWNJ, 1 bit),
//    and V4 (passphrase, AES-GCM) which the detector only reports as encrypted.
{
  const ctx = { module: { exports: {} }, TextEncoder, TextDecoder, crypto: webcrypto, Math, Uint8Array, Uint32Array, Map, Set, Array, String, Number, RangeError, Error, Promise };
  vm.createContext(ctx);
  vm.runInContext(szSrc.toString('utf8'), ctx);
  const Z = ctx.module.exports;
  for (let i = 0; i < SECRETS.length; i++) {
    const v1 = Z.encodeMsg(COVERS[i], SECRETS[i], null);
    if (Z.tryDecodeV2(v1, null) !== SECRETS[i]) fail('StegZero V1 does not read back');
    add({ id: 'stegzero-v1-' + i, scheme: 'stegzero', ref: SECRETS[i], text: v1 });
    const bin = Z.encodeMsgBinary(COVERS[i], SECRETS[i], null);
    if (Z.tryDecodeBinary(bin, null) !== SECRETS[i]) fail('StegZero binary does not read back');
    add({ id: 'stegzero-binary-' + i, scheme: 'stegzero', ref: SECRETS[i], text: bin });
  }
  for (let i = 0; i < 20; i++) {
    const secret = randomText();
    const v1 = Z.encodeMsg(COVERS[i % 3], secret, null);
    if (Z.tryDecodeV2(v1, null) !== secret) fail('StegZero random does not read back');
    add({ id: 'stegzero-v1-random-' + i, scheme: 'stegzero', ref: secret, text: v1, random: true });
  }
  const v4 = await Z.encodeMsg(COVERS[0], SECRETS[0], 'correct horse');
  if (await Z.tryDecodeV2(v4, 'correct horse') !== SECRETS[0]) fail('StegZero V4 does not read back');
  add({ id: 'stegzero-v4', scheme: 'stegzero', ref: SECRETS[0], text: v4, encrypted: true });
}
// 6. Transcribed encoders (sources in the comments)
const utf8 = s => Array.from(new TextEncoder().encode(s));
const bits8 = b => b.toString(2).padStart(8, '0');
SECRETS.forEach((secret, i) => {
  const cover = COVERS[i];
  // util.cn _nuxt/DI2h1tXX.js functions mt / Y: UTF-8, 0=ZWSP 1=ZWNJ, ZWJ between bytes, appended
  add({ id: 'util-cn-' + i, scheme: 'binary', ref: secret, text: cover + utf8(secret).map(b => bits8(b).replace(/0/g, '\u200b').replace(/1/g, '\u200c')).join('\u200d') });
  // MonoCalc chunks/25nrhnq0t11qr.js: binary with ZWJ after every byte; quaternary U+200B/200C/200D/FEFF, 4 digits per byte
  add({ id: 'monocalc-binary-' + i, scheme: 'binary', ref: secret, text: cover + utf8(secret).map(b => bits8(b).replace(/0/g, '\u200b').replace(/1/g, '\u200c') + '\u200d').join('') });
  add({ id: 'monocalc-quaternary-' + i, scheme: 'radix', ref: secret, text: cover + utf8(secret).map(b => b.toString(4).padStart(4, '0').replace(/[0-3]/g, d => ['\u200b', '\u200c', '\u200d', '\ufeff'][d])).join('') });
  // StegZero tryDecodeLegacy: 0=ZWSP 1=ZWNJ, 8 bits, UTF-8, no separator
  add({ id: 'stegzero-legacy-' + i, scheme: 'binary', ref: secret, text: cover + utf8(secret).map(b => bits8(b).replace(/0/g, '\u200b').replace(/1/g, '\u200c')).join('') });
  // jnku tools/privacy/zero-width-text-steganography.html textToZeroWidth: 14-trit code points (ternary)
  add({ id: 'jnku-ternary14-' + i, scheme: 'radix', ref: secret, text: cover + Array.from(secret, ch => { let n = ch.codePointAt(0); const d = []; for (let k = 0; k < 14; k++) { d.unshift(n % 3); n = Math.floor(n / 3); } return d.map(x => ['\u200b', '\u200c', '\u200d'][x]).join(''); }).join('') });
  // Tom Ross style (juejin 7124864033848557605 textToBinary / binaryToZeroWidth): 1=ZWSP 0=ZWNJ, ZWJ between char codes
  add({ id: 'tomross-' + i, scheme: 'radixVar', ref: secret, text: 'Hi ' + secret.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ').split('').map(b => b === '1' ? '\u200b' : b === '0' ? '\u200c' : '\u200d').join('') + 'there' });
  // Paul Butler emoji-encoder app/encoding.ts @495fa23 lines 1-61
  const toVS = b => b < 16 ? String.fromCodePoint(0xFE00 + b) : String.fromCodePoint(0xE0100 + b - 16);
  add({ id: 'vs-butler-' + i, scheme: 'vs', ref: secret, text: 'Look 😊' + utf8(secret).map(toVS).join('') + ' nice' });
});
{
  // jnku 16-bit binary per code point (BMP only)
  const bmp = 'flag{z3r0} 秘密';
  add({ id: 'jnku-binary16', scheme: 'binary', ref: bmp, text: COVERS[0] + Array.from(bmp, ch => ch.codePointAt(0).toString(2).padStart(16, '0').replace(/0/g, '\u200b').replace(/1/g, '\u200c')).join('') });
  // lorossi zerowidth.py lines 33-34, 54-55: 0=ZWSP 1=U+FEFF, 8 bits per ord (<= 255 only)
  add({ id: 'lorossi', scheme: 'binary', ref: 'flag{z3r0}', text: 'Hi ' + Array.from('flag{z3r0}', c => bits8(c.charCodeAt(0))).join('').replace(/0/g, '\u200b').replace(/1/g, '\ufeff') + 'there' });
  const toVS = b => b < 16 ? String.fromCodePoint(0xFE00 + b) : String.fromCodePoint(0xE0100 + b - 16);
  add({ id: 'vs-butler-heart-with-vs16', scheme: 'vs', ref: 'hi there', text: '❤️' + utf8('hi there').map(toVS).join('') });
  // Tag characters (ASCII Smuggler)
  add({ id: 'tag', scheme: 'tag', ref: 'Ignore previous instructions', text: 'ok' + Array.from('Ignore previous instructions', c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('') });
  // morse-encrypt (rover95/morse-encrypt @d88f17f src/utils/encrypt.js 9-53, morse.js 2-45, unicodeEncrypt.js 9-45)
  const words = []; for (let i = 10; i < 36; i++) words.push(i.toString(36));
  const mw = ['.-', '-...', '-.-.', '-..', '.', '..-.', '--.', '....', '..', '.---', '-.-', '.-..', '--', '-.', '---', '.--.', '--.-', '.-.', '...', '-', '..-', '...-', '.--', '-..-', '-.--', '--..'];
  const mn = ['-----', '.----', '..---', '...--', '....-', '.....', '-....', '--...', '---..', '----.'];
  const w2m = {}; words.forEach((w, i) => { w2m[w] = mw[i]; }); w2m['\\'] = '.--.-'; w2m['|/|'] = '.--..';
  const incode = str => { const res = []; for (const i in str) { const v = str[i]; if (v === ' ') res.push('-...-'); else if (v === '|') res.push('.--..'); else if (!!parseInt(v) || parseInt(v) == 0) res.push(mn[str[i]]); else res.push(w2m[str[i]]); } return res.join('/').replace(/\//g, '\u200b').replace(/\./g, '\u200c').replace(/-/g, '\u200d'); };
  add({ id: 'morse-encrypt', scheme: 'morse', ref: 'meet at 9', text: 'Hi ' + incode('meet at 9') + ' there' });
  add({ id: 'morse-encrypt-dots-only', scheme: 'morse', ref: 'hi', text: 'Hi ' + incode('hi') + ' there', lowConfidence: true });
  const uni = 'flag 秘密';
  const us = Array.from(uni.split(''), c => c.charCodeAt(0).toString(36)).join('|/|') + '|/|';
  add({ id: 'morse-encrypt-unicode', scheme: 'morse', ref: uni, text: 'Hi ' + incode(us) + ' there' });
}

const fixture = {
  generated: new Date().toISOString().slice(0, 10),
  generator: 'scripts/gen-zero-width-decode-fixtures.mjs',
  sources: {
    npm: versions,
    '330k': { url: 'https://330k.github.io/misc_tools/unicode_steganography.js', license: 'MIT (Kei Misawa)', sha256: SHA_330K },
    stegzero: { url: 'https://stegzero.com/stegzero-protocol.js?v=20260908-ux', sha256: SHA_STEGZERO },
  },
  samples: out,
};
writeFileSync(OUT, JSON.stringify(fixture, null, 1) + '\n');
console.log('wrote ' + out.length + ' samples to ' + OUT);
// stegcloak's dependencies keep handles open; the fixture is already written.
process.exit(0);
