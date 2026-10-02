// CSS Grid Generator — escaped highlight markup and the tool output quoted in the css grid guides
//
// Read:  src/components/tools/CssGridGeneratorTool.astro (extracts the real `highlightCss`
//        between the `engine:start` / `engine:end` markers, and runs the page script against a
//        stand-in DOM); src/content/blog/css-grid-generator-guide/{en,ja}.mdx
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the template and gap fields were inserted into innerHTML as written, so
// `<img src=x onerror=…>` in a field became an element. The output is parsed with parse5:
// no element other than the highlight spans, and its text equals the plain CSS that Copy uses.
// The guides: each `cgg-check` annotation (field values) must be followed by the css block the
// tool produces; the auto-fill / fr arithmetic quoted next to the Chrome measurements; both
// guides indexable and without template headings.
//
// Run: node scripts/test-css-grid-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFragment } from 'parse5';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CssGridGeneratorTool.astro'), 'utf8');
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

const attack = '1fr</span><img src=x onerror=alert(1)>';
const decls = [['display', 'grid'], ['grid-template-columns', attack], ['grid-template-rows', 'repeat(2, 1fr)'], ['column-gap', '1rem & "x"'], ['row-gap', '16px']];
const r = inspect(highlightCss(decls));
check('only span elements', r.tags.every((t) => t === 'span'), r.tags.join(','));
const plain = '.container {\n' + decls.map((d) => '  ' + d[0] + ': ' + d[1] + ';').join('\n') + '\n}';
check('text equals the plain CSS', r.text === plain, JSON.stringify(r.text));
const normal = inspect(highlightCss([['display', 'grid'], ['grid-template-columns', 'repeat(3, 1fr)']]));
check('normal output text', normal.text === '.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n}', JSON.stringify(normal.text));

// ---------- page script with a stand-in DOM: the tool output quoted in the css grid guides ----------
// `cgg-check` annotations in src/content/blog/css-grid-generator-guide/{en,ja}.mdx give the
// field values; the next ```css block in the guide must equal what Copy would put on the clipboard.
const els = {};
function makeEl(id) {
  const handlers = {};
  let html = '';
  return {
    id, value: '', textContent: '', style: {}, dataset: {}, children: [],
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); if (v === '') this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type) { (handlers[type] || []).forEach((fn) => fn.call(this, {})); },
  };
}
function el(id) { return (els[id] ||= makeEl(id)); }
const fieldDefaults = { 'cgg-cols': '3', 'cgg-rows': '2', 'cgg-col-gap': '1rem', 'cgg-row-gap': '1rem', 'cgg-tmpl-cols': 'repeat(3, 1fr)', 'cgg-tmpl-rows': 'repeat(2, 1fr)' };
for (const [id, v] of Object.entries(fieldDefaults)) el(id).value = v;
const pageScript = /<script is:inline>([\s\S]*?)<\/script>/.exec(source)[1];
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const doc = { currentScript: null, querySelector: () => wrap, getElementById: el, createElement: () => makeEl('') };
new Function('document', 'window', 'navigator', 'setTimeout', pageScript)(doc, {}, {}, () => {});

const onLoad = el('cgg-code').textContent;
check('output on load', onLoad === '.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  grid-template-rows: repeat(2, 1fr);\n  column-gap: 1rem;\n  row-gap: 1rem;\n}', JSON.stringify(onLoad));
check('preview draws Columns × Rows cells', el('cgg-preview').children.length === 6, el('cgg-preview').children.length);
check('preview gap is row gap then column gap', el('cgg-preview').style.gap === '1rem 1rem');

function generate(c) {
  el('cgg-cols').value = String(c.cols); el('cgg-cols').fire('input');
  el('cgg-rows').value = String(c.rows); el('cgg-rows').fire('input');
  el('cgg-col-gap').value = c.colGap; el('cgg-col-gap').fire('input');
  el('cgg-row-gap').value = c.rowGap; el('cgg-row-gap').fire('input');
  if (c.tmplCols !== undefined) { el('cgg-tmpl-cols').value = c.tmplCols; el('cgg-tmpl-cols').fire('input'); }
  if (c.tmplRows !== undefined) { el('cgg-tmpl-rows').value = c.tmplRows; el('cgg-tmpl-rows').fire('input'); }
  return el('cgg-code').textContent;
}
// Changing a count after typing a template rewrites the template (the guides tell readers to type it last).
generate({ cols: 2, rows: 1, colGap: '0', rowGap: '0', tmplCols: '240px 1fr' });
el('cgg-cols').value = '4'; el('cgg-cols').fire('input');
check('changing Columns rewrites a typed template', el('cgg-tmpl-cols').value === 'repeat(4, 1fr)', el('cgg-tmpl-cols').value);
check('preview cell count follows the counts, not the template', (generate({ cols: 3, rows: 1, colGap: '0', rowGap: '0', tmplCols: 'repeat(auto-fill, minmax(180px, 1fr))' }), el('cgg-preview').children.length === 3));

const TEMPLATE_H2 = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m];
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/css-grid-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = TEMPLATE_H2.filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  const marks = [...guide.matchAll(/\{\/\* cgg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check(lang + ' guide has cgg-check annotations', marks.length >= 2, marks.length);
  for (const m of marks) {
    const c = JSON.parse(m[1]);
    const out = generate(c);
    check(`${lang} generator output ${m[1]}`, out === m[2].trimEnd(), JSON.stringify(out) + ' vs ' + JSON.stringify(m[2]));
  }
  check(lang + ' every cgg-check is followed by a css block', marks.length === (guide.match(/cgg-check:/g) || []).length);
}

// auto-fill arithmetic quoted in the guides (§7.2.3.2): repetitions = floor((W + gap) / (min + gap))
{
  const W = 1000, gap = 16, min = 180;
  const n = Math.floor((W + gap) / (min + gap));
  check('auto-fill repetitions in 1000px', n === 5, n);
  check('auto-fill column width', ((W - (n - 1) * gap) / n).toFixed(1) === '187.2');
  check('auto-fill second item x', (187.2 + gap).toFixed(1) === '203.2');
  check('auto-fit with two items', (W - gap) / 2 === 492);
  check('auto-fit second item x', 492 + gap === 508);
  check('1fr share with two 16px gaps', ((W - 2 * gap) / 3).toFixed(2) === '322.67');
  for (const lang of ['en', 'ja']) {
    const g = readFileSync(join(root, `src/content/blog/css-grid-generator-guide/${lang}.mdx`), 'utf8');
    for (const s of ['187.2', '492', '322.67', '203.2']) check(`${lang} guide quotes ${s}`, g.includes(s));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
