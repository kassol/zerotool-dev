// CSS Flexbox Generator — escaped highlight markup and the tool output quoted in the flexbox guides
//
// Read:  src/components/tools/CssFlexboxGeneratorTool.astro (extracts the real `highlightCss`
//        between the `engine:start` / `engine:end` markers, and runs the page script against a
//        stand-in DOM); src/content/blog/css-flexbox-generator-guide/{en,ja}.mdx
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix the gap field was inserted into innerHTML as written, so
// `<img src=x onerror=…>` in a field became an element. The output is parsed with parse5:
// no element other than the highlight spans, and its text equals the plain CSS that Copy uses.
// The guides: each `cfg-check` annotation (field values) must be followed by the css block the
// tool produces; `cfg-grow` / `cfg-shrink` annotations recompute the flex-grow and scaled
// flex-shrink distributions quoted next to the Chrome measurements (§9.7, no min-size clamping);
// both guides indexable and without template headings.
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

// ---------- page script with a stand-in DOM: the tool output quoted in the css flexbox guides ----------
// `cfg-check` annotations in src/content/blog/css-flexbox-generator-guide/{en,ja}.mdx give the field
// values; the next ```css block in the guide must equal what Copy would put on the clipboard.
const els = {};
function makeEl(id) {
  const handlers = {};
  let html = '';
  const node = {
    id, value: '', textContent: '', className: '', style: {}, dataset: {}, children: [],
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); },
    get lastChild() { return this.children[this.children.length - 1]; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); return c; },
    querySelectorAll(sel) { return this.children.filter((c) => '.' + c.className === sel); },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type) { (handlers[type] || []).forEach((fn) => fn.call(this, {})); },
  };
  return node;
}
function el(id) { return (els[id] ||= makeEl(id)); }
const fieldDefaults = { 'cfg-direction': 'row', 'cfg-wrap': 'nowrap', 'cfg-justify': 'flex-start', 'cfg-align-items': 'flex-start', 'cfg-align-content': 'flex-start', 'cfg-gap': '1rem', 'cfg-items': '4' };
for (const [id, v] of Object.entries(fieldDefaults)) el(id).value = v;
// The select defaults above must be the ones marked `selected` in the component.
for (const [id, v] of Object.entries(fieldDefaults)) {
  const sel = new RegExp('<select id="' + id + '"[\\s\\S]*?</select>').exec(source);
  if (sel) check(`${id} default is ${v}`, new RegExp('<option value="' + v + '" selected>').test(sel[0]));
}
check('gap field default', /id="cfg-gap"[^>]*value="1rem"/.test(source));
check('items field default', /id="cfg-items"[^>]*min="1" max="8" value="4"/.test(source));
const pageScript = /<script is:inline>([\s\S]*?)<\/script>/.exec(source)[1];
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const doc = { currentScript: null, querySelector: () => wrap, getElementById: el, createElement: () => makeEl('') };
new Function('document', 'window', 'navigator', 'setTimeout', pageScript)(doc, {}, {}, () => {});

const onLoad = el('cfg-code').textContent;
check('output on load', onLoad === '.container {\n  display: flex;\n  flex-direction: row;\n  flex-wrap: nowrap;\n  justify-content: flex-start;\n  align-items: flex-start;\n  align-content: flex-start;\n  gap: 1rem;\n}', JSON.stringify(onLoad));
check('preview has 4 items on load', el('cfg-preview').children.length === 4);

function generate(c) {
  const map = { dir: 'cfg-direction', wrap: 'cfg-wrap', justify: 'cfg-justify', alignItems: 'cfg-align-items', alignContent: 'cfg-align-content', gap: 'cfg-gap', items: 'cfg-items' };
  const full = { dir: 'row', wrap: 'nowrap', justify: 'flex-start', alignItems: 'flex-start', alignContent: 'flex-start', gap: '1rem', items: 4, ...c };
  for (const [k, id] of Object.entries(map)) { el(id).value = String(full[k]); el(id).fire(k === 'gap' || k === 'items' ? 'input' : 'change'); }
  return el('cfg-code').textContent;
}
generate({ items: 9 });
check('items are capped at 8', el('cfg-preview').children.length === 8);
generate({ items: 2 });
check('items can go down to 2', el('cfg-preview').children.length === 2);

// Simple flex resolution without min-size clamping (CSS Flexbox Level 1 §9.7), for the numbers the
// guides quote next to the Chrome measurements: grow shares free space by flex-grow; shrink takes
// the overflow in proportion to flex-shrink × flex base size (the scaled flex shrink factor).
function grow(container, bases, factors) {
  const free = container - bases.reduce((a, b) => a + b, 0);
  const sum = factors.reduce((a, b) => a + b, 0);
  return bases.map((b, i) => b + (free * factors[i]) / sum);
}
function shrink(container, bases, factors) {
  const over = bases.reduce((a, b) => a + b, 0) - container;
  const scaled = bases.map((b, i) => b * factors[i]);
  const sum = scaled.reduce((a, b) => a + b, 0);
  return bases.map((b, i) => b - (over * scaled[i]) / sum);
}

const TEMPLATE_H2 = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m];
for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/css-flexbox-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = TEMPLATE_H2.filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  const marks = [...guide.matchAll(/\{\/\* cfg-check: (\{.*?\}) \*\/\}\s*```css\n([\s\S]*?)```/g)];
  check(lang + ' guide has cfg-check annotations', marks.length >= 2, marks.length);
  check(lang + ' every cfg-check is followed by a css block', marks.length === (guide.match(/cfg-check:/g) || []).length);
  for (const m of marks) {
    const out = generate(JSON.parse(m[1]));
    check(`${lang} generator output ${m[1]}`, out === m[2].trimEnd(), JSON.stringify(out) + ' vs ' + JSON.stringify(m[2]));
  }
  for (const m of guide.matchAll(/\{\/\* cfg-(grow|shrink): (\{.*?\}) \*\/\}/g)) {
    const c = JSON.parse(m[2]);
    const got = (m[1] === 'grow' ? grow : shrink)(c.container, c.bases, c.factors).map((x) => +x.toFixed(2));
    check(`${lang} ${m[1]} ${m[2]}`, JSON.stringify(got) === JSON.stringify(c.out), JSON.stringify(got));
  }
  check(lang + ' guide has grow and shrink checks', /cfg-grow:/.test(guide) && /cfg-shrink:/.test(guide));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
