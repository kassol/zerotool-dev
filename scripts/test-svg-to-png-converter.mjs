// SVG to PNG Converter — size, SVG preparation and naming regression test
// Also reads src/styles/tool-common.css for the shared fill and toggletip rules.
//
// Read:  src/components/tools/SvgToPngConverterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and the STRINGS table between
//        `strings:start` / `strings:end` in the frontmatter, so this test cannot drift
//        from the shipped source); src/components/tools/GifSplitterTool.astro (the ZIP
//        writer must be a verbatim copy)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected sizes are the natural sizes Chrome 152 reports for the same SVG in an <img>
// (measured 2026-09-30): 10em = 160 px, 50mm = 189 px, 72pt = 96 px, 1in = 96 px,
// width="200" with viewBox 24×12 = 200 × 100, width="200" alone = 200 × 150, no size
// and no viewBox = 300 × 150. The tool uses the viewBox size when width and height are
// both missing or relative (Chrome uses 300 × 150 there).
// Before this test: width-only SVGs came out at the viewBox size (24 × 12 instead of
// 200 × 100), width="100%" came out as 100 × 100 with a distorted drawing, "50mm" was read
// as 50 px, a custom width without height stretched the drawing, SVGs without xmlns
// failed with "Failed to render SVG", and external <image> links were drawn as Chrome's
// broken-image icon.
//
// Run: node scripts/test-svg-to-png-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const commonStyle = readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8');
const source = readFileSync(join(root, 'src/components/tools/SvgToPngConverterTool.astro'), 'utf8');

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.log('FAIL: could not locate the engine block in SvgToPngConverterTool.astro');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { parseLength, parseStyle, parseViewBox, intrinsicSize, planOutput, scanMarkup, analyzeSvg,
  buildSvg, backgroundFor, outputName, uniqueNames, extForMime, parseXmlError, isBlank,
  crcTable, crc32, zipStore, MAX_SIDE };`)();

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const size = (svg) => {
  const a = E.analyzeSvg(svg);
  return a.error ? a.error : [Math.round(a.size.width * 1000) / 1000, Math.round(a.size.height * 1000) / 1000];
};
const plan = (svg, opts) => {
  const a = E.analyzeSvg(svg);
  const p = E.planOutput(a.size, opts);
  return p.error ? p : [p.width, p.height];
};
const scale1 = { mode: 'scale', scale: 1 };

// ---------- 1. lengths ----------
eq('length: plain number', E.parseLength('24', 16), { px: 24 });
eq('length: px', E.parseLength('24px', 16), { px: 24 });
eq('length: 1in = 96px', E.parseLength('1in', 16), { px: 96 });
eq('length: 72pt = 96px', E.parseLength('72pt', 16), { px: 96 });
eq('length: 2pc = 32px', E.parseLength('2pc', 16), { px: 32 });
check('length: 50mm = 188.976px', Math.abs(E.parseLength('50mm', 16).px - 188.976) < 0.001);
check('length: 2.54cm = 96px', Math.abs(E.parseLength('2.54cm', 16).px - 96) < 1e-9);
check('length: 4Q = 1mm', Math.abs(E.parseLength('4Q', 16).px - 96 / 25.4) < 1e-9);
eq('length: 10em at 16px', E.parseLength('10em', 16), { px: 160 });
eq('length: 10em at 20px', E.parseLength('10em', 20), { px: 200 });
eq('length: rem is always 16px', E.parseLength('2rem', 20), { px: 32 });
eq('length: exponent', E.parseLength('1e2', 16), { px: 100 });
eq('length: spaces around', E.parseLength('  12px ', 16), { px: 12 });
eq('length: unit is case-insensitive', E.parseLength('1IN', 16), { px: 96 });
eq('length: percent cannot be resolved', E.parseLength('100%', 16), { px: null, unit: '%' });
eq('length: ex cannot be resolved', E.parseLength('10ex', 16), { px: null, unit: 'ex' });
eq('length: vw cannot be resolved', E.parseLength('50vw', 16), { px: null, unit: 'vw' });
eq('length: zero is invalid', E.parseLength('0', 16), { px: null, unit: 'invalid' });
eq('length: negative is invalid', E.parseLength('-5', 16), { px: null, unit: 'invalid' });
eq('length: garbage', E.parseLength('abc', 16), { px: null, unit: 'abc' });
eq('length: absent', E.parseLength(undefined, 16), null);
eq('length: empty', E.parseLength('', 16), null);
eq('length: auto', E.parseLength('auto', 16), null);

eq('style: declarations', E.parseStyle('width: 10px; HEIGHT:20px !important;;fill:red'), { width: '10px', height: '20px', fill: 'red' });
eq('viewBox: spaces', E.parseViewBox('0 0 24 12'), { x: 0, y: 0, width: 24, height: 12 });
eq('viewBox: commas and negatives', E.parseViewBox('-10,-5, 20 ,10'), { x: -10, y: -5, width: 20, height: 10 });
eq('viewBox: zero width is ignored', E.parseViewBox('0 0 0 10'), null);
eq('viewBox: three numbers', E.parseViewBox('0 0 10'), null);

// ---------- 2. intrinsic size (Chrome naturalWidth / naturalHeight) ----------
eq('size: width and height', size(`<svg ${NS} width="120" height="60"/>`), [120, 60]);
eq('size: width only + viewBox keeps the viewBox ratio (was 24 × 12)', size(`<svg ${NS} width="200" viewBox="0 0 24 12"/>`), [200, 100]);
eq('size: height only + viewBox', size(`<svg ${NS} height="50" viewBox="0 0 24 12"/>`), [100, 50]);
eq('size: width only, no viewBox = Chrome 200 × 150', size(`<svg ${NS} width="200"/>`), [200, 150]);
eq('size: viewBox only uses the viewBox size', size(`<svg ${NS} viewBox="0 0 200 100"/>`), [200, 100]);
eq('size: nothing = 300 × 150', size(`<svg ${NS}/>`), [300, 150]);
eq('size: 100% + viewBox uses the viewBox (was 100 × 100)', size(`<svg ${NS} width="100%" height="100%" viewBox="0 0 200 100"/>`), [200, 100]);
eq('size: 10em × 5em = Chrome 160 × 80', size(`<svg ${NS} width="10em" height="5em"/>`), [160, 80]);
eq('size: em follows the root font-size style = Chrome 200 × 100', size(`<svg ${NS} width="10em" height="5em" style="font-size:20px"/>`), [200, 100]);
eq('size: em follows the font-size attribute', size(`<svg ${NS} width="2em" height="1em" font-size="12pt"/>`), [32, 16]);
eq('size: 50mm × 25mm (was 50 × 25)', size(`<svg ${NS} width="50mm" height="25mm"/>`), [188.976, 94.488]);
eq('size: 72pt × 36pt = Chrome 96 × 48', size(`<svg ${NS} width="72pt" height="36pt"/>`), [96, 48]);
eq('size: 1in × 0.5in = Chrome 96 × 48', size(`<svg ${NS} width="1in" height="0.5in"/>`), [96, 48]);
eq('size: style width overrides the attribute', size(`<svg ${NS} width="10" height="10" style="width:40px;height:20px"/>`), [40, 20]);
eq('size: single-quoted attributes', size(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='32'/>`), [64, 32]);
{
  const a = E.analyzeSvg(`<svg ${NS} width="100%" viewBox="0 0 20 10"/>`);
  eq('size note: relative width is reported', a.size.notes, [{ code: 'relativeSize', attr: 'width', value: '100%' }]);
  eq('size source: viewBox', a.size.source, 'viewBox');
  eq('size source: default', E.analyzeSvg(`<svg ${NS}/>`).size.source, 'default');
  eq('size source: attributes', E.analyzeSvg(`<svg ${NS} width="1" height="1"/>`).size.source, 'size');
}

// ---------- 3. output plan ----------
eq('plan: 1x of mm rounds like Chrome (189 × 94)', plan(`<svg ${NS} width="50mm" height="25mm"/>`, scale1), [189, 94]);
eq('plan: 2x', plan(`<svg ${NS} viewBox="0 0 24 24"/>`, { mode: 'scale', scale: 2 }), [48, 48]);
eq('plan: 0.5x', plan(`<svg ${NS} width="101" height="51"/>`, { mode: 'scale', scale: 0.5 }), [51, 26]);
eq('plan: width only keeps the aspect ratio (was stretched)', plan(`<svg ${NS} width="200" height="100"/>`, { mode: 'width', width: '1024' }), [1024, 512]);
eq('plan: height only keeps the aspect ratio', plan(`<svg ${NS} viewBox="0 0 24 12"/>`, { mode: 'height', height: '512' }), [1024, 512]);
eq('plan: exact size', plan(`<svg ${NS} viewBox="0 0 24 12"/>`, { mode: 'exact', width: '300', height: '300' }), [300, 300]);
{
  const a = E.analyzeSvg(`<svg ${NS} viewBox="0 0 24 12"/>`);
  eq('plan: exact size with another ratio is letterboxed', E.planOutput(a.size, { mode: 'exact', width: '300', height: '300' }).letterbox, true);
  eq('plan: exact size with the same ratio is not', E.planOutput(a.size, { mode: 'exact', width: '240', height: '120' }).letterbox, false);
  eq('plan: never below 1 px', [E.planOutput(a.size, { mode: 'scale', scale: 0.001 }).width, E.planOutput(a.size, { mode: 'scale', scale: 0.001 }).height], [1, 1]);
  eq('plan: width 0 is an error', E.planOutput(a.size, { mode: 'width', width: '0' }).error, 'badNumber');
  eq('plan: width 1.5 is an error', E.planOutput(a.size, { mode: 'width', width: '1.5' }).error, 'badNumber');
  eq('plan: width text is an error', E.planOutput(a.size, { mode: 'width', width: '12px' }).error, 'badNumber');
  eq('plan: empty width is an error', E.planOutput(a.size, { mode: 'width', width: '' }).error, 'badNumber');
  eq('plan: width above 65,535 is an error', E.planOutput(a.size, { mode: 'width', width: '65536' }).error, 'badNumber');
  eq('plan: width 65,535 is allowed', E.planOutput(a.size, { mode: 'width', width: '65535' }).width, 65535);
  eq('plan: scale 0 is an error', E.planOutput(a.size, { mode: 'scale', scale: '0' }).error, 'badScale');
  eq('plan: scale NaN is an error', E.planOutput(a.size, { mode: 'scale', scale: 'x' }).error, 'badScale');
  const big = E.planOutput(a.size, { mode: 'height', height: '40000' });
  eq('plan: a side above 65,535 is too large', [big.error, big.width, big.height], ['tooLarge', 80000, 40000]);
  eq('plan: MAX_SIDE', E.MAX_SIDE, 65535);
}

// ---------- 4. markup scanner ----------
{
  const tags = E.scanMarkup('<?xml version="1.0"?><!-- <svg nope/> --><!DOCTYPE svg [<!ENTITY a "<b>">]><svg a="x > y" b=\'q"\'><![CDATA[<rect/>]]><g/></svg>');
  eq('scan: skips declaration, comment, DOCTYPE subset and CDATA', tags.map((t) => t.name), ['svg', 'g']);
  eq('scan: > inside a quoted value', tags[0].attrs.map((x) => [x.name, x.value]), [['a', 'x > y'], ['b', 'q"']]);
  eq('scan: self-closing flag', [tags[0].selfClosing, tags[1].selfClosing], [false, true]);
  eq('scan: end tags are skipped', E.scanMarkup('<a></a><b/>').map((t) => t.name), ['a', 'b']);
}

// ---------- 5. analyze: errors and references ----------
eq('analyze: empty', E.analyzeSvg('  \n').error, { code: 'empty' });
eq('analyze: not markup', E.analyzeSvg('hello').error, { code: 'notSvg' });
eq('analyze: HTML wrapper is reported', E.analyzeSvg('<div><svg></svg></div>').error, { code: 'rootNotSvg', name: 'div' });
eq('analyze: BOM and XML declaration are fine', E.analyzeSvg('\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<svg ' + NS + ' width="1" height="1"/>').error, undefined);
{
  const a = E.analyzeSvg(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100">
    <style>@import url("https://fonts.googleapis.com/css2?family=Lobster"); @font-face{font-family:A;src:url(data:font/ttf;base64,AAAA)} .b{background:url('https://example.com/bg.png')} .c{fill:url(#g)}</style>
    <image href="https://example.com/a.png" width="10" height="10"/>
    <image xlink:href="logo.png" width="10" height="10"/>
    <image href="data:image/png;base64,AAAA" width="10" height="10"/>
    <feImage href="https://example.com/f.png"/>
    <use href="#local"/><use xlink:href="sprite.svg#icon"/>
    <rect style="fill:url(#g)" width="1" height="1"/>
    <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
    <script>alert(1)</script>
  </svg>`);
  eq('refs: external <image> and <feImage> links', a.refs.images, ['https://example.com/a.png', 'logo.png', 'https://example.com/f.png']);
  eq('refs: external <use>', a.refs.uses, ['sprite.svg#icon']);
  eq('refs: CSS @import', a.refs.imports, ['https://fonts.googleapis.com/css2?family=Lobster']);
  eq('refs: CSS url() outside data: and #', a.refs.css, ['https://example.com/bg.png']);
  eq('refs: foreignObject', a.refs.foreignObject, true);
  eq('refs: script', a.refs.script, true);
}
{
  const a = E.analyzeSvg(`<svg ${NS} width="1" height="1"><image href="a&amp;b.png"/></svg>`);
  eq('refs: entities in URLs are decoded for display', a.refs.images, ['a&b.png']);
}

// ---------- 6. build ----------
function build(svg, opts) {
  const a = E.analyzeSvg(svg);
  const p = E.planOutput(a.size, opts || scale1);
  return E.buildSvg(svg, a, p);
}
function rootAttrs(svg) {
  const t = E.scanMarkup(svg)[0];
  const o = {};
  for (const x of t.attrs) o[x.name] = x.value;
  return o;
}
{
  const out = build('<svg viewBox="0 0 24 24" width="96" height="96"><circle cx="12" cy="12" r="10"/></svg>');
  eq('build: adds the missing xmlns (was "Failed to render SVG")', rootAttrs(out).xmlns, 'http://www.w3.org/2000/svg');
  const a = E.analyzeSvg('<svg viewBox="0 0 24 24"/>');
  eq('build: missing xmlns is noted', a.fixes, ['xmlns']);
}
{
  const out = build(`<svg ${NS} width="10" height="10"><defs><rect id="r" width="10" height="10"/></defs><use xlink:href="#r"/></svg>`);
  eq('build: adds xmlns:xlink when xlink: is used undeclared', rootAttrs(out)['xmlns:xlink'], 'http://www.w3.org/1999/xlink');
  const declared = build(`<svg ${NS} width="10" height="10"><g xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#r"/></g></svg>`);
  eq('build: keeps xlink declared on a descendant', rootAttrs(declared)['xmlns:xlink'], undefined);
}
{
  const r = rootAttrs(build(`<svg ${NS} width="200" viewBox="0 0 24 12"><rect width="24" height="12"/></svg>`, { mode: 'scale', scale: 2 }));
  eq('build: width and height are set to the output size', [r.width, r.height], ['400', '200']);
  eq('build: the viewBox is kept', r.viewBox, '0 0 24 12');
}
{
  const r = rootAttrs(build(`<svg ${NS} width="50mm" height="25mm"><rect width="10" height="10"/></svg>`, { mode: 'scale', scale: 2 }));
  eq('build: a viewBox in user units is added when missing, so the drawing scales', r.viewBox, '0 0 188.9764 94.4882');
  eq('build: output size', [r.width, r.height], ['378', '189']);
}
{
  const r = rootAttrs(build(`<svg ${NS} width="10" height="10" style="width:40px; fill:red ;height:20px" viewBox="0 0 4 2"/>`));
  eq('build: width and height are removed from the root style', r.style, 'fill:red');
  eq('build: output uses the style size', [r.width, r.height], ['40', '20']);
}
{
  const r = rootAttrs(build(`<svg ${NS} width="10" height="10" style="width:40px;height:20px" viewBox="0 0 4 2"/>`));
  eq('build: an emptied style attribute is dropped', r.style, undefined);
}
{
  const src = `<svg ${NS} width="100" height="100"><rect fill="#f1c40f" width="100" height="100"/><image href="https://example.com/a.png" x="1" width="10" height="10"/><image xlink:href="data:image/png;base64,AAAA" width="10" height="10"/></svg>`;
  const out = build(src);
  const images = E.scanMarkup(out).filter((t) => t.name === 'image');
  eq('build: external <image> links are removed (Chrome drew a broken-image icon)', images[0].attrs.map((x) => x.name), ['x', 'width', 'height']);
  eq('build: data: images are kept', images[1].attrs.map((x) => x.name), ['xlink:href', 'width', 'height']);
  check('build: the rest of the document is unchanged', out.endsWith('<rect fill="#f1c40f" width="100" height="100"/><image x="1" width="10" height="10"/><image xlink:href="data:image/png;base64,AAAA" width="10" height="10"/></svg>'), out);
}
{
  const src = '\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<svg ' + NS + ' viewBox="0 0 2 1"\n  class="a"/>';
  const out = build(src, { mode: 'width', width: '20' });
  check('build: text before the root and line breaks are kept', out.startsWith('<?xml version="1.0"?>\n<!-- c -->\n<svg ') && out.split('\n').length === 4, out);
  eq('build: self-closing root', out.trim().endsWith('/>'), true);
}
{
  // Illustrator-style entity namespaces must not be replaced.
  const src = '<!DOCTYPE svg [<!ENTITY ns_svg "http://www.w3.org/2000/svg">]><svg xmlns="&ns_svg;" width="10" height="10"/>';
  eq('build: an xmlns given through an entity is kept', rootAttrs(build(src)).xmlns, '&ns_svg;');
}

// ---------- 7. background, names ----------
eq('background: transparent PNG', E.backgroundFor('image/png', null), { color: null });
eq('background: transparent WebP', E.backgroundFor('image/webp', null), { color: null });
eq('background: transparent JPEG becomes white (canvas would give black)', E.backgroundFor('image/jpeg', null), { color: '#ffffff', note: 'jpegWhite' });
eq('background: chosen color', E.backgroundFor('image/jpeg', '#123456'), { color: '#123456' });
eq('ext: png', E.extForMime('image/png'), 'png');
eq('ext: jpeg', E.extForMime('image/jpeg'), 'jpg');
eq('ext: webp', E.extForMime('image/webp'), 'webp');
eq('name: 1x keeps the base name', E.outputName('logo.svg', scale1, { width: 10, height: 10 }, 'png'), 'logo.png');
eq('name: 2x gets @2x', E.outputName('logo.SVG', { mode: 'scale', scale: 2 }, { width: 20, height: 20 }, 'png'), 'logo@2x.png');
eq('name: 1.5x', E.outputName('logo.svg', { mode: 'scale', scale: '1.5' }, { width: 15, height: 15 }, 'webp'), 'logo@1.5x.webp');
eq('name: width mode gets the size', E.outputName('icon.svg', { mode: 'width', width: '512' }, { width: 512, height: 256 }, 'jpg'), 'icon-512x256.jpg');
eq('name: pasted code', E.outputName('', scale1, { width: 1, height: 1 }, 'png'), 'image.png');
eq('name: unsafe characters', E.outputName('a/b:c*.svg', scale1, { width: 1, height: 1 }, 'png'), 'a_b_c_.png');
eq('names: duplicates are numbered', E.uniqueNames(['a.png', 'b.png', 'a.png', 'a.png']), ['a.png', 'b.png', 'a-2.png', 'a-3.png']);

// ---------- 8. XML errors, blank output ----------
eq('xml error: Chrome / Safari text', E.parseXmlError("This page contains the following errors:error on line 3 at column 17: Entity 'nbsp' not defined\nBelow is a rendering of the page up to the first error."), { line: 3, column: 17, detail: "Entity 'nbsp' not defined", entity: 'nbsp' });
eq('xml error: Firefox text', E.parseXmlError('XML Parsing Error: undefined entity\nLocation: blob:x\nLine Number 2, Column 5:'), { line: 2, column: 5, detail: 'XML Parsing Error: undefined entity', entity: null });
eq('blank: all transparent', E.isBlank(new Uint8ClampedArray([1, 2, 3, 0, 9, 9, 9, 0])), true);
eq('blank: one visible pixel', E.isBlank(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 1])), false);

// ---------- 9. ZIP writer copied from gif-splitter ----------
{
  const splitter = readFileSync(join(root, 'src/components/tools/GifSplitterTool.astro'), 'utf8');
  const splitterBlock = splitter.slice(splitter.indexOf(START_MARK), splitter.indexOf(END_MARK));
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
    check('zip copy: ' + name + ' is identical to gif-splitter', a !== null && a === b);
  }
  const enc = new TextEncoder();
  eq('crc32("123456789")', E.crc32(enc.encode('123456789')), 0xCBF43926);
  const zip = E.zipStore([{ name: 'logo@2x.png', data: Uint8Array.from([137, 80, 78, 71]) }, { name: 'アイコン.png', data: enc.encode('x') }]);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  eq('zip: first local header', dv.getUint32(0, true), 0x04034b50);
  eq('zip: EOCD entry count', dv.getUint16(zip.length - 22 + 10, true), 2);
}

// ---------- 10. strings ----------
{
  const s = source.indexOf('// strings:start');
  const e = source.indexOf('// strings:end');
  check('strings: markers found', s >= 0 && e > s);
  if (s >= 0 && e > s) {
    const STRINGS = new Function(source.slice(s, e).replace(/^\/\/ strings:start/, '').replace(/const STRINGS\s*=/, 'return ') )();
    const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, p + k + '.') : [p + k]));
    const keys = flat(STRINGS.en).sort();
    for (const lang of ['zh', 'ja', 'ko']) eq('strings: ' + lang + ' has the same keys as en', flat(STRINGS[lang]).sort(), keys);
    const placeholders = (v) => (String(v).match(/\{\w+\}/g) || []).sort();
    for (const lang of ['zh', 'ja', 'ko']) {
      for (const k of keys) {
        const get = (o) => k.split('.').reduce((x, y) => x[y], o);
        eq('strings: ' + lang + ' ' + k + ' placeholders', placeholders(get(STRINGS[lang])), placeholders(get(STRINGS.en)));
      }
    }
    const codes = ['empty', 'notSvg', 'rootNotSvg', 'xml', 'xmlEntity', 'render', 'tainted', 'taintedForeign', 'tooLarge', 'canvas', 'badNumber', 'badScale', 'encode', 'read'];
    for (const c of codes) check('strings: error ' + c, typeof STRINGS.en.err[c] === 'string');
    const notes = ['viewBox', 'default', 'relativeSize', 'xmlns', 'xlink', 'externalImage', 'externalUse', 'externalCss', 'letterbox', 'jpegWhite', 'formatFallback', 'blank', 'skipped'];
    for (const c of notes) check('strings: note ' + c, typeof STRINGS.en.note[c] === 'string');
  }
}

// ---------- 11. v2 page layout (DESIGN.md "Tool Pages v2", kind: convert) ----------
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  const script = source.slice(source.indexOf('<script'), source.indexOf('</script>'));
  check('v2: the tool root is .s2p-wrap (it gets the height of the first screen)', /^\s*<div class="s2p-wrap" id="s2p-wrap">/.test(markup) &&
    /\.s2p-wrap \{ display: flex; flex-direction: column; [^}]*min-height: 0; \}/.test(source) && source.includes('.s2p-wrap [hidden] { display: none !important; }'));
  check('v2: input and result use the shared two-pane classes', markup.includes('class="s2p-panels zt-io"') && (markup.match(/class="s2p-pane s2p-pane--(in|out) zt-io-pane"/g) || []).length === 2 &&
    /<textarea id="s2p-code" class="tool-textarea s2p-code zt-io-fill"/.test(markup) && markup.includes('class="s2p-out zt-io-fill"'));
  const left = markup.slice(markup.indexOf('s2p-pane--in'), markup.indexOf('s2p-pane--out'));
  const right = markup.slice(markup.indexOf('s2p-pane--out'));
  check('v2: drop zone, code box, Convert and the file table are in the left pane', ['id="s2p-drop"', 'id="s2p-file"', 'id="s2p-code"', 'id="s2p-convert-code"', 'id="s2p-batch"', 'id="s2p-zip"'].every((x) => left.includes(x)));
  check('v2: the result is in the right pane, the preview before the notes', right.includes('id="s2p-result"') && right.indexOf('id="s2p-download"') < right.indexOf('id="s2p-preview"') && right.indexOf('id="s2p-preview"') < right.indexOf('id="s2p-notes"'));
  check('v2: options and the status line are above the panes', markup.indexOf('class="s2p-options"') < markup.indexOf('id="s2p-status"') && markup.indexOf('id="s2p-status"') < markup.indexOf('class="s2p-panels zt-io"'));
  // ToolLayout's Ctrl/Cmd+Enter clicks the first .btn-primary: it must stay Convert, not Download.
  eq('v2: Convert is the first primary button, Download the second', (markup.match(/<button id="([\w-]+)" class="btn-primary/g) || []).map((m) => m.slice(12, m.indexOf('"', 12))), ['s2p-convert-code', 's2p-download']);
  // The result and a tall preview scroll inside the pane (flex-basis 0), the file table too.
  check('v2: the result box and the file table scroll inside their pane', source.includes('class="s2p-out zt-io-fill"') && /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(commonStyle) && /\.s2p-out \{[^}]*overflow: auto;/.test(source) && /\.s2p-table-wrap \{[^}]*flex: 1 1 0;[^}]*overflow: auto;/.test(source) &&
    /\.s2p-preview-box \{[^}]*flex: 1 1 0;/.test(source) && /\.s2p-preview-img \{ position: absolute;[^}]*object-fit: scale-down; \}/.test(source));
  check('v2: the empty hint is in the result box and hides when there is a result', right.includes('<p class="s2p-empty">{T.outEmpty}</p>') && source.includes('.s2p-out:has(.s2p-result:not([hidden])) .s2p-empty,') &&
    source.includes('.s2p-pane--out:has(.s2p-result[hidden]):has(.s2p-notes[hidden]) { display: none; }'));
  check('v2: the input stays visible after a conversion (no tabs, no Other SVG button)', !/s2p-tab\b|s2p-other|s2p-panel-/.test(source) && !/inputSec|activateTab|otherBtn/.test(script));
  // The code box has no input listener and the page-wide paste handler skips text fields, so Convert is not redundant.
  check('v2: Convert stays: code in the box is converted by the button or Ctrl/Cmd+Enter only', !/codeInput\.addEventListener\('input'/.test(script) &&
    script.includes("$('s2p-convert-code').addEventListener('click', convertCode);") &&
    script.includes("if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;"));

  const tipIds = [...markup.matchAll(/<Toggletip id="s2p-tip-(\w+)"[^>]*>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
  eq('v2: one toggletip per explained control', tipIds.map((m) => m[1]), ['size', 'format', 'bg', 'input', 'result']);
  const STRINGS = new Function(source.slice(source.indexOf('// strings:start'), source.indexOf('// strings:end')).replace(/const STRINGS\s*=/, 'return '))();
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq('v2: ' + lang + ' has text for every toggletip', tipIds.map((m) => m[2]).filter((k) => !STRINGS[lang].tips[k]), []);
    eq('v2: ' + lang + ' toggletips are plain sentences (no markup, no links)', Object.values(STRINGS[lang].tips).filter((x) => /[<>]|https?:/.test(x)), []);
    check('v2: ' + lang + ' has the empty hint and no tab or Other SVG strings', typeof STRINGS[lang].outEmpty === 'string' && typeof STRINGS[lang].outLabel === 'string' &&
      !('uploadTab' in STRINGS[lang]) && !('pasteTab' in STRINGS[lang]) && !('other' in STRINGS[lang]));
  }
  check('v2: toggletip text stays out of the inline script', source.includes('define:vars={{ t: CLIENT_T }}') && source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && !/t\.tips|TIPS/.test(script));
  // The numbers in the toggletips are the ones the code uses.
  const tipsEn = Object.values(STRINGS.en.tips).join(' ');
  check('v2: the tips state the limits in the code', E.MAX_SIDE === 65535 && script.includes('quality: q >= 1 && q <= 100 ? q / 100 : 0.92,') && script.includes('w * h <= 4194304') &&
    script.includes("save(url, 'svg-to-png.zip');") && E.outputName('a.svg', { mode: 'scale', scale: 2 }, { width: 2, height: 2 }, 'png') === 'a@2x.png' &&
    E.outputName('', { mode: 'width' }, { width: 20, height: 10 }, 'png') === 'image-20x10.png' && eqSize(E.analyzeSvg('<svg ' + NS + '/>'), 300, 150) &&
    ['65,535', '92', '4,194,304', 'svg-to-png.zip', '@2x', '300 × 150', '.svgz'].every((x) => tipsEn.includes(x)));
  function eqSize(a, w, h) { return a.size.width === w && a.size.height === h; }

  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('v2: listed as a convert page', layouts.includes("'svg-to-png-converter': 'convert'"));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/svg-to-png-converter/' + lang + '.mdx'), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const body = mdx.slice(front.length + 5);
    eq('v2: ' + lang + ' mdx has 6 steps in the frontmatter', (front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).match(/^  - "/gm) || []).length, 6);
    check('v2: ' + lang + ' mdx has no usage section in the body', !/<h2>(How to convert SVG to PNG|怎么用|使い方|사용 방법)<\/h2>/.test(body));
    check('v2: ' + lang + ' mdx keeps the limits section', /<h2>(Limits|限制|制限|제한 사항)<\/h2>/.test(body));
    check('v2: ' + lang + ' mdx names no removed control', !/Paste SVG code|Other SVG|粘贴 SVG 代码|换一个 SVG|SVG コードを貼り付け|別の SVG|SVG 코드 붙여넣기|다른 SVG/.test(mdx));
  }
}

// ---------- 12. Ctrl/Cmd+L (the handler between clear:start and clear:end, run with stubs) ----------
{
  const cs = source.indexOf('/* ── clear:start ── */');
  const ce = source.indexOf('/* ── clear:end ── */');
  check('clear: markers found', cs >= 0 && ce > cs);
  if (cs >= 0 && ce > cs) {
    const make = () => {
      const env = {
        listeners: [], revoked: [], cleared: [], calls: [], status: 'old', focusInside: true,
        state: { items: [{ result: { url: 'blob:a' } }, { result: { error: { code: 'render' } } }, { result: null }], active: 1, gen: 7, skipped: ['a.txt'] },
        resultEl: { hidden: false }
      };
      const doc = { activeElement: {}, addEventListener: (type, fn) => { if (type === 'keydown') env.listeners.push(fn); } };
      new Function('document', 'wrap', 'state', 'timer', 'clearTimeout', 'URL', 'renderActive', 'renderList', 'resultEl', 'setStatus', source.slice(cs, ce))(
        doc, { contains: () => env.focusInside }, env.state, 42, (id) => env.cleared.push(id), { revokeObjectURL: (u) => env.revoked.push(u) },
        () => env.calls.push('active:' + env.state.items.length), () => env.calls.push('list:' + env.state.items.length), env.resultEl, (msg) => { env.status = msg; });
      return env;
    };
    let env = make();
    eq('clear: one keydown listener', env.listeners.length, 1);
    env.listeners[0]({ ctrlKey: true, key: 'l' });
    eq('clear: Ctrl+L drops the files, revokes the result URLs and cancels a running conversion',
      [env.state.items.length, env.state.skipped.length, env.state.active, env.state.gen, env.revoked, env.cleared], [0, 0, 0, 8, ['blob:a'], [42]]);
    eq('clear: Ctrl+L redraws the empty result, hides it and clears the status', [env.calls, env.resultEl.hidden, env.status], [['active:0', 'list:0'], true, '']);
    env = make();
    env.listeners[0]({ metaKey: true, key: 'L' });
    eq('clear: ⌘+L does the same', [env.state.items.length, env.resultEl.hidden, env.status], [0, true, '']);
    for (const [name, ev, inside] of [['L without Ctrl/⌘', { key: 'l' }, true], ['Ctrl+K', { ctrlKey: true, key: 'k' }, true], ['Ctrl+L with the focus outside the tool', { ctrlKey: true, key: 'l' }, false]]) {
      env = make();
      env.focusInside = inside;
      env.listeners[0](ev);
      eq('clear: ' + name + ' changes nothing', [env.state.items.length, env.state.gen, env.revoked, env.calls, env.resultEl.hidden, env.status], [3, 7, [], [], false, 'old']);
    }
  }
}

// ---------- 13. Convert and Ctrl/Cmd+Enter (the block between code:start and code:end, run with stubs) ----------
{
  const cs = source.indexOf('/* ── code:start ── */');
  const ce = source.indexOf('/* ── code:end ── */');
  check('code: markers found', cs >= 0 && ce > cs);
  if (cs >= 0 && ce > cs) {
    const make = (value, items) => {
      const env = { loads: [], click: null, keydown: null, state: { items } };
      const codeInput = { value, addEventListener: (type, fn) => { if (type === 'keydown') env.keydown = fn; } };
      const button = { addEventListener: (type, fn) => { if (type === 'click') env.click = fn; } };
      new Function('$', 'codeInput', 'state', 'load', source.slice(cs, ce))((id) => (id === 's2p-convert-code' ? button : null), codeInput, env.state, (list) => env.loads.push(list));
      return env;
    };
    const files = [{ name: 'a.svg', result: {} }, { name: 'b.svg', result: {} }];
    const svg = '<svg ' + NS + '/>';
    for (const [name, value, items, expected] of [
      ['an empty box keeps the converted files', '', files, []],
      ['a box with only spaces keeps the converted files', ' \n\t', files, []],
      ['an empty box with nothing loaded reports the empty SVG', '', [], [[{ name: '', text: '' }]]],
      ['an empty box after converted code reports the empty SVG', '', [{ name: '', result: {} }], [[{ name: '', text: '' }]]],
      ['code in the box replaces the files', svg, files, [[{ name: '', text: svg }]]],
    ]) {
      const env = make(value, items);
      env.click();
      eq('code: Convert, ' + name, env.loads, expected);
    }
    check('code: the empty text that reaches load() is the engine\'s "empty" error', E.analyzeSvg('').error.code === 'empty' && E.analyzeSvg(' \n\t').error.code === 'empty');
    // Ctrl/Cmd+Enter in the box converts once: the event does not reach ToolLayout's page-wide
    // shortcut, which clicks the first .btn-primary (Convert).
    for (const mod of ['ctrlKey', 'metaKey']) {
      const env = make(svg, []);
      const seen = [];
      env.keydown({ key: 'Enter', [mod]: true, preventDefault: () => seen.push('prevent'), stopPropagation: () => seen.push('stop') });
      eq('code: ' + mod + '+Enter converts once and stops the event', [env.loads.length, seen], [1, ['prevent', 'stop']]);
    }
    const env = make(svg, []);
    const seen = [];
    env.keydown({ key: 'Enter', preventDefault: () => seen.push('prevent'), stopPropagation: () => seen.push('stop') });
    env.keydown({ key: 'a', ctrlKey: true, preventDefault: () => seen.push('prevent'), stopPropagation: () => seen.push('stop') });
    eq('code: Enter alone and other Ctrl keys are left to the box', [env.loads.length, seen], [0, []]);
  }
  // The hidden header of the download column: a plain word in every language (it used to
  // print the button template "Download {format}").
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  const STRINGS = new Function(source.slice(source.indexOf('// strings:start'), source.indexOf('// strings:end')).replace(/const STRINGS\s*=/, 'return '))();
  check('table: the hidden header uses listDownload, no template string is printed in the markup', markup.includes('<span class="s2p-sr">{T.listDownload}</span>') && !/\{T\.(download|result|listSizes|doneOne|doneMany)\}/.test(markup));
  eq('table: listDownload in four languages, without a placeholder', ['en', 'zh', 'ja', 'ko'].map((l) => STRINGS[l].listDownload), ['Download', '下载', 'ダウンロード', '다운로드']);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
