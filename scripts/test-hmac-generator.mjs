// HMAC Generator — HMAC engine, platform signing formats and signature checker
//
// Read:  src/components/tools/HmacGeneratorTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers and the frontmatter STRINGS / ORDER tables, so this
//        test cannot drift from the shipped source); src/data/persistence.ts;
//        src/content/tools/hmac-generator/{lang}.mdx and src/content/blog/hmac-generator-guide/{lang}.mdx
//        (every `{/* hmac-check: {...} */}` annotation is recomputed and the value must appear in
//        the page text after it)
// Write: stdout only (test results); python3 is fed JSON on stdin when it is installed; code
//        blocks marked hmac-run are written to a temporary directory under the OS temp dir, run
//        with node / python3 / go, and the directory is removed
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: RFC 2104 (HMAC; §2 keys longer than B are hashed first, §3 keys shorter than L are
// discouraged, §5 truncation to the leftmost t bits, at least L/2 and 80 bits; test vectors in the
// appendix are HMAC-MD5); RFC 2202 §3 (HMAC-SHA-1 test cases 1–7, case 5 truncated to 96 bits);
// RFC 4231 §4 (HMAC-SHA-224/256/384/512 test cases 1–7, case 5 truncated to 128 bits, cases 6–7
// with a 131-byte key); FIPS 180-4 (SHA-224 initial value); RFC 4648 (Base64, base64url);
// GitHub "Validating webhook deliveries" (secret "It's a Secret to Everybody", payload
// "Hello, World!" → sha256=757107ea…); Slack "Verifying requests from Slack" (signing secret
// 8f742231…, timestamp 1531420618 → v0=a2114d57…); LINE "Verify webhook signature" (channel
// secret 8c570fa6…, body {"destination":…,"events":[]} → GhRKmvmH…=); Stripe webhook signatures
// (signed_payload = t + "." + body, header t=…,v1=…, 5-minute default tolerance); Standard
// Webhooks spec (msg_id.timestamp.payload, secret whsec_ + Base64, "v1," + Base64); Shopify
// (Base64 HMAC-SHA256 of the raw body); Chatwork (token Base64-decoded as the key); Twilio
// (URL + POST parameters sorted by name, HMAC-SHA1, Base64); Feishu custom bot (key
// timestamp + "\n" + secret, empty message); DingTalk custom robot (key secret, message
// timestamp + "\n" + secret, Base64 then URL-encoded); NAVER Cloud Platform API
// (method + " " + uri + "\n" + timestamp + "\n" + accessKey, Base64).
//
// Run: node scripts/test-hmac-generator.mjs

import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HmacGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HmacGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { ALGOS, ALGO_ORDER, PRESETS, md5, sha224, hmacWith, computeHmac, utf8, parseHex, parseBase64,
  decodeField, toHex, toBase64, toBase64url, truncateBits, parseForm, twilioString, buildSigning,
  formatSignature, checkTimestamp, keyNotes, textNotes, parseSignature, matchSignature, diagnose, visible };`)();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')();
const orderStart = source.indexOf('const ORDER = {');
const orderEnd = source.indexOf('\n};', orderStart);
const ORDER = new Function(source.slice(orderStart, orderEnd + 3) + '\nreturn ORDER;')();

const subtle = globalThis.crypto.subtle;
let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log(`FAIL: ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}
function skip(name, why) { skips++; console.log(`SKIP: ${name} — ${why}`); }

const hex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const bytes = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const NODE = { MD5: 'md5', 'SHA-1': 'sha1', 'SHA-224': 'sha224', 'SHA-256': 'sha256', 'SHA-384': 'sha384', 'SHA-512': 'sha512' };

async function hmac(algo, key, msg) { return hex(await E.computeHmac(algo, key, msg, subtle)); }
async function sign(presetId, f) {
  const b = E.buildSigning(presetId, f);
  if (!b.ok) return { error: b };
  const sig = await E.computeHmac(b.algo, b.key, b.message, subtle);
  return { built: b, sig, header: E.formatSignature(presetId, sig, f) };
}

// ── 1. RFC test vectors ──────────────────────────────────────────────────────────────────────
const RFC2104 = [
  { key: '0b'.repeat(16), data: hex(bytes('Hi There')), md5: '9294727a3638bb1c13f48ef8158bfc9d' },
  { key: hex(bytes('Jefe')), data: hex(bytes('what do ya want for nothing?')), md5: '750c783e6ab0b503eaa86e310a5db738' },
  { key: 'aa'.repeat(16), data: 'dd'.repeat(50), md5: '56be34521d144c88dbb8c733f0e8b3f6' },
];
for (const [i, v] of RFC2104.entries()) {
  check(`RFC 2104 HMAC-MD5 vector ${i + 1}`, await hmac('MD5', fromHex(v.key), fromHex(v.data)) === v.md5);
}

const RFC2202 = [
  { key: '0b'.repeat(20), data: hex(bytes('Hi There')), d: 'b617318655057264e28bc0b6fb378c8ef146be00' },
  { key: hex(bytes('Jefe')), data: hex(bytes('what do ya want for nothing?')), d: 'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79' },
  { key: 'aa'.repeat(20), data: 'dd'.repeat(50), d: '125d7342b9ac11cd91a39af48aa17b4f63f175d3' },
  { key: '0102030405060708090a0b0c0d0e0f10111213141516171819', data: 'cd'.repeat(50), d: '4c9007f4026250c6bc8414f9bf50c86c2d7235da' },
  { key: '0c'.repeat(20), data: hex(bytes('Test With Truncation')), d: '4c1a03424b55e07fe7f27be1d58bb9324a9a5a04', d96: '4c1a03424b55e07fe7f27be1' },
  { key: 'aa'.repeat(80), data: hex(bytes('Test Using Larger Than Block-Size Key - Hash Key First')), d: 'aa4ae5e15272d00e95705637ce8a3b55ed402112' },
  { key: 'aa'.repeat(80), data: hex(bytes('Test Using Larger Than Block-Size Key and Larger Than One Block-Size Data')), d: 'e8e99d0f45237d786d6bbaa7965c7808bbff1a91' },
];
for (const [i, v] of RFC2202.entries()) {
  const out = await E.computeHmac('SHA-1', fromHex(v.key), fromHex(v.data), subtle);
  check(`RFC 2202 HMAC-SHA-1 test case ${i + 1}`, hex(out) === v.d, hex(out));
  if (v.d96) check('RFC 2202 test case 5 truncated to 96 bits', hex(E.truncateBits(out, '96').bytes) === v.d96);
}

const RFC4231 = [
  { Key: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b', Data: '4869205468657265', 224: '896fb1128abbdf196832107cd49df33f47b4b1169912ba4f53684b22', 256: 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7', 384: 'afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6', 512: '87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854' },
  { Key: '4a656665', Data: '7768617420646f2079612077616e7420666f72206e6f7468696e673f', 224: 'a30e01098bc6dbbf45690f3a7e9e6d0f8bbea2a39e6148008fd05e44', 256: '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843', 384: 'af45d2e376484031617f78d2b58a6b1b9c7ef464f5a01b47e42ec3736322445e8e2240ca5e69e2c78b3239ecfab21649', 512: '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737' },
  { Key: 'aa'.repeat(20), Data: 'dd'.repeat(50), 224: '7fb3cb3588c6c1f6ffa9694d7d6ad2649365b0c1f65d69d1ec8333ea', 256: '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe', 384: '88062608d3e6ad8a0aa2ace014c8a86f0aa635d947ac9febe83ef4e55966144b2a5ab39dc13814b94e3ab6e101a34f27', 512: 'fa73b0089d56a284efb0f0756c890be9b1b5dbdd8ee81a3655f83e33b2279d39bf3e848279a722c806b485a47e67c807b946a337bee8942674278859e13292fb' },
  { Key: '0102030405060708090a0b0c0d0e0f10111213141516171819', Data: 'cd'.repeat(50), 224: '6c11506874013cac6a2abc1bb382627cec6a90d86efc012de7afec5a', 256: '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b', 384: '3e8a69b7783c25851933ab6290af6ca77a9981480850009cc5577c6e1f573b4e6801dd23c4a7d679ccf8a386c674cffb', 512: 'b0ba465637458c6990e5a8c5f61d4af7e576d97ff94b872de76f8050361ee3dba91ca5c11aa25eb4d679275cc5788063a5f19741120c4f2de2adebeb10a298dd' },
  { Key: '0c'.repeat(20), Data: '546573742057697468205472756e636174696f6e', trunc: 128, 224: '0e2aea68a90c8d37c988bcdb9fca6fa8', 256: 'a3b6167473100ee06e0c796c2955552b', 384: '3abf34c3503b2a23a46efc619baef897', 512: '415fad6271580a531d4179bc891d87a6' },
  { Key: 'aa'.repeat(131), Data: '54657374205573696e67204c6172676572205468616e20426c6f636b2d53697a65204b6579202d2048617368204b6579204669727374', 224: '95e9a0db962095adaebe9b2d6f0dbce2d499f112f2d2b7273fa6870e', 256: '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54', 384: '4ece084485813e9088d2c63a041bc5b44f9ef1012a2b588f3cd11f05033ac4c60c2ef6ab4030fe8296248df163f44952', 512: '80b24263c7c1a3ebb71493c1dd7be8b49b46d1f41b4aeec1121b013783f8f3526b56d037e05f2598bd0fd2215d6a1e5295e64f73f63f0aec8b915a985d786598' },
  { Key: 'aa'.repeat(131), Data: '5468697320697320612074657374207573696e672061206c6172676572207468616e20626c6f636b2d73697a65206b657920616e642061206c6172676572207468616e20626c6f636b2d73697a6520646174612e20546865206b6579206e6565647320746f20626520686173686564206265666f7265206265696e6720757365642062792074686520484d414320616c676f726974686d2e', 224: '3a854166ac5d9f023f54d517d0b39dbd946770db9c2b95c9f6f565d1', 256: '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2', 384: '6617178e941f020d351e2f254e8fd32c602420feb0b8fb9adccebb82461e99c5a678cc31e799176d3860e6110c46523e', 512: 'e37b6a775dc87dbaa4dfa9f96e5e3ffddebd71f8867289865df5a32d20cdc944b6022cac3c4982b10d5eeb55c3e4de15134676fb6de0446065c97440fa8c6a58' },
];
for (const [i, v] of RFC4231.entries()) {
  for (const bitsName of [224, 256, 384, 512]) {
    const algo = 'SHA-' + bitsName;
    let out = await E.computeHmac(algo, fromHex(v.Key), fromHex(v.Data), subtle);
    if (v.trunc) out = E.truncateBits(out, String(v.trunc)).bytes;
    check(`RFC 4231 test case ${i + 1} HMAC-${algo}`, hex(out) === v[bitsName], hex(out));
  }
}
// The same vectors through the hex parser and the custom preset, as a user would type them.
{
  const r = await sign('custom', { algo: 'SHA-256', key: '0b'.repeat(20), keyEnc: 'hex', msg: 'Hi There', msgEnc: 'text' });
  check('custom preset: RFC 4231 case 1 typed as hex key and text message', hex(r.sig) === RFC4231[0][256]);
  const r2 = await sign('custom', { algo: 'SHA-512', key: 'Jefe', keyEnc: 'text', msg: '7768617420646f2079612077616e7420666f72206e6f7468696e673f', msgEnc: 'hex' });
  check('custom preset: RFC 4231 case 2 with a hex message', hex(r2.sig) === RFC4231[1][512]);
}

// ── 2. Random inputs against node:crypto (Web Crypto path and the MD5 / SHA-224 code) ────────────
{
  let bad = 0;
  let total = 0;
  const lens = [0, 1, 3, 31, 55, 56, 57, 63, 64, 65, 111, 112, 127, 128, 129, 200, 1000];
  for (let i = 0; i < 600; i++) {
    const key = crypto.randomBytes(lens[i % lens.length] + (i % 3));
    const msg = crypto.randomBytes(lens[(i * 7) % lens.length] + ((i * 5) % 4));
    for (const algo of E.ALGO_ORDER) {
      total++;
      const got = await hmac(algo, new Uint8Array(key), new Uint8Array(msg));
      const want = crypto.createHmac(NODE[algo], key).update(msg).digest('hex');
      if (got !== want) { bad++; if (bad < 4) console.log(`  mismatch ${algo} key ${key.length} msg ${msg.length}`); }
    }
  }
  check(`${total} random HMACs (6 algorithms, empty key and message included) equal node:crypto createHmac`, bad === 0, `${bad} mismatches`);
  // MD5 / SHA-224 hashing alone, around the padding boundaries.
  let hb = 0;
  for (let n = 0; n < 300; n++) {
    const m = crypto.randomBytes(n);
    if (hex(E.md5(new Uint8Array(m))) !== crypto.createHash('md5').update(m).digest('hex')) hb++;
    if (hex(E.sha224(new Uint8Array(m))) !== crypto.createHash('sha224').update(m).digest('hex')) hb++;
  }
  check('MD5 and SHA-224 of 0–299 byte inputs equal node:crypto', hb === 0, hb);
  check('the generic HMAC code equals Web Crypto for SHA-256 (empty key)', hex(E.hmacWith((b) => new Uint8Array(crypto.createHash('sha256').update(b).digest()), 64, new Uint8Array(0), bytes('x'))) === await hmac('SHA-256', new Uint8Array(0), bytes('x')));
}

// ── 3. Python hmac ────────────────────────────────────────────────────────────────────────────
{
  let py = null;
  try { execFileSync('python3', ['-c', 'import hmac, hashlib'], { stdio: 'ignore' }); py = 'python3'; } catch { py = null; }
  if (!py) skip('Python hmac comparison', 'python3 not installed');
  else {
    const cases = [];
    for (let i = 0; i < 60; i++) {
      cases.push({ algo: E.ALGO_ORDER[i % 6], key: crypto.randomBytes(i * 3 % 150).toString('hex'), msg: crypto.randomBytes(i * 11 % 300).toString('hex') });
    }
    const script = 'import sys, json, hmac, hashlib\nm={"MD5":"md5","SHA-1":"sha1","SHA-224":"sha224","SHA-256":"sha256","SHA-384":"sha384","SHA-512":"sha512"}\nprint(json.dumps([hmac.new(bytes.fromhex(c["key"]), bytes.fromhex(c["msg"]), getattr(hashlib, m[c["algo"]])).hexdigest() for c in json.load(sys.stdin)]))';
    const out = JSON.parse(execFileSync(py, ['-c', script], { input: JSON.stringify(cases) }).toString());
    let bad = 0;
    for (const [i, c] of cases.entries()) if (await hmac(c.algo, fromHex(c.key), fromHex(c.msg)) !== out[i]) bad++;
    check('60 random HMACs equal Python hmac.new', bad === 0, bad);
  }
}

// ── 4. Input and output encodings ─────────────────────────────────────────────────────────────
{
  const h = E.parseHex('0x0B 0b:0b\n0b');
  check('hex: 0x prefix, spaces, colons and line breaks are ignored', h.ok && hex(h.bytes) === '0b0b0b0b', h);
  const fw = E.parseHex('０ｂ０Ｂ');
  check('hex: full-width digits and letters are read as ASCII and flagged', fw.ok && hex(fw.bytes) === '0b0b' && fw.fullwidth === true, fw);
  const bad = E.parseHex('0b0g');
  check('hex: invalid character reported with its position', !bad.ok && bad.code === 'hexChar' && bad.pos === 4 && bad.ch === 'g', bad);
  const emo = E.parseHex('😀0g');
  check('hex: position counts code points', !emo.ok && emo.pos === 1, emo);
  const odd = E.parseHex('abc');
  check('hex: odd number of digits', !odd.ok && odd.code === 'hexOdd' && odd.n === 3, odd);

  const sample = new Uint8Array(crypto.randomBytes(200));
  check('Base64 output equals Buffer base64', E.toBase64(sample) === Buffer.from(sample).toString('base64'));
  check('base64url output equals Buffer base64url (no padding)', E.toBase64url(sample) === Buffer.from(sample).toString('base64url'));
  check('hex output and uppercase', E.toHex(fromHex('00ff10')) === '00ff10' && E.toHex(fromHex('00ff10'), true) === '00FF10');
  let rt = 0;
  for (let n = 0; n < 70; n++) {
    const b = new Uint8Array(crypto.randomBytes(n));
    const std = E.parseBase64(Buffer.from(b).toString('base64'));
    const url = E.parseBase64(Buffer.from(b).toString('base64url'));
    if (!std.ok || hex(std.bytes) !== hex(b) || !url.ok || hex(url.bytes) !== hex(b)) rt++;
  }
  check('Base64 and unpadded base64url input decode to the same bytes for lengths 0–69', rt === 0, rt);
  const midPad = E.parseBase64('ab=c');
  check('Base64: "=" before the end is reported with its position', !midPad.ok && midPad.code === 'b64Pad' && midPad.pos === 4, midPad);
  const len = E.parseBase64('abcde');
  check('Base64: length 4k + 1 is rejected', !len.ok && len.code === 'b64Len' && len.n === 5, len);
  const ch = E.parseBase64('ab*d');
  check('Base64: invalid character reported with its position', !ch.ok && ch.code === 'b64Char' && ch.pos === 3 && ch.ch === '*', ch);
  const wrapped = E.parseBase64('SGVs\nbG8=');
  check('Base64: line breaks inside the value are ignored', wrapped.ok && Buffer.from(wrapped.bytes).toString() === 'Hello');

  const crlf = E.decodeField('a\nb\n', 'text', 'crlf');
  check('text with CRLF line breaks becomes 61 0d 0a 62 0d 0a', hex(crlf.bytes) === '610d0a620d0a');
  const lf = E.decodeField('a\nb', 'text', 'lf');
  check('text with LF line breaks is kept', hex(lf.bytes) === '610a62');
  check('UTF-8 of Japanese text', hex(E.decodeField('署名', 'text').bytes) === 'e7bdb2e5908d');
  check('a lone surrogate is flagged', E.decodeField('a\uD83D', 'text').surrogate === true && E.decodeField('😀', 'text').surrogate === false);

  const full = new Uint8Array(32);
  check('truncate: empty means full length', E.truncateBits(full, '').bits === 256);
  check('truncate: 128 bits keeps 16 bytes and is not short for SHA-256', E.truncateBits(full, '128').bytes.length === 16 && !E.truncateBits(full, '128').short);
  check('truncate: 96 bits of SHA-256 is below half the output (RFC 2104 §5)', E.truncateBits(full, '96').short === true);
  check('truncate: 64 bits of SHA-1 output is below 80 bits', E.truncateBits(new Uint8Array(20), '64').short === true);
  check('truncate: not a multiple of 8, zero, and longer than the output are errors',
    !E.truncateBits(full, '100').ok && !E.truncateBits(full, '0').ok && !E.truncateBits(full, '264').ok && E.truncateBits(full, '264').max === 256);
}

// ── 5. Key notes ──────────────────────────────────────────────────────────────────────────────
{
  const codes = (algo, n) => E.keyNotes(algo, new Uint8Array(n)).map((x) => x.code).join(',');
  check('key notes: empty key', codes('SHA-256', 0) === 'keyEmpty');
  check('key notes: 19-byte key is shorter than the 32-byte output', codes('SHA-256', 19) === 'keyShort');
  check('key notes: 32-byte key has no note', codes('SHA-256', 32) === '');
  check('key notes: 65-byte key is hashed first for SHA-256 (block 64)', codes('SHA-256', 65) === 'keyLong');
  check('key notes: 65-byte key is fine for SHA-512 (block 128)', codes('SHA-512', 65) === '');
  check('text notes: trailing line break and edge spaces', E.textNotes('a \n', 'msg').map((x) => x.code).join(',') === 'trailingNewline' && E.textNotes(' a', 'key')[0].code === 'edgeSpace');
}

// ── 6. Platform formats ───────────────────────────────────────────────────────────────────────
const SLACK_BODY = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
{
  const gh = await sign('github', { key: "It's a Secret to Everybody", msg: 'Hello, World!' });
  check('GitHub docs example: X-Hub-Signature-256', gh.header === 'X-Hub-Signature-256: sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17', gh.header);
  const sl = await sign('slack', { key: '8f742231b10e8888abcd99yyyzzz85a5', msg: SLACK_BODY, timestamp: '1531420618' });
  check('Slack docs example: v0 signature', sl.header === 'X-Slack-Signature: v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503', sl.header);
  check('Slack signed string is v0:timestamp:body', sl.built.signed === 'v0:1531420618:' + SLACK_BODY);
  const ln = await sign('line', { key: '8c570fa6dd201bb328f1c1eac23a96d8', msg: '{"destination":"U8e742f61d673b39c7fff3cecb7536ef0","events":[]}' });
  check('LINE docs example: x-line-signature', ln.header === 'x-line-signature: GhRKmvmHys4Pi8DxkF4+EayaH0OqtJtaZxgTD9fMDLs=', ln.header);

  const stripeKey = 'whsec_test_' + 'a'.repeat(32);
  const body = '{"id":"evt_test","object":"event"}';
  const st = await sign('stripe', { key: stripeKey, msg: body, timestamp: '1700000000' });
  const want = crypto.createHmac('sha256', stripeKey).update('1700000000.' + body).digest('hex');
  check('Stripe: HMAC-SHA256 of t.body with the whole whsec_ secret, header t=…,v1=…', st.header === `Stripe-Signature: t=1700000000,v1=${want}`, st.header);
  check('Stripe: timestamp is required', E.buildSigning('stripe', { key: stripeKey, msg: body, timestamp: '' }).code === 'missing');
  check('Stripe: non-numeric timestamp is an error', E.buildSigning('stripe', { key: stripeKey, msg: body, timestamp: '17e8' }).code === 'tsFormat');

  const raw = crypto.randomBytes(32);
  const svixSecret = 'whsec_' + raw.toString('base64');
  const sv = await sign('svix', { key: svixSecret, msg: body, id: 'msg_test1', timestamp: '1700000000' });
  const svWant = crypto.createHmac('sha256', raw).update('msg_test1.1700000000.' + body).digest('base64');
  check('Standard Webhooks: key is the Base64 after whsec_, signed id.timestamp.body', sv.header === `webhook-signature: v1,${svWant}`, sv.header);
  check('Standard Webhooks: webhook-id is required', E.buildSigning('svix', { key: svixSecret, msg: body, id: '', timestamp: '1' }).code === 'missing');
  check('Standard Webhooks: a decoded secret outside 24–64 bytes gets a note', E.buildSigning('svix', { key: 'whsec_' + Buffer.alloc(8).toString('base64'), msg: '', id: 'm', timestamp: '1' }).notes[0].code === 'svixKeyLen');
  check('Standard Webhooks: a broken Base64 secret is an error on the key', E.buildSigning('svix', { key: 'whsec_ab*d', msg: '', id: 'm', timestamp: '1' }).field === 'key');

  const sh = await sign('shopify', { key: 'shpss_example_secret', msg: body });
  check('Shopify: Base64 HMAC-SHA256 of the body', sh.header === 'X-Shopify-Hmac-SHA256: ' + crypto.createHmac('sha256', 'shpss_example_secret').update(body).digest('base64'));

  const token = crypto.randomBytes(32).toString('base64');
  const cw = await sign('chatwork', { key: token, msg: body });
  check('Chatwork: the token is Base64-decoded before use', cw.header === 'x-chatworkwebhooksignature: ' + crypto.createHmac('sha256', Buffer.from(token, 'base64')).update(body).digest('base64'));

  // Twilio: URL + parameters sorted by name; repeated names sorted by value.
  const url = 'https://example.com/myapp?foo=1&bar=2';
  const form = 'To=%2B18005551212&From=%2B12349013030&Digits=1234&Caller=%2B12349013030&CallSid=CA1234567890ABCDE&Body=hi+there&Media=b&Media=a';
  const tw = await sign('twilio', { key: 'twilio-auth-token-example', url, msg: form });
  const twStr = url + 'Bodyhi thereCallSidCA1234567890ABCDECaller+12349013030Digits1234From+12349013030MediaaMediabTo+18005551212';
  check('Twilio: signed string is URL + name/value pairs sorted by name (repeated names by value)', tw.built.signed === twStr, tw.built.signed);
  check('Twilio: HMAC-SHA1 in Base64', tw.header === 'X-Twilio-Signature: ' + crypto.createHmac('sha1', 'twilio-auth-token-example').update(twStr).digest('base64'));
  const twJson = E.buildSigning('twilio', { key: 'k', url: url + '&bodySHA256=abc', msg: '{"a":1}' });
  check('Twilio: a JSON body signs the URL only', twJson.signed === url + '&bodySHA256=abc' && twJson.notes[0].code === 'twilioJson');
  check('Twilio: URL must be absolute', E.buildSigning('twilio', { key: 'k', url: '/myapp', msg: '' }).code === 'url');
  check('Twilio: broken percent-encoding is reported with the parameter number', E.buildSigning('twilio', { key: 'k', url, msg: 'a=1&b=%E0%A4' }).n === 2);

  // Feishu: key = timestamp + "\n" + secret, empty message (docs Java / Go / Python samples).
  const fs = await sign('feishu', { key: 'demo', timestamp: '1599360473' });
  const fsWant = crypto.createHmac('sha256', '1599360473\ndemo').update('').digest('base64');
  check('Feishu: HMAC of an empty message keyed with "timestamp\\nsecret"', fs.header === `"timestamp": "1599360473", "sign": "${fsWant}"`, fs.header);
  // DingTalk: key = secret, message = timestamp + "\n" + secret, Base64 then URL-encoded.
  const dt = await sign('dingtalk', { key: 'this is secret', timestamp: '1700000000000' });
  const dtB64 = crypto.createHmac('sha256', 'this is secret').update('1700000000000\nthis is secret').digest('base64');
  check('DingTalk: HMAC of "timestamp\\nsecret" keyed with the secret, URL-encoded', dt.header === '&timestamp=1700000000000&sign=' + encodeURIComponent(dtB64), dt.header);
  check('DingTalk: + / = are percent-encoded like Python quote_plus', !/[+/=]/.test(dt.header.split('sign=')[1]));
  check('Feishu and DingTalk give different signatures for the same secret and timestamp',
    hex((await sign('feishu', { key: 's', timestamp: '1' })).sig) !== hex((await sign('dingtalk', { key: 's', timestamp: '1' })).sig));
  // NAVER Cloud Platform API signature v2.
  const nc = await sign('ncp', { key: 'ncp-secret-example', method: 'get', uri: '/photos/puppy.jpg?query1=&query2', timestamp: '1700000000000', accessKey: 'ACCESS_KEY_ID' });
  const ncStr = 'GET /photos/puppy.jpg?query1=&query2\n1700000000000\nACCESS_KEY_ID';
  check('NAVER Cloud: signed string', nc.built.signed === ncStr, nc.built.signed);
  check('NAVER Cloud: Base64 HMAC-SHA256', nc.header === 'x-ncp-apigw-signature-v2: ' + crypto.createHmac('sha256', 'ncp-secret-example').update(ncStr).digest('base64'));
  check('NAVER Cloud: path must start with /', E.buildSigning('ncp', { key: 'k', method: 'GET', uri: 'photos', timestamp: '1', accessKey: 'a' }).code === 'uri');

  check('every preset except custom fixes its algorithm', Object.entries(E.PRESETS).every(([id, p]) => id === 'custom' || E.ALGOS[p.algo]));
}

// ── 7. Timestamps ─────────────────────────────────────────────────────────────────────────────
{
  const now = 1700000000 * 1000;
  check('timestamp within 5 minutes has no note (Stripe)', E.checkTimestamp('stripe', '1699999800', now).notes.length === 0);
  const old = E.checkTimestamp('stripe', '1699999000', now).notes[0];
  check('timestamp 1000 s old is past the 300 s Stripe tolerance', old.code === 'tsOld' && old.age === 1000 && old.limit === 300, old);
  check('timestamp in the future', E.checkTimestamp('slack', '1700001000', now).notes[0].code === 'tsFuture');
  check('Feishu accepts 1 hour', E.checkTimestamp('feishu', '1699997000', now).notes.length === 0 && E.checkTimestamp('feishu', '1699996000', now).notes[0].code === 'tsOld');
  check('DingTalk uses milliseconds', E.checkTimestamp('dingtalk', '1699999000000', now).notes.length === 0);
  check('a 13-digit timestamp on a seconds platform is flagged', E.checkTimestamp('slack', '1700000000000', now).notes[0].code === 'tsLooksMs');
  check('a 10-digit timestamp on a milliseconds platform is flagged', E.checkTimestamp('dingtalk', '1700000000', now).notes[0].code === 'tsLooksS');
  check('presets without a timestamp return null', E.checkTimestamp('github', '1', now) === null);
}

// ── 8. Reading and matching pasted signatures ─────────────────────────────────────────────────
{
  const sig = fromHex('757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17');
  const m = (t) => E.matchSignature(sig, E.parseSignature(t));
  check('header line with name', m('X-Hub-Signature-256: sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17').status === 'match');
  check('bare hex', m('757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17').encoding === 'hex');
  const up = m('757107EA0EB2509FC211221CCE984B8A37570B6D7586C22C46F4379C8B043E17');
  check('uppercase hex matches and is flagged', up.status === 'match' && up.upper === true);
  const b64 = Buffer.from(sig).toString('base64');
  check('Base64', m(b64).encoding === 'base64');
  check('base64url without padding', m(Buffer.from(sig).toString('base64url')).status === 'match');
  check('quoted value', m(`"${b64}"`).status === 'match');
  const multi = m(`t=1492774577,v1=${'00'.repeat(32)},v1=${hex(sig)},v0=${'11'.repeat(32)}`);
  check('Stripe header: second v1 of three signatures matches', multi.status === 'match' && multi.index === 1 && multi.count === 3, multi);
  check('Stripe header: t= is read', E.parseSignature('t=1492774577,v1=ab').ts === '1492774577');
  check('Standard Webhooks: several "v1," values separated by spaces', m(`v1,${Buffer.alloc(32).toString('base64')} v1,${b64}`).index === 1);
  check('Toss-style "v1:" values', m(`v1:${Buffer.alloc(32).toString('base64')},v1:${b64}`).status === 'match');
  const ding = E.parseSignature('https://oapi.dingtalk.com/robot/send?access_token=XXXXXX&timestamp=1700000000000&sign=' + encodeURIComponent(b64));
  check('DingTalk URL: sign= is URL-decoded and timestamp= is read', E.matchSignature(sig, ding).status === 'match' && ding.ts === '1700000000000');
  const tr = m('757107ea0eb2509fc211221cce984b8a');
  check('first 128 bits match as a truncated HMAC', tr.status === 'truncated' && tr.bits === 128, tr);
  const no = m('sha256=' + '00'.repeat(32));
  check('wrong signature of the right length', no.status === 'none' && no.lengths[0] === 32);
  check('text without a hex or Base64 value', m('no signature here!').status === 'unreadable');
  check('empty input', m('   ').status === 'empty');
}

// ── 9. Diagnosis of mismatches ────────────────────────────────────────────────────────────────
{
  const key = "It's a Secret to Everybody";
  const diag = async (presetId, f, headerText) => E.diagnose(presetId, f, E.parseSignature(headerText), subtle);
  const ghSig = 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';
  check('diagnose: body pasted with an extra final line break', (await diag('github', { key, msg: 'Hello, World!\n' }, ghSig)).code === 'msgTrailingNewline');
  check('diagnose: key with a trailing space', (await diag('github', { key: key + ' ', msg: 'Hello, World!' }, ghSig)).code === 'keyTrim');
  const sha1 = crypto.createHmac('sha1', key).update('Hello, World!').digest('hex');
  const d1 = await diag('github', { key, msg: 'Hello, World!' }, 'X-Hub-Signature: sha1=' + sha1);
  check('diagnose: legacy X-Hub-Signature is HMAC-SHA1', d1.code === 'algo' && d1.algo === 'SHA-1', d1);
  const body = '{\n  "a": 1,\n  "b": "x"\n}';
  const minSig = crypto.createHmac('sha256', 'k').update('{"a":1,"b":"x"}').digest('base64');
  check('diagnose: signature of the minified JSON, body pasted pretty-printed', (await diag('line', { key: 'k', msg: body }, minSig)).code === 'jsonMinified');
  const crlfSig = crypto.createHmac('sha256', 'k').update('a\r\nb').digest('hex');
  check('diagnose: sender used CRLF line breaks', (await diag('custom', { algo: 'SHA-256', key: 'k', keyEnc: 'text', msg: 'a\nb', msgEnc: 'text', eol: 'lf' }, crlfSig)).code === 'eolCrlf');
  const hexKeySig = crypto.createHmac('sha256', Buffer.from('0b'.repeat(20), 'hex')).update('Hi There').digest('hex');
  const dk = await diag('custom', { algo: 'SHA-256', key: '0b'.repeat(20), keyEnc: 'text', msg: 'Hi There', msgEnc: 'text' }, hexKeySig);
  check('diagnose: key should be read as hex', dk.code === 'keyEnc' && dk.enc === 'hex', dk);
  const swapSig = crypto.createHmac('sha256', 'message').update('key').digest('hex');
  check('diagnose: key and message swapped', (await diag('custom', { algo: 'SHA-256', key: 'key', keyEnc: 'text', msg: 'message', msgEnc: 'text' }, swapSig)).code === 'swapped');
  const dingSig = crypto.createHmac('sha256', 'sec').update('1700000000000\nsec').digest('base64');
  const db = await diag('feishu', { key: 'sec', timestamp: '1700000000000' }, dingSig);
  check('diagnose: Feishu selected, but the value follows the DingTalk formula', db.code === 'otherBot' && db.other === 'dingtalk', db);
  const st = crypto.createHmac('sha256', 'whsec_x').update('1700000300.{}').digest('hex');
  const ds = await diag('stripe', { key: 'whsec_x', msg: '{}', timestamp: '1700000000' }, `t=1700000300,v1=${st}`);
  check('diagnose: Stripe timestamp field differs from t= in the header', ds.code === 'tsHeader' && ds.ts === '1700000300', ds);
  const chatworkText = crypto.createHmac('sha256', 'dG9rZW4=').update('{}').digest('base64');
  const dc = await diag('chatwork', { key: 'dG9rZW4=', msg: '{}' }, chatworkText);
  check('diagnose: Chatwork token used as text instead of Base64-decoded', dc.code === 'keyEnc' && dc.enc === 'text', dc);
  check('diagnose: nothing found returns null', (await diag('github', { key, msg: 'Hello' }, 'sha256=' + '00'.repeat(32))) === null);
}

check('visible(): CR, LF and tab are shown', E.visible('a\r\n\tb') === 'a␍␊\n␉b');

// ── 10. Component wiring, privacy and strings ─────────────────────────────────────────────────
{
  const script = source.slice(source.indexOf('<script is:inline'), source.indexOf('</script>'));
  check('component script does not touch storage, cookies, the URL or the network',
    !/localStorage|sessionStorage|ztPersist|document\.cookie|location\.(hash|search|href)|history\.|fetch\(|XMLHttpRequest|sendBeacon/.test(script));
  check('component script does not write HTML', !/innerHTML|insertAdjacentHTML|outerHTML/.test(script));
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check('persistence policy for hmac-generator is disabled', /'hmac-generator':\s*'disabled'/.test(persistence));
  const langs = ['en', 'zh', 'ja', 'ko'];
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]));
  const enKeys = flat(STRINGS.en).map(([k]) => k).sort().join(',');
  for (const lang of langs) {
    check(`STRINGS.${lang} has the same keys as en`, flat(STRINGS[lang]).map(([k]) => k).sort().join(',') === enKeys);
    for (const [k, v] of flat(STRINGS[lang])) {
      const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
      const enVal = flat(STRINGS.en).find(([kk]) => kk === k)[1];
      if (ph(v) !== ph(enVal)) check(`STRINGS.${lang}.${k} placeholders`, false, `${ph(v)} vs ${ph(enVal)}`);
    }
    check(`ORDER.${lang} lists every preset once`, ORDER[lang].slice().sort().join(',') === Object.keys(E.PRESETS).sort().join(','));
    check(`STRINGS.${lang}.presets and keyLabels cover every preset`, Object.keys(E.PRESETS).every((id) => STRINGS[lang].presets[id] && STRINGS[lang].keyLabels[id]));
    check(`STRINGS.${lang}.notes cover every preset except custom`, Object.keys(E.PRESETS).every((id) => id === 'custom' || STRINGS[lang].notes[id]));
  }
  for (const code of ['keyTrim', 'msgTrailingNewline', 'msgNoTrailingNewline', 'eolCrlf', 'eolLf', 'msgTrim', 'jsonMinified', 'jsonPretty', 'keyEnc', 'msgEnc', 'swapped', 'otherBot', 'tsHeader', 'algo']) {
    check(`diagnosis code ${code} has a string`, langs.every((l) => STRINGS[l]['d_' + code]));
  }
}

// ── 11. Examples quoted on the tool pages and in the guide ────────────────────────────────────
// Annotation: {/* hmac-check: {"preset":"github","key":"…","msg":"…","expect":"header|hex|base64|base64url"} */}
// The computed value must appear in the page text after the annotation (within 4000 characters).
{
  const files = [];
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    files.push(join(root, `src/content/tools/hmac-generator/${lang}.mdx`));
    files.push(join(root, `src/content/blog/hmac-generator-guide/${lang}.mdx`));
  }
  let count = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const re = /\{\/\* hmac-check: (\{.*?\}) \*\/\}/g;
    let m;
    while ((m = re.exec(text))) {
      count++;
      let spec;
      try { spec = JSON.parse(m[1]); } catch (e) { check(`${file}: annotation is JSON`, false, m[1]); continue; }
      const f = Object.assign({ algo: 'SHA-256', keyEnc: 'text', msgEnc: 'text', eol: 'lf' }, spec);
      const r = await sign(spec.preset || 'custom', f);
      if (r.error) { check(`${file}: ${m[1]}`, false, r.error); continue; }
      let shown = r.sig;
      if (spec.truncate) shown = E.truncateBits(r.sig, String(spec.truncate)).bytes;
      const value = { header: r.header, hex: E.toHex(shown, spec.upper), base64: E.toBase64(shown), base64url: E.toBase64url(shown), signed: r.built.signed }[spec.expect || 'hex'];
      const after = text.slice(m.index, m.index + 4000);
      check(`${file.replace(root + '/', '')}: ${spec.expect || 'hex'} for ${spec.preset || 'custom'} "${String(spec.msg || spec.timestamp || '').slice(0, 30)}" appears after the annotation`, after.includes(value), value);
      if (spec.verify) {
        const v = E.matchSignature(r.sig, E.parseSignature(spec.verify));
        if (spec.diagnose) {
          const d = await E.diagnose(spec.preset || 'custom', f, E.parseSignature(spec.verify), subtle);
          check(`${file.replace(root + '/', '')}: diagnosis ${spec.diagnose}`, d && d.code === spec.diagnose, d);
        } else check(`${file.replace(root + '/', '')}: verify value matches`, v.status === 'match', v);
      }
    }
  }
  if (count) check(`${count} hmac-check annotations found`, count > 0);
  else skip('page annotations', 'no hmac-check annotations yet');

  // Code blocks marked {/* hmac-run: {"lang":"node|python|go","expect":"…"} */} are run and
  // their stdout must equal "expect". A missing toolchain is a SKIP.
  const has = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; } };
  const tool = { node: true, python: has('python3', ['--version']), go: has('go', ['version']) };
  let runs = 0;
  for (const file of files) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const re = /\{\/\* hmac-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text))) {
      runs++;
      const spec = JSON.parse(m[1]);
      const name = `${file.replace(root + '/', '')}: ${spec.lang} block ${runs}`;
      if (!tool[spec.lang]) { skip(name, `${spec.lang} not installed`); continue; }
      const dir = mkdtempSync(join(tmpdir(), 'hmac-run-'));
      try {
        let out;
        if (spec.lang === 'node') {
          writeFileSync(join(dir, 'main.mjs'), m[2]);
          out = execFileSync(process.execPath, [join(dir, 'main.mjs')]).toString();
        } else if (spec.lang === 'python') {
          writeFileSync(join(dir, 'main.py'), m[2]);
          out = execFileSync('python3', [join(dir, 'main.py')]).toString();
        } else {
          writeFileSync(join(dir, 'main.go'), m[2]);
          out = execFileSync('go', ['run', join(dir, 'main.go')], { cwd: dir, env: { ...process.env, GO111MODULE: 'off', GOFLAGS: '' } }).toString();
        }
        check(name, out.trim() === spec.expect, out.trim());
      } catch (e) {
        check(name, false, String(e.stderr || e.message).slice(0, 300));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  if (!runs) skip('code blocks', 'no hmac-run annotations');
}

console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
