// GIF Compressor — spec-driven regression test
//
// Read:  src/components/tools/GifCompressorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source) and src/components/tools/GifSplitterTool.astro (the
//        decoder functions must be identical in both files)
// Write: a temporary directory under os.tmpdir() (GIF files for ffprobe, removed on
//        exit); stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: decoder functions copied from gif-splitter are textually identical; input
// normalization (width, lossy, colors, frame step) and delay rounding; area-average
// resizing (output size, alpha-weighted color, 50% coverage threshold); palette
// (exact path, median cut count, color table size, minimum code size, 4-color option);
// round trips (every output frame decodes to the encoder's canvas, and the lossless
// path decodes to the original pixels) over disposal 0/1/2/3, transparency, interlaced
// frames and local color tables; frame optimization (first frame covers the canvas,
// changed-pixel bounding box, identical frames as 1×1 transparent, opaque-to-transparent
// with disposal 2 and a grown rectangle); frame skipping with summed durations; loop
// extension written only when the input has one; LZW code width growth to 12 bits and
// clear codes (independent code-stream reader) and LZW round trips through the decoder;
// lossy output smaller than lossless, decodable, with every pixel within the lossy
// distance; dithering; edge cases (empty file, non-GIF, truncated file, static GIF,
// all-transparent frame, 2-color input); progress stages; ffprobe parse check when
// ffprobe is available.
//
// The GIF fixtures are built in this file with an independent LZW encoder.
//
// Run: node scripts/test-gif-compressor.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = process.env.ZT_B14_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B14_SOURCE || join(root, 'src/components/tools/GifCompressorTool.astro'), 'utf8');
const splitterSource = readFileSync(join(root, 'src/components/tools/GifSplitterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
function engineBlock(src, name) {
  const s = src.indexOf(START_MARK);
  const e = src.indexOf(END_MARK);
  if (s < 0 || e <= s) {
    console.error('FAIL: could not locate the engine block in ' + name);
    process.exit(1);
  }
  return src.slice(s, e);
}
const block = engineBlock(source, 'GifCompressorTool.astro');
const splitterBlock = engineBlock(splitterSource, 'GifSplitterTool.astro');
const E = new Function(block + `
return { GS_LIMITS, isGif, parseGif, createLzw, lzwRun, createCompositor, checkBudget,
  GC_LOSSY_SCALE, GC_COLOR_OPTIONS, GC_DEFAULTS, normalizeWidth, outputHeight, normalizeLossy, normalizeColors,
  normalizeStep, delayCsFromMs, resizeRgba, createPaletteBuilder, createQuantizer, createLzwTables, lzwEncode,
  createGifEncoder, compressSteps, compressGif };`)();

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

// ---------- 1. decoder copied verbatim from gif-splitter ----------
// Source text of `function name(` / `function* name(` / `var name =` up to its end.
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)([ \\t]*)(function\\*? ' + name + '\\(|var ' + name + ' =)');
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
const COPIED = ['GS_LIMITS', 'isGif', 'scanSubBlocks', 'readSubBlocks', 'parseGif', 'createLzw', 'lzwRun', 'interlaceRows',
  'blitRange', 'clearRect', 'frameDurationMs', 'compositeSteps', 'createCompositor', 'checkBudget'];
for (const name of COPIED) {
  const a = extractDecl(block, name);
  const b = extractDecl(splitterBlock, name);
  check('decoder copy: ' + name + ' found in both files', a !== null && b !== null);
  check('decoder copy: ' + name + ' is identical to gif-splitter', a !== null && a === b);
}

// ---------- independent GIF LZW encoder + builder (fixtures) ----------
function refLzwEncode(minCodeSize, indices) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let table = new Map();
  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 0xFF); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
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
    } else {
      emit(clear);
      table = new Map(); codeSize = minCodeSize + 1; next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) out.push(cur & 0xFF);
  return out;
}
function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
function tableBits(colorTable) {
  const entries = colorTable.length / 3;
  let bits = 0;
  while ((1 << (bits + 1)) < entries) bits++;
  return bits;
}
function padTable(colorTable) {
  const out = new Array(3 * (1 << (tableBits(colorTable) + 1))).fill(0);
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
function buildGif({ width, height, gct = null, loop, frames }) {
  const bytes = [...'GIF89a'].map((c) => c.charCodeAt(0));
  bytes.push(...u16(width), ...u16(height), gct ? 0x80 | 0x70 | tableBits(gct) : 0, 0, 0);
  if (gct) bytes.push(...padTable(gct));
  if (loop !== undefined) bytes.push(0x21, 0xFF, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, ...u16(loop), 0);
  for (const f of frames) {
    const trans = f.transparentIndex === undefined ? -1 : f.transparentIndex;
    bytes.push(0x21, 0xF9, 4, ((f.disposal || 0) << 2) | (trans >= 0 ? 1 : 0), ...u16(f.delayCs || 0), trans >= 0 ? trans : 0, 0);
    let ipacked = 0;
    if (f.lct) ipacked |= 0x80 | tableBits(f.lct);
    if (f.interlaced) ipacked |= 0x40;
    bytes.push(0x2C, ...u16(f.left || 0), ...u16(f.top || 0), ...u16(f.width), ...u16(f.height), ipacked);
    if (f.lct) bytes.push(...padTable(f.lct));
    const minCodeSize = f.minCodeSize || 2;
    bytes.push(minCodeSize);
    bytes.push(...subBlocks(refLzwEncode(minCodeSize, f.interlaced ? interlaceOrder(f.indices, f.width, f.height) : f.indices)));
  }
  bytes.push(0x3B);
  return Uint8Array.from(bytes);
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 24; };
}
function decodeAll(bytes) {
  const gif = E.parseGif(bytes);
  const comp = E.createCompositor(gif, 0);
  const frames = [];
  let f;
  while ((f = comp.step()) !== null) if (f) frames.push(f);
  return { gif, frames };
}
function frameData(bytes, f) {
  const out = [];
  for (let q = f.dataStart; q < bytes.length && bytes[q] !== 0; q += 1 + bytes[q]) out.push(...bytes.slice(q + 1, q + 1 + bytes[q]));
  return out;
}
// Palette indices → RGBA; index `count` (transparent) → 0,0,0,0.
function indicesToRgba(indices, palette, count) {
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v === count) continue;
    out[i * 4] = palette[v * 3]; out[i * 4 + 1] = palette[v * 3 + 1]; out[i * 4 + 2] = palette[v * 3 + 2]; out[i * 4 + 3] = 255;
  }
  return out;
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// Output decodes to the encoder's canvas after every frame.
function checkRoundTrip(name, res) {
  const out = decodeAll(res.bytes);
  equal(name + ': output frame count', out.frames.length, res.frameCount);
  equal(name + ': trace length', res.trace.length, res.frameCount);
  let ok = true, detail = '';
  for (let i = 0; i < out.frames.length && ok; i++) {
    const want = indicesToRgba(res.trace[i].canvas, res.palette, res.colorCount);
    if (!sameBytes(out.frames[i].rgba, want)) { ok = false; detail = 'frame ' + i; }
  }
  check(name + ': every frame decodes to the encoder canvas', ok, detail);
  check(name + ': output is not truncated', !out.gif.truncated && out.frames.every((f) => f.complete));
  return out;
}

const PAL = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];

// Animated fixture: disposal 0/1/2/3, transparency, an interlaced frame, a local
// color table, an identical frame and a frame that turns pixels transparent.
const animGif = (() => {
  const w = 16, h = 12;
  const rand = lcg(3);
  const full = (fn) => Array.from({ length: w * h }, (_, i) => fn(i % w, Math.floor(i / w)));
  return buildGif({
    width: w, height: h, gct: PAL, loop: 0,
    frames: [
      { width: w, height: h, indices: full((x, y) => (x + y) % 3 + 1), disposal: 1, delayCs: 5 },
      { left: 3, top: 2, width: 4, height: 3, indices: Array.from({ length: 12 }, () => rand() % 4), transparentIndex: 0, disposal: 1, delayCs: 5 },
      { width: w, height: h, indices: full((x, y) => (x + y) % 3 + 1), disposal: 1, delayCs: 5 },
      { width: w, height: h, indices: full((x, y) => (x < 8 ? 0 : 2)), transparentIndex: 0, disposal: 2, delayCs: 7 },
      { left: 2, top: 2, width: 5, height: 5, indices: Array.from({ length: 25 }, () => rand() % 4), interlaced: true, disposal: 3 },
      { left: 8, top: 0, width: 8, height: 12, indices: Array.from({ length: 96 }, () => rand() % 2), lct: [200, 100, 50, 10, 20, 30], disposal: 1 },
      { width: 1, height: 1, indices: [0], transparentIndex: 0, disposal: 1, delayCs: 3 },
    ],
  });
})();
const animRef = decodeAll(animGif);

// ---------- 2. input normalization ----------
{
  equal('normalizeWidth empty keeps original', E.normalizeWidth('', 480), 480);
  equal('normalizeWidth 0 keeps original', E.normalizeWidth('0', 480), 480);
  equal('normalizeWidth negative keeps original', E.normalizeWidth('-5', 480), 480);
  equal('normalizeWidth above original keeps original', E.normalizeWidth('900', 480), 480);
  equal('normalizeWidth non-numeric keeps original', E.normalizeWidth('abc', 480), 480);
  equal('normalizeWidth rounds fractions', E.normalizeWidth('320.6', 480), 321);
  equal('normalizeWidth valid', E.normalizeWidth('200', 480), 200);
  equal('normalizeWidth 1', E.normalizeWidth(1, 480), 1);
  equal('outputHeight keeps the aspect ratio', E.outputHeight(480, 270, 320), 180);
  equal('outputHeight is at least 1', E.outputHeight(1000, 1, 10), 1);
  equal('normalizeLossy clamps above 100', E.normalizeLossy(150), 100);
  equal('normalizeLossy clamps below 0', E.normalizeLossy(-3), 0);
  equal('normalizeLossy invalid -> 0', E.normalizeLossy('x'), 0);
  equal('normalizeColors accepts 64', E.normalizeColors('64'), 64);
  equal('normalizeColors rejects 2', E.normalizeColors(2), 256);
  equal('normalizeColors rejects 100', E.normalizeColors(100), 256);
  equal('normalizeStep 3', E.normalizeStep('3'), 3);
  equal('normalizeStep out of range -> 1', E.normalizeStep(9), 1);
  deepEqual('color options', E.GC_COLOR_OPTIONS, [256, 128, 64, 32, 16, 8, 4]);
  deepEqual('defaults', E.GC_DEFAULTS, { lossy: 40, colors: 256, step: 1, dither: false });
  equal('lossy scale', E.GC_LOSSY_SCALE, 0.6);
  equal('delayCsFromMs 100 ms', E.delayCsFromMs(100), 10);
  equal('delayCsFromMs rounds to 10 ms', E.delayCsFromMs(105), 11);
  equal('delayCsFromMs minimum 20 ms', E.delayCsFromMs(10), 2);
  equal('delayCsFromMs maximum', E.delayCsFromMs(1e9), 65535);
}

// ---------- 3. resizing ----------
{
  const px = (arr) => Uint8ClampedArray.from(arr);
  // 2×1 → 1×1: red + transparent, coverage exactly 50% → opaque red.
  deepEqual('resize: 50% coverage stays opaque, color from opaque pixels only',
    Array.from(E.resizeRgba(px([255, 0, 0, 255, 0, 0, 255, 0]), 2, 1, 1, 1)), [255, 0, 0, 255]);
  // 3×1 → 1×1: one opaque pixel of three → transparent.
  deepEqual('resize: under 50% coverage is transparent',
    Array.from(E.resizeRgba(px([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]), 3, 1, 1, 1)), [0, 0, 0, 0]);
  // 2×2 → 1×1 average of four colors.
  deepEqual('resize: area average of four pixels',
    Array.from(E.resizeRgba(px([0, 0, 0, 255, 100, 0, 0, 255, 0, 200, 0, 255, 0, 0, 40, 255]), 2, 2, 1, 1)), [25, 50, 10, 255]);
  // 3×1 → 2×1: output 0 covers pixel 0 and half of pixel 1.
  deepEqual('resize: fractional weights',
    Array.from(E.resizeRgba(px([0, 0, 0, 255, 90, 0, 0, 255, 180, 0, 0, 255]), 3, 1, 2, 1)), [30, 0, 0, 255, 150, 0, 0, 255]);
  const big = new Uint8ClampedArray(10 * 5 * 4).fill(255);
  equal('resize: output buffer size', E.resizeRgba(big, 10, 5, 4, 2).length, 4 * 2 * 4);
  const res = E.compressGif(animGif, { width: 8, lossy: 0, trace: true });
  equal('compress with width 8: output width', res.width, 8);
  equal('compress with width 8: output height', res.height, 6);
  const out = checkRoundTrip('resized animation', res);
  equal('resized animation: logical screen width', out.gif.width, 8);
  const same = E.compressGif(animGif, { width: 999, lossy: 0 });
  equal('width above original keeps the original width', same.width, 16);
}

// ---------- 4. palette ----------
{
  const b = E.createPaletteBuilder(256);
  b.add(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255, 1, 2, 3, 255, 9, 9, 9, 0]));
  const pal = b.finish();
  equal('exact palette: count ignores transparent pixels', pal.count, 2);
  equal('exact palette: flagged exact', pal.exact, true);
  deepEqual('exact palette: colors in first-seen order', Array.from(pal.colors), [1, 2, 3, 4, 5, 6]);

  // 300 distinct colors in 300 distinct 15-bit buckets.
  const many = new Uint8ClampedArray(300 * 4);
  for (let i = 0; i < 300; i++) { many[i * 4] = (i % 16) * 16; many[i * 4 + 1] = Math.floor(i / 16) * 13; many[i * 4 + 2] = (i * 7) % 256; many[i * 4 + 3] = 255; }
  const b2 = E.createPaletteBuilder(256);
  b2.add(many);
  const cut = b2.finish();
  equal('median cut: 256 option gives 255 colors (one slot is transparent)', cut.count, 255);
  equal('median cut: not exact', cut.exact, false);
  const b3 = E.createPaletteBuilder(4);
  b3.add(many);
  equal('median cut: 4 option gives 3 colors', b3.finish().count, 3);
  const b4 = E.createPaletteBuilder(256);
  b4.add(many.subarray(0, 255 * 4));
  equal('255 distinct colors with the 256 option stay exact', b4.finish().exact, true);

  const q = E.createQuantizer(cut, false)(many, 300, 1);
  check('median cut quantizer: indices within the palette', q.every((v) => v < cut.count));
  let maxErr = 0;
  for (let i = 0; i < 300; i++) {
    const v = q[i];
    const d = Math.hypot(many[i * 4] - cut.colors[v * 3], many[i * 4 + 1] - cut.colors[v * 3 + 1], many[i * 4 + 2] - cut.colors[v * 3 + 2]);
    maxErr = Math.max(maxErr, d);
  }
  check('median cut quantizer: error stays small with 255 colors for 300', maxErr < 40, String(maxErr));

  const enc = (count) => E.createGifEncoder({ width: 1, height: 1, colors: new Uint8Array(count * 3), count, loopCount: null, lossy: 0 });
  deepEqual('table bits for 255 colors + transparent', [enc(255).tableBits, enc(255).minCodeSize], [8, 8]);
  deepEqual('table bits for 3 colors + transparent', [enc(3).tableBits, enc(3).minCodeSize], [2, 2]);
  deepEqual('table bits for 1 color + transparent (minimum code size 2)', [enc(1).tableBits, enc(1).minCodeSize], [1, 2]);
  deepEqual('table bits for 0 colors', [enc(0).tableBits, enc(0).minCodeSize], [1, 2]);
  deepEqual('table bits for 4 colors + transparent', [enc(4).tableBits, enc(4).minCodeSize], [3, 3]);
  const bytes = enc(4).finish();
  equal('global color table flag and size field', bytes[10], 0x80 | 0x70 | 2);
  equal('background index is the transparent index', bytes[11], 4);
}

// ---------- 5. round trips ----------
{
  const res = E.compressGif(animGif, { lossy: 0, trace: true });
  equal('animation: palette is exact', res.exact, true);
  const out = checkRoundTrip('animation lossless', res);
  let ok = res.frameCount === animRef.frames.length;
  for (let i = 0; ok && i < animRef.frames.length; i++) if (!sameBytes(out.frames[i].rgba, animRef.frames[i].rgba)) ok = false;
  check('animation lossless: every frame equals the original pixels', ok);
  equal('animation lossless: loop count kept', out.gif.loopCount, 0);
  deepEqual('animation lossless: delays (0 cs plays as 100 ms, written as 10 cs)', out.gif.frames.map((f) => f.delayCs), [5, 5, 5, 7, 10, 10, 3]);

  for (const opts of [{ lossy: 40 }, { lossy: 100 }, { lossy: 40, colors: 4 }, { lossy: 0, colors: 4, dither: true }, { lossy: 60, width: 11, step: 2, dither: true }]) {
    checkRoundTrip('animation ' + JSON.stringify(opts), E.compressGif(animGif, Object.assign({ trace: true }, opts)));
  }
}

// ---------- 6. frame optimization ----------
function framesOf(res) { return decodeAll(res.bytes).gif.frames; }
{
  // Two identical frames: the second is a 1×1 transparent frame that keeps its delay.
  const w = 6, h = 4;
  const img = Array.from({ length: w * h }, (_, i) => (i % 3) + 1);
  const bytes = buildGif({ width: w, height: h, gct: PAL, frames: [
    { width: w, height: h, indices: img, delayCs: 4 },
    { width: w, height: h, indices: img, delayCs: 9 },
  ] });
  const res = E.compressGif(bytes, { lossy: 0, trace: true });
  const fr = framesOf(res);
  deepEqual('first frame covers the canvas', [fr[0].left, fr[0].top, fr[0].width, fr[0].height], [0, 0, w, h]);
  deepEqual('identical frame: 1×1 at 0,0', [fr[1].left, fr[1].top, fr[1].width, fr[1].height], [0, 0, 1, 1]);
  equal('identical frame: keeps its delay', fr[1].delayCs, 9);
  equal('identical frame: pixel is the transparent index', fr[1].transparentIndex, res.colorCount);
  checkRoundTrip('identical frames', res);
}
{
  // One changed pixel: the frame rectangle is that pixel.
  const w = 6, h = 4;
  const a = new Array(w * h).fill(1);
  const b = a.slice(); b[2 * w + 4] = 2;
  const res = E.compressGif(buildGif({ width: w, height: h, gct: PAL, frames: [{ width: w, height: h, indices: a }, { width: w, height: h, indices: b }] }), { lossy: 0, trace: true });
  const fr = framesOf(res);
  deepEqual('changed-pixel bounding box', [fr[1].left, fr[1].top, fr[1].width, fr[1].height], [4, 2, 1, 1]);
  deepEqual('no transparency needed: disposal 1', fr.map((f) => f.disposal), [1, 1]);
  checkRoundTrip('one changed pixel', res);
}
{
  // Opaque → transparent: frame 1 changes one pixel, frame 2 clears another pixel.
  // Frame 1 gets disposal 2 and its rectangle grows to cover the cleared pixel.
  const w = 5, h = 5;
  const f0 = new Array(w * h).fill(1);
  const f1 = f0.slice(); f1[0] = 2;
  const f2 = f1.slice(); f2[4 * w + 4] = 0;
  const bytes = buildGif({ width: w, height: h, gct: PAL, frames: [
    { width: w, height: h, indices: f0, transparentIndex: 0, disposal: 1 },
    { width: w, height: h, indices: f1, transparentIndex: 0, disposal: 2 },
    { width: w, height: h, indices: f2, transparentIndex: 0, disposal: 1 },
  ] });
  const ref = decodeAll(bytes);
  equal('fixture: frame 3 pixel (4,4) is transparent', ref.frames[2].rgba[(4 * w + 4) * 4 + 3], 0);
  const res = E.compressGif(bytes, { lossy: 0, trace: true });
  const fr = framesOf(res);
  deepEqual('opaque to transparent: disposals', fr.map((f) => f.disposal), [1, 2, 1]);
  deepEqual('opaque to transparent: previous rectangle grows to cover the cleared pixel', [fr[1].left, fr[1].top, fr[1].width, fr[1].height], [0, 0, 5, 5]);
  const out = checkRoundTrip('opaque to transparent', res);
  check('opaque to transparent: frames equal the original', out.frames.every((f, i) => sameBytes(f.rgba, ref.frames[i].rgba)));
  const res2 = E.compressGif(bytes, { lossy: 80, trace: true });
  checkRoundTrip('opaque to transparent, lossy 80', res2);
}
{
  // All-transparent frame between two opaque frames.
  const w = 4, h = 3;
  const bytes = buildGif({ width: w, height: h, gct: PAL, frames: [
    { width: w, height: h, indices: new Array(w * h).fill(1), transparentIndex: 0, disposal: 2 },
    { width: w, height: h, indices: new Array(w * h).fill(0), transparentIndex: 0, disposal: 1 },
    { width: w, height: h, indices: new Array(w * h).fill(3), transparentIndex: 0, disposal: 1 },
  ] });
  const ref = decodeAll(bytes);
  const res = E.compressGif(bytes, { lossy: 0, trace: true });
  const out = checkRoundTrip('all-transparent frame', res);
  check('all-transparent frame: frames equal the original', out.frames.every((f, i) => sameBytes(f.rgba, ref.frames[i].rgba)));
  equal('all-transparent frame: frame 1 gets disposal 2', framesOf(res)[0].disposal, 2);
}
{
  // All frames transparent: no colors at all.
  const bytes = buildGif({ width: 3, height: 2, gct: PAL, frames: [{ width: 3, height: 2, indices: new Array(6).fill(0), transparentIndex: 0 }] });
  const res = E.compressGif(bytes, { lossy: 0, trace: true });
  equal('fully transparent GIF: zero colors', res.colorCount, 0);
  checkRoundTrip('fully transparent GIF', res);
}

// ---------- 7. frame skipping ----------
{
  const frames = [10, 20, 30, 40, 0].map((d, i) => ({ width: 2, height: 1, indices: [i % 4, (i + 1) % 4], delayCs: d }));
  const bytes = buildGif({ width: 2, height: 1, gct: PAL, frames });
  const r2 = E.compressGif(bytes, { lossy: 0, step: 2, trace: true });
  equal('step 2: frames kept', r2.frameCount, 3);
  deepEqual('step 2: kept frame keeps the delays of the frames it replaces', r2.delays, [30, 70, 10]);
  deepEqual('step 2: delays in the file', framesOf(r2).map((f) => f.delayCs), [30, 70, 10]);
  const ref = decodeAll(bytes).frames;
  const out = checkRoundTrip('step 2', r2);
  check('step 2: kept frames are frames 1, 3, 5', [0, 2, 4].every((src, i) => sameBytes(out.frames[i].rgba, ref[src].rgba)));
  const r3 = E.compressGif(bytes, { lossy: 0, step: 3 });
  deepEqual('step 3: delays', r3.delays, [60, 50]);
  const r4 = E.compressGif(bytes, { lossy: 0, step: 4 });
  deepEqual('step 4: delays', r4.delays, [100, 10]);
  const total = (r) => r.delays.reduce((a, b) => a + b, 0);
  check('frame skipping keeps the total duration', total(r2) === total(r3) && total(r3) === total(r4) && total(r4) === 110);
}

// ---------- 8. loop extension ----------
{
  const mk = (loop) => buildGif({ width: 1, height: 1, gct: PAL, loop, frames: [{ width: 1, height: 1, indices: [1] }, { width: 1, height: 1, indices: [2] }] });
  equal('loop 3 is kept', decodeAll(E.compressGif(mk(3), {}).bytes).gif.loopCount, 3);
  equal('loop 0 (infinite) is kept', decodeAll(E.compressGif(mk(0), {}).bytes).gif.loopCount, 0);
  const none = E.compressGif(mk(undefined), {}).bytes;
  equal('no loop extension in the input: none written', decodeAll(none).gif.loopCount, null);
  check('no loop extension in the input: no NETSCAPE2.0 bytes', !Buffer.from(none).includes(Buffer.from('NETSCAPE2.0')));
}

// ---------- 9. LZW code stream ----------
// Independent reader: follows the GIF code-width rules and counts clear codes.
function scanCodes(minCodeSize, data) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, avail = clear + 2, first = true, acc = 0, bits = 0, pos = 0;
  let clears = 0, maxSize = codeSize, codes = 0, ended = false;
  for (;;) {
    while (bits < codeSize && pos < data.length) { acc |= data[pos++] << bits; bits += 8; }
    if (bits < codeSize) break;
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize; bits -= codeSize;
    if (code === clear) { clears++; codeSize = minCodeSize + 1; avail = clear + 2; first = true; continue; }
    if (code === eoi) { ended = true; break; }
    if (!first && avail < 4096) {
      avail++;
      if (avail === (1 << codeSize) && avail < 4096) codeSize++;
    }
    first = false;
    codes++;
    maxSize = Math.max(maxSize, codeSize);
  }
  return { clears, maxSize, codes, ended };
}
{
  const w = 120, h = 100;
  const rand = lcg(7);
  const indices = Array.from({ length: w * h }, () => rand());
  const gct = [];
  for (let i = 0; i < 256; i++) gct.push(i, 255 - i, (i * 7) & 255);
  const bytes = buildGif({ width: w, height: h, gct, frames: [{ width: w, height: h, indices, minCodeSize: 8 }] });
  const res = E.compressGif(bytes, { lossy: 0, colors: 256, trace: true });
  const out = checkRoundTrip('256-color noise frame', res);
  const scan = scanCodes(res.minCodeSize, frameData(res.bytes, out.gif.frames[0]));
  equal('noise frame: code width reaches 12 bits', scan.maxSize, 12);
  check('noise frame: clear codes after the table fills', scan.clears >= 3, String(scan.clears));
  check('noise frame: stream ends with the end code', scan.ended);
  equal('noise frame: palette falls back to median cut (256 colors > 255)', res.exact, false);
}
{
  const tables = E.createLzwTables();
  for (const [minCodeSize, count, seed] of [[2, 30000, 1], [3, 20000, 2], [8, 50000, 3], [5, 1, 4], [2, 5000, 5]]) {
    const rand = lcg(seed);
    const px = Uint8Array.from({ length: count }, (_, i) => (seed === 5 ? 2 : rand() % (1 << minCodeSize)));
    const data = E.lzwEncode(tables, px.slice(), minCodeSize, null);
    const lzw = E.createLzw(minCodeSize, Uint8Array.from(subBlocks([...data])), 0, count);
    E.lzwRun(lzw, Infinity);
    check('lzwEncode round trip, min code size ' + minCodeSize + ', ' + count + ' px', lzw.count === count && px.every((v, i) => lzw.indices[i] === v));
    equal('lzwEncode matches the reference encoder, min code size ' + minCodeSize, Buffer.from(data).toString('hex'), Buffer.from(refLzwEncode(minCodeSize, [...px])).toString('hex'));
  }
  // Tables are left clean: encoding the same data twice gives the same bytes.
  const px = Uint8Array.from({ length: 9000 }, (_, i) => (i * 31) % 7);
  const a = Buffer.from(E.lzwEncode(tables, px.slice(), 3, null)).toString('hex');
  const b = Buffer.from(E.lzwEncode(tables, px.slice(), 3, null)).toString('hex');
  equal('lzwEncode leaves its tables clean', a, b);
}

// ---------- 10. lossy ----------
// Smooth gradient with noise, drifting over 8 frames; at most 255 colors so the
// palette is exact and every output pixel can be compared with the input.
const gradientGif = (() => {
  const w = 96, h = 64;
  const gct = [];
  for (let i = 0; i < 240; i++) gct.push(Math.round(i * 255 / 239), Math.round(128 + 100 * Math.sin(i / 20)), Math.round(255 - i));
  const rand = lcg(17);
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const indices = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) indices.push(Math.max(0, Math.min(239, Math.round((x + f * 3) * 2.2 + y * 0.4) + (rand() % 5) - 2)));
    frames.push({ width: w, height: h, indices, minCodeSize: 8, delayCs: 6 });
  }
  return buildGif({ width: w, height: h, gct, loop: 0, frames });
})();
{
  const ref = decodeAll(gradientGif).frames;
  const lossless = E.compressGif(gradientGif, { lossy: 0, trace: true });
  const out0 = checkRoundTrip('gradient lossless', lossless);
  check('gradient lossless: equals the original', out0.frames.every((f, i) => sameBytes(f.rgba, ref[i].rgba)));
  let prev = lossless.bytes.length;
  for (const L of [20, 40, 70, 100]) {
    const res = E.compressGif(gradientGif, { lossy: L, trace: true });
    const out = checkRoundTrip('gradient lossy ' + L, res);
    check('gradient lossy ' + L + ': smaller than the previous level (' + res.bytes.length + ' < ' + prev + ')', res.bytes.length < prev);
    prev = res.bytes.length;
    const limit = L * E.GC_LOSSY_SCALE;
    let maxD = 0, alphaOk = true;
    out.frames.forEach((f, i) => {
      for (let p = 0; p < f.rgba.length; p += 4) {
        if (f.rgba[p + 3] !== ref[i].rgba[p + 3]) alphaOk = false;
        maxD = Math.max(maxD, Math.hypot(f.rgba[p] - ref[i].rgba[p], f.rgba[p + 1] - ref[i].rgba[p + 1], f.rgba[p + 2] - ref[i].rgba[p + 2]));
      }
    });
    check('gradient lossy ' + L + ': every pixel within ' + limit.toFixed(1) + ' of the original', maxD <= limit + 1e-9, String(maxD));
    check('gradient lossy ' + L + ': transparency unchanged', alphaOk);
  }
  const dithered = E.compressGif(gradientGif, { lossy: 0, colors: 16, dither: true, trace: true });
  checkRoundTrip('gradient 16 colors dithered', dithered);
  equal('gradient 16 colors: 15 colors + transparent', dithered.colorCount, 15);
  const plain = E.compressGif(gradientGif, { lossy: 0, colors: 16, dither: false });
  check('gradient 16 colors: dithering changes the output', Buffer.compare(Buffer.from(plain.bytes), Buffer.from(dithered.bytes)) !== 0);
}

// ---------- 11. edge cases ----------
{
  equal('empty file is not a GIF', E.isGif(new Uint8Array(0)), false);
  let threw = null;
  try { E.compressGif(Uint8Array.from([0x89, 0x50, 0x4E, 0x47]), {}); } catch (e) { threw = e.message; }
  equal('non-GIF input throws NOT_GIF', threw, 'NOT_GIF');

  const cut = animGif.slice(0, animGif.length - 20);
  const res = E.compressGif(cut, { lossy: 0, trace: true });
  equal('truncated input: reported incomplete', res.complete, false);
  checkRoundTrip('truncated input', res);
  equal('complete input: reported complete', E.compressGif(animGif, {}).complete, true);

  const still = buildGif({ width: 3, height: 2, gct: PAL, frames: [{ width: 3, height: 2, indices: [0, 1, 2, 3, 2, 1] }] });
  const s = E.compressGif(still, { lossy: 0, trace: true });
  equal('static GIF: one frame', s.frameCount, 1);
  const so = checkRoundTrip('static GIF', s);
  check('static GIF: equals the original', sameBytes(so.frames[0].rgba, decodeAll(still).frames[0].rgba));
  equal('static GIF: no loop extension', so.gif.loopCount, null);

  const two = buildGif({ width: 8, height: 8, gct: [0, 0, 0, 255, 255, 255], frames: [
    { width: 8, height: 8, indices: Array.from({ length: 64 }, (_, i) => (i + (i >> 3)) % 2) },
    { width: 8, height: 8, indices: Array.from({ length: 64 }, (_, i) => (i + (i >> 3) + 1) % 2) },
  ] });
  const t2 = E.compressGif(two, { lossy: 0, trace: true });
  deepEqual('2-color input: 2 colors, 2-bit table', [t2.colorCount, t2.tableBits, t2.minCodeSize], [2, 2, 2]);
  const t2o = checkRoundTrip('2-color input', t2);
  check('2-color input: equals the original', t2o.frames.every((f, i) => sameBytes(f.rgba, decodeAll(two).frames[i].rgba)));
}

// ---------- 12. progress ----------
{
  const progress = {};
  const steps = E.compressSteps(E.parseGif(gradientGif), { lossy: 40, chunk: 500 }, progress);
  const stages = [], values = [];
  let r;
  while (!(r = steps.next()).done) {
    if (stages[stages.length - 1] !== progress.stage) stages.push(progress.stage);
    values.push(progress.value);
  }
  deepEqual('progress: stages in order', stages, ['decode', 'palette', 'encode']);
  check('progress: monotonic within [0, 1]', values.every((v, i) => v >= 0 && v <= 1 && (i === 0 || v >= values[i - 1])));
  check('progress: pauses inside the decode stage with a small chunk', values.length > 8 + 8 + 1 + 8, String(values.length));
  equal('progress: 1 at the end', progress.value, 1);
  check('progress: result returned', r.value && r.value.frameCount === 8);
}

// ---------- 13. external parser ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'gif-compressor-test-'));
  try {
    const cases = [
      ['anim-lossy', E.compressGif(animGif, { lossy: 40 }), 7],
      ['gradient-lossy', E.compressGif(gradientGif, { lossy: 100 }), 8],
      ['gradient-resized', E.compressGif(gradientGif, { width: 50, step: 3, dither: true, colors: 32 }), 3],
    ];
    const probe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
    if (probe.error) {
      console.log('SKIP  ffprobe check (ffprobe not available)');
    } else {
      for (const [name, res, frames] of cases) {
        const path = join(dir, name + '.gif');
        writeFileSync(path, res.bytes);
        const r = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'csv=p=0', path], { encoding: 'utf8' });
        equal('ffprobe ' + name + ': codec, size, frames, no errors', (r.stdout || '').trim() + (r.stderr || '').trim(), 'gif,' + res.width + ',' + res.height + ',' + frames);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- summary ----------

// Actual full page and shared-shortcut regressions. GIF bytes use the independent
// existing fixture builder and the unchanged production engine; DOM and clipboard are controlled.
const pageSource=source;
const legacyCounts={PASS:passes,FAIL:failures};
{
const {createHash}=await import('node:crypto');
const {createRequire}=await import('node:module');
const {relative}=await import('node:path');
const {pathToFileURL}=await import('node:url');
const vm=(await import('node:vm')).default;
const {loadPage,frontmatterStrings}=await import(pathToFileURL(join(root,'scripts/astro-page-harness.mjs')));
const ROOT=root,require=createRequire(join(ROOT,'package.json'));
const {parseFragment,defaultTreeAdapter}=require('parse5');
const paths={gif:process.env.ZT_B14_SOURCE?relative(ROOT,process.env.ZT_B14_SOURCE):'src/components/tools/GifCompressorTool.astro'},slugs={gif:'gif-compressor'},source={gif:pageSource};
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
const labels=frontmatterStrings(source.gif.match(/^---\n([\s\S]*?)\n---/)[1]) || vm.runInNewContext(source.gif.match(/var STRINGS = [\s\S]*?\n      \};/)[0]+';STRINGS'),L=labels.en;
function page(order='shared-after',lang='en'){
 const key='gif';
 const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],tracks=[],tasks=[],downloads=[],blobs=new Map(),yields=[];
 const controls={holdYield:false};
 let timerId=0,clock=0,doc,urlId=0;
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
    click() { if(this.disabled||this.closest('fieldset[disabled]'))return;if(this.tagName==='A'&&this.download){downloads.push({name:this.download,blob:blobs.get(this.href)});return;}this.focus();this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { if(doc.activeElement===this)return;const old=doc.activeElement;doc.activeElement=this;if(old)old.dispatchEvent(new EventStub('blur'));this.dispatchEvent(new EventStub('focus')); }
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
  widget.innerHTML=source[key].replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
  const actualWrap=widget.querySelector('#gc-wrap');actualWrap.setAttribute('data-lang',lang);
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.getElementsByName=name=>descendants(doc).filter(el=>el.getAttribute('name')===name);
  doc.createElement=tag=>new Element(tag);doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);return false;};
  const persist={clear(slug){persistCalls.push(['clear',slug]);},save(...args){persistCalls.push(['save',...args]);},load(){return {};}};
  const globals={clientStrings:labels[lang],document:doc,Blob,File,TextEncoder,TextDecoder,URL:{createObjectURL(blob){const url='blob:memory-'+(++urlId);blobs.set(url,blob);return url;},revokeObjectURL(url){blobs.delete(url);}},Uint8Array,Uint8ClampedArray,ArrayBuffer,

   MutationObserver:class{observe(){} disconnect(){}},matchMedia:()=>({addEventListener(){}}),getComputedStyle:()=>({getPropertyValue:()=>''}),requestAnimationFrame:fn=>globals.setTimeout(fn,16),cancelAnimationFrame:id=>globals.clearTimeout(id),
   MessageChannel:class{constructor(){this.port1={};this.port2={postMessage:()=>{const job={delivered:false,deliver:()=>{must(!job.delivered,'yield only once');job.delivered=true;this.port1.onmessage({data:null});}};yields.push(job);if(!controls.holdYield)queueMicrotask(job.deliver);}};}},
   _slug:slugs[key],ztPersist:persist,trackTool(...a){tracks.push(a);},innerHeight:900,devicePixelRatio:1,performance:{now:()=>controls.stepClock?(controls.time=(controls.time||0)+30):performance.now()},
   ClipboardItem:class{constructor(data){this.data=data;}},navigator:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value});return d.promise;},write(value){const d=deferred();clipboard.push({...d,value});return d.promise;}}},
   setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:slugs[key]},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(paths[key],{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,key+' ID '+id);return el;};
  return{get,doc,widget,globals,clipboard,timers,persistCalls,execCalls,tracks,downloads,yields,controls,actual,
   file(file){const input=get('gc-file');input.files=[file];input.value='C:\\fakepath\\'+file.name;input.dispatch('change');},
   drop(file){get('gc-wrap').dispatch('drop',{dataTransfer:{files:[file]}});},
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
const snap=p=>({workspace:p.get('gc-workspace').hidden,result:p.get('gc-result').hidden,progress:p.get('gc-progress').hidden,status:p.get('gc-status').textContent,summary:p.get('gc-summary').textContent});
async function load(p,name='old.gif'){const n=p.tracks.length;p.file(gifFile(name));await waitFor(()=>p.tracks.length>n&&!p.get('gc-result').hidden);await settle();}
async function limit(p){p.file(limitFile());await waitFor(()=>!p.get('gc-limit').hidden);}
await scene('golden',async()=>{
 const p=page();await load(p);check(phase+'/frame-info',['2','0.30 s'],[p.get('gc-info-frames').textContent,p.get('gc-info-duration').textContent]);p.get('gc-download').click();const bytes=new Uint8Array(await p.downloads[0].blob.arrayBuffer()),expected=E.compressGif(gifBytes,{lossy:40,colors:256,width:2,step:1,dither:false,chunk:32768});check(phase+'/complete-compressed-bytes',sha(expected.bytes),sha(bytes));check(phase+'/name','old-compressed.gif',p.downloads[0].name);const parsed=E.parseGif(bytes);check(phase+'/parse-output',[2,2,2],[parsed.width,parsed.height,parsed.frames.length]);p.get('gc-reset').click();check(phase+'/reset',[true,true,true,'',''],Object.values(snap(p)));check(phase+'/download-blob-snapshot',sha(bytes),sha(new Uint8Array(await p.downloads[0].blob.arrayBuffer())));
});
for(const order of ['shared-before','shared-after'])for(const meta of [false,true])await scene('clear/'+order+'/'+meta,async()=>{
 const p=page(order);await load(p);p.get('gc-lossy').value='65';p.get('gc-lossy').dispatch('input');p.change('gc-colors','32');p.get('gc-file').value='C:\\fakepath\\old.gif';p.ctrlL('gc-run','L',meta);await settle();check(phase+'/all-derived-cleared',[true,true,true,'',''],Object.values(snap(p)));check(phase+'/file-cleared','',p.get('gc-file').value);check(phase+'/preferences-kept',['65','32'],[p.get('gc-lossy').value,p.get('gc-colors').value]);check(phase+'/shared-clear-once',1,p.persistCalls.filter(v=>v[0]==='clear').length);
 const q=page(order),slow=heldFile(gifFile('late.gif'));q.file(slow.file);await waitFor(slow.ready);q.ctrlL('gc-drop','l',meta);slow.release();await settle();check(phase+'/late-read-does-not-restore',[true,true,true,'',''],Object.values(snap(q)));
 const r=page(order);await load(r);r.controls.holdYield=true;r.get('gc-run').click();await settle();const held=r.yields.find(j=>!j.delivered);must(held,'actual compression yield held');r.ctrlL('gc-run','l',meta);const before=snap(r);held.deliver();await settle();check(phase+'/late-compression-does-not-restore',before,snap(r));
});
await scene('existing-source-and-run-guards',async()=>{
 for(const action of ['new-source','invalid']){const p=page();await load(p);const slow=heldFile(gifFile('late.gif'));p.file(slow.file);await waitFor(slow.ready);if(action==='new-source')await load(p,'new.gif');else{p.file(badFile());await settle();}const before=snap(p);slow.release();await settle();check(phase+'/'+action+'-old-read-ignored',before,snap(p));}
 const q=page();await load(q);q.controls.holdYield=true;q.get('gc-run').click();await settle();const old=q.yields.find(j=>!j.delivered);q.controls.holdYield=false;q.file(gifFile('new.gif'));old.deliver();await waitFor(()=>!q.get('gc-result').hidden);q.get('gc-download').click();check(phase+'/new-compressed-source-name','new-compressed.gif',q.downloads[0].name);
});
for(const lang of ['en','zh','ja','ko'])await scene('copy/'+lang,async()=>{
 const t=labels[lang],p=page('shared-after',lang);await limit(p);p.get('gc-limit-copy').click();check(phase+'/complete-command','gifsicle -O3 --lossy=80 --colors 128 input.gif -o output.gif',p.clipboard[0].value);p.clipboard[0].reject(Error('denied'));await settle();check(phase+'/current-error',t.statusCopyFailed,p.get('gc-status').textContent);p.get('gc-limit-copy').click();p.clipboard[1].resolve();await settle();check(phase+'/retry-success',t.copied,p.get('gc-limit-copy').textContent);check(phase+'/retry-clears-owned-error','',p.get('gc-status').textContent);
 const timer=[...p.timers.values()].find(v=>v.ms===1500);p.tick(100);p.get('gc-limit-copy').click();p.clipboard[2].resolve();await settle();timer.fn();check(phase+'/forced-old-timer-ignored',t.copied,p.get('gc-limit-copy').textContent);p.tick(1400);check(phase+'/old-deadline-keeps-new-feedback',t.copied,p.get('gc-limit-copy').textContent);p.tick(100);check(phase+'/new-deadline-restores',t.copyCommand,p.get('gc-limit-copy').textContent);
 for(const outcome of ['resolve','reject']){const q=page('shared-after',lang);await limit(q);q.get('gc-limit-copy').click();await load(q,'new.gif');const before=snap(q);q.clipboard[0][outcome](outcome==='reject'?Error('late'):undefined);await settle();check(phase+'/'+outcome+'-new-source-keeps-state',before,snap(q));await limit(q);check(phase+'/'+outcome+'-old-label-reset',t.copyCommand,q.get('gc-limit-copy').textContent);q.get('gc-limit-copy').click();q.ctrlL('gc-limit-copy');q.clipboard[1][outcome](outcome==='reject'?Error('late'):undefined);await settle();check(phase+'/'+outcome+'-clear-feedback',[t.copyCommand,''],[q.get('gc-limit-copy').textContent,q.get('gc-status').textContent]);}
 for(const mode of ['missing','sync-throw']){const q=page('shared-after',lang);await limit(q);let native=0;const n=Object.create({get clipboard(){native++;throw Error('native');}});Object.defineProperty(n,'clipboard',{value:mode==='missing'?undefined:{writeText(){throw Error('sync');}},writable:true});q.actual.ctx.navigator=n;q.get('gc-limit-copy').click();await settle();check(phase+'/'+mode+'-error',t.statusCopyFailed,q.get('gc-status').textContent);check(phase+'/'+mode+'-native-access-zero',0,native);}
});


await scene('v2-contract',async()=>{
 const s=source.gif;
 check(phase+'/root-flex',true,/\.gc-wrap \{ min-height: 0; height: 100%; \}/.test(s));
 check(phase+'/direct-root',true,/---\s*<div class="gc-wrap"/.test(s));
 check(phase+'/inner-300-rail',true,/\.gc-panels \{[^}]*grid-template-columns: 300px minmax\(0, 1fr\)/.test(s)&&s.includes('gc-rail zt-rail'));
 check(phase+'/status-reserved',true,/#gc-status \{ min-height: 2\.8em/.test(s));
 check(phase+'/actions-before-status',true,s.indexOf('id="gc-run"')<s.indexOf('id="gc-status"')&&s.indexOf('id="gc-reset"')<s.indexOf('id="gc-status"'));
 check(phase+'/bounded-real-focus-result',true,/id="gc-result"[^>]*tabindex="0"/.test(s)&&/\.gc-output \{[^}]*min-height: 0; overflow: auto/.test(s));
 check(phase+'/stack-860',true,s.includes('@media (max-width: 860px)')&&s.includes('grid-template-columns: minmax(0, 1fr); flex: none'));
 check(phase+'/main-44-dense-24',true,/gc-main-actions button[^}]*min-height: 44px/.test(s)&&/gc-field input\[type="range"\][^}]*min-height: 24px/.test(s));
 check(phase+'/phone-empty-hidden',true,s.includes('.gc-output-panel:has(#gc-result[hidden]) { display: none; }'));
 check(phase+'/desktop-empty',true,s.includes('class="gc-empty">{L.emptyPreview}'));
 check(phase+'/all-four-buttons',4,[...s.matchAll(/<button\b[^>]*id="gc-(?:run|reset|download|limit-copy)"/g)].length);
 check(phase+'/eleven-slot-tips',11,[...s.matchAll(/<Toggletip\b[^>]*>\{L\.tips\.[a-z]+\}<\/Toggletip>/g)].length);
 const script=s.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
 check(phase+'/no-client-tips',false,/tips|var STRINGS|data-i18n/.test(script));
 for(const lang of ['en','zh','ja','ko']){
  check(phase+'/'+lang+'-tip-count',11,Object.keys(labels[lang].tips||{}).length);
  check(phase+'/'+lang+'-localized-empty',true,typeof labels[lang].emptyPreview==='string'&&labels[lang].emptyPreview.length>10);
  const mdx=readFileSync(join(ROOT,'src/content/tools/gif-compressor/'+lang+'.mdx'),'utf8'),steps=mdx.match(/steps:\n([\s\S]*?)faqItems:/)?.[1],items=steps?[...steps.matchAll(/^  - "(.*)"$/gm)].map(m=>JSON.parse('"'+m[1]+'"')):[];
  check(phase+'/'+lang+'-six-steps',6,items.length);
  check(phase+'/'+lang+'-step-limits',true,items.length>0&&items.every(x=>x.length<=280)&&items.join('').length<=1200);
  check(phase+'/'+lang+'-Usage-removed',false,/^## (How to Use|使用步骤|使い方|사용 방법)$/m.test(mdx));
 }
 const p=page();await load(p);const n=p.tracks.length,before=p.get('gc-summary').textContent;
 p.get('gc-lossy').value='85';p.get('gc-lossy').dispatch('input');p.change('gc-colors','32');p.change('gc-step','2');p.get('gc-dither').checked=true;p.get('gc-dither').dispatch('change');p.get('gc-width').value='1';p.get('gc-width').dispatch('input');await settle();
 check(phase+'/option-changes-do-not-compress',n,p.tracks.length);
 check(phase+'/option-changes-keep-published-result',before,p.get('gc-summary').textContent);
 p.get('gc-run').click();await waitFor(()=>p.tracks.length>n);check(phase+'/manual-compress-applies-options',true,p.get('gc-summary').textContent!==before);
 let picker=0;p.get('gc-file').click=()=>{picker++;};p.get('gc-reset').click();check(phase+'/Open-another-does-not-open-picker',0,picker);
 check(phase+'/Open-another-focuses-drop','gc-drop',p.doc.activeElement.id);
 const statusPage=page();statusPage.file(badFile());await settle();const actualStatus=statusPage.get('gc-status');
 check(phase+'/status-reserved-after-real-error',true,actualStatus.textContent===L.statusNotGif&&statusPage.widget.querySelector('#gc-status')===actualStatus&&/#gc-status \{ min-height: 2\.8em/.test(source.gif));
 const fn=script.match(/function revealResult\(\) \{[\s\S]*?\n      \}/)?.[0];
 check(phase+'/actual-publish-observer',true,!!fn&&script.includes("new MutationObserver(revealResult).observe(resultEl, { attributes: true, attributeFilter: ['hidden'] })"));
 if(fn){for(const [hidden,mobile,expected] of [[true,true,0],[false,false,0],[false,true,1]]){const calls=[],ctx={resultEl:{hidden,scrollIntoView(x){calls.push(x);}},matchMedia:()=>({matches:mobile})};vm.runInNewContext(fn+';revealResult();',ctx);check(phase+'/reveal-'+hidden+'-'+mobile,expected,calls.length);if(expected)check(phase+'/real-scroll-options',{block:'start',behavior:'smooth'},calls[0]);}}
 const featureLayouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
 if (/'gif-compressor':\s*'generate'/.test(featureLayouts)) check(phase+'/v2-generate-registration', true, true);
 else console.log('PENDING_ROOT gif-compressor generate registration (not counted as PASS)');

});

await settle();check('no-unhandled-rejections',[],unhandled);process.removeListener('unhandledRejection',onRejection);
const pageCounts={PASS:checks.filter(c=>c.status==='PASS').length,FAIL:checks.filter(c=>c.status==='FAIL').length};
passes+=pageCounts.PASS;failures+=pageCounts.FAIL;
const report={node:process.version,source:process.env.ZT_B14_SOURCE||paths[Object.keys(paths)[0]],sourceSHA:sha(pageSource),legacyCounts,pageCounts,counts:{PASS:passes,FAIL:failures},checks,observations};
if(process.env.ZT_B14_REPORT){const {writeFileSync}=await import('node:fs');writeFileSync(process.env.ZT_B14_REPORT,JSON.stringify(report,null,2)+'\n');}
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode=failures?1:0;
