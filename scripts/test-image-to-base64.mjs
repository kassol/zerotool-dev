// Image to Base64 — type detection, SVG data URI encoding, output formats and decoding
//
// Read:  src/components/tools/ImageToBase64Tool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the STRINGS table in the
//        frontmatter, so this test cannot drift from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the MIME type comes from the file signature (WHATWG MIME Sniffing 6.1 for
// PNG / JPEG / GIF / WebP / BMP / ICO; ISO BMFF ftyp brands for AVIF / HEIC / HEIF;
// TIFF; JPEG XL; SVG text sniffing past BOM, XML declaration, comments and DOCTYPE),
// real files written by sharp, and a 256-byte ftyp box that starts like an ICO. A PNG
// named .jpg gets image/png and a mismatch note (before this test the tool used the
// browser's extension-based file.type, so the data URI said image/jpeg); a file with
// no extension is detected (before: rejected); unknown bytes are refused with their
// first bytes. SVG URL-encoding: every byte survives Node's Fetch data: URL processor
// (random bytes too), no raw " # % & < > \ tab CR LF or non-ASCII, trailing spaces kept;
// a raw SVG data URI loses its newlines and everything after #. Output formats are
// parsed back with css-tree (CSS url()), parse5 (HTML src / alt) and
// mdast-util-from-markdown (Markdown image). Decoding: bare Base64, MIME line breaks,
// data URIs inside CSS / HTML / Markdown / JSON (with \/), URL-safe alphabet, missing
// padding, percent-encoded SVG, error positions for bad characters, = in the middle,
// impossible lengths and bad %-escapes; declared vs detected type; non-image bytes.
// Also: the 4-language STRINGS tables match, and the component never touches storage,
// cookies or the network. v2 page layout (DESIGN.md "Tool Pages v2"): the root element,
// the two-pane grid of each direction, the toggletips and their four-language text, the
// elements the script looks up, the CSS that follows the hidden attributes, the layout
// registration, and the steps / limits of the four mdx files.
//
// Run: node scripts/test-image-to-base64.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/ImageToBase64Tool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ImageToBase64Tool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { FILE_LIMIT, DISPLAY_LIMIT, sniffImage, detectImage, base64Length, percentEncodeBytes, buildOutput,
  dataUriBase64, dataUriSvg, parseDecodeInput, inspectDecoded, growthPercent, plural, fill, formatSize, hexHead };`)();

const stringsSrc = source.slice(source.indexOf('const STRINGS = ') + 'const STRINGS = '.length, source.indexOf('} as const;') + 1);
const STRINGS = new Function('return ' + stringsSrc)();

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
const bytesOf = (arr) => new Uint8Array(arr);
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const utf8 = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const b64 = (u8) => Buffer.from(u8).toString('base64');

// ---------- sniffing real files ----------
const sharp = require('sharp');
const svgSrc = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6" fill="#2563eb"/></svg>';
const base = sharp(Buffer.from(svgSrc));
const real = {
  png: await base.clone().png().toBuffer(),
  jpeg: await base.clone().jpeg().toBuffer(),
  gif: await base.clone().gif().toBuffer(),
  webp: await base.clone().webp().toBuffer(),
  avif: await base.clone().avif().toBuffer(),
  tiff: await base.clone().tiff().toBuffer(),
};
for (const [key, buf] of Object.entries(real)) eq('sharp ' + key + ' sniffed', E.sniffImage(new Uint8Array(buf)), key);

// ---------- signatures built from the specs ----------
const ftyp = (major, compat, size) => {
  const brands = [major, '\0\0\0\0', ...compat].join('');
  const len = size || 8 + brands.length;
  return bytesOf([len >>> 24 & 255, len >>> 16 & 255, len >>> 8 & 255, len & 255, ...ascii('ftyp' + brands), ...new Array(Math.max(0, len - 8 - brands.length)).fill(0)]);
};
eq('HEIC from an iPhone-style ftyp (heic, mif1)', E.sniffImage(ftyp('heic', ['mif1', 'heic'])), 'heic');
eq('HEIC as written by macOS sips (heic; mif1 MiPr miaf MiHB heic)', E.sniffImage(ftyp('heic', ['mif1', 'MiPr', 'miaf', 'MiHB', 'heic'])), 'heic');
eq('heix is HEIC', E.sniffImage(ftyp('heix', ['mif1'])), 'heic');
eq('hevc is an HEIC sequence', E.sniffImage(ftyp('hevc', ['msf1'])), 'heicseq');
eq('mif1 alone is HEIF', E.sniffImage(ftyp('mif1', ['mif1'])), 'heif');
eq('mif1 with avif compatible brand is AVIF', E.sniffImage(ftyp('mif1', ['mif1', 'avif', 'miaf'])), 'avif');
eq('avis is AVIF', E.sniffImage(ftyp('avis', ['avis', 'msf1'])), 'avif');
eq('MP4 ftyp is not an image', E.sniffImage(ftyp('isom', ['iso2', 'mp41'])), null);
const ftyp256 = ftyp('avif', ['mif1', 'avif'], 256);
eq('256-byte ftyp box begins 00 00 01 00 like ICO', [...ftyp256.slice(0, 4)], [0, 0, 1, 0]);
eq('256-byte ftyp box is AVIF, not ICO', E.sniffImage(ftyp256), 'avif');
eq('ICO', E.sniffImage(bytesOf([0, 0, 1, 0, 1, 0, 16, 16, 0, 0])), 'ico');
eq('CUR', E.sniffImage(bytesOf([0, 0, 2, 0, 1, 0, 16, 16])), 'cur');
eq('BMP', E.sniffImage(ascii('BM\x36\x00\x00\x00')), 'bmp');
eq('GIF87a', E.sniffImage(ascii('GIF87a\x01\x00')), 'gif');
eq('GIF89a', E.sniffImage(ascii('GIF89a\x01\x00')), 'gif');
eq('GIF90a is not GIF', E.sniffImage(ascii('GIF90a\x01\x00')), null);
eq('WebP needs WEBPVP', E.sniffImage(ascii('RIFF\x00\x00\x00\x00WEBPVP8 ')), 'webp');
eq('RIFF WAVE is not WebP', E.sniffImage(ascii('RIFF\x00\x00\x00\x00WAVEfmt ')), null);
eq('TIFF little-endian', E.sniffImage(bytesOf([0x49, 0x49, 0x2A, 0, 8, 0, 0, 0])), 'tiff');
eq('TIFF big-endian', E.sniffImage(bytesOf([0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8])), 'tiff');
eq('JPEG XL codestream', E.sniffImage(bytesOf([0xFF, 0x0A, 0xFA, 0x7F])), 'jxl');
eq('JPEG XL container', E.sniffImage(bytesOf([0, 0, 0, 0x0C, 0x4A, 0x58, 0x4C, 0x20, 0x0D, 0x0A, 0x87, 0x0A])), 'jxl');
eq('JPEG FF D8 FF', E.sniffImage(bytesOf([0xFF, 0xD8, 0xFF, 0xE0])), 'jpeg');
eq('PDF is not an image', E.sniffImage(ascii('%PDF-1.7\n')), null);
eq('ZIP is not an image', E.sniffImage(bytesOf([0x50, 0x4B, 3, 4])), null);
eq('empty is not an image', E.sniffImage(new Uint8Array(0)), null);

// ---------- SVG sniffing ----------
const svgCases = [
  ['plain', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'svg'],
  ['leading whitespace', '\n\t  <svg>', 'svg'],
  ['UTF-8 BOM', '\uFEFF<svg viewBox="0 0 1 1">', 'svg'],
  ['XML declaration', '<?xml version="1.0" encoding="UTF-8"?>\n<svg>', 'svg'],
  ['comment and PI', '<!-- Generator: Adobe Illustrator 27.0 --><?xml-stylesheet href="a.css"?><svg>', 'svg'],
  ['DOCTYPE with public id', '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg>', 'svg'],
  ['DOCTYPE with internal subset holding > and ]', '<!DOCTYPE svg [ <!ENTITY a "x>]y"> ]>\n<svg>', 'svg'],
  ['prefixed root', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg">', 'svg'],
  ['<svgfoo> is not SVG', '<svgfoo>', null],
  ['HTML is not SVG', '<!DOCTYPE html><html><svg>', null],
  ['RSS is not SVG', '<?xml version="1.0"?><rss>', null],
];
for (const [name, text, want] of svgCases) eq('SVG sniff: ' + name, E.sniffImage(utf8(text)), want);

// ---------- detectImage: content first, name second ----------
const png = new Uint8Array(real.png);
const d1 = E.detectImage(png, 'logo.jpg', 'image/jpeg');
eq('PNG named .jpg uses image/png', d1.mime, 'image/png');
eq('PNG named .jpg reports the mismatch', d1.mismatch, { ext: 'jpg' });
eq('PNG named .jpg: source is the signature', d1.source, 'signature');
eq('PNG without extension is detected', E.detectImage(png, 'noext', '').mime, 'image/png');
eq('PNG without extension: no mismatch', E.detectImage(png, 'noext', '').mismatch, null);
eq('JPEG named .JPEG: no mismatch', E.detectImage(new Uint8Array(real.jpeg), 'IMG_2031.JPEG', 'image/jpeg').mismatch, null);
eq('JPEG named .jfif: no mismatch', E.detectImage(new Uint8Array(real.jpeg), 'a.jfif', '').mismatch, null);
eq('HEIC named .heif: same family', E.detectImage(ftyp('heic', ['mif1']), 'a.heif', '').mismatch, null);
eq('ICO named .ico gets image/x-icon (MDN, WHATWG)', E.detectImage(bytesOf([0, 0, 1, 0, 1, 0]), 'favicon.ico', 'image/vnd.microsoft.icon').mime, 'image/x-icon');
eq('WebP named .png reports mismatch', E.detectImage(new Uint8Array(real.webp), 'hero.png', 'image/png').mismatch, { ext: 'png' });
const byName = E.detectImage(ascii('garbage!'), 'art.png', 'image/png');
eq('no signature, .png name: type from the name', [byName.mime, byName.source], ['image/png', 'name']);
const byReported = E.detectImage(ascii('garbage!'), 'blob', 'image/heic');
eq('no signature, no extension: browser-reported type', [byReported.mime, byReported.source], ['image/heic', 'name']);
const pdf = E.detectImage(ascii('%PDF-1.7\n%'), 'scan.pdf', 'application/pdf');
eq('PDF refused with first bytes', pdf, { error: 'notImage', hex: '25 50 44 46 2D 31 2E 37' });

// ---------- Base64 length and growth ----------
for (let n = 0; n <= 100; n++) {
  const len = E.base64Length(n);
  if (len !== Buffer.alloc(n).toString('base64').length) { check('base64Length(' + n + ')', false, len); break; }
}
check('base64Length matches Buffer for 0..100 bytes', true);
eq('800-byte PNG → 1,068 characters, +33.5%', [E.base64Length(800), E.growthPercent(800, E.base64Length(800))], [1068, '33.5']);
eq('1-byte file grows 300%', E.growthPercent(1, 4), '300.0');
eq('data URI with Base64', E.dataUriBase64('image/png', 'iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=');

// ---------- SVG URL-encoding ----------
const badge = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">\n  <rect width="120" height="40" rx="6" fill="#0f766e"/>\n  <text x="60" y="26" font-family="\'Noto Sans\', sans-serif" font-size="16" fill="#fff" text-anchor="middle">R&amp;D \u2713</text>\n</svg>\n';
const badgeBytes = utf8(badge);
const badgeUri = E.dataUriSvg(badgeBytes);
const fetchBytes = async (uri) => new Uint8Array(await (await fetch(uri)).arrayBuffer());
check('SVG URL-encoded data URI decodes to the same bytes (Fetch data: URL processor)', sameBytes(await fetchBytes(badgeUri), badgeBytes));
const body = badgeUri.slice('data:image/svg+xml,'.length);
check('no raw " # & < > \\ tab CR LF', !/["#&<>\\\t\r\n]/.test(body), body.match(/["#&<>\\\t\r\n]/));
check('every % starts an escape', !/%(?![0-9A-F]{2})/.test(body));
check('no non-ASCII characters', !/[^\x20-\x7E]/.test(body));
check('✓ is escaped as UTF-8 bytes', body.includes('%E2%9C%93'));
check('single quotes and spaces stay raw', body.includes("font-family=%22'Noto Sans', sans-serif%22"), body.slice(250, 330));
const b64Uri = E.dataUriBase64('image/svg+xml', b64(badgeBytes));
check('URL-encoded badge is shorter than Base64 (' + badgeUri.length + ' < ' + b64Uri.length + ')', badgeUri.length < b64Uri.length);
eq('badge lengths', [badgeBytes.length, badgeUri.length, b64Uri.length], [badgeBytes.length, badgeUri.length, 26 + E.base64Length(badgeBytes.length)]);
const naive = 'data:image/svg+xml,' + badge;
const naiveBytes = await fetchBytes(naive);
check('raw SVG data URI loses content (newlines removed, cut at #)', !sameBytes(naiveBytes, badgeBytes) && !Buffer.from(naiveBytes).toString().includes('\n') && !Buffer.from(naiveBytes).toString().includes('0f766e'));
const trailing = utf8('<svg/>   ');
check('trailing spaces survive', sameBytes(await fetchBytes(E.dataUriSvg(trailing)), trailing));
const latin1 = bytesOf([...ascii('<?xml version="1.0" encoding="ISO-8859-1"?><svg><text>caf'), 0xE9, ...ascii('</text></svg>')]);
check('ISO-8859-1 bytes kept as they are (%E9)', E.dataUriSvg(latin1).includes('caf%E9') && sameBytes(await fetchBytes(E.dataUriSvg(latin1)), latin1));
let rndOk = true;
for (let k = 0; k < 300 && rndOk; k++) {
  const n = Math.floor(Math.random() * 200);
  const r = new Uint8Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.floor(Math.random() * 256);
  if (k % 3 === 0 && n) r[n - 1] = 0x20;
  rndOk = sameBytes(await fetchBytes(E.dataUriSvg(r)), r);
}
check('300 random byte strings survive URL-encoding', rndOk);

// ---------- output formats parsed back ----------
const csstree = require('css-tree');
const parse5 = require('parse5');
const { fromMarkdown } = await import('mdast-util-from-markdown');
const cssUrl = (decl) => { let v = null; csstree.walk(csstree.parse('a{' + decl + '}'), (n) => { if (n.type === 'Url') v = n.value; }); return v; };
const htmlImg = (html) => { const frag = parse5.parseFragment(html); const img = frag.childNodes[0]; return Object.fromEntries(img.attrs.map((a) => [a.name, a.value])); };
const mdImg = (md) => { let img = null; const walk = (n) => { if (n.type === 'image') img = n; (n.children || []).forEach(walk); }; walk(fromMarkdown(md)); return img; };
const pngUri = E.dataUriBase64('image/png', b64(png));
for (const [label, uri, name] of [['PNG Base64', pngUri, 'logo.png'], ['SVG URL-encoded', badgeUri, 'badge [v2] "final".svg']]) {
  const o = { dataUri: uri, base64: 'QUJD', name, width: label === 'PNG Base64' ? 8 : 0, height: label === 'PNG Base64' ? 6 : 0 };
  eq(label + ': Data URI format', E.buildOutput('datauri', o), uri);
  eq(label + ': Base64 format is the file Base64', E.buildOutput('base64', o), 'QUJD');
  const css = E.buildOutput('css', o);
  check(label + ': CSS is a background-image declaration', /^background-image: url\(".*"\);$/.test(css));
  eq(label + ': CSS url() parses back to the data URI', cssUrl(css), uri);
  const attrs = htmlImg(E.buildOutput('html', o));
  eq(label + ': HTML src parses back to the data URI', attrs.src, uri);
  eq(label + ': HTML alt is the file name stem', attrs.alt, name.replace(/\.[a-z]+$/, ''));
  const md = E.buildOutput('markdown', o);
  const img = mdImg(md);
  eq(label + ': Markdown image url parses back', img && img.url, uri);
  eq(label + ': Markdown alt', img && img.alt, name.replace(/\.[a-z]+$/, ''));
}
eq('HTML has width and height for raster images', htmlImg(E.buildOutput('html', { dataUri: pngUri, name: 'a.png', width: 8, height: 6 })).width, '8');
eq('HTML omits width and height when unknown', [htmlImg(E.buildOutput('html', { dataUri: badgeUri, name: 'a.svg', width: 0, height: 0 })).width], [undefined]);
check('Markdown wraps a destination with spaces in <>', E.buildOutput('markdown', { dataUri: badgeUri, name: 'b.svg' }).startsWith('![b](<data:'));
check('Markdown keeps a Base64 destination bare', E.buildOutput('markdown', { dataUri: pngUri, name: 'b.png' }).startsWith('![b](data:'));

// ---------- decoding ----------
const pngB64 = b64(png);
const dec = (s) => E.parseDecodeInput(s);
const decOk = (name, input, wantBytes, wantDeclared, wantNotes) => {
  const r = dec(input);
  check(name + ': decodes', !r.error && sameBytes(r.bytes, wantBytes), JSON.stringify(r.error ? r : r.notes));
  if (wantDeclared !== undefined) eq(name + ': declared type', r.declared, wantDeclared);
  if (wantNotes) eq(name + ': notes', r.notes, wantNotes);
  return r;
};
decOk('bare Base64', pngB64, png, null, []);
decOk('MIME line breaks every 76 characters', pngB64.replace(/(.{76})/g, '$1\r\n'), png, null, []);
decOk('surrounding quotes', '"' + pngB64 + '"', png, null, []);
decOk('data URI', pngUri, png, 'image/png', []);
decOk('data URI with spaces around', '  ' + pngUri + '\n', png, 'image/png', []);
decOk('CSS url("…")', 'background-image: url("' + pngUri + '");', png, 'image/png', ['extracted']);
decOk('HTML <img>', '<img src="' + pngUri + '" alt="logo">', png, 'image/png', ['extracted']);
decOk('Markdown image', '![logo](' + pngUri + ')', png, 'image/png', ['extracted']);
decOk('JSON with \\/ (PHP json_encode)', '{"avatar":"' + pngUri.replace(/\//g, '\\/') + '"}', png, 'image/png', ['jsonSlash', 'extracted']);
decOk('uppercase DATA: and ;BASE64', 'DATA:image/png;BASE64,' + pngB64, png, 'image/png');
decOk('charset parameter before base64', 'data:image/png;charset=binary;base64,' + pngB64, png, 'image/png');
const unpadded = pngB64.replace(/=+$/, '');
decOk('missing padding', unpadded, png, null, []);
const tricky = bytesOf([...png.slice(0, 9), 0xFB, 0xFF, 0xBF, 0xFB, 0xFF, 0xBF]);
const trickyB64 = b64(tricky);
check('fixture has + and /', /\+/.test(trickyB64) && /\//.test(trickyB64));
decOk('URL-safe alphabet', trickyB64.replace(/\+/g, '-').replace(/\//g, '_'), tricky, null, ['urlSafe']);
decOk('URL-encoded SVG data URI', badgeUri, badgeBytes, 'image/svg+xml', []);
decOk('URL-encoded SVG inside url("…")', 'mask: url("' + badgeUri + '") no-repeat;', badgeBytes, 'image/svg+xml', ['extracted']);
decOk('URL-encoded SVG inside Markdown <…>', E.buildOutput('markdown', { dataUri: badgeUri, name: 'b.svg' }), badgeBytes, 'image/svg+xml', ['extracted']);
decOk('URL-encoded SVG inside HTML src', E.buildOutput('html', { dataUri: badgeUri, name: 'b.svg' }), badgeBytes, 'image/svg+xml', ['extracted']);
eq('empty input', dec('   \n'), { error: 'empty' });
eq('bad character position (1-based)', dec('iVBOR*w0KGgo'), { error: 'badChar', pos: 6, ch: '*' });
eq('bad character after a line break', dec('iVBO\nRw0K.Ggo'), { error: 'badChar', pos: 10, ch: '.' });
eq('emoji counts as one character', dec('\u{1F600}iVBOR'), { error: 'badChar', pos: 1, ch: '\u{1F600}' });
eq('position counted in the data URI text', dec('data:image/png;base64,iVBOR!w0'), { error: 'badChar', pos: 28, ch: '!' });
eq('= in the middle', dec('QQ==QUJD'), { error: 'padMiddle', pos: 3 });
eq('length remainder 1', dec('QUJDR'), { error: 'badLength', n: 5 });
eq('bad %-escape', dec('data:image/svg+xml,%3Csvg%ZZ'), { error: 'badPercent', pos: 26 });

const ins = (s) => E.inspectDecoded(E.parseDecodeInput(s));
const i1 = ins(pngUri);
eq('decoded PNG: type, extension, size', [i1.mime, i1.ext, i1.size, i1.declaredMismatch], ['image/png', 'png', png.length, null]);
eq('declared image/jpeg but PNG content', ins('data:image/jpeg;base64,' + pngB64).declaredMismatch, 'image/jpeg');
eq('declared image/jpg is JPEG family', ins('data:image/jpg;base64,' + b64(new Uint8Array(real.jpeg))).declaredMismatch, null);
eq('declared application/octet-stream is reported', ins('data:application/octet-stream;base64,' + pngB64).declaredMismatch, 'application/octet-stream');
eq('decoded HEIC downloads as .heic', ins(b64(ftyp('heic', ['mif1']))).ext, 'heic');
eq('decoded text is not an image', ins(b64(utf8('hello world'))), { error: 'notImage', hex: '68 65 6C 6C 6F 20 77 6F', size: 11 });

const big = new Uint8Array(6 * 1024 * 1024);
big.set(png.slice(0, 8));
for (let i = 8; i < big.length; i++) big[i] = (i * 2654435761) >>> 24;
const bigB64 = b64(big);
const t0 = performance.now();
const bigRes = dec('data:image/png;base64,' + bigB64);
const ms = performance.now() - t0;
check('6 MB decodes byte for byte', !bigRes.error && sameBytes(bigRes.bytes, big));
check('6 MB decodes in under 1.5 s (' + Math.round(ms) + ' ms)', ms < 1500 * PERF_SLACK);

// ---------- limits ----------
eq('file limit is 100 MB', E.FILE_LIMIT, 100 * 1024 * 1024);
check('display limit keeps large outputs out of the text box', E.DISPLAY_LIMIT > 0 && E.DISPLAY_LIMIT <= 5000000);

// ---------- strings ----------
const langs = ['en', 'zh', 'ja', 'ko'];
const keys = Object.keys(STRINGS.en).sort();
for (const l of langs) eq(l + ': same STRINGS keys as en', Object.keys(STRINGS[l]).sort(), keys);
const holders = (s) => (String(s).match(/\{\w+\}/g) || []).sort();
for (const k of keys) {
  for (const l of langs.slice(1)) {
    const a = STRINGS.en[k], b = STRINGS[l][k];
    if (Array.isArray(a)) eq(l + '.' + k + ' plural forms carry {n}', b.map(holders), [['{n}'].filter(() => b[0].includes('{n}')), ['{n}']]);
    else eq(l + '.' + k + ' placeholders', holders(b), holders(a));
  }
}
eq('plural en', E.plural(STRINGS.en.bytes, 1234, 'en'), '1,234 bytes');
eq('plural ja', E.plural(STRINGS.ja.chars, 1068, 'ja'), '1,068 文字');

// ---------- privacy ----------
const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
for (const api of ['localStorage', 'sessionStorage', 'ztPersist', 'indexedDB', 'document.cookie', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket']) {
  check('component script does not use ' + api, !script.includes(api));
}

// ---------- v2 page layout (DESIGN.md "Tool Pages v2", kind: convert) ----------
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  const style = source.slice(source.indexOf('<style>'));
  check('the tool root is .i2b-wrap (it gets the height of the first screen)', /^\s*<div class="i2b-wrap" id="i2b-wrap">/.test(markup) && /<\/section>\n<\/div>\s*$/.test(markup) && !source.includes('</script>\n</div>'));
  eq('each direction is a two-pane grid', (markup.match(/<section id="i2b-(?:enc|dec)" class="i2b-panel zt-io"/g) || []).length, 2);
  eq('four panes, two of them for the result', [(markup.match(/class="i2b-pane(?: i2b-pane--out)? zt-io-pane"/g) || []).length, (markup.match(/class="i2b-pane i2b-pane--out zt-io-pane"/g) || []).length], [4, 2]);
  eq('what fills each pane', (markup.match(/class="[^"]*zt-io-fill"/g) || []).map((m) => m.split(' ')[0].slice(7)),
    ['i2b-drop', 'i2b-fileline', 'i2b-result', 'i2b-empty', 'tool-textarea', 'i2b-dec-result', 'i2b-empty']);
  eq('one toggletip per explained control', (markup.match(/<Toggletip id="(i2b-tip-\w+)"/g) || []).map((m) => m.slice(15, -1)),
    ['i2b-tip-image', 'i2b-tip-output', 'i2b-tip-svg', 'i2b-tip-decin', 'i2b-tip-decout']);
  check('toggletip text stays out of the inline script', source.includes('define:vars={{ t: CLIENT_T, pageLang: lang }}') && source.includes('const { tips: TIPS, ...CLIENT_T } = T;'));
  const tipKeys = Object.keys(STRINGS.en.tips);
  eq('five toggletip texts', tipKeys, ['image', 'output', 'svg', 'decIn', 'decOut']);
  for (const l of langs) {
    eq(l + ': same toggletip keys as en', Object.keys(STRINGS[l].tips), tipKeys);
    check(l + ': toggletip and empty-pane texts are plain sentences', [...Object.values(STRINGS[l].tips), STRINGS[l].outEmpty, STRINGS[l].decOutEmpty, STRINGS[l].imgLabel]
      .every((s) => typeof s === 'string' && s.length > 1 && !/\{\w+\}|\n|https?:/.test(s)));
  }
  for (const key of tipKeys) check('TIPS.' + key + ' is rendered', markup.includes('{TIPS.' + key + '}'));
  check('both result panes have an empty hint', markup.includes('<p class="i2b-empty zt-io-fill"><span>{T.outEmpty}</span></p>') && markup.includes('<p class="i2b-empty zt-io-fill"><span>{T.decOutEmpty}</span></p>'));

  // The script was not changed for the new layout: every element it looks up is still
  // there once, and CSS derives the rest from the hidden attributes the script sets.
  const ids = [...new Set((script.match(/\$\('(i2b-[\w-]+)'\)/g) || []).map((m) => m.slice(3, -2)))].concat('i2b-wrap');
  check('the script looks up ' + ids.length + ' elements', ids.length === 29, ids.join(' '));
  for (const id of ids) eq('#' + id + ' is in the markup once', markup.split('id="' + id + '"').length - 1, 1);
  for (const cls of ['i2b-mode', 'i2b-fmt', 'i2b-enc']) check('.' + cls + ' buttons are kept', markup.includes('class="' + cls + '"') || markup.includes('class="' + cls + ' active"'));
  check('hidden panels and results are not displayed', style.includes('.i2b-panel[hidden], .i2b-result[hidden], .i2b-drop[hidden], .i2b-dec-result[hidden] { display: none; }'));
  for (const rule of ['.i2b-wrap:has(> #i2b-enc[hidden]) .i2b-for-enc', '.i2b-wrap:has(> #i2b-dec[hidden]) .i2b-for-dec', '.i2b-wrap:has(#i2b-result[hidden]) .i2b-loaded',
    '.i2b-wrap:has(#i2b-dec-result[hidden]) .i2b-dec-loaded', '.i2b-result:not([hidden]) ~ .i2b-empty', '.i2b-dec-result:not([hidden]) ~ .i2b-empty']) {
    check('visibility follows the script: ' + rule, style.includes(rule));
  }
  check('Download .txt stays hidden until the output is too long to show', markup.includes('<button id="i2b-download-txt" class="btn-secondary btn-sm" type="button" hidden>') &&
    style.includes('.i2b-head-end [hidden] { display: none; }') && script.includes('dlTxt.hidden = !tooLong;'));
  check('toolbar buttons of the other direction are marked', /id="i2b-decode" class="btn-primary i2b-for-dec"/.test(markup) && /id="i2b-dec-clear" class="btn-ghost i2b-for-dec"/.test(markup) &&
    /id="i2b-another" class="btn-secondary i2b-for-enc i2b-loaded"/.test(markup) && /id="i2b-clear" class="btn-ghost i2b-for-enc i2b-loaded"/.test(markup));
  // Ctrl/Cmd+Enter (ToolLayout) clicks the first .btn-primary of the tool, so Decode must stay the only one;
  // decoding does not run on input, so the button is needed.
  eq('Decode is the only primary button', (markup.match(/class="[^"]*btn-primary[^"]*"/g) || []).length, 1);
  check('decoding runs on the button only', !/decIn\.addEventListener\('input'/.test(script) && script.includes("$('i2b-decode').addEventListener('click'"));
  check('Ctrl/Cmd+L drops the file, the output and the decoded image', /key === 'l' \|\| e\.key === 'L'\) && wrap\.contains\(document\.activeElement\)\) \{\s*resetEncode\(\);\s*resetDecode\(false\);/.test(script));

  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('listed as a convert page', layouts.includes("'image-to-base64': 'convert'"));
  for (const lang of langs) {
    const mdx = readFileSync(join(root, `src/content/tools/image-to-base64/${lang}.mdx`), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const body = mdx.slice(front.length + 5);
    const steps = front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).match(/^  - ".*"$/gm) || [];
    eq(lang + ' mdx: 6 steps in the frontmatter', steps.length, 6);
    check(lang + ' mdx: steps fit the llms-full.txt limits', steps.every((s) => s.length - 6 <= 280) && steps.join('').length - 6 * steps.length <= 1200);
    // llms.mjs plainText() removes anything that looks like a tag, so the HTML <img> button is written with entities.
    check(lang + ' mdx: no raw tag in the steps', steps.every((s) => !/<[a-z!\/]/i.test(s)) && steps.some((s) => s.includes('HTML &lt;img&gt;')));
    check(lang + ' mdx: no usage section in the body', !/^## (How to Use|使用方法|使い方|사용 방법)\s*$/m.test(body));
    check(lang + ' mdx: the limits section stays', /^## (Limits|限制|制限|제한)\s*$/m.test(body));
  }
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
