// EXIF Metadata Viewer — parser, strip pass and the example on the English page
//
// Read:  src/components/tools/ExifMetadataViewerTool.astro (extracts the code from the EXIF tag
//        tables to the DOM helpers), src/content/tools/exif-metadata-viewer/en.mdx,
//        src/data/persistence.ts
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
//
// Run: node scripts/test-exif-metadata-viewer.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ExifMetadataViewerTool.astro'), 'utf8');
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

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
