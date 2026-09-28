// Image Splitter — spec-driven regression test
//
// Read:  src/components/tools/ImageSplitterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source; also reads the STRINGS table) and
//        src/components/tools/GifSplitterTool.astro (crc32 / zipStore must be identical)
// Write: a temporary directory under os.tmpdir() (one ZIP file, removed on exit);
//        stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: equal-split boundaries (no pixel lost, sizes differ by at most 1); grid tiles
// (cover the image exactly, rows / columns clamped to the image size, canvas limit);
// tile-size tiles (margin, spacing, partial edge tiles kept or dropped, countStarts
// against a brute-force loop, 400-tile limit, zero tiles, one partial tile); Instagram
// geometry (3:4 / 4:5 / 1:1 heights, profile grid and carousel), crop box (largest box
// of the target ratio, clamped offsets, NaN offsets), crop and pad source rects (tiles
// cover the crop box / fitted image exactly, empty pad tiles), upscale factor, posting
// order (post 1 bottom-right, last post top-left, carousel left to right); file names
// (zero padding, sanitizing, pasted images); crc32 / zipStore copied verbatim from
// gif-splitter, ZIP round trip (local headers, central directory, CRCs, `unzip -t` when
// available); the 4 languages in STRINGS have the same keys.
//
// Run: node scripts/test-image-splitter.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ImageSplitterTool.astro'), 'utf8');
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
const block = engineBlock(source, 'ImageSplitterTool.astro');
const splitterBlock = engineBlock(splitterSource, 'GifSplitterTool.astro');
const E = new Function(block + `
return { ISP_LIMITS, ISP_IG, toInt, boundaries, canvasFits, gridTiles, countStarts, sizeTiles, igGeometry,
  cropSize, clampCrop, cropBox, postNumber, instagramTiles, planTiles, tileSizeRange, allTransparent,
  padNumber, sanitizeBase, extFromMime, tileFileName, crc32, zipStore };`)();

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
const near = (a, b) => Math.abs(a - b) < 1e-6;

function settings(over) {
  return Object.assign({
    mode: 'grid', rows: 3, cols: 3, tileW: 64, tileH: 64, margin: 0, spacing: 0, dropPartial: false,
    igLayout: 'grid', igRows: 3, igSlides: 3, aspect: '3:4', fit: 'crop', fx: 0.5, fy: 0.5,
  }, over);
}

// Every pixel of W×H is covered by exactly one tile source rect.
function coversExactly(tiles, W, H) {
  const hits = new Uint8Array(W * H);
  for (const t of tiles) {
    const d = t.draw;
    for (let y = d.sy; y < d.sy + d.sh; y++) for (let x = d.sx; x < d.sx + d.sw; x++) hits[y * W + x]++;
  }
  return hits.every((v) => v === 1);
}

// ---------- 1. toInt ----------
{
  equal('toInt: empty gives fallback', E.toInt('', 1, 20, 7), 7);
  equal('toInt: undefined gives fallback', E.toInt(undefined, 1, 20, 7), 7);
  equal('toInt: text gives fallback', E.toInt('abc', 1, 20, 7), 7);
  equal('toInt: floors', E.toInt('4.9', 1, 20, 7), 4);
  equal('toInt: clamps high', E.toInt(99, 1, 20, 7), 20);
  equal('toInt: clamps low', E.toInt(-3, 0, 20, 7), 0);
}

// ---------- 2. boundaries ----------
{
  deepEqual('boundaries(3, 10)', E.boundaries(3, 10), [0, 3, 7, 10]);
  deepEqual('boundaries(1, 5)', E.boundaries(1, 5), [0, 5]);
  deepEqual('boundaries(4, 4)', E.boundaries(4, 4), [0, 1, 2, 3, 4]);
  let ok = true;
  for (let len = 1; len <= 300; len++) {
    for (let n = 1; n <= Math.min(20, len); n++) {
      const b = E.boundaries(n, len);
      if (b.length !== n + 1 || b[0] !== 0 || b[n] !== len) { ok = false; break; }
      let min = Infinity, max = 0;
      for (let i = 0; i < n; i++) { const s = b[i + 1] - b[i]; min = Math.min(min, s); max = Math.max(max, s); }
      if (min < 1 || max - min > 1 || max > Math.ceil(len / n) || min < Math.floor(len / n)) { ok = false; break; }
    }
  }
  check('boundaries: len 1..300 × n 1..20 cover [0, len], parts ≥ 1 and differ by ≤ 1', ok);
  deepEqual('boundaries(3, 4000) (spec example 4000×3000, 3 cols)', E.boundaries(3, 4000), [0, 1333, 2667, 4000]);
}

// ---------- 3. grid mode ----------
{
  const p = E.planTiles(4000, 3000, settings({ rows: 3, cols: 3 }));
  equal('grid: kind', p.kind, 'grid');
  equal('grid: 9 tiles', p.tiles.length, 9);
  equal('grid: no error', p.error, null);
  equal('grid: no notice', p.notice, null);
  deepEqual('grid: tile r0c1 rect', p.tiles[1].draw, { sx: 1333, sy: 0, sw: 1334, sh: 1000, dx: 0, dy: 0, dw: 1334, dh: 1000 });
  deepEqual('grid: tile r2c2 row/col/order', [p.tiles[8].row, p.tiles[8].col, p.tiles[8].order], [2, 2, 9]);
  const r = E.tileSizeRange(p.tiles);
  deepEqual('grid: size range', r, { minW: 1333, maxW: 1334, minH: 1000, maxH: 1000 });

  let ok = true;
  for (const [W, H, rows, cols] of [[7, 5, 3, 2], [10, 10, 3, 3], [13, 1, 1, 13], [37, 23, 5, 7], [1, 1, 1, 1]]) {
    const q = E.planTiles(W, H, settings({ rows, cols }));
    if (q.tiles.length !== rows * cols || !coversExactly(q.tiles, W, H)) ok = false;
    if (q.tiles.some((t) => t.w !== t.draw.sw || t.h !== t.draw.sh || t.draw.dw !== t.w)) ok = false;
  }
  check('grid: tiles cover the image exactly (native size, no scaling)', ok);

  const tall = E.planTiles(100, 5, settings({ rows: 8, cols: 4 }));
  equal('grid: rows clamped to image height', tall.rows, 5);
  equal('grid: clamped rows give 5×4 tiles', tall.tiles.length, 20);
  equal('grid: rows clamp notice', tall.notice && tall.notice.key, 'statusRowsClamped');
  deepEqual('grid: rows clamp vars', tall.notice && tall.notice.vars, { h: 5, max: 5 });
  check('grid: clamped tiles are at least 1 px', tall.tiles.every((t) => t.w >= 1 && t.h >= 1));
  const narrow = E.planTiles(3, 100, settings({ rows: 2, cols: 10 }));
  equal('grid: cols clamped to image width', narrow.cols, 3);
  equal('grid: cols clamp notice', narrow.notice && narrow.notice.key, 'statusColsClamped');

  const huge = E.planTiles(8000, 6000, settings({ rows: 1, cols: 1 }));
  equal('grid: 1×1 of 48 MP exceeds the tile canvas limit', huge.error && huge.error.key, 'statusTileTooLarge');
  equal('grid: error means no tiles', huge.tiles.length, 0);
  equal('grid: 2×2 of 48 MP fits', E.planTiles(8000, 6000, settings({ rows: 2, cols: 2 })).error, null);
  equal('grid: 20×20 is 400 tiles', E.planTiles(4000, 4000, settings({ rows: 20, cols: 20 })).tiles.length, 400);
}

// ---------- 4. tile-size mode ----------
{
  function brute(len, size, margin, spacing, drop) {
    let n = 0;
    for (let x = margin; x < len; x += size + spacing) {
      if (drop && x + size > len) break;
      n++;
    }
    return n;
  }
  let ok = true, detail = '';
  for (let len = 1; len <= 40 && ok; len++) {
    for (let size = 1; size <= 45 && ok; size++) {
      for (let margin = 0; margin <= 6 && ok; margin += 3) {
        for (let spacing = 0; spacing <= 4 && ok; spacing += 2) {
          for (const drop of [false, true]) {
            const a = E.countStarts(len, size, margin, spacing, drop), b = brute(len, size, margin, spacing, drop);
            if (a !== b) { ok = false; detail = JSON.stringify({ len, size, margin, spacing, drop, a, b }); break; }
          }
        }
      }
    }
  }
  check('countStarts equals the brute-force loop', ok, detail);

  const s = settings({ mode: 'tile', tileW: 32, tileH: 32, margin: 2, spacing: 1 });
  const p = E.planTiles(100, 70, s);
  equal('tile: kind', p.kind, 'tile');
  deepEqual('tile: 3 columns × 3 rows', [p.cols, p.rows, p.tiles.length], [3, 3, 9]);
  deepEqual('tile: r0c1 at margin + tile + spacing', [p.tiles[1].draw.sx, p.tiles[1].draw.sy, p.tiles[1].w, p.tiles[1].h], [35, 2, 32, 32]);
  deepEqual('tile: last column is partial (100 - 68 = 32 wide, full)', [p.tiles[2].draw.sx, p.tiles[2].w], [68, 32]);
  deepEqual('tile: last row is partial (70 - 68 = 2 tall)', [p.tiles[6].draw.sy, p.tiles[6].h, p.tiles[6].partial], [68, 2, true]);
  const dropped = E.planTiles(100, 70, Object.assign({}, s, { dropPartial: true }));
  deepEqual('tile: drop partial removes the short last row', [dropped.cols, dropped.rows], [3, 2]);
  check('tile: no partial tiles when dropped', dropped.tiles.every((t) => !t.partial && t.w === 32 && t.h === 32));
  check('tile: tiles stay inside the image', p.tiles.every((t) => t.draw.sx + t.draw.sw <= 100 && t.draw.sy + t.draw.sh <= 70));

  const sheet = E.planTiles(256, 128, settings({ mode: 'tile', tileW: 64, tileH: 64 }));
  check('tile: 256×128 sheet of 64 px covers the image exactly', sheet.tiles.length === 8 && coversExactly(sheet.tiles, 256, 128));
  deepEqual('tile: order is left to right, top to bottom', sheet.tiles.map((t) => t.order), [1, 2, 3, 4, 5, 6, 7, 8]);

  const many = E.planTiles(1000, 1000, settings({ mode: 'tile', tileW: 10, tileH: 10 }));
  equal('tile: 10 000 tiles is an error', many.error && many.error.key, 'statusTooMany');
  deepEqual('tile: error reports the count', many.error && many.error.vars, { n: 10000 });
  equal('tile: 400 tiles is allowed', E.planTiles(400, 400, settings({ mode: 'tile', tileW: 20, tileH: 20 })).tiles.length, 400);
  equal('tile: 401+ tiles is an error', E.planTiles(420, 400, settings({ mode: 'tile', tileW: 20, tileH: 20 })).error.key, 'statusTooMany');

  const big = E.planTiles(50, 40, settings({ mode: 'tile', tileW: 64, tileH: 64 }));
  equal('tile: tile larger than image gives one tile', big.tiles.length, 1);
  deepEqual('tile: the one tile is the image', [big.tiles[0].w, big.tiles[0].h, big.tiles[0].partial], [50, 40, true]);
  equal('tile: one partial tile notice', big.notice && big.notice.key, 'statusOnePartial');
  const bigDrop = E.planTiles(50, 40, settings({ mode: 'tile', tileW: 64, tileH: 64, dropPartial: true }));
  equal('tile: tile larger than image with drop partial is an error', bigDrop.error && bigDrop.error.key, 'statusNoTilesDrop');
  const bigMargin = E.planTiles(50, 40, settings({ mode: 'tile', tileW: 8, tileH: 8, margin: 40 }));
  equal('tile: margin as large as the image is an error', bigMargin.error && bigMargin.error.key, 'statusNoTilesMargin');
  const tooLarge = E.planTiles(16000, 3000, settings({ mode: 'tile', tileW: 16000, tileH: 3000 }));
  equal('tile: tile above the canvas area limit is an error', tooLarge.error && tooLarge.error.key, 'statusTileTooLarge');
}

// ---------- 5. Instagram geometry, crop box ----------
{
  deepEqual('ig: 3:4 profile grid, 3 rows', E.igGeometry('grid', 3, 5, '3:4'), { carousel: false, cols: 3, rows: 3, tileW: 1080, tileH: 1440, width: 3240, height: 4320 });
  deepEqual('ig: 4:5 carousel, 5 slides', E.igGeometry('carousel', 3, 5, '4:5'), { carousel: true, cols: 5, rows: 1, tileW: 1080, tileH: 1350, width: 5400, height: 1350 });
  equal('ig: 1:1 tile height', E.igGeometry('grid', 1, 2, '1:1').tileH, 1080);
  equal('ig: unknown aspect falls back to 3:4', E.igGeometry('grid', 1, 2, '9:16').tileH, 1440);

  deepEqual('cropSize: wide source keeps height', E.cropSize(4000, 1000, 3240, 1440), { w: 2250, h: 1000 });
  deepEqual('cropSize: tall source keeps width', E.cropSize(1000, 4000, 3, 4), { w: 1000, h: 1333 });
  deepEqual('cropSize: same ratio is the whole image', E.cropSize(3240, 4320, 3240, 4320), { w: 3240, h: 4320 });
  deepEqual('cropBox: centred', E.cropBox(4000, 1000, 3240, 1440, 0.5, 0.5), { x: 875, y: 0, w: 2250, h: 1000 });
  deepEqual('cropBox: left edge', E.cropBox(4000, 1000, 3240, 1440, 0, 0.5), { x: 0, y: 0, w: 2250, h: 1000 });
  deepEqual('cropBox: right edge', E.cropBox(4000, 1000, 3240, 1440, 1, 0.5), { x: 1750, y: 0, w: 2250, h: 1000 });
  deepEqual('clampCrop: past the right edge', E.clampCrop(9999, -50, 2250, 1000, 4000, 1000), { x: 1750, y: 0, w: 2250, h: 1000 });
  deepEqual('clampCrop: negative x', E.clampCrop(-10, 0, 2250, 1000, 4000, 1000), { x: 0, y: 0, w: 2250, h: 1000 });
  deepEqual('clampCrop: NaN offsets go to 0', E.clampCrop(NaN, Infinity, 100, 100, 400, 400), { x: 0, y: 0, w: 100, h: 100 });
  deepEqual('clampCrop: rounds to integers', E.clampCrop(10.6, 3.2, 100, 100, 400, 400), { x: 11, y: 3, w: 100, h: 100 });
}

// ---------- 6. posting order ----------
{
  // 3 rows × 3 cols: newest post shows top-left, so post 1 is bottom-right.
  const grid = [];
  for (let r = 0; r < 3; r++) { const row = []; for (let c = 0; c < 3; c++) row.push(E.postNumber(r, c, 3, 3)); grid.push(row); }
  deepEqual('postNumber: 3×3 layout', grid, [[9, 8, 7], [6, 5, 4], [3, 2, 1]]);
  equal('postNumber: spec formula (R-1-r)*3 + (2-c) + 1', E.postNumber(1, 0, 4, 3), (4 - 1 - 1) * 3 + (2 - 0) + 1);
  let ok = true;
  for (let R = 1; R <= 10; R++) {
    const seen = new Set();
    for (let r = 0; r < R; r++) for (let c = 0; c < 3; c++) seen.add(E.postNumber(r, c, R, 3));
    if (seen.size !== R * 3 || Math.min(...seen) !== 1 || Math.max(...seen) !== R * 3) ok = false;
    if (E.postNumber(R - 1, 2, R, 3) !== 1 || E.postNumber(0, 0, R, 3) !== R * 3) ok = false;
  }
  check('postNumber: rows 1..10 give 1..3R once each, 1 bottom-right, 3R top-left', ok);

  const p = E.planTiles(3240, 4320, settings({ mode: 'instagram', igLayout: 'grid', igRows: 3, aspect: '3:4' }));
  deepEqual('ig grid plan: orders in layout order', p.tiles.map((t) => t.order), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  const c = E.planTiles(5400, 1350, settings({ mode: 'instagram', igLayout: 'carousel', igSlides: 5, aspect: '4:5' }));
  equal('ig carousel plan: kind', c.kind, 'ig-carousel');
  deepEqual('ig carousel plan: slide 1 is leftmost', c.tiles.map((t) => t.order), [1, 2, 3, 4, 5]);
  const c3 = E.planTiles(3240, 1350, settings({ mode: 'instagram', igLayout: 'carousel', igSlides: 3, aspect: '4:5' }));
  deepEqual('ig carousel plan with 3 slides: still left to right', c3.tiles.map((t) => t.order), [1, 2, 3]);
}

// ---------- 7. Instagram crop / pad tiles ----------
{
  // Exact source size: no scaling.
  const exact = E.planTiles(3240, 4320, settings({ mode: 'instagram', igRows: 3, aspect: '3:4' }));
  deepEqual('ig crop: exact size crop box', exact.crop, { x: 0, y: 0, w: 3240, h: 4320 });
  equal('ig crop: exact size scale 1', exact.scale, 1);
  deepEqual('ig crop: tile r1c2 source rect', exact.tiles[5].draw, { sx: 2160, sy: 1440, sw: 1080, sh: 1440, dx: 0, dy: 0, dw: 1080, dh: 1440 });
  check('ig crop: every tile is 1080×1440', exact.tiles.every((t) => t.w === 1080 && t.h === 1440));

  // Panorama carousel from a 6000×1000 image: crop keeps height, centred.
  const pano = E.planTiles(6000, 1000, settings({ mode: 'instagram', igLayout: 'carousel', igSlides: 4, aspect: '4:5', fx: 0.5 }));
  const cb = pano.crop;
  equal('ig crop: panorama crop height', cb.h, 1000);
  equal('ig crop: panorama crop width = 1000 × 4320/1350', cb.w, Math.round(1000 * 4320 / 1350));
  equal('ig crop: centred x', cb.x, Math.round((6000 - cb.w) / 2));
  let ok = true;
  for (let i = 0; i < pano.tiles.length; i++) {
    const d = pano.tiles[i].draw;
    if (!near(d.sx, cb.x + cb.w * i / 4) || !near(d.sw, cb.w / 4) || d.sy !== 0 || d.sh !== 1000) ok = false;
    if (i > 0 && !near(pano.tiles[i - 1].draw.sx + pano.tiles[i - 1].draw.sw, d.sx)) ok = false;
  }
  check('ig crop: slides split the crop box with no gap or overlap', ok);
  check('ig crop: upscale factor = 4320 / crop width', near(pano.scale, 4320 / cb.w));
  check('ig crop: small source is upscaled (> 1)', pano.scale > 1);
  const downscale = E.planTiles(12000, 16000, settings({ mode: 'instagram', igRows: 3, aspect: '3:4' }));
  check('ig crop: large source scale < 1', downscale.scale < 1);

  // Pad: 1000×1000 into 3×1 grid of 3:4 (3240×1440): fitted by height.
  const pad = E.planTiles(1000, 1000, settings({ mode: 'instagram', igRows: 1, aspect: '3:4', fit: 'pad' }));
  equal('ig pad: no crop box', pad.crop, null);
  check('ig pad: scale = 1440 / 1000', near(pad.scale, 1.44));
  const d0 = pad.tiles[0].draw, d1 = pad.tiles[1].draw, d2 = pad.tiles[2].draw;
  // Fitted image spans x 900..2340 of the 3240 target.
  check('ig pad: left tile draws the image left part at x 900', d0 && near(d0.dx, 900) && near(d0.dw, 180) && near(d0.sx, 0) && near(d0.sw, 125));
  check('ig pad: middle tile is fully covered', d1 && near(d1.dx, 0) && near(d1.dw, 1080) && near(d1.sx, 125) && near(d1.sw, 750));
  check('ig pad: right tile draws the image right part', d2 && near(d2.dx, 0) && near(d2.dw, 180) && near(d2.sx, 875) && near(d2.sw, 125));
  check('ig pad: source rects stay inside the image', pad.tiles.every((t) => !t.draw || (t.draw.sx >= 0 && t.draw.sx + t.draw.sw <= 1000 + 1e-9 && t.draw.sy >= 0 && t.draw.sy + t.draw.sh <= 1000 + 1e-9)));
  // A narrow image in a 5-slide carousel leaves the outer slides empty.
  const padEmpty = E.planTiles(500, 1000, settings({ mode: 'instagram', igLayout: 'carousel', igSlides: 5, aspect: '4:5', fit: 'pad' }));
  deepEqual('ig pad: outer slides have no draw', padEmpty.tiles.map((t) => t.draw === null), [true, true, false, true, true]);
  let srcW = 0;
  for (const t of pad.tiles) if (t.draw) srcW += t.draw.sw;
  check('ig pad: source widths add up to the image width', near(srcW, 1000));
}

// ---------- 8. allTransparent ----------
{
  check('allTransparent: all alpha 0', E.allTransparent(new Uint8ClampedArray([255, 0, 0, 0, 1, 2, 3, 0])));
  check('allTransparent: one alpha 1 pixel', !E.allTransparent(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 1])));
  check('allTransparent: empty data', E.allTransparent(new Uint8ClampedArray(0)));
}

// ---------- 9. file names ----------
{
  equal('padNumber: 1 of 9', E.padNumber(1, 9), '1');
  equal('padNumber: 3 of 12', E.padNumber(3, 12), '03');
  equal('padNumber: 7 of 400', E.padNumber(7, 400), '007');
  equal('sanitizeBase: strips extension', E.sanitizeBase('holiday photo.JPG'), 'holiday photo');
  equal('sanitizeBase: keeps inner dots', E.sanitizeBase('v1.2.final.png'), 'v1.2.final');
  equal('sanitizeBase: replaces reserved characters', E.sanitizeBase('a/b\\c:d*e?f"g<h>i|j.png'), 'a-b-c-d-e-f-g-h-i-j');
  equal('sanitizeBase: keeps Unicode', E.sanitizeBase('夏の写真.webp'), '夏の写真');
  equal('sanitizeBase: trims dots and spaces', E.sanitizeBase('  ..name.. .png'), 'name');
  equal('sanitizeBase: control characters', E.sanitizeBase('a\u0001b.png'), 'a-b');
  equal('sanitizeBase: empty gives image', E.sanitizeBase(''), 'image');
  equal('sanitizeBase: null gives image', E.sanitizeBase(null), 'image');
  equal('sanitizeBase: only extension gives image', E.sanitizeBase('.png'), 'image');
  equal('sanitizeBase: long names capped at 100', E.sanitizeBase('x'.repeat(150) + '.png').length, 100);
  equal('extFromMime: jpeg', E.extFromMime('image/jpeg'), 'jpg');
  equal('extFromMime: webp', E.extFromMime('image/webp'), 'webp');
  equal('extFromMime: png fallback (Safari WebP)', E.extFromMime('image/png'), 'png');

  const grid = E.planTiles(1200, 1200, settings({ rows: 12, cols: 3 }));
  equal('name: grid r/c padded to row and column counts', E.tileFileName('cat', grid.tiles[4], grid, 'png'), 'cat-r02-c2.png');
  const tile = E.planTiles(640, 64, settings({ mode: 'tile', tileW: 64, tileH: 64 }));
  equal('name: tile mode r/c', E.tileFileName('sheet', tile.tiles[9], tile, 'webp'), 'sheet-r1-c10.webp');
  const ig = E.planTiles(3240, 5760, settings({ mode: 'instagram', igRows: 4 }));
  equal('name: Instagram grid uses the post number', E.tileFileName('trip', ig.tiles[0], ig, 'jpg'), 'trip-post-12.jpg');
  equal('name: Instagram grid post 1 is bottom-right', E.tileFileName('trip', ig.tiles[11], ig, 'jpg'), 'trip-post-01.jpg');
  const car = E.planTiles(5400, 1350, settings({ mode: 'instagram', igLayout: 'carousel', igSlides: 12, aspect: '4:5' }));
  equal('name: carousel slide', E.tileFileName('pano', car.tiles[2], car, 'png'), 'pano-slide-03.png');
  const names = new Set(ig.tiles.map((t) => E.tileFileName('trip', t, ig, 'png')));
  equal('name: Instagram grid names are unique', names.size, 12);
}

// ---------- 10. crc32 / zipStore copied from gif-splitter ----------
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)([ \\t]*)(function\\*? ' + name + '\\(|var ' + name + ' =)');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
for (const name of ['crcTable', 'crc32', 'zipStore']) {
  const a = extractDecl(block, name);
  const b = extractDecl(splitterBlock, name);
  check('zip copy: ' + name + ' found in both files', a !== null && b !== null);
  check('zip copy: ' + name + ' is identical to gif-splitter', a !== null && a === b);
}

// ---------- 11. ZIP round trip ----------
{
  const enc = new TextEncoder();
  equal('crc32("123456789")', E.crc32(enc.encode('123456789')), 0xCBF43926);
  const files = [
    { name: 'trip-post-01.png', data: Uint8Array.from([137, 80, 78, 71, 1, 2, 3]) },
    { name: 'trip-post-02.png', data: enc.encode('tile two') },
    { name: '写真-r1-c1.jpg', data: new Uint8Array(0) },
  ];
  const zip = E.zipStore(files);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const dec = new TextDecoder();

  // Walk the local file headers from the start.
  let off = 0, ok = true;
  for (let i = 0; i < files.length; i++) {
    if (dv.getUint32(off, true) !== 0x04034b50) { ok = false; break; }
    if (dv.getUint16(off + 8, true) !== 0) ok = false; // STORED
    if ((dv.getUint16(off + 6, true) & 0x0800) === 0) ok = false; // UTF-8 flag
    const crc = dv.getUint32(off + 14, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const name = dec.decode(zip.subarray(off + 30, off + 30 + nameLen));
    const data = zip.subarray(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + size);
    if (name !== files[i].name || size !== files[i].data.length) ok = false;
    if (E.crc32(data) !== crc || E.crc32(files[i].data) !== crc) ok = false;
    if (Buffer.compare(Buffer.from(data), Buffer.from(files[i].data)) !== 0) ok = false;
    off += 30 + nameLen + extraLen + size;
  }
  check('zip: local headers parse back with matching names, sizes, CRCs and data', ok);

  const eocd = zip.length - 22;
  equal('zip: EOCD signature', dv.getUint32(eocd, true), 0x06054b50);
  equal('zip: EOCD entry count', dv.getUint16(eocd + 10, true), 3);
  equal('zip: central directory starts after the local entries', dv.getUint32(eocd + 16, true), off);
  let cd = off, cdOk = true;
  for (let i = 0; i < files.length; i++) {
    if (dv.getUint32(cd, true) !== 0x02014b50) { cdOk = false; break; }
    const nameLen = dv.getUint16(cd + 28, true);
    const localOff = dv.getUint32(cd + 42, true);
    if (dec.decode(zip.subarray(cd + 46, cd + 46 + nameLen)) !== files[i].name) cdOk = false;
    if (dv.getUint32(localOff, true) !== 0x04034b50) cdOk = false;
    if (dv.getUint32(cd + 16, true) !== dv.getUint32(localOff + 14, true)) cdOk = false;
    cd += 46 + nameLen;
  }
  check('zip: central directory points at the local headers with the same CRCs', cdOk);
  equal('zip: central directory size', dv.getUint32(eocd + 12, true), cd - off);

  const dir = mkdtempSync(join(tmpdir(), 'image-splitter-test-'));
  try {
    const path = join(dir, 'tiles.zip');
    writeFileSync(path, zip);
    const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    if (r.error) {
      console.log('SKIP  unzip -t (unzip not available)');
    } else {
      check('zip: unzip -t reports no errors', r.status === 0 && /No errors detected/.test(r.stdout), (r.stdout || '') + (r.stderr || ''));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- 12. STRINGS: same keys in every language ----------
{
  const s = source.indexOf('var STRINGS = {');
  const e = source.indexOf('\n      };\n', s);
  check('STRINGS block found', s >= 0 && e > s);
  const STRINGS = new Function(source.slice(s, e + 9) + '\nreturn STRINGS;')();
  const en = Object.keys(STRINGS.en).sort();
  for (const lang of ['zh', 'ja', 'ko']) {
    deepEqual('STRINGS: ' + lang + ' has the same keys as en', Object.keys(STRINGS[lang]).sort(), en);
  }
  const used = [...source.matchAll(/data-i18n(?:-aria)?="(\w+)"/g)].map((m) => m[1]);
  const missing = used.filter((k) => !STRINGS.en[k]);
  deepEqual('STRINGS: every data-i18n key exists', missing, []);
  const planKeys = [...block.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  const ternaryKeys = [...block.matchAll(/'(status\w+)'/g)].map((m) => m[1]);
  const missingPlan = [...new Set([...planKeys, ...ternaryKeys])].filter((k) => !STRINGS.en[k]);
  deepEqual('STRINGS: every plan message key exists', missingPlan, []);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
