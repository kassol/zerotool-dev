// QR Code Decoder — decoding pipeline, text encodings, content parsers and link safety
//
// Read:  src/components/tools/QrCodeDecoderTool.astro (the real engine block between the
//        `engine:start` / `engine:end` markers, the frontmatter STRINGS table and the page
//        script), public/vendor/zxing-reader.js + zxing-reader.wasm (the decoder the page
//        loads), public/vendor/qrcode.min.js (to draw test codes)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
// - Images the page used to fail on (jsQR 1.4.0 before 2026-09-30): light-on-dark codes
//   (`inversionAttempts: 'onlyInvert'` throws in jsQR 1.4.0, so the fallback never ran and
//   every image without a code said "Could not read image"), low contrast, several codes in
//   one image (jsQR returned none), a 4000×3000 noisy photo with a small code (jsQR: 20 s in
//   the browser, then nothing). Plus no quiet zone, 90° rotation, reading order of results,
//   and fitSize() for images above the 16,777,216-pixel canvas limit.
// - Text encodings. Fixtures are module matrices from segno 1.6.6 (Python) because the qrcode
//   library cannot write ECI: byte-mode UTF-8, Shift_JIS, GBK, EUC-KR and ISO-8859-1 without
//   ECI (jsQR returned "" for all non-UTF-8 bytes), binary bytes, ECI 26 / 20 / 29, and Kanji
//   mode. The guess follows ZXing StringUtils.guessCharset, with the page language's legacy
//   encoding tried first (ja Shift_JIS, zh GB18030, ko EUC-KR); the encoding menu re-decodes.
// - Parsers: Wi-Fi (ZXing escapes, unchanged from the 2026-09-30 fix), vCard 2.1 / 3.0 / 4.0,
//   MECARD, MATMSG, mailto (RFC 6068), sms / SMSTO (RFC 5724 / ZXing), tel (RFC 3966),
//   geo (RFC 5870), other schemes (weixin://, otpauth://) and plain text.
// - Link safety: only http(s) becomes a link; javascript: / data: / vbscript: / file: get a
//   warning and stay text; user@host and punycode hosts get warnings; the page script never
//   writes HTML (no innerHTML / outerHTML / insertAdjacentHTML / document.write) and only
//   assigns href from parseUrl() or the OpenStreetMap link built from numbers.
// - The decoder is served from /vendor (the IIFE build's default CDN is overridden), the wasm
//   file matches the SHA-256 the JS build expects, and jsQR is gone.
//
// Run: node scripts/test-qr-code-decoder.mjs

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const E = new Function(block + `
return { READER_OPTIONS, CAMERA_OPTIONS, fitSize, eciNumbers, zxingGuess, guessCharset, normalizeResult,
  sortResults, looksBinary, visibleControls, toHex, parseWifi, wifiCopyText, parseMecard, parseVcard,
  parseMatmsg, parseMailto, parseSms, parseTel, parseGeo, parseUrl, classify };`)();

const stringsStart = source.indexOf('const STRINGS = {');
const stringsEnd = source.indexOf('} as const;', stringsStart);
const STRINGS = new Function('return ' + source.slice(stringsStart + 'const STRINGS = '.length, stringsEnd + 1) + ';')();

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

// ---------- Wi-Fi (2026-09-30 fix: field by field, ZXing backslash escapes) ----------
const wifi = (ssid, pass, enc, hidden) => ({ ssid, pass, enc, hidden });
const p = (s) => E.parseWifi(s);
eq('wifi: escaped ; in password', p('WIFI:S:SHOP;P:ab\\;cd;;'), wifi('SHOP', 'ab;cd', '', false));
eq('wifi: escaped ; in SSID', p('WIFI:T:WPA;S:Home\\;Net;P:x;;'), wifi('Home;Net', 'x', 'WPA', false));
eq('wifi: escaped : , " \\', p('WIFI:T:WPA;S:a\\:b\\,c;P:q\\"r\\\\s;;'), wifi('a:b,c', 'q"r\\s', 'WPA', false));
eq('wifi: escaped backslash before ;', p('WIFI:S:x;P:end\\\\;T:WEP;;'), wifi('x', 'end\\', 'WEP', false));
eq('wifi: other escaped character is taken literally', p('WIFI:S:a\\bc;;'), wifi('abc', '', '', false));
eq('wifi: trailing backslash kept', p('WIFI:S:x;P:ab\\'), wifi('x', 'ab\\', '', false));
eq('wifi: unescaped : inside SSID stays in the SSID', p('WIFI:T:WPA;S:SHOP:2F;P:secret;;'), wifi('SHOP:2F', 'secret', 'WPA', false));
eq('wifi: P: inside SSID is not the password', p('WIFI:S:MYP:x;P:real;;'), wifi('MYP:x', 'real', '', false));
eq('wifi: T: inside password is not the type', p('WIFI:T:WPA;P:aT:b;S:n;;'), wifi('n', 'aT:b', 'WPA', false));
eq('wifi: any order', p('WIFI:P:pw;H:true;S:net;T:WPA;;'), wifi('net', 'pw', 'WPA', true));
eq('wifi: missing fields', p('WIFI:S:open;;'), wifi('open', '', '', false));
eq('wifi: first of repeated fields', p('WIFI:S:one;S:two;;'), wifi('one', '', '', false));
eq('wifi: unknown WPA2-EAP fields ignored', p('WIFI:T:WPA2-EAP;S:corp;E:PEAP;PH2:MSCHAPV2;I:alice;P:pw;;'),
  wifi('corp', 'pw', 'WPA2-EAP', false));
eq('wifi: lower-case prefix', p('wifi:S:x;P:y;;'), wifi('x', 'y', '', false));
eq('wifi: H:TRUE', p('WIFI:S:x;H:TRUE;;').hidden, true);
eq('wifi: H:false', p('WIFI:S:x;H:false;;').hidden, false);
eq('wifi: no trailing ;;', p('WIFI:S:x;P:y'), wifi('x', 'y', '', false));
eq('wifi: empty password', p('WIFI:T:nopass;S:guest;P:;;'), wifi('guest', '', 'nopass', false));
eq('wifi: non-ASCII SSID', p('WIFI:T:WPA;S:カフェ\\;2F;P:パス;;'), wifi('カフェ;2F', 'パス', 'WPA', false));
eq('wifi: page example', p('WIFI:T:WPA;S:CafeGuest;P:latte2026;;'), wifi('CafeGuest', 'latte2026', 'WPA', false));
eq('wifi: unescaped ; ends the value', p('WIFI:S:x;P:ab;cd;;').pass, 'ab');
eq('wifi copy: labels and unescaped values', E.wifiCopyText(p('WIFI:T:WPA;S:SHOP;P:ab\\;cd;;'), STRINGS.en.fields),
  'SSID: SHOP\nPassword: ab;cd\nEncryption: WPA');
eq('wifi copy: hidden flag', E.wifiCopyText(p('WIFI:S:x;P:y;H:true;;'), STRINGS.en.fields), 'SSID: x\nPassword: y\nHidden: ✓');
eq('wifi copy: empty fields left out', E.wifiCopyText(p('WIFI:S:open;;'), STRINGS.en.fields), 'SSID: open');
eq('wifi copy: zh labels', E.wifiCopyText(p('WIFI:T:WPA;S:a;P:b;;'), STRINGS.zh.fields), 'SSID: a\n密码: b\n加密方式: WPA');

// ---------- STRINGS: 4 languages with the same keys ----------
function keyPaths(o, prefix = '') {
  return Object.keys(o).sort().flatMap((k) => (o[k] && typeof o[k] === 'object' ? keyPaths(o[k], prefix + k + '.') : [prefix + k]));
}
for (const lang of ['zh', 'ja', 'ko']) {
  eq('STRINGS.' + lang + ' has the same keys as en', keyPaths(STRINGS[lang]), keyPaths(STRINGS.en));
}

// ---------- zxing-wasm (the vendored build the page loads) ----------
const vendorJs = join(root, 'public/vendor/zxing-reader.js');
const vendorWasm = join(root, 'public/vendor/zxing-reader.wasm');
check('vendor: zxing-reader.js exists', existsSync(vendorJs));
check('vendor: zxing-reader.wasm exists', existsSync(vendorWasm));
check('vendor: jsqr.min.js removed', !existsSync(join(root, 'public/vendor/jsqr.min.js')));
check('page: no jsQR left', !/jsqr|jsQR/.test(source));
const jsText = readFileSync(vendorJs, 'utf8');
const wasmBuf = readFileSync(vendorWasm);
const expectSha = (/ZXING_WASM_SHA256=`([0-9a-f]{64})`/.exec(jsText) || [])[1];
eq('vendor: wasm SHA-256 matches the JS build', createHash('sha256').update(wasmBuf).digest('hex'), expectSha);
check('page: wasm located under /vendor, not the CDN default', /locateFile[\s\S]{0,160}'\/vendor\/zxing-reader\.wasm'/.test(source));
check('page: script loaded from /vendor', source.includes("s.src = '/vendor/zxing-reader.js'"));

class ImageDataShim { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } }
const zctx = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, performance, ImageData: ImageDataShim });
zctx.globalThis = zctx;
vm.runInContext(jsText, zctx);
const Z = zctx.ZXingWASM;
await Z.prepareZXingModule({ overrides: { wasmBinary: wasmBuf }, fireImmediately: true });

const qctx = { TextEncoder, TextDecoder };
qctx.window = qctx;
qctx.self = qctx;
vm.createContext(qctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/qrcode.min.js'), 'utf8'), qctx);
function qrRows(text, ecl = 'M') {
  const qr = qctx.QRCode.create(text, { errorCorrectionLevel: ecl });
  const n = qr.modules.size;
  const rows = [];
  for (let y = 0; y < n; y++) { let r = ''; for (let x = 0; x < n; x++) r += qr.modules.get(y, x) ? '1' : '0'; rows.push(r); }
  return rows;
}
function canvas(w, h, bg = 255) {
  const data = new Uint8ClampedArray(w * h * 4).fill(bg);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { data, width: w, height: h };
}
function draw(img, rows, ox, oy, scale, fg = 0, bg = null) {
  const n = rows.length;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = rows[y][x] === '1';
    if (!on && bg === null) continue;
    const v = on ? fg : bg;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o = ((oy + y * scale + dy) * img.width + ox + x * scale + dx) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    }
  }
  return img;
}
function single(rows, { scale = 4, margin = 4, fg = 0, bg = 255 } = {}) {
  const w = (rows.length + margin * 2) * scale;
  return draw(canvas(w, w, bg), rows, margin * scale, margin * scale, scale, fg, bg);
}
async function read(img, opts = E.READER_OPTIONS) {
  const res = await Z.readBarcodes(new ImageDataShim(img.data, img.width, img.height), opts);
  return res.filter((r) => r.isValid);
}
async function texts(img, lang = 'en') {
  return E.sortResults(await read(img)).map((r) => E.normalizeResult(r, lang, null).text);
}

const URL1 = 'https://zerotool.dev/tools/qr-code-decoder/';
const rows1 = qrRows(URL1);
eq('decode: clean code', await texts(single(rows1)), [URL1]);
eq('decode: light-on-dark code (jsQR onlyInvert threw)', await texts(single(rows1, { fg: 255, bg: 0 })), [URL1]);
eq('decode: low contrast 110 on 170 (jsQR: none)', await texts(single(rows1, { fg: 110, bg: 170 })), [URL1]);
eq('decode: no quiet zone', await texts(single(rows1, { margin: 0 })), [URL1]);
const rotated = rows1.map((_, y) => rows1.map((r) => r[rows1.length - 1 - y]).join(''));
eq('decode: rotated 90°', await texts(single(rotated)), [URL1]);
eq('camera options decode a clean frame', (await read(single(rows1), E.CAMERA_OPTIONS)).length, 1);

// several codes: one row, then a 2×2 grid (reading order: top row left→right, then next row)
{
  const payloads = ['WIFI:T:WPA;S:CafeGuest;P:latte2026;;', 'https://example.com/menu', 'tel:+81312345678'];
  const all = payloads.map((t) => qrRows(t));
  const img = canvas(700, 260);
  let x = 20;
  for (const r of all) { draw(img, r, x, 30, 5); x += r.length * 5 + 40; }
  eq('decode: three codes in one image, left to right (jsQR: none)', await texts(img), payloads);
  const grid = ['A-top-left', 'B-top-right', 'C-bottom-left', 'D-bottom-right'].map((t) => qrRows(t));
  const g = canvas(420, 420);
  draw(g, grid[1], 240, 25, 6); draw(g, grid[0], 30, 20, 6); draw(g, grid[3], 245, 240, 6); draw(g, grid[2], 25, 235, 6);
  eq('decode: 2×2 grid in reading order', await texts(g), ['A-top-left', 'B-top-right', 'C-bottom-left', 'D-bottom-right']);
}

// 4000×3000 noisy photo with a 180 px code (jsQR in the browser: about 20 s, then nothing)
{
  const W = 4000, H = 3000;
  const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  let s = 7;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 120 + 60 * Math.sin(x / 200) * Math.cos(y / 170) + ((s / 0x7fffffff) - 0.5) * 60;
    const o = (y * W + x) * 4;
    img.data[o] = v + 20; img.data[o + 1] = v; img.data[o + 2] = v - 20; img.data[o + 3] = 255;
  }
  draw(img, rows1, 1800, 1300, 4, 0, 255);
  const t0 = performance.now();
  eq('decode: 4000×3000 photo with a small code', await texts(img), [URL1]);
  const ms = performance.now() - t0;
  check('decode: 4000×3000 photo in under 3 s', ms < 3000, Math.round(ms) + ' ms');
}

eq('fitSize: small image unchanged', E.fitSize(4000, 3000), { width: 4000, height: 3000, scaled: false });
{
  const f = E.fitSize(8000, 6000);
  check('fitSize: 48 MP image scaled under 16,777,216 px', f.scaled && f.width * f.height <= 16777216 && Math.abs(f.width / f.height - 4 / 3) < 0.01, JSON.stringify(f));
}

// ---------- text encodings (segno 1.6.6 matrices, hex rows) ----------
const SEGNO = {
  'utf8-noeci': ['1fd327f', '1041641', '175255d', '1759e5d', '175345d', '1046e41', '1fd557f', '0001e00', '1e5419d', '1082d3b', '19cf7af', '1bbc2fa', '0f7d01d', '0d11282', '0d69609', '1587ace', '02e29f2', '001b915', '1fcdf5e', '1042917', '1748bff', '175750b', '17520ce', '1055418', '1fdb1cf'],
  'sjis-noeci': ['1fd057f', '1053a41', '175995d', '175c35d', '174d85d', '105d741', '1fd557f', '0006d00', '19c532f', '0b91d05', '01de1a3', '0f9914a', '02e161a', '151cced', '06cb1bb', '048c869', '1d71df9', '001dd13', '1fc4953', '105b515', '1758bfc', '174a7e3', '1743af2', '1054b8a', '1fd1dbb'],
  'gbk-noeci': ['1fd247f', '1055641', '175a55d', '174cd5d', '175535d', '1047b41', '1fd557f', '0009500', '13f8597', '1fbc722', '02e7c7e', '13b2a38', '057f98f', '1e28520', '1857162', '161eed1', '127c1fd', '0017717', '1fd2950', '1055f14', '175d9fb', '175841b', '17454ab', '10402db', '1fd9e2d'],
  'euckr-noeci': ['1fd667f', '1052d41', '175305d', '1756b5d', '175275d', '104d841', '1fd557f', '0014800', '0d6965f', '11093d9', '1c68be8', '03be396', '0ed7160', '0c213f2', '104975a', '0f03e97', '1146df6', '0018b11', '1fd3758', '1045717', '1756df5', '174c714', '17519c9', '10590ae', '1fcb7eb'],
  'latin1-noeci': ['1fd887f', '1057941', '174a25d', '174c95d', '174495d', '104a041', '1fd557f', '0005400', '0877f83', '1529030', '1ee4aba', '0e91458', '1acbf0b', '1a1623e', '1244e13', '1796dde', '165fbfd', '0016919', '1fd8555', '1049711', '174e9ff', '17475e7', '174e629', '105b5d9', '1fc0379'],
  'binary': ['1fcc7f', '105841', '175f5d', '174a5d', '174c5d', '104b41', '1fd57f', '000800', '0ece06', '069b2b', '14f786', '1f3e52', '06d71c', '001569', '1fc542', '105931', '174308', '1754d2', '175d24', '105255', '1fccac'],
  'eci-utf8': ['1fcfc7f', '105a841', '174225d', '1746c5d', '175c95d', '1048a41', '1fd557f', '0005000', '1546412', '09b93a1', '1fd1a8b', '00820ea', '15f7ef3', '0d3f784', '11f3507', '0d05848', '107a3f9', '001a51e', '1fc455b', '104ad17', '17551f4', '174ff54', '17536e5', '1049ac9', '1fd750b'],
  'eci-sjis': ['1fc77f', '104841', '17555d', '17485d', '17485d', '104f41', '1fd57f', '001600', '1df4c4', '0d23cf', '087946', '1c9faa', '1c4c21', '0016fe', '1fd59b', '10546a', '17508f', '174ccc', '175655', '105a99', '1fd623'],
  'eci-gbk': ['1fca7f', '104241', '17435d', '175d5d', '17465d', '105541', '1fd57f', '001e00', '0c4468', '02a94c', '136d3e', '1c26c8', '094d4f', '001edc', '1fcda9', '104b82', '174f00', '174436', '1754f3', '105d07', '1fc8c9'],
  'kanji-mode': ['1fc67f', '104441', '17465d', '17595d', '174e5d', '105c41', '1fd57f', '001a00', '0c4868', '1898a7', '1566c8', '058e06', '0453fe', '001e3b', '1fcaeb', '104826', '1742fd', '174ec0', '175fb3', '1056c4', '1fc3de'],
};
const segnoRows = (k) => { const n = SEGNO[k].length; return SEGNO[k].map((h) => BigInt('0x' + h).toString(2).padStart(n, '0')); };
async function one(key, lang = 'en', charset = null) {
  const r = await read(single(segnoRows(key)));
  if (r.length !== 1) return { text: null, encoding: null, count: r.length };
  return E.normalizeResult(r[0], lang, charset);
}
{
  let n = await one('utf8-noeci');
  eq('encoding: UTF-8 bytes without ECI', [n.text, n.encoding.label, n.encoding.source], ['こんにちは、世界 café', 'utf-8', 'guess']);
  n = await one('sjis-noeci');
  eq('encoding: Shift_JIS bytes without ECI (jsQR: "")', [n.text, n.encoding.label], ['東京都千代田区丸の内 カフェ', 'shift_jis']);
  check('encoding: Shift_JIS text offers the encoding menu', n.canChangeEncoding === true);
  n = await one('gbk-noeci', 'en');
  eq('encoding: GBK on the en page guessed as ISO-8859-1 (ZXing rule)', n.encoding.label, 'iso-8859-1');
  n = await one('gbk-noeci', 'en', 'gb18030');
  eq('encoding: GBK re-decoded from the menu', [n.text, n.encoding.source], ['你好，世界。二维码测试', 'manual']);
  n = await one('gbk-noeci', 'zh');
  eq('encoding: GBK on the zh page', [n.text, n.encoding.label], ['你好，世界。二维码测试', 'gb18030']);
  n = await one('euckr-noeci', 'ko');
  eq('encoding: EUC-KR on the ko page', [n.text, n.encoding.label], ['안녕하세요 QR 코드', 'euc-kr']);
  n = await one('euckr-noeci', 'en', 'euc-kr');
  eq('encoding: EUC-KR re-decoded from the menu', n.text, '안녕하세요 QR 코드');
  n = await one('sjis-noeci', 'zh');
  check('encoding: Shift_JIS on the zh page still guessed by ZXing rule when GB18030 fails, or menu fixes it',
    n.text === '東京都千代田区丸の内 カフェ' || (await one('sjis-noeci', 'zh', 'shift_jis')).text === '東京都千代田区丸の内 カフェ');
  n = await one('latin1-noeci');
  eq('encoding: ISO-8859-1 without ECI', [n.text, n.encoding.label], ['Crème brûlée à Paris', 'iso-8859-1']);
  n = await one('eci-utf8');
  eq('encoding: ECI 26 (UTF-8)', [n.text, n.encoding.source, n.encoding.eci, n.encoding.name, n.canChangeEncoding], ['Grüße 你好 안녕', 'eci', 26, 'UTF-8', false]);
  n = await one('eci-sjis', 'ko');
  eq('encoding: ECI 20 (Shift_JIS) wins over the page language', [n.text, n.encoding.eci], ['こんにちは世界', 20]);
  n = await one('eci-gbk');
  eq('encoding: ECI 29 (GB2312)', [n.text, n.encoding.eci, n.encoding.name], ['你好世界', 29, 'GB2312']);
  n = await one('kanji-mode');
  eq('encoding: Kanji mode', [n.text, n.encoding.label], ['漢字モード', 'shift_jis']);
  n = await one('binary');
  eq('binary: detected, bytes kept', [n.binary, E.toHex(n.bytes)], [true, '00 ff 10 80 fe 02 9c 03 c3 28']);
  eq('binary: controls drawn as Control Pictures', E.visibleControls('\u0000a\u0002\u007f\tb'), '␀a␂␡\tb');
  n = await one('utf8-noeci');
  check('binary: normal text is not binary', n.binary === false);
}
eq('eciNumbers: ]Q2 with ECI 26', E.eciNumbers(new TextEncoder().encode(']Q2\\000026abc')), [26]);
eq('eciNumbers: escaped backslash is not an ECI', E.eciNumbers(new TextEncoder().encode(']Q2\\000020x\\\\000026')), [20]);
eq('eciNumbers: ]Q1 has none', E.eciNumbers(new TextEncoder().encode(']Q1\\000026')), []);
eq('zxingGuess: UTF-16 BOM', E.zxingGuess(new Uint8Array([0xfe, 0xff, 0, 0x41])), 'utf-16be');
eq('guessCharset: ASCII is UTF-8', E.guessCharset(new TextEncoder().encode('hello'), 'ja'), 'utf-8');

// ---------- content types ----------
const c = (s) => E.classify(s);
eq('classify: https URL', [c(URL1).type, c(URL1).url.host], ['url', 'zerotool.dev']);
eq('classify: uppercase scheme', c('HTTPS://EXAMPLE.COM/A').type, 'url');
eq('classify: Alipay precreate qr_code (opendocs.alipay.com/open/02np92)', [c('https://qr.alipay.com/bavh4wjlxf12tper3a').type, c('https://qr.alipay.com/bavh4wjlxf12tper3a').url.host], ['url', 'qr.alipay.com']);
eq('classify: WeChat Pay Native code_url is an app link', [c('weixin://wxpay/bizpayurl/up?pr=NwY5Mz9&groupid=00').type, c('weixin://wxpay/bizpayurl/up?pr=NwY5Mz9&groupid=00').scheme], ['link', 'weixin']);
eq('classify: otpauth is an app link', c('otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example').type, 'link');
eq('classify: www without scheme is text', c('www.example.com').type, 'text');
eq('classify: text with spaces', c('Hello, world').type, 'text');
eq('classify: URL followed by text is text', c('https://example.com see menu').type, 'text');
eq('classify: wifi', c('WIFI:T:WPA;S:CafeGuest;P:latte2026;;').type, 'wifi');

eq('vCard 3.0', c('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Tanaka;Hanako;;;\r\nFN:Hanako Tanaka\r\nORG:Example Corp\r\nTITLE:Engineer\r\nTEL;TYPE=CELL:+81-90-1234-5678\r\nEMAIL:hanako@example.jp\r\nADR;TYPE=WORK:;;1-1 Marunouchi;Chiyoda-ku;Tokyo;100-0005;Japan\r\nURL:https://example.jp\r\nNOTE:Line one\\nLine two\\, with comma\r\nEND:VCARD'),
  { type: 'contact', fields: [['name', 'Hanako Tanaka'], ['org', 'Example Corp'], ['title', 'Engineer'], ['tel', '+81-90-1234-5678'], ['email', 'hanako@example.jp'], ['address', '1-1 Marunouchi, Chiyoda-ku, Tokyo, 100-0005, Japan'], ['url', 'https://example.jp'], ['note', 'Line one\nLine two, with comma']], warnings: [] });
eq('vCard: N used when there is no FN, folded line joined', c('BEGIN:VCARD\nVERSION:4.0\nN:Kim;Minjun;;;\nitem1.TEL:010-1234\n 5678\nEND:VCARD').fields, [['name', 'Minjun Kim'], ['tel', '010-12345678']]);
eq('vCard 2.1 quoted-printable UTF-8', c('BEGIN:VCARD\nVERSION:2.1\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=E5=BC=A0=E4=B8=89\nEND:VCARD').fields, [['name', '张三']]);
eq('MECARD', c('MECARD:N:Sato,Taro;SOUND:サトウ,タロウ;TEL:0312345678;EMAIL:taro@example.jp;ADR:東京都千代田区;NOTE:a\\;b;;'),
  { type: 'contact', fields: [['name', 'Sato,Taro'], ['reading', 'サトウ,タロウ'], ['tel', '0312345678'], ['email', 'taro@example.jp'], ['address', '東京都千代田区'], ['note', 'a;b']], warnings: [] });
eq('MATMSG', c('MATMSG:TO:info@example.com;SUB:Order;BODY:Table 5;;').fields, [['to', 'info@example.com'], ['subject', 'Order'], ['body', 'Table 5']]);
eq('mailto with query', c('mailto:a@example.com?cc=b@example.com&subject=Hello%20there&body=Line%201%0ALine%202').fields,
  [['to', 'a@example.com'], ['cc', 'b@example.com'], ['subject', 'Hello there'], ['body', 'Line 1\nLine 2']]);
eq('tel', c('tel:+81-3-1234-5678;ext=12'), { type: 'phone', fields: [['number', '+81-3-1234-5678']], warnings: [] });
eq('sms (RFC 5724)', c('sms:+15105550101,+15105550102?body=hello%20there').fields, [['number', '+15105550101'], ['number', '+15105550102'], ['body', 'hello there']]);
eq('SMSTO (ZXing)', c('SMSTO:+819012345678:Hello: see you').fields, [['number', '+819012345678'], ['body', 'Hello: see you']]);
eq('geo (RFC 5870)', c('geo:35.6812,139.7671,40;u=10'), { type: 'geo', fields: [['latitude', '35.6812'], ['longitude', '139.7671'], ['altitude', '40']], map: 'https://www.openstreetmap.org/?mlat=35.6812&mlon=139.7671#map=16/35.6812/139.7671', warnings: [] });
eq('geo: Android ?q= search keeps 0,0 without a map link', [c('geo:0,0?q=Tokyo+Station').fields, c('geo:0,0?q=Tokyo+Station').map], [[['latitude', '0'], ['longitude', '0'], ['query', 'Tokyo Station']], null]);
eq('geo: out of range is an unparsed app link', [c('geo:95,10').type, c('geo:95,10').fields], ['link', undefined]);
eq('mailto: + stays +', c('mailto:a+tag@example.com').fields, [['to', 'a+tag@example.com']]);

// ---------- link safety ----------
for (const s of ['javascript:alert(document.cookie)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
  const r = c(s);
  eq('safety: ' + s.slice(0, 16) + '… is not a link', [r.type, r.warnings], ['link', ['script']]);
  eq('safety: parseUrl rejects ' + s.slice(0, 16), E.parseUrl(s), null);
}
eq('safety: user@host warning, real host shown', [c('https://paypal.com@evil.example/login').url.host, c('https://paypal.com@evil.example/login').warnings], ['evil.example', ['userinfo']]);
eq('safety: IDN host in punycode with warning', [c('https://аpple.com/').url.host, c('https://аpple.com/').warnings], ['xn--pple-43d.com', ['idn']]);
eq('safety: href is the parsed URL', E.parseUrl('https://example.com/a b') , null);
eq('safety: <script> text stays text', c('<script>alert(1)</script>').type, 'text');
{
  const script = source.slice(source.indexOf('<script is:inline'), source.indexOf('</script>'));
  check('safety: page script writes no HTML', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script));
  const hrefs = script.match(/\.href\s*=\s*[^;]+;/g) || [];
  eq('safety: href only from parseUrl() or the map link', hrefs, ['.href = cls.url.href;', '.href = cls.map;']);
  check('safety: result links open with noopener', /rel = 'noopener noreferrer nofollow'/.test(script));
  check('safety: nothing opened automatically', !/window\.open|location\.(href|assign|replace)\s*[=(]/.test(script));
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
