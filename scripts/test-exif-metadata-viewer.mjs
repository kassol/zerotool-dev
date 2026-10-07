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
//
// Run: node scripts/test-exif-metadata-viewer.mjs

import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { load as loadYaml } from 'js-yaml';

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
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  function ui(lang = 'en', shellFirst = false) {
    const ids = new Map(), readers = [], images = [], downloads = [], copied = [], revoked = [], urls = new Map(), timers = [], clears = [];
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
    document = new Element('document'); Object.assign(document, { body, documentElement: { lang }, activeElement: body, getElementById: get, createElement: tag => new Element(tag), querySelector: s => s === '.tool-widget' ? widget : widget.querySelector(s), querySelectorAll: s => widget.querySelectorAll(s) });
    class Reader { constructor() { readers.push(this); } readAsArrayBuffer(file) { this.file = file; } }
    class Image { constructor() { images.push(this); } }
    const sandbox = { t: clientStrings(lang).CLIENT_T, document, FileReader: Reader, Image, Blob, ArrayBuffer, DataView, Uint8Array, console, navigator: { clipboard: { writeText(text) { copied.push(text); return Promise.resolve(); } } }, URL: { createObjectURL(b) { const u = 'blob:test-' + ++urlId; urls.set(u, b); return u; }, revokeObjectURL(u) { revoked.push(u); } }, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, _slug: 'exif-metadata-viewer', window: { ztPersist: { clear: slug => clears.push(slug) } } };
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
    return { get, readers, images, downloads, copied, revoked, clears, complete, input, clear, state, document, timers };
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
  const retained = {"en": ["0902ca24ad27d31d", "3b1dcadcf1105255"], "zh": ["6f217aea293b700a", "dd841e9ac63f4baa"], "ja": ["81d5a09229d05c93", "a32ca5dd84912764"], "ko": ["af4cf2d10d3cc286", "0fe2c0058fe852f9"]};
  const hash = text => createHash('sha256').update(text.trim()).digest('hex').slice(0, 16);
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
    eq(lang + ' SEO and FAQ preserved', hash(fm.replace(/^steps:\n(?:  .*\n)*/m, '')), retained[lang][0]);
    eq(lang + ' all other reference content preserved', hash(body), retained[lang][1]);
  }
  console.log(`v2 page layout: ${passes - base.passes} passed, ${failures - base.failures} failed`);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
