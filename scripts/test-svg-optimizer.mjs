// SVG Optimizer — engine, SVGO configuration and rendering regression test
//
// Read:  src/components/tools/SvgOptimizerTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers and the STRINGS table between
//        `strings:start` / `strings:end`, so the test cannot drift from the shipped source);
//        src/components/tools/svg-optimizer-run.js and svg-optimizer.worker.js;
//        SvgToPngConverterTool.astro, GifSplitterTool.astro, ImageToBase64Tool.astro and
//        SvgToJsxTool.astro (declarations copied from them must stay identical);
//        scripts/test-svg-optimizer.fixtures.json; src/content/tools/svg-optimizer/*.mdx
//        (examples marked {/* svgo-check: ... */} are recomputed); node_modules/svgo.
// Write: os.tmpdir() only (a config file, an SVG and a ZIP for the svgo CLI and `unzip -t`,
//        removed afterwards); results to stdout.
// Exit:  0 if all PASS, 1 if any FAIL.
//
// Rendering checks use sharp (librsvg). The page draws with the browser instead; both
// sides of each comparison go through the same buildSvg() the page uses.
//
// Before this test the tool: passed an SVG without xmlns through unchanged, so the result
// did not open as a file and the preview showed a broken image; accepted any markup with
// "<svg" in it (`<div><svg>…</svg></div>` came back as a <div>); never said which IDs and
// classes were removed, that <script> and onclick survive, or that a result is larger than
// the input (the Korean flag grows from 589 to 816 bytes); showed no line or column for XML
// errors; ran SVGO on the main thread (a 2.9 MB file blocked the page for 1.7 s with
// multipass); handled one file at a time.
//
// Run: node scripts/test-svg-optimizer.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import * as svgo from 'svgo/browser';
import { builtinPlugins, VERSION as NODE_VERSION } from 'svgo';
import sharp from 'sharp';
import { transformSync } from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const toolsDir = join(root, 'src/components/tools');
const source = readFileSync(join(toolsDir, 'SvgOptimizerTool.astro'), 'utf8');
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-svg-optimizer.fixtures.json'), 'utf8'));

let failures = 0;
let passes = 0;
let skips = 0;
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
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
function engineBlock(src) {
  const s = src.indexOf(START_MARK);
  const e = src.indexOf(END_MARK);
  return s >= 0 && e > s ? src.slice(s, e) : null;
}
const block = engineBlock(source);
if (!block) {
  console.log('FAIL: could not locate the engine block in SvgOptimizerTool.astro');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const NAMES = ['SVG_NS', 'analyzeSvg', 'buildSvg', 'scanMarkup', 'uniqueNames', 'crc32', 'zipStore', 'percentEncodeBytes', 'svgToJsx',
  'PRESET_PLUGINS', 'EXTRA_PLUGINS', 'PARAM_PLUGINS', 'MAIN_PLUGINS', 'MAX_PRECISION', 'RENDER_SIDE', 'PIXEL_THRESHOLD', 'FORMATS',
  'defaultSettings', 'normalizeSettings', 'cleanPrefix', 'buildConfig', 'configSource', 'utf8Length', 'prepareInput', 'collectInfo',
  'inspect', 'errorInfo', 'renderPlan', 'compareImageData', 'verdict', 'diffMask', 'componentName', 'outputName', 'base64FromBytes',
  'formatOutput', 'gzipSize', 'isGzip', 'looksLikeSvgText'];
const E = new Function(block + '\nreturn { ' + NAMES.join(', ') + ' };')();

// ---------- 1. declarations copied from other tools are identical ----------
function extractDecl(src, name) {
  const re = new RegExp('(^|\\n)([ \\t]*)(function\\*? ' + name + '\\(|var ' + name + ' =)');
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
const COPIES = [
  ['SvgToPngConverterTool.astro', ['SVG_NS', 'XLINK_NS', 'ABS_UNITS', 'hasOwn', 'parseLength', 'parseStyle', 'parseViewBox', 'intrinsicSize', 'decodeXml', 'skipDeclaration', 'TAG_NAME', 'ATTR_NAME', 'SPACE', 'readStartTag', 'scanMarkup', 'attrOf', 'isLocalRef', 'cssRefs', 'analyzeSvg', 'num', 'buildSvg', 'uniqueNames']],
  ['GifSplitterTool.astro', ['crcTable', 'crc32', 'zipStore']],
  ['ImageToBase64Tool.astro', ['URL_RAW', 'percentEncodeBytes']],
  ['SvgToJsxTool.astro', ['SVG_ATTR_MAP', 'toCamelCase', 'jsxAttrName', 'ATTR_RE', 'processAttrs', 'TAG_RE', 'indent', 'svgToJsx']],
];
for (const [file, names] of COPIES) {
  const other = engineBlock(readFileSync(join(toolsDir, file), 'utf8'));
  for (const name of names) {
    const a = extractDecl(block, name);
    const b = other && extractDecl(other, name);
    check('copy: ' + name + ' is identical to ' + file, a !== null && b !== null && dedent(a) === dedent(b));
  }
}

// ---------- 2. plugin lists match the installed SVGO ----------
const presetDefault = builtinPlugins.find((p) => p.name === 'preset-default');
eq('preset-default: same plugins in the same order as SVGO ' + NODE_VERSION, E.PRESET_PLUGINS, presetDefault.plugins.map((p) => p.name));
eq('browser bundle and Node build are the same version', svgo.VERSION, NODE_VERSION);
eq('svgo is 4.1.0 (package.json pin)', NODE_VERSION, '4.1.0');
{
  const all = builtinPlugins.filter((p) => !p.isPreset).map((p) => p.name).sort();
  const covered = E.PRESET_PLUGINS.concat(E.EXTRA_PLUGINS, E.PARAM_PLUGINS, ['prefixIds']).sort();
  eq('every built-in plugin is a switch, a parameter plugin or prefixIds', covered, all);
  check('no plugin listed twice', new Set(covered).size === covered.length);
  check('main switches are all real plugins', E.MAIN_PLUGINS.every((p) => E.PRESET_PLUGINS.includes(p) || E.EXTRA_PLUGINS.includes(p)));
  const fm = source.slice(0, source.indexOf('\n---', 4));
  const listOf = (name) => JSON.parse(fm.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\])')) [1].replace(/'/g, '"').replace(/\]\s*as const$/, ']'));
  eq('frontmatter PRESET_PLUGINS matches the engine', listOf('PRESET_PLUGINS'), E.PRESET_PLUGINS);
  eq('frontmatter EXTRA_PLUGINS matches the engine', listOf('EXTRA_PLUGINS'), E.EXTRA_PLUGINS);
  eq('frontmatter PARAM_PLUGINS matches the engine', listOf('PARAM_PLUGINS'), E.PARAM_PLUGINS);
  eq('frontmatter MAIN_PLUGINS matches the engine', listOf('MAIN_PLUGINS'), E.MAIN_PLUGINS);
  // Each of the extra plugins really runs without parameters.
  for (const p of E.EXTRA_PLUGINS) {
    let ok = true;
    try { svgo.optimize(fixtures.inkscape, { plugins: [p] }); } catch (e) { ok = false; }
    check('extra plugin runs without parameters: ' + p, ok);
  }
}

// ---------- 3. settings and SVGO config ----------
const D = E.defaultSettings();
eq('default config is preset-default, multipass, 3 decimals', E.buildConfig(D), { multipass: true, floatPrecision: 3, plugins: ['preset-default'] });
for (const [name, svg] of Object.entries(fixtures).filter(([k]) => k !== '_source')) {
  eq('defaults equal plain preset-default with multipass: ' + name,
    svgo.optimize(svg, E.buildConfig(D)).data,
    svgo.optimize(svg, { multipass: true, plugins: ['preset-default'] }).data);
}
{
  const s = E.defaultSettings();
  s.preset.cleanupIds = false; s.preset.inlineStyles = false;
  s.extras.removeViewBox = true; s.extras.removeScripts = true;
  s.multipass = false; s.precision = 5; s.pretty = true; s.prefix = 'logo-';
  eq('config with overrides, extras, prefix and pretty', E.buildConfig(s), {
    multipass: false, floatPrecision: 5,
    js2svg: { pretty: true, indent: 2, eol: 'lf' },
    plugins: [{ name: 'preset-default', params: { overrides: { inlineStyles: false, cleanupIds: false } } }, 'removeViewBox', 'removeScripts',
      { name: 'prefixIds', params: { prefix: 'logo-', delim: '', prefixClassNames: false } }],
  });
  const out = svgo.optimize(fixtures.figma, E.buildConfig(s)).data;
  check('prefix: IDs get the prefix, classes do not', /id="logo-icon-check"/.test(out) && /class="stroke"/.test(out), out);
}
// Settings from the previous version of the tool (flat booleans + `advanced`).
{
  const old = { cleanupIds: false, convertColors: true, removeComments: true, removeViewBox: true, removeDimensions: false, mergePaths: false, multipass: false, precision: 2, advanced: { sortAttrs: false, removeDesc: true } };
  const s = E.normalizeSettings(old);
  eq('migrate: preset switches', [s.preset.cleanupIds, s.preset.mergePaths, s.preset.sortAttrs, s.preset.removeDesc], [false, false, false, true]);
  eq('migrate: extras, multipass, precision', [s.extras.removeViewBox, s.extras.removeDimensions, s.multipass, s.precision], [true, false, false, 2]);
  eq('normalize: null gives defaults', E.normalizeSettings(null), D);
  eq('normalize: wrong types fall back', E.normalizeSettings({ multipass: 'yes', precision: 99, pretty: 1, prefix: 7, format: 'png', preset: { cleanupIds: 'no' } }), D);
  eq('normalize: precision 0 and 8 are kept', [E.normalizeSettings({ precision: 0 }).precision, E.normalizeSettings({ precision: 8 }).precision, E.normalizeSettings({ precision: 2.5 }).precision], [0, 8, 3]);
  eq('normalize: format', E.normalizeSettings({ format: 'jsx' }).format, 'jsx');
  eq('normalize: unknown plugin names ignored', Object.keys(E.normalizeSettings({ preset: { notAPlugin: false } }).preset).length, 34);
  eq('prefix cleaning', ['logo-', ' my icon!', '9a', '-x', 'a.b_c-d', 'é'].map(E.cleanPrefix), ['logo-', 'myicon', 'a', 'x', 'a.b_c-d', '']);
  eq('normalize: __proto__ key does not change defaults', E.normalizeSettings(JSON.parse('{"__proto__": {"multipass": false}}')).multipass, true);
}

// The svgo.config.mjs text gives the same output as the tool, through the API and the CLI.
{
  const tmp = mkdtempSync(join(tmpdir(), 'svgo-test-'));
  try {
    const variants = [];
    variants.push(E.defaultSettings());
    const a = E.defaultSettings(); a.preset.cleanupIds = false; a.preset.mergePaths = false; a.extras.removeViewBox = true; a.extras.removeTitle = true; a.precision = 1; variants.push(a);
    const b = E.defaultSettings(); b.pretty = true; b.multipass = false; b.prefix = "it's-"; b.prefix = E.cleanPrefix(b.prefix); b.extras.removeDimensions = true; variants.push(b);
    const c = E.defaultSettings(); c.extras.removeXMLNS = true; c.extras.reusePaths = true; c.preset.removeDesc = false; c.precision = 0; variants.push(c);
    const input = join(tmp, 'in.svg');
    writeFileSync(input, fixtures.inkscape);
    let n = 0;
    for (const s of variants) {
      n++;
      const text = E.configSource(s, '4.1.0');
      const file = join(tmp, 'svgo' + n + '.config.mjs');
      writeFileSync(file, text);
      const mod = await import(pathToFileURL(file).href);
      eq('config source ' + n + ' imports to the same config', JSON.parse(JSON.stringify(mod.default)), JSON.parse(JSON.stringify(E.buildConfig(s))));
      const expected = svgo.optimize(fixtures.inkscape, E.buildConfig(s)).data;
      const out = join(tmp, 'out' + n + '.svg');
      const r = spawnSync(process.execPath, [join(root, 'node_modules/svgo/bin/svgo.js'), '--config', file, '-i', input, '-o', out, '--quiet'], { encoding: 'utf8' });
      check('svgo CLI runs config ' + n, r.status === 0, r.stderr);
      if (r.status === 0) eq('svgo CLI output equals the tool output, config ' + n, readFileSync(out, 'utf8'), expected);
    }
    check('config source names the version and the CLI command', /SVGO 4\.1\.0/.test(E.configSource(D, '4.1.0')) && /npx svgo@4\.1\.0 --config svgo\.config\.mjs/.test(E.configSource(D, '4.1.0')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- 4. input checks ----------
{
  const p = E.prepareInput('<svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h10v10z"/></svg>');
  eq('missing xmlns is added before SVGO', p.text, '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>');
  eq('…and kept in the output', svgo.optimize(p.text, E.buildConfig(D)).data, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h10v10z"/></svg>');
  const x = E.prepareInput('<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="#a"/></svg>');
  check('missing xmlns:xlink is added', /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/.test(x.text) && x.fixes.includes('xlink'));
  eq('empty input', E.prepareInput('   ').error, { code: 'empty' });
  eq('no element', E.prepareInput('hello').error, { code: 'notSvg' });
  eq('HTML around the SVG is rejected', E.prepareInput('<div><svg xmlns="http://www.w3.org/2000/svg"/></div>').error, { code: 'rootNotSvg', name: 'div' });
  eq('SVGO itself passes <div> through (why the check exists)', svgo.optimize('<div>hi</div>').data, '<div>hi</div>');
  eq('BOM, XML declaration and DOCTYPE are fine', E.prepareInput('\uFEFF<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>').error, undefined);
  eq('looksLikeSvgText', [E.looksLikeSvgText('x <svg>'), E.looksLikeSvgText('<SVG/>'), E.looksLikeSvgText('<svgx>'), E.looksLikeSvgText('hello')], [true, true, false, false]);
}

// ---------- 5. SVGO errors, the worker and the main-thread runner ----------
{
  const { runSvgo } = await import(pathToFileURL(join(toolsDir, 'svg-optimizer-run.js')).href);
  const bad = runSvgo(svgo, '<svg xmlns="http://www.w3.org/2000/svg">\n<g>\n<path d="M0 0"></g></svg>', {});
  eq('parser error keeps line, column and reason', [bad.error.name, bad.error.line, bad.error.column, bad.error.reason], ['SvgoParserError', 3, 19, 'Unexpected close tag']);
  eq('errorInfo: XML error', E.errorInfo(bad.error), { code: 'xml', line: 3, column: 19, reason: 'Unexpected close tag' });
  eq('errorInfo: other error', E.errorInfo({ name: 'Error', message: 'boom', line: null, column: null }), { code: 'svgo', message: 'boom' });
  eq('runSvgo returns data and version', runSvgo(svgo, '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', {}), { data: '<svg xmlns="http://www.w3.org/2000/svg"/>', version: NODE_VERSION });
  const bad2 = runSvgo(svgo, '<svg xmlns="http://www.w3.org/2000/svg"><text>&#1;</text></svg>', {});
  check('SVGO 4.1 rejects invalid character references', bad2.error && bad2.error.name === 'SvgoParserError', JSON.stringify(bad2));
  // The worker module, with a stand-in `self`.
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  await import(pathToFileURL(join(toolsDir, 'svg-optimizer.worker.js')).href);
  globalThis.self.onmessage({ data: { id: 7, text: fixtures.figma, config: E.buildConfig(D) } });
  globalThis.self.onmessage({ data: { id: 8, text: '<svg><g></svg>', config: {} } });
  eq('worker: answers with the request id and the result', [posted[0].id, posted[0].data === svgo.optimize(fixtures.figma, E.buildConfig(D)).data, posted[0].version], [7, true, NODE_VERSION]);
  eq('worker: errors are plain data', [posted[1].id, posted[1].error.name, typeof posted[1].error.line], [8, 'SvgoParserError', 'number']);
  check('worker: messages survive structured cloning', (() => { try { structuredClone(posted); return true; } catch (e) { return false; } })());
  delete globalThis.self;
  const worker = readFileSync(join(toolsDir, 'svg-optimizer.worker.js'), 'utf8');
  check('worker imports svgo/browser statically', /^import \* as svgo from 'svgo\/browser';/m.test(worker));
  check('component starts the worker through Vite ?worker', /import SvgoWorker from '\.\/svg-optimizer\.worker\.js\?worker';/.test(source));
}

// ---------- 6. notes ----------
function notesFor(svg, mutate) {
  const s = E.defaultSettings();
  if (mutate) mutate(s);
  const p = E.prepareInput(svg);
  const out = svgo.optimize(p.text, E.buildConfig(s)).data;
  const notes = E.inspect(p, out, s);
  return { out, notes, codes: notes.map((n) => n.code) };
}
const NS = 'xmlns="http://www.w3.org/2000/svg"';
{
  const f = notesFor(fixtures.figma);
  eq('figma example: output (page example)', f.out, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><title>Check</title><path d="M0 0h24v24H0z"/><path stroke-linecap="round" stroke-linejoin="round" d="m5 12 5 5 9-10" style="stroke:#000;stroke-width:2"/></svg>');
  eq('figma example: notes', f.notes, [{ code: 'idsGone', n: 1, items: ['#icon-check'], prefixed: false }, { code: 'classesGone', n: 1, items: ['.stroke'] }]);
  eq('figma example: bytes', [E.utf8Length(fixtures.figma), E.utf8Length(f.out)], [512, 254]);
  const k = notesFor('<svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0h10v10z"/></svg>');
  eq('no xmlns: fixXmlns note', k.codes, ['fixXmlns']);
  eq('xmlns removed on purpose: noXmlns, not fixXmlns', notesFor('<svg viewBox="0 0 2 2"><path d="M0 0h1v1z"/></svg>', (s) => { s.extras.removeXMLNS = true; }).codes, ['noXmlns']);
  const sc = `<svg ${NS} viewBox="0 0 10 10"><script>alert(1)</script><rect width="10" height="10" onclick="alert(2)"/></svg>`;
  eq('scripts and event attributes are kept by default', notesFor(sc).notes.filter((n) => n.code === 'scriptsKept'), [{ code: 'scriptsKept', n: 2 }]);
  const rs = notesFor(sc, (s) => { s.extras.removeScripts = true; });
  eq('removeScripts strips them', [rs.codes.includes('scriptsRemoved'), /script|onclick/.test(rs.out)], [true, false]);
  const js = notesFor(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="java\tscript:alert(1)"><rect width="1" height="1"/></a></svg>`, (s) => { s.extras.removeScripts = true; });
  check('removeScripts (4.1.0) strips a javascript: link with a tab in it', !/script/.test(js.out), js.out);
  const vb = notesFor(`<svg ${NS} width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>`, (s) => { s.extras.removeViewBox = true; });
  eq('removeViewBox: viewBoxGone with the fixed size', vb.notes, [{ code: 'viewBoxGone', w: '24', h: '24' }]);
  const vb2 = notesFor(`<svg ${NS} width="48" height="48" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>`, (s) => { s.extras.removeViewBox = true; });
  eq('removeViewBox keeps a viewBox that differs from width/height', vb2.codes, ['unchanged']);
  const dm = notesFor(`<svg ${NS} width="24" height="24" viewBox="0 0 24 24"><path d="M1 1h2"/></svg>`, (s) => { s.extras.removeDimensions = true; });
  eq('removeDimensions: sizeGone', dm.codes, ['sizeGone']);
  const both = notesFor(`<svg ${NS} width="24" height="24"><path d="M1 1h2"/></svg>`, (s) => { s.extras.removeViewBox = true; s.extras.removeDimensions = true; });
  check('removeDimensions writes a viewBox from width/height', /viewBox="0 0 24 24"/.test(both.out) && !/width=/.test(both.out), both.out);
  eq('removeTitle: titleGone', notesFor(fixtures.figma, (s) => { s.extras.removeTitle = true; }).codes.includes('titleGone'), true);
  eq('title is kept by default (SVGO 4)', notesFor(fixtures.figma).out.includes('<title>Check</title>'), true);
  const ext = notesFor(`<svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><style>@import url("https://fonts.example/a.css");</style><image href="https://example.com/a.png" width="10" height="10"/><use xlink:href="sprite.svg#icon"/></svg>`);
  eq('external files are listed', ext.notes.find((n) => n.code === 'external'), { code: 'external', urls: ['https://example.com/a.png', 'sprite.svg#icon', 'https://fonts.example/a.css'] });
  eq('animation', notesFor(`<svg ${NS} viewBox="0 0 2 2"><circle r="1"><animate attributeName="r" values="1;0.5" dur="1s"/></circle></svg>`).codes.includes('animation'), true);
  eq('CSS animation', notesFor(`<svg ${NS} viewBox="0 0 2 2"><style>@keyframes s{to{opacity:0}}circle{animation:s 1s}</style><circle r="1"/></svg>`).codes.includes('animation'), true);
  const png = 'data:image/png;base64,' + Buffer.alloc(3000, 7).toString('base64');
  const ras = notesFor(`<svg ${NS} viewBox="0 0 2 2"><image width="2" height="2" href="${png}"/></svg>`);
  eq('raster data share', ras.notes.find((n) => n.code === 'raster').pct > 90, true);
  eq('entities expanded', notesFor(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY c "#ff0000">]><svg ${NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="&c;"/></svg>`).codes, ['entities']);
  const he = notesFor(`<svg ${NS}><text>a&nbsp;b</text></svg>`);
  eq('HTML entity', he.notes[0], { code: 'htmlEntity', names: ['&nbsp;'] });
  eq('…written as U+00A0', he.out, `<svg xmlns="http://www.w3.org/2000/svg"><text>a\u00a0b</text></svg>`);
  eq('low precision', notesFor(fixtures.art, (s) => { s.precision = 1; }).codes.includes('lowPrecision'), true);
  eq('unchanged', notesFor('<svg xmlns="http://www.w3.org/2000/svg"/>').codes, ['unchanged']);
  const kr = notesFor(fixtures.korea);
  eq('Korean flag grows (transforms written into paths)', [E.utf8Length(fixtures.korea), E.utf8Length(kr.out), kr.notes.find((n) => n.code === 'larger')], [589, 816, { code: 'larger', delta: 227 }]);
  const ids = notesFor(`<svg ${NS} viewBox="0 0 24 24"><defs><linearGradient id="brand-gradient"><stop offset="0" stop-color="red"/></linearGradient></defs><rect id="bg" width="24" height="24" fill="url(#brand-gradient)"/></svg>`);
  eq('IDs: referenced one renamed, unused one removed', ids.notes, [{ code: 'idsGone', n: 2, items: ['#brand-gradient', '#bg'], prefixed: false }]);
  eq('IDs kept when cleanupIds is off', notesFor(`<svg ${NS}><g id="keep"><rect width="1" height="1"/></g></svg>`, (s) => { s.preset.cleanupIds = false; s.preset.collapseGroups = false; }).codes, []);
  const info = E.collectInfo(`<svg ${NS} viewBox="0 0 1 1" width="1"><title>a</title><title>b</title><g id="x" class="a b"><a href=" javascript:x"/></g><foreignObject/></svg>`);
  eq('collectInfo', [info.viewBox, info.width, info.height, info.title, info.ids, info.classes, info.scripts, info.foreign], [true, true, false, 2, ['x'], ['a', 'b'], 1, true]);
}

// ---------- 7. pixel comparison ----------
{
  const px = (...v) => Uint8ClampedArray.from(v);
  eq('identical', E.compareImageData(px(1, 2, 3, 255), px(1, 2, 3, 255)), { max: 0, changed: 0, total: 1, ratio: 0 });
  eq('transparent pixels match whatever their color', E.compareImageData(px(255, 0, 0, 0), px(0, 0, 255, 0)).changed, 0);
  eq('threshold is exclusive', [E.compareImageData(px(0, 0, 0, 255), px(24, 0, 0, 255)).changed, E.compareImageData(px(0, 0, 0, 255), px(25, 0, 0, 255)).changed], [0, 1]);
  eq('alpha difference counts', E.compareImageData(px(0, 0, 0, 255), px(0, 0, 0, 200)).max, 55);
  eq('verdict bands', [E.verdict({ ratio: 0 }), E.verdict({ ratio: 0.001 }), E.verdict({ ratio: 0.0011 }), E.verdict({ ratio: 0.01 }), E.verdict({ ratio: 0.02 })], ['same', 'same', 'minor', 'minor', 'changed']);
  const m = E.diffMask(px(0, 0, 0, 255, 9, 9, 9, 255), px(200, 0, 0, 255, 9, 9, 9, 255));
  eq('diff mask: changed pixel red, same pixel grey', [Array.from(m.slice(0, 4)), m[4] === m[5] && m[5] === m[6] && m[7] === 255], [[220, 30, 30, 255], true]);
  eq('render plan: long side 400', [E.renderPlan({ width: 24, height: 24 }), E.renderPlan({ width: 900, height: 600 }), E.renderPlan({ width: 1, height: 1000 })], [{ width: 400, height: 400 }, { width: 400, height: 267 }, { width: 1, height: 400 }]);
}

// Render both sides the way the page does (buildSvg at the original's plan size), with librsvg.
async function rasterize(svg, w, h) {
  return new Uint8ClampedArray(await sharp(Buffer.from(svg), { density: 72 }).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer());
}
async function renderCompare(svg, mutate) {
  const s = E.defaultSettings();
  if (mutate) mutate(s);
  const p = E.prepareInput(svg);
  const out = svgo.optimize(p.text, E.buildConfig(s)).data;
  const plan = E.renderPlan(p.analysis.size);
  const before = E.buildSvg(p.text, p.analysis, plan);
  const aAfter = E.analyzeSvg(out);
  const after = E.buildSvg(out, aAfter, plan);
  const cmp = E.compareImageData(await rasterize(before, plan.width, plan.height), await rasterize(after, plan.width, plan.height));
  return { cmp, verdict: E.verdict(cmp), out };
}
for (const name of ['figma', 'inkscape', 'illustrator', 'korea', 'art', 'echarts', 'krds_calendar', 'illustrator_ja']) {
  const r = await renderCompare(fixtures[name]);
  check('rendering: default settings keep ' + name + ' the same', r.verdict === 'same', JSON.stringify(r.cmp));
}
{
  const r0 = await renderCompare(fixtures.art, (s) => { s.precision = 0; });
  eq('rendering: 0 decimals on a 2-unit viewBox is visibly different', r0.verdict, 'changed');
  const r1 = await renderCompare(fixtures.korea, (s) => { s.precision = 1; });
  check('rendering: 1 decimal moves the Korean flag\'s trigrams', r1.verdict !== 'same', JSON.stringify(r1.cmp));
  const vb = await renderCompare(`<svg ${NS} width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#1a73e8"/></svg>`, (s) => { s.extras.removeViewBox = true; });
  eq('rendering: removeViewBox renders the same at the original size (the note covers scaling)', vb.verdict, 'same');
  const dm = await renderCompare(`<svg ${NS} width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#1a73e8"/></svg>`, (s) => { s.extras.removeDimensions = true; });
  eq('rendering: removeDimensions renders the same at the original size', dm.verdict, 'same');
  const hidden = await renderCompare(`<svg ${NS} viewBox="0 0 20 20"><rect width="20" height="20" fill="#fff"/><circle cx="10" cy="10" r="6" fill="red"/></svg>`, (s) => { s.preset.removeHiddenElems = true; });
  eq('rendering: white background kept', hidden.verdict, 'same');
}

// ---------- 8. output formats ----------
{
  const svg = svgo.optimize(fixtures.figma, E.buildConfig(D)).data;
  eq('format svg', E.formatOutput('svg', svg, 'check.svg'), svg);
  const uri = E.formatOutput('uri', svg, 'check.svg');
  check('format uri: data URI that decodes back', uri.startsWith('data:image/svg+xml,') && decodeURIComponent(uri.slice(19)) === svg && !/["#<>]/.test(uri.slice(19)), uri);
  const b64 = E.formatOutput('base64', svg, 'check.svg');
  eq('format base64 decodes back', Buffer.from(b64.slice(26), 'base64').toString('utf8'), svg);
  check('format css', /^background-image: url\("data:image\/svg\+xml,[^"]+"\);$/.test(E.formatOutput('css', svg, 'x.svg')));
  const uni = '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語 한국어 中文 😀</text></svg>';
  eq('format uri/base64 keep non-ASCII', [decodeURIComponent(E.formatOutput('uri', uni, '').slice(19)), Buffer.from(E.formatOutput('base64', uni, '').slice(26), 'base64').toString('utf8')], [uni, uni]);
  const big = 'x'.repeat(100000);
  eq('base64 of a large buffer', E.base64FromBytes(new TextEncoder().encode(big)), Buffer.from(big).toString('base64'));
  const jsx = E.formatOutput('jsx', svg, 'icon-check.svg');
  check('format jsx: component named after the file', /function IconCheck\(props\)/.test(jsx) && /strokeLinecap="round"/.test(jsx) && /\{\.\.\.props\}/.test(jsx), jsx);
  // The JSX compiles and renders the same element tree.
  const js = transformSync(jsx.replace(/^import .*$/m, ''), { loader: 'jsx', jsx: 'transform', jsxFactory: 'h', format: 'cjs' }).code;
  const h = (type, props, ...children) => ({ type, props: props || {}, children });
  const mod = { exports: {} };
  new Function('h', 'module', 'exports', js)(h, mod, mod.exports);
  const tree = mod.exports.default({ width: 48 });
  eq('jsx: root svg takes caller props last', [tree.type, tree.props.width, tree.props.viewBox], ['svg', 48, '0 0 24 24']);
  eq('component names', ['icon-check.svg', 'ArrowLeft.svgz', '24px.svg', '日本.svg', ''].map(E.componentName), ['IconCheck', 'ArrowLeft', 'Svg24px', 'SvgIcon', 'SvgIcon']);
  eq('output names', ['logo.svg', 'logo.SVGZ', 'a/b?.svg', '', '  '].map(E.outputName), ['logo.svg', 'logo.svg', 'a_b_.svg', 'optimized.svg', 'optimized.svg']);
  eq('unique names in a ZIP', E.uniqueNames(['a.svg', 'A.svg', 'b.svg', 'a.svg']), ['a.svg', 'A-2.svg', 'b.svg', 'a-3.svg']);
}

// ---------- 9. gzip, svgz, ZIP ----------
{
  const svg = fixtures.inkscape;
  eq('gzip size matches zlib default level', await E.gzipSize(svg), gzipSync(Buffer.from(svg)).length);
  eq('isGzip', [E.isGzip(gzipSync(Buffer.from('x'))), E.isGzip(new TextEncoder().encode('<svg'))], [true, false]);
  eq('utf8Length', ['abc', 'é', '日本', '😀', '\uD800'].map(E.utf8Length), [3, 2, 6, 4, 3]);
  const enc = new TextEncoder();
  const zip = E.zipStore([{ name: 'a.svg', data: enc.encode('<svg/>') }, { name: 'アイコン.svg', data: enc.encode('<svg></svg>') }]);
  const tmp = mkdtempSync(join(tmpdir(), 'svgo-zip-'));
  try {
    const f = join(tmp, 'o.zip');
    writeFileSync(f, zip);
    const r = spawnSync('unzip', ['-t', f], { encoding: 'utf8' });
    if (r.error) skip('zip: unzip -t', 'unzip not installed');
    else check('zip: unzip -t passes', r.status === 0 && /No errors detected/.test(r.stdout), r.stdout + r.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- 10. strings, static checks ----------
{
  const m = source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
  const STRINGS = new Function(m[1] + '\nreturn STRINGS;')();
  const shape = (o, p = '') => Object.keys(o).sort().flatMap((k) => (typeof o[k] === 'object' ? shape(o[k], p + k + '.') : [p + k]));
  const keysEn = shape(STRINGS.en);
  for (const lang of ['zh', 'ja', 'ko']) eq('strings: ' + lang + ' has the same keys as en', shape(STRINGS[lang]), keysEn);
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const get = (o, path) => path.split('.').reduce((x, k) => x[k], o);
  for (const lang of ['zh', 'ja', 'ko']) {
    const bad = keysEn.filter((k) => ph(get(STRINGS.en, k)) !== ph(get(STRINGS[lang], k)));
    eq('strings: ' + lang + ' placeholders match en', bad, []);
  }
  const noteCodes = ['fixXmlns', 'fixXlink', 'htmlEntity', 'entities', 'idsGone', 'classesGone', 'viewBoxGone', 'sizeGone', 'titleGone', 'noXmlns', 'scriptsKept', 'scriptsRemoved', 'external', 'animation', 'raster', 'lowPrecision', 'unchanged', 'larger', 'skipped'];
  const used = [...block.matchAll(/code: '(\w+)'/g)].map((x) => x[1]);
  const errCodes = ['empty', 'notSvg', 'rootNotSvg', 'xml', 'svgo', 'load', 'read', 'tooLarge', 'gzip'];
  eq('strings: every note and error code the engine emits has text', used.filter((c) => !noteCodes.includes(c) && !errCodes.includes(c) && c !== 'relativeSize'), []);
  eq('strings: note texts', Object.keys(STRINGS.en.note).sort(), noteCodes.slice().sort());
  eq('strings: error texts', Object.keys(STRINGS.en.err).sort(), errCodes.slice().sort());
  eq('strings: check states', Object.keys(STRINGS.en.check).sort(), ['afterFailed', 'beforeFailed', 'changed', 'minor', 'pending', 'same', 'skipped']);
  eq('strings: main switch labels', Object.keys(STRINGS.en.p), E.MAIN_PLUGINS);
  const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
  check('script never writes HTML', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script));
  check('script does not fetch or store anything itself', !/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(script));
  check('settings saved through ztPersist (preference policy)', /window\.ztPersist\.save\(SLUG, settings\)/.test(script) && /'svg-optimizer': 'preference'/.test(readFileSync(join(root, 'src/data/persistence.ts'), 'utf8')));
  check('previews are <img> elements fed by blob URLs (scripts in the SVG do not run)', /new Image\(\)/.test(script) && /URL\.createObjectURL\(new Blob\(\[svg\]/.test(script));
}

// ---------- 11. page examples ----------
{
  let count = 0;
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/svg-optimizer/' + lang + '.mdx'), 'utf8');
    for (const mm of mdx.matchAll(/\{\/\* svgo-check: (\{[\s\S]*?\}) \*\/\}/g)) {
      count++;
      const spec = JSON.parse(mm[1]);
      const input = spec.fixture ? fixtures[spec.fixture] : spec.input;
      const r = notesFor(input, (s) => {
        Object.assign(s.extras, spec.extras || {});
        Object.assign(s.preset, spec.preset || {});
        if (spec.precision != null) s.precision = spec.precision;
        if (spec.prefix) s.prefix = spec.prefix;
      });
      const tag = lang + ' example ' + count;
      if (spec.output) eq(tag + ': output', r.out, spec.output);
      if (spec.output) check(tag + ': output is on the page', mdx.includes(spec.output) || mdx.includes(spec.output.replace(/</g, '&lt;').replace(/>/g, '&gt;')));
      if (spec.bytes) eq(tag + ': bytes', [E.utf8Length(input), E.utf8Length(r.out)], spec.bytes);
      if (spec.notes) eq(tag + ': notes', r.codes, spec.notes);
      if (spec.render) eq(tag + ': rendering', (await renderCompare(input, (s) => { Object.assign(s.extras, spec.extras || {}); Object.assign(s.preset, spec.preset || {}); if (spec.precision != null) s.precision = spec.precision; })).verdict, spec.render);
      if (spec.gzip) eq(tag + ': gzip', [await E.gzipSize(input), await E.gzipSize(r.out)], spec.gzip);
    }
  }
  check('page examples found', count > 0, String(count));
}

console.log('\n' + passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
