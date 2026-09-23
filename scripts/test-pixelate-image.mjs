// Pixelate Image — spec-driven regression test
//
// Read:  src/components/tools/PixelateImageTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: pixelate() block-average correctness including non-divisible edge blocks,
// pixelate() touching only the pixels it is given (mirroring how render() composites
// a region back into the full canvas), normalizeRect() reverse-drag normalization and
// out-of-bounds clipping, and toImageCoords() display-to-image scaling.
//
// Run: node scripts/test-pixelate-image.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/PixelateImageTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in PixelateImageTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { pixelate, normalizeRect, toImageCoords };')();

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

// Build a flat RGBA buffer from a 2D array of [r,g,b,a] pixels (row-major).
function makeBuffer(pixels, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixels[y][x];
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return data;
}
function readPixel(data, w, x, y) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

// ---------- 1. pixelate(): block averaging ----------
{
  // 4x2 image, block=2 -> two 2x2 blocks, each averaged exactly.
  const w = 4, h = 2, block = 2;
  const pixels = [
    [[0, 0, 0, 255], [10, 0, 0, 255], [100, 100, 100, 200], [200, 100, 100, 200]],
    [[20, 0, 0, 255], [30, 0, 0, 255], [150, 100, 100, 100], [250, 100, 100, 100]],
  ];
  const data = makeBuffer(pixels, w, h);
  E.pixelate(data, w, h, block);
  // Block 1 (x:0-1,y:0-1): avg r = (0+10+20+30)/4 = 15, g=b=0, a=255
  deepEqual('pixelate block1 top-left pixel', readPixel(data, w, 0, 0), [15, 0, 0, 255]);
  deepEqual('pixelate block1 uniform fill', readPixel(data, w, 1, 1), [15, 0, 0, 255]);
  // Block 2 (x:2-3,y:0-1): color is alpha-weighted, r = (100*200+200*200+150*100+250*100)/600 ≈ 167,
  // g=b=100, a = (200+200+100+100)/4 = 150
  deepEqual('pixelate block2 uniform fill', readPixel(data, w, 2, 0), [167, 100, 100, 150]);
  deepEqual('pixelate block2 uniform fill 2', readPixel(data, w, 3, 1), [167, 100, 100, 150]);
}
{
  // Transparent pixels must not darken the block color (their RGB is meaningless).
  const w = 2, h = 1;
  const data = makeBuffer([[[255, 0, 0, 255], [0, 0, 0, 0]]], w, h);
  E.pixelate(data, w, h, 2);
  deepEqual('pixelate ignores RGB of transparent pixels', readPixel(data, w, 0, 0), [255, 0, 0, 128]);
  const clear = makeBuffer([[[9, 9, 9, 0], [7, 7, 7, 0]]], w, h);
  E.pixelate(clear, w, h, 2);
  deepEqual('pixelate fully transparent block stays transparent', readPixel(clear, w, 1, 0), [0, 0, 0, 0]);
}

// ---------- 2. pixelate(): non-divisible edge blocks ----------
{
  // 3x3 image, block=2 -> blocks are 2x2, 1x2 (right edge), 2x1 (bottom edge), 1x1 (corner)
  const w = 3, h = 3, block = 2;
  const pixels = [
    [[0, 0, 0, 255], [10, 0, 0, 255], [100, 0, 0, 255]],
    [[20, 0, 0, 255], [30, 0, 0, 255], [120, 0, 0, 255]],
    [[200, 0, 0, 255], [210, 0, 0, 255], [255, 0, 0, 255]],
  ];
  const data = makeBuffer(pixels, w, h);
  E.pixelate(data, w, h, block);
  // top-left 2x2 block avg r = (0+10+20+30)/4 = 15
  deepEqual('edge block top-left avg', readPixel(data, w, 0, 0), [15, 0, 0, 255]);
  deepEqual('edge block top-left avg (mirrored corner)', readPixel(data, w, 1, 1), [15, 0, 0, 255]);
  // right edge column block (x=2, y:0-1) is only 1 pixel wide -> avg of (100,120)/2 = 110, unaffected by other blocks
  deepEqual('edge block right column avg', readPixel(data, w, 2, 0), [110, 0, 0, 255]);
  deepEqual('edge block right column avg (row 2)', readPixel(data, w, 2, 1), [110, 0, 0, 255]);
  // bottom-left block (x:0-1, y=2) is 2x1 -> avg of (200,210)/2 = 205
  deepEqual('edge block bottom row avg', readPixel(data, w, 0, 2), [205, 0, 0, 255]);
  deepEqual('edge block bottom row avg 2', readPixel(data, w, 1, 2), [205, 0, 0, 255]);
  // bottom-right corner block is a single pixel -> unchanged
  deepEqual('edge block corner single pixel unchanged', readPixel(data, w, 2, 2), [255, 0, 0, 255]);
}

// ---------- 3. pixelate() only ever touches the buffer it is given ----------
// Mirrors what render() does: extract a region's own sub-buffer, pixelate it,
// and composite it back into the full image at the region's offset. Pixels
// outside the region must be byte-for-byte unchanged.
{
  const W = 6, H = 4;
  const full = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < full.length; i++) full[i] = (i * 37) % 256; // deterministic noise
  const before = full.slice();

  const region = { x: 2, y: 1, w: 3, h: 2 };
  // Extract region sub-buffer (row by row, since ImageData rows are not contiguous in the parent buffer)
  const sub = new Uint8ClampedArray(region.w * region.h * 4);
  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const srcIdx = ((region.y + ry) * W + (region.x + rx)) * 4;
      const dstIdx = (ry * region.w + rx) * 4;
      for (let c = 0; c < 4; c++) sub[dstIdx + c] = full[srcIdx + c];
    }
  }
  E.pixelate(sub, region.w, region.h, 2);
  // Composite back
  for (let ry = 0; ry < region.h; ry++) {
    for (let rx = 0; rx < region.w; rx++) {
      const srcIdx = (ry * region.w + rx) * 4;
      const dstIdx = ((region.y + ry) * W + (region.x + rx)) * 4;
      for (let c = 0; c < 4; c++) full[dstIdx + c] = sub[srcIdx + c];
    }
  }

  let outsideUnchanged = true;
  let insideChanged = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inRegion = x >= region.x && x < region.x + region.w && y >= region.y && y < region.y + region.h;
      const idx = (y * W + x) * 4;
      const same = full[idx] === before[idx] && full[idx + 1] === before[idx + 1] && full[idx + 2] === before[idx + 2] && full[idx + 3] === before[idx + 3];
      if (!inRegion && !same) outsideUnchanged = false;
      if (inRegion && !same) insideChanged = true;
    }
  }
  check('pixelate via region composite leaves outside pixels untouched', outsideUnchanged);
  check('pixelate via region composite changes inside pixels', insideChanged);
}

// ---------- 4. normalizeRect(): reverse drag + out-of-bounds clipping ----------
{
  deepEqual('normalizeRect forward drag', E.normalizeRect(10, 10, 30, 40, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect reverse drag (both axes)', E.normalizeRect(30, 40, 10, 10, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect reverse drag (x only)', E.normalizeRect(30, 10, 10, 40, 100, 100), { x: 10, y: 10, w: 20, h: 30 });
  deepEqual('normalizeRect clips negative start', E.normalizeRect(-20, -20, 30, 30, 100, 100), { x: 0, y: 0, w: 30, h: 30 });
  deepEqual('normalizeRect clips beyond image bounds', E.normalizeRect(80, 80, 150, 150, 100, 100), { x: 80, y: 80, w: 20, h: 20 });
  deepEqual('normalizeRect clips both edges past bounds', E.normalizeRect(-50, -50, 200, 200, 100, 100), { x: 0, y: 0, w: 100, h: 100 });
  equal('normalizeRect rejects zero-area drag', E.normalizeRect(10, 10, 10, 10, 100, 100), null);
  equal('normalizeRect rejects sub-2px width', E.normalizeRect(10, 10, 11, 20, 100, 100), null);
  equal('normalizeRect rejects sub-2px height', E.normalizeRect(10, 10, 20, 11, 100, 100), null);
  equal('normalizeRect rejects fully out-of-bounds drag', E.normalizeRect(-30, -30, -5, -5, 100, 100), null);
  equal('normalizeRect rounds fractional coords', JSON.stringify(E.normalizeRect(10.4, 10.4, 20.6, 30.6, 100, 100)), JSON.stringify({ x: 10, y: 10, w: 11, h: 21 }));
}

// ---------- 5. toImageCoords(): display-to-image scaling ----------
{
  // Canvas displayed at 200x100 CSS px but backed by an 800x400 image (4x scale).
  const rect = { left: 50, top: 20, width: 200, height: 100 };
  deepEqual('toImageCoords scales by 4x at origin', E.toImageCoords(50, 20, rect, 800, 400), { x: 0, y: 0 });
  deepEqual('toImageCoords scales by 4x at offset', E.toImageCoords(100, 45, rect, 800, 400), { x: 200, y: 100 });
  deepEqual('toImageCoords at bottom-right corner', E.toImageCoords(250, 120, rect, 800, 400), { x: 800, y: 400 });

  // 1:1 scale (no CSS resizing applied)
  const rect1x = { left: 0, top: 0, width: 400, height: 300 };
  deepEqual('toImageCoords 1:1 scale', E.toImageCoords(150, 90, rect1x, 400, 300), { x: 150, y: 90 });

  // Non-uniform scale (should not happen given aspect-ratio preserving CSS, but the
  // formula must still apply scaleX/scaleY independently rather than assuming square scale)
  const rectNonUniform = { left: 0, top: 0, width: 100, height: 50 };
  deepEqual('toImageCoords independent x/y scale', E.toImageCoords(50, 25, rectNonUniform, 200, 200), { x: 100, y: 100 });
}

// ---------- summary ----------
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
