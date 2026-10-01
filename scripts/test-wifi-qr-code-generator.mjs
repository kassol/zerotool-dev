// WiFi QR Code Generator — WIFI: string, checks, readers, encoding engine copy, printable card
//
// Read:  src/components/tools/WifiQrCodeGeneratorTool.astro (the real `engine:start` / `engine:end`
//        block and the frontmatter STRINGS); the engine block of QrCodeGeneratorTool.astro (the
//        encoding functions copied from it must stay identical); the engine block of
//        QrCodeDecoderTool.astro (the site's Wi-Fi parser); public/vendor/qrcode.min.js (the matrix
//        builder the page loads); public/vendor/zxing-reader.js + .wasm (an independent decoder,
//        zxing-cpp); src/data/persistence.ts; src/content/tools/wifi-qr-code-generator/*.mdx
//        (`{/* wqg-check: … */}` annotations)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources of expected values: the WIFI URI examples in the WPA3 Specification v3.5 section 7.3;
// readers ported line by line from their published source — ZXing WifiResultParser /
// ResultParser.matchPrefixedField (core, master), Android WifiUriParser (packages/modules/Wifi,
// main: the newUriParsingForEscapeCharacter branch and the older split-and-unescape branch) — and a
// reader that follows only the WPA3 ABNF (percent-encoding); zxing-cpp decoding the rendered symbols;
// sharp (librsvg) rasterising the SVG and the card; IEEE 802.11 length limits as literals.
//
// Run: node scripts/test-wifi-qr-code-generator.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/WifiQrCodeGeneratorTool.astro'), 'utf8');
function block(src, name) {
  const s = src.indexOf('/* ── engine:start ── */');
  const e = src.indexOf('/* ── engine:end ── */');
  if (s < 0 || e <= s) { console.error('FAIL: engine block not found in ' + name); process.exit(1); }
  return src.slice(s, e);
}
const engine = block(source, 'wifi');
const E = new Function(engine + `
return { QR_MARGIN, escapeWifiField, wifiPayload, utf8Bytes, checkWifi, plan, libSegments, pngLayout, darkRuns, svgMarkup,
  colorCheck, wrapText, fitText, cardLayout, cardSvg, fileStem, textUnits, codePoints };`)();
const qrgSource = readFileSync(join(root, 'src/components/tools/QrCodeGeneratorTool.astro'), 'utf8');
const qrgEngine = block(qrgSource, 'qr-code-generator');
const D = new Function(block(readFileSync(join(root, 'src/components/tools/QrCodeDecoderTool.astro'), 'utf8'), 'decoder') + '\nreturn { parseWifi, classify };')();

let failures = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail === undefined ? '' : ' — ' + detail)); } }
function eq(name, got, want) { const a = JSON.stringify(got), b = JSON.stringify(want); check(name, a === b, 'got ' + a + ', want ' + b); }

// ---------- 1. encoding engine copied verbatim from the QR Code Generator ----------
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)([ \\t]*)(function ' + name + '\\(|var ' + name + ' =)');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  if (m[3].startsWith('var ')) return src.slice(start, src.indexOf(';\n', start) + 1);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
const COPIED = ['EC_PER_BLOCK', 'EC_BLOCKS', 'moduleCount', 'totalCodewords', 'dataCodewords', 'MODES', 'CCI', 'cciBits', 'ALNUM',
  'utf8Length', 'codePoints', 'charCost', 'segmentBits', 'optimalSegments', 'bitsFor', 'plan', 'LIB_MODE', 'libSegments',
  'pngLayout', 'darkRuns', 'svgMarkup', 'hexRgb', 'lin', 'luminance', 'colorCheck'];
for (const name of COPIED) {
  const a = extractDecl(engine, name), b = extractDecl(qrgEngine, name);
  check('engine copy: ' + name + ' found in both files', a !== null && b !== null);
  check('engine copy: ' + name + ' is identical to qr-code-generator', a !== null && a === b);
}

// ---------- 2. the WIFI: string ----------
const pay = (o) => E.wifiPayload(Object.assign({ security: 'WPA', hidden: false }, o));
eq('WPA3 spec 7.3 example 1 (WPA2 / WPA3 transition)', pay({ ssid: 'MyNet', password: 'MyPassword' }), 'WIFI:T:WPA;S:MyNet;P:MyPassword;;');
eq('WPA3 spec 7.3 example 2 (WPA3 only: R:1)', pay({ ssid: 'MyNet', password: 'MyPassword', security: 'WPA3' }), 'WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;');
eq('WEP', pay({ ssid: 'Old', password: 'abcde', security: 'WEP' }), 'WIFI:T:WEP;S:Old;P:abcde;;');
eq('open network: T:nopass, no P even when a password is typed', pay({ ssid: 'Lobby', password: 'x', security: 'nopass' }), 'WIFI:T:nopass;S:Lobby;;');
eq('hidden: H:true between S and P (spec ABNF order)', pay({ ssid: 'Lab', password: 'password1', hidden: true }), 'WIFI:T:WPA;S:Lab;H:true;P:password1;;');
eq('ZXing wiki example "foo;bar\\baz" with quotes', pay({ ssid: '"foo;bar\\baz"', password: 'password1' }), 'WIFI:T:WPA;S:\\"foo\\;bar\\\\baz\\";P:password1;;');
eq('escaping of \\ ; , : "', pay({ ssid: 'Cafe;Guest', password: 'p@ss:"w,d\\' }), 'WIFI:T:WPA;S:Cafe\\;Guest;P:p@ss\\:\\"w\\,d\\\\;;');
eq('empty SSID gives no string', pay({ ssid: '', password: 'x' }), '');
eq('UTF-8 SSID stays as typed', pay({ ssid: '咖啡店', password: '12345678' }), 'WIFI:T:WPA;S:咖啡店;P:12345678;;');

// ---------- 3. checks ----------
const chk = (o) => { const r = E.checkWifi(Object.assign({ ssid: 'Home', password: 'password123', security: 'WPA' }, o)); return r.error || r.warnings.map((w) => w.key + (w.bytes !== undefined ? ':' + w.bytes : '') + (w.n !== undefined ? ':' + w.n : '') + (w.field ? ':' + w.field : '') + (w.chars ? ':' + w.chars : '')); };
eq('byte length', [E.utf8Bytes('My Home Wi-Fi'), E.utf8Bytes('咖啡店'), E.utf8Bytes('우리집'), E.utf8Bytes('😀'), E.utf8Bytes('é')], [13, 9, 9, 4, 2]);
eq('32 ASCII bytes: no warning', chk({ ssid: 'a'.repeat(32) }), []);
eq('33 ASCII bytes', chk({ ssid: 'a'.repeat(33) }), ['wSsidBytes:33']);
eq('10 CJK characters (30 bytes): only the UTF-8 note', chk({ ssid: '咖'.repeat(10) }), ['wSsidUtf8']);
eq('11 CJK characters (33 bytes)', chk({ ssid: '咖啡店二楼访客无线网络' }), ['wSsidBytes:33', 'wSsidUtf8']);
eq('Japanese name over 32 bytes', chk({ ssid: 'カフェ二階のゲスト用無線ネットワーク' }), ['wSsidBytes:54', 'wSsidUtf8']);
eq('Korean name over 32 bytes', chk({ ssid: '우리집와이파이5G네트워크게스트용' }), ['wSsidBytes:47', 'wSsidUtf8']);
eq('8 emoji (32 bytes): only the UTF-8 note', chk({ ssid: '😀'.repeat(8) }), ['wSsidUtf8']);
eq('ASCII name: no UTF-8 note', chk({ ssid: 'Guest-WiFi 5G' }), []);
eq('empty SSID is an error', chk({ ssid: '' }), 'errEmptySsid');
eq('WPA without password is an error (Android rejects it)', chk({ password: '' }), 'errNoPassword');
eq('WPA3 without password is an error', chk({ password: '', security: 'WPA3' }), 'errNoPassword');
eq('WEP without key is an error', chk({ password: '', security: 'WEP' }), 'errNoKey');
eq('open network without password is fine', chk({ password: '', security: 'nopass' }), []);
eq('WPA 8 / 63 characters and 64 hex digits', [chk({ password: '12345678' }), chk({ password: 'x'.repeat(63) }), chk({ password: 'ab'.repeat(32) })], [[], [], []]);
eq('WPA 7 characters', chk({ password: '1234567' }), ['wWpaLength:7']);
eq('WPA 64 non-hex characters', chk({ password: 'z'.repeat(64) }), ['wWpaLength:64']);
eq('WPA non-ASCII password', chk({ password: 'contraseña1' }), ['wWpaLength:11']);
eq('WPA3 only: SAE takes any password, no length warning', [chk({ password: '1234', security: 'WPA3' }), chk({ password: 'パスワード', security: 'WPA3' })], [[], []]);
eq('WEP 5 / 13 characters, 10 / 26 hex: only the WEP security note', ['abcde', 'abcdefghijklm', '0123456789', 'a'.repeat(26)].map((p) => chk({ security: 'WEP', password: p })), [['wWep'], ['wWep'], ['wWep'], ['wWep']]);
eq('WEP 8 characters', chk({ security: 'WEP', password: '12345678' }), ['wWepKey', 'wWep']);
eq('open network ignores password content', chk({ security: 'nopass', password: ' a\\' }), []);
eq('leading / trailing spaces', [chk({ ssid: 'Home ' }), chk({ password: ' password1' })], [['wSpace:fieldSsid'], ['wSpace:fieldPassword']]);
eq('escaped characters are listed per field', chk({ ssid: 'Cafe;Guest', password: 'p@ss:"w,d' }), ['wEscape:fieldSsid:;', 'wEscape:fieldPassword:, : "']);
eq('%XX is listed (percent-encoding readers decode it)', chk({ password: 'abc%41def' }), ['wEscape:fieldPassword:%']);
eq('a lone % is not', chk({ password: '100%-sure!' }), []);
eq('trailing backslash', chk({ password: 'endswith\\' }), ['wEscape:fieldPassword:\\', 'wBackslashEnd:fieldPassword']);

// ---------- 4. readers ----------
// ZXing core: WifiResultParser + ResultParser.matchPrefixedField / unescapeBackslash (indexOf search
// for the prefix anywhere, odd count of preceding backslashes escapes the ';').
function zxUnescape(s) { let out = '', esc = false; for (const c of s) { if (esc || c !== '\\') { out += c; esc = false; } else esc = true; } return out; }
function zxMatch(prefix, raw) {
  let i = 0;
  while (i < raw.length) {
    i = raw.indexOf(prefix, i);
    if (i < 0) break;
    i += prefix.length;
    const start = i;
    for (;;) {
      i = raw.indexOf(';', i);
      if (i < 0) { i = raw.length; const el = zxUnescape(raw.slice(start)); if (el) return el; break; }
      let bs = 0; for (let k = i - 1; k >= 0 && raw[k] === '\\'; k--) bs++;
      if (bs % 2) { i++; continue; }
      const el = zxUnescape(raw.slice(start, i)); i++;
      if (el) return el;
      break;
    }
  }
  return null;
}
function zxingCore(text) {
  if (!text.startsWith('WIFI:')) return null;
  const raw = text.slice(5);
  const ssid = zxMatch('S:', raw);
  if (!ssid) return null;
  const h = zxMatch('H:', raw);
  return { ssid, password: zxMatch('P:', raw), type: zxMatch('T:', raw) || 'nopass', hidden: h !== null && h.toLowerCase() === 'true' };
}
// Android WifiUriParser, newUriParsingForEscapeCharacter branch (getZxingUriElement).
function androidElement(v, prefix) {
  let sb = '', handled = 0, esc = false;
  for (let i = prefix.length; i < v.length; i++) {
    const ch = v[i]; handled++;
    if (ch === '\\') { if (esc) { sb += ch; esc = false; continue; } esc = true; }
    else if (ch === ';') { if (!esc) break; sb += ch; esc = false; }
    else { sb += ch; esc = false; }
  }
  return [handled, sb];
}
function androidNew(text) {
  const q = text.slice(5), f = {};
  let start = 0;
  while (start < q.length) {
    const v = q.slice(start), ch = q[start];
    const key = ['S:', 'T:', 'P:', 'H:', 'R:'].find((k) => v.startsWith(k));
    if (key) { const [n, val] = androidElement(v, key); f[key[0]] = val; start += n + key.length; }
    else if (/\s/.test(ch) || ch === ';') start++;
    else { const [n] = androidElement(v, ''); start += n; }
  }
  return { ssid: f.S ?? null, password: f.P ?? null, type: f.T ?? null, hidden: (f.H || '').toLowerCase() === 'true', r: f.R ?? null };
}
// Android WifiUriParser, older branch: split on ';' not preceded by '\', then removeBackSlash.
function androidOld(text) {
  const parts = text.slice(5).split(/(?<!\\);/);
  const get = (p) => { for (const kv of parts) { const s = kv.replace(/^\s+/, ''); if (s.startsWith(p)) return s.slice(p.length); } return null; };
  const rb = (s) => s === null ? null : zxUnescape(s);
  return { ssid: rb(get('S:')), password: rb(get('P:')), type: rb(get('T:')), hidden: (get('H:') || '').toLowerCase() === 'true' };
}
// A reader that follows only the WPA3 ABNF: fields end at ';', values percent-decoded as octets.
function wpa3Strict(text) {
  const f = {};
  for (const part of text.slice(5).split(';')) {
    const m = /^([A-Z]):(.*)$/s.exec(part);
    if (m && !(m[1] in f)) f[m[1]] = m[2];
  }
  const dec = (s) => {
    if (s === undefined) return null;
    const cs = Array.from(s), bytes = [];
    for (let i = 0; i < cs.length; i++) {
      if (cs[i] === '%' && /^[0-9A-Fa-f]{2}$/.test((cs[i + 1] || '') + (cs[i + 2] || ''))) { bytes.push(parseInt(cs[i + 1] + cs[i + 2], 16)); i += 2; }
      else bytes.push(...Buffer.from(cs[i]));
    }
    return Buffer.from(bytes).toString('utf8');
  };
  return { ssid: dec(f.S), password: dec(f.P), type: f.T ?? null, hidden: f.H === 'true' };
}
{
  const r1 = androidNew('WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;'), r2 = androidOld('WIFI:T:WPA;R:1;S:MyNet;P:MyPassword;;');
  eq('Android reads the WPA3-only string: type WPA, R:1, fields', [r1.type, r1.r, r1.ssid, r1.password, r2.ssid], ['WPA', '1', 'MyNet', 'MyPassword', 'MyNet']);
  eq('reader ports agree with the ZXing wiki example', [zxingCore('WIFI:S:\\"foo\\;bar\\\\baz\\";;').ssid, androidNew('WIFI:S:\\"foo\\;bar\\\\baz\\";;').ssid], ['"foo;bar\\baz"', '"foo;bar\\baz"']);
  eq('older Android branch misreads a trailing backslash', androidOld('WIFI:T:WPA;S:Home;P:abc\\\\;;').password, 'abc\\;');
  eq('unescaped ";" (as some generators write) cuts the name', zxingCore('WIFI:T:WPA/WPA2;S:Cafe;Guest;P:x;;').ssid, 'Cafe');
}
let seed = 20261001;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const alphabet = [...'abcXYZ019 ;,:"\\%41@#$&*()[]{}<>?/=+-_\'`~!^|.咖啡店ゲスト와이파이😀é\t'];
function randomValue(min) { let s = ''; const len = min + rnd(14); for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)]; return s; }
{
  let zx = 0, an = 0, oldOk = 0, oldWarnMismatch = 0, strictMismatch = 0, dec = 0, n = 0;
  for (let k = 0; k < 4000; k++) {
    const sec = ['WPA', 'WPA3', 'WEP', 'nopass'][rnd(4)];
    const o = { ssid: randomValue(1), password: sec === 'nopass' ? '' : randomValue(1), security: sec, hidden: rnd(2) === 1 };
    const p = E.wifiPayload(o);
    const want = { ssid: o.ssid, password: sec === 'nopass' ? null : o.password, hidden: o.hidden };
    const a = zxingCore(p), b = androidNew(p), c = androidOld(p), s = wpa3Strict(p);
    if (JSON.stringify({ ssid: a.ssid, password: a.password, hidden: a.hidden }) !== JSON.stringify(want) || a.type !== (sec === 'WPA3' ? 'WPA' : sec)) zx++;
    if (JSON.stringify({ ssid: b.ssid, password: b.password, hidden: b.hidden }) !== JSON.stringify(want)) an++;
    const warns = E.checkWifi(o).warnings.map((w) => w.key);
    const oldRight = JSON.stringify({ ssid: c.ssid, password: c.password, hidden: c.hidden }) === JSON.stringify(want);
    if (oldRight === warns.includes('wBackslashEnd')) oldWarnMismatch++;
    if (oldRight) oldOk++;
    const strictRight = JSON.stringify({ ssid: s.ssid, password: s.password, hidden: s.hidden }) === JSON.stringify(want);
    if (strictRight === warns.includes('wEscape')) strictMismatch++;
    const w = D.parseWifi(p);
    if (w.ssid !== o.ssid || w.pass !== (sec === 'nopass' ? '' : o.password) || w.hidden !== o.hidden) dec++;
    n++;
  }
  eq('4000 random networks: ZXing core reads back every field', zx, 0);
  eq('4000 random networks: Android WifiUriParser (current branch) reads back every field', an, 0);
  eq('older Android branch fails exactly when the trailing-backslash warning is shown', oldWarnMismatch, 0);
  check('the older branch case occurs in the sample', oldOk < n);
  eq('a WPA3-ABNF-only reader fails exactly when the escape warning is shown', strictMismatch, 0);
  eq("the site's QR Code Reader parser reads back every field", dec, 0);
}

// ---------- 5. symbols: node-qrcode matrix → raster → zxing-cpp → parsers ----------
const ctx = { TextEncoder, TextDecoder };
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'public/vendor/qrcode.min.js'), 'utf8'), ctx);
const Q = ctx.QRCode;
class ImageDataShim { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } }
const zctx = vm.createContext({ console, WebAssembly, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout, performance, ImageData: ImageDataShim });
zctx.globalThis = zctx;
vm.runInContext(readFileSync(join(root, 'public/vendor/zxing-reader.js'), 'utf8'), zctx);
await zctx.ZXingWASM.prepareZXingModule({ overrides: { wasmBinary: readFileSync(join(root, 'public/vendor/zxing-reader.wasm')) }, fireImmediately: true });
function make(text, ecl = 'M') {
  const p = E.plan(text, { ecl });
  if (!p.ok) return { p };
  const qr = Q.create(E.libSegments(p.segments), { errorCorrectionLevel: ecl, version: p.version });
  return { p, qr, n: qr.modules.size, get: (y, x) => qr.modules.get(y, x) };
}
function raster(get, n, { scale = 4, quiet = 4, fg = [0, 0, 0], bg = [255, 255, 255] } = {}) {
  const w = (n + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < w * w; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  for (const [y, x0, len] of E.darkRuns(get, n)) for (let x = x0; x < x0 + len; x++) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
    const o = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
    px[o] = fg[0]; px[o + 1] = fg[1]; px[o + 2] = fg[2];
  }
  return { px, w };
}
async function decode(px, w, h = w) {
  const res = (await zctx.ZXingWASM.readBarcodes(new ImageDataShim(px, w, h), { formats: ['QRCode'], textMode: 'Plain' })).filter((r) => r.isValid);
  return res[0] || null;
}
const samples = [
  { ssid: 'Guest-WiFi', password: 'welcome-2026', security: 'WPA' },
  { ssid: 'MyNet', password: 'MyPassword', security: 'WPA3' },
  { ssid: 'Cafe;Guest', password: 'p@ss:"w,d\\', security: 'WPA' },
  { ssid: '咖啡店-访客', password: 'kafei2026', security: 'WPA' },
  { ssid: 'ゲスト用Wi-Fi', password: 'omotenashi-5G', security: 'WPA', hidden: true },
  { ssid: '우리집 와이파이', password: 'saranghae!', security: 'WPA' },
  { ssid: 'Lobby', password: '', security: 'nopass' },
  { ssid: 'Old Router', password: '0123456789', security: 'WEP' },
  { ssid: 'x'.repeat(32), password: 'a1'.repeat(32), security: 'WPA' },
];
for (const s of samples) {
  const text = E.wifiPayload(Object.assign({ hidden: false }, s));
  for (const ecl of ['L', 'H']) {
    const m = make(text, ecl);
    const { px, w } = raster(m.get, m.n);
    const r = await decode(px, w);
    eq('zxing-cpp decodes ' + ecl + ': ' + s.ssid.slice(0, 16), r && r.text, text);
    if (r) {
      eq('no ECI header (]Q1): ' + s.ssid.slice(0, 16), [r.hasECI, r.symbologyIdentifier], [false, ']Q1']);
      const c = D.classify(r.text);
      eq('QR Code Reader classifies as Wi-Fi with the same fields: ' + s.ssid.slice(0, 16), [c.type, c.wifi && c.wifi.ssid, c.wifi && c.wifi.pass], ['wifi', s.ssid, s.password]);
    }
  }
}
eq('quiet zone is 4 modules', E.QR_MARGIN, 4);
eq('PNG layout: whole pixels per module', E.pngLayout(25, E.QR_MARGIN, 1024), { modules: 33, scale: 31, size: 1023 });
check('every PNG / SVG / preview path uses QR_MARGIN', !/pngLayout\([^)]*,\s*\d+\s*,/.test(source) && (source.match(/QR_MARGIN/g) || []).length >= 8);
{
  const m = make(E.wifiPayload({ ssid: 'Guest-WiFi', password: 'welcome-2026', security: 'WPA' }));
  const svg = E.svgMarkup(m.get, m.n, { quiet: 4, scale: 10, fg: '#000000', bg: '#ffffff', transparent: false });
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = await decode(new Uint8ClampedArray(data), info.width, info.height);
  eq('QR SVG rendered by librsvg decodes', r && r.text, 'WIFI:T:WPA;S:Guest-WiFi;P:welcome-2026;;');
}
eq('colors: black on white passes, light grey fails', [E.colorCheck('#000000', '#ffffff').contrast, E.colorCheck('#999999', '#bbbbbb').contrast < 40], [100, true]);

// ---------- 6. printable card ----------
eq('text units: narrow 0.6, wide 1', [E.textUnits(0x41), E.textUnits(0x548c), E.textUnits(0xac00), E.textUnits(0xff21), E.textUnits(0x1f600)], [0.6, 1, 1, 1, 1]);
eq('wrapText never cuts: joined lines equal the text', [E.wrapText('abcdefghij', 3).join(''), E.wrapText('咖啡店二楼', 2).join(''), E.wrapText('😀😀😀', 2).length], ['abcdefghij', '咖啡店二楼', 2]);
eq('wrapText keeps surrogate pairs whole', E.wrapText('😀a😀', 1).every((l) => !/[\ud800-\udbff]$/.test(l)), true);
{
  let bad = 0;
  for (let k = 0; k < 500; k++) {
    const text = randomValue(1) + randomValue(30);
    const f = E.fitText(text, 1040, [60, 52, 44, 38]);
    if (f.lines.join('') !== text) bad++;
    for (const l of f.lines) { const u = E.codePoints(l).reduce((a, cp) => a + E.textUnits(cp), 0); if (u * f.size > 1040 + 1e-6 && E.codePoints(l).length > 1) bad++; }
  }
  eq('500 random values: lines rejoin to the value and fit the card width', bad, 0);
}
const labels = { network: 'Network', password: 'Password', hidden: 'Hidden network', space: '␣ means a space', scan: 'Point your phone camera at the code to join' };
async function cardCheck(name, o, payload) {
  const m = make(payload);
  const lay = E.cardLayout(Object.assign({ title: 'Guest Wi-Fi', n: m.n, labels }, o));
  check(name + ': card 1200 units wide, QR module a whole number of units, QR within 760', lay.width === 1200 && Number.isInteger(lay.qr.module) && lay.qr.size === lay.qr.module * (m.n + 8) && lay.qr.size <= 760);
  check(name + ': items stay inside the card', lay.items.every((it) => it.y > 0 && it.y < lay.height));
  const svg = E.cardSvg(lay, m.get, m.n, { fg: '#000000', bg: '#ffffff', lang: 'en' });
  const { data, info } = await sharp(Buffer.from(svg), { density: 305 }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const r = await decode(new Uint8ClampedArray(data), info.width, info.height);
  eq(name + ': card SVG rendered by librsvg decodes to the Wi-Fi string', r && r.text, payload);
  eq(name + ': card SVG is 100 mm wide', /width="100mm" height="([\d.]+)mm"/.exec(svg)[1], (lay.height / 12).toFixed(2));
  return { lay, svg };
}
{
  const o = { ssid: 'Guest-WiFi', password: 'welcome 2026', hidden: false };
  const { lay, svg } = await cardCheck('ASCII card', o, E.wifiPayload({ ssid: o.ssid, password: o.password, security: 'WPA' }));
  eq('password spaces are shown as ␣ with a note', lay.items.map((i) => i.text).filter((x) => /␣/.test(x)), ['welcome␣2026', '␣ means a space']);
  check('card text is XML-escaped', !/<text[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;)/.test(svg));
  const esc = E.cardSvg(E.cardLayout({ title: 'A & <B>', ssid: 'x"y', password: null, hidden: false, n: 25, labels }), () => false, 25, { fg: '#000', bg: '#fff', lang: 'en' });
  check('XML special characters in title and SSID', /A &amp; &lt;B&gt;/.test(esc) && /x&quot;y/.test(esc));
  const noPw = E.cardLayout({ title: '', ssid: 'Lobby', password: null, hidden: true, n: 25, labels });
  eq('card without password and with hidden note', noPw.items.map((i) => i.text), ['Network', 'Lobby', 'Hidden network', labels.scan]);
}
{
  const o = { ssid: '咖啡店二楼访客无线网络', password: 'kafei-2026-guest-network-password' };
  const { lay } = await cardCheck('CJK card', o, E.wifiPayload({ ssid: o.ssid, password: o.password, security: 'WPA' }));
  eq('long values wrap instead of shrinking forever', [lay.items.find((i) => i.text.startsWith('咖')).size >= 38, lay.items.filter((i) => i.font === 'mono').map((i) => i.text).join('')], [true, o.ssid + o.password]);
}
eq('file names', [E.fileStem('Guest-WiFi'), E.fileStem('咖啡店'), E.fileStem('Café Lobby!')], ['wifi-guest-wifi', 'wifi-qrcode', 'wifi-caf-lobby']);

// ---------- 7. component wiring ----------
const STRINGS = new Function('return ' + /const STRINGS = (\{[\s\S]*?\n\});\nconst L =/.exec(source)[1] + ';')();
const keys = (o) => Object.keys(o).sort().join(',');
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const l of ['zh', 'ja', 'ko']) {
  eq('STRINGS keys ' + l, keys(STRINGS[l]), keys(STRINGS.en));
  eq('placeholders ' + l, Object.keys(STRINGS.en).filter((k) => ph(STRINGS.en[k]) !== ph(STRINGS[l][k] || '')), []);
}
const script = source.slice(source.indexOf('<script is:inline define:vars'));
const usedKeys = [...script.matchAll(/\bt\.(\w+)/g)].map((m) => m[1]).concat([...engine.matchAll(/key: '(\w+)'|'(err\w+|field\w+)'/g)].map((m) => m[1] || m[2]));
eq('every key the script uses exists', [...new Set(usedKeys)].filter((k) => !(k in STRINGS.en)), []);
check('no storage, cookies or network in the script', !/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|ztPersist/.test(script));
check('the page does not write HTML', !/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(script));
check('persistence policy stays disabled (Wi-Fi password)', /'wifi-qr-code-generator': 'disabled'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')));

// ---------- 8. tool page claims (`{/* wqg-check: {...} */}` in the mdx) ----------
const mdxDir = join(root, 'src/content/tools/wifi-qr-code-generator');
let annotated = 0;
for (const f of readdirSync(mdxDir)) {
  const mdx = readFileSync(join(mdxDir, f), 'utf8');
  check(f + ' no longer mentions a 2-module quiet zone', !/2-module|2 个模块|2モジュール|2모듈/.test(mdx));
  for (const m of mdx.matchAll(/\{\/\* wqg-check: (\{.*?\}) \*\/\}/g)) {
    annotated++;
    const c = JSON.parse(m[1]);
    const o = { ssid: c.ssid, password: c.password || '', security: c.security || 'WPA', hidden: !!c.hidden };
    const got = {};
    if ('payload' in c) got.payload = E.wifiPayload(o);
    if ('warnings' in c) got.warnings = (() => { const r = E.checkWifi(o); return r.error ? [r.error] : r.warnings.map((w) => w.key); })();
    if ('version' in c) { const p = E.plan(E.wifiPayload(o), { ecl: c.ecl || 'M' }); got.version = p.ok ? p.version : null; }
    if ('bytes' in c) got.bytes = E.utf8Bytes(c.ssid);
    if ('payload' in c) check(f + ' shows the string it claims: ' + c.ssid, mdx.includes(c.payload) || mdx.includes(c.payload.replace(/\\/g, '\\\\')), c.payload);
    eq(f + ' claim ' + JSON.stringify(c.ssid), got, Object.fromEntries(Object.keys(got).map((k) => [k, c[k]])));
  }
}
check('tool pages carry checked examples', annotated >= 12, annotated);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
