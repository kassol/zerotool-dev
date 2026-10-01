// CSS Flexbox Generator — the highlighted code escapes what the user typed
//
// Read:  src/components/tools/CssFlexboxGeneratorTool.astro (extracts the real `highlightCss`
//        between the `engine:start` / `engine:end` markers)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the gap field was inserted into innerHTML as written, so
// `<img src=x onerror=…>` in a field became an element. The output is parsed with parse5:
// no element other than the highlight spans, and its text equals the plain CSS that Copy uses.
//
// Run: node scripts/test-css-flexbox-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssFlexboxGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { highlightCss } = new Function(source.slice(s, e) + '\nreturn { highlightCss };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + detail); } }

function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function inspect(html) {
  const tags = [];
  let text = '';
  walk(parseFragment(html), (n) => {
    if (n.tagName) tags.push(n.tagName);
    if (n.nodeName === '#text') text += n.value;
  });
  return { tags, text };
}

const attack = '1rem</span><img src=x onerror=alert(1)>';
const decls = [['display', 'flex'], ['flex-direction', 'row'], ['justify-content', 'center'], ['gap', attack], ['align-content', '1rem & "x"']];
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
const plain = '.container {\n' + decls.map((d) => '  ' + d[0] + ': ' + d[1] + ';').join('\n') + '\n}';
check('text equals the plain CSS', r.text === plain, JSON.stringify(r.text));
const normal = inspect(highlightCss([['display', 'flex'], ['gap', '1rem']]));
check('normal output text', normal.text === '.container {\n  display: flex;\n  gap: 1rem;\n}', JSON.stringify(normal.text));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
