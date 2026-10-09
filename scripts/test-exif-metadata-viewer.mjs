// EXIF Metadata Viewer — parser, strip pass and the example on the English page
//
// Read:  src/components/tools/ExifMetadataViewerTool.astro (extracts the code from the EXIF tag
//        tables to the DOM helpers), src/content/tools/exif-metadata-viewer/en.mdx,
//        src/data/persistence.ts, ToolLayout.astro keyboard callback
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: a JPEG written by sharp with IFD0 / Exif / GPS tags is parsed and formatted as the page
// says; the strip pass removes APP1 and APP13 and keeps APP0, APP2, APP14 (Adobe; CMYK JPEGs
// decode with wrong colours without it, and it used to be removed), COM and the scan data byte
// for byte; Orientation 2–8 is written back in a minimal APP1 in place of the old one (it used to
// be removed, so portrait phone photos were shown sideways), checked for all 8 values in big- and
// little-endian files with sharp and, when installed, exiftool; the drop-zone text states
// the same 100 MB limit the code enforces (it used to say 25 MB); the page stays `disabled`.
// S2-9c: UTF-8 text in ASCII-type tags, Latin-1 fallback for GBK / Shift_JIS / EUC-KR bytes, the
// Exif 3.0 UTF-8 type left undecoded, bad IFD offsets (no throw, localized notice), the copy
// fallback, and the emv-check worked examples on the four pages (test JPEGs written by tiff()).
//
// Run: node scripts/test-exif-metadata-viewer.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import vm from 'node:vm';
import { load as loadYaml } from 'js-yaml';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ExifMetadataViewerTool.astro'), 'utf8');
const STRINGS = vm.runInNewContext('(' + source.match(/const STRINGS = ([\s\S]*?) as const;/)[1] + ')');
const clientStrings = (lang) => new Function('STRINGS', 'lang', source.slice(source.indexOf('const T = STRINGS'), source.indexOf('\n---', 4)) + '\nreturn { TIPS, CLIENT_T };')(STRINGS, lang);
const page = readFileSync(join(root, 'src/content/tools/exif-metadata-viewer/en.mdx'), 'utf8');
const start = source.indexOf('      /* ── EXIF tag tables ── */');
const end = source.indexOf('      /* ── DOM helpers ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the parser in ExifMetadataViewerTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(start, end) + '\nreturn { parseExif, stripMetadata, fmtFNumber, fmtShutter, fmtFocal, fmtDate, dmsToDecimal, fmtCoord };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}
const ab = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
// Marker list of a JPEG up to the scan
function markers(buf) {
  const v = new DataView(buf);
  const out = [];
  let pos = 2;
  while (pos < v.byteLength - 4) {
    const m = v.getUint16(pos);
    out.push(m.toString(16).toUpperCase());
    if (m === 0xFFDA) break;
    pos += 2 + v.getUint16(pos + 2);
  }
  return out;
}
// Insert a segment right after SOI
const insert = (jpeg, seg) => Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
const segment = (marker, payload) => Buffer.concat([Buffer.from([0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
// ---------- a small big-endian TIFF writer for test files with known fields ----------
// spec: { ifd0: {...}, exif: {...}, gps: {...} } with tag names below. A string value is written
// as UTF-8 bytes in an ASCII-type field (what ExifTool 13.55 does for non-ASCII text); an object
// { utf8: 'text' } uses the Exif 3.0 UTF-8 type (129); { bytes: [...] } writes raw ASCII-type bytes
// (add `offset` to point the value somewhere else). Rationals are 'num/den' strings or arrays of
// them. opts.ifd0Offset overrides the IFD0 pointer in the header.
const TAGS = {
  ifd0: { Make: [0x010F, 2], Model: [0x0110, 2], Orientation: [0x0112, 3], Software: [0x0131, 2], DateTime: [0x0132, 2] },
  exif: { ExposureTime: [0x829A, 5], FNumber: [0x829D, 5], ISOSpeedRatings: [0x8827, 3], DateTimeOriginal: [0x9003, 2], OffsetTimeOriginal: [0x9011, 2], FocalLength: [0x920A, 5], LensModel: [0xA434, 2] },
  gps: { GPSLatitudeRef: [0x0001, 2], GPSLatitude: [0x0002, 5], GPSLongitudeRef: [0x0003, 2], GPSLongitude: [0x0004, 5], GPSAltitudeRef: [0x0005, 1], GPSAltitude: [0x0006, 5], GPSMapDatum: [0x0012, 2] },
};
function tiff(spec, opts = {}) {
  const chunks = [];
  let size = 8;
  const header = Buffer.alloc(8);
  header.write('MM', 0, 'latin1'); header.writeUInt16BE(42, 2);
  chunks.push(header);
  function encode(type, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.utf8 !== undefined) return { type: 129, data: Buffer.concat([Buffer.from(value.utf8, 'utf8'), Buffer.from([0])]), count: Buffer.byteLength(value.utf8) + 1 };
      return { type: 2, data: Buffer.from(value.bytes), count: value.bytes.length, offset: value.offset };
    }
    if (type === 2) { const d = Buffer.concat([Buffer.from(String(value), 'utf8'), Buffer.from([0])]); return { type, data: d, count: d.length }; }
    if (type === 1) return { type, data: Buffer.from([Number(value)]), count: 1 };
    if (type === 3) { const d = Buffer.alloc(2); d.writeUInt16BE(Number(value)); return { type, data: d, count: 1 }; }
    if (type === 4) { const d = Buffer.alloc(4); d.writeUInt32BE(Number(value)); return { type, data: d, count: 1 }; }
    const list = Array.isArray(value) ? value : [value];
    const d = Buffer.alloc(8 * list.length);
    list.forEach((r, i) => { const [n, den] = String(r).split('/').map(Number); d.writeUInt32BE(n, i * 8); d.writeUInt32BE(den ?? 1, i * 8 + 4); });
    return { type: 5, data: d, count: list.length };
  }
  function writeIfd(fields, table, extra = []) {
    const entries = Object.entries(fields || {}).map(([name, value]) => [table[name][0], encode(table[name][1], value)]);
    for (const [tag, e] of extra) entries.push([tag, e]);
    entries.sort((a, b) => a[0] - b[0]);
    const start = size;
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    ifd.writeUInt16BE(entries.length, 0);
    let dataAt = start + ifd.length;
    const data = [];
    entries.forEach(([tag, e], i) => {
      const o = 2 + i * 12;
      ifd.writeUInt16BE(tag, o); ifd.writeUInt16BE(e.type, o + 2); ifd.writeUInt32BE(e.count, o + 4);
      if (e.data.length <= 4 && e.offset === undefined) e.data.copy(ifd, o + 8);
      else { ifd.writeUInt32BE(e.offset ?? dataAt, o + 8); const padded = e.data.length % 2 ? Buffer.concat([e.data, Buffer.from([0])]) : e.data; data.push(padded); dataAt += padded.length; }
      e.at = o + 8; e.ifd = ifd;
    });
    chunks.push(ifd, ...data);
    size = dataAt;
    return { start, entries };
  }
  const pointer = (tag) => [tag, { type: 4, data: Buffer.alloc(4), count: 1 }];
  const sub = [];
  if (spec.exif) sub.push(pointer(0x8769));
  if (spec.gps) sub.push(pointer(0x8825));
  const ifd0 = writeIfd(spec.ifd0, TAGS.ifd0, sub);
  header.writeUInt32BE(opts.ifd0Offset ?? ifd0.start, 4);
  for (const [key, tag] of [['exif', 0x8769], ['gps', 0x8825]]) {
    if (!spec[key]) continue;
    const at = writeIfd(spec[key], TAGS[key]).start;
    const e = ifd0.entries.find(([t]) => t === tag)[1];
    e.ifd.writeUInt32BE(at, e.at);
  }
  return Buffer.concat(chunks);
}
// Put an EXIF APP1 holding `tiffBytes` right after SOI, replacing any APP1 already there.
function withApp1(jpeg, tiffBytes) {
  const app1 = segment(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffBytes]));
  const parts = [jpeg.subarray(0, 2), app1];
  let pos = 2;
  while (pos < jpeg.length) {
    const m = jpeg.readUInt16BE(pos);
    if (m === 0xFFDA) { parts.push(jpeg.subarray(pos)); break; }
    const end = pos + 2 + jpeg.readUInt16BE(pos + 2);
    if (m !== 0xFFE1) parts.push(jpeg.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(parts);
}

// Replace the APP1 of a JPEG with a little-endian (II) one: IFD0 = Make ("Canon") + Orientation,
// laid out by hand so the test does not rely on the tool's own writer
function withLittleEndianExif(jpeg, orientation) {
  const t = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 6);
  t.write('II', 0, 'latin1'); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4);
  t.writeUInt16LE(2, 8);
  t.writeUInt16LE(0x010F, 10); t.writeUInt16LE(2, 12); t.writeUInt32LE(6, 14); t.writeUInt32LE(38, 18);
  t.writeUInt16LE(0x0112, 22); t.writeUInt16LE(3, 24); t.writeUInt32LE(1, 26); t.writeUInt16LE(orientation, 30);
  t.writeUInt32LE(0, 34);
  t.write('Canon\0', 38, 'latin1');
  const app1 = segment(0xE1, Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]));
  const parts = [jpeg.subarray(0, 2)];
  let pos = 2;
  let placed = false;
  while (pos < jpeg.length) {
    const m = jpeg.readUInt16BE(pos);
    if (m === 0xFFDA) { if (!placed) parts.push(app1); parts.push(jpeg.subarray(pos)); break; }
    const end = pos + 2 + jpeg.readUInt16BE(pos + 2);
    if (m === 0xFFE1) { if (!placed) { parts.push(app1); placed = true; } }
    else parts.push(jpeg.subarray(pos, end));
    pos = end;
  }
  return Buffer.concat(parts);
}

// ---------- the page example ----------
const photo = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 120, b: 40 } } })
  .jpeg()
  .withExif({
    IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro', Software: '17.6.1', DateTime: '2026:09:30 18:42:10' },
    IFD2: { DateTimeOriginal: '2026:09:30 18:42:07', FNumber: '1.78', ExposureTime: '0.008333333', ISOSpeedRatings: '80', FocalLength: '6.86', LensModel: 'iPhone 15 Pro back triple camera 6.86mm f/1.78' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 2964/100', GPSLongitudeRef: 'E', GPSLongitude: '2/1 17/1 4020/100', GPSAltitudeRef: '0', GPSAltitude: '35/1' },
  })
  .toBuffer();
const parsed = E.parseExif(ab(photo)).exif;
eq('make / model', [parsed.ifd0.Make, parsed.ifd0.Model], ['Apple', 'iPhone 15 Pro']);
eq('original date', E.fmtDate(parsed.exif.DateTimeOriginal), '2026-09-30 18:42:07');
eq('exposure', [E.fmtFNumber(parsed.exif.FNumber), E.fmtShutter(parsed.exif.ExposureTime), parsed.exif.ISOSpeedRatings, E.fmtFocal(parsed.exif.FocalLength)], ['f/1.8', '1/125s', 80, '7 mm']);
const lat = E.dmsToDecimal(parsed.gps.GPSLatitude, parsed.gps.GPSLatitudeRef);
const lon = E.dmsToDecimal(parsed.gps.GPSLongitude, parsed.gps.GPSLongitudeRef);
eq('GPS', [E.fmtCoord(lat, true), E.fmtCoord(lon, false), parsed.gps.GPSAltitude.toFixed(1) + ' m'], ['48.858233° N', '2.294500° E', '35.0 m']);
eq('software', parsed.ifd0.Software, '17.6.1');
for (const text of ['f/1.8, 1/125s, 80, 7 mm', '48.858233° N, 2.294500° E, 35.0 m', 'Original: 2026-09-30 18:42:07', 'Software: 17.6.1']) {
  eq('page shows ' + text, page.includes(text), true);
}
const cleaned = Buffer.from(E.stripMetadata(ab(photo)));
eq('page sizes', page.includes(`turned the ${photo.length}-byte file into a ${cleaned.length}-byte file`), true);
eq('cleaned file has no EXIF', E.parseExif(ab(cleaned)).exif, null);
const meta = await sharp(cleaned).metadata();
eq('cleaned file still decodes at 64 × 48', [meta.width, meta.height], [64, 48]);
eq('cleaned file has no EXIF for sharp', meta.exif, undefined);

// ---------- which segments are kept ----------
const app13 = segment(0xED, Buffer.from('Photoshop 3.0\0' + '8BIM\x04\x04\0\0\0\0\0\0'));
const app14 = segment(0xEE, Buffer.from([0x41, 0x64, 0x6F, 0x62, 0x65, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01]));
const com = segment(0xFE, Buffer.from('written by a scanner'));
const mixed = insert(insert(insert(photo, com), app14), app13);
const before = markers(ab(mixed));
const after = markers(E.stripMetadata(ab(mixed)));
eq('input has APP13, APP14, COM, APP1', ['FFED', 'FFEE', 'FFFE', 'FFE1'].every((m) => before.includes(m)), true);
eq('APP1 and APP13 removed', after.includes('FFE1') || after.includes('FFED'), false);
eq('APP14 and COM kept', after.includes('FFEE') && after.includes('FFFE'), true);
const scanAt = (b) => b.indexOf(Buffer.from([0xFF, 0xDA]));
eq('scan data copied byte for byte', Buffer.from(E.stripMetadata(ab(mixed))).subarray(scanAt(Buffer.from(E.stripMetadata(ab(mixed))))).equals(mixed.subarray(scanAt(mixed))), true);

// ---------- Orientation is written back in a minimal APP1 ----------
// Phones store portrait photos sideways with Orientation 6 or 8. The cleaned copy keeps that one
// tag (IFD0 0x0112, Exif 2.32 / 3.0) in a new APP1 that holds nothing else, so it still displays
// upright; the scan data is not re-encoded. Read back with sharp (libexif via libvips) and, when
// installed, exiftool.
const hasExiftool = spawnSync('exiftool', ['-ver']).status === 0;
for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
  for (const le of [false, true]) {
    const base = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c87828' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'Apple', Model: 'iPhone 15 Pro' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '48/1 51/1 2964/100' } })
      .withMetadata({ orientation: o })
      .toBuffer();
    // sharp writes big-endian TIFF; flip to little-endian by hand-building the APP1 for the LE case
    const src = le ? withLittleEndianExif(base, o) : base;
    const label = 'orientation ' + o + (le ? ' (II)' : ' (MM)');
    eq(label + ': input has it', (await sharp(src).metadata()).orientation, o);
    const out = Buffer.from(E.stripMetadata(ab(src)));
    const m = await sharp(out).metadata();
    eq(label + ': kept', m.orientation ?? 1, o);
    const p = E.parseExif(ab(out)).exif;
    eq(label + ': nothing else left', o === 1 ? p : p && { ifd0: p.ifd0, exif: p.exif, gps: p.gps }, o === 1 ? null : { ifd0: { Orientation: o }, exif: {}, gps: {} });
    eq(label + ': scan data unchanged', out.subarray(scanAt(out)).equals(src.subarray(scanAt(src))), true);
    eq(label + ': at most one APP1', markers(ab(out)).filter((x) => x === 'FFE1').length, o === 1 ? 0 : 1);
    if (o !== 1) eq(label + ': new APP1 takes the place of the old one', markers(ab(out)), markers(ab(src)));
    if (hasExiftool && !le) {
      const dir = mkdtempSync(join(tmpdir(), 'emv-'));
      const f = join(dir, 'x.jpg');
      writeFileSync(f, out);
      const r = spawnSync('exiftool', ['-j', '-n', '-EXIF:all', f], { encoding: 'utf8' });
      rmSync(dir, { recursive: true, force: true });
      const tags = JSON.parse(r.stdout)[0];
      delete tags.SourceFile;
      eq(label + ': exiftool sees only Orientation', tags, o === 1 ? {} : { Orientation: o });
    }
  }
}
if (!hasExiftool) console.log('SKIP: exiftool not installed (orientation read back with sharp only)');
// With a JFIF APP0 in front, the orientation APP1 stays after it
const jfif = segment(0xE0, Buffer.from([0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
const rotatedJfif = insert(await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c87828' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer(), jfif);
const outJfif = Buffer.from(E.stripMetadata(ab(rotatedJfif)));
eq('JFIF file: APP0 then the orientation APP1', markers(ab(outJfif)).slice(0, 2), ['FFE0', 'FFE1']);
eq('JFIF file: orientation 6 kept', (await sharp(outJfif).metadata()).orientation, 6);
// A broken or unusual value is not copied
const odd = withLittleEndianExif(photo, 9);
eq('orientation 9 is not copied', E.parseExif(E.stripMetadata(ab(odd))).exif, null);
eq('page says orientation is kept', page.includes('<strong>Orientation is kept.</strong>'), true);
eq('page no longer says orientation is removed', page.includes('Orientation is removed'), false);

// ---------- UI text and sensitivity ----------
eq('size limit in code is 100 MB', /file\.size > 100 \* 1024 \* 1024/.test(source), true);
eq('drop-zone text says 100 MB', (source.match(/dropSub: '[^']*'/g) || []).every((s) => s.includes('100 MB')), true);
eq('no 25 MB limit text left', /JPEG · (up to|最大|최대) 25 MB/.test(source), false);
eq('persistence disabled', /'exif-metadata-viewer': 'disabled'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')), true);
eq('script stores nothing', /localStorage|sessionStorage|ztPersist/.test(source), false);

// ---------- Real page file lifecycle ----------
// Run the complete page script and shared shortcut. FileReader, image-dimension loading and
// clipboard completion are controlled; JPEG parsing and exported bytes use the real fixture.
{
  const base = { passes, failures };
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); };
  const unhandledAll = [];
  process.on('unhandledRejection', (e) => unhandledAll.push(e));
  function ui(lang = 'en', shellFirst = false, opts = {}) {
    const ids = new Map(), readers = [], images = [], downloads = [], copied = [], revoked = [], urls = new Map(), timers = [], clears = [], execCalls = [];
    const unhandledFrom = unhandledAll.length;
    let document, urlId = 0;
    function matches(n, selector) {
      return selector.split(',').some(s => {
        s = s.trim();
        const attrs = [...s.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
        s = s.replace(/\[[^\]]+\]/g, '');
        const id = /#([\w-]+)/.exec(s), classes = [...s.matchAll(/\.([\w-]+)/g)], tag = /^[\w-]+/.exec(s);
        return (!id || n.id === id[1]) && classes.every(c => n.classList.contains(c[1])) && (!tag || n.tagName === tag[0].toUpperCase()) && attrs.every(a => a[2] === undefined ? n.getAttribute(a[1]) !== null : n.getAttribute(a[1]) === a[2]);
      });
    }
    class Element {
      constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], listeners: {}, attrs: {}, style: {}, className: '', id: '', value: '', src: '', files: [], hidden: false, disabled: false }); }
      get classList() { const e = this; return { contains: c => e.className.split(/\s+/).includes(c), add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
      setAttribute(k, v) { this.attrs[k] = String(v); if (['id', 'class', 'type', 'value', 'src', 'href'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
      getAttribute(k) { return this.attrs[k] ?? null; }
      removeAttribute(k) { delete this.attrs[k]; if (k === 'src' || k === 'href') this[k] = ''; }
      appendChild(n) { this.children.push(n); n.parentElement = this; return n; }
      removeChild(n) { this.children = this.children.filter(c => c !== n); n.parentElement = null; }
      remove() { this.parentElement?.removeChild(this); }
      set textContent(v) { this.text = String(v); this.children = []; }
      get textContent() { return (this.text || '') + this.children.map(n => n.textContent).join(''); }
      contains(n) { return this === n || this.children.some(c => c.contains(n)); }
      closest(s) { for (let e = this; e; e = e.parentElement) if (matches(e, s)) return e; return null; }
      querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
      querySelector(s) { return this.querySelectorAll(s)[0] || null; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      dispatch(type, extra = {}) { const e = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; for (const fn of this.listeners[type] || []) fn(e); return e; }
      click() { if (this.disabled) return; if (this.tagName === 'A' && this.download) downloads.push({ name: this.download, blob: urls.get(this.href) }); this.dispatch('click'); }
      focus() { document.activeElement = this; }
      select() { document.selected = this; document.activeElement = this; }
    }
    const body = new Element('body'), widget = new Element('div'); widget.className = 'tool-widget'; body.appendChild(widget);
    const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
    const stack = [widget], voids = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
    for (const m of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>/g)) {
      if (m[0].startsWith('</')) { if (stack.at(-1).tagName === m[1].toUpperCase()) stack.pop(); continue; }
      const n = new Element(m[1]);
      for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) { n.setAttribute(a[1], a[2]); if (a[1] === 'style') for (const field of a[2].split(';')) { const [k, v] = field.split(':'); if (k) n.style[k.trim()] = v?.trim(); } }
      n.hidden = /\bhidden(?:\s|\/|$)/.test(m[2]); n.disabled = /\bdisabled(?:\s|\/|$)/.test(m[2]);
      stack.at(-1).appendChild(n); if (n.id) ids.set(n.id, n); if (!voids.has(m[1]) && !m[2].endsWith('/')) stack.push(n);
    }
    const get = id => { if (!ids.has(id)) throw new Error('Missing real element ' + id); return ids.get(id); };
    document = new Element('document'); Object.assign(document, { body, documentElement: { lang }, activeElement: body, getElementById: get, createElement: tag => new Element(tag), querySelector: s => s === '.tool-widget' ? widget : widget.querySelector(s), querySelectorAll: s => widget.querySelectorAll(s), execCommand(cmd) { execCalls.push({ cmd, text: document.selected?.value ?? '' }); if (opts.exec === 'throw') throw new Error('execCommand'); return opts.exec ?? false; } });
    class Reader { constructor() { readers.push(this); } readAsArrayBuffer(file) { this.file = file; } }
    class Image { constructor() { images.push(this); } }
    const clipboardModes = {
      ok: { clipboard: { writeText(text) { copied.push(text); return Promise.resolve(); } } },
      missing: {},
      reject: { clipboard: { writeText() { return Promise.reject(new Error('NotAllowedError')); } } },
      throw: { clipboard: { writeText() { throw new Error('writeText'); } } },
    };
    const sandbox = { t: clientStrings(lang).CLIENT_T, document, FileReader: Reader, Image, Blob, ArrayBuffer, DataView, Uint8Array, TextDecoder, console, navigator: clipboardModes[opts.clipboard ?? 'ok'], URL: { createObjectURL(b) { const u = 'blob:test-' + ++urlId; urls.set(u, b); return u; }, revokeObjectURL(u) { revoked.push(u); } }, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, _slug: 'exif-metadata-viewer', window: { ztPersist: { clear: slug => clears.push(slug) } } };
    const context = vm.createContext(sandbox);
    if (shellFirst) vm.runInContext(shortcut, context);
    vm.runInContext(script, context, { filename: 'ExifMetadataViewerTool.astro' });
    if (!shellFirst) vm.runInContext(shortcut, context);
    function input(name = 'photo.jpg', type = 'image/jpeg', size = photo.length, method = 'change') {
      const file = { name, type, size };
      if (method === 'paste') document.dispatch('paste', { clipboardData: { items: [{ type, getAsFile: () => file }] } });
      else if (method === 'drop') get('emv-dropzone').dispatch('drop', { dataTransfer: { files: [file] } });
      else { get('emv-file').files = [file]; get('emv-file').value = name; get('emv-file').dispatch('change'); }
      return readers.at(-1);
    }
    function complete(reader, bytes = photo) { reader.onload({ target: { result: ab(bytes) } }); }
    function clear() { get('emv-reset').focus(); return document.dispatch('keydown', { ctrlKey: true, key: 'l' }); }
    function state() { return { preview: get('emv-preview-img').src, name: get('emv-filename').textContent, dims: get('emv-dimensions').textContent, result: get('emv-result-area').style.display, actions: get('emv-actions').style.display, status: get('emv-status').textContent }; }
    return { get, readers, images, downloads, copied, revoked, clears, complete, input, clear, state, document, timers, execCalls, get unhandled() { return unhandledAll.slice(unhandledFrom); } };
  }
  function visible(node) { for (; node; node = node.parentElement) if (node.hidden || node.style.display === 'none') return false; return true; }
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const p = ui(lang);
    eq(lang + ' empty state has visible import area', visible(p.get('emv-dropzone')), true);
    eq(lang + ' reset hidden until an input attempt', visible(p.get('emv-reset')), false);
    const pending = p.input();
    eq(lang + ' pending read can be canceled from toolbar', visible(p.get('emv-reset')), true);
    p.complete(pending);
    eq(lang + ' loaded photo exposes all three actions', ['emv-reset', 'emv-download', 'emv-copy-json'].every(id => visible(p.get(id))), true);
    p.get('emv-reset').click();
    eq(lang + ' reset returns to input and hides all result actions', visible(p.get('emv-dropzone')) && ['emv-reset', 'emv-download', 'emv-copy-json'].every(id => !visible(p.get(id))), true);
  }
  function empty(name, p) {
    eq(name + ' preview cleared', p.get('emv-preview-img').src, '');
    eq(name + ' empty preview stays hidden', p.get('emv-preview-img').style.display, 'none');
    eq(name + ' file details cleared', [p.get('emv-filename').textContent, p.get('emv-filesize').textContent, p.get('emv-dimensions').textContent], ['', '', '']);
    eq(name + ' actions hidden', p.get('emv-actions').style.display, 'none');
    p.get('emv-download').click(); p.get('emv-copy-json').click();
    eq(name + ' cannot download old image', p.downloads.length, 0);
    eq(name + ' cannot copy old metadata', p.copied.length, 0);
  }
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const first of [false, true]) {
    const p = ui(lang, first); p.complete(p.input()); const event = p.clear();
    eq(lang + ' CtrlL prevents default order ' + first, event.defaultPrevented, true);
    eq(lang + ' shared clear executes order ' + first, p.clears, ['exif-metadata-viewer']);
    eq(lang + ' clear hides result order ' + first, p.get('emv-result-area').style.display, 'none');
    eq(lang + ' clear resets selected file order ' + first, p.get('emv-file').value, '');
    empty(lang + ' CtrlL order ' + first, p);
  }
  for (const action of ['reset', 'shortcut', 'new file', 'invalid', 'oversize']) for (const fail of [false, true]) {
    const p = ui(); p.complete(p.input('first.jpg')); const slow = p.input('slow.jpg', 'image/jpeg', photo.length, 'paste');
    if (action === 'reset') p.get('emv-reset').click();
    if (action === 'shortcut') p.clear();
    if (action === 'new file') p.complete(p.input('new.jpg'));
    if (action === 'invalid') p.input('bad.txt', 'text/plain', 100, 'drop');
    if (action === 'oversize') p.input('large.jpg', 'image/jpeg', 100 * 1024 * 1024 + 1, 'drop');
    const expected = p.state();
    if (fail) slow.onerror(); else p.complete(slow);
    eq('late read ' + action + ' error=' + fail + ' cannot change current UI', p.state(), expected);
  }
  for (const failure of ['read', 'signature', 'type', 'size']) {
    const p = ui(); p.complete(p.input('old.jpg'));
    if (failure === 'read') p.input('broken.jpg', 'image/jpeg', photo.length, 'paste').onerror();
    if (failure === 'signature') p.complete(p.input('fake.jpg'), Buffer.from('not JPEG'));
    if (failure === 'type') p.input('text.txt', 'text/plain', 4, 'drop');
    if (failure === 'size') p.input('large.jpg', 'image/jpeg', 100 * 1024 * 1024 + 1, 'drop');
    empty(failure, p);
    let statusVisible = true; for (let node = p.get('emv-status'); node; node = node.parentElement) if (node.hidden || node.style.display === 'none') statusVisible = false;
    eq(failure + ' reports a visible error container', statusVisible && p.get('emv-status').className.includes('error') && !!p.get('emv-status').textContent, true);
    p.complete(p.input('recovered.jpg'));
    eq(failure + ' can load another image after error', [p.get('emv-filename').textContent, p.get('emv-actions').style.display], ['recovered.jpg', '']);
  }
  for (const lang of ['en', 'zh', 'ja', 'ko']) for (const length of [0, 1, 2, 3]) {
    const label = lang + ' ' + length + '-byte JPEG';
    const p = ui(lang); p.complete(p.input('old.jpg'));
    const oldPreview = p.get('emv-preview-img').src, oldProbe = p.images.at(-1);
    oldProbe.naturalWidth = 64; oldProbe.naturalHeight = 48; oldProbe.onload();
    const bytes = Buffer.from([0xff, 0xd8, 0xff]).subarray(0, length);
    p.complete(p.input('short.jpg', 'image/jpeg', bytes.length), bytes);
    eq(label + ' shows localized JPEG error', p.get('emv-status').textContent, clientStrings(lang).CLIENT_T.errNotJpeg);
    eq(label + ' error is visible', visible(p.get('emv-status')) && p.get('emv-status').className.includes('error'), true);
    eq(label + ' import remains available', visible(p.get('emv-dropzone')), true);
    eq(label + ' result stays hidden', visible(p.get('emv-result-area')), false);
    eq(label + ' clears and hides old preview', [p.get('emv-preview-img').src, p.get('emv-preview-img').style.display], ['', 'none']);
    eq(label + ' revokes old preview URL', p.revoked.includes(oldPreview), true);
    eq(label + ' clears old file details', [p.get('emv-filename').textContent, p.get('emv-filesize').textContent, p.get('emv-dimensions').textContent], ['', '', '']);
    eq(label + ' hides export actions', visible(p.get('emv-actions')), false);
    oldProbe.naturalWidth = 999; oldProbe.naturalHeight = 777; oldProbe.onload();
    eq(label + ' old dimension callback stays canceled', p.get('emv-dimensions').textContent, '');
    let downloadError = null;
    try { p.get('emv-download').click(); } catch (error) { downloadError = error.name; }
    eq(label + ' download guard does not throw', downloadError, null);
    eq(label + ' cannot download rejected or old image', p.downloads.length, 0);
    p.get('emv-copy-json').click(); await settle();
    eq(label + ' cannot copy rejected or old metadata', p.copied.length, 0);
    p.complete(p.input('recovered.jpg'));
    eq(label + ' valid JPEG restores result and actions', [p.get('emv-filename').textContent, visible(p.get('emv-result-area')), visible(p.get('emv-actions')), p.get('emv-status').textContent], ['recovered.jpg', true, true, '']);
    p.get('emv-copy-json').click(); await settle();
    eq(label + ' recovered metadata is copyable', JSON.parse(p.copied.at(-1)).ifd0.Make, 'Apple');
    p.get('emv-download').click();
    eq(label + ' recovered download has new name', p.downloads.at(-1).name, 'recovered-clean.jpg');
    eq(label + ' recovered download has exact cleaned bytes', Buffer.from(await p.downloads.at(-1).blob.arrayBuffer()).equals(cleaned), true);
  }
  {
    const p = ui(); p.complete(p.input('first.jpg')); const probe = p.images.at(-1); p.clear();
    probe.naturalWidth = 999; probe.naturalHeight = 777; probe.onload();
    eq('late dimension probe cannot refill cleared details', p.get('emv-dimensions').textContent, '');
    p.complete(p.input('second.jpg')); const fresh = p.images.at(-1); fresh.naturalWidth = 64; fresh.naturalHeight = 48; fresh.onload();
    eq('valid preview is shown again', p.get('emv-preview-img').style.display, '');
    eq('current dimensions still render', p.get('emv-dimensions').textContent, '64 × 48 px');
    p.get('emv-copy-json').click(); await settle(); eq('current metadata copy still works', JSON.parse(p.copied.at(-1)).ifd0.Make, 'Apple');
    p.get('emv-download').click(); eq('current cleaned export keeps new name', p.downloads.at(-1).name, 'second-clean.jpg');
    eq('current cleaned export retains exact expected bytes', Buffer.from(await p.downloads.at(-1).blob.arrayBuffer()).equals(cleaned), true);
  }
  console.log(`Page lifecycle: ${passes - base.passes} passed, ${failures - base.failures} failed`);

  // ---------- S2-9c fixes: text decoding, malformed offsets, copy fallback ----------
  {
    const base2 = { passes, failures };
    // Text tags written as UTF-8 bytes in an ASCII-type field (ExifTool 13.55 writes non-ASCII
    // text this way) used to be read one byte per character: 微信 showed as å¾®ä¿¡.
    const textJpeg = withApp1(photo, tiff({ ifd0: { Make: 'Xiaomi', Model: 'テスト機', Software: '相册编辑 3.2' } }));
    const textExif = E.parseExif(ab(textJpeg)).exif;
    eq('UTF-8 bytes in ASCII tags are decoded', [textExif.ifd0.Make, textExif.ifd0.Model, textExif.ifd0.Software], ['Xiaomi', 'テスト機', '相册编辑 3.2']);
    // Bytes that are not valid UTF-8 keep the old one-byte-per-character reading (Latin-1)
    const latin = withApp1(photo, tiff({ ifd0: { Software: { bytes: [0x83, 0x65, 0x83, 0x58, 0x83, 0x67] } } }));
    eq('non-UTF-8 bytes stay Latin-1', E.parseExif(ab(latin)).exif.ifd0.Software, '\u0083e\u0083X\u0083g');
    // The zh / ja / ko limits say GBK, Shift_JIS and EUC-KR text shows garbled
    for (const [label, bytes, text] of [['GBK 中文', [0xD6, 0xD0, 0xCE, 0xC4], '中文'], ['Shift_JIS 日本語', [0x93, 0xFA, 0x96, 0x7B, 0x8C, 0xEA], '日本語'], ['EUC-KR 한글', [0xC7, 0xD1, 0xB1, 0xDB], '한글']]) {
      const got = E.parseExif(ab(withApp1(photo, tiff({ ifd0: { Software: { bytes: [...bytes, 0] } } })))).exif.ifd0.Software;
      eq(label + ' is shown one byte per character, not as ' + text, got, String.fromCharCode(...bytes));
    }
    // Exif 3.0 UTF-8 type (129) is not decoded: the value is null
    eq('UTF-8 type (129) is not decoded', E.parseExif(ab(withApp1(photo, tiff({ ifd0: { Make: { utf8: '한글' } } })))).exif.ifd0.Make, null);
    // An IFD offset past the end of the file used to throw a RangeError out of parseExif and
    // stripMetadata: the page stayed on "Reading metadata…" and Download threw.
    // The offset is inside the file when counted from its start but past the end when counted
    // from the TIFF header, which is where IFD offsets count from.
    const badLength = withApp1(photo, tiff({ ifd0: { Make: 'Apple' } })).length;
    const bad = withApp1(photo, tiff({ ifd0: { Make: 'Apple' } }, { ifd0Offset: badLength - 6 }));
    let threw = null, parsedBad = null;
    try { parsedBad = E.parseExif(ab(bad)); } catch (error) { threw = error.name; }
    eq('bad IFD offset does not throw', threw, null);
    eq('bad IFD offset is flagged', parsedBad && parsedBad.corrupt, true);
    let stripThrew = null;
    try { E.stripMetadata(ab(bad)); } catch (error) { stripThrew = error.name; }
    eq('strip with a bad IFD offset does not throw', stripThrew, null);
    // A value offset past the end: the other tags are still read
    const badValue = withApp1(photo, tiff({ ifd0: { Make: 'Apple', Model: { bytes: [65, 66, 67, 68, 69, 70, 71, 0], offset: 0x7FFFFF00 } } }));
    const pv = E.parseExif(ab(badValue));
    eq('bad value offset keeps the other tags', [pv.exif && pv.exif.ifd0.Make, pv.corrupt], ['Apple', true]);
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      const p = ui(lang);
      let err = null;
      try { p.complete(p.input('broken.jpg'), bad); } catch (error) { err = error.name; }
      eq(lang + ' malformed EXIF: page does not throw', err, null);
      eq(lang + ' malformed EXIF: localized notice', p.get('emv-status').textContent, clientStrings(lang).CLIENT_T.errCorrupt);
      eq(lang + ' malformed EXIF: result and actions shown', [visible(p.get('emv-result-area')), visible(p.get('emv-actions'))], [true, true]);
      // Only the malformed notice: "no EXIF found" would contradict it (review S2-9 part3 M2)
      eq(lang + ' malformed EXIF: "no EXIF" note hidden', visible(p.get('emv-no-meta')), false);
      let dlErr = null;
      try { p.get('emv-download').click(); } catch (error) { dlErr = error.name; }
      eq(lang + ' malformed EXIF: download works', [dlErr, p.downloads.length], [null, 1]);
    }
    // Copy: the Clipboard API may be missing (non-secure context) or refuse. The page falls back
    // to a hidden textarea + execCommand('copy') and reports a failure in the page language.
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      const L = clientStrings(lang).CLIENT_T;
      for (const mode of ['missing', 'reject', 'throw']) for (const exec of [true, false]) {
        const p = ui(lang, false, { clipboard: mode, exec });
        p.complete(p.input('photo.jpg'));
        const btn = p.get('emv-copy-json');
        let clickError = null;
        try { btn.click(); } catch (error) { clickError = error.name; }
        await settle();
        const label = lang + ' copy ' + mode + ' execCommand=' + exec;
        eq(label + ': click does not throw', clickError, null);
        eq(label + ': fallback tried with the JSON', p.execCalls.map((c) => c.text.slice(0, 20)), [JSON.stringify(E.parseExif(ab(photo)).exif, null, 2).slice(0, 20)]);
        eq(label + ': button text', btn.textContent, exec ? L.copied : L.copyFailed);
        eq(label + ': helper textarea removed', p.document.body.children.filter((n) => n.tagName === 'TEXTAREA').length, 0);
        eq(label + ': focus back on the button', p.document.activeElement === btn, true);
        eq(label + ': no unhandled rejection', p.unhandled.length, 0);
      }
    }
    console.log(`S2-9c fixes: ${passes - base2.passes} passed, ${failures - base2.failures} failed`);
  }

  // ---------- Worked examples on the four tool pages (S2-9c) ----------
  // {/* emv-check: {"mode": "rows" | "json" | "clean" | "map", "file": <tiff() spec>} */}
  // The test writes a JPEG with exactly those fields (tiff() above; read back with ExifTool when
  // installed), loads it into the real page script and compares:
  //   rows  — the visible rows as "label: value" lines, equal to the next code block
  //   json  — the text Copy EXIF JSON puts on the clipboard, equal to the next code block
  //   clean — EXIF left in the Download cleaned JPEG file (compact JSON, or null), in inline code
  //   map   — the Open in Google Maps link in inline code; with "amap": true also the
  //           longitude,latitude pair (6 decimals) that AMap's coordinate API takes
  {
    const base3 = { passes, failures };
    const ROW_LABEL = { Make: 'kMake', Model: 'kModel', LensModel: 'kLens', DateTimeOriginal: 'kDateOriginal', DateTime: 'kDateModified', FNumber: 'kAperture', ExposureTime: 'kShutter', ISOSpeedRatings: 'kISO', FocalLength: 'kFocal', GPSLatitude: 'kLatitude', GPSLongitude: 'kLongitude', GPSAltitude: 'kAltitude', Software: 'kSoftware' };
    // Inline code: Markdown `…`, <code>…</code>, or <code>{'…'}</code> (an MDX string expression,
    // needed when the code holds braces)
    const inlineCode = (text) => [...text.matchAll(/`([^`\n]+)`|<code>\{'([^'\n]*)'\}<\/code>|<code>([^<]*)<\/code>/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    const { fencedBlocks, annotations: notes, readToolMdx } = await import('./lib/tool-mdx-contract.mjs');
    const exifRead = (bytes) => {
      if (!hasExiftool) return null;
      const dir = mkdtempSync(join(tmpdir(), 'emv-'));
      const f = join(dir, 'x.jpg');
      writeFileSync(f, bytes);
      const r = spawnSync('exiftool', ['-j', '-n', '-EXIF:all', f], { encoding: 'utf8' });
      rmSync(dir, { recursive: true, force: true });
      return JSON.parse(r.stdout)[0];
    };
    async function verify(spec, after, lang) {
      const bytes = withApp1(photo, tiff(spec.file));
      const tags = exifRead(bytes);
      if (tags) {
        for (const group of ['ifd0', 'exif', 'gps']) for (const [k, v] of Object.entries(spec.file[group] || {})) {
          const want = typeof v === 'string' && !/^\d+\/\d+/.test(v) ? v : v && v.utf8 !== undefined ? v.utf8 : undefined;
          const name = { DateTime: 'ModifyDate' }[k] ?? k; // ExifTool's name for IFD0 0x0132
          if (want !== undefined && String(tags[name]) !== want) return 'ExifTool reads ' + name + ' as ' + JSON.stringify(tags[name]);
        }
      }
      const p = ui(lang);
      p.complete(p.input('test.jpg', 'image/jpeg', bytes.length), bytes);
      const L = STRINGS[lang];
      if (spec.mode === 'rows') {
        const rows = p.document.querySelectorAll('.emv-kv-row').filter((r) => visible(r)).map((r) => L[ROW_LABEL[r.getAttribute('data-key')]] + ': ' + p.get('emv-' + r.getAttribute('data-key')).textContent);
        const want = rows.join('\n');
        return fencedBlocks(after).some((b) => b.text === want) ? null : 'rows ' + JSON.stringify(want) + ' not in a code block';
      }
      if (spec.mode === 'json') {
        p.get('emv-copy-json').click(); await settle();
        const want = p.copied.at(-1);
        return fencedBlocks(after).some((b) => b.text === want) ? null : 'copied JSON ' + JSON.stringify(want) + ' not in a code block';
      }
      if (spec.mode === 'clean') {
        p.get('emv-download').click();
        const out = await p.downloads.at(-1).blob.arrayBuffer();
        const want = JSON.stringify(E.parseExif(out).exif);
        return inlineCode(after).includes(want) ? null : 'cleaned EXIF ' + want + ' not in inline code';
      }
      if (spec.mode === 'map') {
        const href = p.get('emv-gps-map').href;
        if (!inlineCode(after).includes(href)) return 'map link ' + href + ' not in inline code';
        if (spec.amap) {
          const [lat, lon] = href.split('q=')[1].split(',');
          if (!inlineCode(after).includes(lon + ',' + lat)) return 'longitude,latitude ' + lon + ',' + lat + ' not in inline code';
        }
        return null;
      }
      return 'unknown mode';
    }
    const docs = readToolMdx('exif-metadata-viewer');
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      const found = notes(docs[lang].body, 'emv-check');
      eq(lang + ' has at least 2 emv-check examples', found.length >= 2, true);
      for (const [i, n] of found.entries()) {
        let problem;
        try { problem = n.spec ? await verify(n.spec, n.after, lang) : 'annotation JSON does not parse'; } catch (error) { problem = error.message; }
        eq(lang + ' emv-check #' + (i + 1) + ' matches the page', problem, null);
      }
    }
    console.log(`Worked examples: ${passes - base3.passes} passed, ${failures - base3.failures} failed`);
  }
}


// ---------- v2 page layout ----------
{
  const base = { passes, failures };
  const template = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script')).trimStart();
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const css = source.slice(source.indexOf('<style>') + 7).replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector, pattern) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(m => m[1].split(',').some(s => s.trim() === selector) && pattern.test(m[2]));
  eq('analyze layout registered', /'exif-metadata-viewer':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')), true);
  eq('tool is a direct flex-column root', /^<div class="emv-wrap">/.test(template) && rule('.emv-wrap', /display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*min-height:\s*0/), true);
  eq('empty import area fills available space using shared class', /id="emv-dropzone" class="emv-dropzone zt-empty-drop"/.test(template), true);
  eq('results have zero-basis flex and internal scroll', rule('.emv-result-area', /flex:\s*1 1 0;[\s\S]*min-height:\s*300px;[\s\S]*overflow:\s*auto/), true);
  eq('mobile results have a fixed positive height', rule('.emv-result-area', /grid-template-columns:\s*1fr;\s*flex:\s*none;\s*height:\s*32rem;\s*min-height:\s*0/), true);
  eq('tool uses stack and phone breakpoints', /max-width:\s*860px/.test(css) && /max-width:\s*640px/.test(css), true);
  eq('status reserves space and remains outside hidden results', rule('#emv-status', /min-height:\s*1\.5rem/) && template.indexOf('id="emv-status"') < template.indexOf('id="emv-result-area"'), true);
  eq('all original action buttons stay ahead of results', [...template.matchAll(/<button[^>]*id="([^"]+)"/g)].map(m => m[1]).sort(), ['emv-copy-json', 'emv-download', 'emv-reset']);
  eq('all actions precede status and output', ['emv-reset', 'emv-download', 'emv-copy-json'].every(id => template.indexOf('id="' + id + '"') < template.indexOf('id="emv-status"')), true);
  eq('privacy note follows output', template.indexOf('class="emv-privacy"') > template.indexOf('id="emv-no-meta"'), true);
  eq('labels render at build time', !source.includes('data-i18n') && !script.includes('applyI18n'), true);
  eq('only client strings enter script', /define:vars=\{\{ t: CLIENT_T \}\}/.test(source) && !/\bTIPS\b|\bt\.tips\b|\bSTRINGS\b/.test(script), true);
  const tipKeys = ['open', 'reset', 'results', 'download', 'copy', 'gps'].sort();
  const tips = [...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  eq('six control tips retain unique IDs', tips.map(m => /id="emv-tip-([^"]+)"/.exec(m[1])?.[1]).sort(), tipKeys);
  for (const tip of tips) {
    const key = /id="emv-tip-([^"]+)"/.exec(tip[1])[1];
    eq(key + ' tip uses localized label and content', /lang=\{lang\}/.test(tip[1]) && /about=\{T\.\w+\}/.test(tip[1]) && tip[2] === '{TIPS.' + key + '}', true);
  }
  const placeholders = text => (String(text).match(/\{\w+\}/g) || []).sort();
  function strings(lang, value, reference, path = '') {
    if (reference && typeof reference === 'object') {
      eq(lang + path + ' keys match en', Object.keys(value || {}).sort(), Object.keys(reference).sort());
      for (const key of Object.keys(reference)) strings(lang, value?.[key], reference[key], path + '.' + key);
    } else {
      eq(lang + path + ' nonempty text', typeof value === 'string' && value.trim().length > 0, true);
      eq(lang + path + ' placeholders', placeholders(value), placeholders(reference));
    }
  }
  // Snapshot from 2d4ce406: metadata unchanged, and body with only its usage section removed.
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq(lang + ' string keys match en', Object.keys(STRINGS[lang]).sort(), Object.keys(STRINGS.en).sort());
    strings(lang, STRINGS[lang].tips, STRINGS.en.tips, '.tips');
    const { TIPS, CLIENT_T } = clientStrings(lang);
    eq(lang + ' only tips excluded from client', Object.keys(CLIENT_T).sort(), Object.keys(STRINGS[lang]).filter(k => k !== 'tips').sort());
    eq(lang + ' client contains no tip texts', !('tips' in CLIENT_T) && Object.values(TIPS).every(t => !JSON.stringify(CLIENT_T).includes(JSON.stringify(t))), true);
    const mdx = readFileSync(join(root, 'src/content/tools/exif-metadata-viewer/' + lang + '.mdx'), 'utf8');
    const [, fm, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx), { steps } = loadYaml(fm);
    eq(lang + ' four concise plain-text steps', steps.length === 4 && steps.every(s => typeof s === 'string' && s.trim() && s.length <= 280 && !/<[^>]+>/.test(s)) && steps.join('').length <= 1200, true);
    eq(lang + ' usage removed', !/<h2>(?:How to use|使用方法|使い方|사용 방법)<\/h2>/.test(body), true);
    eq(lang + ' MDX content contract', contractProblems('exif-metadata-viewer', lang), '');
  }
  console.log(`v2 page layout: ${passes - base.passes} passed, ${failures - base.failures} failed`);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
