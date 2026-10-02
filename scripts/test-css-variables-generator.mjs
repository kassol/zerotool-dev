// CSS Variables Generator — declarations and escaped highlight markup
//
// Read:  src/components/tools/CssVariablesGeneratorTool.astro (runs the real tokenDecls(),
//        plainCss() and highlightCss() between the `engine:start` / `engine:end` markers),
//        src/content/tools/css-variables-generator/en.mdx,
//        src/content/blog/css-variables-generator-guide/en.mdx (the default output, `cvg-check`
//        prefix/rows → css block, and the `cvg-sass` example compiled with the installed Dart Sass)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix generate() built the CSS string and put it into innerHTML without escaping, so a
// token value such as `<img src=x onerror=…>` became an element. The highlight output is parsed with
// parse5: only span elements, and its text equals the plain CSS that Copy uses. The default output is
// the example quoted on the English tool page. A prefix without -- gets it and spaces inside a name
// become hyphens (both used to produce declarations the browser drops).
//
// Run: node scripts/test-css-variables-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssVariablesGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const { tokenDecls, plainCss, highlightCss } = new Function(source.slice(s, e) + '\nreturn { tokenDecls, plainCss, highlightCss };')();

let failures = 0, passes = 0;
function check(name, ok, detail) { if (ok) passes++; else { failures++; console.log('FAIL: ' + name + ' — ' + detail); } }
function walk(n, f) { f(n); (n.childNodes || []).forEach((c) => walk(c, f)); }
function inspect(html) {
  const tags = []; let text = '';
  walk(parseFragment(html), (n) => { if (n.tagName) tags.push(n.tagName); if (n.nodeName === '#text') text += n.value; });
  return { tags, text };
}

const colors = [{ name: 'primary', value: '#3b82f6' }, { name: 'secondary', value: '#6366f1' }, { name: 'bg', value: '#ffffff' }, { name: 'text', value: '#111827' }];
check('default prefix', plainCss(tokenDecls('--', colors)) === ':root {\n  --primary: #3b82f6;\n  --secondary: #6366f1;\n  --bg: #ffffff;\n  --text: #111827;\n}', plainCss(tokenDecls('--', colors)));
check('prefix without trailing hyphen gets one', tokenDecls('--brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('prefix with trailing hyphen', tokenDecls('--brand-', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('empty prefix falls back to --', tokenDecls('', [{ name: 'x', value: '1' }])[0][0] === '--x');
// A custom property name must start with -- (CSS Custom Properties Level 1 §2); a prefix typed
// without it used to produce declarations the browser drops
check('prefix without -- gets it', tokenDecls('brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary', tokenDecls('brand', [{ name: 'primary', value: 'red' }])[0][0]);
check('prefix with one hyphen', tokenDecls('-brand', [{ name: 'primary', value: 'red' }])[0][0] === '--brand-primary');
check('prefix with spaces around', tokenDecls('  --ds ', [{ name: 'gap', value: '4px' }])[0][0] === '--ds-gap');
check('spaces inside a name become hyphens', tokenDecls('--', [{ name: 'primary  color', value: 'red' }])[0][0] === '--primary-color');
check('page no longer says a prefix without -- is dropped', !/a prefix without <code>--<\/code> produces/.test(readFileSync(join(root, 'src/content/tools/css-variables-generator/en.mdx'), 'utf8')));
check('rows without a name are skipped', tokenDecls('--', [{ name: '  ', value: '1' }, { name: 'a', value: '' }]).length === 1);
check('empty root block', plainCss([]) === ':root {\n}');

const attack = [{ name: 'x', value: '</span><img src=x onerror=alert(1)>' }, { name: 'font-mono', value: '"Fira Code", monospace' }, { name: 'q<b>', value: 'a & b; c' }];
const decls = tokenDecls('--', attack);
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
check('highlight text equals the plain CSS', r.text === plainCss(decls), JSON.stringify(r.text));
const d = inspect(highlightCss(tokenDecls('--', colors)));
check('default highlight text', d.text === plainCss(tokenDecls('--', colors)), JSON.stringify(d.text));
check('empty highlight text', inspect(highlightCss([])).text === ':root {\n}');

// ---------- the css variables guide (en) ----------
// `cvg-default`: the next css block equals the output for the component's pre-filled rows (read from
// the GROUPS defaults in the source). `cvg-check`: prefix and rows → the next css block.
// `cvg-sass`: the next scss block compiled with the installed Dart Sass equals the css block after it.
{
  const guide = readFileSync(join(root, 'src/content/blog/css-variables-generator-guide/en.mdx'), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check('en guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('en guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));

  const defaults = [...source.matchAll(/\{ name: '([^']+)', value: '([^']*)' \}/g)].map((m) => ({ name: m[1], value: m[2] }));
  check('component has 16 pre-filled rows', defaults.length === 16, defaults.length);
  const def = guide.match(/\{\/\* cvg-default \*\/\}\s*```css\n([\s\S]*?)```/);
  check('en guide has cvg-default', !!def);
  if (def) check('default output in the guide', def[1].trimEnd() === plainCss(tokenDecls('--', defaults)), def[1]);

  const marks = [...guide.matchAll(/\{\/\* cvg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check('en guide has cvg-check annotations', marks.length >= 1 && marks.length === (guide.match(/cvg-check:/g) || []).length, marks.length);
  for (const m of marks) {
    const c = JSON.parse(m[1]);
    const out = plainCss(tokenDecls(c.prefix, c.tokens.map(([name, value]) => ({ name, value }))));
    check('guide output ' + m[1], out === m[2].trimEnd(), JSON.stringify(out));
  }

  const sassBlock = guide.match(/\{\/\* cvg-sass \*\/\}\s*```scss\n([\s\S]*?)```\s*```css\n([\s\S]*?)```/);
  check('en guide has cvg-sass', !!sassBlock);
  if (sassBlock) {
    const sass = await import('sass');
    const version = JSON.parse(readFileSync(join(root, 'node_modules/sass/package.json'), 'utf8')).version;
    check('guide names the installed Dart Sass version', guide.includes('Dart Sass ' + version), version);
    const css = sass.compileString(sassBlock[1]).css;
    check('Sass output in the guide', css.trim() === sassBlock[2].trim(), css);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
