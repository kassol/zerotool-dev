// QR Code Decoder — WIFI: payloads parsed field by field with backslash escapes
//
// Read:  src/components/tools/QrCodeDecoderTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the STRINGS table)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Format (ZXing wiki "Barcode Contents", Wi-Fi Network config): WIFI:T:<type>;S:<ssid>;
// P:<password>;H:<true|false>;; where `\` escapes the special characters ; , : " and \.
// Covers: escaped `;` `:` `,` `"` `\` in SSID and password are unescaped (before the fix
// `S:SHOP;P:ab\;cd;` gave the password `ab\` and `S:Home\;Net` gave `Home\`), an unescaped
// `:` or `P:` inside a value belongs to that value (before the fix `S:SHOP:2F;P:secret` showed
// the password `2F`), fields in any order, missing fields, the first of repeated fields,
// unknown fields (WPA2-EAP E: / A: / I: / PH2:) ignored, lower-case `wifi:` prefix, H:true /
// H:TRUE / H:false, a trailing backslash kept, the page examples, and the text Copy puts on the
// clipboard (label: unescaped value, one per line, in each page language). Two escaped payloads
// also go through public/vendor/qrcode.min.js (encode) and public/vendor/jsqr.min.js (the
// decoder the page loads) in a vm context before parsing.
//
// Run: node scripts/test-qr-code-decoder.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/QrCodeDecoderTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in QrCodeDecoderTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { parseWifi, wifiCopyText: typeof wifiCopyText === "function" ? wifiCopyText : null };')();

const stringsStart = source.indexOf('var STRINGS = {');
const stringsEnd = source.indexOf('\n      };', stringsStart);
const STRINGS = new Function(source.slice(stringsStart, stringsEnd + 9) + '\nreturn STRINGS;')();

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
const wifi = (ssid, pass, enc, hidden) => ({ ssid, pass, enc, hidden });
const p = (s) => E.parseWifi(s);

// ---------- the reported defect: escapes ----------
eq('escaped ; in password', p('WIFI:S:SHOP;P:ab\\;cd;;'), wifi('SHOP', 'ab;cd', '', false));
eq('escaped ; in SSID', p('WIFI:T:WPA;S:Home\\;Net;P:x;;'), wifi('Home;Net', 'x', 'WPA', false));
eq('escaped : , " \\', p('WIFI:T:WPA;S:a\\:b\\,c;P:q\\"r\\\\s;;'), wifi('a:b,c', 'q"r\\s', 'WPA', false));
eq('escaped backslash before ;', p('WIFI:S:x;P:end\\\\;T:WEP;;'), wifi('x', 'end\\', 'WEP', false));
eq('other escaped character is taken literally', p('WIFI:S:a\\bc;;'), wifi('abc', '', '', false));
eq('trailing backslash kept', p('WIFI:S:x;P:ab\\'), wifi('x', 'ab\\', '', false));

// ---------- field boundaries ----------
eq('unescaped : inside SSID stays in the SSID', p('WIFI:T:WPA;S:SHOP:2F;P:secret;;'), wifi('SHOP:2F', 'secret', 'WPA', false));
eq('P: inside SSID is not the password', p('WIFI:S:MYP:x;P:real;;'), wifi('MYP:x', 'real', '', false));
eq('T: inside password is not the type', p('WIFI:T:WPA;P:aT:b;S:n;;'), wifi('n', 'aT:b', 'WPA', false));
eq('any order', p('WIFI:P:pw;H:true;S:net;T:WPA;;'), wifi('net', 'pw', 'WPA', true));
eq('missing fields', p('WIFI:S:open;;'), wifi('open', '', '', false));
eq('first of repeated fields', p('WIFI:S:one;S:two;;'), wifi('one', '', '', false));
eq('unknown WPA2-EAP fields ignored', p('WIFI:T:WPA2-EAP;S:corp;E:PEAP;PH2:MSCHAPV2;I:alice;P:pw;;'),
  wifi('corp', 'pw', 'WPA2-EAP', false));
eq('lower-case prefix', p('wifi:S:x;P:y;;'), wifi('x', 'y', '', false));
eq('H:TRUE', p('WIFI:S:x;H:TRUE;;').hidden, true);
eq('H:false', p('WIFI:S:x;H:false;;').hidden, false);
eq('no trailing ;;', p('WIFI:S:x;P:y'), wifi('x', 'y', '', false));
eq('empty password', p('WIFI:T:nopass;S:guest;P:;;'), wifi('guest', '', 'nopass', false));
eq('non-ASCII SSID', p('WIFI:T:WPA;S:カフェ\\;2F;P:パス;;'), wifi('カフェ;2F', 'パス', 'WPA', false));

// ---------- page examples ----------
eq('page example', p('WIFI:T:WPA;S:CafeGuest;P:latte2026;;'), wifi('CafeGuest', 'latte2026', 'WPA', false));
eq('page example: escaped ;', p('WIFI:T:WPA;S:SHOP:2F;P:ab\\;cd;;'), wifi('SHOP:2F', 'ab;cd', 'WPA', false));
eq('page limit: unescaped ; ends the value', p('WIFI:S:x;P:ab;cd;;').pass, 'ab');

// ---------- round trip through the vendor encoder and the jsQR build the page loads ----------
const ctx = { TextEncoder, TextDecoder };
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/qrcode.min.js'), 'utf8'), ctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/jsqr.min.js'), 'utf8'), ctx);
function roundTrip(text) {
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
  const res = ctx.jsQR(px, w, w);
  return res ? res.data : null;
}
for (const [payload, expected] of [
  ['WIFI:T:WPA;S:SHOP:2F;P:ab\\;cd;;', wifi('SHOP:2F', 'ab;cd', 'WPA', false)],
  ['WIFI:T:WPA;S:Home\\;Net;P:q\\"r\\\\s;H:true;;', wifi('Home;Net', 'q"r\\s', 'WPA', true)],
]) {
  const decoded = roundTrip(payload);
  eq('jsQR returns the payload unchanged: ' + payload, decoded, payload);
  if (decoded) eq('round trip parsed: ' + payload, p(decoded), expected);
}

// ---------- copied text ----------
check('wifiCopyText exists', typeof E.wifiCopyText === 'function');
if (E.wifiCopyText) {
  eq('copy: labels and unescaped values',
    E.wifiCopyText(p('WIFI:T:WPA;S:SHOP;P:ab\\;cd;;'), STRINGS.en),
    'SSID: SHOP\nPassword: ab;cd\nEncryption: WPA');
  eq('copy: hidden flag',
    E.wifiCopyText(p('WIFI:S:x;P:y;H:true;;'), STRINGS.en), 'SSID: x\nPassword: y\nHidden: ✓');
  eq('copy: empty fields left out', E.wifiCopyText(p('WIFI:S:open;;'), STRINGS.en), 'SSID: open');
  eq('copy: zh labels', E.wifiCopyText(p('WIFI:T:WPA;S:a;P:b;;'), STRINGS.zh),
    STRINGS.zh.ssid + ': a\n' + STRINGS.zh.password + ': b\n' + STRINGS.zh.encryption + ': WPA');
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  check('STRINGS.' + lang + ' has Wi-Fi labels',
    ['ssid', 'password', 'encryption', 'hiddenNetwork'].every((k) => typeof STRINGS[lang][k] === 'string'));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
