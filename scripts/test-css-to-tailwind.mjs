// CSS to Tailwind — border colors, transition timing and @media blocks are not lost
//
// Read:  src/components/tools/CssToTailwindTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/css-to-tailwind/{en,zh,ja,ko}.mdx
//        (each ```css block followed by a plain ``` block must convert to that output)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Expected classes are Tailwind's documented utilities (tailwindcss.com/docs: border-color,
// transition-property, transition-duration, transition-timing-function, transition-delay,
// responsive design breakpoints sm 640px / md 768px / lg 1024px / xl 1280px / 2xl 1536px).
// Covers: `border: 1px solid #e5e7eb` keeps the color (before: dropped without a keep
// comment), a border part the table cannot map keeps the whole declaration, `transition:
// all 0.2s` writes the duration (before: plain `transition`, 150 ms), timing functions and
// delays, transitions the tool cannot express are kept, rules nested in @media are parsed
// (before: `/* keep: .btn { padding: 2rem */`), min-width breakpoints become prefixes,
// other media queries are labelled and not prefixed, and the tool page examples.
//
// Run: node scripts/test-css-to-tailwind.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssToTailwindTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CssToTailwindTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { convertCss };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
const c = (css) => E.convertCss(css);

// ---------- border shorthand ----------
eq('border keeps its color', c('border: 1px solid #e5e7eb;'), 'border border-solid border-gray-200');
eq('border with a named color', c('border: 2px dashed white;'), 'border-2 border-dashed border-white');
eq('border width only', c('border: 1px;'), 'border');
eq('border with a color outside the table is kept whole', c('border: 1px solid #123456;'), '/* keep: border: 1px solid #123456 */');
eq('border with an unknown width is kept whole', c('border: 3px solid #e5e7eb;'), '/* keep: border: 3px solid #e5e7eb */');
eq('border: none', c('border: none;'), 'border-none');

// ---------- transition ----------
eq('transition: all 0.2s', c('transition: all 0.2s;'), 'transition-all duration-200');
eq('transition: opacity 300ms ease-in-out', c('transition: opacity 300ms ease-in-out;'), 'transition-opacity duration-300 ease-in-out');
eq('transition with delay', c('transition: transform 150ms linear 75ms;'), 'transition-transform duration-150 ease-linear delay-75');
eq('transition: background-color 1s ease-out', c('transition: background-color 1s ease-out;'), 'transition-colors duration-1000 ease-out');
eq('transition without a duration is 0s in CSS', c('transition: all;'), 'transition-all duration-0');
eq('duration outside the scale is kept', c('transition: all 0.25s;'), '/* keep: transition: all 0.25s */');
eq('several transitions are kept', c('transition: color 0.2s, transform 0.3s;'), '/* keep: transition: color 0.2s, transform 0.3s */');
eq('cubic-bezier is kept', c('transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);'), '/* keep: transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) */');
eq('unknown property is kept', c('transition: width 0.2s;'), '/* keep: transition: width 0.2s */');

// ---------- @media ----------
eq('rule inside @media min-width 768px gets md:', c('@media (min-width: 768px) { .btn { padding: 2rem; } }'), '/* .btn (md) */\nmd:p-8');
eq('all default breakpoints', [640, 1024, 1280, 1536].map((w) => c('@media (min-width:' + w + 'px){a{display:none}}').split('\n')[1]).join(' '), 'sm:hidden lg:hidden xl:hidden 2xl:hidden');
eq('other media queries are labelled, not prefixed', c('@media (max-width: 600px) { .a { display: none; } }'), '/* @media (max-width: 600px) .a */\nhidden');
eq('keep comments inside @media', c('@media (min-width: 768px) { .a { margin-top: 13px; } }'), '/* .a (md) */\n/* keep: margin-top: 13px */');
eq('rules before and after @media', c('.a { display: flex; }\n@media (min-width: 1024px) { .a { display: grid; } .b { opacity: 0.5; } }\n.c { cursor: pointer; }'),
  '/* .a */\nflex\n\n/* .a (lg) */\nlg:grid\n\n/* .b (lg) */\nlg:opacity-50\n\n/* .c */\ncursor-pointer');
eq('a comment with braces does not break parsing', c('/* { not a rule } */ .a { display: block; }'), '/* .a */\nblock');

// ---------- existing behaviour kept ----------
eq('flexbox card', c('.card {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 1rem;\n  padding: 1.5rem;\n  border-radius: 0.5rem;\n}'),
  '/* .card */\nflex flex-col items-center gap-4 p-6 rounded-lg');

// ---------- the examples on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/css-to-tailwind/' + lang + '.mdx'), 'utf8');
  const re = /```css\n([\s\S]*?)\n```\s*\n[^`]*```\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    eq(lang + ': example ' + count + ' output', c(m[1]), m[2]);
  }
  check(lang + ': page has at least two examples', count >= 2, String(count));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
