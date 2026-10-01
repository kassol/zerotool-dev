// JWT Generator — HMAC signing, secret decoding and the RFC 7518 §3.2 minimum key length
//
// Read:  src/components/tools/JwtGeneratorTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: HMAC keys shorter than the hash output were accepted without a word,
// although RFC 7518 §3.2 says a key of the same size as the hash output (or larger) MUST be used
// (32 / 48 / 64 bytes for HS256 / HS384 / HS512); the default sample secret "your-256-bit-secret"
// is only 19 bytes. Also: the RFC 7515 Appendix A.1 HS256 example signs to the published JWS;
// HS384 / HS512 match node:crypto; header and payload are signed byte-for-byte as written (UTF-8,
// non-ASCII); Base64 and base64url secrets with or without padding; invalid Base64 is rejected;
// 4-language STRINGS keys.
//
// Run: node scripts/test-jwt-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac, webcrypto } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JwtGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JwtGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { minKeyBytes, decodeSecret, signJwt };')();
const subtle = webcrypto.subtle;

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
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------- RFC 7518 §3.2 ----------
eq('HS256 needs 32 bytes', E.minKeyBytes('HS256'), 32);
eq('HS384 needs 48 bytes', E.minKeyBytes('HS384'), 48);
eq('HS512 needs 64 bytes', E.minKeyBytes('HS512'), 64);
eq('default sample secret is 19 bytes (below 32)', E.decodeSecret('your-256-bit-secret', 'utf8').length, 19);
check('component warns when the key is shorter than minKeyBytes', /keyBytes\.length < minBytes/.test(source) && /warnShortKey/.test(source));

// ---------- RFC 7515 Appendix A.1 ----------
{
  const key = E.decodeSecret('AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow', 'base64');
  eq('A.1 key is 64 bytes', key.length, 64);
  const jws = await E.signJwt('{"typ":"JWT",\r\n "alg":"HS256"}', '{"iss":"joe",\r\n "exp":1300819380,\r\n "http://example.com/is_root":true}', key, 'HS256', subtle);
  eq('RFC 7515 A.1 JWS', jws, 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
}

// ---------- HS384 / HS512 and UTF-8 against node:crypto ----------
for (const [algo, hash] of [['HS256', 'sha256'], ['HS384', 'sha384'], ['HS512', 'sha512']]) {
  const header = JSON.stringify({ alg: algo, typ: 'JWT' });
  const payload = JSON.stringify({ sub: '42', name: 'Zoë 山田 😀' });
  const key = E.decodeSecret('k'.repeat(64), 'utf8');
  const jws = await E.signJwt(header, payload, key, algo, subtle);
  const input = b64url(Buffer.from(header)) + '.' + b64url(Buffer.from(payload));
  eq(algo + ' matches node:crypto', jws, input + '.' + b64url(createHmac(hash, Buffer.from(key)).update(input).digest()));
}

// ---------- secret decoding ----------
eq('base64 with padding', Array.from(E.decodeSecret('AQID/w==', 'base64')), [1, 2, 3, 255]);
eq('base64url without padding', Array.from(E.decodeSecret('AQID_w', 'base64')), [1, 2, 3, 255]);
eq('invalid base64 → null', E.decodeSecret('not base64!', 'base64'), null);
eq('utf8 secret bytes', Array.from(E.decodeSecret('é', 'utf8')), [0xc3, 0xa9]);

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    for (const l of ['en', 'zh', 'ja', 'ko']) check(l + ' warnShortKey placeholders', ['{bytes}', '{min}', '{algo}'].every((x) => S[l].warnShortKey.includes(x)));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
