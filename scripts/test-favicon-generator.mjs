// Favicon Generator — package layout and the examples in the favicon guide
//
// Read:  src/components/tools/FaviconGeneratorTool.astro (extracts the real icoPack(), zipPack(),
//        buildHtmlSnippet() and the manifest object, and the size lists);
//        src/content/blog/favicon-generator-guide/{en,ja}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
// - the size lists (9 rendered sizes, 16/32/48 in the ICO) and the 11 file names in the ZIP;
// - icoPack(): header, one 16-byte entry per PNG, offsets, PNG payloads; zipPack(): a valid
//   STORED archive that `unzip -l` lists (skipped when unzip is missing);
// - `fav-ico` annotations: the ICO directory table in the guide (offsets and total size) equals
//   what icoPack() writes for PNGs of the quoted byte sizes;
// - `fav-files` annotations: the file order, and the "N files · X KB" line the tool shows for
//   the quoted byte sizes;
// - buildManifest(): with an app name, the manifest meets each manifest item of Chrome's install
//   criteria (web.dev "What does it take to be installable?": name or short_name, start_url,
//   display in fullscreen / standalone / minimal-ui / window-controls-overlay, a 192px and a
//   512px icon, no prefer_related_applications); every icon is "any" (the package has no
//   safe-zone image, so nothing is declared maskable); an empty name omits the keys instead of
//   writing "", and the page has the field labels and the missing-name warning in 4 languages;
// - the HTML snippet and the site.webmanifest quoted in the guides equal the tool's output with
//   default settings (theme color #ffffff, transparent background) and the name in the
//   `fav-manifest` annotation; the manifest row of the file table is its byte length;
// - the guides are indexable and have no template headings.
//
// Run: node scripts/test-favicon-generator.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/FaviconGeneratorTool.astro'), 'utf8');

let failures = 0;
let passes = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

// Returns the source of `function name(...) { ... }` by brace matching.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function ' + name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

const TARGET_SIZES = JSON.parse(/var TARGET_SIZES = (\[[^\]]+\])/.exec(source)[1]);
const ICO_SIZES = JSON.parse(/var ICO_SIZES = (\[[^\]]+\])/.exec(source)[1]);
check('rendered sizes', JSON.stringify(TARGET_SIZES) === '[16,32,48,64,96,128,180,192,512]', JSON.stringify(TARGET_SIZES));
check('ICO sizes', JSON.stringify(ICO_SIZES) === '[16,32,48]', JSON.stringify(ICO_SIZES));

const icoPack = new Function(extractFunction('icoPack') + '\nreturn icoPack;')();
const crcBlock = source.slice(source.indexOf('var crcTable'), source.indexOf('function zipPack'));
const zipPack = new Function('TextEncoder', crcBlock + extractFunction('zipPack') + '\nreturn zipPack;')(TextEncoder);
const state = { themeColor: '#ffffff', bgMode: 'transparent', bgColor: '#0ea5e9', appName: '', shortName: '' };
const buildHtmlSnippet = new Function('state', extractFunction('buildHtmlSnippet') + '\nreturn buildHtmlSnippet;')(state);
const buildManifest = new Function(extractFunction('buildManifest') + '\nreturn buildManifest;')();
const manifest = buildManifest(state);

// Chrome's install criteria for the manifest itself (web.dev/articles/install-criteria, 2024-09-19).
function installProblems(m) {
  const out = [];
  if (!m.name && !m.short_name) out.push('name or short_name');
  if (typeof m.start_url !== 'string' || !m.start_url) out.push('start_url');
  if (!['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'].includes(m.display)) out.push('display');
  const any = (m.icons || []).filter((i) => (i.purpose || 'any').split(/\s+/).includes('any'));
  for (const px of ['192x192', '512x512']) if (!any.some((i) => i.sizes.split(/\s+/).includes(px))) out.push('icon ' + px);
  if (m.prefer_related_applications === true) out.push('prefer_related_applications');
  return out;
}
{
  const named = JSON.parse(buildManifest({ ...state, appName: '  Example Site ', shortName: 'Example' }));
  check('named manifest meets the install criteria', installProblems(named).length === 0, installProblems(named).join(', '));
  check('name is trimmed', named.name === 'Example Site' && named.short_name === 'Example', JSON.stringify([named.name, named.short_name]));
  check('start_url is the site root', named.start_url === '/', named.start_url);
  check('no icon is declared maskable', named.icons.every((i) => i.purpose === 'any'), JSON.stringify(named.icons.map((i) => i.purpose)));
  check('icons point at files in the package', named.icons.every((i) => /^\/android-chrome-(192|512)\.png$/.test(i.src)));
  const nameOnly = JSON.parse(buildManifest({ ...state, appName: 'Example Site', shortName: '' }));
  check('empty short_name is omitted', !('short_name' in nameOnly) && installProblems(nameOnly).length === 0, JSON.stringify(nameOnly));
  const unnamed = JSON.parse(manifest);
  check('empty name: keys omitted, not ""', !('name' in unnamed) && !('short_name' in unnamed), JSON.stringify(unnamed));
  check('empty name: only the name criterion fails', installProblems(unnamed).join() === 'name or short_name', installProblems(unnamed).join());
  check('background color follows the color background', JSON.parse(buildManifest({ ...state, appName: 'x', bgMode: 'color' })).background_color === '#0ea5e9');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const block = new RegExp('\\n        ' + lang + ': \\{([\\s\\S]*?)\\n        \\}').exec(source);
    for (const key of ['appName', 'shortName', 'nameHint', 'nameMissing', 'maskableNote']) {
      check(lang + ' STRINGS has ' + key, !!block && new RegExp('\\b' + key + ': \'').test(block[1]));
    }
  }
}

// File names in the order runGenerate() pushes them.
const genBody = extractFunction('runGenerate');
const names = [];
for (const m of genBody.matchAll(/files\.push\(\{ name: (.+?), data/g)) {
  if (/\+ sz \+/.test(m[1])) {
    const list = /(\[[\d, ]+\])\.forEach\(function \(sz\) \{\s*files\.push/.exec(genBody)[1];
    for (const sz of JSON.parse(list)) names.push(new Function('sz', 'return ' + m[1])(sz));
  } else names.push(JSON.parse(m[1].replace(/'/g, '"')));
}
check('11 files in the package', names.length === 11, names.join(','));

function fakePng(size, bytes) {
  const b = new Uint8Array(bytes);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b[16] = size; // stand-in IHDR width byte, only used to tell payloads apart
  return b.buffer;
}
function readIco(bytes) {
  const dv = new DataView(bytes.buffer);
  const n = dv.getUint16(4, true);
  const entries = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    entries.push({ w: bytes[o] || 256, h: bytes[o + 1] || 256, bpp: dv.getUint16(o + 6, true), size: dv.getUint32(o + 8, true), offset: dv.getUint32(o + 12, true) });
  }
  return { reserved: dv.getUint16(0, true), type: dv.getUint16(2, true), entries };
}
const sample = icoPack({ 48: fakePng(48, 714), 16: fakePng(16, 343), 32: fakePng(32, 539) });
const parsed = readIco(sample);
check('ICO header: reserved 0, type 1, 3 entries', parsed.reserved === 0 && parsed.type === 1 && parsed.entries.length === 3);
check('ICO entries sorted by size', parsed.entries.map((e) => e.w).join() === '16,32,48');
check('ICO payloads are the PNGs', parsed.entries.every((e) => sample[e.offset] === 0x89 && sample[e.offset + 16] === e.w));
check('ICO 256 is written as 0', icoPack({ 256: fakePng(0, 20) })[6] === 0);

// zipPack() output listed by unzip.
let unzipOk = true;
try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzipOk = false; }
if (unzipOk) {
  const dir = mkdtempSync(join(tmpdir(), 'fav-'));
  const zip = zipPack([{ name: 'favicon.ico', data: sample }, { name: 'site.webmanifest', data: new TextEncoder().encode(manifest) }]);
  writeFileSync(join(dir, 'p.zip'), zip);
  const listing = execFileSync('unzip', ['-l', join(dir, 'p.zip')]).toString();
  check('unzip lists both entries', /favicon\.ico/.test(listing) && /site\.webmanifest/.test(listing), listing);
  const test = execFileSync('unzip', ['-t', join(dir, 'p.zip')]).toString();
  check('unzip CRC check passes', /No errors detected/.test(test), test);
  rmSync(dir, { recursive: true, force: true });
} else skips += 2;

// Same formula as runGenerate(): files.length + ' files · ' + (bytes / 1024).toFixed(1) + ' KB'
const statsLine = (sizes) => sizes.length + ' files · ' + (sizes.reduce((a, b) => a + b, 0) / 1024).toFixed(1) + ' KB';

for (const lang of ['en', 'ja']) {
  const text = readFileSync(join(root, 'src/content/blog/favicon-generator-guide', lang + '.mdx'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)[1];
  check(lang + ': guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  check(lang + ': no template headings', !h2.some((h) => /^what (is|are)\b|online|\bin code\b|オンライン/i.test(h)), h2.join(' | '));
  check(lang + ': no summary heading at the end', !/summary|conclusion|まとめ/i.test(h2[h2.length - 1] || ''));

  const htmlBlocks = [...text.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  check(lang + ': quotes the tool HTML snippet', htmlBlocks.includes(buildHtmlSnippet()));
  const fm2 = /\{\/\* fav-manifest: (.+?) \*\/\}\s*```json\n([\s\S]*?)\n```/.exec(text);
  check(lang + ': has a fav-manifest annotation before a json block', !!fm2);
  const guideManifest = fm2 ? buildManifest({ ...state, ...JSON.parse(fm2[1]) }) : '';
  if (fm2) check(lang + ': quotes the tool manifest', fm2[2] === guideManifest, fm2[2]);
  check(lang + ': no json block declares "any maskable"', ![...text.matchAll(/```json\n([\s\S]*?)\n```/g)].some((m) => /"purpose": "any maskable"/.test(m[1])));

  for (const m of text.matchAll(/\{\/\* fav-ico: (.+?) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    const pngs = {};
    for (const [sz, bytes] of Object.entries(spec.sizes)) pngs[sz] = fakePng(Number(sz), bytes);
    const ico = icoPack(pngs);
    const dir = readIco(ico);
    check(lang + ': fav-ico total size', ico.length === spec.total, ico.length);
    // Each table row reads "| n | W × W | 32 | bytes | offset | PNG |".
    for (const e of dir.entries) {
      const row = new RegExp('\\| \\d \\| ' + e.w + ' × ' + e.h + ' \\| ' + e.bpp + ' \\| ' + e.size + ' \\| ' + e.offset + ' \\|');
      check(lang + ': ICO table row for ' + e.w, row.test(text), row);
    }
    check(lang + ': first image offset is 6 + 16 × entries', dir.entries[0].offset === 6 + 16 * dir.entries.length);
  }
  for (const m of text.matchAll(/\{\/\* fav-files: (.+?) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    check(lang + ': fav-files names match the package order', JSON.stringify(spec.names) === JSON.stringify(names), spec.names.join());
    const mBytes = new TextEncoder().encode(guideManifest).length;
    const mi = spec.names.indexOf('site.webmanifest');
    check(lang + ': manifest bytes equal the quoted manifest', spec.letter[mi] === mBytes && spec.emoji[mi] === mBytes, mBytes);
    check(lang + ': letter stats line', statsLine(spec.letter) === spec.letterStats, statsLine(spec.letter));
    check(lang + ': emoji stats line', statsLine(spec.emoji) === spec.emojiStats, statsLine(spec.emoji));
    check(lang + ': stats lines are quoted', text.includes('「' + spec.emojiStats + '」') || text.includes('"' + spec.emojiStats + '"'));
    const fmt = (n) => n.toLocaleString('en-US') + ' B';
    spec.names.forEach((name, i) => {
      const row = '| `' + name + '` |';
      const line = text.split('\n').find((l) => l.startsWith(row));
      check(lang + ': table row for ' + name, line && line.includes(fmt(spec.emoji[i])) && line.includes(fmt(spec.letter[i])), line);
    });
  }
}

if (skips) console.log(`SKIP: ${skips} ZIP checks (unzip not found)`);
console.log(`\n${passes} passed, ${failures} failed${skips ? `, ${skips} skipped` : ''}`);
process.exit(failures ? 1 : 0);
