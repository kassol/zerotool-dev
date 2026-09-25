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
// and JSON; CRC32 and the STORED ZIP writer (parsed back, plus `unzip -t` if present).
//
// The GIF fixtures are built in this file with an independent LZW encoder.
//
// Run: node scripts/test-gif-splitter.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/GifSplitterTool.astro'), 'utf8');

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
return { GS_LIMITS, isGif, parseGif, lzwDecode, interlaceRows, createCompositor, frameDurationMs,
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
function subBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
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
function decodeAll(bytes) {
  const gif = E.parseGif(bytes);
  const comp = E.createCompositor(gif);
  const out = [];
  let f;
  while ((f = comp.next())) out.push(f);
  return { gif, frames: out };
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
  const res = E.lzwDecode(minCodeSize, data, count);
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
  const res = E.lzwDecode(2, lzwEncode(2, indices), indices.length);
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
  const res = E.lzwDecode(2, Uint8Array.from([0xFF, 0xFF]), 4);
  check('LZW invalid first code stops without throwing', res.count === 0);
  const res2 = E.lzwDecode(9, Uint8Array.from([0]), 4);
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
  const partial = E.lzwDecode(2, data.slice(0, 2), w * h);
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

// ---------- summary ----------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
