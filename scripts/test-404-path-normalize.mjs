// 404 page path normalization — regression test
//
// Read:  src/pages/404.astro (extracts the real block between the `engine:start` /
//        `engine:end` markers, so this test cannot drift from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Unicode hyphens (U+2010–U+2015, U+2212, U+FE58, U+FE63, U+FF0D) mapped to "-",
// trailing ASCII / full-width punctuation removed with the trailing slash kept, the
// observed 404 paths from GA (2026-09-27), and idempotence (a normalized path maps to
// itself, which is what prevents a redirect loop on the 404 page).
//
// Run: node scripts/test-404-path-normalize.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/pages/404.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in src/pages/404.astro');
  process.exit(1);
}
const normalize = new Function(source.slice(startIndex, endIndex) + '\nreturn normalizeNotFoundPath;')();

let failures = 0;
let passes = 0;
function equal(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + ' — got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

// Observed in GA "404 — Page Not Found" views, 2026-08-30 → 2026-09-26
const observed = [
  ['/zh/tools/zero\u2011width\u2011character\u2011detector/', '/zh/tools/zero-width-character-detector/'],
  ['/tools/markdown\u2011to\u2011word/', '/tools/markdown-to-word/'],
  ['/zh/tools/markdown\u2011to\u2011word/', '/zh/tools/markdown-to-word/'],
  ['/tools/svg\u2011to\u2011png\u2011converter/', '/tools/svg-to-png-converter/'],
  ['/zh/tools/qr\u2011code\u2011decoder', '/zh/tools/qr-code-decoder'],
  ['/tools/image\u2011to\u2011base64/', '/tools/image-to-base64/'],
  ['/tools/protobuf\u2011to\u2011json/', '/tools/protobuf-to-json/'],
  ['/tools/markdown\u2011to\u2011word；/', '/tools/markdown-to-word/'],
  ['/zh/tools/markdown-to-word/；', '/zh/tools/markdown-to-word/'],
  ['/tools/zero-width-character-detector/)', '/tools/zero-width-character-detector/'],
];
for (const [input, expected] of observed) equal('observed ' + JSON.stringify(input), normalize(input), expected);

const hyphens = ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uFE58', '\uFE63', '\uFF0D'];
for (const h of hyphens) {
  const code = 'U+' + h.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  equal('hyphen ' + code, normalize('/tools/json' + h + 'formatter/'), '/tools/json-formatter/');
}

const trailing = [')', ']', '）', '】', '」', '』', '；', ';', '，', ',', '。', '、', '：', ':', '！', '!', '？', '?', '"', "'", '“', '”', '‘', '’', '》', '>', ' '];
for (const c of trailing) {
  equal('trailing ' + JSON.stringify(c) + ' no slash', normalize('/tools/base64' + c), '/tools/base64');
  equal('trailing ' + JSON.stringify(c) + ' before slash', normalize('/tools/base64' + c + '/'), '/tools/base64/');
  equal('trailing ' + JSON.stringify(c) + ' after slash', normalize('/tools/base64/' + c), '/tools/base64/');
}
equal('several trailing marks', normalize('/tools/base64/)。”'), '/tools/base64/');

// Left unchanged: valid paths, inner punctuation, a real file extension
const unchanged = [
  '/', '/zh/', '/tools/base64/', '/tools/base64', '/zh/tools/qr-code.decoder',
  '/AGENTS.md', '/blog/csv-json-guide/', '/tools/svg-to-png/ [bulkpictools.com/svg](https://bulkpictools.com/svg)-to-png',
];
for (const p of unchanged) equal('unchanged ' + JSON.stringify(p), normalize(p), p);

// Idempotence: the 404 page redirects only when the path changes, so a normalized path
// must normalize to itself or the page would loop.
for (const [input] of observed) {
  const once = normalize(input);
  equal('idempotent ' + JSON.stringify(input), normalize(once), once);
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
