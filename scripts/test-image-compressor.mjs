// Image Compressor — the output file name follows the format the browser actually produced
//
// Read:  src/components/tools/ImageCompressorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers; also reads the STRINGS table and <style>),
//        src/content/tools/image-compressor/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// HTML canvas toBlob() / OffscreenCanvas convertToBlob() fall back to image/png when the
// browser has no encoder for the requested type (HTML standard, "serialization of a bitmap as
// a file"); no browser encodes GIF. Before the fix the file was still named after the
// requested type (photo.webp holding PNG bytes, anim.gif holding PNG bytes). Also covers the
// fallback note in 4 languages, and that result-card classes created with innerHTML are
// styled through :global (scoped Astro styles do not reach them).
//
// Run: node scripts/test-image-compressor.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ImageCompressorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ImageCompressorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { resultFormat, renameOut };')();

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

eq('WebP encoded as requested', E.resultFormat('photo.jpg', 'image/webp', 'image/webp'), { outName: 'photo.webp', mime: 'image/webp', fellBack: false });
eq('no WebP encoder: PNG named .png', E.resultFormat('photo.jpg', 'image/webp', 'image/png'), { outName: 'photo.png', mime: 'image/png', fellBack: true });
eq('GIF kept: canvas gives PNG', E.resultFormat('anim.gif', 'image/gif', 'image/png'), { outName: 'anim.png', mime: 'image/png', fellBack: true });
eq('JPEG', E.resultFormat('a.b.png', 'image/jpeg', 'image/jpeg'), { outName: 'a.b.jpg', mime: 'image/jpeg', fellBack: false });
eq('blob without a type keeps the requested name', E.resultFormat('x.png', 'image/png', ''), { outName: 'x.png', mime: 'image/png', fellBack: false });

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const block = source.slice(source.indexOf(lang + ': {'), source.indexOf('\n        },', source.indexOf(lang + ': {')));
  const m = /fellBack: '([^']*)'/.exec(block);
  check(lang + ': fellBack string with {req} and {got}', m && m[1].includes('{req}') && m[1].includes('{got}'), lang);
  const mdx = readFileSync(join(root, 'src/content/tools/image-compressor', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer says the name keeps the chosen format', !/still names the file after the format you picked|仍按你选的格式命名|ファイル名は選んだ形式のまま|파일 이름은 선택한 형식대로/.test(mdx), lang);
}

const style = source.slice(source.indexOf('<style'), source.indexOf('</style>'));
for (const cls of ['ic-card', 'ic-card-name', 'ic-card-sizes', 'ic-card-note', 'ic-thumb', 'ic-dl', 'ic-saved', 'ic-larger']) {
  check('.' + cls + ' is styled through :global', new RegExp(':global\\(\\.' + cls + '\\)').test(style), cls);
  check('.' + cls + ' has no scoped rule', !new RegExp('^\\s*\\.' + cls + '\\b', 'm').test(style), cls);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
