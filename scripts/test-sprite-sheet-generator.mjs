// Sprite Sheet Generator — spec-driven regression test
//
// Read:  src/components/tools/SpriteSheetGeneratorTool.astro (extracts the real engine
//        block between the `engine:start` / `engine:end` markers, so this test cannot
//        drift from the shipped source)
// Write: stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: natural sort; unique frame names; sheet-name sanitizing; CSS class tokens;
// SVG intrinsic size; trim bounding box (incl. fully transparent); nextPow2; canvas
// limits; fill ratio; MaxRects packing on 200 seeded random sets (no overlap, inside
// the sheet, spacing / margin / extrude gaps, max width, power of two, widening);
// grid cells and centred draw positions; JSON Hash / JSON Array / Sparrow XML / CSS
// structure and escaping.
//
// Run: node scripts/test-sprite-sheet-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
return { SSG_LIMITS, SSG_APP_URL, naturalCompare, uniqueNames, sanitizeSheetName, cssClassName,
  svgIntrinsicSize, trimBounds, nextPow2, fitsLimits, fillRatio, packMaxRects, gridLayout,
  buildJsonHash, buildJsonArray, buildXml, buildCss };`)();

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
  equal('sheet: illegal chars replaced', E.sanitizeSheetName('my sheet/图集?'), 'my-sheet----');
  equal('sheet: empty → spritesheet', E.sanitizeSheetName(''), 'spritesheet');
  equal('sheet: spaces only → spritesheet', E.sanitizeSheetName('   '), 'spritesheet');
  equal('sheet: null → spritesheet', E.sanitizeSheetName(null), 'spritesheet');
  equal('sheet: quotes replaced', E.sanitizeSheetName('a"b\'c<d>'), 'a-b-c-d-');
}

// ---------- cssClassName ----------
{
  equal('css name: extension removed', E.cssClassName('walk_01.png'), 'walk_01');
  equal('css name: camelCase to kebab', E.cssClassName('WalkLeft.png'), 'walk-left');
  equal('css name: spaces and parens', E.cssClassName('walk (2).png'), 'walk-2');
  equal('css name: unicode collapses', E.cssClassName('图标.png'), '');
  equal('css name: leading digit kept', E.cssClassName('01.png'), '01');
  equal('css name: only last extension removed', E.cssClassName('icon.small.png'), 'icon-small');
  check('css name: only [a-z0-9_-]', /^[a-z0-9_-]*$/.test(E.cssClassName('Ä b@c#D.e.png')));
}

// ---------- svgIntrinsicSize ----------
{
  deepEqual('svg: width/height', E.svgIntrinsicSize('64', '32', null), { w: 64, h: 32 });
  deepEqual('svg: px units', E.svgIntrinsicSize('64px', '32px', '0 0 1 1'), { w: 64, h: 32 });
  deepEqual('svg: viewBox only', E.svgIntrinsicSize(null, null, '0 0 24 24'), { w: 24, h: 24 });
  deepEqual('svg: viewBox with commas', E.svgIntrinsicSize(null, null, '0,0,100,50'), { w: 100, h: 50 });
  deepEqual('svg: width + viewBox ratio', E.svgIntrinsicSize('200', null, '0 0 100 50'), { w: 200, h: 100 });
  deepEqual('svg: height + viewBox ratio', E.svgIntrinsicSize(null, '30', '0 0 100 50'), { w: 60, h: 30 });
  deepEqual('svg: percent falls back to viewBox', E.svgIntrinsicSize('100%', '100%', '0 0 48 16'), { w: 48, h: 16 });
  deepEqual('svg: em falls back to viewBox', E.svgIntrinsicSize('2em', '2em', '0 0 10 10'), { w: 10, h: 10 });
  equal('svg: nothing → null', E.svgIntrinsicSize(null, null, null), null);
  equal('svg: percent without viewBox → null', E.svgIntrinsicSize('100%', '100%', null), null);
  equal('svg: zero viewBox → null', E.svgIntrinsicSize(null, null, '0 0 0 10'), null);
  equal('svg: only width, no viewBox → null', E.svgIntrinsicSize('40', null, null), null);
  deepEqual('svg: fractional rounds, min 1', E.svgIntrinsicSize('0.3', '10.6', null), { w: 1, h: 11 });
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
  equal('limits: constants', JSON.stringify(E.SSG_LIMITS), JSON.stringify({ maxImages: 1000, maxImageSide: 8192, maxSide: 16384, maxArea: 16777216 }));
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
  check('pack: 1000 sprites under 5 s', ms < 5000, ms + ' ms');
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
    { ...frames[1], name: 'walk.png' }, { ...frames[1], name: 'walk.jpg' }, { ...frames[1], name: 'Walk.gif' }, { ...frames[1], name: '图.png' },
  ], meta);
  check('css: colliding tokens deduplicated', ['.spritesheet-walk {', '.spritesheet-walk-2 {', '.spritesheet-walk-3 {', '.spritesheet-frame {'].every((s) => dup.includes(s)), dup);
  const selectors = css.match(/^\.[^\s{]+/gm);
  check('css: selectors are valid identifiers', selectors.every((s) => /^\.-?[_a-zA-Z][_a-zA-Z0-9-]*$/.test(s)), selectors.join(' '));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
