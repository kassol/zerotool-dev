// AES Encrypt / Decrypt — PBKDF2 iterations raised to 600,000 with a versioned ciphertext
//
// Read:  src/components/tools/AesEncryptDecryptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: new ciphertext is "v2:" + Base64(salt 16 | iv 12 | AES-256-GCM ciphertext + tag) with
// PBKDF2-HMAC-SHA256 at 600,000 iterations (OWASP Password Storage Cheat Sheet value; before
// the fix it was 200,000). The key is checked independently: the test derives it with Web
// Crypto at 600,000 iterations from the salt in the output and decrypts; 200,000 must fail.
// Ciphertext without a prefix is the old format and still decrypts with 200,000 iterations:
// the LEGACY fixtures below were produced by the pre-fix component code (identical at commit
// 7382bab) and are decrypted here. ':' is not a Base64 character, so an old ciphertext can
// never look like "v2:". Unknown versions, wrong passwords, truncated and non-Base64 input
// are rejected.
//
// Run: node scripts/test-aes-encrypt-decrypt.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
const E = new Function(block + '\nreturn { encryptText, decryptText };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
async function rejects(name, p) {
  try { await p; check(name, false, 'no error'); } catch (e) { check(name, true); return e; }
}

// Produced by the pre-fix encrypt handler (PBKDF2-SHA256, 200,000 iterations, no prefix)
const LEGACY = [
  { password: 'correct horse battery staple', plaintext: 'Hello, 世界 🌍', ciphertext: 'Lbo+/GmvJFI9+heOHzyYFnc1XrkDZn10RfNhNX4juNR0c4Id1x8kJjbzpj5DTspN/ybgEAHYq1/Conc6H+k=' },
  { password: 'p@ss', plaintext: 'line 1\nline 2', ciphertext: 'NlvD2iNfU1omEvj7IcxWZmU57kl8bqPj0/NdLOX8Wb35RIycAA1z8656QrTQKIrsCsauiE261Svq' },
];

async function independentDecrypt(password, payloadB64, iterations) {
  const bytes = Uint8Array.from(Buffer.from(payloadB64, 'base64'));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: bytes.slice(0, 16), iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(16, 28) }, key, bytes.slice(28));
  return new TextDecoder().decode(plain);
}

// ---------- old ciphertext still decrypts ----------
for (const f of LEGACY) {
  const out = await E.decryptText(f.password, f.ciphertext);
  check('legacy decrypts: ' + JSON.stringify(f.plaintext), out === f.plaintext, JSON.stringify(out));
  const padded = await E.decryptText(f.password, '  ' + f.ciphertext + '\n');
  check('legacy with surrounding whitespace', padded === f.plaintext);
  await rejects('legacy with wrong password fails', E.decryptText(f.password + 'x', f.ciphertext));
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
  await rejects('v2 with wrong password fails', E.decryptText('wrong', c));
  const c2 = await E.encryptText(pw, text);
  check('fresh salt and iv each time', c2 !== c);
  // the v2 payload read as a legacy ciphertext (prefix stripped) must not decrypt
  await rejects('v2 payload without prefix is not accepted as legacy', E.decryptText(pw, payload));
  // tampering is detected by the GCM tag
  const bytes = Buffer.from(payload, 'base64');
  bytes[bytes.length - 1] ^= 1;
  await rejects('tampered v2 fails', E.decryptText(pw, 'v2:' + bytes.toString('base64')));
}

// ---------- rejected input ----------
{
  const e = await rejects('unknown version v9 fails', E.decryptText('pw', 'v9:' + LEGACY[0].ciphertext));
  check('unknown version error names the version', e && /v9/.test(e.message), e && e.message);
  await rejects('too short fails', E.decryptText('pw', 'v2:AAAA'));
  await rejects('not Base64 fails', E.decryptText('pw', 'v2:@@@@'));
}

// ---------- guide code (4 languages) produces and reads the tool's format ----------
// The JavaScript block of src/content/blog/aes-encrypt-decrypt-guide/{lang}.mdx must write
// "v2:" ciphertext with 600,000 iterations, read the tool's output, and read the old format.
// The Python block is run the same way when python3 with the cryptography package exists.
{
  const { execFileSync } = await import('node:child_process');
  let hasPython = true;
  try { execFileSync('python3', ['-c', 'import cryptography'], { stdio: 'ignore' }); } catch { hasPython = false; }
  if (!hasPython) console.log('SKIP: python3 with cryptography not found, guide Python blocks not run');
  const pw = 'correct horse battery staple';
  const text = 'guide 例 🌍';
  const fromTool = await E.encryptText(pw, text);
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/blog/aes-encrypt-decrypt-guide/' + lang + '.mdx'), 'utf8');
    const js = (mdx.match(/```javascript\n([\s\S]*?)```/) || [])[1];
    check(lang + ' guide has a JavaScript block', !!js);
    if (js) {
      const G = new Function(js + '\nreturn { encrypt, decrypt };')();
      const c = await G.encrypt(text, pw);
      check(lang + ' guide JS writes v2:', c.startsWith('v2:'), c.slice(0, 6));
      check(lang + ' guide JS output decrypts in the tool', (await E.decryptText(pw, c).catch((e) => e.message)) === text);
      check(lang + ' guide JS output uses 600,000 iterations', (await independentDecrypt(pw, c.slice(3), 600000).catch(() => null)) === text);
      check(lang + ' guide JS reads tool output', (await G.decrypt(fromTool, pw).catch((e) => e.message)) === text);
      check(lang + ' guide JS reads old format', (await G.decrypt(LEGACY[0].ciphertext, LEGACY[0].password).catch((e) => e.message)) === LEGACY[0].plaintext);
    }
    const py = (mdx.match(/```python\n([\s\S]*?)```/) || [])[1];
    check(lang + ' guide has a Python block', !!py);
    if (py && hasPython) {
      const harness = py + '\nimport sys, json\nd = json.load(sys.stdin)\nprint(json.dumps({"enc": encrypt(d["text"], d["pw"]), "dec": decrypt(d["tool"], d["pw"]), "legacy": decrypt(d["legacy"], d["legacyPw"])}))\n';
      let r = null;
      try {
        const out = execFileSync('python3', ['-c', harness], { stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify({ text, pw, tool: fromTool, legacy: LEGACY[0].ciphertext, legacyPw: LEGACY[0].password }) }).toString().trim().split('\n');
        r = JSON.parse(out[out.length - 1]);
      } catch (e) { r = { error: String(e.message).slice(0, 200) }; }
      check(lang + ' guide Python writes v2:', typeof r.enc === 'string' && r.enc.startsWith('v2:'), JSON.stringify(r).slice(0, 120));
      check(lang + ' guide Python output decrypts in the tool', typeof r.enc === 'string' && (await E.decryptText(pw, r.enc).catch(() => null)) === text);
      check(lang + ' guide Python reads tool output', r.dec === text);
      check(lang + ' guide Python reads old format', r.legacy === LEGACY[0].plaintext);
    }
  }
}

// ---------- STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/);
  const S = new Function('return ' + m[1])();
  const keys = Object.keys(S.en).sort().join(',');
  ['zh', 'ja', 'ko'].forEach((l) => check('STRINGS keys ' + l, Object.keys(S[l]).sort().join(',') === keys));
  ['en', 'zh', 'ja', 'ko'].forEach((l) => check('errVersion in ' + l, typeof S[l].errVersion === 'string' && S[l].errVersion.includes('v2')));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
