// AES Encrypt / Decrypt — AES-256-GCM with a password (PBKDF2) or a raw key, text and files
//
// Read:  src/components/tools/AesEncryptDecryptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the frontmatter STRINGS table,
//        so this test cannot drift from the shipped source);
//        src/content/blog/aes-encrypt-decrypt-guide/{lang}.mdx and
//        src/content/tools/aes-encrypt-decrypt/{lang}.mdx (JavaScript / Python blocks are run)
// Write: stdout only (test results); temporary files under the OS temp dir for openssl
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: NIST SP 800-38D (GCM: 96-bit IV recommended, §5.2.1.1 / §8.2; 128-bit tag, §5.2.1.2);
// OWASP Password Storage Cheat Sheet (PBKDF2-HMAC-SHA256, 600,000 iterations); RFC 4648 §4
// (Base64 alphabet, padding) and §5 (URL-safe alphabet); WHATWG Encoding "UTF-8 decode" with
// fatal errors; OpenSSL enc(1) (header "Salted__" + 8-byte salt, AES-CBC, no GCM support).
//
// Covers:
// - Password format: "v2:" + Base64(salt 16 | iv 12 | ciphertext | tag 16), PBKDF2-HMAC-SHA256
//   600,000 iterations, checked by an independent Web Crypto decrypt (200,000 must fail).
//   Unprefixed text is the old format (200,000 iterations); the LEGACY fixtures were produced by
//   the pre-fix component code (commit 7382bab) and must still decrypt. Unprefixed text that is
//   not the old format is tried at 600,000 iterations (same layout, used by other tools and by
//   code that drops the prefix); before the fix it failed.
// - Error codes instead of one generic message: auth (wrong password / key, tampered, truncated
//   tag), short (fewer bytes than salt + iv + tag; before: the check was < 29 bytes), base64
//   (character and position; before: atob's English message), base64Length, hex (odd length),
//   version (unknown vN:), openssl (OpenSSL enc / CryptoJS "Salted__" data, Base64 or hex),
//   utf8 (decrypted bytes that are not UTF-8; before: TextDecoder replaced them with U+FFFD).
// - Output encoding Base64 or hex; decryption detects hex by its alphabet.
// - Raw key mode: hex or Base64 key of 16 / 24 / 32 bytes, output Base64(iv 12 | ciphertext |
//   tag), the layout of Go's gcm.Seal(nonce, nonce, …) and of Python AESGCM with the nonce in
//   front; key errors name the character or the byte count.
// - Files: password mode writes ASCII "v2:" + binary payload, raw key mode writes the binary
//   payload; decrypting a file accepts both and a text ciphertext saved to a file.
// - Fresh salt and IV per encryption (1,000 IVs, no repeats).
// - openssl CLI cannot read the tool output (no GCM in enc) — shown by running openssl.
// - Guide and tool page code blocks interoperate with the tool (JS always, Python when
//   python3 with cryptography exists).
// - 4-language STRINGS tables have the same keys and the same {placeholders}.
//
// Run: node scripts/test-aes-encrypt-decrypt.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AesEncryptDecryptTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in AesEncryptDecryptTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const names = ['encryptText', 'decryptText', 'decryptInput', 'encryptFile', 'decryptFile', 'parseRawKey', 'parseIv', 'generateRawKey', 'bytesToBase64', 'bytesToHex'];
const E = new Function(block + '\nreturn {' + names.map((n) => n + ': typeof ' + n + " === 'function' ? " + n + ' : undefined').join(',') + '};')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
async function rejects(name, p, code) {
  try { await p; check(name, false, 'no error'); return null; } catch (e) {
    if (code) check(name + ' (code ' + code + ')', e && e.code === code, e && (e.code + ' / ' + e.message));
    else check(name, true);
    return e;
  }
}
function need(fn) {
  if (typeof E[fn] !== 'function') { check('engine exports ' + fn, false, 'missing'); return false; }
  return true;
}

// Produced by the pre-fix encrypt handler (PBKDF2-SHA256, 200,000 iterations, no prefix)
const LEGACY = [
  { password: 'correct horse battery staple', plaintext: 'Hello, 世界 🌍', ciphertext: 'Lbo+/GmvJFI9+heOHzyYFnc1XrkDZn10RfNhNX4juNR0c4Id1x8kJjbzpj5DTspN/ybgEAHYq1/Conc6H+k=' },
  { password: 'p@ss', plaintext: 'line 1\nline 2', ciphertext: 'NlvD2iNfU1omEvj7IcxWZmU57kl8bqPj0/NdLOX8Wb35RIycAA1z8656QrTQKIrsCsauiE261Svq' },
];

const te = new TextEncoder();
async function pbkdf2Key(password, salt, iterations, usage) {
  const material = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
async function independentDecrypt(password, payloadB64, iterations) {
  const bytes = Uint8Array.from(Buffer.from(payloadB64, 'base64'));
  const key = await pbkdf2Key(password, bytes.slice(0, 16), iterations, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(16, 28) }, key, bytes.slice(28));
  return new TextDecoder().decode(plain);
}
async function independentEncrypt(password, text, iterations) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await pbkdf2Key(password, salt, iterations, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return Buffer.concat([salt, iv, ct]).toString('base64');
}
async function rawEncrypt(keyBytes, iv, plainBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes));
}

// ---------- old ciphertext still decrypts ----------
for (const f of LEGACY) {
  const out = await E.decryptText(f.password, f.ciphertext);
  check('legacy decrypts: ' + JSON.stringify(f.plaintext), out === f.plaintext, JSON.stringify(out));
  const padded = await E.decryptText(f.password, '  ' + f.ciphertext + '\n');
  check('legacy with surrounding whitespace', padded === f.plaintext);
  await rejects('legacy with wrong password fails', E.decryptText(f.password + 'x', f.ciphertext), 'auth');
}

// ---------- new ciphertext ----------
{
  const pw = 'correct horse battery staple';
  const text = 'Hello, 世界 🌍';
  const c = await E.encryptText(pw, text);
  check('new ciphertext starts with v2:', c.startsWith('v2:'), c.slice(0, 8));
  const payload = c.slice(3);
  check('payload is Base64', /^[A-Za-z0-9+/]+={0,2}$/.test(payload));
  const len = Buffer.from(payload, 'base64').length;
  check('payload = salt 16 + iv 12 + plaintext bytes + tag 16', len === 16 + 12 + Buffer.byteLength(text) + 16, len);
  check('round trip', (await E.decryptText(pw, c)) === text);
  check('independent decrypt at 600,000 iterations', (await independentDecrypt(pw, payload, 600000)) === text);
  await rejects('200,000 iterations cannot decrypt v2', independentDecrypt(pw, payload, 200000));
  await rejects('v2 with wrong password fails with auth', E.decryptText('wrong', c), 'auth');
  const c2 = await E.encryptText(pw, text);
  check('fresh salt and iv each time', c2 !== c);
  const bytes = Buffer.from(payload, 'base64');
  bytes[bytes.length - 1] ^= 1;
  await rejects('tampered tag fails with auth', E.decryptText(pw, 'v2:' + bytes.toString('base64')), 'auth');
  const b2 = Buffer.from(payload, 'base64');
  b2[30] ^= 0x80;
  await rejects('tampered ciphertext byte fails with auth', E.decryptText(pw, 'v2:' + b2.toString('base64')), 'auth');
  const cut = Buffer.from(payload, 'base64').subarray(0, len - 1);
  await rejects('truncated by one byte fails with auth', E.decryptText(pw, 'v2:' + cut.toString('base64')), 'auth');
  // empty plaintext (other programs can write it): salt + iv + tag = 44 bytes
  const empty = 'v2:' + await independentEncrypt(pw, '', 600000);
  check('44-byte v2 (empty plaintext) decrypts to ""', (await E.decryptText(pw, empty).catch((e) => e.code)) === '', Buffer.from(empty.slice(3), 'base64').length);
  // a v2 payload without the prefix is tried at 600,000 after 200,000 fails
  check('unprefixed 600,000-iteration payload decrypts', (await E.decryptText(pw, payload).catch((e) => 'ERR ' + e.code)) === text);
  const r = await E.decryptInput({ type: 'password', password: pw }, payload).catch((e) => ({ error: e.code }));
  check('unprefixed 600,000 reports iterations', r && r.iterations === 600000, JSON.stringify(r && { v: r.version, it: r.iterations }));
  const r1 = await E.decryptInput({ type: 'password', password: LEGACY[0].password }, LEGACY[0].ciphertext).catch((e) => ({ error: e.code }));
  check('legacy reports 200,000 iterations', r1 && r1.iterations === 200000, JSON.stringify(r1 && { v: r1.version, it: r1.iterations }));
  const r2 = await E.decryptInput({ type: 'password', password: pw }, c).catch((e) => ({ error: e.code }));
  check('v2 reports version 2 and 600,000', r2 && r2.version === 2 && r2.iterations === 600000, JSON.stringify(r2 && { v: r2.version, it: r2.iterations }));
}

// ---------- IVs are unique ----------
{
  const seen = new Set();
  const spec = { type: 'raw', key: new Uint8Array(32).fill(7) };
  for (let i = 0; i < 1000; i++) {
    const c = await E.encryptText(spec, 'x');
    seen.add(Buffer.from(c, 'base64').subarray(0, 12).toString('hex'));
  }
  check('1,000 raw-key encryptions use 1,000 different IVs', seen.size === 1000, seen.size);
}

// ---------- rejected input: codes ----------
{
  const e = await rejects('unknown version v9 fails', E.decryptText('pw', 'v9:' + LEGACY[0].ciphertext), 'version');
  check('unknown version error names the version', e && e.detail && String(e.detail.version) === '9', e && JSON.stringify(e.detail));
  await rejects('v1: prefix is not a known version', E.decryptText('pw', 'v1:' + LEGACY[0].ciphertext), 'version');
  const s = await rejects('too short fails with short', E.decryptText('pw', 'v2:QUJD'), 'short');
  check('short reports byte counts', s && s.detail && s.detail.bytes === 3 && s.detail.min === 44, s && JSON.stringify(s.detail));
  // 43 bytes: one byte less than salt + iv + tag
  await rejects('43 bytes fails with short', E.decryptText('pw', 'v2:' + Buffer.alloc(43).toString('base64')), 'short');
  const b = await rejects('non-Base64 fails with base64', E.decryptText('pw', 'v2:AAAA@AAA'), 'base64');
  check('base64 error gives the character and position', b && b.detail && b.detail.ch === '@' && b.detail.pos === 8, b && JSON.stringify(b.detail));
  await rejects('Base64 with length 4n+1 fails with base64Length', E.decryptText('pw', 'v2:' + Buffer.alloc(45, 0xff).toString('base64').replace(/=+$/, '') + '/////'), 'base64Length');
  await rejects('"=" in the middle fails with base64', E.decryptText('pw', 'v2:AA==AAAA'), 'base64');
  await rejects('odd hex fails with hex', E.decryptText('pw', 'v2:' + 'ab'.repeat(40) + 'a'), 'hex');
  await rejects('empty input fails with empty', E.decryptText('pw', '   '), 'empty');
  // URL-safe Base64 and line breaks (RFC 4648 §5, MIME-wrapped copies) are accepted
  const c = await E.encryptText('pw', 'wrap me please, a long enough text to cross 76 characters of Base64 output');
  const wrapped = 'v2:' + c.slice(3).replace(/(.{76})/g, '$1\r\n');
  check('Base64 with line breaks decrypts', (await E.decryptText('pw', wrapped).catch((e) => e.code)).startsWith('wrap me'));
  const urlsafe = 'v2:' + c.slice(3).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('URL-safe Base64 without padding decrypts', (await E.decryptText('pw', urlsafe).catch((e) => e.code)).startsWith('wrap me'));
}

// ---------- OpenSSL / CryptoJS "Salted__" ----------
{
  const tmp = mkdtempSync(join(tmpdir(), 'zt-aes-'));
  let hasOpenssl = true;
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { hasOpenssl = false; }
  let saltedB64 = 'U2FsdGVkX1/d8r1k0pA+ZXKZ7YH1eYz0pQJ5n6c5d8o='; // "Salted__" + salt + 16 bytes
  if (hasOpenssl) {
    writeFileSync(join(tmp, 'p.txt'), 'hello from openssl');
    saltedB64 = execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-a', '-A', '-salt', '-pass', 'pass:pw', '-in', join(tmp, 'p.txt')]).toString().trim();
    // openssl enc has no GCM: it cannot read the tool output
    let gcmRefused = false;
    try { execFileSync('openssl', ['enc', '-aes-256-gcm', '-pass', 'pass:pw', '-in', join(tmp, 'p.txt')], { stdio: 'pipe' }); } catch (e) { gcmRefused = /AEAD|not supported|unsupported/i.test(String(e.stderr)); }
    check('openssl enc refuses -aes-256-gcm', gcmRefused);
  } else console.log('SKIP: openssl not found, using a fixed Salted__ sample');
  check('openssl sample starts with U2FsdGVkX1', saltedB64.startsWith('U2FsdGVkX1'), saltedB64.slice(0, 12));
  await rejects('OpenSSL Base64 output fails with openssl', E.decryptText('pw', saltedB64), 'openssl');
  await rejects('OpenSSL output with v2: fails with openssl', E.decryptText('pw', 'v2:' + saltedB64), 'openssl');
  const hex = Buffer.from(saltedB64, 'base64').toString('hex');
  await rejects('OpenSSL hex output fails with openssl', E.decryptText('pw', hex), 'openssl');
  if (need('decryptFile')) {
    await rejects('OpenSSL binary file fails with openssl', E.decryptFile({ type: 'password', password: 'pw' }, new Uint8Array(Buffer.from(saltedB64, 'base64'))), 'openssl');
  }
  rmSync(tmp, { recursive: true, force: true });
}

// ---------- decrypted bytes that are not UTF-8 ----------
{
  const key = new Uint8Array(32).fill(3);
  const iv = new Uint8Array(12).fill(9);
  const bin = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x01]);
  const ct = await rawEncrypt(key, iv, bin);
  const input = Buffer.concat([iv, ct]).toString('base64');
  const spec = { type: 'raw', key };
  const e = await rejects('non-UTF-8 plaintext fails decryptText with utf8', E.decryptText(spec, input), 'utf8');
  check('utf8 error carries the bytes', e && e.detail && e.detail.bytes instanceof Uint8Array && Buffer.from(e.detail.bytes).equals(Buffer.from(bin)), e && e.detail && typeof e.detail.bytes);
  const r = await E.decryptInput(spec, input).catch((x) => ({ error: x.code }));
  check('decryptInput returns bytes and text null for non-UTF-8', r && r.text === null && r.bytes && Buffer.from(r.bytes).equals(Buffer.from(bin)), JSON.stringify(r && { t: r.text, e: r.error }));
  // BOM is kept (ignoreBOM), not silently dropped
  const bom = await rawEncrypt(key, iv, new Uint8Array([0xef, 0xbb, 0xbf, 0x41]));
  check('UTF-8 BOM is kept', (await E.decryptText(spec, Buffer.concat([iv, bom]).toString('base64'))) === '\uFEFFA');
}

// ---------- hex output ----------
{
  const c = await E.encryptText('pw', 'hex please', 'hex');
  check('hex output starts with v2: and is lowercase hex', /^v2:[0-9a-f]+$/.test(c), c.slice(0, 20));
  check('hex output length = 2 × (44 + 10)', c.length - 3 === 2 * (44 + 10), c.length);
  check('hex output decrypts', (await E.decryptText('pw', c).catch((e) => e.code)) === 'hex please');
  check('upper-case hex with spaces decrypts', (await E.decryptText('pw', 'v2:' + c.slice(3).toUpperCase().replace(/(..)/g, '$1 ')).catch((e) => e.code)) === 'hex please');
  const r = await E.decryptInput({ type: 'password', password: 'pw' }, c);
  check('decryptInput reports hex encoding', r.encoding === 'hex', r.encoding);
}

// ---------- raw key ----------
if (need('parseRawKey')) {
  const k32hex = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const k = E.parseRawKey(k32hex, 'hex');
  check('32-byte hex key parses', k instanceof Uint8Array && k.length === 32 && k[31] === 31);
  check('hex key with spaces and upper case parses', E.parseRawKey(k32hex.toUpperCase().replace(/(..)/g, '$1 '), 'hex').length === 32);
  check('16-byte Base64 key parses', E.parseRawKey(Buffer.alloc(16, 1).toString('base64'), 'base64').length === 16);
  check('24-byte Base64 key parses', E.parseRawKey(Buffer.alloc(24, 1).toString('base64'), 'base64').length === 24);
  const bad = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  let e = bad(() => E.parseRawKey('00'.repeat(20), 'hex'));
  check('20-byte key fails with keyLength', e && e.code === 'keyLength' && e.detail.bytes === 20, e && JSON.stringify([e.code, e.detail]));
  e = bad(() => E.parseRawKey('zz' + '00'.repeat(15), 'hex'));
  check('non-hex key fails with keyChars at position 1', e && e.code === 'keyChars' && e.detail.ch === 'z' && e.detail.pos === 1, e && JSON.stringify([e.code, e.detail]));
  e = bad(() => E.parseRawKey('0'.repeat(31), 'hex'));
  check('odd hex key fails with keyHexLength', e && e.code === 'keyHexLength', e && e.code);
  e = bad(() => E.parseRawKey('   ', 'hex'));
  check('empty key fails with keyEmpty', e && e.code === 'keyEmpty', e && e.code);
  // a 32-character hex string read as Base64 is 24 bytes: the format choice matters
  check('32 hex characters as Base64 = 24 bytes', E.parseRawKey('00112233445566778899aabbccddeeff', 'base64').length === 24);
  const g = E.generateRawKey(256);
  check('generated key is 64 hex characters', /^[0-9a-f]{64}$/.test(g), g);
  check('generated keys differ', E.generateRawKey(256) !== g);
  check('generated 128-bit key is 32 hex characters', /^[0-9a-f]{32}$/.test(E.generateRawKey(128)));

  // interop: nonce | ciphertext | tag with an independent Web Crypto encryption
  const key = E.parseRawKey(k32hex, 'hex');
  const iv = Uint8Array.from(Buffer.from('cafebabefacedbaddecaf888', 'hex'));
  const ct = await rawEncrypt(key, iv, te.encode('raw key interop'));
  const spec = { type: 'raw', key };
  check('raw: independent iv|ct|tag decrypts', (await E.decryptText(spec, Buffer.concat([iv, ct]).toString('base64')).catch((x) => x.code)) === 'raw key interop');
  const out = await E.encryptText(spec, 'raw key interop');
  check('raw: output has no prefix', !/^v\d+:/.test(out), out.slice(0, 6));
  const ob = Buffer.from(out, 'base64');
  check('raw: output = iv 12 + plaintext + tag 16', ob.length === 12 + 15 + 16, ob.length);
  const dk = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  const pt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ob.subarray(0, 12) }, dk, ob.subarray(12)));
  check('raw: output decrypts independently', pt === 'raw key interop');
  await rejects('raw: wrong key fails with auth', E.decryptText({ type: 'raw', key: new Uint8Array(32) }, out), 'auth');
  await rejects('raw: 27 bytes fails with short', E.decryptText(spec, Buffer.alloc(27).toString('base64')), 'short');
  const s = await rejects('raw: short reports min 28', E.decryptText(spec, Buffer.alloc(20).toString('base64')), 'short');
  check('raw short min is 28', s && s.detail && s.detail.min === 28, s && JSON.stringify(s.detail));
  await rejects('raw: a v2: ciphertext fails with version (needs password mode)', E.decryptText(spec, 'v2:' + out), 'rawPrefix');
  // McGrew & Viega, "The Galois/Counter Mode of Operation (GCM)", Appendix B, Test Case 15
  // (AES-256, 96-bit IV, no AAD); the vectors used in NIST's GCM validation
  const tcKey = Uint8Array.from(Buffer.from('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308', 'hex'));
  const tcPt = 'd9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525b16aedf5aa0de657ba637b391aafd255';
  const tcExpectCt = '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015ad';
  const tcExpectTag = 'b094dac5d93471bdec1a502270e3cc6c';
  const tcInput = 'cafebabefacedbaddecaf888' + tcExpectCt + tcExpectTag;
  const tcOut = await E.decryptInput({ type: 'raw', key: tcKey }, tcInput).catch((x) => ({ error: x.code }));
  check('GCM spec Test Case 15 (hex iv|ct|tag) decrypts to the published plaintext', tcOut.bytes && Buffer.from(tcOut.bytes).toString('hex') === tcPt, JSON.stringify(tcOut.error));
}

// ---------- raw key with a separate IV and AAD (WeChat Pay APIv3 callback layout) ----------
// WeChat Pay "如何解密回调报文和平台证书": AEAD_AES_256_GCM, key = the 32-byte APIv3 key string,
// nonce and associated_data are strings used as UTF-8 bytes, ciphertext = Base64(ct | tag).
if (need('parseRawKey')) {
  const { createCipheriv } = await import('node:crypto');
  const apiKey = 'zerotool-example-apiv3-key-0032b'; // 32 ASCII characters, made up
  const nonce = '0123456789ab';                        // 12 characters, read as text
  const aad = 'transaction';
  const plain = '{"out_trade_no":"ZT20260930001","trade_state":"SUCCESS"}';
  const c = createCipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(nonce));
  c.setAAD(Buffer.from(aad));
  const ctB64 = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]).toString('base64');
  const key = E.parseRawKey(apiKey, 'text');
  check('text key of 32 ASCII characters = 32 bytes', key.length === 32);
  const bad = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const e = bad(() => E.parseRawKey('short text key', 'text'));
  check('14-character text key fails with keyLength', e && e.code === 'keyLength' && e.detail.bytes === 14, e && e.code);
  check('parseIv: 12 characters are text', E.parseIv && E.parseIv(nonce).length === 12 && E.parseIv(nonce)[0] === 0x30);
  check('parseIv: 24 hex digits are hex', E.parseIv && E.parseIv('cafebabefacedbaddecaf888').length === 12 && E.parseIv('cafebabefacedbaddecaf888')[0] === 0xca);
  check('parseIv: empty is null', E.parseIv && E.parseIv('  ') === null);
  const spec = { type: 'raw', key, iv: E.parseIv(nonce), aad: te.encode(aad) };
  check('WeChat-style callback decrypts with IV and AAD', (await E.decryptText(spec, ctB64).catch((x) => 'ERR ' + x.code)) === plain);
  await rejects('wrong AAD fails with auth', E.decryptText({ ...spec, aad: te.encode('certificate') }, ctB64), 'auth');
  await rejects('missing AAD fails with auth', E.decryptText({ ...spec, aad: null }, ctB64), 'auth');
  const s = await rejects('separate IV: 15 bytes fails with short (min 16)', E.decryptText(spec, Buffer.alloc(15, 0xff).toString('base64')), 'short');
  check('separate IV short min is 16', s && s.detail && s.detail.min === 16, s && JSON.stringify(s.detail));
  // encrypting with a given IV writes ct | tag only, the same bytes as node:crypto
  const out = await E.encryptText(spec, plain);
  check('given IV + AAD: output equals node:crypto (deterministic)', out === ctB64, out.slice(0, 16) + ' vs ' + ctB64.slice(0, 16));
  // GCM spec Test Case 15 through the IV field
  const tcKey = Uint8Array.from(Buffer.from('feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308', 'hex'));
  const tc = await E.decryptInput({ type: 'raw', key: tcKey, iv: E.parseIv('cafebabefacedbaddecaf888') }, '522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838c5f61e6393ba7a0abcc9f662898015adb094dac5d93471bdec1a502270e3cc6c').catch((x) => ({ error: x.code }));
  check('Test Case 15 with IV in its own field', tc.bytes && tc.bytes.length === 64, JSON.stringify(tc.error));
}

// ---------- files ----------
if (need('encryptFile') && need('decryptFile')) {
  const bin = new Uint8Array(70000);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 31 + 7) & 255;
  const pspec = { type: 'password', password: 'file pw' };
  const f = await E.encryptFile(pspec, bin);
  check('password file starts with ASCII "v2:"', Buffer.from(f.subarray(0, 3)).toString() === 'v2:');
  check('password file size = 3 + 44 + n', f.length === 3 + 44 + bin.length, f.length);
  const d = await E.decryptFile(pspec, f).catch((e) => ({ code: e.code }));
  check('password file round trip', d instanceof Uint8Array && Buffer.from(d).equals(Buffer.from(bin)), d && d.code);
  check('password file payload decrypts independently', (await (async () => {
    const p = f.subarray(3);
    const key = await pbkdf2Key('file pw', p.subarray(0, 16), 600000, 'decrypt');
    return Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: p.subarray(16, 28) }, key, p.subarray(28))).equals(Buffer.from(bin));
  })().catch(() => false)));
  await rejects('password file with wrong password fails with auth', E.decryptFile({ type: 'password', password: 'x' }, f), 'auth');
  // a text ciphertext saved to a .txt file
  const txt = te.encode(await E.encryptText('file pw', 'saved as text') + '\n');
  const dt = await E.decryptFile(pspec, txt).catch((e) => ({ code: e.code }));
  check('text ciphertext in a file decrypts', dt instanceof Uint8Array && new TextDecoder().decode(dt) === 'saved as text', dt && dt.code);
  await rejects('random bytes file fails with fileFormat', E.decryptFile(pspec, new Uint8Array(100).fill(0xa5)), 'fileFormat');
  const rspec = { type: 'raw', key: new Uint8Array(16).fill(1) };
  const rf = await E.encryptFile(rspec, bin);
  check('raw file size = 12 + n + 16', rf.length === 12 + bin.length + 16, rf.length);
  const rd = await E.decryptFile(rspec, rf).catch((e) => ({ code: e.code }));
  check('raw file round trip', rd instanceof Uint8Array && Buffer.from(rd).equals(Buffer.from(bin)), rd && rd.code);
  await rejects('empty file fails with empty', E.decryptFile(pspec, new Uint8Array(0)), 'empty');
}

// ---------- large input ----------
{
  const big = 'A'.repeat(5 * 1024 * 1024);
  const t0 = performance.now();
  const c = await E.encryptText({ type: 'raw', key: new Uint8Array(32) }, big);
  const t1 = performance.now();
  const back = await E.decryptText({ type: 'raw', key: new Uint8Array(32) }, c);
  const t2 = performance.now();
  check('5 MiB text round trip', back === big);
  check('5 MiB encrypt + Base64 under 2 s', t1 - t0 < 2000 * PERF_SLACK, Math.round(t1 - t0) + ' ms');
  console.log('INFO: 5 MiB encrypt ' + Math.round(t1 - t0) + ' ms, decrypt ' + Math.round(t2 - t1) + ' ms');
}

// ---------- code blocks in the guide and the tool page produce and read the tool's format ----------
{
  let hasPython = true;
  try { execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'ignore' }); } catch { hasPython = false; }
  if (!hasPython) console.log('SKIP: python3 with cryptography not found, Python blocks not run');
  const pw = 'correct horse battery staple';
  const text = 'guide 例 🌍';
  const fromTool = await E.encryptText(pw, text);
  const RAW_KEY_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const rawTool = await E.encryptText({ type: 'raw', key: E.parseRawKey(RAW_KEY_HEX, 'hex') }, text);
  const rawToolHex = await E.encryptText({ type: 'raw', key: E.parseRawKey(RAW_KEY_HEX, 'hex') }, text, 'hex');
  const files = ['en', 'zh', 'ja', 'ko'].map((l) => 'src/content/blog/aes-encrypt-decrypt-guide/' + l + '.mdx')
    .concat(['en', 'zh', 'ja', 'ko'].map((l) => 'src/content/tools/aes-encrypt-decrypt/' + l + '.mdx'));
  for (const file of files) {
    const mdx = readFileSync(join(root, file), 'utf8');
    const js = (mdx.match(/```(?:javascript|js)\n([\s\S]*?)```/) || [])[1];
    const isGuide = file.includes('/blog/');
    if (isGuide) check(file + ' has a JavaScript block', !!js);
    if (js) {
      const G = new Function(js + '\nreturn { encrypt, decrypt };')();
      const c = await G.encrypt(text, pw);
      check(file + ' JS writes v2:', c.startsWith('v2:'), c.slice(0, 6));
      check(file + ' JS output decrypts in the tool', (await E.decryptText(pw, c).catch((e) => e.message)) === text);
      check(file + ' JS output uses 600,000 iterations', (await independentDecrypt(pw, c.slice(3), 600000).catch(() => null)) === text);
      check(file + ' JS reads tool output', (await G.decrypt(fromTool, pw).catch((e) => e.message)) === text);
      check(file + ' JS reads old format', (await G.decrypt(LEGACY[0].ciphertext, LEGACY[0].password).catch((e) => e.message)) === LEGACY[0].plaintext);
    }
    const py = (mdx.match(/```python\n([\s\S]*?)```/) || [])[1];
    if (isGuide) check(file + ' has a Python block', !!py);
    if (py && hasPython) {
      const harness = py + '\nimport sys, json\nd = json.load(sys.stdin)\nprint(json.dumps({"enc": encrypt(d["text"], d["pw"]), "dec": decrypt(d["tool"], d["pw"]), "legacy": decrypt(d["legacy"], d["legacyPw"]), "raw": decrypt_raw(d["raw"], d["rawKey"]) if "decrypt_raw" in globals() else None, "rawHex": decrypt_raw(d["rawHex"], d["rawKey"]) if "decrypt_raw" in globals() else None}))\n';
      let r = null;
      try {
        const out = execFileSync('python3', ['-c', harness], { stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify({ text, pw, tool: fromTool, legacy: LEGACY[0].ciphertext, legacyPw: LEGACY[0].password, raw: rawTool, rawHex: rawToolHex, rawKey: RAW_KEY_HEX }) }).toString().trim().split('\n');
        r = JSON.parse(out[out.length - 1]);
      } catch (e) { r = { error: String(e.message).slice(0, 200) }; }
      check(file + ' Python writes v2:', typeof r.enc === 'string' && r.enc.startsWith('v2:'), JSON.stringify(r).slice(0, 120));
      check(file + ' Python output decrypts in the tool', typeof r.enc === 'string' && (await E.decryptText(pw, r.enc).catch(() => null)) === text);
      check(file + ' Python reads tool output', r.dec === text);
      check(file + ' Python reads old format', r.legacy === LEGACY[0].plaintext);
      if (py.includes('def decrypt_raw')) {
        check(file + ' Python decrypt_raw reads raw key Base64 output', r.raw === text, JSON.stringify(r.raw));
        check(file + ' Python decrypt_raw reads raw key hex output', r.rawHex === text, JSON.stringify(r.rawHex));
      }
    }
  }
}

// ---------- STRINGS ----------
{
  const stringsStart = source.indexOf('const STRINGS = {');
  const stringsEnd = source.indexOf('\n};', stringsStart);
  check('frontmatter STRINGS table found', stringsStart >= 0 && stringsEnd > stringsStart);
  if (stringsStart >= 0 && stringsEnd > stringsStart) {
    const S = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();
    const keys = Object.keys(S.en).sort().join(',');
    ['zh', 'ja', 'ko'].forEach((l) => check('STRINGS keys ' + l, Object.keys(S[l]).sort().join(',') === keys, Object.keys(S.en).filter((k) => !(k in S[l])).concat(Object.keys(S[l]).filter((k) => !(k in S.en))).join(',')));
    const ph = (s) => (String(s).match(/\{[a-z]+\}/gi) || []).sort().join(',');
    for (const k of Object.keys(S.en)) {
      ['zh', 'ja', 'ko'].forEach((l) => { if (k in S[l]) check('placeholders ' + l + '.' + k, ph(S.en[k]) === ph(S[l][k]), ph(S.en[k]) + ' vs ' + ph(S[l][k])); });
    }
    // every error code thrown by the engine has a message in every language
    const codes = [...new Set([...block.matchAll(/fail\('([a-zA-Z0-9]+)'/g)].map((m) => m[1]))];
    check('engine throws coded errors', codes.length >= 10, codes.join(','));
    for (const c of codes) ['en', 'zh', 'ja', 'ko'].forEach((l) => check('message for ' + c + ' in ' + l, typeof S[l]['err_' + c] === 'string', 'err_' + c));
  }
}

// ---------- examples printed on the tool pages decrypt to the stated text ----------
{
  const pw = 'correct horse battery staple';
  const page = (l) => readFileSync(join(root, 'src/content/tools/aes-encrypt-decrypt/' + l + '.mdx'), 'utf8');
  const rawSpec = (key, fmt, iv, aad) => ({ type: 'raw', key: E.parseRawKey(key, fmt), iv: E.parseIv(iv), aad: aad ? te.encode(aad) : null });
  const examples = [
    ['en', pw, 'Meet at 10:30, gate B', 'v2:l0KuwwrqkW+qHiVFcSad83WDHoteU8LkBJ/dw3N3LGl2PMwh3n8Q9u6wTM1CzpoDINVwd/yy4RRdM7QPNwXfGdc='],
    ['zh', pw, '数据库只读账号下周一启用', 'v2:qXfeC+pkpC/F/K3PR6ucLX6MQOcmQtyj+UUn9SYWmygCNoyV6H080bCB6fI6r1FJzypkhN0oWVRkA1VMXiCkXm6soo3Tqi/PZM0fJ28ANQk='],
    ['ja', pw, '見積書は金曜に送ります', 'v2:7v4vi+LVN2PaU0TDRHSSeMduNrofoM62T63g/9tmX11FGSSR54Q3iG/C7Mtm6rUws+FU3HjW7SyBpiGLMypnoOpNINlqrPAtTHDylZw='],
    ['ko', pw, '회의 자료는 금요일에 보낼게요', 'v2:YG1w0RRceJRp9qzhdNMzvbZ7eX8AmQeIuhony1o1zSjfNPaAV5lBkfvl8KT7Q2NZ1XPl+HLtqfttXD8PQ+8IZ8EtFX68wchTNvUT/23rml8L9qRvK/o='],
    ['en', rawSpec('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex', 'cafebabefacedbaddecaf888'), 'hello from ZeroTool', 'e2c6cc4ac55a296929667d871e6fe66b624fac923b410258258a224f6319fb85f4a398', 'hex'],
    ['zh', rawSpec('zerotool-example-apiv3-key-0032b', 'text', '0123456789ab', 'transaction'), '{"out_trade_no":"ZT20260930001","trade_state":"SUCCESS"}', 'TB0zfn/fWCjPw0A+a0ZbgqZ7CKokDC839Nw4ZaBq0aOtwBqOthxnj5Ak4KGHMF7BQ5W3PA72tzCaHxynWKK+5mdrbhBQFtsS'],
    ['ja', rawSpec('EBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8=', 'base64', '0f0e0d0c0b0a090807060504'), 'テスト用の平文です', 'LGnIgt1Hib6Tu03SeTvCFvdLB9EQ6s2tv6R7OtyM8NurwAV+Yu2fFGzbOQ=='],
    ['ko', rawSpec('00112233445566778899aabbccddeeff', 'hex', 'a1b2c3d4e5f6a7b8c9d0e1f2'), '안녕하세요, ZeroTool', '9aabdcab3e4772d01c210ffdd44153dcaed5cfb2d26d821b54da9cfc72d4d337e5b2b770e70a7933d8', 'hex'],
  ];
  for (const [lang, spec, plain, ct, enc] of examples) {
    check(lang + ' page shows the example ' + ct.slice(0, 12), page(lang).includes(ct));
    check(lang + ' example decrypts: ' + plain, (await E.decryptText(spec, ct).catch((e) => 'ERR ' + e.code)) === plain);
    if (typeof spec === 'object' && spec.iv) check(lang + ' fixed-IV example re-encrypts to the same output', (await E.encryptText(spec, plain, enc)) === ct);
  }
}

// ---------- sensitive page: nothing stored, no analytics or ads ----------
{
  const policy = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check('persistence policy is disabled (no GA4 / AdSense, input never saved)', /'aes-encrypt-decrypt':\s*'disabled'/.test(policy));
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  check('component script does not use storage, URL or network', !/localStorage|sessionStorage|ztPersist|location\.|history\.|fetch\(|XMLHttpRequest|sendBeacon|indexedDB/.test(script));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
