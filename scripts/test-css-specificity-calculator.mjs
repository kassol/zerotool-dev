// CSS Specificity Calculator — specificity per Selectors Level 4 §17
//
// Read:  src/components/tools/CssSpecificityCalculatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); the 4 tool pages under src/content/tools/css-specificity-calculator/
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected values are the examples in Selectors Level 4 §17 and the MDN "Specificity" page,
// plus values worked out by hand from the §17 rules. Covers the reported defects: class
// selectors were stripped before functional pseudo-classes, so `:where(.active, p)` gave (0,1,0);
// `:is()` / `:not()` / `:has()` summed their arguments instead of taking the most specific one;
// `:nth-child(2n+1)` counted `n` as a type selector; `#top` inside an attribute value counted as
// an ID; commas inside `:is()` / `:where()` split the input into separate selectors.
// Also: `:nth-child(An+B of S)`, legacy pseudo-elements, `::slotted()` / `:host()` (CSS Scoping),
// namespace prefixes, escapes, `&`, syntax errors with positions, 4-language STRINGS keys,
// the examples quoted on the 4 tool pages.
//
// Run: node scripts/test-css-specificity-calculator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssSpecificityCalculatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CssSpecificityCalculatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { specificity, splitSelectorList };')();

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
function spec(sel) {
  try { const s = E.specificity(sel); return [s.a, s.b, s.c]; } catch (e) { return 'error: ' + e.message; }
}

// ---------- Selectors Level 4 §17 examples ----------
const SPEC_EXAMPLES = [
  ['*', [0, 0, 0]],
  ['LI', [0, 0, 1]],
  ['UL LI', [0, 0, 2]],
  ['UL OL+LI', [0, 0, 3]],
  ['H1 + *[REL=up]', [0, 1, 1]],
  ['UL OL LI.red', [0, 1, 3]],
  ['LI.red.level', [0, 2, 1]],
  ['#x34y', [1, 0, 0]],
  ['#s12:not(FOO)', [1, 0, 1]],
  ['.foo :is(.bar, #baz)', [1, 1, 0]],
];
for (const [sel, exp] of SPEC_EXAMPLES) eq('Selectors 4 §17: ' + sel, spec(sel), exp);

// ---------- MDN Specificity examples ----------
const MDN_EXAMPLES = [
  ['#myElement', [1, 0, 0]],
  ['.bodyClass .sectionClass .parentClass [id="myElement"]', [0, 4, 0]],
  [':root #myApp input:required', [1, 2, 1]],
  ['#myApp [type="password"]', [1, 1, 0]],
  ['input:focus', [0, 1, 1]],
  [':not(#fakeId #fakeId #fakeID)', [3, 0, 0]],
  [':is(p, #fakeId)', [1, 0, 0]],
  ['h1:has(+ h2, > #fakeId)', [1, 0, 1]],
  [':where(#defaultTheme) a', [0, 0, 1]],
  ['p::first-line', [0, 0, 2]],
];
for (const [sel, exp] of MDN_EXAMPLES) eq('MDN: ' + sel, spec(sel), exp);

// ---------- reported defects ----------
eq(':where() is zero even with classes inside', spec(':where(.active, p)'), [0, 0, 0]);
eq(':where(#a .b) div', spec(':where(#a .b) div'), [0, 0, 1]);
eq(':is() takes the most specific argument', spec(':is(.a, .b.c, d)'), [0, 2, 0]);
eq(':not() takes the most specific argument', spec(':not(.a, #b)'), [1, 0, 0]);
eq(':has() takes the most specific argument', spec('div:has(> img, > .x.y)'), [0, 2, 1]);
eq(':nth-child(2n+1) is one pseudo-class', spec(':nth-child(2n+1)'), [0, 1, 0]);
eq('li:nth-child(2n+1)', spec('li:nth-child(2n+1)'), [0, 1, 1]);
eq(':nth-child(odd)', spec(':nth-child(odd)'), [0, 1, 0]);
eq(':nth-last-of-type(-n + 3)', spec('p:nth-last-of-type(-n + 3)'), [0, 1, 1]);
eq('a[href="#top"] has no ID', spec('a[href="#top"]'), [0, 1, 1]);
eq('[data-x=".a.b"] counts once', spec('[data-x=".a.b"]'), [0, 1, 0]);
eq('attribute with ] in a string', spec('[title="a]b"] p'), [0, 1, 1]);
eq('split keeps :is() arguments together', E.splitSelectorList(':is(a, b) .x, :where(c, d)'), [':is(a, b) .x', ':where(c, d)']);
eq('split keeps commas in attribute strings', E.splitSelectorList('a, [data-x="a,b"]'), ['a', '[data-x="a,b"]']);
eq('split drops empty items and trims', E.splitSelectorList(' a ,, b '), ['a', 'b']);

// ---------- nth-child of S ----------
eq(':nth-child(2n+1 of .important)', spec('li:nth-child(2n+1 of .important)'), [0, 2, 1]);
eq(':nth-child(1 of #a, .b)', spec(':nth-child(1 of #a, .b)'), [1, 1, 0]);
eq(':nth-last-child(odd of li.x)', spec(':nth-last-child(odd of li.x)'), [0, 2, 1]);
eq(':nth-of-type(2n) has no of-clause', spec(':nth-of-type(2n)'), [0, 1, 0]);

// ---------- other pseudo-classes and pseudo-elements ----------
eq(':lang(en)', spec(':lang(en)'), [0, 1, 0]);
eq(':dir(rtl)', spec('p:dir(rtl)'), [0, 1, 1]);
eq('legacy :before', spec('a:before'), [0, 0, 2]);
eq('legacy :first-letter', spec('p:first-letter'), [0, 0, 2]);
eq('::before', spec('a::before'), [0, 0, 2]);
eq('::slotted(span.x) adds its argument', spec('::slotted(span.x)'), [0, 1, 2]);
eq(':host is a pseudo-class', spec(':host'), [0, 1, 0]);
eq(':host(.dark) adds its argument', spec(':host(.dark)'), [0, 2, 0]);
eq('::part(label)', spec('x-foo::part(label)'), [0, 0, 2]);
eq('nested :is(:not(#a), .b)', spec(':is(:not(#a), .b)'), [1, 0, 0]);
eq(':is() with a complex argument', spec(':is(ul li, .x) a'), [0, 1, 1]);
eq('pseudo-class names are case-insensitive', spec(':WHERE(#a) :IS(#b)'), [1, 0, 0]);
eq(':-webkit-any() and :matches() act like :is()', spec(':matches(#a, b)'), [1, 0, 0]);

// ---------- namespaces, escapes, nesting ----------
eq('svg|rect', spec('svg|rect'), [0, 0, 1]);
eq('*|*', spec('*|*'), [0, 0, 0]);
eq('|a', spec('|a'), [0, 0, 1]);
eq('column combinator ||', spec('col.sel || td'), [0, 1, 2]);
eq('escaped colon in a class', spec('.md\\:flex'), [0, 1, 0]);
eq('escaped digit in an ID', spec('#\\31 23'), [1, 0, 0]);
eq('non-ASCII class', spec('.größe'), [0, 1, 0]);
eq('& counts as zero', spec('& .x'), [0, 1, 0]);
eq('combinators without spaces', spec('a>b~c+d'), [0, 0, 4]);

// ---------- syntax errors ----------
for (const bad of ['a(', ':is(.a', '[x', '#', 'a)b', '.', ':', '[x="a]']) {
  check('error for ' + JSON.stringify(bad), typeof spec(bad) === 'string', JSON.stringify(spec(bad)));
}
{
  let msg = '';
  try { E.specificity(':is(.a'); } catch (e) { msg = e.message; }
  check('error message gives a position', /\d/.test(msg), msg);
}

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    check('STRINGS has invalid key', 'invalid' in S.en);
  }
}

// ---------- examples on the tool pages ----------
// Lines in the form `<code>SELECTOR</code> → <code>(a, b, c)</code>` are recomputed.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/css-specificity-calculator', lang + '.mdx'), 'utf8');
  const re = /<code>([^<]+)<\/code>\s*→\s*<code>\((\d+), (\d+), (\d+)\)<\/code>/g;
  let m, n = 0;
  while ((m = re.exec(mdx))) {
    n++;
    const sel = m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
    eq(lang + ' page example ' + sel, spec(sel), [+m[2], +m[3], +m[4]]);
  }
  check(lang + ' page has at least 6 checked examples', n >= 6, n);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
