// GIF Splitter — spec-driven regression test
//
// Read:  src/components/tools/GifSplitterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: a temporary directory under os.tmpdir() (one ZIP file, removed on exit);
//        stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: GIF87a/89a header check and non-GIF rejection; single-frame decode;
// multi-frame compositing for disposal 0/1/2/3; transparent index; interlaced rows;
// local color table over global; LZW code-width growth to 12 bits with clear codes
// and with a full table and no clear (deferred clear); truncated files; invalid LZW
// codes; NETSCAPE2.0 loop count; delay-to-duration mapping; 0×0 logical screen;
// out-of-bounds frames; decoding budget; range selection; file names; sprite layout
// and JSON; CRC32 and the STORED ZIP writer (parsed back, plus `unzip -t` if present);
// segmented decoding (chunks from 1 pixel up to past a whole frame give output equal
// to one-shot decoding, `lzwRun` stops at its limit and resumes mid-code) and a decode
// abandoned mid-frame leaving no shared state behind; compositor progress counted in
// decoded and drawn pixels (moves inside one large frame, frame-end values equal the
// pixel share, monotonic with truncated and zero-size frames).
//
// The GIF fixtures are built in this file with an independent LZW encoder.
//
// Run: node scripts/test-gif-splitter.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.env.ZT_B14_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B14_SOURCE || join(root, 'src/components/tools/GifSplitterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in GifSplitterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { GS_LIMITS, isGif, parseGif, createLzw, lzwRun, interlaceRows, createCompositor, frameDurationMs,
  checkBudget, selectRange, baseName, padFrameNo, frameFileName, spriteLayout, spriteFits, spriteJson,
  crc32, zipStore };`)();

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function throws(name, fn) {
  try { fn(); check(name, false, 'did not throw'); } catch { check(name, true); }
}

// ---------- independent GIF LZW encoder ----------
// options.clearWhenFull (default true): emit a clear code when the table reaches 4096.
// options.clearEvery: emit an extra clear code after this many emitted codes.
function lzwEncode(minCodeSize, indices, options = {}) {
  const clearWhenFull = options.clearWhenFull !== false;
  const clearEvery = options.clearEvery || 0;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  const out = [];
  let cur = 0, curBits = 0, emitted = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xFF); cur >>>= 8; curBits -= 8; }
    emitted++;
  };
  const reset = () => { table = new Map(); codeSize = minCodeSize + 1; next = eoi + 1; };
  emit(clear);
  if (indices.length === 0) { emit(eoi); if (curBits > 0) out.push(cur & 0xFF); return Uint8Array.from(out); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 256 + k;
    const found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) {
      if (next >= (1 << codeSize)) codeSize++;
      table.set(key, next++);
    } else if (clearWhenFull) {
      emit(clear);
      reset();
    }
    if (clearEvery && emitted % clearEvery === 0) { emit(clear); reset(); }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) out.push(cur & 0xFF);
  return Uint8Array.from(out);
}

// ---------- GIF builder ----------
function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
function tableBits(colorTable) {
  const entries = colorTable.length / 3;
  let bits = 0;
  while ((1 << (bits + 1)) < entries) bits++;
  return bits; // size field: 2^(bits+1) entries
}
function padTable(colorTable) {
  const bits = tableBits(colorTable);
  const out = new Array(3 * (1 << (bits + 1))).fill(0);
  colorTable.forEach((v, i) => { out[i] = v; });
  return out;
}
function subBlocks(data, size = 255, terminate = true) {
  const out = [];
  for (let i = 0; i < data.length; i += size) {
    const chunk = data.slice(i, i + size);
    out.push(chunk.length, ...chunk);
  }
  if (terminate) out.push(0);
  return out;
}
function interlaceOrder(indices, w, h) {
  const rows = [];
  const starts = [0, 4, 2, 1], steps = [8, 8, 4, 2];
  for (let p = 0; p < 4; p++) for (let y = starts[p]; y < h; y += steps[p]) rows.push(y);
  const out = [];
  for (const y of rows) for (let x = 0; x < w; x++) out.push(indices[y * w + x]);
  return out;
}
// frames: [{ left, top, width, height, indices, lct, transparentIndex, disposal, delayCs,
//            interlaced, minCodeSize, lzwOptions, rawData, gce }]
function buildGif({ version = '89a', width, height, gct = null, loop, frames }) {
  const bytes = [...'GIF' + version].map((c) => c.charCodeAt(0));
  let packed = 0;
  if (gct) packed = 0x80 | 0x70 | tableBits(gct);
  bytes.push(...u16(width), ...u16(height), packed, 0, 0);
  if (gct) bytes.push(...padTable(gct));
  if (loop !== undefined) {
    bytes.push(0x21, 0xFF, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, ...u16(loop), 0);
  }
  for (const f of frames) {
    if (f.gce !== false) {
      const disposal = f.disposal || 0;
      const trans = f.transparentIndex === undefined ? -1 : f.transparentIndex;
      const gpacked = (disposal << 2) | (trans >= 0 ? 1 : 0);
      bytes.push(0x21, 0xF9, 4, gpacked, ...u16(f.delayCs || 0), trans >= 0 ? trans : 0, 0);
    }
    let ipacked = 0;
    if (f.lct) ipacked |= 0x80 | tableBits(f.lct);
    if (f.interlaced) ipacked |= 0x40;
    bytes.push(0x2C, ...u16(f.left || 0), ...u16(f.top || 0), ...u16(f.width), ...u16(f.height), ipacked);
    if (f.lct) bytes.push(...padTable(f.lct));
    const minCodeSize = f.minCodeSize || 2;
    bytes.push(minCodeSize);
    const ordered = f.interlaced ? interlaceOrder(f.indices, f.width, f.height) : f.indices;
    const data = f.rawData || lzwEncode(minCodeSize, ordered, f.lzwOptions);
    bytes.push(...subBlocks([...data]));
  }
  bytes.push(0x3B);
  return Uint8Array.from(bytes);
}

function px(rgba, W, x, y) {
  const i = (y * W + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}
// One-shot LZW decode of a raw code stream (wrapped in a sub-block chain).
function lzwDecode(minCodeSize, data, pixelCount) {
  const lzw = E.createLzw(minCodeSize, Uint8Array.from(subBlocks([...data])), 0, pixelCount);
  E.lzwRun(lzw, Infinity);
  return { indices: lzw.indices, count: lzw.count };
}
// Drain a compositor; `pauses` counts step() calls that ended inside a frame.
function drain(comp) {
  const frames = [];
  let pauses = 0, f;
  while ((f = comp.step()) !== null) {
    if (f === undefined) pauses++;
    else frames.push(f);
  }
  return { frames, pauses };
}
function decodeAll(bytes, chunk = 0) {
  const gif = E.parseGif(bytes);
  const { frames, pauses } = drain(E.createCompositor(gif, chunk));
  return { gif, frames, pauses };
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
}

// 4-color palette: 0 black, 1 red, 2 green, 3 blue
const PAL = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
const BLACK = [0, 0, 0, 255], RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], CLEAR = [0, 0, 0, 0];

// ---------- 1. header check / non-GIF rejection ----------
{
  const png = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  equal('isGif rejects PNG signature', E.isGif(png), false);
  equal('isGif rejects empty input', E.isGif(new Uint8Array(0)), false);
  equal('isGif rejects GIF88a', E.isGif(Uint8Array.from([...'GIF88a'].map((c) => c.charCodeAt(0)))), false);
  equal('isGif accepts GIF87a', E.isGif(Uint8Array.from([...'GIF87a'].map((c) => c.charCodeAt(0)))), true);
  equal('isGif accepts GIF89a', E.isGif(Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)))), true);
  throws('parseGif throws on non-GIF', () => E.parseGif(png));
}

// ---------- 2. single frame ----------
{
  const bytes = buildGif({ version: '87a', width: 2, height: 2, gct: PAL, frames: [{ width: 2, height: 2, indices: [0, 1, 2, 3], gce: false }] });
  const { gif, frames } = decodeAll(bytes);
  equal('single frame: width', gif.width, 2);
  equal('single frame: frame count', frames.length, 1);
  equal('single frame: no loop extension -> loopCount null', gif.loopCount, null);
  deepEqual('single frame: pixel (0,0) black', px(frames[0].rgba, 2, 0, 0), BLACK);
  deepEqual('single frame: pixel (1,0) red', px(frames[0].rgba, 2, 1, 0), RED);
  deepEqual('single frame: pixel (0,1) green', px(frames[0].rgba, 2, 0, 1), GREEN);
  deepEqual('single frame: pixel (1,1) blue', px(frames[0].rgba, 2, 1, 1), BLUE);
  equal('single frame: complete', frames[0].complete, true);
  equal('single frame: not truncated', gif.truncated, false);
}

// ---------- 3. disposal 0 / 1: previous content stays ----------
{
  const bytes = buildGif({
    width: 3, height: 1, gct: PAL, loop: 0,
    frames: [
      { width: 3, height: 1, indices: [1, 1, 1], disposal: 0, delayCs: 5 },
      { left: 1, width: 1, height: 1, indices: [2], disposal: 1, delayCs: 5 },
      { left: 2, width: 1, height: 1, indices: [3], disposal: 1, delayCs: 5 },
    ],
  });
  const { gif, frames } = decodeAll(bytes);
  equal('disposal 0/1: loopCount 0 (infinite)', gif.loopCount, 0);
  deepEqual('disposal 0/1: frame 2 keeps frame 1 outside its rect', px(frames[1].rgba, 3, 0, 0), RED);
  deepEqual('disposal 0/1: frame 2 draws its rect', px(frames[1].rgba, 3, 1, 0), GREEN);
  deepEqual('disposal 0/1: frame 3 accumulates frame 2', px(frames[2].rgba, 3, 1, 0), GREEN);
  deepEqual('disposal 0/1: frame 3 draws its rect', px(frames[2].rgba, 3, 2, 0), BLUE);
  deepEqual('disposal 0/1: frame 1 output is not mutated later', px(frames[0].rgba, 3, 1, 0), RED);
}

// ---------- 4. disposal 2: restore to background (transparent) ----------
{
  const bytes = buildGif({
    width: 3, height: 1, gct: PAL,
    frames: [
      { width: 3, height: 1, indices: [1, 1, 1], disposal: 1 },
      { left: 1, width: 1, height: 1, indices: [2], disposal: 2 },
      { left: 2, width: 1, height: 1, indices: [3], disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('disposal 2: frame 2 shows its pixel', px(frames[1].rgba, 3, 1, 0), GREEN);
  deepEqual('disposal 2: frame 3 sees frame 2 rect cleared to transparent', px(frames[2].rgba, 3, 1, 0), CLEAR);
  deepEqual('disposal 2: only the rect is cleared', px(frames[2].rgba, 3, 0, 0), RED);
  deepEqual('disposal 2: frame 3 draws its pixel', px(frames[2].rgba, 3, 2, 0), BLUE);
}
{
  // disposal 2 on the first frame clears to transparent, not to the GIF background color
  const bytes = buildGif({
    width: 2, height: 1, gct: PAL,
    frames: [
      { width: 2, height: 1, indices: [1, 1], disposal: 2 },
      { width: 1, height: 1, indices: [3], disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('disposal 2 first frame: uncovered pixel is transparent', px(frames[1].rgba, 2, 1, 0), CLEAR);
}

// ---------- 5. disposal 3: restore to previous ----------
{
  const bytes = buildGif({
    width: 3, height: 1, gct: PAL,
    frames: [
      { width: 3, height: 1, indices: [1, 1, 1], disposal: 1 },
      { width: 3, height: 1, indices: [2, 2, 2], disposal: 3 },
      { left: 2, width: 1, height: 1, indices: [3], disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('disposal 3: frame 2 shows its pixels', px(frames[1].rgba, 3, 0, 0), GREEN);
  deepEqual('disposal 3: frame 3 restores frame-1 state', px(frames[2].rgba, 3, 0, 0), RED);
  deepEqual('disposal 3: frame 3 restores frame-1 state (middle)', px(frames[2].rgba, 3, 1, 0), RED);
  deepEqual('disposal 3: frame 3 draws its pixel', px(frames[2].rgba, 3, 2, 0), BLUE);
}
{
  const bytes = buildGif({
    width: 1, height: 1, gct: PAL,
    frames: [
      { width: 1, height: 1, indices: [1], disposal: 3 },
      { width: 1, height: 1, indices: [0], transparentIndex: 0, disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('disposal 3 first frame: restores the initial transparent canvas', px(frames[1].rgba, 1, 0, 0), CLEAR);
}

// ---------- 6. transparent index ----------
{
  const bytes = buildGif({
    width: 2, height: 1, gct: PAL,
    frames: [
      { width: 2, height: 1, indices: [1, 1], disposal: 1 },
      { width: 2, height: 1, indices: [0, 3], transparentIndex: 0, disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('transparent index: underlying pixel shows through', px(frames[1].rgba, 2, 0, 0), RED);
  deepEqual('transparent index: other pixels drawn', px(frames[1].rgba, 2, 1, 0), BLUE);
}
{
  const bytes = buildGif({ width: 1, height: 1, gct: PAL, frames: [{ width: 1, height: 1, indices: [2], transparentIndex: 2 }] });
  const { frames } = decodeAll(bytes);
  deepEqual('transparent index on first frame: pixel stays transparent', px(frames[0].rgba, 1, 0, 0), CLEAR);
}

// ---------- 7. interlaced ----------
{
  const w = 2, h = 11;
  const indices = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) indices.push(y % 4);
  const bytes = buildGif({ width: w, height: h, gct: PAL, frames: [{ width: w, height: h, indices, interlaced: true }] });
  const { gif, frames } = decodeAll(bytes);
  equal('interlaced: flag parsed', gif.frames[0].interlaced, true);
  let ok = true;
  const colors = [BLACK, RED, GREEN, BLUE];
  for (let y = 0; y < h; y++) {
    if (JSON.stringify(px(frames[0].rgba, w, 1, y)) !== JSON.stringify(colors[y % 4])) ok = false;
  }
  check('interlaced: all 11 rows land on their real positions', ok);
  deepEqual('interlaceRows(11)', Array.from(E.interlaceRows(11)), [0, 8, 4, 2, 6, 10, 1, 3, 5, 7, 9]);
}

// ---------- 8. local color table overrides global ----------
{
  const lct = [10, 20, 30, 40, 50, 60];
  const bytes = buildGif({
    width: 2, height: 1, gct: PAL,
    frames: [
      { width: 2, height: 1, indices: [1, 1], disposal: 1 },
      { width: 1, height: 1, indices: [1], lct, disposal: 1 },
    ],
  });
  const { frames } = decodeAll(bytes);
  deepEqual('local color table: frame 2 uses its own palette', px(frames[1].rgba, 2, 0, 0), [40, 50, 60, 255]);
  deepEqual('local color table: frame 1 uses the global palette', px(frames[0].rgba, 2, 0, 0), RED);
}
{
  const bytes = buildGif({ width: 2, height: 1, frames: [{ width: 2, height: 1, indices: [1, 2], lct: [9, 9, 9, 200, 100, 50] }] });
  const { frames } = decodeAll(bytes);
  deepEqual('local color table without a global table', px(frames[0].rgba, 2, 0, 0), [200, 100, 50, 255]);
  deepEqual('index beyond palette entries paints black', px(frames[0].rgba, 2, 1, 0), BLACK);
}
{
  const bytes = buildGif({ width: 1, height: 1, frames: [{ width: 1, height: 1, indices: [1] }] });
  const { frames } = decodeAll(bytes);
  deepEqual('no color table at all paints opaque black', px(frames[0].rgba, 1, 0, 0), BLACK);
}

// ---------- 9. LZW: code-width growth, clear codes, deferred clear ----------
function roundTrip(name, minCodeSize, count, options, seed) {
  const rand = lcg(seed);
  const max = 1 << minCodeSize;
  const indices = [];
  for (let i = 0; i < count; i++) indices.push(rand() % max);
  const data = lzwEncode(minCodeSize, indices, options);
  const res = lzwDecode(minCodeSize, data, count);
  equal(name + ': decoded count', res.count, count);
  let same = res.count === count;
  for (let i = 0; same && i < count; i++) if (res.indices[i] !== indices[i]) same = false;
  check(name + ': indices match', same);
}
roundTrip('LZW 8-bit random, clear when table full', 8, 40000, {}, 1);
roundTrip('LZW 2-bit random, grows 3->12 bits and clears', 2, 60000, {}, 2);
roundTrip('LZW 8-bit random, table full without clear (deferred clear)', 8, 40000, { clearWhenFull: false }, 3);
roundTrip('LZW 4-bit, extra clear codes mid-stream', 4, 5000, { clearEvery: 97 }, 4);
{
  // Long run of one color exercises the KwKwK case (code === next available).
  const indices = new Array(3000).fill(2);
  const res = lzwDecode(2, lzwEncode(2, indices), indices.length);
  check('LZW KwKwK run decodes', res.count === 3000 && res.indices.every((v) => v === 2));
}
{
  // Whole-GIF round trip with a 256-color palette and table overflow.
  const w = 80, h = 60;
  const rand = lcg(9);
  const indices = Array.from({ length: w * h }, () => rand());
  const gct = [];
  for (let i = 0; i < 256; i++) gct.push(i, 255 - i, (i * 7) & 255);
  const bytes = buildGif({ width: w, height: h, gct, frames: [{ width: w, height: h, indices, minCodeSize: 8 }] });
  const { frames } = decodeAll(bytes);
  let ok = true;
  for (let i = 0; i < w * h && ok; i++) {
    const c = indices[i];
    const got = px(frames[0].rgba, w, i % w, Math.floor(i / w));
    if (got[0] !== c || got[1] !== 255 - c || got[2] !== ((c * 7) & 255) || got[3] !== 255) ok = false;
  }
  check('256-color 80x60 GIF decodes pixel-exact', ok);
}
{
  const res = lzwDecode(2, Uint8Array.from([0xFF, 0xFF]), 4);
  check('LZW invalid first code stops without throwing', res.count === 0);
  const res2 = lzwDecode(9, Uint8Array.from([0]), 4);
  equal('LZW rejects minimum code size above 8', res2.count, 0);
}

// ---------- 10. truncated files ----------
{
  const w = 10, h = 10;
  const rand = lcg(5);
  const indices = Array.from({ length: w * h }, () => rand() % 4);
  const full = buildGif({ width: w, height: h, gct: PAL, frames: [
    { width: w, height: h, indices, disposal: 1, delayCs: 10 },
    { width: w, height: h, indices, disposal: 1, delayCs: 10 },
  ] });
  // Cut inside the second frame's LZW data.
  const cut = full.slice(0, full.length - 12);
  let gif, frames;
  try { ({ gif, frames } = decodeAll(cut)); } catch (e) { check('truncated: does not throw', false, e.message); }
  if (gif) {
    equal('truncated: flagged', gif.truncated, true);
    equal('truncated: both frames kept', frames.length, 2);
    equal('truncated: first frame complete', frames[0].complete, true);
    equal('truncated: second frame incomplete', frames[1].complete, false);
  }
  // Cut inside the second frame's image descriptor: that frame is dropped.
  // A one-frame build ends where the second frame's GCE (8 bytes) begins.
  const oneFrame = buildGif({ width: w, height: h, gct: PAL, frames: [{ width: w, height: h, indices, disposal: 1, delayCs: 10 }] });
  const secondDescriptor = oneFrame.length - 1 + 8;
  equal('fixture: second descriptor located', full[secondDescriptor], 0x2C);
  const cut2 = full.slice(0, secondDescriptor + 4);
  const r2 = decodeAll(cut2);
  equal('truncated in descriptor: frame dropped', r2.frames.length, 1);
  equal('truncated in descriptor: flagged', r2.gif.truncated, true);
  // File ends right after the header.
  const r3 = E.parseGif(full.slice(0, 8));
  check('truncated header: no frames, no throw', r3.frames.length === 0 && r3.truncated === true);
  // Missing trailer is tolerated.
  const r4 = decodeAll(full.slice(0, full.length - 1));
  equal('missing trailer: both frames decoded', r4.frames.length, 2);
}
{
  // Truncated in the middle of a frame: decoded rows keep their pixels,
  // the rest stays transparent.
  const w = 4, h = 4;
  const indices = new Array(w * h).fill(1);
  const data = lzwEncode(2, indices);
  const partial = lzwDecode(2, data.slice(0, 2), w * h);
  check('partial LZW data: some but not all pixels', partial.count > 0 && partial.count < w * h, 'count ' + partial.count);
}

// ---------- 11. loop count / durations ----------
{
  const bytes = buildGif({ width: 1, height: 1, gct: PAL, loop: 3, frames: [{ width: 1, height: 1, indices: [1], delayCs: 0 }, { width: 1, height: 1, indices: [2], delayCs: 7 }] });
  const { gif, frames } = decodeAll(bytes);
  equal('loop count 3 parsed', gif.loopCount, 3);
  equal('delay 0 cs plays as 100 ms', frames[0].durationMs, 100);
  equal('delay 7 cs is 70 ms', frames[1].durationMs, 70);
  equal('raw delay kept', frames[1].delayCs, 7);
  equal('frameDurationMs(1)', E.frameDurationMs(1), 100);
  equal('frameDurationMs(2)', E.frameDurationMs(2), 20);
}

// ---------- 12. logical screen and bounds ----------
{
  const bytes = buildGif({ width: 0, height: 0, gct: PAL, frames: [{ left: 1, top: 2, width: 2, height: 1, indices: [1, 2] }] });
  const { gif, frames } = decodeAll(bytes);
  equal('0x0 logical screen falls back to frame extent (width)', gif.width, 3);
  equal('0x0 logical screen falls back to frame extent (height)', gif.height, 3);
  deepEqual('0x0 logical screen: frame placed at offset', px(frames[0].rgba, 3, 2, 2), GREEN);
}
{
  const bytes = buildGif({ width: 2, height: 2, gct: PAL, frames: [{ left: 1, top: 1, width: 3, height: 3, indices: new Array(9).fill(3) }] });
  let frames;
  try { ({ frames } = decodeAll(bytes)); } catch (e) { check('out-of-bounds frame does not throw', false, e.message); }
  if (frames) {
    deepEqual('out-of-bounds frame: inside part drawn', px(frames[0].rgba, 2, 1, 1), BLUE);
    deepEqual('out-of-bounds frame: outside untouched', px(frames[0].rgba, 2, 0, 0), CLEAR);
    equal('out-of-bounds frame: buffer size unchanged', frames[0].rgba.length, 2 * 2 * 4);
  }
}
{
  // Comment and unknown application extensions are skipped.
  const base = buildGif({ width: 1, height: 1, gct: PAL, frames: [{ width: 1, height: 1, indices: [1] }] });
  const comment = [0x21, 0xFE, 3, 0x61, 0x62, 0x63, 0];
  const app = [0x21, 0xFF, 11, ...[...'XMP DataXMP'].map((c) => c.charCodeAt(0)), 2, 1, 2, 0];
  const at = 13 + 12; // header + LSD + 4-entry GCT
  const bytes = Uint8Array.from([...base.slice(0, at), ...comment, ...app, ...base.slice(at)]);
  const { gif, frames } = decodeAll(bytes);
  check('comment + unknown app extension skipped', frames.length === 1 && gif.loopCount === null && px(frames[0].rgba, 1, 0, 0)[0] === 255);
}

// ---------- 13. decoding budget ----------
{
  const L = E.GS_LIMITS;
  equal('limit maxPixels', L.maxPixels, 50000000);
  equal('limit maxFrames', L.maxFrames, 1000);
  equal('limit maxCanvasArea', L.maxCanvasArea, 16777216);
  const mk = (w, h, n) => ({ width: w, height: h, frames: Array.from({ length: n }, () => ({ width: w, height: h })) });
  deepEqual('budget ok for 480x270x385', E.checkBudget(mk(480, 270, 385)), { ok: true, reason: null, pixels: 480 * 270 * 385 });
  equal('budget rejects pixels over 50M', E.checkBudget(mk(640, 360, 218)).reason, 'pixels');
  equal('budget rejects more than 1000 frames', E.checkBudget(mk(10, 10, 1001)).reason, 'frames');
  equal('budget rejects 5000x5000 frame', E.checkBudget(mk(5000, 5000, 1)).reason, 'frameSize');
  equal('budget rejects side over 16384', E.checkBudget(mk(20000, 10, 1)).reason, 'frameSize');
  const hostile = { width: 10, height: 10, frames: [{ width: 65535, height: 65535 }] };
  equal('budget rejects an oversized frame inside a small screen', E.checkBudget(hostile).reason, 'frameSize');
}

// ---------- 14. selection ----------
{
  const toList = (sel) => sel.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
  deepEqual('selectRange 1..10 every 3', toList(E.selectRange(10, 1, 10, 3)), [1, 4, 7, 10]);
  deepEqual('selectRange 3..5', toList(E.selectRange(10, 3, 5, 1)), [3, 4, 5]);
  deepEqual('selectRange reversed bounds', toList(E.selectRange(10, 5, 3, 1)), [3, 4, 5]);
  deepEqual('selectRange clamps to total', toList(E.selectRange(5, 0, 99, 2)), [1, 3, 5]);
  deepEqual('selectRange empty inputs select all', toList(E.selectRange(4, '', '', '')), [1, 2, 3, 4]);
  deepEqual('selectRange step 0 treated as 1', toList(E.selectRange(3, 1, 3, 0)), [1, 2, 3]);
  equal('selectRange length', E.selectRange(7, 1, 1, 1).length, 7);
}

// ---------- 15. file names ----------
{
  equal('baseName strips .gif', E.baseName('cat.dance.GIF'), 'cat.dance');
  equal('baseName empty -> animation', E.baseName(''), 'animation');
  equal('padFrameNo min 3 digits', E.padFrameNo(7, 12), '007');
  equal('padFrameNo 4 digits for 1000 frames', E.padFrameNo(7, 1000), '0007');
  equal('frameFileName', E.frameFileName('cat', 12, 48, 'png'), 'cat-frame-012.png');
  equal('frameFileName jpg', E.frameFileName('cat', 1, 5, 'jpg'), 'cat-frame-001.jpg');
}

// ---------- 16. sprite layout + JSON ----------
{
  const layout = E.spriteLayout(10, 8, 5, 2, 4);
  equal('sprite columns', layout.columns, 2);
  equal('sprite rows', layout.rows, 3);
  equal('sprite width', layout.width, 2 * 10 + 4);
  equal('sprite height', layout.height, 3 * 8 + 2 * 4);
  deepEqual('sprite cell 3 position', layout.cells[3], { x: 14, y: 12 });
  deepEqual('sprite cell 4 position', layout.cells[4], { x: 0, y: 24 });
  equal('sprite columns clamp to frame count', E.spriteLayout(10, 8, 3, 8, 0).columns, 3);
  equal('sprite invalid columns -> 1', E.spriteLayout(10, 8, 3, 'x', 0).columns, 1);
  equal('sprite negative spacing -> 0', E.spriteLayout(10, 8, 3, 3, -5).spacing, 0);
  equal('spriteFits small sheet', E.spriteFits(layout), true);
  equal('spriteFits rejects 5000x5000', E.spriteFits(E.spriteLayout(1000, 1000, 25, 5, 0)), false);
  equal('spriteFits rejects side over 16384', E.spriteFits(E.spriteLayout(100, 10, 200, 200, 0)), false);
  const json = E.spriteJson('cat-sprite.png', layout, 10, 8, [1, 3, 5, 7, 9].map((n) => ({ frame: n, durationMs: n * 10 })));
  equal('sprite JSON image', json.image, 'cat-sprite.png');
  equal('sprite JSON frame count', json.frames.length, 5);
  deepEqual('sprite JSON frame entry', json.frames[3], { frame: 7, x: 14, y: 12, w: 10, h: 8, duration: 70 });
  check('sprite JSON serializes', JSON.parse(JSON.stringify(json)).width === 24);
}

// ---------- 17. CRC32 + STORED ZIP ----------
{
  const enc = new TextEncoder();
  equal('crc32("123456789")', E.crc32(enc.encode('123456789')), 0xCBF43926);
  const files = [
    { name: 'cat-frame-001.png', data: Uint8Array.from([1, 2, 3, 4, 5]) },
    { name: 'cat-frame-002.png', data: enc.encode('hello zip') },
    { name: '動画-frame-003.png', data: new Uint8Array(0) },
  ];
  const zip = E.zipStore(files);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  equal('zip EOCD signature', dv.getUint32(eocd, true), 0x06054b50);
  equal('zip EOCD entry count', dv.getUint16(eocd + 10, true), 3);
  let cd = dv.getUint32(eocd + 16, true);
  let ok = true;
  const dec = new TextDecoder();
  for (let i = 0; i < files.length; i++) {
    if (dv.getUint32(cd, true) !== 0x02014b50) { ok = false; break; }
    const nameLen = dv.getUint16(cd + 28, true);
    const name = dec.decode(zip.subarray(cd + 46, cd + 46 + nameLen));
    const localOff = dv.getUint32(cd + 42, true);
    const size = dv.getUint32(cd + 24, true);
    const crc = dv.getUint32(cd + 16, true);
    if (dv.getUint32(localOff, true) !== 0x04034b50) ok = false;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const data = zip.subarray(localOff + 30 + lNameLen, localOff + 30 + lNameLen + size);
    if (name !== files[i].name) ok = false;
    if (E.crc32(data) !== crc) ok = false;
    if (Buffer.compare(Buffer.from(data), Buffer.from(files[i].data)) !== 0) ok = false;
    cd += 46 + nameLen;
  }
  check('zip central directory, names, CRCs and data parse back', ok);

  const dir = mkdtempSync(join(tmpdir(), 'gif-splitter-test-'));
  try {
    const path = join(dir, 'frames.zip');
    writeFileSync(path, zip);
    const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    if (r.error) {
      console.log('SKIP  unzip -t (unzip not available)');
    } else {
      check('unzip -t reports no errors', r.status === 0 && /No errors detected/.test(r.stdout), (r.stdout || '') + (r.stderr || ''));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- 18. segmented decoding ----------
// Decoding with a small chunk pauses inside frames (mid-row, mid-code, at frame
// ends). The output must match decoding with no chunk limit byte for byte.
function frameKey(f) {
  return JSON.stringify([f.index, f.delayCs, f.durationMs, f.disposal, f.complete]) + Buffer.from(f.rgba.buffer).toString('base64');
}
function sameFrames(a, b) {
  return a.length === b.length && a.every((f, i) => frameKey(f) === frameKey(b[i]));
}
const PAL256 = [];
for (let i = 0; i < 256; i++) PAL256.push(i, 255 - i, (i * 7) & 255);
const mixedGif = (() => {
  const rand = lcg(11);
  const r4 = (n) => Array.from({ length: n }, () => rand() % 4);
  const r256 = (n) => Array.from({ length: n }, () => rand());
  return buildGif({
    width: 7, height: 6, gct: PAL, loop: 0,
    frames: [
      { width: 7, height: 6, indices: r4(42), disposal: 1, delayCs: 4 },
      { left: 2, top: 1, width: 4, height: 3, indices: r4(12), transparentIndex: 0, disposal: 2, delayCs: 4 },
      { width: 7, height: 6, indices: r256(42), lct: PAL256, minCodeSize: 8, interlaced: true, disposal: 3 },
      { left: 5, top: 4, width: 4, height: 4, indices: r4(16), transparentIndex: 3, disposal: 1 },
      { width: 7, height: 6, indices: new Array(42).fill(2), disposal: 0, lzwOptions: { clearEvery: 5 } },
      { left: 1, top: 1, width: 5, height: 5, indices: r4(25), interlaced: true, transparentIndex: 1, disposal: 3 },
      { width: 7, height: 6, indices: r4(42), disposal: 1 },
    ],
  });
})();
const bigGif = (() => {
  const rand = lcg(12);
  const w = 80, h = 60;
  const noise = Array.from({ length: w * h }, () => rand());
  const run = Array.from({ length: w * h }, (_, i) => (i < 3000 ? 9 : rand()));
  return buildGif({
    width: w, height: h, gct: PAL256,
    frames: [
      { width: w, height: h, indices: noise, minCodeSize: 8, disposal: 1 },
      { left: 3, top: 2, width: 70, height: 50, indices: noise.slice(0, 3500), minCodeSize: 8, lzwOptions: { clearWhenFull: false }, transparentIndex: 5, disposal: 2 },
      { width: w, height: h, indices: run, minCodeSize: 8, interlaced: true, disposal: 1 },
    ],
  });
})();
const segmentFixtures = [
  { name: 'mixed 7x6', bytes: mixedGif, chunks: [1, 2, 3, 5, 6, 7, 8, 11, 12, 13, 41, 42, 43, 1000] },
  { name: 'mixed 7x6 truncated', bytes: mixedGif.slice(0, mixedGif.length - 9), chunks: [1, 4, 7, 42, 43] },
  { name: 'big 80x60', bytes: bigGif, chunks: [1, 79, 80, 81, 3499, 3500, 3501, 4799, 4800, 4801, 32768] },
];
for (const fx of segmentFixtures) {
  const ref = decodeAll(fx.bytes, 0);
  equal('segmented ' + fx.name + ': no chunk limit never pauses', ref.pauses, 0);
  for (const chunk of fx.chunks) {
    const seg = decodeAll(fx.bytes, chunk);
    check('segmented ' + fx.name + ', chunk ' + chunk + ': frames match one-shot decode', sameFrames(seg.frames, ref.frames),
      seg.frames.length + ' vs ' + ref.frames.length + ' frames');
    const largest = Math.max(...ref.gif.frames.map((f) => f.width * f.height));
    if (chunk < largest) check('segmented ' + fx.name + ', chunk ' + chunk + ': pauses inside frames', seg.pauses > 0);
  }
}
{
  const ref = decodeAll(mixedGif, 0);
  equal('segmented fixture: truncated variant flags an incomplete frame', decodeAll(mixedGif.slice(0, mixedGif.length - 9), 3).frames.some((f) => !f.complete), true);
  equal('segmented fixture: mixed GIF decodes 7 frames', ref.frames.length, 7);
  // Chunk 1: every step does at most one pixel of LZW or blit work, so the
  // pause count is at least the decoded pixels minus one per frame per phase.
  const one = decodeAll(mixedGif, 1);
  const pixels = ref.gif.frames.reduce((sum, f) => sum + f.width * f.height, 0);
  check('segmented chunk 1: pauses at every pixel', one.pauses >= 2 * (pixels - ref.gif.frames.length), one.pauses + ' pauses for ' + pixels + ' px');
}
{
  // lzwRun with a limit produces exactly up to that limit, resuming mid-code
  // (long runs leave output on the stack between calls).
  const rand = lcg(13);
  const indices = Array.from({ length: 6000 }, (_, i) => (i < 3000 ? 2 : rand() % 4));
  const data = lzwEncode(2, indices, { clearEvery: 301 });
  const chain = Uint8Array.from(subBlocks([...data]));
  for (const chunk of [1, 3, 64, 4097]) {
    const lzw = E.createLzw(2, chain, 0, indices.length);
    let calls = 0, overshoot = false;
    while (!lzw.done) {
      const before = lzw.count;
      E.lzwRun(lzw, before + chunk);
      if (lzw.count - before > chunk || (!lzw.done && lzw.count - before !== chunk)) overshoot = true;
      calls++;
    }
    check('lzwRun chunk ' + chunk + ': each call stops at its limit', !overshoot);
    check('lzwRun chunk ' + chunk + ': resumed output matches the source', lzw.count === indices.length && indices.every((v, i) => lzw.indices[i] === v));
    check('lzwRun chunk ' + chunk + ': call count', calls === Math.ceil(indices.length / chunk), String(calls));
  }
  const bad = E.createLzw(9, Uint8Array.from([1, 0, 0]), 0, 4);
  check('createLzw with invalid code size is done at once', bad.done === true && bad.count === 0);
  const partial = E.createLzw(2, Uint8Array.from(subBlocks([...data.slice(0, 40)])), 0, indices.length);
  E.lzwRun(partial, 5);
  E.lzwRun(partial, Infinity);
  const whole = lzwDecode(2, data.slice(0, 40), indices.length);
  check('lzwRun on truncated data: resumed count matches one-shot', partial.done && partial.count === whole.count && partial.count < indices.length);
}

// ---------- 19. abort in the middle of a frame ----------
{
  const gif = E.parseGif(bigGif);
  const bytesBefore = Buffer.from(gif.bytes).toString('base64');
  const ref = drain(E.createCompositor(E.parseGif(bigGif), 0)).frames;
  // Step an abandoned compositor into the middle of frame 2, then drop it.
  const abandoned = E.createCompositor(gif, 97);
  const early = [];
  let f;
  while (early.length < 1) {
    f = abandoned.step();
    if (f) early.push(f);
  }
  for (let i = 0; i < 40; i++) {
    f = abandoned.step();
    if (f) early.push(f);
  }
  equal('abort: stopped mid-frame (last step paused)', f, undefined);
  equal('abort: one frame finished before the stop', early.length, 1);
  const fresh = drain(E.createCompositor(gif, 97)).frames;
  check('abort: a new compositor on the same parsed GIF matches one-shot decode', sameFrames(fresh, ref));
  check('abort: file bytes are not modified', Buffer.from(gif.bytes).toString('base64') === bytesBefore);
  check('abort: frame returned before the stop is unchanged', frameKey(early[0]) === frameKey(ref[0]));
  // Two decodes stepped in turn (old file still pending, new file started)
  // do not share state.
  const a = E.createCompositor(E.parseGif(mixedGif), 3);
  const b = E.createCompositor(E.parseGif(bigGif), 5);
  const outA = [], outB = [];
  let doneA = false, doneB = false;
  while (!doneA || !doneB) {
    if (!doneA) { const x = a.step(); if (x === null) doneA = true; else if (x) outA.push(x); }
    if (!doneB) { const y = b.step(); if (y === null) doneB = true; else if (y) outB.push(y); }
  }
  check('abort: interleaved decodes of two files stay independent (file A)', sameFrames(outA, decodeAll(mixedGif, 0).frames));
  check('abort: interleaved decodes of two files stay independent (file B)', sameFrames(outB, ref));
  // After the end, step() keeps returning null.
  equal('step after the last frame returns null', a.step(), null);
}

// ---------- 20. image data read in place from the sub-block chain ----------
{
  const rand = lcg(21);
  const indices = Array.from({ length: 900 }, () => rand() % 16);
  const data = lzwEncode(4, indices);
  const decodeChain = (chain, start = 0, chunk = Infinity) => {
    const lzw = E.createLzw(4, Uint8Array.from(chain), start, indices.length);
    E.lzwRun(lzw, chunk);
    while (!lzw.done) E.lzwRun(lzw, lzw.count + chunk);
    return lzw;
  };
  const matches = (lzw, n) => lzw.count === n && indices.slice(0, n).every((v, i) => lzw.indices[i] === v);
  // Codes are 5 bits wide and cross sub-block boundaries for every size.
  for (const size of [1, 2, 3, 7, 254, 255]) {
    check('sub-blocks of ' + size + ' bytes: decodes all pixels', matches(decodeChain(subBlocks([...data], size)), indices.length));
    check('sub-blocks of ' + size + ' bytes, chunk 1: decodes all pixels', matches(decodeChain(subBlocks([...data], size), 0, 1), indices.length));
  }
  check('chain may start at an offset inside the file', matches(decodeChain([9, 9, 9, ...subBlocks([...data], 50)], 3), indices.length));

  // Zero-length terminator ends the stream: bytes after it are not read.
  const k = 120;
  const early = subBlocks([...data.slice(0, k)], 40);
  const withTail = [...early, ...subBlocks([...data.slice(k)], 40)];
  const stopped = decodeChain(withTail);
  const reference = decodeChain(early);
  check('terminator: stops before the data that follows it', stopped.count === reference.count && stopped.count < indices.length && matches(stopped, stopped.count),
    stopped.count + ' vs ' + reference.count);
  equal('terminator: read position is just past the terminator', stopped.pos, early.length);

  // File ends at a sub-block length byte: what came before is decoded.
  const complete = subBlocks([...data], 30, false);
  const cutAtHeader = complete.slice(0, 31 * 4);
  const atHeader = decodeChain(cutAtHeader);
  const atHeaderRef = decodeChain(subBlocks([...data.slice(0, 30 * 4)], 255));
  check('cut at a sub-block header: decodes the bytes before it', atHeader.done && atHeader.count === atHeaderRef.count && atHeader.count > 0 && matches(atHeader, atHeader.count));
  // File ends inside a sub-block whose length byte promises more.
  const cutInside = complete.slice(0, 31 * 4 + 11);
  const inside = decodeChain(cutInside);
  const insideRef = decodeChain(subBlocks([...data.slice(0, 30 * 4 + 10)], 255));
  check('cut inside a sub-block: decodes the bytes present', inside.done && inside.count === insideRef.count && inside.count > atHeader.count && matches(inside, inside.count));
  const insideSteps = decodeChain(cutInside, 0, 1);
  check('cut inside a sub-block, chunk 1: same result', insideSteps.count === inside.count);
  // File ends right after a length byte.
  check('cut right after a length byte: decodes the bytes before it', decodeChain(complete.slice(0, 31 * 4 + 1)).count === atHeader.count);
}
{
  // parseGif records the chain in place; frame data bytes are counted, not copied.
  const w = 30, h = 30;
  const rand = lcg(22);
  const indices = Array.from({ length: w * h }, () => rand() % 4);
  const bytes = buildGif({ width: w, height: h, gct: PAL, frames: [{ width: w, height: h, indices }, { width: w, height: h, indices, disposal: 1 }] });
  const gif = E.parseGif(bytes);
  const dataLen = lzwEncode(2, indices).length;
  check('parse: image data is not copied (frames keep offsets into the file)', gif.bytes === bytes && gif.frames.every((f) => !('data' in f)));
  equal('parse: dataSize counts data bytes of the chain', gif.frames[0].dataSize, dataLen);
  equal('parse: dataStart points at the first length byte', bytes[gif.frames[0].dataStart], Math.min(255, dataLen));
  // Truncation at every offset of the second frame's chain: in-place reading
  // matches decoding the same bytes copied out into a well-formed chain.
  const second = gif.frames[1].dataStart;
  let ok = true, detail = '';
  for (let cutAt = second - 1; cutAt <= bytes.length; cutAt++) {
    const g = E.parseGif(bytes.slice(0, cutAt));
    const f = g.frames[1];
    if (!f) { if (cutAt > second + 1) { ok = false; detail = 'frame dropped at ' + cutAt; } continue; }
    const copied = [];
    for (let q = f.dataStart; q < g.bytes.length && g.bytes[q] !== 0; q += 1 + g.bytes[q]) {
      copied.push(...g.bytes.slice(q + 1, Math.min(q + 1 + g.bytes[q], g.bytes.length)));
    }
    if (copied.length !== f.dataSize) { ok = false; detail = 'dataSize at ' + cutAt; break; }
    const inPlace = E.createLzw(2, g.bytes, f.dataStart, w * h);
    E.lzwRun(inPlace, Infinity);
    const ref = lzwDecode(2, Uint8Array.from(copied), w * h);
    if (inPlace.count !== ref.count || inPlace.indices.some((v, i) => v !== ref.indices[i])) { ok = false; detail = 'decode at ' + cutAt; break; }
    const seg = decodeAll(bytes.slice(0, cutAt), 7).frames, one = decodeAll(bytes.slice(0, cutAt), 0).frames;
    if (!sameFrames(seg, one)) { ok = false; detail = 'segmented at ' + cutAt; break; }
    if (cutAt < bytes.length - 1 && (f.complete || !g.truncated)) { ok = false; detail = 'flags at ' + cutAt; break; }
  }
  check('parse: truncation at every offset of a chain reads like the copied data', ok, detail);
  const noData = E.parseGif(bytes.slice(0, second));
  equal('parse: file ending before any image data drops that frame', noData.frames.length, 1);
}

// ---------- 21. progress counts decoded pixels ----------
{
  // Drain a compositor and record progress() after every step.
  const trace = (comp) => {
    const values = [comp.progress()];
    const atFrameEnd = [];
    let f;
    while ((f = comp.step()) !== null) {
      values.push(comp.progress());
      if (f) atFrameEnd.push(comp.progress());
    }
    values.push(comp.progress());
    return { values, atFrameEnd };
  };
  const monotonic = (v) => v.every((x, i) => i === 0 || x >= v[i - 1]);
  const inRange = (v) => v.every((x) => x >= 0 && x <= 1);

  // One large frame: progress moves before the frame is done.
  const w = 120, h = 90;
  const rand = lcg(33);
  const indices = Array.from({ length: w * h }, () => rand() % 4);
  const single = buildGif({ width: w, height: h, gct: PAL, frames: [{ width: w, height: h, indices, disposal: 1, delayCs: 10 }] });
  const chunk = 500;
  const one = trace(E.createCompositor(E.parseGif(single), chunk));
  equal('progress single frame: starts at 0', one.values[0], 0);
  // values: [before, ...paused steps, frame returned, null returned, after]
  const midFrame = one.values.slice(1, -3);
  check('progress single frame: moves inside the frame', midFrame.length > 0 && midFrame.every((x) => x > 0 && x < 1), JSON.stringify(midFrame.slice(0, 5)));
  check('progress single frame: at least one pause per chunk of pixels', midFrame.length >= Math.ceil(w * h / chunk), String(midFrame.length));
  const maxJump = Math.max(...one.values.slice(1).map((x, i) => x - one.values[i]));
  check('progress single frame: no step jumps more than two chunks of work', maxJump <= (2 * chunk) / (2 * w * h) + 1e-12, String(maxJump));
  check('progress single frame: first pause = one chunk of decode work', Math.abs(midFrame[0] - chunk / (2 * w * h)) < 1e-12, String(midFrame[0]));
  check('progress single frame: monotonic and within [0, 1]', monotonic(one.values) && inRange(one.values));
  equal('progress single frame: 1 when the frame is returned', one.atFrameEnd[0], 1);
  equal('progress single frame: 1 after the end', one.values[one.values.length - 1], 1);

  // Frames of different sizes: progress at each frame end = share of pixels so far.
  const mixed = trace(E.createCompositor(E.parseGif(mixedGif), 7));
  const parsed = E.parseGif(mixedGif);
  const areas = parsed.frames.map((f) => f.width * f.height);
  const totalArea = areas.reduce((a, b) => a + b, 0);
  let acc = 0;
  const expected = areas.map((a) => (acc += a) / totalArea);
  check('progress mixed frames: frame-end values equal the pixel share done',
    mixed.atFrameEnd.length === expected.length && mixed.atFrameEnd.every((x, i) => Math.abs(x - expected[i]) < 1e-12),
    JSON.stringify(mixed.atFrameEnd) + ' vs ' + JSON.stringify(expected));
  check('progress mixed frames: monotonic and within [0, 1]', monotonic(mixed.values) && inRange(mixed.values));

  // Truncated frame: fewer pixels decode, progress still reaches 1 and never goes back.
  const two = buildGif({ width: w, height: h, gct: PAL, frames: [
    { width: w, height: h, indices, disposal: 1, delayCs: 10 },
    { width: w, height: h, indices, disposal: 1, delayCs: 10 },
  ] });
  const cut = two.slice(0, two.length - 400);
  const truncated = trace(E.createCompositor(E.parseGif(cut), chunk));
  check('progress truncated: monotonic and within [0, 1]', monotonic(truncated.values) && inRange(truncated.values));
  equal('progress truncated: 1 after the end', truncated.values[truncated.values.length - 1], 1);

  // No limit on chunk: one step per frame, progress jumps straight to the frame's share.
  const whole = trace(E.createCompositor(E.parseGif(single), 0));
  deepEqual('progress without chunking: 0 then 1', whole.values, [0, 1, 1]);

  // A GIF with only 0×0 frames has no pixel work: 0 before, 1 after.
  const empty = trace(E.createCompositor(E.parseGif(buildGif({ width: 4, height: 4, gct: PAL, frames: [{ width: 0, height: 0, indices: [], disposal: 1, delayCs: 10 }] })), chunk));
  equal('progress zero-size frames: 0 before decoding', empty.values[0], 0);
  equal('progress zero-size frames: 1 after the end', empty.values[empty.values.length - 1], 1);
}

// ---------- summary ----------

// Actual full page and shared-shortcut regressions. Canvas operations below are receipts,
// not browser-rendering evidence. sharp reads and encodes the real fixture bytes.
const pageSource=source;
const legacyCounts={PASS:passes,FAIL:failures};
{
const {createHash}=await import('node:crypto');
const {createRequire}=await import('node:module');
const {relative}=await import('node:path');
const {pathToFileURL}=await import('node:url');
const vm=(await import('node:vm')).default;
const {loadPage}=await import(pathToFileURL(join(root,'scripts/astro-page-harness.mjs')));
const ROOT=root,require=createRequire(join(ROOT,'package.json'));
const {parseFragment,defaultTreeAdapter}=require('parse5'),sharp=require('sharp');
const paths={gif:process.env.ZT_B14_SOURCE?relative(ROOT,process.env.ZT_B14_SOURCE):'src/components/tools/GifSplitterTool.astro'},slugs={gif:'gif-splitter'},source={gif:pageSource};
const sha=s=>createHash('sha256').update(s).digest('hex');
const layout=readFileSync(join(ROOT,'src/layouts/ToolLayout.astro'),'utf8');
const shortcut=layout.slice(layout.indexOf('// ── Keyboard shortcuts:'),layout.indexOf('// ── Copy button visual feedback'));
const must=(b,m)=>{if(!b)throw Error('Regression prerequisite: '+m);};
const checks=[],unhandled=[],observations=[];let phase='init';
const onRejection=e=>unhandled.push({phase,message:e?.message||String(e)});process.on('unhandledRejection',onRejection);
function check(id,expected,actual){const status=JSON.stringify(expected)===JSON.stringify(actual)?'PASS':'FAIL';checks.push({id,status,expected,actual});console.log(status+' '+id);}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
const waitFor=async(fn)=>{const until=Date.now()+5000;while(!fn()){if(Date.now()>until)throw Error('Boundary not reached: '+phase);await new Promise(r=>setTimeout(r,5));}};
async function scene(id,fn){phase=id;try{await fn();}catch(e){checks.push({id,status:'FAIL',actual:e.stack});console.error(e);}}
const table=source.gif.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
must(table,'build-time STRINGS marker');
const labels=vm.runInNewContext(table[1]+';STRINGS'),L=labels.en;
const htmlEscape=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
// A fixture renderer for the static label bindings, not compiled Astro/browser evidence.
function fixtureMarkup(lang){
 const L=labels[lang]||labels.en;
 let html=source.gif.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0];
 html=html.replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.([\w]+)\}(?: wide)?>(\{L\.tips\.([\w]+)\})<\/Toggletip>/g,(_,id,about,body,key)=>'<span class="zt-tip"><button type="button" data-zt-tip="'+id+'" aria-controls="'+id+'" aria-expanded="false" aria-label="'+htmlEscape(L[about])+'"></button><span id="'+id+'" class="zt-tip-pop" popover="auto" role="note">'+htmlEscape(L.tips[key])+'</span></span>');
 html=html.replace('<p set:html={L.dropHint}></p>','<p>'+L.dropHint+'</p>');
 html=html.replace("{L.downloadZip.replace('{n}', '0')}",htmlEscape(L.downloadZip.replace('{n}','0')));
 html=html.replace(/([\w-]+)=\{L\.([\w]+)\}/g,(_,attr,key)=>attr+'="'+htmlEscape(L[key])+'"');
 html=html.replace(/\{L\.([\w]+)\}/g,(_,key)=>htmlEscape(L[key]));
 must(!/Toggletip|\{L\./.test(html),'fixture covers actual static bindings');
 return html;
}
function page(order='shared-after',lang='en'){
 const key='gif';
 const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],tracks=[],tasks=[],downloads=[],blobs=new Map(),encodes=[],yields=[];
 const controls={holdEncode:false,holdYield:false};
 const nativeClipboard={getter:0,write:0};
 let timerId=0,clock=0,doc,urlId=0;
 // RGBA/2D boundary: enough for this probe's opaque 2x2 fixtures; not a Canvas rendering conformance test.
 function pixels(c){const n=(c.width||0)*(c.height||0)*4;if(!c.rgba||c.rgba.length!==n)c.rgba=new Uint8ClampedArray(n);return c.rgba;}
 function canvasContext(c){return{canvas:c,fillStyle:'#000000',clearRect(x,y,w,h){const d=pixels(c);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)d.fill(0,(yy*c.width+xx)*4,(yy*c.width+xx)*4+4);},
  putImageData(img,x,y){const d=pixels(c);for(let yy=0;yy<img.height;yy++)for(let xx=0;xx<img.width;xx++)d.set(img.data.subarray((yy*img.width+xx)*4,(yy*img.width+xx)*4+4),((y+yy)*c.width+x+xx)*4);},
  getImageData(x,y,w,h){const data=new Uint8ClampedArray(w*h*4),d=pixels(c);for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)data.set(d.subarray(((y+yy)*c.width+x+xx)*4,((y+yy)*c.width+x+xx)*4+4),(yy*w+xx)*4);return{data,width:w,height:h};},
  drawImage(src,...a){must(src,'drawImage source exists');const data=src.rgba||pixels(src);let sx=0,sy=0,sw=src.width,sh=src.height,dx,dy,dw,dh;if(a.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=a;else{[dx,dy,dw=sw,dh=sh]=a;}const out=pixels(c);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const si=((sy+Math.floor(y*sh/dh))*src.width+sx+Math.floor(x*sw/dw))*4,di=((dy+y)*c.width+dx+x)*4;const alpha=data[si+3]/255;for(let z=0;z<3;z++)out[di+z]=Math.round(data[si+z]*alpha+out[di+z]*(1-alpha));out[di+3]=Math.round((alpha+out[di+3]/255*(1-alpha))*255);}},
  fillRect(x,y,w,h){const rgb=this.fillStyle.match(/[0-9a-f]{2}/gi).map(v=>parseInt(v,16));const d=pixels(c);for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++)d.set([...rgb,255],(yy*c.width+xx)*4);},save(){},restore(){},setLineDash(){},strokeRect(){throw Error('Unrequested outline path');}};}
 function encodeCanvas(c,callback,mime){const rgba=Buffer.from(pixels(c)),width=c.width,height=c.height,held=controls.holdEncode;
  const job={mime,width,height,rgba:[...rgba],held,ready:false,delivered:false,deliver(value){must(job.ready&&!job.delivered,'encode delivered once and ready');job.delivered=true;callback(arguments.length?value:job.blob);}};encodes.push(job);
  let encoder=sharp(rgba,{raw:{width,height,channels:4}});encoder=mime==='image/jpeg'?encoder.jpeg():mime==='image/webp'?encoder.webp():encoder.png();
  encoder.toBuffer().then(bytes=>{job.blob=new Blob([bytes],{type:mime});job.ready=true;if(!held)job.deliver();},e=>{job.error=e.message;job.blob=null;job.ready=true;if(!held)job.deliver();});
 }
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const matchOne = (el, selector) => {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchOne(parent, parts.join(' '))) return true;
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  };
  const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
  class EventStub {
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false, isTrusted: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return (this.querySelectorAll('option').find(o=>o.selected)||this.querySelector('option'))?.value ?? '';
      return this._value;
    }
    set value(v) { let x=String(v);if(this.tagName==='SELECT'&&!this.querySelectorAll('option').some(o=>o.value===x))x='';if(this.tagName==='INPUT'&&this.type==='number'&&x!==''&&!Number.isFinite(Number(x)))x='';this._value=x;this.dirtyValue=true; }
    get firstChild() { return this.children[0]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked', 'selected'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child; }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (matches(el, selector)) return el; return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentNode) {
        event.currentTarget = el;
        for (const fn of el.listeners[event.type] || []) {const result=fn.call(el,event);if(result&&typeof result.then==='function')tasks.push(result);}
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(this.disabled)return;if(this.tagName==='A'&&this.download){downloads.push({name:this.download,blob:blobs.get(this.href)});return;}this.focus();this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { if(doc.activeElement===this)return;const old=doc.activeElement;doc.activeElement=this;if(old)old.dispatchEvent(new EventStub('blur'));this.dispatchEvent(new EventStub('focus')); }
    getContext(kind) { must(this.tagName==='CANVAS'&&kind==='2d','canvas context'); return this._ctx??=canvasContext(this); }
    toBlob(callback,mime='image/png') { encodeCanvas(this,callback,mime); }
    getBoundingClientRect() { return {left:0,top:0,width:this.width||0,height:this.height||0}; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }


  doc=new Element('#document');doc.documentElement=new Element('html');doc.documentElement.lang=lang;doc.appendChild(doc.documentElement);
  doc.body=new Element('body');doc.documentElement.appendChild(doc.body);
  const widget=new Element('section');widget.className='tool-widget';doc.body.appendChild(widget);
  widget.innerHTML=fixtureMarkup(lang);
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.getElementsByName=name=>descendants(doc).filter(el=>el.getAttribute('name')===name);
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);return false;};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(...args){persistCalls.push(['save',...args]);},load(){return {};}};
  const {tips,empty,rangeOptions,...clientT}=labels[lang]||labels.en;
 const globals={t:clientT,document:doc,Blob,File,TextEncoder,TextDecoder,URL:{createObjectURL(blob){const url='blob:memory-'+(++urlId);blobs.set(url,blob);return url;},revokeObjectURL(url){blobs.delete(url);}},Uint8Array,Uint8ClampedArray,ArrayBuffer,
   ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},
   MutationObserver:class{observe(){} disconnect(){}},matchMedia:()=>({addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>''}),requestAnimationFrame:fn=>globals.setTimeout(fn,16),cancelAnimationFrame:id=>globals.clearTimeout(id),
   MessageChannel:class{constructor(){this.port1={};this.port2={postMessage:()=>{const job={delivered:false,deliver:()=>{must(!job.delivered,'yield only once');job.delivered=true;this.port1.onmessage({data:null});}};yields.push(job);if(!controls.holdYield)queueMicrotask(job.deliver);}};}},
   _slug:slugs[key],ztPersist:persist,trackTool(...a){tracks.push(a);},performance:{now:()=>performance.now()},
   ClipboardItem:class{constructor(data){this.data=data;}},navigator:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value});return d.promise;},write(value){const d=deferred();clipboard.push({...d,value});return d.promise;}}},
   setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  const stub=globals.navigator.clipboard;
  globals.navigator=Object.create({get clipboard(){nativeClipboard.getter++;return {writeText(){nativeClipboard.write++;throw Error('Native clipboard forbidden');}};}});
  Object.defineProperty(globals.navigator,'clipboard',{configurable:true,writable:true,value:stub});
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:slugs[key]},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(paths[key],{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,key+' ID '+id);return el;};
  return{get,doc,widget,globals,nativeClipboard,clipboard,timers,persistCalls,execCalls,tracks,downloads,encodes,yields,controls,actual,
   file(file){const input=get('gs-file');input.files=[file];input.value='C:\\fakepath\\'+file.name;input.dispatch('change');},
   drop(file){get('gs-wrap').dispatch('drop',{dataTransfer:{files:[file]}});},
   ctrlL(id,key='l',meta=false){get(id).focus();return get(id).dispatch('keydown',{key,ctrlKey:!meta,metaKey:meta});},
   change(id,value){get(id).value=value;get(id).dispatch('change');},
   tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}
const gifBytes=buildGif({width:2,height:2,gct:[255,0,0,0,255,0],frames:[{width:2,height:2,indices:[0,0,0,0],delayCs:10},{width:2,height:2,indices:[1,1,1,1],delayCs:20}]});
const gifFile=(name='old.gif')=>new File([gifBytes],name,{type:'image/gif'});
const limitBytes=new Uint8Array(gifBytes);limitBytes[6]=0xff;limitBytes[7]=0x7f;
const limitFile=()=>new File([limitBytes],'limit.gif',{type:'image/gif'});
const badFile=()=>new File(['not image'],'bad.txt',{type:'text/plain'});
function heldFile(file){const read=file.arrayBuffer.bind(file),d=deferred();let ready=false;Object.defineProperty(file,'arrayBuffer',{value:async()=>{const bytes=await read();ready=true;await d.promise;return bytes;}});return{file,release:d.resolve,ready:()=>ready};}
async function rgbaOf(blob){return [...await sharp(Buffer.from(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer()];}
function zipEntries(buffer){const bytes=Buffer.from(buffer),out=[];let off=0;while(bytes.readUInt32LE(off)===0x04034b50){const size=bytes.readUInt32LE(off+18),nl=bytes.readUInt16LE(off+26),xl=bytes.readUInt16LE(off+28),start=off+30+nl+xl;out.push({name:bytes.subarray(off+30,off+30+nl).toString(),data:bytes.subarray(start,start+size)});off=start+size;}return out;}
const snap=p=>({workspace:p.get('gs-workspace').hidden,frames:p.get('gs-grid').querySelectorAll('.gs-cell').length,status:p.get('gs-status').textContent,busy:p.get('gs-zip').disabled,sprite:p.get('gs-sprite-out').hidden,json:p.get('gs-sprite-json').value});
async function load(p,name='old.gif'){const n=p.tracks.length;p.file(gifFile(name));await waitFor(()=>p.tracks.length>n);await settle();must(p.get('gs-grid').querySelectorAll('.gs-cell').length===2,'real two-frame GIF decoded');}
async function limit(p){p.file(limitFile());await waitFor(()=>!p.get('gs-limit').hidden);}
async function sprite(p){p.get('gs-sprite-build').click();await waitFor(()=>!p.get('gs-sprite-out').hidden);}
await scene('golden',async()=>{
 const p=page();await load(p);check(phase+'/real-parser-and-compositor',[[255,0,0,255],[0,255,0,255]],p.get('gs-grid').querySelectorAll('canvas').map(c=>[...c.rgba.slice(0,4)]));check(phase+'/duration','0.30 s',p.get('gs-info-duration').textContent);
 p.get('gs-grid').querySelector('.gs-cell-dl').click();await waitFor(()=>p.downloads.length===1);check(phase+'/PNG-name','old-frame-001.png',p.downloads[0].name);check(phase+'/complete-encoded-PNG',Array(4).fill([255,0,0,255]).flat(),await rgbaOf(p.downloads[0].blob));
 p.get('gs-zip').click();await waitFor(()=>p.downloads.length===2);const entries=zipEntries(await p.downloads[1].blob.arrayBuffer());check(phase+'/ZIP-names',['old-frame-001.png','old-frame-002.png'],entries.map(e=>e.name));check(phase+'/ZIP-complete-bytes',await Promise.all(p.encodes.slice(1).map(async e=>sha(new Uint8Array(await e.blob.arrayBuffer())))),entries.map(e=>sha(e.data)));
 await sprite(p);p.get('gs-sprite-png').click();const meta=await sharp(Buffer.from(await p.downloads.at(-1).blob.arrayBuffer())).metadata();check(phase+'/sprite-dimensions',[4,2],[meta.width,meta.height]);p.get('gs-sprite-json-dl').click();check(phase+'/complete-JSON',p.get('gs-sprite-json').value,await p.downloads.at(-1).blob.text());p.get('gs-reset').click();check(phase+'/reset',[true,0,'',false,true,''],Object.values(snap(p)));
});
for(const order of ['shared-before','shared-after'])for(const meta of [false,true])await scene('clear/'+order+'/'+meta,async()=>{
 const p=page(order);await load(p);await sprite(p);p.change('gs-format','jpg');p.change('gs-columns','1');p.get('gs-file').value='C:\\fakepath\\old.gif';p.ctrlL('gs-zip','L',meta);await settle();check(phase+'/all-results-cleared',[true,0,'',false,true,''],Object.values(snap(p)));check(phase+'/file-cleared','',p.get('gs-file').value);check(phase+'/settings-kept',['jpg','1'],[p.get('gs-format').value,p.get('gs-columns').value]);check(phase+'/shared-clear-once',1,p.persistCalls.filter(v=>v[0]==='clear').length);
 const q=page(order),slow=heldFile(gifFile('late.gif'));q.file(slow.file);await waitFor(slow.ready);q.ctrlL('gs-drop','l',meta);slow.release();await settle();check(phase+'/late-read-ignored',[true,0,''],[q.get('gs-workspace').hidden,q.get('gs-grid').querySelectorAll('.gs-cell').length,q.get('gs-status').textContent]);
 q.controls.holdYield=true;q.file(gifFile('slice.gif'));await waitFor(()=>q.yields.some(j=>!j.delivered));const held=q.yields.find(j=>!j.delivered);q.ctrlL('gs-drop','l',meta);const before=snap(q);held.deliver();await settle();check(phase+'/late-decode-slice-ignored',before,snap(q));
});
await scene('existing-load-and-ZIP-reset-guards',async()=>{
 const p=page(),slow=heldFile(gifFile('old.gif'));p.file(slow.file);await waitFor(slow.ready);await load(p,'new.gif');const before=snap(p);slow.release();await settle();check(phase+'/new-source-keeps-current',before,snap(p));
 p.controls.holdEncode=true;p.get('gs-zip').click();await waitFor(()=>p.encodes[0]?.ready);p.get('gs-reset').click();p.encodes[0].deliver();await settle();check(phase+'/ZIP-cancelled-on-reset',[0,'',false],[p.downloads.length,p.get('gs-status').textContent,p.get('gs-zip').disabled]);
});
for(const action of ['reset','new-source'])await scene('single-frame-snapshot/'+action,async()=>{
 const p=page();await load(p);p.controls.holdEncode=true;p.get('gs-grid').querySelector('.gs-cell-dl').click();await waitFor(()=>p.encodes[0]?.ready);
 if(action==='reset')p.get('gs-reset').click();else await load(p,'new.gif');const before=snap(p);p.encodes[0].deliver();await settle();check(phase+'/name','old-frame-001.png',p.downloads[0].name);check(phase+'/original-encoded-bytes',Array(4).fill([255,0,0,255]).flat(),await rgbaOf(p.downloads[0].blob));check(phase+'/new-state-not-written',before,snap(p));
});
for(const kind of ['frame','zip'])await scene('export-options-snapshot/'+kind,async()=>{
 const p=page();await load(p);p.controls.holdEncode=true;(kind==='frame'?p.get('gs-grid').querySelector('.gs-cell-dl'):p.get('gs-zip')).click();await waitFor(()=>p.encodes[0]?.ready);p.change('gs-format','jpg');p.get('gs-quality').value='60';p.get('gs-quality').dispatch('input');p.controls.holdEncode=false;p.encodes[0].deliver();await waitFor(()=>p.downloads.length===1);
 if(kind==='frame')check(phase+'/extension','old-frame-001.png',p.downloads[0].name);else{const entries=zipEntries(await p.downloads[0].blob.arrayBuffer());check(phase+'/names',['old-frame-001.png','old-frame-002.png'],entries.map(e=>e.name));check(phase+'/single-format',['png','png'],await Promise.all(entries.map(async e=>(await sharp(e.data).metadata()).format)));}
});
await scene('sprite-old-completion-versus-new-decode',async()=>{
 const p=page();await load(p);p.controls.holdEncode=true;p.get('gs-sprite-build').click();await waitFor(()=>p.encodes[0]?.ready);p.controls.holdYield=true;p.drop(gifFile('new.gif'));await waitFor(()=>p.yields.some(j=>!j.delivered));const held=p.yields.find(j=>!j.delivered);must(p.get('gs-zip').disabled,'actual new decode busy');const before=snap(p);p.encodes[0].deliver();await settle();check(phase+'/new-decode-busy-preserved',before,snap(p));held.deliver();await settle();
});
for(const lang of ['en','zh','ja','ko'])await scene('copy/'+lang,async()=>{
 const t=labels[lang],p=page('shared-after',lang);await limit(p);p.get('gs-limit-copy').click();check(phase+'/complete-command','ffmpeg -i input.gif -fps_mode passthrough frame-%03d.png',p.clipboard[0].value);p.clipboard[0].reject(Error('denied'));await settle();check(phase+'/current-error',t.statusCopyFailed,p.get('gs-status').textContent);p.get('gs-limit-copy').click();p.clipboard[1].resolve();await settle();check(phase+'/retry-success',t.copied,p.get('gs-limit-copy').textContent);check(phase+'/retry-clears-owned-error','',p.get('gs-status').textContent);
 const timer=[...p.timers.values()].find(v=>v.ms===1500);p.tick(100);p.get('gs-limit-copy').click();p.clipboard[2].resolve();await settle();timer.fn();check(phase+'/forced-old-timer-ignored',t.copied,p.get('gs-limit-copy').textContent);p.tick(1400);check(phase+'/old-deadline-keeps-new-feedback',t.copied,p.get('gs-limit-copy').textContent);p.tick(100);check(phase+'/new-deadline-restores',t.copyCommand,p.get('gs-limit-copy').textContent);
 for(const outcome of ['resolve','reject']){const q=page('shared-after',lang);await limit(q);q.get('gs-limit-copy').click();await load(q,'new.gif');await sprite(q);q.get('gs-sprite-copy').click();const value=q.get('gs-sprite-json').value;check(phase+'/'+outcome+'-JSON-complete',value,q.clipboard[1].value);q.clipboard[1].resolve();await settle();const before=snap(q);q.clipboard[0][outcome](outcome==='reject'?Error('late'):undefined);await settle();check(phase+'/'+outcome+'-cross-button-new-state-kept',before,snap(q));check(phase+'/'+outcome+'-old-label-reset',t.copyCommand,q.get('gs-limit-copy').textContent);q.get('gs-select-none').click();check(phase+'/'+outcome+'-hidden-sprite-label-reset',t.copyJson,q.get('gs-sprite-copy').textContent);}
 for(const mode of ['missing','sync-throw']){const q=page('shared-after',lang);await limit(q);let native=0;const n=Object.create({get clipboard(){native++;throw Error('native accessed');}});Object.defineProperty(n,'clipboard',{value:mode==='missing'?undefined:{writeText(){throw Error('sync');}},writable:true});q.actual.ctx.navigator=n;q.get('gs-limit-copy').click();await settle();check(phase+'/'+mode+'-error',t.statusCopyFailed,q.get('gs-status').textContent);check(phase+'/'+mode+'-native-access-zero',0,native);}
});


// V2 page checks are local to GIF Splitter. Geometry and compiled HTML belong to browser QA.
for(const lang of ['en','zh','ja','ko'])await scene('v2-SSR/'+lang,async()=>{
 const p=page('shared-after',lang),t=labels[lang];
 check(phase+'/initial-aria',t.dropAria,p.get('gs-file').getAttribute('aria-label'));
 check(phase+'/initial-button',t.reset,p.get('gs-reset').textContent);
 check(phase+'/initial-copy',t.copyJson,p.get('gs-sprite-copy').textContent);
 check(phase+'/empty-copy',t.empty,p.widget.querySelector('.gs-empty').textContent);
 check(phase+'/11-localized-tip-panels',['file','zip','format','selection','range','quality','background','columns','spacing','sprite','json'].map(k=>t.tips[k]),p.widget.querySelectorAll('.zt-tip-pop').map(v=>v.textContent));
 check(phase+'/tips-excluded-from-client',false,Object.hasOwn(p.actual.ctx.t,'tips'));
 check(phase+'/root-is-direct-flex-target','gs-wrap',p.widget.children[0].id);
 check(phase+'/two-secondary-details',2,p.widget.querySelectorAll('details').length);
 check(phase+'/secondary-details-closed',true,p.widget.querySelectorAll('details').every(v=>v.getAttribute('open')===null));
 check(phase+'/grid-keyboard-focus','0',p.get('gs-grid').getAttribute('tabindex'));
 check(phase+'/native-clipboard-zero',{getter:0,write:0},p.nativeClipboard);
 await load(p);check(phase+'/decoded-label',t.statusDecoded.replace('{n}','2'),p.get('gs-status').textContent);
 p.get('gs-from').value='2';p.get('gs-to').value='1';p.get('gs-step').value='2';p.get('gs-range-apply').click();
 check(phase+'/range-still-applied',[true,false],p.get('gs-grid').querySelectorAll('.gs-thumb').map(v=>v.getAttribute('aria-pressed')==='true'));
 p.get('gs-from').value='2';p.get('gs-to').value='';p.get('gs-step').value='';p.get('gs-range-apply').click();
 check(phase+'/range-blank-end-and-step-defaults',[false,true],p.get('gs-grid').querySelectorAll('.gs-thumb').map(v=>v.getAttribute('aria-pressed')==='true'));
 p.get('gs-select-all').click();p.change('gs-columns','1');p.change('gs-spacing','3');await sprite(p);
 check(phase+'/sprite-JSON-real-values',[2,7,1,3],['width','height','columns','spacing'].map(k=>JSON.parse(p.get('gs-sprite-json').value)[k]));
 p.get('gs-reset').click();check(phase+'/reset-empty-results',[true,0,'',false,true,''],Object.values(snap(p)));
 check(phase+'/native-clipboard-stays-zero',{getter:0,write:0},p.nativeClipboard);
});
await scene('v2-source-contract',async()=>{
 const css=source.gif.split('<style is:global>')[1];
 check(phase+'/root-min-height-zero',true,/\.gs-wrap \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0;/.test(css));
 check(phase+'/shared-rail',true,source.gif.includes('class="gs-rail zt-rail"'));
 check(phase+'/270-300-rail',true,css.includes('grid-template-columns: minmax(270px, 300px) minmax(0, 1fr)'));
 check(phase+'/bounded-frame-result',true,/\.gs-grid \{[^}]*flex: 1 1 0;[^}]*overflow: auto;/.test(css));
 check(phase+'/reserved-status',true,/#gs-status \{[^}]*min-height: 4\.2em;/.test(css));
 check(phase+'/mobile-stack-and-hide-empty',true,/@media \(max-width: 860px\) \{[\s\S]*?\.gs-result:has\(#gs-workspace\[hidden\]\) \{ display: none; \}/.test(css));
 check(phase+'/phone-dense-controls',true,/\.gs-select-row \.btn-ghost \{ min-height: 24px;/.test(css)&&/\.gs-range-row \.gs-num \{ min-height: 24px;/.test(css));
 check(phase+'/primary44-shared',true,/\.btn-copy,\s*\.tool-input \{\s*min-height: 44px;/.test(readFileSync(join(ROOT,'src/styles/tool-common.css'),'utf8')));
 check(phase+'/status-before-secondary-and-result',true,source.gif.indexOf('id="gs-status"')<source.gif.indexOf('id="gs-selected-count"')&&source.gif.indexOf('id="gs-status"')<source.gif.indexOf('id="gs-workspace"'));
 check(phase+'/no-runtime-translation',false,/data-i18n|var STRINGS|document\.documentElement\.lang/.test(source.gif));
 const keys=Object.keys(labels.en),tipKeys=Object.keys(labels.en.tips);
 for(const lang of ['zh','ja','ko']){check(phase+'/'+lang+'-same-keys',keys,Object.keys(labels[lang]));check(phase+'/'+lang+'-same-tip-keys',tipKeys,Object.keys(labels[lang].tips));}
 const yaml=require('js-yaml');
 for(const lang of ['en','zh','ja','ko']){
  const path=process.env.ZT_B14_CONTENT_PREFIX?process.env.ZT_B14_CONTENT_PREFIX+lang+'.mdx':join(ROOT,'src/content/tools/gif-splitter',lang+'.mdx');
  const mdx=readFileSync(path,'utf8'),meta=yaml.load(mdx.match(/^---\n([\s\S]*?)\n---/)[1]);
  check(phase+'/'+lang+'-6-steps',6,meta.steps?.length);
  check(phase+'/'+lang+'-step-bounds',true,meta.steps.every(v=>v.length<=280)&&meta.steps.join('').length<=1200);
  check(phase+'/'+lang+'-FAQ-kept',5,meta.faqItems.length);
  check(phase+'/'+lang+'-Usage-removed',false,/^## (How to Use|使用步骤|使い方|사용 방법)$/m.test(mdx));
 }
 const registry=readFileSync(join(ROOT,'src/data/tool-layouts.ts'),'utf8');
 if(/['"]gif-splitter['"]\s*:\s*['"]generate['"]/.test(registry))check(phase+'/generate-registration',true,true);
 else if(process.env.ZT_B14_SOURCE)console.log('PENDING gif-splitter generate registry adoption (excluded from PASS)');
 else check(phase+'/generate-registration',true,false);
});

await settle();check('no-unhandled-rejections',[],unhandled);process.removeListener('unhandledRejection',onRejection);
const pageCounts={PASS:checks.filter(c=>c.status==='PASS').length,FAIL:checks.filter(c=>c.status==='FAIL').length};
passes+=pageCounts.PASS;failures+=pageCounts.FAIL;
const report={node:process.version,source:process.env.ZT_B14_SOURCE||paths[Object.keys(paths)[0]],sourceSHA:sha(pageSource),legacyCounts,pageCounts,counts:{PASS:passes,FAIL:failures},checks,observations};
if(process.env.ZT_B14_REPORT){const {writeFileSync}=await import('node:fs');writeFileSync(process.env.ZT_B14_REPORT,JSON.stringify(report,null,2)+'\n');}
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode=failures?1:0;
