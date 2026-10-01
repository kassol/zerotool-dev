// HTML Entity encoder — escaped characters and numeric references per code point
//
// Read:  src/components/tools/HtmlEntityTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: & < > " ' are written as &amp; &lt; &gt; &quot; &#39;; other ASCII is unchanged;
// non-ASCII becomes one decimal reference per code point, so an emoji is one reference
// (it used to be two surrogate references that decode to two U+FFFD); the converted-character
// count; the examples on the English tool page. Decoding uses the browser's HTML parser
// (a textarea's innerHTML) and is not covered here.
//
// Run: node scripts/test-html-entity.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/HtmlEntityTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlEntityTool.astro');
  process.exit(1);
}
const { encodeHtml } = new Function(source.slice(startIndex, endIndex) + '\nreturn { encodeHtml };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

eq('special characters', encodeHtml('&<>"\'').text, '&amp;&lt;&gt;&quot;&#39;');
eq('plain ASCII unchanged', encodeHtml('a = b; // ok\n').text, 'a = b; // ok\n');
eq('BMP character', encodeHtml('é').text, '&#233;');
eq('emoji is one reference', encodeHtml('😀').text, '&#128512;');
eq('emoji count', encodeHtml('a😀b').count, 1);
eq('ZWJ sequence', encodeHtml('👩‍💻').text, '&#128105;&#8205;&#128187;');
eq('lone surrogate kept as its code', encodeHtml('\uD800x').text, '&#55296;x');
eq('round trip of references to code points',
  [...encodeHtml('😀é中').text.matchAll(/&#(\d+);/g)].map((m) => String.fromCodePoint(+m[1])).join(''), '😀é中');

// examples on the English page
eq('page: div', encodeHtml('<div class="box">').text, '&lt;div class=&quot;box&quot;&gt;');
eq('page: cafe', encodeHtml('Café © 2024').text, 'Caf&#233; &#169; 2024');
eq('page: attribute', encodeHtml('<a title="Tom\'s café">').text, '&lt;a title=&quot;Tom&#39;s caf&#233;&quot;&gt;');
eq('page: attribute count', encodeHtml('<a title="Tom\'s café">').count, 6);
eq('page: emoji', encodeHtml('Ship it 🚀').text, 'Ship it &#128640;');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
