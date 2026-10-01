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
// (a textarea's innerHTML); the tool's decoder is not run here.
//
// Guide checks (src/content/blog/html-entity-guide/en.mdx and ja.mdx): every symbol table row
// (`| sym | names | &#dec; | &#xHEX; | UNICODE NAME |`) is recomputed from the WHATWG named
// character reference list and the Unicode 18.0 names in scripts/test-html-entity.fixtures.json:
// the name cell must list exactly the names that the list gives for that code point, every name
// must decode to it (entities package, WHATWG decoding), hex must equal decimal, and the Unicode
// name must match. The counts quoted in the text are recomputed from the list. Examples marked
// {/* he-check: {"encode": ..., "expect": ..., "count": n} */} run the tool's encoder;
// {/* he-check: {"decode": ..., "expect": ...} */} are decoded with the entities package in text
// mode. The expected text must appear in the page. The JavaScript sample is executed; the Python
// sample runs when python3 is available (SKIP otherwise).
//
// Run: node scripts/test-html-entity.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { decodeHTML, decodeHTMLAttribute } from 'entities';
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

// ---------- guide: symbol tables, counts and examples ----------
const fixtures = JSON.parse(readFileSync(join(root, 'scripts/test-html-entity.fixtures.json'), 'utf8'));
const whatwg = fixtures.whatwgEntities;
const unicodeName = new Map(fixtures.unicodeNames.map((l) => { const [cp, name] = l.split(';'); return [parseInt(cp, 16), name]; }));
const namesByCp = new Map();
for (const [name, v] of Object.entries(whatwg)) {
  if (!name.endsWith(';') || v.codepoints.length !== 1) continue;
  const cp = v.codepoints[0];
  if (!namesByCp.has(cp)) namesByCp.set(cp, []);
  namesByCp.get(cp).push(name);
}
const allNames = Object.keys(whatwg);
const semi = allNames.filter((n) => n.endsWith(';'));
const counts = {
  total: allNames.length,
  semicolon: semi.length,
  legacy: allNames.length - semi.length,
  singleChars: namesByCp.size,
  twoCodePoints: semi.filter((n) => whatwg[n].codepoints.length === 2).length,
};
eq('WHATWG list: entries', counts.total, 2231);
eq('WHATWG list: names with a semicolon', counts.semicolon, 2125);
eq('WHATWG list: legacy names', counts.legacy, 106);
eq('WHATWG list: characters with a name', counts.singleChars, 1446);
eq('WHATWG list: names giving two code points', counts.twoCodePoints, 93);
eq('six names for ≈', (namesByCp.get(0x2248) || []).length, 6);
eq('five names for →', (namesByCp.get(0x2192) || []).length, 5);
eq('five names for U+200B', (namesByCp.get(0x200b) || []).length, 5);
eq('&NotEqualTilde; is two code points', whatwg['&NotEqualTilde;'].codepoints.join(' '), '8770 824');
eq('&nvlt; is two code points', whatwg['&nvlt;'].codepoints.join(' '), '60 8402');
eq('&Copy; is not a name', decodeHTML('&Copy;'), '&Copy;');
eq('&angst; is U+00C5', whatwg['&angst;'].codepoints[0], 0xc5);

const placeholders = { en: ['(space)', '(invisible)'], ja: ['（空白）', '（見えない文字）'] };
const none = { en: 'none', ja: 'なし' };
let python = true;
try { execFileSync('python3', ['-c', 'import html'], { stdio: 'ignore' }); } catch { python = false; }
for (const lang of ['en', 'ja']) {
  const page = readFileSync(join(root, 'src/content/blog/html-entity-guide/' + lang + '.mdx'), 'utf8');
  for (const [k, v] of Object.entries(counts)) {
    eq(lang + ' guide quotes ' + k, page.includes(v.toLocaleString('en-US')), true);
  }
  let rows = 0;
  for (const m of page.matchAll(/^\| (.+?) \| (.+?) \| `&#(\d+);` \| `&#x([0-9A-F]+);` \| ([A-Z0-9 -]+) \|$/gm)) {
    rows++;
    const [, sym, namesCell, dec, hex, uname] = m;
    const cp = Number(dec);
    const label = lang + ' row U+' + cp.toString(16).toUpperCase();
    eq(label + ' hex', parseInt(hex, 16), cp);
    eq(label + ' symbol', sym === '`' + String.fromCodePoint(cp) + '`' || placeholders[lang].includes(sym), true);
    eq(label + ' Unicode name', uname, unicodeName.get(cp));
    const listed = namesCell === none[lang] ? [] : [...namesCell.matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    eq(label + ' names', listed.slice().sort().join(' '), (namesByCp.get(cp) || []).slice().sort().join(' '));
    for (const n of listed) eq(label + ' ' + n + ' decodes', decodeHTML(n), String.fromCodePoint(cp));
    eq(label + ' decimal decodes', decodeHTML('&#' + dec + ';'), String.fromCodePoint(cp));
  }
  eq(lang + ' guide has symbol tables', rows >= 80, true);
  let examples = 0;
  for (const m of page.matchAll(/\{\/\* he-check: (\{.*?\}) \*\/\}/g)) {
    examples++;
    const ex = JSON.parse(m[1]);
    if (ex.encode !== undefined) {
      const r = encodeHtml(ex.encode);
      eq(lang + ' encode ' + ex.encode, r.text, ex.expect);
      if (ex.count !== undefined) eq(lang + ' count ' + ex.encode, r.count, ex.count);
    } else {
      eq(lang + ' decode ' + ex.decode, decodeHTML(ex.decode), ex.expect);
    }
    if (!ex.expect.includes('\uFFFD')) eq(lang + ' page shows ' + ex.expect, page.includes(ex.expect), true);
  }
  eq(lang + ' guide carries examples', examples >= 3, true);
  // Text says: in an attribute the legacy name is left alone when followed by a letter.
  eq(lang + ' attribute keeps &region', decodeHTMLAttribute('?lang=en&region=us'), '?lang=en&region=us');
  // JavaScript sample: run the definition, then every `call; // 'result'` line.
  const js = page.match(/```javascript\n([\s\S]*?)```/)[1];
  const def = js.slice(0, js.indexOf(';\n') + 1);
  const escapeHtml = new Function(def + '\nreturn escapeHtml;')();
  for (const line of js.split('\n').filter((l) => /^escapeHtml\(/.test(l))) {
    const [call, comment] = line.split(' // ');
    eq(lang + ' JS ' + call, "'" + new Function('escapeHtml', 'return ' + call.replace(/;$/, ''))(escapeHtml) + "'", comment.trim());
  }
  const py = page.match(/```python\n([\s\S]*?)```/)[1].split('\n');
  if (!python) { console.log('SKIP: python3 not found, ' + lang + ' Python sample not run'); continue; }
  for (let i = 0; i < py.length - 1; i++) {
    if (!/^html\./.test(py[i]) || !/^# /.test(py[i + 1])) continue;
    const out = execFileSync('python3', ['-c', 'import html, sys; sys.stdout.write(repr(' + py[i] + '))'], { encoding: 'utf8' });
    eq(lang + ' Python ' + py[i], out, py[i + 1].slice(2));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
