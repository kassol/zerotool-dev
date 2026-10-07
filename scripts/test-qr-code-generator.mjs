// QR Code Generator — capacity, segmentation, content formats, output geometry, round trip
//
// Read:  src/components/tools/QrCodeGeneratorTool.astro (the real `engine:start` / `engine:end` block
//        and the frontmatter STRINGS); public/vendor/qrcode.min.js (the matrix builder the page loads);
//        public/vendor/zxing-reader.js + .wasm (an independent decoder, zxing-cpp); the engine block of
//        src/components/tools/QrCodeDecoderTool.astro (the site's content parser, for the formats);
//        src/content/tools/qr-code-generator/*.mdx (`{/* qrg-check: … */}` annotations)
//        src/data/tool-layouts.ts; and ToolLayout.astro's keyboard handler; the real page script runs in a DOM stand-in
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Sources of expected values: node-qrcode's own capacity check and segmentation (an independent
// implementation of ISO/IEC 18004), the Table 7 maxima printed in the standard (7089 / 4296 / 2953 /
// 1817 at 40-L), zxing-cpp decoding the rendered symbols, sharp rasterising the SVG output, and
// hand-written literals for the RFC 2426 / 6068 / 3966 / 5870 strings.
//
// Run: node scripts/test-qr-code-generator.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/QrCodeGeneratorTool.astro'), 'utf8');
function block(src, name) {
  const s = src.indexOf('/* ── engine:start ── */');
  const e = src.indexOf('/* ── engine:end ── */');
  if (s < 0 || e <= s) { console.error('FAIL: engine block not found in ' + name); process.exit(1); }
  return src.slice(s, e);
}
const E = new Function(block(source, 'generator') + `
return { dataCodewords, moduleCount, plan, optimalSegments, codePoints, bitsFor, libSegments, buildSjisTable,
  pngLayout, darkRuns, svgMarkup, colorCheck, buildContact, buildEmail, buildPhone, buildSms, buildGeo,
  looksLikeBareUrl, fileStem, phoneValue };`)();

const decSrc = readFileSync(join(root, 'src/components/tools/QrCodeDecoderTool.astro'), 'utf8');
const D = new Function(block(decSrc, 'decoder') + '\nreturn { classify };')();

let failures = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + (detail === undefined ? '' : ' — ' + detail)); } }
function eq(name, got, want) { const a = JSON.stringify(got), b = JSON.stringify(want); check(name, a === b, 'got ' + a + ', want ' + b); }

// ---------- vendor libraries ----------
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
const sjisDec = new TextDecoder('shift_jis');
const SJIS = E.buildSjisTable((a, b) => sjisDec.decode(new Uint8Array([a, b])));

/* Build the matrix the way the page does: plan → node-qrcode with explicit segments and version. */
function make(text, o = {}) {
  const p = E.plan(text, { ecl: o.ecl || 'M', version: o.version || 0, sjis: o.kanji ? SJIS : null });
  if (!p.ok) return { p };
  const lib = { errorCorrectionLevel: p.ecl, version: p.version };
  if (p.segments.some((s) => s.mode === 'K')) lib.toSJISFunc = (ch) => SJIS[ch.charCodeAt(0)];
  const qr = Q.create(E.libSegments(p.segments), lib);
  return { p, qr, n: qr.modules.size, get: (y, x) => qr.modules.get(y, x) };
}
function raster(get, n, { scale = 4, quiet = 4, fg = [0, 0, 0], bg = [255, 255, 255] } = {}) {
  const w = (n + 2 * quiet) * scale;
  const px = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < w * w; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; }
  for (const [y, x0, len] of E.darkRuns(get, n)) {
    for (let x = x0; x < x0 + len; x++) {
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const o = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
        px[o] = fg[0]; px[o + 1] = fg[1]; px[o + 2] = fg[2];
      }
    }
  }
  return { px, w };
}
async function decode(px, w, h = w) {
  const res = (await zctx.ZXingWASM.readBarcodes(new ImageDataShim(px, w, h), { formats: ['QRCode'], textMode: 'Plain' })).filter((r) => r.isValid);
  return res[0] || null;
}
async function roundTrip(text, o) {
  const m = make(text, o);
  if (!m.qr) return { m, r: null };
  const { px, w } = raster(m.get, m.n);
  return { m, r: await decode(px, w) };
}

// ---------- capacity: ISO/IEC 18004 Table 7, checked against node-qrcode at every version and level ----------
let capBad = [];
for (const ecl of ['L', 'M', 'Q', 'H']) {
  for (let v = 1; v <= 40; v++) {
    const maxBytes = Math.floor((E.dataCodewords(v, ecl) * 8 - 4 - (v <= 9 ? 8 : 16)) / 8);
    let fits = true, over = true;
    try { Q.create([{ data: 'a'.repeat(maxBytes), mode: 'byte' }], { errorCorrectionLevel: ecl, version: v }); } catch { fits = false; }
    try { Q.create([{ data: 'a'.repeat(maxBytes + 1), mode: 'byte' }], { errorCorrectionLevel: ecl, version: v }); over = false; } catch {}
    if (!fits || !over) capBad.push(ecl + v);
  }
}
eq('data codewords match node-qrcode at all 160 version/level pairs', capBad, []);
function maxCount(ch, ecl, kanji) {
  let lo = 1, hi = 8000;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (E.plan(ch.repeat(mid), { ecl, sjis: kanji ? SJIS : null }).ok) lo = mid; else hi = mid - 1; }
  return lo;
}
eq('Table 7 maxima at 40-L (numeric, alphanumeric, byte, Kanji)', [maxCount('7', 'L'), maxCount('A', 'L'), maxCount('a', 'L'), maxCount('漢', 'L', true)], [7089, 4296, 2953, 1817]);
eq('byte maxima at 40-M / Q / H', [maxCount('a', 'M'), maxCount('a', 'Q'), maxCount('a', 'H')], [2331, 1663, 1273]);
eq('version 1-H holds 17 digits and 7 bytes', [E.plan('1'.repeat(17), { ecl: 'H' }).version, E.plan('1'.repeat(18), { ecl: 'H' }).version, E.plan('a'.repeat(7), { ecl: 'H' }).version, E.plan('a'.repeat(8), { ecl: 'H' }).version], [1, 2, 1, 2]);
eq('module count', [E.moduleCount(1), E.moduleCount(40)], [21, 177]);

// ---------- too long: an error with numbers, never a truncated code ----------
const over = E.plan('a'.repeat(2954), { ecl: 'L' });
eq('2954 bytes at L: size error, 1 byte over, no lower level', [over.ok, over.reason, over.overBytes, over.fitsAt, over.capacityBits], [false, 'size', 1, null, 2956 * 8]);
const overM = E.plan('a'.repeat(2400), { ecl: 'M' });
eq('2400 bytes at M: fits at L', [overM.ok, overM.fitsAt], [false, 'L']);
const fixed = E.plan('x'.repeat(30), { ecl: 'L', version: 1 });
eq('fixed version 1 too small: smallest version that fits is 2', [fixed.ok, fixed.reason, fixed.minVersion], [false, 'version', 2]);
eq('fixed version 5 is used even when 2 would do', E.plan('x'.repeat(30), { ecl: 'L', version: 5 }).version, 5);
eq('empty text', E.plan('', {}).reason, 'empty');
const sur = E.plan('ab\ud83dcd', {});
eq('unpaired surrogate is refused with its position', [sur.ok, sur.reason, sur.index], [false, 'surrogate', 3]);

// ---------- segmentation: never more bits than node-qrcode's own segmentation ----------
const alphabet = [...'0123456789ABCDEFXYZ $%:/.abcxyz你好é😀-_\n'];
let worse = 0, smaller = 0, joined = 0;
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let t = 0; t < 2000; t++) {
  let s = '';
  const len = 1 + rnd(150);
  for (let i = 0; i < len; i++) s += alphabet[rnd(rnd(2) ? 10 : alphabet.length)];
  const p = E.plan(s, { ecl: 'M' });
  const lib = Q.create(s, { errorCorrectionLevel: 'M' });
  const libBits = lib.segments.reduce((a, sg) => a + 4 + ({ Numeric: [10, 12, 14], Alphanumeric: [9, 11, 13], Byte: [8, 16, 16], Kanji: [8, 10, 12] }[sg.mode.id][p.version <= 9 ? 0 : p.version <= 26 ? 1 : 2]) + sg.getBitsLength(), 0);
  if (p.version > lib.version) worse++;
  if (p.bits < libBits) smaller++;
  if (p.segments.map((x) => x.text).join('') !== s) joined++;
}
eq('2000 random strings: never a larger version than node-qrcode', worse, 0);
eq('segments join back to the input', joined, 0);
check('optimal split is sometimes smaller than node-qrcode', smaller > 0, smaller);
eq('digits, capitals and lower case are split by mode', E.plan('0123456789ABCDEFhello 你好', { ecl: 'L' }).segments.map((s) => s.mode + s.count), ['N10', 'A6', 'B12']);
eq('short digit run inside text stays in byte mode', E.plan('room 12 left', {}).segments.map((s) => s.mode), ['B']);
// Upper-case URL: alphanumeric mode (scheme and host are case-insensitive, RFC 3986 3.1 / 3.2.2)
eq('HTTPS://ZEROTOOL.DEV is version 1 at L, the lower-case form version 2', [E.plan('HTTPS://ZEROTOOL.DEV', { ecl: 'L' }).version, E.plan('https://zerotool.dev', { ecl: 'L' }).version], [1, 2]);

// ---------- Kanji mode ----------
eq('Shift_JIS table: JIS X 0208 (6,879) minus the 8 codes whose mapping differs', Object.keys(SJIS).length, 6871);
eq('あ ー 漢 are Kanji-mode characters; wave dash and fullwidth tilde are not', [SJIS[0x3042], SJIS[0x30fc], SJIS[0x6f22], SJIS[0x301c], SJIS[0xff5e]], [0x82a0, 0x815b, 0x8abf, undefined, undefined]);
const jaText = '会議室は3階です。受付で名前をお伝えください。';
const pk = E.plan(jaText, { ecl: 'L', sjis: SJIS }), pb = E.plan(jaText, { ecl: 'L' });
eq('Japanese sentence: Kanji mode version 3, UTF-8 bytes version 4', [pk.version, pk.segments.map((s) => s.mode + s.count), pb.version], [3, ['K4', 'N1', 'K18'], 4]);
eq('Simplified Chinese characters outside JIS X 0208 fall back to bytes', E.plan('们这', { sjis: SJIS }).segments.map((s) => s.mode), ['B']);
for (const s of [jaText, '本日のおすすめ：鯛の塩焼き定食（味噌汁・小鉢付き）です。数量限定のため、売り切れの際はご容赦ください。', 'カタカナー・ひらがな、漢字。', 'ＡＢＣ１２３「全角」', '東京都千代田区丸の内1-9-1', '～〜−']) {
  const { m, r } = await roundTrip(s, { ecl: 'M', kanji: true });
  eq('Kanji mode round trip: ' + s, r && r.text, s);
  if (m.p.segments.some((x) => x.mode === 'K')) check('Kanji segment present: ' + s, true);
}

// ---------- round trip through zxing-cpp ----------
const samples = [
  'https://zerotool.dev', 'HTTPS://ZEROTOOL.DEV/TOOLS/', '0123456789012345678901234567890', 'Hello, World!\r\nSecond line\n',
  '  leading and trailing  \n', '你好，世界', '안녕하세요 한글 QR', 'emoji 😀👨‍👩‍👧 ok', 'tab\tand NUL\u0000inside',
  'WIFI:T:WPA;S:Office;P:a\\;b;;', 'x'.repeat(1200),
];
for (const s of samples) {
  for (const ecl of ['L', 'H']) {
    const { m, r } = await roundTrip(s, { ecl });
    if (!m.qr) { check('encodes: ' + s.slice(0, 30) + ' ' + ecl, false, m.p.reason); continue; }
    eq('round trip ' + ecl + ': ' + JSON.stringify(s.slice(0, 30)), r && r.text, s);
    if (r) eq('decoded version and level ' + ecl + ': ' + s.slice(0, 20), [r.version, r.ecLevel], [String(m.p.version), ecl]);
    if (r) eq('no ECI header (]Q1): ' + s.slice(0, 20), [r.hasECI, r.symbologyIdentifier], [false, ']Q1']);
  }
}
{
  let bad = 0;
  for (let t = 0; t < 150; t++) {
    let s = '';
    const len = 1 + rnd(200);
    for (let i = 0; i < len; i++) s += alphabet[rnd(alphabet.length)];
    const ecl = 'LMQH'[rnd(4)];
    const { r } = await roundTrip(s, { ecl, kanji: rnd(2) === 1 });
    if (!r || r.text !== s) bad++;
  }
  eq('150 random strings decode back unchanged (all levels, Kanji on and off)', bad, 0);
}

// ---------- output geometry ----------
eq('PNG layout: whole pixels per module (25 modules + 8 quiet at 1024 px → 31 px, 1023 px)', E.pngLayout(25, 4, 1024), { modules: 33, scale: 31, size: 1023 });
eq('PNG layout never goes below 1 px per module', E.pngLayout(177, 4, 128), { modules: 185, scale: 1, size: 185 });
eq('the old 256 px output was not a whole number of pixels per module', 256 / 33 % 1 !== 0, true);
{
  const m = make('https://zerotool.dev', { ecl: 'M' });
  const svg = E.svgMarkup(m.get, m.n, { quiet: 4, scale: 10, fg: '#112233', bg: '#ffeedd', transparent: false });
  eq('SVG size and viewBox include the 4-module quiet zone', /width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg).slice(1).map(Number), [330, 330, 33, 33]);
  check('SVG has crispEdges, background rect and colors', /shape-rendering="crispEdges"/.test(svg) && /<rect width="33" height="33" fill="#ffeedd"\/>/.test(svg) && /<path fill="#112233"/.test(svg));
  // Re-read the path into a matrix: it must cover exactly the dark modules.
  const grid = Array.from({ length: m.n }, () => Array(m.n).fill(false));
  for (const mm of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) for (let x = 0; x < +mm[3]; x++) grid[+mm[2] - 4][+mm[1] - 4 + x] = true;
  let diff = 0;
  for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (grid[y][x] !== !!m.get(y, x)) diff++;
  eq('SVG path covers exactly the dark modules', diff, 0);
  const t = E.svgMarkup(m.get, m.n, { quiet: 2, scale: 1, fg: '#000000', bg: '#ffffff', transparent: true });
  check('transparent SVG has no background rect', !/<rect/.test(t) && /viewBox="0 0 29 29"/.test(t));
  for (const [label, s] of [['opaque', svg], ['transparent on white', t]]) {
    const { data, info } = await sharp(Buffer.from(s), { density: 72 }).resize(600, 600, { kernel: 'nearest' }).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = await decode(new Uint8ClampedArray(data), info.width, info.height);
    eq('SVG rendered by librsvg decodes (' + label + ')', r && r.text, 'https://zerotool.dev');
  }
}
{
  const m = make('zerotool', {});
  const runs = E.darkRuns(m.get, m.n);
  let count = 0; for (let y = 0; y < m.n; y++) for (let x = 0; x < m.n; x++) if (m.get(y, x)) count++;
  eq('dark runs add up to the dark module count', runs.reduce((a, r) => a + r[2], 0), count);
}
{
  const m = make('https://zerotool.dev', {});
  const inv = raster(m.get, m.n, { fg: [255, 255, 255], bg: [17, 17, 17] });
  const r = await decode(inv.px, inv.w);
  eq('light-on-dark (reflectance reversal) decodes and is reported as inverted', [r && r.text, r && r.isInverted], ['https://zerotool.dev', true]);
}

// ---------- colors ----------
eq('black on white', E.colorCheck('#000000', '#ffffff'), { contrast: 100, inverted: false, red: 100 });
eq('white on black is inverted', E.colorCheck('#ffffff', '#000000').inverted, true);
eq('red on white: luminance contrast passes, red channel difference 0', [E.colorCheck('#ff0000', '#ffffff').contrast >= 40, E.colorCheck('#ff0000', '#ffffff').red], [true, 0]);
eq('dark blue on white passes both', [E.colorCheck('#1a237e', '#ffffff').contrast >= 40, E.colorCheck('#1a237e', '#ffffff').red >= 40], [true, true]);
eq('mid grey on light grey is low contrast', E.colorCheck('#888888', '#bbbbbb').contrast < 40, true);

// ---------- content formats ----------
const vc = E.buildContact({ last: '山田', first: '太郎', plast: 'やまだ', pfirst: 'たろう', org: 'Example; Inc, Ltd', title: 'Engineer', mobile: '＋８１ ９０-１２３４-５６７８', email: 'taro@example.jp', url: 'https://example.jp', street: '丸の内1-9-1', city: '千代田区', region: '東京都', postal: '100-0005', country: '日本', note: 'line1\nline2 \\ end' }, 'vcard', 'ja');
eq('vCard 3.0 text (RFC 2426 escaping, CRLF, X-PHONETIC fields)', vc.text, [
  'BEGIN:VCARD', 'VERSION:3.0', 'N:山田;太郎;;;', 'FN:山田 太郎', 'X-PHONETIC-LAST-NAME:やまだ', 'X-PHONETIC-FIRST-NAME:たろう',
  'ORG:Example\\; Inc\\, Ltd', 'TITLE:Engineer', 'TEL;TYPE=CELL:+81 90-1234-5678', 'EMAIL;TYPE=INTERNET:taro@example.jp', 'URL:https://example.jp',
  'ADR;TYPE=WORK:;;丸の内1-9-1;千代田区;東京都;100-0005;日本', 'NOTE:line1\\nline2 \\\\ end', 'END:VCARD'].join('\r\n'));
eq('vCard FN: zh no space, en first-last', [E.buildContact({ last: '张', first: '伟' }, 'vcard', 'zh').text.split('\r\n')[3], E.buildContact({ last: 'Doe', first: 'Jane' }, 'vcard', 'en').text.split('\r\n')[3]], ['FN:张伟', 'FN:Jane Doe']);
const mc = E.buildContact({ last: '山田', first: '太郎', plast: 'ヤマダ', pfirst: 'タロウ', org: 'X', mobile: '090-1234-5678', email: 'a@example.jp', note: 'a;b' }, 'mecard', 'ja');
eq('MECARD text and dropped company note', [mc.text, mc.notes], ['MECARD:N:山田,太郎;SOUND:ヤマダ,タロウ;TEL:09012345678;EMAIL:a@example.jp;NOTE:a\\;b;;', ['wMecard']]);
eq('contact errors', [E.buildContact({}, 'vcard', 'en').error, E.buildContact({ first: 'A', email: 'nope' }, 'vcard', 'en').error, E.buildContact({ first: 'A', mobile: '090-abc' }, 'vcard', 'en').error], ['errContact', 'errEmail', 'errPhone']);
eq('mailto (RFC 6068): spaces %20, line breaks %0D%0A, @ kept', E.buildEmail({ to: 'hi@example.com', subject: 'Order #12 & more', body: 'Line 1\nLine 2' }).text, 'mailto:hi@example.com?subject=Order%20%2312%20%26%20more&body=Line%201%0D%0ALine%202');
eq('mailto without address', E.buildEmail({ subject: 'Hi' }).text, 'mailto:?subject=Hi');
eq('tel (RFC 3966): no spaces; local number flagged', [E.buildPhone({ number: '+1 (555) 010-0199' }).text, E.buildPhone({ number: '03-1234-5678' }).notes], ['tel:+1(555)010-0199', ['wTelLocal']]);
eq('SMSTO', E.buildSms({ number: '+82 10-1234-5678', body: '도착했어요: 3번 출구' }).text, 'SMSTO:+821012345678:도착했어요: 3번 출구');
eq('geo (RFC 5870) and range errors', [E.buildGeo({ lat: '35.6812', lon: '139.7671' }).text, E.buildGeo({ lat: '91', lon: '0' }).error, E.buildGeo({ lat: '1', lon: '181.5' }).error, E.buildGeo({ lat: '1,5', lon: '2' }).error], ['geo:35.6812,139.7671', 'errLat', 'errLon', 'errLat']);
// Each format survives encode → decode → the site's QR Code Reader parser
const parsed = async (text) => { const { r } = await roundTrip(text, {}); return r ? D.classify(r.text) : null; };
{
  const c = await parsed(vc.text);
  const f = Object.fromEntries((c.fields || []).map(([k, v]) => [k, v]));
  eq('vCard read back by the QR Code Reader parser', [c.type, f.name, f.org, f.tel, f.email, f.note], ['contact', '山田 太郎', 'Example; Inc, Ltd', '+81 90-1234-5678', 'taro@example.jp', 'line1\nline2 \\ end']);
  const m2 = await parsed(mc.text);
  const g = Object.fromEntries(m2.fields);
  eq('MECARD read back', [m2.type, g.name, g.reading, g.note], ['contact', '山田,太郎', 'ヤマダ,タロウ', 'a;b']);
  const em = await parsed(E.buildEmail({ to: 'hi@example.com', subject: 'Order #12 & more', body: 'Line 1\nLine 2' }).text);
  eq('mailto read back', em.fields, [['to', 'hi@example.com'], ['subject', 'Order #12 & more'], ['body', 'Line 1\r\nLine 2']]);
  eq('tel read back', (await parsed('tel:+15550100199')).fields, [['number', '+15550100199']]);
  eq('SMSTO read back', (await parsed('SMSTO:+821012345678:도착했어요: 3번 출구')).fields, [['number', '+821012345678'], ['body', '도착했어요: 3번 출구']]);
  eq('geo read back', (await parsed('geo:35.6812,139.7671')).fields, [['latitude', '35.6812'], ['longitude', '139.7671']]);
}
eq('bare web address detection', [E.looksLikeBareUrl('zerotool.dev'), E.looksLikeBareUrl('www.example.com/path?x=1'), E.looksLikeBareUrl('https://zerotool.dev'), E.looksLikeBareUrl('hello world'), E.looksLikeBareUrl('v1.2')], [true, true, false, false, false]);
eq('file names', [E.fileStem('https://zerotool.dev/tools/'), E.fileStem('你好'), E.fileStem('Hello World!')], ['qrcode-zerotool-dev', 'qrcode', 'qrcode-hello-world']);

// ---------- component wiring ----------
const STRINGS = new Function(/const STRINGS = (\{[\s\S]*?\n\});\nconst L =/.exec(source)[1].replace(/^/, 'return ') + ';')();
const keys = (o) => Object.keys(o).sort().join(',');
const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
for (const l of ['zh', 'ja', 'ko']) {
  eq('STRINGS keys ' + l, keys(STRINGS[l]), keys(STRINGS.en));
  const badPh = Object.keys(STRINGS.en).filter((k) => typeof STRINGS.en[k] === 'string' && ph(STRINGS.en[k]) !== ph(STRINGS[l][k] || ''));
  eq('placeholders ' + l, badPh, []);
}
const usedKeys = [...source.matchAll(/\bt\.(\w+)/g)].map((m) => m[1]).concat([...source.matchAll(/'(w[A-Z]\w+|err[A-Z]\w+)'/g)].map((m) => m[1]));
eq('every key the script uses exists', [...new Set(usedKeys)].filter((k) => !(k in STRINGS.en)), []);
check('quiet zone defaults to 4 modules', /selected=\{q === 4\}/.test(source));
const script = source.slice(source.indexOf('<script is:inline define:vars'));
check('no direct localStorage / sessionStorage / cookie / network', !/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon/.test(script));
const saved = /ztPersist\.save\(SLUG, \{([\s\S]*?)\}\);/.exec(script);
eq('only options are saved, never the content', saved && [...saved[1].matchAll(/(\w+):/g)].map((m) => m[1]), ['ecl', 'size', 'quiet', 'version', 'fg', 'bg', 'transparent', 'kanji', 'cformat']);
check('the page does not write HTML from content', !/innerHTML|insertAdjacentHTML|outerHTML/.test(script));
check('policy is preference', /'qr-code-generator': 'preference'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')));

// ---------- PNG exports keep the image and filename from the click ----------
// Only browser boundaries are replaced: canvas pixels, deferred toBlob, downloads and clipboard.
// The full page script, QR encoder and shared Ctrl+L handler run unchanged. Exported PNG bytes
// are decoded by ZXing, so changing the input after the click cannot pass with a new image.
function exportPage() {
  const nodes = new Map(), pendingBlobs = [], downloads = [], copied = [], urls = new Map(), timers = new Map(), frames = new Map();
  let seq = 0, resizeObserver;
  const document = { activeElement: null, listeners: {} };
  class Element {
    constructor(id = '', tag = 'div') {
      Object.assign(this, { id, tagName: tag.toUpperCase(), type: 'text', value: '', checked: false, hidden: false, disabled: false, style: {}, attributes: {}, listeners: {}, children: [], className: '', parentNode: null, clientWidth: 600, clientHeight: 520 });
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map((c) => c.textContent).join(''); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, extra = {}) { for (const fn of this.listeners[type] || []) fn.call(this, { type, target: this, preventDefault() {}, ...extra }); }
    click() { if (this.disabled) return; if (this.tagName === 'A') downloads.push({ name: this.download, blob: urls.get(this.href) }); this.dispatch('click'); }
    appendChild(child) { this.children.push(child); return child; }
    remove() {}
    focus() { document.activeElement = this; }
    closest() { return null; }
    contains(el) { return [...nodes.values()].includes(el); }
    querySelectorAll() { return [...nodes.values()].filter((el) => el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    get classList() {
      const el = this;
      return { toggle(c, on) { const names = new Set(el.className.split(' ').filter(Boolean)); if (on) names.add(c); else names.delete(c); el.className = [...names].join(' '); } };
    }
  }
  class Canvas extends Element {
    constructor(id = '') {
      super(id, 'canvas'); this.width = this.height = 0;
      this.context = { fillStyle: '#000000', clearRect: (x, y, w, h) => this.rect(x, y, w, h, [0, 0, 0, 0]), fillRect: (x, y, w, h) => this.rect(x, y, w, h, [...this.context.fillStyle.slice(1).match(/../g).map((v) => parseInt(v, 16)), 255]) };
    }
    rect(x, y, w, h, color) {
      if (this.pixels?.length !== this.width * this.height * 4) this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) this.pixels.set(color, (row * this.width + col) * 4);
    }
    getContext() { return this.context; }
    toBlob(callback) { pendingBlobs.push({ callback, pixels: new Uint8ClampedArray(this.pixels), width: this.width, height: this.height }); }
  }
  const get = (id) => { if (!nodes.has(id)) nodes.set(id, id === 'qrg-canvas' ? new Canvas(id) : new Element(id)); return nodes.get(id); };
  for (const m of source.matchAll(/<(input|textarea|select|button)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const el = get(m[2]); el.tagName = m[1].toUpperCase(); el.type = /\btype="([^"]+)"/.exec(m[0])?.[1] || 'text';
  }
  get('qrg-canvas').parentNode = get('qrg-preview');
  const tabs = ['text', 'contact', 'email', 'phone', 'sms', 'geo', 'wifi'].map((key) => { const el = get('qrg-tab-' + key); el.setAttribute('data-tab', key); return el; });
  Object.assign(document, {
    body: new Element('body'), getElementById: get,
    querySelector: (s) => s === '.tool-widget' ? get('widget') : s === '.tool-widget .btn-primary' ? get('qrg-png') : null,
    querySelectorAll: (s) => s === '.qrg-tab' ? tabs : [], createElement: (tag) => tag === 'canvas' ? new Canvas() : new Element('', tag),
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, extra) { for (const fn of this.listeners[type] || []) fn({ type, preventDefault() {}, ...extra }); },
  });
  for (const [key, value] of Object.entries({ text: 'https://alpha.example/old', ecl: 'M', size: '1024', quiet: '4', version: '0', fg: '#000000', bg: '#ffffff', cformat: 'vcard' })) get('qrg-' + key).value = value;
  const sandbox = {
    console, TextEncoder, TextDecoder, Uint8Array, Uint8ClampedArray, Blob, document, QRCode: Q, t: Object.fromEntries(Object.entries(STRINGS.en).filter(([key]) => key !== 'tips')), pageLang: 'en',
    ResizeObserver: class { constructor(callback) { this.callback = callback; resizeObserver = this; } observe(target) { this.target = target; } },
    URL: { createObjectURL(blob) { const url = 'blob:export-' + (++seq); urls.set(url, blob); return url; }, revokeObjectURL(url) { urls.delete(url); } },
    ClipboardItem: class { constructor(items) { this.items = items; } getType(type) { return Promise.resolve(this.items[type]); } },
    navigator: { clipboard: { async write(items) { for (const item of items) copied.push(await item.getType('image/png')); } } },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = ++seq; frames.set(id, fn); return id; },
    addEventListener() {}, devicePixelRatio: 1, ztPersist: { load() { return {}; }, save() {}, clear() {} }, _slug: 'qr-code-generator',
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const start = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
  vm.runInContext(layout.slice(start, layout.indexOf('// ── Copy button visual feedback', start)), context);
  const pageScript = /<script is:inline define:vars=[^>]*>([\s\S]*?)<\/script>/.exec(source);
  vm.runInContext(pageScript[1], context, { filename: 'QrCodeGeneratorTool.astro', lineOffset: source.slice(0, pageScript.index).split('\n').length - 1 });
  function flush() {
    const scheduled = [...frames.values()]; frames.clear(); scheduled.forEach((fn) => fn());
    for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); }
  }
  return {
    get, downloads, copied, pendingBlobs,
    resize(width, height, dpr = 1) {
      Object.assign(get('qrg-preview'), { clientWidth: width, clientHeight: height }); sandbox.devicePixelRatio = dpr;
      resizeObserver.callback([{ target: resizeObserver.target }]);
    },
    text(value) { get('qrg-text').value = value; get('qrg').dispatch('input', { target: get('qrg-text') }); flush(); },
    edit() { get('qrg-text').value = 'https://beta.example/new'; get('qrg').dispatch('input', { target: get('qrg-text') }); flush(); },
    clear() { get('qrg-text').focus(); document.dispatch('keydown', { ctrlKey: true, key: 'l' }); flush(); },
    switchTab() { get('qrg-p-num').value = '+12025550100'; get('qrg-tab-phone').click(); },
    async release() {
      const job = pendingBlobs.shift();
      const png = await sharp(Buffer.from(job.pixels), { raw: { width: job.width, height: job.height, channels: 4 } }).png().toBuffer();
      job.callback(new Blob([png], { type: 'image/png' }));
      await new Promise(setImmediate);
    },
  };
}
for (const action of ['edit', 'switchTab', 'clear']) {
  for (const kind of ['download', 'copy']) {
    const page = exportPage(), errors = [];
    const reject = (error) => errors.push(String(error));
    process.on('unhandledRejection', reject);
    try {
      page.get(kind === 'download' ? 'qrg-png' : 'qrg-copy').click();
      eq('PNG ' + kind + ': encoding waits for the callback (' + action + ')', page.pendingBlobs.length, 1);
      page[action]();
      await page.release();
      const blob = kind === 'download' ? page.downloads[0]?.blob : page.copied[0];
      let text = null;
      if (blob) {
        const { data, info } = await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        text = (await decode(new Uint8ClampedArray(data), info.width, info.height))?.text;
      }
      eq('PNG ' + kind + ': image retains click-time input after ' + action, text, 'https://alpha.example/old');
      if (kind === 'download') eq('PNG download: filename retains click-time input after ' + action, page.downloads[0]?.name, 'qrcode-alpha-example.png');
      eq('PNG ' + kind + ': no late rejection after ' + action, errors, []);
      if (action === 'clear') check('PNG ' + kind + ': completed export leaves cleared preview empty', page.get('qrg-canvas').hidden && page.get('qrg-png').disabled && page.get('qrg-text').value === '');
    } finally { process.removeListener('unhandledRejection', reject); }
  }
}

// ---------- preview follows the available area without changing exported pixels ----------
{
  const page = exportPage();
  const canvas = page.get('qrg-canvas');
  const payload = 'https://alpha.example/old';
  const modules = E.moduleCount(E.plan(payload, { ecl: 'M' }).version) + 8;
  for (const [width, height, dpr] of [[1000, 520, 1], [1000, 220, 1], [240, 600, 2], [600, 520, 1.25]]) {
    page.resize(width, height, dpr);
    const cssSize = parseFloat(canvas.style.width);
    check(`preview ${width}×${height}@${dpr}: fits both available dimensions`, cssSize <= Math.min(width, height) - 16);
    eq(`preview ${width}×${height}@${dpr}: square canvas`, canvas.width, canvas.height);
    eq(`preview ${width}×${height}@${dpr}: whole physical pixels per module`, canvas.width % modules, 0);
    eq(`preview ${width}×${height}@${dpr}: CSS size matches physical pixels`, cssSize * dpr, canvas.width);
    check(`preview ${width}×${height}@${dpr}: uses all complete modules that fit`, cssSize + modules / dpr > Math.min(width, height) - 16);
  }
  page.resize(1000, 700);
  check('wide preview grows beyond the former 260px cap', canvas.width > 260);
  eq('wide preview still decodes the entered content', (await decode(canvas.pixels, canvas.width, canvas.height))?.text, payload);
  page.get('qrg-png').click();
  eq('large preview does not change the selected PNG export size', page.pendingBlobs[0].width, 1023);
  const longText = 'a'.repeat(2100);
  page.text(longText); page.resize(300, 240, 2);
  const longModules = E.moduleCount(E.plan(longText, { ecl: 'M' }).version) + 8;
  check('dense code fits a compact preview', parseFloat(canvas.style.width) <= 224);
  eq('dense code keeps whole physical pixels per module', canvas.width % longModules, 0);
  eq('dense preview decodes without truncating content', (await decode(canvas.pixels, canvas.width, canvas.height))?.text, longText);
  page.text('a'.repeat(2400)); page.resize(1000, 700);
  check('resize after capacity error keeps the old preview hidden', canvas.hidden && page.get('qrg-png').disabled);
  check('capacity error stays visible after resize', page.get('qrg-status').textContent.includes('Too long'));
  page.clear(); page.resize(1000, 700);
  check('resize after Ctrl+L leaves preview and input empty', canvas.hidden && canvas.width === 0 && page.get('qrg-text').value === '');
}

// ---------- tool page claims (`{/* qrg-check: {...} */}` in the mdx) ----------
const mdxDir = join(root, 'src/content/tools/qr-code-generator');
let annotated = 0;
for (const f of readdirSync(mdxDir)) {
  const mdx = readFileSync(join(mdxDir, f), 'utf8');
  for (const m of mdx.matchAll(/\{\/\* qrg-check: (\{.*?\}) \*\/\}/g)) {
    annotated++;
    const c = JSON.parse(m[1]);
    if (c.repeat) c.text = c.repeat.repeat(c.count);
    const p = E.plan(c.text, { ecl: c.ecl || 'M', sjis: c.kanji ? SJIS : null, version: c.fixed || 0 });
    const got = {};
    if ('version' in c) got.version = p.ok ? p.version : null;
    if ('modes' in c) got.modes = p.ok ? p.segments.map((s) => s.mode + s.count).join(' ') : null;
    if ('bits' in c) got.bits = p.bits;
    if ('over' in c) got.over = p.overBytes;
    if ('fitsAt' in c) got.fitsAt = p.fitsAt;
    const want = Object.fromEntries(Object.keys(got).map((k) => [k, c[k]]));
    eq(f + ' claim ' + JSON.stringify(c.text).slice(0, 40), got, want);
  }
}
check('tool pages carry checked examples', annotated >= 8, annotated);

// ---------- v2 page layout ----------
const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script src='));
check('generate layout registered', /'qr-code-generator': 'generate'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('tool root directly contains the body and shared control rail', /^<div class="qrg" id="qrg">\s*<div class="qrg-body">\s*<div class="qrg-rail zt-rail">/.test(template));
check('all seven tab panels remain', ['text', 'contact', 'email', 'phone', 'sms', 'geo', 'wifi'].every((key) => template.includes('id="qrg-panel-' + key + '"')));
check('four export actions remain before the collapsed options', ['png', 'svg', 'copy', 'copysvg'].every((key) => template.indexOf('id="qrg-' + key + '"') < template.indexOf('qrg-settings')));
check('secondary contact, email, options and encoded text start collapsed', [...template.matchAll(/<details\b[^>]*>/g)].length === 4 && !/<details\b[^>]*\sopen(?:\s|>)/.test(template));
check('warnings stay outside collapsed sections', /<ul id="qrg-warn"/.test(template.slice(template.lastIndexOf('</details>'))));
check('tips are removed from serialized client strings', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = L/.test(source) && /define:vars=\{\{ t: CLIENT_T, pageLang: lang \}\}/.test(source));
check('no runtime i18n attribute rewriting', !source.includes('data-i18n'));
const tipKeys = ['input', 'contact', 'status', 'ecl', 'export', 'quiet', 'colors', 'kanji'];
eq('eight unique control tips', [...template.matchAll(/<Toggletip id="qrg-tip-([^" ]+)"/g)].map((m) => m[1]).sort(), [...tipKeys].sort());
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  eq(lang + ' tip keys', Object.keys(STRINGS[lang].tips).sort(), [...tipKeys].sort());
  check(lang + ' each tip contains text', tipKeys.every((key) => typeof STRINGS[lang].tips[key] === 'string' && STRINGS[lang].tips[key].length > 20));
  const mdx = readFileSync(join(root, 'src/content/tools/qr-code-generator', lang + '.mdx'), 'utf8');
  const steps = /^steps:\n([\s\S]*?)(?=^\S)/m.exec(mdx)?.[1].match(/^  - .+$/gm) || [];
  eq(lang + ' five usage steps', steps.length, 5);
  check(lang + ' steps fit content limits', steps.every((step) => JSON.parse(step.slice(4)).length <= 280) && steps.reduce((n, step) => n + JSON.parse(step.slice(4)).length, 0) <= 1200);
  check(lang + ' HowTo section removed', !/^## (?:How to Make a QR Code|三步生成|使い方|QR코드 만드는 순서)$/m.test(mdx));
  check(lang + ' limitations retained', /^## (?:Limits|限制|できないこと|한계)$/m.test(mdx));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
