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
// for byte; the Orientation tag goes with APP1 (the page says so); the drop-zone text states
// the same 100 MB limit the code enforces (it used to say 25 MB); the page stays `disabled`.
//
// Run: node scripts/test-exif-metadata-viewer.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

// ---------- Orientation goes with APP1 ----------
const rotated = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c87828' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
eq('input orientation 6', (await sharp(rotated).metadata()).orientation, 6);
eq('orientation removed', (await sharp(Buffer.from(E.stripMetadata(ab(rotated)))).metadata()).orientation ?? null, null);
eq('page says orientation is removed', page.includes('<strong>Orientation is removed.</strong>'), true);

// ---------- UI text and sensitivity ----------
eq('size limit in code is 100 MB', /file\.size > 100 \* 1024 \* 1024/.test(source), true);
eq('drop-zone text says 100 MB', (source.match(/dropSub: '[^']*'/g) || []).every((s) => s.includes('100 MB')), true);
eq('no 25 MB limit text left', /JPEG · (up to|最大|최대) 25 MB/.test(source), false);
eq('persistence disabled', /'exif-metadata-viewer': 'disabled'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')), true);
eq('script stores nothing', /localStorage|sessionStorage|ztPersist/.test(source), false);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
