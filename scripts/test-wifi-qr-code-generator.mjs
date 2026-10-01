// Wi-Fi QR Code Generator — SSID length in UTF-8 bytes, passphrase length rules, quiet zone
//
// Read:  src/components/tools/WifiQrCodeGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers, so this test cannot drift from the shipped
//        source); src/content/tools/wifi-qr-code-generator/*.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defects: the SSID warning counted characters, but IEEE 802.11 limits an SSID
// to 32 octets and a CJK character is 3 bytes in UTF-8, so an 11-character Chinese name (33 bytes)
// passed silently; the PNG had a 2-module quiet zone where ISO/IEC 18004 requires 4. Also: WPA
// passphrase length (8–63 printable ASCII characters or 64 hex digits, IEEE 802.11 Annex J) and WEP
// key length (5 / 13 characters or 10 / 26 hex digits) warnings, the WIFI: payload escaping
// (ZXing "Barcode Contents"), and the margin passed to QRCode.toCanvas.
//
// Run: node scripts/test-wifi-qr-code-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/WifiQrCodeGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in WifiQrCodeGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { wifiPayload, utf8Length, wifiWarnings, QR_MARGIN };')();

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
const warn = (o) => E.wifiWarnings(Object.assign({ ssid: 'Home', password: 'password123', enc: 'WPA' }, o)).map((w) => w.key + (w.bytes !== undefined ? ':' + w.bytes : ''));

// ---------- SSID length in bytes ----------
eq('ASCII byte length', E.utf8Length('My Home Wi-Fi'), 13);
eq('CJK is 3 bytes each', E.utf8Length('咖啡店'), 9);
eq('Hangul is 3 bytes each', E.utf8Length('우리집'), 9);
eq('emoji is 4 bytes', E.utf8Length('😀'), 4);
eq('é is 2 bytes', E.utf8Length('é'), 2);
eq('32 ASCII characters: no warning', warn({ ssid: 'a'.repeat(32) }), []);
eq('33 ASCII characters', warn({ ssid: 'a'.repeat(33) }), ['ssidTooLong:33']);
eq('10 CJK characters (30 bytes): no warning', warn({ ssid: '咖'.repeat(10) }), []);
eq('11 CJK characters (33 bytes) — the reported case', warn({ ssid: '咖'.repeat(11) }), ['ssidTooLong:33']);
eq('「咖啡店二楼的访客无线网络名称」 is 42 bytes', warn({ ssid: '咖啡店二楼的访客无线网络名称' }), ['ssidTooLong:42']);
eq('「カフェ二階のゲスト用無線ネットワーク」 is 54 bytes', warn({ ssid: 'カフェ二階のゲスト用無線ネットワーク' }), ['ssidTooLong:54']);
eq('「우리집와이파이5G네트워크게스트용」 is 47 bytes', warn({ ssid: '우리집와이파이5G네트워크게스트용' }), ['ssidTooLong:47']);
eq('8 emoji (32 bytes): no warning', warn({ ssid: '😀'.repeat(8) }), []);

// ---------- WPA / WEP keys ----------
eq('WPA 8 characters ok', warn({ password: '12345678' }), []);
eq('WPA 63 characters ok', warn({ password: 'x'.repeat(63) }), []);
eq('WPA 64 hex digits ok', warn({ password: 'ab'.repeat(32) }), []);
eq('WPA 7 characters', warn({ password: '1234567' }), ['wpaPassphrase']);
eq('WPA 64 non-hex characters', warn({ password: 'z'.repeat(64) }), ['wpaPassphrase']);
eq('WPA non-ASCII passphrase', warn({ password: 'contraseña1' }), ['wpaPassphrase']);
eq('WPA empty password is not checked', warn({ password: '' }), []);
eq('WEP 5 / 13 characters, 10 / 26 hex', ['abcde', 'abcdefghijklm', '0123456789', 'a'.repeat(26)].map((p) => warn({ enc: 'WEP', password: p })), [[], [], [], []]);
eq('WEP 8 characters', warn({ enc: 'WEP', password: '12345678' }), ['wepKey']);
eq('open network ignores the password', warn({ enc: 'nopass', password: 'x' }), []);

// ---------- payload ----------
eq('payload with escaping', E.wifiPayload({ ssid: 'Cafe;Guest', password: 'p@ss:"word",1', enc: 'WPA', hidden: false }), 'WIFI:T:WPA;S:Cafe\\;Guest;P:p@ss\\:\\"word\\"\\,1;;');
eq('backslash escaped', E.wifiPayload({ ssid: 'a\\b', password: '', enc: 'nopass', hidden: true }), 'WIFI:T:nopass;S:a\\\\b;H:true;;');
eq('empty SSID gives no payload', E.wifiPayload({ ssid: '', password: 'x', enc: 'WPA' }), '');

// ---------- quiet zone ----------
eq('quiet zone is 4 modules', E.QR_MARGIN, 4);
check('toCanvas uses QR_MARGIN', /margin:\s*QR_MARGIN/.test(source));

// ---------- tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/wifi-qr-code-generator', lang + '.mdx'), 'utf8');
  check(lang + ' page no longer says the tool counts characters', !/2-module|2 个模块|2モジュール|2모듈/.test(mdx));
}

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    for (const l of ['en', 'zh', 'ja', 'ko']) check(l + ' ssidTooLong has {bytes}', S[l].ssidTooLong && S[l].ssidTooLong.includes('{bytes}'));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
