// TOTP Generator — RFC 6238 / RFC 4226 vectors, Base32 secret input, otpauth:// URIs, clock offset
//
// Read:  src/components/tools/TotpGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter STRINGS table),
//        public/vendor/qrcode.min.js and public/vendor/zxing-reader.js + .wasm (QR round trip)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources: RFC 4226 Appendix D (HOTP values for the ASCII secret "12345678901234567890"),
// RFC 6238 Appendix B (TOTP table; SHA-256 / SHA-512 rows use the 32- and 64-byte seeds of the
// Appendix A reference code, `seed32` / `seed64`), RFC 4648 §6 (Base32 alphabet and padding),
// Google Authenticator "Key Uri Format" wiki (label = accountname / issuer (":" / "%3A")
// *"%20" accountname; neither part may contain a colon; secret padding "should be omitted";
// algorithm SHA1 / SHA256 / SHA512, digits 6 or 8, period default 30).
// Covers: all 18 rows of the RFC 6238 table and all 10 HOTP values of RFC 4226; 6 and 8 digits,
// periods 30 / 60 / 45 / 1; 500 random keys, counters and algorithms against node:crypto
// createHmac; Base32 input with lower case, spaces, hyphens, full-width letters, trailing
// padding (the 32- and 64-byte RFC seeds end in "====" and "="); '=' in the middle, characters
// outside A–Z / 2–7 (0 1 8 9, punctuation) and impossible lengths (1, 3, 6 chars mod 8) are
// errors (before the fix '=' anywhere was dropped and a 1-character secret passed validation);
// the URI carries the normalized secret without spaces or padding (before: "secret=jbsw%20y3dp"
// and "%3D%3D%3D%3D"), omits default algorithm / digits / period, rejects a colon in issuer or
// account (before: "A:B" became the label "A%3AB:Account", which parses as issuer "A"), parses
// literal and %3A separators, spaces before the account name, issuer parameter precedence,
// lower-case algorithm, unsupported type / algorithm / digits / period; generated URIs survive
// a QR encode (vendor qrcode) → decode (vendor zxing-wasm) → parse round trip; random secrets use
// getRandomValues and are 20 / 32 / 64 bytes for SHA-1 / SHA-256 / SHA-512; countdown and
// time-step state; a code shown before a 10-minute absence is stale (before the fix the code
// was only refreshed on the tick where remaining === period, which a throttled background tab
// skips); clock offset from an HTTP Date header with its one-second resolution and round trip;
// the 4 language STRINGS tables have the same keys.
//
// Run: node scripts/test-totp-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TotpGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TotpGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { normalizeSecret, base32Encode, base32Decode, hotp, totpAt, timeState, codeIsStale, randomSecret, buildUri, parseUri, clockOffset, clockVerdict };')();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('\n};', stringsStart);
const STRINGS = stringsStart >= 0 && stringsEnd > stringsStart
  ? new Function(source.slice(stringsStart, stringsEnd + 3) + '\nreturn STRINGS;')()
  : null;

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
const hex = (u8) => Buffer.from(u8).toString('hex');
const ascii = (s) => new Uint8Array(Buffer.from(s, 'ascii'));

const SEED20 = '12345678901234567890';
const SEED32 = '12345678901234567890123456789012';
const SEED64 = '1234567890123456789012345678901234567890123456789012345678901234';
const B32_20 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const B32_32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA====';
const B32_64 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA=';

// ---------- RFC 4226 Appendix D ----------
const HOTP_D = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
for (let c = 0; c < HOTP_D.length; c++) {
  eq('RFC 4226 HOTP count ' + c, await E.hotp(ascii(SEED20), c, 'SHA-1', 6), HOTP_D[c]);
}

// ---------- RFC 6238 Appendix B (seeds entered as Base32, as a user would) ----------
const TABLE = [
  [59, '94287082', '46119246', '90693936'],
  [1111111109, '07081804', '68084774', '25091201'],
  [1111111111, '14050471', '67062674', '99943326'],
  [1234567890, '89005924', '91819424', '93441116'],
  [2000000000, '69279037', '90698825', '38618901'],
  [20000000000, '65353130', '77737706', '47863826'],
];
const seeds = { 'SHA-1': B32_20, 'SHA-256': B32_32, 'SHA-512': B32_64 };
for (const [t, s1, s256, s512] of TABLE) {
  for (const [algo, expected] of [['SHA-1', s1], ['SHA-256', s256], ['SHA-512', s512]]) {
    const n = E.normalizeSecret(seeds[algo]);
    check('RFC 6238 seed decodes: ' + algo, n.ok, JSON.stringify(n));
    if (!n.ok) continue;
    eq('RFC 6238 T=' + t + ' ' + algo, await E.totpAt(n.bytes, t, algo, 8, 30), expected);
  }
}
eq('RFC 6238 seeds decode to the ASCII strings',
  [E.normalizeSecret(B32_20), E.normalizeSecret(B32_32), E.normalizeSecret(B32_64)].map((n) => n.ok && Buffer.from(n.bytes).toString('ascii')),
  [SEED20, SEED32, SEED64]);
eq('6 digits = last 6 of the 8-digit value (T=59 SHA-1)', await E.totpAt(ascii(SEED20), 59, 'SHA-1', 6, 30), '287082');
eq('6 digits at T=1111111109 keeps the leading zero', await E.totpAt(ascii(SEED20), 1111111109, 'SHA-1', 6, 30), '081804');

// ---------- other periods: code = HOTP(floor(t / period)) ----------
for (const [period, t] of [[60, 59], [60, 1234567890], [45, 1111111111], [1, 59], [90, 2000000000]]) {
  const counter = Math.floor(t / period);
  eq('period ' + period + ' at T=' + t, await E.totpAt(ascii(SEED20), t, 'SHA-1', 8, period), await E.hotp(ascii(SEED20), counter, 'SHA-1', 8));
}
eq('period 60 at T=59 is counter 0 → RFC 4226 count 0', await E.totpAt(ascii(SEED20), 59, 'SHA-1', 6, 60), '755224');

// ---------- independent reference: node:crypto ----------
function refHotp(key, counter, algo, digits) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo.replace('-', '').toLowerCase(), Buffer.from(key)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
let randomMismatch = 0;
for (let i = 0; i < 500; i++) {
  const len = 1 + (rnd() % 80);
  const key = new Uint8Array(len).map(() => rnd() & 255);
  const counter = i < 250 ? rnd() : rnd() * 4096 + rnd(); // up to ~2^43
  const algo = ['SHA-1', 'SHA-256', 'SHA-512'][i % 3];
  const digits = i % 2 ? 6 : 8;
  const got = await E.hotp(key, counter, algo, digits);
  const exp = refHotp(key, counter, algo, digits);
  if (got !== exp) { randomMismatch++; if (randomMismatch < 4) console.log('  mismatch', algo, digits, counter, got, exp); }
}
eq('500 random keys / counters match node:crypto', randomMismatch, 0);

// ---------- Base32 secret input ----------
const ok = (s) => { const n = E.normalizeSecret(s); return n.ok ? n.secret : 'ERR:' + n.error; };
eq('upper case unchanged', ok('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP');
eq('lower case', ok('jbswy3dpehpk3pxp'), 'JBSWY3DPEHPK3PXP');
eq('groups separated by spaces', ok('jbsw y3dp ehpk 3pxp'), 'JBSWY3DPEHPK3PXP');
eq('groups separated by hyphens', ok('JBSW-Y3DP-EHPK-3PXP'), 'JBSWY3DPEHPK3PXP');
eq('tabs, newlines and ideographic space', ok(' JBSW\tY3DP\nEHPK\u30003PXP '), 'JBSWY3DPEHPK3PXP');
eq('full-width letters and digits (NFKC)', ok('ＪＢＳＷＹ３ＤＰＥＨＰＫ３ＰＸＰ'), 'JBSWY3DPEHPK3PXP');
eq('trailing padding removed (32-byte seed)', ok(B32_32), B32_32.replace(/=+$/, ''));
eq('missing padding accepted', ok(B32_32.replace(/=+$/, '')), B32_32.replace(/=+$/, ''));
eq('extra padding accepted', ok('JBSWY3DPEHPK3PXP========'), 'JBSWY3DPEHPK3PXP');
eq('decoded bytes of the Key Uri Format example', hex(E.normalizeSecret('JBSWY3DPEHPK3PXP').bytes), '48656c6c6f21deadbeef');
eq('empty', E.normalizeSecret('   ').error, 'empty');
eq('only padding', E.normalizeSecret('====').error, 'empty');
eq('= in the middle is an error', E.normalizeSecret('GEZDGNBV=GY3TQOJQ').error, 'padding');
for (const [input, ch] of [['GEZDGNBV1Y3TQOJQ', '1'], ['GEZDGNBV0Y3TQOJQ', '0'], ['GEZDGNBV8Y3TQOJQ', '8'], ['GEZDGNBV9Y3TQOJQ', '9'], ['JBSW.Y3DP', '.'], ['JBSWY3DP_EHPK', '_'], ['JBSWY3DPÉHPK', 'É']]) {
  const n = E.normalizeSecret(input);
  eq('invalid character ' + ch, [n.ok, n.error, n.char], [false, 'char', ch]);
}
for (const len of [1, 3, 6, 9, 11, 14]) {
  eq('impossible length ' + len, E.normalizeSecret('A'.repeat(len)).error, 'length');
}
for (const len of [2, 4, 5, 7, 8, 16, 32]) {
  check('valid length ' + len, E.normalizeSecret('A'.repeat(len)).ok);
}
eq('bits reported for the Key Uri Format example (10 bytes)', E.normalizeSecret('JBSWY3DPEHPK3PXP').bytes.length * 8, 80);
eq('encode(decode(x)) round trip', E.base32Encode(E.base32Decode('GEZDGNBVGY3TQOJQGEZA')), 'GEZDGNBVGY3TQOJQGEZA');
eq('encode of 32-byte seed has no padding', E.base32Encode(ascii(SEED32)), B32_32.replace(/=+$/, ''));

// ---------- random secret ----------
{
  const calls = [];
  const fakeRng = (buf) => { calls.push(buf.length); for (let i = 0; i < buf.length; i++) buf[i] = i; return buf; };
  for (const [algo, bytes] of [['SHA-1', 20], ['SHA-256', 32], ['SHA-512', 64]]) {
    calls.length = 0;
    const s = E.randomSecret(algo, fakeRng);
    eq('random secret length ' + algo, [calls, E.normalizeSecret(s).bytes.length, /=/.test(s)], [[bytes], bytes, false]);
  }
  const a = E.randomSecret('SHA-1');
  const b = E.randomSecret('SHA-1');
  check('default random source gives different secrets', a !== b && a.length === 32);
  check('random secret uses crypto.getRandomValues', /crypto\.getRandomValues/.test(block) && !/Math\.random/.test(block));
}

// ---------- countdown / refresh ----------
eq('timeState at 0 ms', E.timeState(0, 30), { counter: 0, remaining: 30 });
eq('timeState at 29.001 s', E.timeState(29001, 30), { counter: 0, remaining: 1 });
eq('timeState at 30 s', E.timeState(30000, 30), { counter: 1, remaining: 30 });
eq('timeState at 59 s, period 60', E.timeState(59000, 60), { counter: 0, remaining: 1 });
eq('timeState RFC T=1111111109 s', E.timeState(1111111109000, 30).counter, 0x23523EC);
check('same step is not stale', !E.codeIsStale(E.timeState(1000, 30).counter, 29000, 30));
check('next step is stale', E.codeIsStale(E.timeState(1000, 30).counter, 30000, 30));
// Tab hidden at t=1 s, back 10 minutes and 13 seconds later: remaining is 17, not 30.
check('code shown 10 minutes ago is stale when remaining !== period', E.timeState(614000, 30).remaining !== 30 && E.codeIsStale(0, 614000, 30));

// ---------- otpauth:// URI generation ----------
const build = (o) => E.buildUri(Object.assign({ secret: 'JBSWY3DPEHPK3PXP', issuer: '', account: '', algo: 'SHA-1', digits: 6, period: 30 }, o));
eq('Key Uri Format example', build({ issuer: 'Example', account: 'alice@google.com' }).uri,
  'otpauth://totp/Example:alice%40google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
eq('spaces are %20 in label and issuer', build({ issuer: 'ACME Co', account: 'john.doe@email.com' }).uri,
  'otpauth://totp/ACME%20Co:john.doe%40email.com?secret=JBSWY3DPEHPK3PXP&issuer=ACME%20Co');
eq('non-default parameters listed', build({ issuer: 'X', account: 'a', algo: 'SHA-512', digits: 8, period: 60 }).uri,
  'otpauth://totp/X:a?secret=JBSWY3DPEHPK3PXP&issuer=X&algorithm=SHA512&digits=8&period=60');
eq('secret in URI is normalized (no spaces, upper case, no padding)', build({ secret: E.normalizeSecret('gezd gnbv gy3t qojq gezd gnbv gy3t qojq gezd gnbv gy3t qojq geza====').secret, account: 'a' }).uri,
  'otpauth://totp/a?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA');
eq('non-ASCII issuer and account are UTF-8 percent-encoded', build({ issuer: '示例', account: 'テスト' }).uri,
  'otpauth://totp/%E7%A4%BA%E4%BE%8B:%E3%83%86%E3%82%B9%E3%83%88?secret=JBSWY3DPEHPK3PXP&issuer=%E7%A4%BA%E4%BE%8B');
eq('colon in issuer rejected', [build({ issuer: 'A:B', account: 'x' }).ok, build({ issuer: 'A:B', account: 'x' }).field], [false, 'issuer']);
eq('colon in account rejected', [build({ issuer: 'A', account: 'john:doe' }).ok, build({ issuer: 'A', account: 'john:doe' }).field], [false, 'account']);
eq('full-width colon is fine', build({ issuer: 'A：B', account: 'x' }).ok, true);
check('empty account still gives a label', /^otpauth:\/\/totp\/[^?]+\?/.test(build({}).uri));

// ---------- otpauth:// URI parsing ----------
const parse = (s) => E.parseUri(s);
eq('parse Key Uri Format example', parse('otpauth://totp/Example:alice@google.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'),
  { ok: true, secret: 'JBSWY3DPEHPK3PXP', issuer: 'Example', account: 'alice@google.com', algo: 'SHA-1', digits: 6, period: 30 });
eq('parse all parameters', parse('otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA1&digits=6&period=30'),
  { ok: true, secret: 'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ', issuer: 'ACME Co', account: 'john.doe@email.com', algo: 'SHA-1', digits: 6, period: 30 });
eq('parse %3A separator and %20 before account', parse('otpauth://totp/Big%20Corporation%3A%20alice%40bigco.com?secret=JBSWY3DPEHPK3PXP'),
  { ok: true, secret: 'JBSWY3DPEHPK3PXP', issuer: 'Big Corporation', account: 'alice@bigco.com', algo: 'SHA-1', digits: 6, period: 30 });
eq('parse label without issuer', parse('otpauth://totp/alice?secret=jbsw%20y3dp%20ehpk%203pxp').account, 'alice');
eq('secret in URI is normalized on parse', parse('otpauth://totp/alice?secret=jbswy3dpehpk3pxp%3D%3D%3D%3D').secret, 'JBSWY3DPEHPK3PXP');
eq('issuer parameter wins over label prefix', parse('otpauth://totp/Old:alice?secret=JBSWY3DPEHPK3PXP&issuer=New').issuer, 'New');
eq('lower-case algorithm, SHA256, 8 digits, 60 s', parse('OTPAUTH://TOTP/a?secret=JBSWY3DPEHPK3PXP&algorithm=sha256&digits=8&period=60'),
  { ok: true, secret: 'JBSWY3DPEHPK3PXP', issuer: '', account: 'a', algo: 'SHA-256', digits: 8, period: 60 });
eq('SHA512', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=SHA512').algo, 'SHA-512');
eq('+ in issuer is a space (form encoding)', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&issuer=ACME+Co').issuer, 'ACME Co');
eq('hotp type', parse('otpauth://hotp/a?secret=JBSWY3DPEHPK3PXP&counter=0').error, 'hotp');
eq('unknown type', parse('otpauth://motp/a?secret=JBSWY3DPEHPK3PXP').error, 'type');
eq('not an otpauth URI', parse('https://example.com/?secret=JBSWY3DPEHPK3PXP').error, 'scheme');
eq('missing secret', parse('otpauth://totp/a?issuer=X').error, 'secret');
eq('invalid secret', parse('otpauth://totp/a?secret=ABC1').error, 'secret');
eq('unsupported algorithm', [parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5').error, parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&algorithm=MD5').value], ['algorithm', 'MD5']);
eq('digits 7 unsupported', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&digits=7').error, 'digits');
eq('period 0 rejected', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=0').error, 'period');
eq('period 1.5 rejected', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=1.5').error, 'period');
eq('period 45 accepted', parse('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP&period=45').period, 45);
eq('malformed percent-encoding in label', parse('otpauth://totp/%E0%A4%A?secret=JBSWY3DPEHPK3PXP').ok, false);
for (const o of [
  { issuer: 'Example', account: 'alice@google.com' },
  { issuer: 'ACME Co', account: 'john doe', algo: 'SHA-256', digits: 8, period: 60, secret: E.normalizeSecret(B32_32).secret },
  { issuer: '', account: '用户 1', algo: 'SHA-512', digits: 6, period: 45 },
]) {
  const u = build(o).uri;
  const p = parse(u);
  eq('build → parse round trip: ' + u, [p.secret, p.issuer, p.account, p.algo, p.digits, p.period],
    [o.secret || 'JBSWY3DPEHPK3PXP', o.issuer, o.account, o.algo || 'SHA-1', o.digits || 6, o.period || 30]);
}

// ---------- QR round trip with the vendor encoder the page loads ----------
const ctx = { TextEncoder, TextDecoder };
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/qrcode.min.js'), 'utf8'), ctx);
class ImageDataShim { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } }
const zctx = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, performance, ImageData: ImageDataShim });
zctx.globalThis = zctx;
vm.runInContext(readFileSync(join(root, 'public/vendor/zxing-reader.js'), 'utf8'), zctx);
await zctx.ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: readFileSync(join(root, 'public/vendor/zxing-reader.wasm')) }, fireImmediately: true });
async function qrRoundTrip(text) {
  const qr = ctx.QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const scale = 4;
  const margin = 4;
  const w = (n + margin * 2) * scale;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const o = (((y + margin) * scale + dy) * w + (x + margin) * scale + dx) * 4;
          px[o] = px[o + 1] = px[o + 2] = 0;
        }
      }
    }
  }
  const res = (await zctx.ZXingWASM.readBarcodes(new ImageDataShim(px, w, w), { formats: ['QRCode'] })).filter((r) => r.isValid);
  return res.length ? res[0].text : null;
}
for (const o of [
  { issuer: 'Example', account: 'alice@google.com' },
  { issuer: '示例 公司', account: 'テスト@example.jp', algo: 'SHA-512', digits: 8, period: 60, secret: E.normalizeSecret(B32_64).secret },
]) {
  const u = build(o).uri;
  const back = await qrRoundTrip(u);
  eq('QR round trip keeps the URI: ' + u.slice(0, 40), back, u);
  if (back) eq('QR round trip parses', parse(back).account, o.account);
}

// ---------- clock offset ----------
// Server clock 7 s ahead: request sent at local 1000, answered at local 1200, Date header = 8 s.
{
  const date = new Date(8000).toUTCString();
  const o = E.clockOffset(1000, 1200, date);
  eq('clock offset estimate', [o.offsetMs, o.uncertaintyMs], [7400, 600]);
  eq('offset of 7.4 ± 0.6 s → local clock behind', E.clockVerdict(o), { direction: 'behind', seconds: 7 });
  eq('clock ahead', E.clockVerdict(E.clockOffset(20000, 20100, new Date(10000).toUTCString())), { direction: 'ahead', seconds: 10 });
  eq('within one second → no warning', E.clockVerdict(E.clockOffset(1000, 1100, new Date(1000).toUTCString())), null);
  eq('large round trip hides a 3 s difference', E.clockVerdict(E.clockOffset(0, 8000, new Date(7000).toUTCString())), null);
  eq('missing Date header', E.clockOffset(0, 100, null), null);
  eq('invalid Date header', E.clockOffset(0, 100, 'yesterday'), null);
}

// ---------- the secret is not stored and not put in the URL ----------
{
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check('persistence policy is disabled (no GA4 / AdSense, stored input wiped)', /'totp-generator':\s*'disabled'/.test(persistence));
  const script = source.slice(source.indexOf('<script is:inline define:vars'));
  for (const [what, re] of [['localStorage', /localStorage/], ['sessionStorage', /sessionStorage/], ['ztPersist', /ztPersist/], ['indexedDB', /indexedDB/],
    ['history.pushState / replaceState', /history\.(push|replace)State/], ['location.hash assignment', /location\.hash\s*=/], ['location.search', /location\.search/], ['document.cookie', /document\.cookie/]]) {
    check('component script does not use ' + what, !re.test(script));
  }
  check('clock check sends no query string or body', /fetch\(location\.pathname, \{ method: 'HEAD', cache: 'no-store' \}\)/.test(script));
}

// ---------- strings ----------
check('STRINGS table found', !!STRINGS);
if (STRINGS) {
  const keys = Object.keys(STRINGS.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + lang, Object.keys(STRINGS[lang]).sort().join(','), keys);
  for (const k of ['errEmpty', 'errChar', 'errPadding', 'errLength', 'errColon', 'errUriScheme', 'errUriHotp', 'errUriType', 'errUriSecret', 'errUriAlgorithm', 'errUriDigits', 'errUriPeriod', 'clockBehind', 'clockAhead', 'weakKey']) {
    check('STRINGS.en has ' + k, typeof STRINGS.en[k] === 'string');
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
