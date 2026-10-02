// Markdown cheat sheet (blog, en / ja / ko) — every quoted rendering, rerun with the Markdown Preview engine
//
// Read:  src/content/blog/markdown-cheat-sheet/{en,ja,ko,zh}.mdx, src/components/tools/MarkdownPreviewTool.astro
// Write: stdout only (test results); with --fill, rewrites "html":"?" placeholders in the mdx files
// Exit:  0 if all PASS, 1 if any FAIL
//
// Annotation {/* md: {"md":"…","html":"…","cm":"…","cjk":"…"} */}: md rendered by renderMarkdown()
// copied from the component's engine:start/end block (micromark + GFM, raw HTML escaped, unsafe
// URLs emptied) must equal html; cm is plain CommonMark (micromark without extensions); cjk is
// micromark + GFM + micromark-extension-cjk-friendly. Each non-empty line of md must appear in the
// page outside the annotation. Annotation {/* md-lint: {"md":"…","rules":["MD001:5",…]} */}: the
// markdownlint 0.40 default-rule result (rule:line, sorted) must equal rules, as in the Markdown
// Linter tool. Annotation {/* md-slug: {"h":"…","slug":"…"} */}: github-slugger 2.0.0 (the anchor
// rules GitHub documents) must turn heading text h into slug, and slug must appear in the page.
//
// Run: node scripts/test-markdown-cheat-sheet.mjs [--fill]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { lint } from 'markdownlint/promise';
import { slug } from 'github-slugger';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fill = process.argv.includes('--fill');
let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? '\n  ' + detail : '')); }
}

const comp = readFileSync(join(root, 'src/components/tools/MarkdownPreviewTool.astro'), 'utf8');
const engine = comp.slice(comp.indexOf('/* ── engine:start ── */'), comp.indexOf('/* ── engine:end ── */'));
check('engine block found', engine.includes('function renderMarkdown'));
const renderMarkdown = new Function(engine + '\nreturn renderMarkdown;')();
const lib = { micromark, gfm, gfmHtml };
const preview = (md) => renderMarkdown(md, lib);
const cm = (md) => micromark(md);
const cjk = (md) => micromark(md, { extensions: [gfm(), cjkFriendlyExtension()], htmlExtensions: [gfmHtml()] });

const langs = ['en', 'ja', 'ko'];
for (const lang of langs) {
  const rel = `src/content/blog/markdown-cheat-sheet/${lang}.mdx`;
  let text = readFileSync(join(root, rel), 'utf8');
  const prose = text.replace(/\{\/\* md(?:-lint|-slug)?: \{.*?\} \*\/\}/g, '');
  let count = 0;
  for (const m of text.matchAll(/\{\/\* md: (\{.*?\}) \*\/\}/g)) {
    let spec;
    try { spec = JSON.parse(m[1]); } catch { check(rel + ' annotation is JSON', false, m[1].slice(0, 120)); continue; }
    count++;
    const name = `${rel} ${JSON.stringify(spec.md).slice(0, 50)}`;
    const got = preview(spec.md);
    if (spec.html === '?' && fill) {
      const filled = m[0].replace('"html":"?"', '"html":' + JSON.stringify(got));
      text = text.replace(m[0], filled);
      console.log('FILL ' + name + '\n  ' + JSON.stringify(got));
      continue;
    }
    check(name + ' preview', got === spec.html, JSON.stringify(got));
    if (spec.cm !== undefined) check(name + ' commonmark', cm(spec.md) === spec.cm, JSON.stringify(cm(spec.md)));
    if (spec.cjk !== undefined) check(name + ' cjk-friendly', cjk(spec.md) === spec.cjk, JSON.stringify(cjk(spec.md)));
    // The page shows the input in a code block, an inline code span or a table cell; at least the
    // start of its longest line must appear outside the annotation.
    const longest = spec.md.split('\n').map((l) => l.trim()).sort((a, b) => b.length - a.length)[0];
    check(`${name} is quoted in the page`, prose.includes(longest.slice(0, 12)), longest);
  }
  if (fill) writeFileSync(join(root, rel), text);
  check(`${rel} has md annotations`, count >= 15, count);
  for (const m of text.matchAll(/\{\/\* md-lint: (\{.*?\}) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    const res = await lint({ strings: { doc: spec.md } });
    const got = res.doc.map((e) => e.ruleNames[0] + ':' + e.lineNumber).sort();
    check(`${rel} markdownlint ${spec.rules.join(',')}`, JSON.stringify(got) === JSON.stringify([...spec.rules].sort()), JSON.stringify(got));
  }
  for (const m of text.matchAll(/\{\/\* md-slug: (\{.*?\}) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    check(`${rel} slug ${spec.h}`, slug(spec.h) === spec.slug && prose.includes(spec.slug), slug(spec.h));
  }
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((x) => x[1]);
  check(`${rel} has no template headings`, !h2.some((h) => /^what (is|are)\b|online|\bin (code|javascript|python)\b|summary|conclusion/i.test(h)), h2.join(' | '));
  check(`${rel} is indexable`, !/^noindex:\s*true/m.test(text));
  if (lang === 'ja') check('ja uses the local term 記法', (text.match(/記法/g) || []).length >= 10);
  if (lang === 'ko') check('ko uses the local term 문법', (text.match(/문법/g) || []).length >= 10);
}
const h2counts = langs.concat('zh').map((l) => (readFileSync(join(root, `src/content/blog/markdown-cheat-sheet/${l}.mdx`), 'utf8').match(/^## /gm) || []).length);
check('H2 counts differ between en / ja / ko / zh', new Set(h2counts).size === 4, h2counts.join(','));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
