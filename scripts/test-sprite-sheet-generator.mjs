// Sprite Sheet Generator — spec-driven regression test
//
// Read:  src/components/tools/SpriteSheetGeneratorTool.astro (extracts the real engine
//        block between the `engine:start` / `engine:end` markers, so this test cannot
//        drift from the shipped source), GifSplitterTool.astro and
//        SvgToPngConverterTool.astro (declarations copied from them must stay identical),
//        ToolLayout.astro and persistence.ts (actual global shortcut/storage contract),
//        scripts/test-sprite-sheet-generator.fixtures.json (engine parser results),
//        src/content/tools/sprite-sheet-generator/*.mdx (examples marked {/* ssg-check */})
// Write: stdout (test results); with --regenerate <dir> the fixture file
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: natural sort; unique frame names; folder paths, hidden and non-image files,
// frame names without extensions; sheet-name sanitizing; CSS class tokens; SVG raster
// size (CSS units, viewBox, scale); trim bounding box (incl. fully transparent); pixel
// hashes and identical-image aliases; nextPow2; canvas limits; fill ratio; MaxRects
// packing on 200 seeded random sets (no overlap, inside the sheet, spacing / margin /
// extrude gaps, max width, power of two, widening); grid cells and centred draw
// positions; layoutSheet with aliases; animations by name; JSON Hash / JSON Array /
// Sparrow XML / CSS (incl. pixel ratio) structure and escaping; export notes; every
// frame of an animated GIF written by sharp; the recorded parse of the exports by
// Phaser 3.90.0 / 4.2.1 and PixiJS 8.22.0; the strings of all 4 languages; page examples.
//
// The fixture is regenerated with real engine parsers:
//   mkdir /tmp/e && cd /tmp/e && npm i phaser@4.2.1 phaser3@npm:phaser@3.90.0 pixi.js@8.22.0 @xmldom/xmldom@0.9.8
//   node scripts/test-sprite-sheet-generator.mjs --regenerate /tmp/e
//
// Run: node scripts/test-sprite-sheet-generator.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import yaml from 'js-yaml';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SpriteSheetGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SpriteSheetGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { SSG_LIMITS, SSG_APP_URL, naturalCompare, uniqueNames, folderPath, isImagePath, isHiddenPath, stripExt,
  frameNames, sanitizeSheetName, cssClassName, analyzeSvg, svgRasterSize, trimBounds, pixelHashStart, pixelHashUpdate,
  pixelHashKey, aliasIndex, nextPow2, fitsLimits, fillRatio, packMaxRects, gridLayout, layoutSheet, detectAnimations,
  buildJsonHash, buildJsonArray, buildXml, buildCss, exportNotes, parseGif, createCompositor, checkBudget, baseName,
  frameFileName };`)();

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

// Seeded PRNG (mulberry32) so failures are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

// ---------- naturalCompare ----------
{
  const sorted = ['walk_10.png', 'walk_2.png', 'Walk_1.png', 'walk_02.png', 'idle.png', 'walk_1.png', 'a10b2', 'a10b10', 'a9']
    .slice().sort(E.naturalCompare);
  deepEqual('natural: order', sorted, ['a9', 'a10b2', 'a10b10', 'idle.png', 'Walk_1.png', 'walk_1.png', 'walk_2.png', 'walk_02.png', 'walk_10.png']);
  check('natural: walk_2 < walk_10', E.naturalCompare('walk_2', 'walk_10') < 0);
  check('natural: walk_10 > walk_9', E.naturalCompare('walk_10', 'walk_9') > 0);
  equal('natural: equal strings', E.naturalCompare('a1.png', 'a1.png'), 0);
  check('natural: case-insensitive before tie-break', E.naturalCompare('B.png', 'a.png') > 0);
  check('natural: prefix shorter first', E.naturalCompare('frame', 'frame1') < 0);
  check('natural: huge numbers do not overflow', E.naturalCompare('f99999999999999999999', 'f100000000000000000000') < 0);
  check('natural: dup.png before dup (2).png', E.naturalCompare('dup.png', 'dup (2).png') < 0);
  check('natural: same stem orders by extension', E.naturalCompare('a.jpg', 'a.png') < 0);
  check('natural: name without extension', E.naturalCompare('frame', 'frame.png') < 0);
  check('natural: antisymmetric', E.naturalCompare('x_3', 'x_20') === -E.naturalCompare('x_20', 'x_3'));
}

// ---------- uniqueNames ----------
{
  deepEqual('unique: duplicates get (2), (3)', E.uniqueNames(['a.png', 'a.png', 'a.png', 'b.png']), ['a.png', 'a (2).png', 'a (3).png', 'b.png']);
  deepEqual('unique: skips names already present', E.uniqueNames(['a.png', 'a.png', 'a (2).png']), ['a.png', 'a (3).png', 'a (2).png']);
  deepEqual('unique: no extension', E.uniqueNames(['sprite', 'sprite']), ['sprite', 'sprite (2)']);
  deepEqual('unique: dot file', E.uniqueNames(['.hidden', '.hidden']), ['.hidden', '.hidden (2)']);
  deepEqual('unique: already unique unchanged', E.uniqueNames(['x.png', 'y.png']), ['x.png', 'y.png']);
  const many = E.uniqueNames(Array.from({ length: 50 }, (_, i) => (i % 3 === 0 ? 'f (2).png' : 'f.png')));
  equal('unique: 50 names all distinct', new Set(many).size, 50);
}

// ---------- sanitizeSheetName ----------
{
  equal('sheet: allowed chars kept', E.sanitizeSheetName('hero_v2.atlas-1'), 'hero_v2.atlas-1');
  equal('sheet: illegal chars replaced', E.sanitizeSheetName('my sheet/图集?'), 'my-sheet');
  equal('sheet: dash runs collapsed', E.sanitizeSheetName('my sheet/ü<1>'), 'my-sheet-1');
  equal('sheet: no ASCII letter or digit → spritesheet', E.sanitizeSheetName('아이콘'), 'spritesheet');
  equal('sheet: dots only → spritesheet', E.sanitizeSheetName('..'), 'spritesheet');
  equal('sheet: empty → spritesheet', E.sanitizeSheetName(''), 'spritesheet');
  equal('sheet: spaces only → spritesheet', E.sanitizeSheetName('   '), 'spritesheet');
  equal('sheet: null → spritesheet', E.sanitizeSheetName(null), 'spritesheet');
  equal('sheet: quotes replaced', E.sanitizeSheetName('a"b\'c<d>'), 'a-b-c-d');
  equal('sheet: RPG Maker MZ $ and ! prefixes kept', E.sanitizeSheetName('$!hero'), '$!hero');
  equal('sheet: $ alone → spritesheet', E.sanitizeSheetName('$'), 'spritesheet');
  check('css: $ sheet name gives a valid class', /^\.hero \{/.test(E.buildCss([], { image: '$hero.png', width: 1, height: 1 })));
}

// ---------- cssClassName ----------
{
  equal('css name: extension removed', E.cssClassName('walk_01.png'), 'walk_01');
  equal('css name: camelCase to kebab', E.cssClassName('WalkLeft.png'), 'walk-left');
  equal('css name: spaces and parens', E.cssClassName('walk (2).png'), 'walk-2');
  equal('css name: CJK letters kept', E.cssClassName('图标.png'), '图标');
  equal('css name: Hangul kept', E.cssClassName('아이콘 홈.png'), '아이콘-홈');
  equal('css name: symbols only → empty', E.cssClassName('@#$.png'), '');
  equal('css name: leading digit kept', E.cssClassName('01.png'), '01');
  equal('css name: only last extension removed', E.cssClassName('icon.small.png'), 'icon-small');
  check('css name: only letters, digits, _ and -', /^[\p{L}\p{N}_-]*$/u.test(E.cssClassName('Ä b@c#D.e.png')));
}

// ---------- svgRasterSize ----------
{
  const size = (src, scale) => E.svgRasterSize(E.analyzeSvg(src), scale);
  deepEqual('svg: width/height', size('<svg width="64" height="32"/>', 1), { w: 64, h: 32 });
  deepEqual('svg: px units', size('<svg width="64px" height="32px" viewBox="0 0 1 1"/>', 1), { w: 64, h: 32 });
  deepEqual('svg: viewBox only', size('<svg viewBox="0 0 24 24"/>', 1), { w: 24, h: 24 });
  deepEqual('svg: viewBox with commas', size('<svg viewBox="0,0,100,50"/>', 1), { w: 100, h: 50 });
  deepEqual('svg: width + viewBox ratio', size('<svg width="200" viewBox="0 0 100 50"/>', 1), { w: 200, h: 100 });
  deepEqual('svg: height + viewBox ratio', size('<svg height="30" viewBox="0 0 100 50"/>', 1), { w: 60, h: 30 });
  // CSS absolute units, as Chrome sizes an <img> (1in = 96px, 1mm = 96/25.4px).
  deepEqual('svg: mm units', size('<svg width="10mm" height="5mm"/>', 1), { w: 38, h: 19 });
  deepEqual('svg: pt units', size('<svg width="12pt" height="24pt"/>', 1), { w: 16, h: 32 });
  deepEqual('svg: em uses font-size', size('<svg width="2em" height="1em" style="font-size:20px"/>', 1), { w: 40, h: 20 });
  deepEqual('svg: percent falls back to viewBox', size('<svg width="100%" height="100%" viewBox="0 0 48 16"/>', 1), { w: 48, h: 16 });
  deepEqual('svg: scale 2', size('<svg viewBox="0 0 24 24"/>', 2), { w: 48, h: 48 });
  deepEqual('svg: scale 3 rounds', size('<svg width="10.5" height="7"/>', 3), { w: 32, h: 21 });
  equal('svg: nothing → null', size('<svg/>', 1), null);
  equal('svg: percent without viewBox → null', size('<svg width="100%" height="100%"/>', 1), null);
  equal('svg: zero viewBox → null', size('<svg viewBox="0 0 0 10"/>', 1), null);
  deepEqual('svg: fractional rounds, min 1', size('<svg width="0.3" height="10.6"/>', 1), { w: 1, h: 11 });
  const noNs = E.analyzeSvg('<svg width="8" height="8"><rect width="8" height="8"/></svg>');
  check('svg: missing xmlns is added by buildSvg', noNs.fixes.includes('xmlns'));
  equal('svg: not an SVG → error', E.analyzeSvg('<html></html>').error.code, 'rootNotSvg');
}

// ---------- trimBounds ----------
function rgbaWith(w, h, pixels) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y, a] of pixels) d[(y * w + x) * 4 + 3] = a === undefined ? 255 : a;
  return d;
}
{
  deepEqual('trim: box', E.trimBounds(rgbaWith(8, 6, [[2, 1], [5, 4], [3, 2]]), 8, 6), { x: 2, y: 1, w: 4, h: 4, empty: false });
  deepEqual('trim: fully transparent keeps 1×1', E.trimBounds(rgbaWith(5, 5, []), 5, 5), { x: 0, y: 0, w: 1, h: 1, empty: true });
  deepEqual('trim: single pixel', E.trimBounds(rgbaWith(4, 4, [[3, 3]]), 4, 4), { x: 3, y: 3, w: 1, h: 1, empty: false });
  deepEqual('trim: alpha 1 counts', E.trimBounds(rgbaWith(4, 4, [[0, 2, 1]]), 4, 4), { x: 0, y: 2, w: 1, h: 1, empty: false });
  deepEqual('trim: corners → full', E.trimBounds(rgbaWith(7, 3, [[0, 0], [6, 2]]), 7, 3), { x: 0, y: 0, w: 7, h: 3, empty: false });
  const full = new Uint8ClampedArray(3 * 2 * 4).fill(255);
  deepEqual('trim: opaque → full', E.trimBounds(full, 3, 2), { x: 0, y: 0, w: 3, h: 2, empty: false });
  deepEqual('trim: color without alpha is transparent', E.trimBounds(new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 9]), 2, 1), { x: 1, y: 0, w: 1, h: 1, empty: false });
  // Brute-force comparison on random images.
  const r = rng(7);
  let ok = true;
  for (let n = 0; n < 50 && ok; n++) {
    const w = 1 + Math.floor(r() * 20), h = 1 + Math.floor(r() * 20);
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) if (r() < 0.05) d[i * 4 + 3] = 1 + Math.floor(r() * 255);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const want = x1 < 0 ? { x: 0, y: 0, w: 1, h: 1, empty: true } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, empty: false };
    const got = E.trimBounds(d, w, h);
    if (JSON.stringify(got) !== JSON.stringify(want)) { ok = false; check('trim: random ' + n, false, JSON.stringify(got) + ' vs ' + JSON.stringify(want)); }
  }
  check('trim: 50 random images match brute force', ok);
}

// ---------- nextPow2 / limits / fill ----------
{
  deepEqual('pow2: values', [0, 1, 2, 3, 5, 64, 65, 1000, 4097].map(E.nextPow2), [1, 1, 2, 4, 8, 64, 128, 1024, 8192]);
  equal('limits: constants', JSON.stringify(E.SSG_LIMITS), JSON.stringify({ maxImages: 1000, maxImageSide: 8192, maxSide: 16384, maxArea: 16777216, webpMaxSide: 16383, gpuSafeSide: 4096 }));
  check('limits: 4096×4096 fits', E.fitsLimits(4096, 4096));
  check('limits: 16384×1024 fits', E.fitsLimits(16384, 1024));
  check('limits: 16385×1 does not fit', !E.fitsLimits(16385, 1));
  check('limits: 1×16385 does not fit', !E.fitsLimits(1, 16385));
  check('limits: 4097×4096 over area', !E.fitsLimits(4097, 4096));
  check('limits: 0 size does not fit', !E.fitsLimits(0, 10));
  equal('fill: ratio', E.fillRatio([{ w: 10, h: 10 }, { w: 5, h: 2 }], 20, 10), 110 / 200);
  equal('fill: zero sheet', E.fillRatio([{ w: 1, h: 1 }], 0, 0), 0);
}

// ---------- packMaxRects ----------
// Each sprite's extruded box is [x-e, x+w+e) × [y-e, y+h+e). Invariants: boxes are at
// least `spacing` apart (horizontally or vertically), at least `margin` from every
// sheet edge, and the sheet respects maxWidth (unless widened) and power of two.
function checkPacking(label, sizes, opts, res) {
  const s = opts.spacing || 0, m = opts.margin || 0, e = opts.extrude || 0;
  const problems = [];
  if (res.rects.length !== sizes.length) problems.push('rect count');
  const boxes = res.rects.map((r, i) => ({ x0: r.x - e, y0: r.y - e, x1: r.x + sizes[i].w + e, y1: r.y + sizes[i].h + e }));
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!Number.isInteger(res.rects[i].x) || !Number.isInteger(res.rects[i].y)) problems.push('non-integer ' + i);
    if (b.x0 < m || b.y0 < m || b.x1 > res.width - m || b.y1 > res.height - m) problems.push('outside margin ' + i + ' ' + JSON.stringify(b) + ' in ' + res.width + '×' + res.height);
    for (let j = i + 1; j < boxes.length; j++) {
      const c = boxes[j];
      const apart = b.x1 + s <= c.x0 || c.x1 + s <= b.x0 || b.y1 + s <= c.y0 || c.y1 + s <= b.y0;
      if (!apart) problems.push('too close ' + i + '/' + j);
    }
  }
  if (!res.widened && res.width > opts.maxWidth) problems.push('width ' + res.width + ' > maxWidth ' + opts.maxWidth);
  if (opts.pot && !(isPow2(res.width) && isPow2(res.height))) problems.push('not power of two ' + res.width + '×' + res.height);
  check(label, problems.length === 0, problems.slice(0, 3).join('; '));
}
{
  const r = rng(20260925);
  let widenedSeen = 0, potSeen = 0;
  for (let n = 0; n < 200; n++) {
    const count = 1 + Math.floor(r() * 60);
    const kind = n % 4;
    const sizes = Array.from({ length: count }, () => {
      if (kind === 0) return { w: 1 + Math.floor(r() * 128), h: 1 + Math.floor(r() * 128) };
      if (kind === 1) return { w: 1 + Math.floor(r() * 400), h: 1 + Math.floor(r() * 12) }; // long strips
      if (kind === 2) return { w: 32, h: 32 };
      return { w: 1 + Math.floor(r() * 16), h: 1 + Math.floor(r() * 300) };
    });
    const opts = {
      maxWidth: [512, 1024, 2048, 4096, 8192][Math.floor(r() * 5)] / (kind === 1 && r() < 0.3 ? 2 : 1),
      spacing: Math.floor(r() * 9),
      margin: Math.floor(r() * 9),
      extrude: Math.floor(r() * 4),
      pot: r() < 0.3,
    };
    if (kind === 1 && n % 8 === 1) opts.maxWidth = 256; // force widening sometimes
    const res = E.packMaxRects(sizes, opts);
    if (res.widened) widenedSeen++;
    if (opts.pot) potSeen++;
    checkPacking('pack random #' + n, sizes, opts, res);
    const widest = Math.max(...sizes.map((z) => z.w + 2 * opts.extrude)) + 2 * opts.margin;
    equal('pack random #' + n + ' widened flag', res.widened, (opts.pot ? E.nextPow2(widest) : widest) > opts.maxWidth);
    check('pack random #' + n + ' fill ≤ 1', E.fillRatio(sizes, res.width, res.height) <= 1);
  }
  check('pack random: some sets widened', widenedSeen > 0, 'widened ' + widenedSeen);
  check('pack random: some sets power of two', potSeen > 0);

  const again = E.packMaxRects([{ w: 10, h: 20 }, { w: 30, h: 5 }, { w: 7, h: 7 }], { maxWidth: 512, spacing: 2 });
  deepEqual('pack: deterministic', E.packMaxRects([{ w: 10, h: 20 }, { w: 30, h: 5 }, { w: 7, h: 7 }], { maxWidth: 512, spacing: 2 }), again);

  deepEqual('pack: empty', E.packMaxRects([], { maxWidth: 2048 }), { width: 0, height: 0, rects: [], widened: false });
  deepEqual('pack: single sprite size', E.packMaxRects([{ w: 30, h: 44 }], { maxWidth: 2048, spacing: 2, margin: 3, extrude: 1 }),
    { width: 30 + 2 + 6, height: 44 + 2 + 6, rects: [{ x: 4, y: 4 }], widened: false });
  deepEqual('pack: single sprite, spacing adds nothing outside', E.packMaxRects([{ w: 16, h: 16 }], { maxWidth: 2048, spacing: 8 }),
    { width: 16, height: 16, rects: [{ x: 0, y: 0 }], widened: false });

  const same = Array.from({ length: 16 }, () => ({ w: 32, h: 32 }));
  const sq = E.packMaxRects(same, { maxWidth: 2048, spacing: 0 });
  deepEqual('pack: 16 × 32² tiles into 128×128', [sq.width, sq.height], [128, 128]);
  equal('pack: 16 × 32² fill 100%', E.fillRatio(same, sq.width, sq.height), 1);
  const sp = E.packMaxRects(same, { maxWidth: 2048, spacing: 2 });
  deepEqual('pack: 16 × 32² with spacing 2 → 134×134', [sp.width, sp.height], [4 * 32 + 3 * 2, 4 * 32 + 3 * 2]);
  checkPacking('pack: 16 × 32² with spacing 2 invariants', same, { maxWidth: 2048, spacing: 2 }, sp);

  const pot = E.packMaxRects([{ w: 100, h: 60 }, { w: 40, h: 40 }], { maxWidth: 1024, pot: true });
  check('pack: pot dims', isPow2(pot.width) && isPow2(pot.height), pot.width + '×' + pot.height);
  // 128×128 and 256×64 have the same area; the squarer one wins.
  deepEqual('pack: pot smallest, squarer on equal area', [pot.width, pot.height], [128, 128]);
  const strip = E.packMaxRects(Array.from({ length: 12 }, () => ({ w: 20, h: 20 })), { maxWidth: 2048, spacing: 4 });
  check('pack: no thin strip when a square is within 10% area', Math.max(strip.width, strip.height) / Math.min(strip.width, strip.height) <= 2,
    strip.width + '×' + strip.height);

  const wide = E.packMaxRects([{ w: 3000, h: 10 }, { w: 20, h: 20 }], { maxWidth: 1024, margin: 2 });
  equal('pack: widened flag', wide.widened, true);
  equal('pack: widened to widest sprite', wide.width, 3004);
  checkPacking('pack: widened invariants', [{ w: 3000, h: 10 }, { w: 20, h: 20 }], { maxWidth: 1024, margin: 2 }, wide);

  const potWide = E.packMaxRects([{ w: 600, h: 10 }], { maxWidth: 512, pot: true });
  deepEqual('pack: pot widened', [potWide.widened, potWide.width, potWide.height], [true, 1024, 16]);

  const tall = Array.from({ length: 40 }, () => ({ w: 500, h: 500 }));
  const tallRes = E.packMaxRects(tall, { maxWidth: 512 });
  equal('pack: over canvas limits reported', E.fitsLimits(tallRes.width, tallRes.height), false);
  checkPacking('pack: over-limit result still valid', tall, { maxWidth: 512 }, tallRes);

  const pref = E.packMaxRects(Array.from({ length: 60 }, () => ({ w: 500, h: 500 })), { maxWidth: 8192 });
  check('pack: prefers a result within limits', E.fitsLimits(pref.width, pref.height), pref.width + '×' + pref.height);

  // Tight packing should beat a naive one-row-per-sprite stack by a wide margin.
  const r2 = rng(99);
  const mixed = Array.from({ length: 80 }, () => ({ w: 8 + Math.floor(r2() * 56), h: 8 + Math.floor(r2() * 56) }));
  const mixedRes = E.packMaxRects(mixed, { maxWidth: 2048, spacing: 0 });
  check('pack: mixed fill ≥ 70%', E.fillRatio(mixed, mixedRes.width, mixedRes.height) >= 0.7,
    'fill ' + E.fillRatio(mixed, mixedRes.width, mixedRes.height).toFixed(3) + ' at ' + mixedRes.width + '×' + mixedRes.height);

  const t0 = Date.now();
  const r3 = rng(1000);
  const big = Array.from({ length: 1000 }, () => ({ w: 4 + Math.floor(r3() * 60), h: 4 + Math.floor(r3() * 60) }));
  const bigRes = E.packMaxRects(big, { maxWidth: 2048, spacing: 2, extrude: 1 });
  const ms = Date.now() - t0;
  checkPacking('pack: 1000 sprites invariants', big, { maxWidth: 2048, spacing: 2, extrude: 1 }, bigRes);
  check('pack: 1000 sprites under 5 s', ms < 5000 * PERF_SLACK, ms + ' ms');
  check('pack: 1000 sprites near square (aspect ≤ 2)', Math.max(bigRes.width, bigRes.height) / Math.min(bigRes.width, bigRes.height) <= 2,
    bigRes.width + '×' + bigRes.height);
  check('pack: 1000 sprites fill ≥ 65%', E.fillRatio(big, bigRes.width, bigRes.height) >= 0.65);
  console.log('info  1000 sprites packed into ' + bigRes.width + '×' + bigRes.height + ' in ' + ms + ' ms, fill ' +
    (E.fillRatio(big, bigRes.width, bigRes.height) * 100).toFixed(1) + '%');
}

// ---------- gridLayout ----------
{
  const sizes = [{ w: 10, h: 10 }, { w: 20, h: 16 }, { w: 6, h: 5 }, { w: 20, h: 16 }, { w: 1, h: 1 }];
  const g = E.gridLayout(sizes, { spacing: 2, margin: 3, extrude: 1 });
  deepEqual('grid: cell = largest w × largest h', [g.cellW, g.cellH], [20, 16]);
  deepEqual('grid: default columns ceil(sqrt(n))', [g.columns, g.rows], [3, 2]);
  equal('grid: width', g.width, 2 * 3 + 3 * (20 + 2) + 2 * 2);
  equal('grid: height', g.height, 2 * 3 + 2 * (16 + 2) + 1 * 2);
  deepEqual('grid: frame 0 is cell', g.frames[0], { x: 4, y: 4, w: 20, h: 16 });
  deepEqual('grid: frame 4 (row 2, col 2)', g.frames[4], { x: 4 + 24, y: 4 + 20, w: 20, h: 16 });
  deepEqual('grid: draw 0 centred', g.draws[0], { x: 4 + 5, y: 4 + 3 });
  deepEqual('grid: draw 2 centred (odd remainder floors)', g.draws[2], { x: 4 + 2 * 24 + 7, y: 4 + 5 });
  deepEqual('grid: full-size draw at cell origin', g.draws[1], { x: g.frames[1].x, y: g.frames[1].y });
  const row = E.gridLayout(sizes, { columns: 99 });
  deepEqual('grid: columns clamp to n (one row)', [row.columns, row.rows, row.width, row.height], [5, 1, 100, 16]);
  const col = E.gridLayout(sizes, { columns: 1 });
  deepEqual('grid: 1 column is a vertical strip', [col.columns, col.rows, col.width, col.height], [1, 5, 20, 80]);
  const zeroCols = E.gridLayout(sizes, { columns: 0 });
  equal('grid: columns 0 → auto', zeroCols.columns, 3);
  const pg = E.gridLayout(sizes, { pot: true, spacing: 2, margin: 3, extrude: 1 });
  deepEqual('grid: pot', [pg.width, pg.height], [128, 64]);
  const empty = E.gridLayout([], {});
  deepEqual('grid: empty', [empty.width, empty.height, empty.frames.length], [0, 0, 0]);
  // Cells never overlap and stay inside the sheet with spacing between extruded cells.
  checkPacking('grid: cell invariants', sizes.map(() => ({ w: g.cellW, h: g.cellH })), { spacing: 2, margin: 3, extrude: 1, maxWidth: Infinity },
    { width: g.width, height: g.height, rects: g.frames.map((f) => ({ x: f.x, y: f.y })), widened: false });
  // Phaser load.spritesheet: frame i at margin' + col·(frameWidth + spacing'), with margin' = m + e, spacing' = s + 2e.
  check('grid: Phaser spritesheet stride', g.frames.every((f, i) => f.x === 3 + 1 + (i % 3) * (20 + 2 + 2) && f.y === 3 + 1 + Math.floor(i / 3) * (16 + 2 + 2)));
}

// ---------- export formats ----------
const frames = [
  { name: 'walk_01.png', x: 2, y: 2, w: 30, h: 44, trimmed: true, sourceX: 17, sourceY: 10, sourceW: 64, sourceH: 64 },
  { name: 'a&b "<q>\'.png', x: 34, y: 0, w: 8, h: 8, trimmed: false, sourceX: 0, sourceY: 0, sourceW: 8, sourceH: 8 },
];
const meta = { image: 'spritesheet.png', width: 256, height: 128 };
{
  const hash = JSON.parse(E.buildJsonHash(frames, meta));
  deepEqual('hash: frame keys in order', Object.keys(hash.frames), ['walk_01.png', 'a&b "<q>\'.png']);
  deepEqual('hash: trimmed frame', hash.frames['walk_01.png'], {
    frame: { x: 2, y: 2, w: 30, h: 44 }, rotated: false, trimmed: true,
    spriteSourceSize: { x: 17, y: 10, w: 30, h: 44 }, sourceSize: { w: 64, h: 64 },
  });
  equal('hash: untrimmed flag', hash.frames['a&b "<q>\'.png'].trimmed, false);
  deepEqual('hash: meta', hash.meta, {
    app: 'https://zerotool.dev/tools/sprite-sheet-generator/', version: '1.0', image: 'spritesheet.png',
    format: 'RGBA8888', size: { w: 256, h: 128 }, scale: '1',
  });
  deepEqual('hash: entry key order', Object.keys(hash.frames['walk_01.png']), ['frame', 'rotated', 'trimmed', 'spriteSourceSize', 'sourceSize']);
  const proto = JSON.parse(E.buildJsonHash([{ ...frames[1], name: '__proto__' }], meta));
  check('hash: __proto__ name is a normal key', Object.prototype.hasOwnProperty.call(proto.frames, '__proto__'));

  const arr = JSON.parse(E.buildJsonArray(frames, meta));
  check('array: frames is an array', Array.isArray(arr.frames) && arr.frames.length === 2);
  deepEqual('array: entry keys', Object.keys(arr.frames[0]), ['filename', 'frame', 'rotated', 'trimmed', 'spriteSourceSize', 'sourceSize']);
  equal('array: filename', arr.frames[1].filename, 'a&b "<q>\'.png');
  deepEqual('array: same meta as hash', arr.meta, hash.meta);

  const xml = E.buildXml(frames, meta);
  check('xml: declaration', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<TextureAtlas imagePath="spritesheet.png">\n'));
  check('xml: trimmed SubTexture', xml.includes('<SubTexture name="walk_01.png" x="2" y="2" width="30" height="44" frameX="-17" frameY="-10" frameWidth="64" frameHeight="64"/>'));
  check('xml: untrimmed omits frame attributes, escapes name',
    xml.includes('<SubTexture name="a&amp;b &quot;&lt;q&gt;&apos;.png" x="34" y="0" width="8" height="8"/>'), xml);
  check('xml: closes', xml.endsWith('</TextureAtlas>\n'));
  const xml2 = E.buildXml([{ ...frames[1], name: 'bad\u0001name.png' }], { ...meta, image: 'a&b.png' });
  check('xml: control chars removed, imagePath escaped', xml2.includes('name="badname.png"') && xml2.includes('imagePath="a&amp;b.png"'));
  const rawAttr = /="([^"]*)"/g;
  let m, clean = true;
  while ((m = rawAttr.exec(xml))) if (/[<&](?!amp;|lt;|gt;|quot;|apos;)/.test(m[1])) clean = false;
  check('xml: no raw < or & in attributes', clean);

  const css = E.buildCss(frames, meta);
  check('css: base class', css.startsWith('.spritesheet {\n  display: inline-block;\n  background-image: url("spritesheet.png");\n  background-repeat: no-repeat;\n}\n'));
  check('css: frame rule', css.includes('.spritesheet-walk_01 {\n  width: 30px;\n  height: 44px;\n  background-position: -2px -2px;\n}'));
  check('css: zero position written as 0', css.includes('.spritesheet-a-b-q {\n  width: 8px;\n  height: 8px;\n  background-position: -34px 0;\n}'), css);
  const dcss = E.buildCss([{ ...frames[1], name: '01.png' }], { ...meta, image: '8bit.png' });
  check('css: prefix starting with digit gets sprite-', dcss.startsWith('.sprite-8bit {') && dcss.includes('.sprite-8bit-01 {'), dcss);
  const dup = E.buildCss([
    { ...frames[1], name: 'walk.png' }, { ...frames[1], name: 'walk.jpg' }, { ...frames[1], name: 'Walk.gif' }, { ...frames[1], name: '图.png' }, { ...frames[1], name: '@#.png' },
  ], meta);
  check('css: colliding tokens deduplicated', ['.spritesheet-walk {', '.spritesheet-walk-2 {', '.spritesheet-walk-3 {', '.spritesheet-图 {', '.spritesheet-frame {'].every((s) => dup.includes(s)), dup);
  const selectors = css.match(/^\.[^\s{]+/gm);
  check('css: selectors are valid identifiers', selectors.every((s) => /^\.-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(s)), selectors.join(' '));
}

// ---------- declarations copied from other tools are identical ----------
function engineBlockOf(src) {
  const s = src.indexOf(START_MARK), e = src.indexOf(END_MARK);
  return s >= 0 && e > s ? src.slice(s, e) : null;
}
// Top-level declarations of an engine block only (6-space indent), so a local
// `var num` inside another function is not taken for `function num`.
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)( {6})(function\\*? ' + name + '\\(|var ' + name + ' =)');
  const m = re.exec(src);
  if (!m) return null;
  const start = m.index + m[1].length;
  const eol = src.indexOf('\n', start);
  const head = src.slice(start, eol < 0 ? src.length : eol);
  const bal = (t) => (t.match(/[{(\[]/g) || []).length === (t.match(/[})\]]/g) || []).length;
  if (/;\s*$/.test(head) && bal(head)) return head;
  if (/^[ \t]*function/.test(head) && /\}\s*$/.test(head) && bal(head)) return head;
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { const e = src.indexOf('\n', i); return src.slice(start, e < 0 ? src.length : e); }
  }
  return null;
}
function dedent(s) {
  const lines = s.split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)[0].length));
  return lines.map((l) => l.slice(ind)).join('\n');
}
{
  const COPIES = [
    ['GifSplitterTool.astro', ['GS_LIMITS', 'isGif', 'scanSubBlocks', 'readSubBlocks', 'parseGif', 'createLzw', 'lzwRun', 'interlaceRows', 'blitRange', 'clearRect', 'frameDurationMs', 'compositeSteps', 'createCompositor', 'checkBudget', 'baseName', 'padFrameNo', 'frameFileName']],
    ['SvgToPngConverterTool.astro', ['SVG_NS', 'XLINK_NS', 'ABS_UNITS', 'hasOwn', 'parseLength', 'parseStyle', 'parseViewBox', 'intrinsicSize', 'decodeXml', 'skipDeclaration', 'TAG_NAME', 'ATTR_NAME', 'SPACE', 'readStartTag', 'scanMarkup', 'attrOf', 'isLocalRef', 'cssRefs', 'analyzeSvg', 'num', 'buildSvg']],
  ];
  for (const [file, names] of COPIES) {
    const other = engineBlockOf(readFileSync(join(root, 'src/components/tools', file), 'utf8'));
    for (const name of names) {
      const a = extractDecl(block, name);
      const b = other && extractDecl(other, name);
      check('copy: ' + name + ' is identical to ' + file, a !== null && b !== null && dedent(a) === dedent(b));
    }
  }
}

// ---------- folders and frame names ----------
{
  equal('folder: drop entry path drops the folder', E.folderPath('/hero/walk/01.png'), 'walk/01.png');
  equal('folder: webkitRelativePath drops the folder', E.folderPath('hero/01.png'), '01.png');
  equal('folder: a file at the top keeps its name', E.folderPath('/coin.png'), 'coin.png');
  check('image path: extensions', ['a.png', 'b.JPG', 'c.jpeg', 'd.webp', 'e.gif', 'f.svg', 'g.bmp', 'h.avif'].every(E.isImagePath));
  check('image path: others', !['notes.txt', 'a.png.txt', 'sheet.psd', 'README'].some(E.isImagePath));
  check('hidden: dot files and folders', ['.DS_Store', 'walk/.DS_Store', '.git/x.png', '__MACOSX/walk/._01.png', 'walk/Thumbs.db', 'desktop.ini'].every(E.isHiddenPath));
  check('hidden: normal paths', !['walk/01.png', 'a.b/c.png'].some(E.isHiddenPath));
  equal('strip: extension', E.stripExt('walk/01.png'), 'walk/01');
  equal('strip: last extension only', E.stripExt('icon.small.png'), 'icon.small');
  equal('strip: dot in folder name', E.stripExt('v1.2/idle'), 'v1.2/idle');
  equal('strip: name that is only an extension', E.stripExt('.png'), '.png');
  deepEqual('names: keep extensions', E.frameNames(['walk/01.png', 'walk/01.png'], true), ['walk/01.png', 'walk/01 (2).png']);
  deepEqual('names: without extensions, collisions numbered', E.frameNames(['idle.png', 'idle.gif', 'run.png'], false), ['idle', 'idle (2)', 'run']);
  deepEqual('unique: path with extension', E.uniqueNames(['a/b.png', 'a/b.png']), ['a/b.png', 'a/b (2).png']);
  check('natural: sorts paths', E.naturalCompare('walk/2.png', 'walk/10.png') < 0 && E.naturalCompare('idle/9.png', 'walk/1.png') < 0);
  equal('css name: folder separator', E.cssClassName('walk/left_01.png'), 'walk-left_01');
}

// ---------- pixel hashes and aliases ----------
{
  const r = rng(42);
  const data = new Uint8Array(37 * 23 * 4).map(() => Math.floor(r() * 256));
  const words = (u8, from, to) => new Uint32Array(u8.buffer.slice(from * 4, to * 4));
  const one = E.pixelHashKey(E.pixelHashUpdate(E.pixelHashStart(), words(data, 0, 37 * 23)), 37, 23);
  const parts = E.pixelHashStart();
  E.pixelHashUpdate(parts, words(data, 0, 37 * 5));
  E.pixelHashUpdate(parts, words(data, 37 * 5, 37 * 23));
  equal('hash: strips give the same key', E.pixelHashKey(parts, 37, 23), one);
  const other = data.slice();
  other[100] ^= 1;
  check('hash: one changed bit changes the key', E.pixelHashKey(E.pixelHashUpdate(E.pixelHashStart(), words(other, 0, 37 * 23)), 37, 23) !== one);
  check('hash: size is part of the key', E.pixelHashKey(E.pixelHashUpdate(E.pixelHashStart(), words(data, 0, 37 * 23)), 23, 37) !== one);
  // 20,000 random 4×4 images: no two different images share a key.
  const seen = new Map();
  let collisions = 0;
  for (let n = 0; n < 20000; n++) {
    const px = new Uint8Array(64).map(() => Math.floor(r() * 256));
    const key = E.pixelHashKey(E.pixelHashUpdate(E.pixelHashStart(), new Uint32Array(px.buffer)), 4, 4);
    const hex = Buffer.from(px).toString('hex');
    if (seen.has(key) && seen.get(key) !== hex) collisions++;
    seen.set(key, hex);
  }
  equal('hash: no collisions in 20,000 random images', collisions, 0);
  deepEqual('alias: first of each key', E.aliasIndex(['a', 'b', 'a', null, 'b', null]), [0, 1, 0, 3, 1, 5]);
}

// ---------- layoutSheet ----------
function item(name, w, h, trim, key) {
  return { name, w, h, trim: trim || { x: 0, y: 0, w, h }, keyFull: key ? key + ':full' : null, keyTrim: key ? key + ':trim' : null };
}
const LIST = [
  item('walk_01.png', 64, 64, { x: 17, y: 10, w: 30, h: 44 }, 'w1'),
  item('walk_02.png', 64, 64, { x: 18, y: 10, w: 30, h: 44 }, 'w2'),
  item('walk_03.png', 64, 64, { x: 19, y: 10, w: 30, h: 44 }, 'w3'),
  { ...item('walk_04.png', 64, 64, { x: 21, y: 12, w: 30, h: 44 }), keyFull: 'w4:full', keyTrim: 'w1:trim' },
  item('empty.png', 32, 32, { x: 0, y: 0, w: 1, h: 1 }, 'e'),
  item('banner.png', 300, 60, null, 'b'),
];
const OPTS = { layout: 'packed', maxWidth: 512, spacing: 2, margin: 0, extrude: 1, pot: false, trim: true, alias: true };
{
  const L = E.layoutSheet(LIST, OPTS);
  equal('layout: frame per item', L.frames.length, 6);
  equal('layout: identical trimmed pixels packed once', L.unique, 5);
  equal('layout: one draw per unique image', L.draws.length, 5);
  deepEqual('layout: alias shares the frame rectangle', [L.frames[3].x, L.frames[3].y, L.frames[3].w, L.frames[3].h], [L.frames[0].x, L.frames[0].y, L.frames[0].w, L.frames[0].h]);
  deepEqual('layout: alias keeps its own offset', [L.frames[3].sourceX, L.frames[3].sourceY], [21, 12]);
  check('layout: trimmed flags', L.frames[0].trimmed && L.frames[4].trimmed && !L.frames[5].trimmed);
  checkPacking('layout: packed invariants', L.draws.map((d) => ({ w: d.sw, h: d.sh })), { spacing: 2, extrude: 1, maxWidth: 512 },
    { width: L.width, height: L.height, rects: L.draws.map((d) => ({ x: d.dx, y: d.dy })), widened: false });
  const noAlias = E.layoutSheet(LIST, { ...OPTS, alias: false });
  equal('layout: alias off packs all', noAlias.unique, 6);
  const noTrim = E.layoutSheet(LIST, { ...OPTS, trim: false });
  equal('layout: trim off compares whole images (w4 differs)', noTrim.unique, 6);
  check('layout: trim off keeps full frames', noTrim.frames.every((f, i) => f.w === LIST[i].w && f.h === LIST[i].h && !f.trimmed));
  const grid = E.layoutSheet(LIST, { ...OPTS, layout: 'grid', columns: 3 });
  equal('layout: grid never merges', grid.unique, 6);
  deepEqual('layout: grid cell', [grid.frames[0].w, grid.frames[0].h], [300, 64]);
}

// ---------- animations by name ----------
{
  deepEqual('anim: groups by trailing number', E.detectAnimations(['walk_10.png', 'walk_2.png', 'walk_01.png', 'idle.png', 'jump-1.png', 'jump-2.png', 'hero/run 1', 'hero/run 2']),
    { walk: ['walk_01.png', 'walk_2.png', 'walk_10.png'], jump: ['jump-1.png', 'jump-2.png'], 'hero/run': ['hero/run 1', 'hero/run 2'] });
  equal('anim: single frames give nothing', E.detectAnimations(['a1.png', 'b1.png', 'c.png']), null);
  equal('anim: number-only names give nothing', E.detectAnimations(['1.png', '2.png']), null);
  deepEqual('anim: PixiJS doc example', E.detectAnimations(['enemy1.png', 'enemy2.png']), { enemy: ['enemy1.png', 'enemy2.png'] });
  deepEqual('anim: GIF frame names', E.detectAnimations(['coin-frame-001.png', 'coin-frame-002.png']), { 'coin-frame': ['coin-frame-001.png', 'coin-frame-002.png'] });
  const hash = JSON.parse(E.buildJsonHash([
    { name: 'walk_02.png', x: 0, y: 0, w: 1, h: 1, trimmed: false, sourceX: 0, sourceY: 0, sourceW: 1, sourceH: 1 },
    { name: 'walk_01.png', x: 2, y: 0, w: 1, h: 1, trimmed: false, sourceX: 0, sourceY: 0, sourceW: 1, sourceH: 1 },
  ], meta));
  deepEqual('hash: animations between frames and meta', Object.keys(hash), ['frames', 'animations', 'meta']);
  deepEqual('hash: animation order by number', hash.animations.walk, ['walk_01.png', 'walk_02.png']);
  check('hash: no animations key without groups', !('animations' in JSON.parse(E.buildJsonHash(frames, meta))));
  check('array: no animations key', !('animations' in JSON.parse(E.buildJsonArray([
    { name: 'a1', x: 0, y: 0, w: 1, h: 1, sourceX: 0, sourceY: 0, sourceW: 1, sourceH: 1 },
    { name: 'a2', x: 2, y: 0, w: 1, h: 1, sourceX: 0, sourceY: 0, sourceW: 1, sourceH: 1 }], meta))));
}

// ---------- CSS pixel ratio and export notes ----------
{
  const hd = [{ name: 'home@2x.png', x: 52, y: 0, w: 48, h: 48, trimmed: false, sourceX: 0, sourceY: 0, sourceW: 48, sourceH: 48 }];
  const css2 = E.buildCss(hd, { image: 'icons.png', width: 100, height: 48, ratio: 2 });
  check('css 2x: background-size is half the sheet', css2.includes('  background-size: 50px 24px;\n}'), css2);
  check('css 2x: frame halved', css2.includes('.icons-home-2x {\n  width: 24px;\n  height: 24px;\n  background-position: -26px 0;\n}'), css2);
  check('css 1x: no background-size', !E.buildCss(hd, { image: 'icons.png', width: 100, height: 48, ratio: 1 }).includes('background-size'));
  const css3 = E.buildCss([{ ...hd[0], x: 50, w: 47 }], { image: 'i.png', width: 100, height: 48, ratio: 3 });
  check('css 3x: decimals kept to 3 places', css3.includes('width: 15.667px;') && css3.includes('background-position: -16.667px 0;'), css3);

  const note = (o) => E.exportNotes({ format: 'hash', imageFormat: 'png', frames: [], width: 100, height: 100, ratio: 1, ...o }).map((n) => n.code);
  const trimmed = [{ name: 'a', x: 0, y: 0, w: 2, h: 2, trimmed: true }];
  deepEqual('notes: none for a small JSON sheet', note({}), []);
  deepEqual('notes: XML with trimmed frames', note({ format: 'xml', frames: trimmed }), ['xmlTrim']);
  deepEqual('notes: XML without trim', note({ format: 'xml', frames: [{ ...trimmed[0], trimmed: false }] }), []);
  deepEqual('notes: CSS with trimmed frames', note({ format: 'css', frames: trimmed }), ['cssTrim']);
  deepEqual('notes: CSS 2x with odd values', note({ format: 'css', ratio: 2, frames: [{ name: 'a', x: 0, y: 0, w: 3, h: 2, trimmed: false }] }), ['cssFraction']);
  deepEqual('notes: CSS 2x all even', note({ format: 'css', ratio: 2, frames: [{ name: 'a', x: 0, y: 0, w: 4, h: 2, trimmed: false }] }), []);
  const frac = E.exportNotes({ format: 'css', imageFormat: 'png', frames: [{ name: 'a', x: 0, y: 0, w: 3, h: 2 }], width: 100, height: 100, ratio: 2 })[0];
  equal('notes: fraction example', frac.example, '3 px → 1.5 px');
  deepEqual('notes: side above 4096', note({ width: 4097, height: 100 }), ['gpu']);
  deepEqual('notes: 4096 is fine', note({ width: 4096, height: 4096 }), []);
  const webp = E.exportNotes({ format: 'hash', imageFormat: 'webp', frames: [], width: 16384, height: 1, ratio: 1 });
  deepEqual('notes: WebP above 16,383 is an error', webp.map((n) => n.code + ':' + n.kind), ['webpTooBig:error', 'gpu:info']);
  deepEqual('notes: PNG 16,384 is not', note({ width: 16384, height: 1 }), ['gpu']);
}

// ---------- every frame of an animated GIF (written by sharp) ----------
{
  const W = 6, H = 4, N = 3;
  const colors = [[255, 0, 0], [0, 128, 255], [40, 200, 40]];
  const raw = Buffer.alloc(W * H * N * 4);
  for (let f = 0; f < N; f++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = ((f * H + y) * W + x) * 4;
    const on = x === f + 1 && y >= 1;   // a 1-px bar that moves right; the rest is transparent
    if (on) { raw[o] = colors[f][0]; raw[o + 1] = colors[f][1]; raw[o + 2] = colors[f][2]; raw[o + 3] = 255; }
  }
  const gifBytes = await sharp(raw, { raw: { width: W, height: H * N, channels: 4, pageHeight: H } }).gif({ delay: [100, 100, 100], loop: 0 }).toBuffer();
  const gif = E.parseGif(new Uint8Array(gifBytes));
  equal('gif: sharp wrote 3 frames', gif.frames.length, 3);
  check('gif: within the decoding budget', E.checkBudget(gif).ok);
  const comp = E.createCompositor(gif, 0);
  const out = [];
  let f;
  while ((f = comp.step()) !== null) if (f) out.push(f);
  equal('gif: 3 composited frames', out.length, 3);
  const matches = out.every((fr, i) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, src = ((i * H + y) * W + x) * 4;
      if (fr.rgba[o + 3] !== raw[src + 3]) return false;
      if (raw[src + 3] && (fr.rgba[o] !== raw[src] || fr.rgba[o + 1] !== raw[src + 1] || fr.rgba[o + 2] !== raw[src + 2])) return false;
    }
    return true;
  });
  check('gif: each frame equals the source frame (disposal clears the old bar)', matches);
  deepEqual('gif: frame names match the GIF Splitter', out.map((fr) => E.frameFileName(E.baseName('walk/coin.gif'), fr.index + 1, comp.total, 'png')),
    ['walk/coin-frame-001.png', 'walk/coin-frame-002.png', 'walk/coin-frame-003.png']);
  const still = await sharp({ create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).gif().toBuffer();
  equal('gif: a still GIF has one frame (added as a normal image)', E.parseGif(new Uint8Array(still)).frames.length, 1);
}

// ---------- recorded engine parsers (Phaser 3.90.0 / 4.2.1, PixiJS 8.22.0) ----------
const FIXTURE_PATH = join(root, 'scripts/test-sprite-sheet-generator.fixtures.json');
const CASES = [
  { id: 'packed-trim-alias', list: LIST, opts: OPTS },
  { id: 'packed-no-trim', list: LIST, opts: { ...OPTS, trim: false, alias: false, extrude: 0 } },
  { id: 'grid', list: LIST.slice(0, 4), opts: { ...OPTS, layout: 'grid', columns: 2 } },
];
function caseOutputs(c) {
  const L = E.layoutSheet(c.list, c.opts);
  const m = { image: 'hero.png', width: L.width, height: L.height };
  return { frames: L.frames, width: L.width, height: L.height, hash: E.buildJsonHash(L.frames, m), array: E.buildJsonArray(L.frames, m), xml: E.buildXml(L.frames, m) };
}

async function regenerate(dir) {
  const req = createRequire(join(dir, 'package.json'));
  const ver = (pkg) => JSON.parse(readFileSync(join(dir, 'node_modules', pkg, 'package.json'), 'utf8')).version;
  const versions = { phaser3: ver('phaser3'), phaser4: ver('phaser'), pixi: ver('pixi.js'), xmldom: ver('@xmldom/xmldom') };
  const { DOMParser } = req('@xmldom/xmldom');
  const pixiLib = join(dir, 'node_modules/pixi.js/lib');
  const { Spritesheet } = await import(pathToFileURL(join(pixiLib, 'spritesheet/Spritesheet.mjs')));
  const { Texture } = await import(pathToFileURL(join(pixiLib, 'rendering/renderers/shared/texture/Texture.mjs')));
  const { TextureSource } = await import(pathToFileURL(join(pixiLib, 'rendering/renderers/shared/texture/sources/TextureSource.mjs')));
  function phaserParse(pkg, parser, width, height, data) {
    const base = join(dir, 'node_modules', pkg, 'src/textures');
    const Frame = req(join(base, 'Frame.js'));
    const parse = req(join(base, 'parsers', parser + '.js'));
    const texture = {
      source: [{ width, height, isRenderTexture: false, glTexture: null }], frames: {}, customData: {},
      add(name, si, x, y, w, h) { if (this.frames[name]) return null; const f = new Frame(this, name, si, x, y, w, h); this.frames[name] = f; return f; },
    };
    parse(texture, 0, data);
    const out = {};
    for (const [name, f] of Object.entries(texture.frames)) {
      if (name === '__BASE') continue;
      out[name] = { cut: [f.cutX, f.cutY, f.cutWidth, f.cutHeight], xy: [f.x, f.y], real: [f.realWidth, f.realHeight], trimmed: !!f.trimmed };
    }
    return out;
  }
  function pixiParse(width, height, data) {
    const sheet = new Spritesheet(new Texture({ source: new TextureSource({ width, height }) }), data);
    sheet.parseSync();
    const out = { textures: {}, animations: {} };
    for (const [name, t] of Object.entries(sheet.textures)) {
      out.textures[name] = { frame: [t.frame.x, t.frame.y, t.frame.width, t.frame.height], orig: [t.orig.width, t.orig.height], trim: t.trim ? [t.trim.x, t.trim.y, t.trim.width, t.trim.height] : null };
    }
    for (const [name, list] of Object.entries(sheet.animations)) out.animations[name] = list.map((t) => t.label);
    return out;
  }
  const cases = CASES.map((c) => {
    const o = caseOutputs(c);
    // xmldom parses the XML; browsers also expose attributes by name (attributes.x.value),
    // which xmldom's NamedNodeMap does not, so the elements are wrapped.
    const parsedXml = new DOMParser().parseFromString(o.xml, 'text/xml');
    const xmlDoc = {
      getElementsByTagName(tag) {
        return Array.from(parsedXml.getElementsByTagName(tag)).map((el) => {
          const attributes = {};
          for (let i = 0; i < el.attributes.length; i++) attributes[el.attributes[i].name] = { value: el.attributes[i].value };
          return { attributes };
        });
      },
    };
    return {
      id: c.id, hash: o.hash, array: o.array, xml: o.xml,
      parsed: {
        phaser3: { hash: phaserParse('phaser3', 'JSONHash', o.width, o.height, JSON.parse(o.hash)), array: phaserParse('phaser3', 'JSONArray', o.width, o.height, JSON.parse(o.array)), xml: phaserParse('phaser3', 'AtlasXML', o.width, o.height, xmlDoc) },
        phaser4: { hash: phaserParse('phaser', 'JSONHash', o.width, o.height, JSON.parse(o.hash)), array: phaserParse('phaser', 'JSONArray', o.width, o.height, JSON.parse(o.array)), xml: phaserParse('phaser', 'AtlasXML', o.width, o.height, xmlDoc) },
        pixi: { hash: pixiParse(o.width, o.height, JSON.parse(o.hash)), array: pixiParse(o.width, o.height, JSON.parse(o.array)) },
      },
    };
  });
  writeFileSync(FIXTURE_PATH, JSON.stringify({ versions, recorded: new Date().toISOString().slice(0, 10), cases }, null, 1) + '\n');
  console.log('wrote ' + FIXTURE_PATH + ' with ' + JSON.stringify(versions));
}

const regenIndex = process.argv.indexOf('--regenerate');
if (regenIndex > 0) await regenerate(process.argv[regenIndex + 1]);
{
  const fx = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
  deepEqual('engines: recorded versions', fx.versions, { phaser3: '3.90.0', phaser4: '4.2.1', pixi: '8.22.0', xmldom: '0.9.8' });
  for (const c of CASES) {
    const rec = fx.cases.find((x) => x.id === c.id);
    const o = caseOutputs(c);
    check('engines ' + c.id + ': exports unchanged since the parse was recorded', rec && rec.hash === o.hash && rec.array === o.array && rec.xml === o.xml,
      'rerun with --regenerate');
    if (!rec) continue;
    const want = (f) => ({ cut: [f.x, f.y, f.w, f.h], xy: f.trimmed ? [f.sourceX, f.sourceY] : [0, 0], real: [f.sourceW, f.sourceH], trimmed: !!f.trimmed });
    for (const v of ['phaser3', 'phaser4']) {
      for (const kind of ['hash', 'array']) {
        deepEqual('engines ' + c.id + ': ' + v + ' ' + kind + ' frames', o.frames.map((f) => rec.parsed[v][kind][f.name]), o.frames.map(want));
      }
    }
    deepEqual('engines ' + c.id + ': Phaser 4 XML frames', o.frames.map((f) => rec.parsed.phaser4.xml[f.name]), o.frames.map(want));
    // Phaser 3.90 AtlasXML passes the trimmed size as the original size (Phaser issue #7245).
    deepEqual('engines ' + c.id + ': Phaser 3 XML (trimmed frames get the trimmed size)', o.frames.map((f) => rec.parsed.phaser3.xml[f.name]),
      o.frames.map((f) => (f.trimmed ? { ...want(f), real: [f.w, f.h] } : want(f))));
    deepEqual('engines ' + c.id + ': PixiJS hash textures', o.frames.map((f) => rec.parsed.pixi.hash.textures[f.name]),
      o.frames.map((f) => ({ frame: [f.x, f.y, f.w, f.h], orig: [f.sourceW, f.sourceH], trim: f.trimmed ? [f.sourceX, f.sourceY, f.w, f.h] : null })));
    deepEqual('engines ' + c.id + ': PixiJS animations', rec.parsed.pixi.hash.animations, JSON.parse(o.hash).animations || {});
    deepEqual('engines ' + c.id + ': PixiJS keys JSON Array frames by index', Object.keys(rec.parsed.pixi.array.textures), o.frames.map((_, i) => String(i)));
  }
}

// ---------- strings and page script ----------
{
  const fm = source.slice(0, source.indexOf('\n---', 4));
  const S = new Function(fm.slice(fm.indexOf('const STRINGS = ') + 'const STRINGS = '.length, fm.indexOf('// strings:end')).replace(/;\s*$/, '').replace(/^/, 'return '))();
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(S.en).sort();
  for (const l of langs) deepEqual('strings: ' + l + ' has the same keys as en', Object.keys(S[l]).sort(), keys);
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const l of langs) for (const k of keys.filter(k => typeof S.en[k] === 'string')) equal('strings: ' + l + '.' + k + ' placeholders', ph(S[l][k]), ph(S.en[k]));
  const script = source.slice(source.indexOf('<script is:inline'), source.indexOf('</script>'));
  const used = new Set([...script.matchAll(/\bt\.(\w+)/g)].map((m) => m[1]));
  for (const k of used) check('strings: t.' + k + ' exists', keys.includes(k));
  const markup = source.slice(fm.length, source.indexOf('<script is:inline'));
  for (const k of [...markup.matchAll(/\{T\.(\w+)/g)].map((m) => m[1])) check('strings: T.' + k + ' exists', keys.includes(k));
  check('script: no direct storage, network or eval', !/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon|\beval\(/.test(script));
  check('script: options saved through ztPersist', script.includes('window.ztPersist.save(SLUG, prefs)'));
}

// ---------- page examples marked {/* ssg-check: {...} */} ----------
{
  const DEFAULT_OPTS = { layout: 'packed', maxWidth: 2048, spacing: 2, margin: 0, extrude: 0, pot: false, trim: true, alias: true };
  const BUILD = { hash: E.buildJsonHash, array: E.buildJsonArray, xml: E.buildXml, css: E.buildCss };
  let total = 0;
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/sprite-sheet-generator', lang + '.mdx'), 'utf8');
    const marks = [...mdx.matchAll(/\{\/\* ssg-check: (\{.*?\}) \*\/\}/g)];
    check('page ' + lang + ': has examples marked ssg-check', marks.length >= 2, marks.length + ' marks');
    marks.forEach((m, n) => {
      total++;
      const c = JSON.parse(m[1]);
      const list = c.items.map(([name, w, h, trim, key]) => ({
        name, w, h, trim: trim ? { x: trim[0], y: trim[1], w: trim[2], h: trim[3] } : { x: 0, y: 0, w, h },
        keyFull: (key || name) + ':f', keyTrim: (key || name) + ':t',
      }));
      const L = E.layoutSheet(list, { ...DEFAULT_OPTS, ...(c.opts || {}) });
      const label = 'page ' + lang + ' example ' + (n + 1);
      if (c.expect.size) deepEqual(label + ': sheet size', [L.width, L.height], c.expect.size);
      if (c.expect.unique) equal(label + ': unique images', L.unique, c.expect.unique);
      const out = BUILD[c.format || 'hash'](L.frames, { image: c.image || 'spritesheet.png', width: L.width, height: L.height, ratio: c.ratio || 1 });
      for (const t of c.text || []) {
        check(label + ': output contains ' + JSON.stringify(t), out.includes(t), out.slice(0, 400));
        check(label + ': page shows ' + JSON.stringify(t), mdx.includes(t));
      }
      if (c.notes) deepEqual(label + ': export notes', E.exportNotes({ format: c.format || 'hash', imageFormat: 'png', frames: L.frames, width: L.width, height: L.height, ratio: c.ratio || 1 }).map((x) => x.code), c.notes);
    });
  }
  check('page examples: at least 8 checked', total >= 8, total + ' checked');
}


// ---------- actual page lifecycle: delayed canvas and directory APIs ----------
// Only DOM/canvas/file-system APIs are doubled. The complete shipped IIFE runs unchanged.
function loadSpritePage({ deferBitmap = [] } = {}) {
  const ids = new Map(), timers = new Map(), urls = new Map(), downloads = [], blobs = [], decoded = [], pendingBitmaps = [], scrolls = [];
  const document = { activeElement: null, listeners: {} };
  let serial = 0;
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const attrs = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      const plain = part.trim().replace(/\[[^\]]+\]/g, ''), id = /#([\w-]+)/.exec(plain), tag = /^[\w-]+/.exec(plain);
      return (!id || el.id === id[1]) && (!tag || el.tagName === tag[0].toUpperCase()) &&
        [...plain.matchAll(/\.([\w-]+)/g)].every(c => el.classList.contains(c[1])) &&
        attrs.every(a => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), id: '', type: tag === 'input' ? 'text' : '', value: '', hidden: false, checked: false, disabled: false, attrs: {}, dataset: {}, style: {}, className: '', children: [], listeners: {}, parentElement: null, draws: [] }); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c, value) { const on = value ?? !this.contains(c); on ? this.add(c) : this.remove(c); return on; } }; }
    set width(v) { this._width = v; this.draws = []; }
    get width() { return this._width || 0; }
    set height(v) { this._height = v; this.draws = []; }
    get height() { return this._height || 0; }
    set textContent(v) { this.text = String(v); this.children.forEach(c => { c.parentElement = null; }); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
    set innerHTML(v) { this.textContent = v; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (['id', 'type', 'name', 'value'].includes(k)) this[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'hidden') this.hidden = true; if (k === 'checked') this.checked = true; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return this.attrs[k] ?? null; }
    removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; }
    appendChild(el) { if (el.tagName === '#FRAGMENT') { [...el.children].forEach(c => this.appendChild(c)); return el; } el.remove(); this.children.push(el); el.parentElement = this; return el; }
    removeChild(el) { el.remove(); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; }
    contains(el) { return el === this || this.children.some(c => c.contains(el)); }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(matches(c, selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, init = {}) { const event = { type, target: this, preventDefault() {}, stopPropagation() {}, ...init }; for (const fn of this.listeners[type] || []) fn.call(this, event); }
    click() { if (this.disabled) return; this.clickCount = (this.clickCount || 0) + 1; if (this.tagName === 'A') downloads.push({ name: this.download, blob: urls.get(this.href) }); this.dispatch('click'); }
    focus() { document.activeElement = this; }
    select() {}
    getBoundingClientRect() { return { top: this.rectTop ?? 200, left: 0, width: 100, height: 100 }; }
    getContext() {
      const el = this;
      return { clearRect() { el.draws = []; }, drawImage(source) { el.draws.push(source.fixture || source.draws?.join('|') || 'canvas'); el.pixel = source.pixel || 1; }, getImageData(x, y, w, h) { const data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < data.length; i += 4) { data[i] = el.pixel || 1; data[i + 3] = 255; } return { data }; } };
    }
    toDataURL(type) { return 'data:' + type + ';base64,fixture'; }
    toBlob(callback, type) { const snapshot = new Blob([JSON.stringify({ width: this.width, height: this.height, pixels: [...this.draws] })], { type }); blobs.push({ callback, snapshot }); }
  }
  const body = new Element('body'); document.body = body;
  function build(node, parent) {
    if (node.nodeName === '#text') return;
    const el = new Element(node.tagName || '#fragment');
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    if (el.id) ids.set(el.id, el);
    parent.appendChild(el);
    for (const child of node.childNodes || []) build(child, el);
  }
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script is:inline'));
  for (const node of parseFragment(markup).childNodes) build(node, body);
  const wrap = ids.get('ssg-wrap'), get = id => { if (!ids.has(id)) throw new Error('Missing actual markup id: ' + id); return ids.get(id); };
  Object.assign(document, { getElementById: get, querySelector: s => s === '.tool-widget' ? wrap : s === '.tool-widget .btn-primary' ? wrap.querySelector('.btn-primary') : body.querySelector(s), createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag), createDocumentFragment: () => new Element('#fragment'), createTextNode: text => { const el = new Element('#text'); el.textContent = text; return el; }, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, execCommand: () => true });
  const fm = source.slice(0, source.indexOf('\n---', 4));
  const runtimeStrings = vm.runInNewContext(fm.slice(fm.indexOf('const STRINGS = '), fm.indexOf('const langPrefix')) + '\nruntimeStrings', { lang: 'en' });
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  const policy = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8').match(/export const toolPersistencePolicy = ([\s\S]*?) as const/)[1];
  const sandbox = { document, t: runtimeStrings, langPrefix: '', localStorage, toolPersistencePolicy: vm.runInNewContext('(' + policy + ')'), _slug: 'sprite-sheet-generator', Blob, console, innerHeight: 900, scrollY: 0, scrollTo(position) { scrolls.push(position); },
    URL: { createObjectURL(blob) { const id = 'blob:fixture-' + ++serial; urls.set(id, blob); return id; }, revokeObjectURL: id => urls.delete(id) },
    navigator: { clipboard: { writeText: () => Promise.resolve() } },
    createImageBitmap(file) { const bmp = { width: 2, height: 2, fixture: file.name, pixel: [...file.name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 250 + 1, closed: false, close() { this.closed = true; } }; decoded.push(bmp); if (deferBitmap.includes(file.name)) return new Promise(resolve => pendingBitmaps.push(() => resolve(bmp))); return Promise.resolve(bmp); },
    setTimeout(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox), layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  vm.runInContext(layout.match(/<script is:inline define:vars=\{\{ toolPersistencePolicy \}\}>([\s\S]*?)<\/script>/)[1], ctx);
  vm.runInContext(source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1], ctx);
  const shortcutStart = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
  vm.runInContext(layout.slice(shortcutStart, layout.indexOf('// ── Copy button visual feedback', shortcutStart)), ctx);
  function flushZeroTimers() { for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); } }
  return { get, wrap, ctx, downloads, blobs, decoded, pendingBitmaps, store, scrolls,
    key(init) { const e = { preventDefault() {}, ...init }; for (const fn of document.listeners.keydown) fn(e); flushZeroTimers(); },
    change(id, value, event = 'change') { const el = get(id); el.value = value; el.dispatch(event); },
    importFiles(files) { const el = get('ssg-file'); el.files = files; el.dispatch('change'); },
    drop(dt) { wrap.dispatch('drop', { dataTransfer: dt }); },
    clear(mode) { if (mode === 'clear') { get('ssg-clear').click(); return; } get('ssg-name').focus(); const e = { key: mode === 'meta' ? 'L' : 'l', [mode === 'meta' ? 'metaKey' : 'ctrlKey']: true, preventDefault() {} }; for (const fn of document.listeners.keydown) fn(e); flushZeroTimers(); },
    finishBlob() { const job = blobs.shift(); job.callback(job.snapshot); return job.snapshot; },
    names() { const data = get('ssg-data').value; return data ? Object.keys(JSON.parse(data).frames) : []; },
    prefs() { return sandbox.ztPersist.load('sprite-sheet-generator'); }
  };
}
const settleSprite = () => new Promise(resolve => setImmediate(resolve));
const spriteFile = name => ({ name, type: 'image/png', size: 16 });
function delayedFileEntry(name) {
  let complete;
  return { entry: { isFile: true, fullPath: '/folder/' + name, file(success) { complete = () => success(spriteFile(name)); } }, complete() { if (!complete) throw new Error('file callback not pending: ' + name); complete(); } };
}
function delayedDirectory(childrenName = '/folder') {
  const pending = [];
  return { entry: { isDirectory: true, fullPath: childrenName, createReader() { return { readEntries(success) { pending.push(success); } }; } }, batch(entries) { if (!pending.length) throw new Error('directory read not pending'); pending.shift()(entries); } };
}
function directoryDrop(directory, loose = []) {
  return { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => directory.entry, getAsFile: () => null }, ...loose.map(file => ({ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => file }))] };
}
for (const format of ['png', 'webp']) for (const action of ['rename', 'clear', 'ctrl', 'meta']) {
  const page = loadSpritePage(), label = 'lifecycle download ' + format + '/' + action;
  page.importFiles([spriteFile('clicked-pixels.png')]); await settleSprite();
  page.change('ssg-name', 'click snapshot', 'input'); page.change('ssg-imgfmt', format);
  check(label + ': real import built a sheet', !page.get('ssg-output').hidden && page.names().includes('clicked-pixels.png'));
  page.get('ssg-dl-img').click();
  equal(label + ': canvas encoding is pending', page.blobs.length, 1);
  if (action !== 'rename') page.clear(action);
  page.change('ssg-name', 'later name', 'input');
  page.change('ssg-imgfmt', format === 'png' ? 'webp' : 'png');
  const before = { hidden: page.get('ssg-output').hidden, data: page.get('ssg-data').value, status: page.get('ssg-status').textContent };
  page.finishBlob();
  equal(label + ': finishes the already requested download', page.downloads.length, 1);
  equal(label + ': filename uses click snapshot', page.downloads[0]?.name, 'click-snapshot.' + format);
  equal(label + ': encoding format uses click snapshot', page.downloads[0]?.blob.type, 'image/' + format);
  deepEqual(label + ': exported pixels use click snapshot', JSON.parse(await page.downloads[0].blob.text()).pixels, ['clicked-pixels.png']);
  deepEqual(label + ': callback does not restore or change page output', { hidden: page.get('ssg-output').hidden, data: page.get('ssg-data').value, status: page.get('ssg-status').textContent }, before);
}
for (const phase of ['first-batch', 'later-batch', 'file-callback', 'nested-directory']) for (const mode of ['clear', 'ctrl', 'meta']) {
  const page = loadSpritePage(), label = 'lifecycle drop ' + phase + '/' + mode;
  const dir = delayedDirectory(), nested = delayedDirectory('/folder/nested'), a = delayedFileEntry('old-a.png'), b = delayedFileEntry('old-b.png');
  page.change('ssg-name', 'keep-pref', 'input'); page.change('ssg-spacing', '7', 'input');
  page.drop(directoryDrop(dir, [spriteFile('old-loose.png')]));
  if (phase === 'later-batch') dir.batch([a.entry]);
  if (phase === 'file-callback') { dir.batch([a.entry, b.entry]); dir.batch([]); await settleSprite(); }
  if (phase === 'nested-directory') { dir.batch([nested.entry]); dir.batch([]); await settleSprite(); }
  page.clear(mode);
  check(label + ': clear immediately hides result', page.get('ssg-output').hidden && page.get('ssg-data').value === '');
  equal(label + ': clear keeps sheet-name preference', page.get('ssg-name').value, 'keep-pref');
  equal(label + ': clear keeps option preference', page.prefs().spacing, 7);
  page.importFiles([spriteFile('fresh.png')]); await settleSprite();
  deepEqual(label + ': new import works while old directory waits', page.names(), ['fresh.png']);
  if (phase === 'first-batch') { dir.batch([a.entry]); dir.batch([b.entry]); dir.batch([]); }
  if (phase === 'later-batch') { dir.batch([b.entry]); dir.batch([]); }
  if (phase === 'nested-directory') { nested.batch([a.entry, b.entry]); nested.batch([]); }
  await settleSprite(); a.complete(); b.complete(); await settleSprite();
  deepEqual(label + ': stale directory cannot join new import', page.names(), ['fresh.png']);
  deepEqual(label + ': stale directory and mixed loose file never decode', page.decoded.map(bmp => bmp.fixture), ['fresh.png']);
  equal(label + ': image list contains only new import', page.get('ssg-list').children.length, 1);
}
// Existing queued decoding remains serialized and its own token still releases cancelled bitmaps.
for (const mode of ['clear', 'ctrl', 'meta']) {
  const page = loadSpritePage({ deferBitmap: ['pending.png'] }), label = 'lifecycle existing queue/' + mode;
  page.importFiles([spriteFile('pending.png')]); await settleSprite();
  equal(label + ': old decode is pending', page.pendingBitmaps.length, 1);
  page.clear(mode); page.importFiles([spriteFile('fresh.png')]); await settleSprite();
  deepEqual(label + ': new import preserves queue order', page.decoded.map(bmp => bmp.fixture), ['pending.png']);
  page.pendingBitmaps.shift()(); await settleSprite();
  check(label + ': cancelled bitmap is released', page.decoded[0].closed);
  deepEqual(label + ': queued new import finishes alone', page.names(), ['fresh.png']);
}
// A non-cancelled directory still reads every batch and enters the natural-sort queue.
{
  const page = loadSpritePage(), dir = delayedDirectory(), a = delayedFileEntry('frame10.png'), b = delayedFileEntry('frame2.png');
  page.drop(directoryDrop(dir)); dir.batch([a.entry]); dir.batch([b.entry]); dir.batch([]); await settleSprite();
  a.complete(); b.complete(); await settleSprite();
  deepEqual('lifecycle drop without clear: both batches sorted naturally', page.names(), ['frame2.png', 'frame10.png']);
}

// ---------- v2 page layout ----------
{
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script is:inline'));
  const styles = source.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
  const fm = source.slice(0, source.indexOf('\n---', 4));
  const S = new Function('return ' + fm.slice(fm.indexOf('const STRINGS = ') + 'const STRINGS = '.length, fm.indexOf('// strings:end')).replace(/;\s*$/, ''))();
  check('v2: generate registry', /'sprite-sheet-generator':\s*'generate'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('v2: component root is the tool', /^\s*<div class="ssg-wrap" id="ssg-wrap">/.test(markup));
  check('v2: shared 270–320px rail', /class="ssg-rail zt-rail"/.test(markup) && /grid-template-columns:\s*clamp\(270px, 26vw, 320px\) minmax\(0, 1fr\)/.test(styles));
  check('v2: controls and export precede preview', ['ssg-drop', 'ssg-dl-img', 'ssg-data', 'ssg-list', 'ssg-name'].every(id => markup.indexOf('id="' + id + '"') < markup.indexOf('id="ssg-canvas"')));
  check('v2: data focus follows parameter controls', markup.indexOf('id="ssg-data"') > markup.indexOf('id="ssg-gifframes"'));
  check('v2: segmented radio semantics retained', /class="ssg-seg zt-segmented"/.test(markup) && (markup.match(/type="radio" name="ssg-layout"/g) || []).length === 2);
  check('v2: exports follow existing output hidden state', /\.ssg-wrap:has\(#ssg-output\[hidden\]\) \.ssg-export,\s*\.ssg-wrap:has\(#ssg-output\[hidden\]\) \.ssg-data-panel\s*\{\s*display:\s*none/.test(styles));
  check('v2: empty explanation follows output visibility', /class="ssg-empty">\{emptyPreview\}/.test(markup) && /\.ssg-wrap:has\(#ssg-output:not\(\[hidden\]\)\) \.ssg-empty\s*\{\s*display:\s*none/.test(styles));
  check('v2: status and metadata have bounded scroll areas', /#ssg-status\s*\{[^}]*height:\s*5rem;[^}]*overflow:\s*auto/.test(styles) && /\.ssg-meta\s*\{[^}]*height:\s*3.6em;[^}]*overflow:\s*auto/s.test(styles));
  check('v2: long image list stays in a keyboard scroll area', /id="ssg-list" class="ssg-list" tabindex="0"/.test(markup) && /\.ssg-list\s*\{[^}]*height:\s*12rem;[^}]*overflow-y:\s*auto/s.test(styles));
  check('v2: data fixed height and scrollable', /\.ssg-data\s*\{[^}]*height:\s*11rem;[^}]*resize:\s*none;[^}]*overflow:\s*auto/.test(styles));
  check('v2: preview has zero flexible minimum and keyboard access', /class="ssg-preview" tabindex="0" role="region"/.test(markup) && /\.ssg-preview\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/s.test(styles));
  check('v2: stacks at 860 with fixed mobile preview', /max-width:\s*860px/.test(styles) && /\.ssg-preview\s*\{\s*height:\s*360px;\s*flex:\s*none/.test(styles) && /max-width:\s*640px/.test(styles));
  const tips = [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]);
  check('v2: fourteen unique tip controls', tips.length === 14 && new Set(tips).size === 14);
  check('v2: help excluded from serialization', /const \{ tips, emptyPreview, \.\.\.runtimeStrings \} = T;/.test(source) && /define:vars=\{\{ t: runtimeStrings, langPrefix \}\}/.test(source));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const t = S[lang];
    deepEqual('v2 ' + lang + ': twelve shared tip facts', Object.keys(t.tips), ['drop', 'order', 'layout', 'gaps', 'frame', 'gif', 'data', 'image', 'svg', 'sheet', 'clear', 'bounds']);
    check('v2 ' + lang + ': nonempty help and empty-state text', typeof t.emptyPreview === 'string' && !!t.emptyPreview.trim() && Object.values(t.tips).every(x => typeof x === 'string' && !!x.trim()));
    const runtime = vm.runInNewContext(fm.slice(fm.indexOf('const STRINGS = '), fm.indexOf('const langPrefix')) + '\nruntimeStrings', { lang });
    check('v2 ' + lang + ': actual runtime excludes tips and empty text', !('tips' in runtime) && !('emptyPreview' in runtime) && Object.values(runtime).every(x => typeof x === 'string'));
    const mdx = readFileSync(join(root, 'src/content/tools/sprite-sheet-generator', lang + '.mdx'), 'utf8');
    const meta = yaml.load(mdx.match(/^---\n([\s\S]*?)\n---/)[1]);
    check('v2 ' + lang + ': five bounded steps', meta.steps.length === 5 && meta.steps.every(s => typeof s === 'string' && s.length <= 280) && meta.steps.join('').length <= 1200);
    check('v2 ' + lang + ': limits FAQ SEO and examples remain', /^## (Limits|限制|制限|제한)$/m.test(mdx) && meta.faqItems.length >= 4 && !!meta.seoTitle && !!meta.seoDescription && /ssg-check:/.test(mdx));
    check('v2 ' + lang + ': HowTo section removed', !/^## (How to Use|使用步骤|使い方|사용 방법)$/m.test(mdx));
  }
  const page = loadSpritePage();
  page.get('ssg-drop').dispatch('click', { target: page.get('ssg-tip-drop') });
  equal('v2: import help does not invoke the file picker', page.get('ssg-file').clickCount || 0, 0);
  page.get('ssg-pick').focus(); page.key({ key: 'Enter', ctrlKey: true });
  equal('v2: real global primary shortcut opens file picker while empty', page.get('ssg-file').clickCount, 1);
  page.get('ssg-output').rectTop = 950; page.get('ssg-status').rectTop = 420;
  page.importFiles([spriteFile('first.png')]); await settleSprite();
  equal('v2: first sheet invokes existing revealOutput once', page.scrolls.length, 1);
  equal('v2: revealOutput positions the status before downloads', page.scrolls[0]?.top, 408);
  page.key({ key: 'Enter', metaKey: true });
  equal('v2: real global primary shortcut downloads the current image', page.blobs.length, 1);
  page.importFiles([spriteFile('second.png')]); await settleSprite();
  equal('v2: subsequent import does not force another reveal', page.scrolls.length, 1);
  page.clear('clear'); page.key({ key: 'Enter', ctrlKey: true });
  equal('v2: clear restores picker as the primary shortcut', page.get('ssg-file').clickCount, 2);
  const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');
  const compiled = await transform(source, { filename: 'SpriteSheetGeneratorTool.astro' });
  check('v2: Astro compiles and all global CSS resolves', !compiled.diagnostics.some(d => d.severity === 1) && compiled.css.length > 0 && compiled.css.every(css => !css.includes(':global(')));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
