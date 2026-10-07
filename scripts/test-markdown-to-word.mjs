// Markdown to Word — Markdown → .docx conversion engine
// Also reads src/styles/tool-common.css for the shared fill and toggletip rules.
//
// Read:  src/components/tools/MarkdownToWordTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); docx, jszip, mdast-util-from-markdown, mdast-util-gfm,
//        micromark-extension-gfm, micromark-extension-cjk-friendly and
//        micromark-extension-cjk-friendly-gfm-strikethrough from node_modules (the same
//        packages the component bundles)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: every exported .docx is packed with docx.js and read back with jszip, then the
// OOXML is checked. Before the rewrite the tool used a hand-written line parser that
// silently lost structure: heading styles had no outline level; links were blue text with
// no hyperlink; ordered lists were typed "1. " text (a list starting at 5 kept 5, nested
// numbers were plain text); task lists kept "[ ]"; an escaped pipe split a table cell;
// inline formatting in table headers and blockquotes showed raw "**"; images became
// "!alt"; footnotes, strikethrough and autolinks stayed as source; snake_case lost its
// underscores; raw HTML such as <script> was copied as text; no East Asian font or
// language was set; the preview put link targets into href without escaping quotes.
// Now: CommonMark + GFM parsing (micromark) with the CJK-friendly emphasis extension
// (**注意：**这里), Heading 1–6 styles with outline levels, real Word numbering with
// restart and start value, content-control checkboxes, tables with header row, borders
// and column alignment, Source Code / Quote / Verbatim Char styles, hyperlinks, embedded
// images (data URI or pre-fetched), footnotes, East Asian font and language, soft line
// breaks joined without a space between Han / Kana characters, paper size, frontmatter,
// filename, preview escaping, a 10,000-line document.
//
// Run: node scripts/test-markdown-to-word.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as docx from 'docx';
import JSZip from 'jszip';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import { cjkFriendlyExtension } from 'micromark-extension-cjk-friendly';
import { gfmStrikethroughCjkFriendly } from 'micromark-extension-cjk-friendly-gfm-strikethrough';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const commonStyle = readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8');
const source = readFileSync(join(root, 'src/components/tools/MarkdownToWordTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MarkdownToWordTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + `
return { parseMarkdown, collectImageUrls, exportDocx, buildDocx, renderHtml, firstHeadingText,
  safeFilename, paperFor, defaultPaper, defaultFontFor, FONT_PRESETS, sniffImage, decodeDataUri, fitImage };`)();
const S_START = source.indexOf('/* ── strings:start ── */');
const S_END = source.indexOf('/* ── strings:end ── */');
if (S_START < 0 || S_END <= S_START) {
  console.error('FAIL: could not locate the strings block in MarkdownToWordTool.astro');
  process.exit(1);
}
E.STRINGS = new Function(source.slice(S_START, S_END) + '\nreturn STRINGS;')();

const lib = { fromMarkdown, gfm, gfmFromMarkdown, cjkFriendlyExtension, gfmStrikethroughCjkFriendly, D: docx };

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + String(detail).slice(0, 400) : ''));
}

async function exportDocx(md, opts) {
  const tree = E.parseMarkdown(md, lib);
  const { doc, report } = E.buildDocx(tree, lib, Object.assign({ paper: 'a4', font: 'zh-song', images: {}, title: 't', embedRemote: true }, opts || {}));
  const buf = await docx.Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
  return {
    tree, report, buf,
    document: await read('word/document.xml'),
    styles: await read('word/styles.xml'),
    numbering: await read('word/numbering.xml'),
    footnotes: await read('word/footnotes.xml'),
    rels: await read('word/_rels/document.xml.rels'),
    core: await read('docProps/core.xml'),
    files: Object.keys(zip.files),
  };
}

function paragraphs(xml) {
  return xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g) || [];
}
function textOf(xml) {
  return (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function paraWith(xml, text) {
  return paragraphs(xml).find((p) => textOf(p).includes(text)) || '';
}
function styleBlock(stylesXml, id) {
  const m = stylesXml.match(new RegExp('<w:style [^>]*w:styleId="' + id + '"[\\s\\S]*?</w:style>'));
  return m ? m[0] : '';
}
function numIdOf(p) {
  const m = p.match(/<w:numId w:val="(\d+)"\/>/);
  return m ? m[1] : null;
}
function ilvlOf(p) {
  const m = p.match(/<w:ilvl w:val="(\d+)"\/>/);
  return m ? Number(m[1]) : null;
}
function abstractStart(numberingXml, numId, lvl) {
  const num = numberingXml.match(new RegExp('<w:num w:numId="' + numId + '"[^>]*>[\\s\\S]*?</w:num>'));
  if (!num) return null;
  const abs = num[0].match(/<w:abstractNumId w:val="(\d+)"\/>/)[1];
  const an = numberingXml.match(new RegExp('<w:abstractNum [^>]*w:abstractNumId="' + abs + '"[\\s\\S]*?</w:abstractNum>'))[0];
  const level = an.match(new RegExp('<w:lvl w:ilvl="' + lvl + '"[\\s\\S]*?</w:lvl>'))[0];
  return {
    start: Number((level.match(/<w:start w:val="(\d+)"\/>/) || [])[1]),
    fmt: (level.match(/<w:numFmt w:val="(\w+)"\/>/) || [])[1],
    text: (level.match(/<w:lvlText w:val="([^"]*)"\/>/) || [])[1],
  };
}

// A 1×1 red PNG
const PNG_1x1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64'));
const PNG_DATA_URI = 'data:image/png;base64,' + Buffer.from(PNG_1x1).toString('base64');

// ── headings ────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('# 一级\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nSetext one\n==========\n\nSetext two\n----------\n');
  const ps = paragraphs(r.document);
  const want = ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6', 'Heading1', 'Heading2'];
  const got = ps.map((p) => (p.match(/<w:pStyle w:val="(\w+)"\/>/) || [])[1]);
  check('ATX and setext headings map to Heading 1–6 styles', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  for (let n = 1; n <= 6; n++) {
    const s = styleBlock(r.styles, 'Heading' + n);
    check('Heading' + n + ' style has outline level ' + (n - 1), s.includes('<w:outlineLvl w:val="' + (n - 1) + '"/>'), s);
    check('Heading' + n + ' style keeps with next paragraph', s.includes('<w:keepNext/>'), s);
    check('Heading' + n + ' style is bold', /<w:b\/>/.test(s), s);
  }
  check('Heading 1 style is named "heading 1"', /<w:name w:val="[Hh]eading 1"\/>/.test(styleBlock(r.styles, 'Heading1')));
  check('first heading text is used as the default filename', E.firstHeadingText(r.tree) === '一级', E.firstHeadingText(r.tree));
}

// ── inline formatting ────────────────────────────────────────────────────────
{
  const r = await exportDocx('Mix **bold** *it* ~~gone~~ `code` ***both***.');
  const p = paragraphs(r.document)[0];
  check('bold run', /<w:b\/>[\s\S]*?<w:t[^>]*>bold</.test(p), p);
  check('italic run', /<w:i\/>[\s\S]*?<w:t[^>]*>it</.test(p), p);
  check('strikethrough run', /<w:strike\/>[\s\S]*?<w:t[^>]*>gone</.test(p), p);
  check('inline code uses the Verbatim Char style', /<w:rStyle w:val="VerbatimChar"\/>[\s\S]*?<w:t[^>]*>code</.test(p), p);
  check('bold + italic run', /<w:b\/>[\s\S]*?<w:i\/>[\s\S]*?<w:t[^>]*>both</.test(p), p);
  const vc = styleBlock(r.styles, 'VerbatimChar');
  check('Verbatim Char style uses a monospace font and a shaded background', /w:ascii="Consolas"/.test(vc) && /<w:shd /.test(vc), vc);
  check('Verbatim Char keeps the East Asian font (no eastAsia override)', !/w:eastAsia=/.test(vc), vc);
}
{
  const r = await exportDocx('Escaped \\*not italic\\* and snake_case_name and a_b_c.');
  const p = paragraphs(r.document)[0];
  check('backslash escapes print the literal character', textOf(p) === 'Escaped *not italic* and snake_case_name and a_b_c.', textOf(p));
  check('intraword underscores do not start italics', !/<w:i\/>/.test(p), p);
}
{
  // CommonMark alone leaves these "**" as text; the CJK-friendly extension bolds them
  const cases = [
    ['**注意：**这里很重要。', '注意：'],
    ['文字**「引用」**后文。', '「引用」'],
    ['这是**“重点”**。', '“重点”'],
    ['**太字。**の後', '太字。'],
    ['**주의:**여기', '주의:'],
  ];
  for (const [md, bold] of cases) {
    const r = await exportDocx(md);
    const p = paragraphs(r.document)[0];
    check('CJK bold next to punctuation: ' + md, !textOf(p).includes('**') && new RegExp('<w:b/>[\\s\\S]*?<w:t[^>]*>' + bold + '<').test(p), p);
  }
  const s = await exportDocx('~~删除。~~后文');
  check('CJK strikethrough next to punctuation', !textOf(paragraphs(s.document)[0]).includes('~~') && /<w:strike\/>/.test(s.document), s.document);
}

// ── soft and hard line breaks ────────────────────────────────────────────────
{
  const r = await exportDocx('第一行\n第二行\n\nEnglish line\nnext line\n\n한국어 문장\n다음 줄\n\n中文**粗体**\n继续。\n\n日本語の文\nです。\n\nhard  \nbreak\n\nback\\\nslash');
  const ps = paragraphs(r.document);
  check('soft break between Han characters is dropped', textOf(ps[0]) === '第一行第二行', textOf(ps[0]));
  check('soft break between Latin words becomes a space', textOf(ps[1]) === 'English line next line', textOf(ps[1]));
  check('soft break between Hangul words becomes a space', textOf(ps[2]) === '한국어 문장 다음 줄', textOf(ps[2]));
  check('soft break across an emphasis boundary is dropped for Han', textOf(ps[3]) === '中文粗体继续。', textOf(ps[3]));
  check('soft break between Kana/Han is dropped', textOf(ps[4]) === '日本語の文です。', textOf(ps[4]));
  check('two trailing spaces make a line break', /<w:br\/>/.test(ps[5]) && textOf(ps[5]) === 'hardbreak', ps[5]);
  check('backslash at line end makes a line break', /<w:br\/>/.test(ps[6]), ps[6]);
}

// ── links ────────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('See [链接](https://example.com/a_(b)) and https://example.org and <https://example.net> and [mail](mailto:a@example.com).\n\n[bad](javascript:alert(1)) [rel](./docs/a.md) [ref][x]\n\n[x]: https://example.com/ref');
  const ps = paragraphs(r.document);
  const links = r.document.match(/<w:hyperlink [^>]*>/g) || [];
  check('links, autolinks and reference links become hyperlinks', links.length === 5, links.length);
  for (const target of ['https://example.com/a_(b)', 'https://example.org', 'https://example.net', 'mailto:a@example.com', 'https://example.com/ref']) {
    check('hyperlink relationship to ' + target, r.rels.includes('Target="' + target + '"') && r.rels.includes('TargetMode="External"'), r.rels);
  }
  check('hyperlink text uses the Hyperlink style', /<w:hyperlink [^>]*>[\s\S]*?<w:rStyle w:val="Hyperlink"\/>/.test(r.document));
  check('javascript: link is not a hyperlink but keeps its text', !r.rels.includes('javascript') && textOf(ps[1]).includes('bad'), r.rels);
  check('relative link keeps its text without a broken hyperlink', !r.rels.includes('docs/a.md') && textOf(ps[1]).includes('rel'));
}

// ── lists ───────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('- item one\n- item two\n  - nested a\n    - nested deep\n- item three\n\n1. first\n2. second\n   1. nested ordered\n3. third\n\ntext\n\n5. starts at five\n6. six\n\n- [ ] todo task\n- [x] done task\n');
  const d = r.document;
  const one = paraWith(d, 'item one'); const a = paraWith(d, 'nested a'); const deep = paraWith(d, 'nested deep');
  check('bullet list uses Word numbering', numIdOf(one) !== null, one);
  check('nested bullets use deeper list levels', ilvlOf(one) === 0 && ilvlOf(a) === 1 && ilvlOf(deep) === 2, [ilvlOf(one), ilvlOf(a), ilvlOf(deep)]);
  check('bullet level 0 is a bullet', (abstractStart(r.numbering, numIdOf(one), 0) || {}).fmt === 'bullet');
  const first = paraWith(d, 'first'); const third = paraWith(d, 'third'); const nested = paraWith(d, 'nested ordered');
  check('ordered items are numbered by Word, not typed', numIdOf(first) !== null && !textOf(first).startsWith('1.'), first);
  check('items of one ordered list share numbering', numIdOf(first) === numIdOf(third));
  check('nested ordered list is level 1', ilvlOf(nested) === 1, nested);
  check('nested ordered list restarts (own numbering)', numIdOf(nested) !== numIdOf(first));
  const o = abstractStart(r.numbering, numIdOf(first), 0) || {};
  check('ordered level 0 is decimal "%1."', o.fmt === 'decimal' && o.text === '%1.' && o.start === 1, JSON.stringify(o));
  const n1 = abstractStart(r.numbering, numIdOf(nested), 1) || {};
  check('ordered level 1 is lower letter', n1.fmt === 'lowerLetter', JSON.stringify(n1));
  const five = paraWith(d, 'starts at five');
  check('second ordered list does not continue the first', numIdOf(five) !== numIdOf(first));
  check('ordered list keeps its start number 5', (abstractStart(r.numbering, numIdOf(five), 0) || {}).start === 5);
  const todo = paraWith(d, 'todo task'); const done = paraWith(d, 'done task');
  check('task items are checkboxes, not "[ ]" text', /<w14:checkbox>/.test(todo) && !textOf(todo).includes('[ ]'), todo);
  check('unchecked task', /<w14:checked w14:val="0"\/>/.test(todo), todo);
  check('checked task', /<w14:checked w14:val="1"\/>/.test(done), done);
  check('task items have no bullet', numIdOf(todo) === null && numIdOf(done) === null);
}
{
  const r = await exportDocx('1. para one\n\n   second paragraph of item\n\n   ```\n   code in item\n   ```\n2. next\n');
  const second = paraWith(r.document, 'second paragraph');
  const item = paraWith(r.document, 'para one');
  const ind = (p) => Number((p.match(/<w:ind w:left="(\d+)"/) || [])[1]);
  check('continuation paragraph in a list item is not numbered', numIdOf(second) === null, second);
  check('continuation paragraph is indented to the item text', ind(second) === ind(item) && ind(item) > 0, [ind(second), ind(item)]);
  const code = paraWith(r.document, 'code in item');
  check('code block inside a list item is indented', ind(code) === ind(item), code);
}

// ── tables ──────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('| Left | **Center** | Right |\n|:-----|:------:|------:|\n| a **b** | `c` | 1 |\n| x \\| y | [z](https://z.dev) | 22<br>33 |\n');
  const t = (r.document.match(/<w:tbl>[\s\S]*?<\/w:tbl>/) || [''])[0];
  const rows = t.match(/<w:tr>[\s\S]*?<\/w:tr>|<w:tr [\s\S]*?<\/w:tr>/g) || [];
  const cells = (row) => row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  check('table has 3 rows', rows.length === 3, rows.length);
  check('every row has 3 cells (escaped pipe stays in its cell)', rows.every((row) => cells(row).length === 3), rows.map((x) => cells(x).length));
  check('escaped pipe text', textOf(cells(rows[2])[0]) === 'x | y', textOf(cells(rows[2])[0]));
  check('grid has 3 columns', (t.match(/<w:gridCol /g) || []).length === 3);
  check('grid widths fill the text width (A4, 1-inch margins)', (t.match(/<w:gridCol w:w="(\d+)"/g) || []).reduce((s, g) => s + Number(g.match(/\d+/)[0]), 0) === 9026, t.match(/<w:gridCol[^>]*>/g));
  check('header row repeats on each page', /<w:tblHeader\/>/.test(rows[0]));
  check('header cells are bold', cells(rows[0]).every((c) => /<w:b\/>/.test(c)));
  check('header keeps inline formatting (no "**")', !textOf(rows[0]).includes('**'));
  const jc = (c) => (c.match(/<w:jc w:val="(\w+)"\/>/) || [])[1];
  check('column alignment left / center / right in header', JSON.stringify(cells(rows[0]).map(jc)) === '["left","center","right"]', cells(rows[0]).map(jc));
  check('column alignment in body rows', JSON.stringify(cells(rows[1]).map(jc)) === '["left","center","right"]', cells(rows[1]).map(jc));
  check('bold inside a body cell', /<w:b\/>[\s\S]*?<w:t[^>]*>b</.test(cells(rows[1])[0]));
  check('inline code inside a cell', /VerbatimChar/.test(cells(rows[1])[1]));
  check('link inside a cell', /<w:hyperlink /.test(cells(rows[2])[1]));
  check('<br> inside a cell is a line break', /<w:br\/>/.test(cells(rows[2])[2]) && textOf(cells(rows[2])[2]) === '2233', cells(rows[2])[2]);
  check('table has borders', /<w:tblBorders>/.test(t) && /<w:insideH w:val="single"/.test(t));
}
{
  const r = await exportDocx('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |\n');
  const rows = (r.document.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []);
  check('short rows are padded, long rows trimmed to the header width', rows.every((row) => (row.match(/<w:tc>/g) || []).length === 2), rows.map((x) => (x.match(/<w:tc>/g) || []).length));
}

// ── code blocks ─────────────────────────────────────────────────────────────
{
  const r = await exportDocx('```js\nfunction f() {\n    return   1;  // spaces\n\n\tindented();\n}\n```\n');
  const code = paragraphs(r.document).filter((p) => /<w:pStyle w:val="SourceCode"\/>/.test(p));
  check('one Source Code paragraph per line (5 lines)', code.length === 5, code.length);
  check('leading and inner spaces preserved', code.some((p) => /<w:t xml:space="preserve">    return   1;  \/\/ spaces<\/w:t>/.test(p)), code[1]);
  check('empty line kept', code.length === 5 && textOf(code[2]) === '');
  check('tab becomes a Word tab', /<w:tab\/>/.test(code[3]) && textOf(code[3]) === 'indented();', code[3]);
  check('code runs are not spell-checked', code.every((p) => textOf(p) === '' || /<w:noProof\/>/.test(p)));
  const sc = styleBlock(r.styles, 'SourceCode');
  check('Source Code style: monospace, shaded, no space between lines', /w:ascii="Consolas"/.test(sc) && /<w:shd /.test(sc) && /w:after="0"/.test(sc), sc);
}

// ── blockquote, rule ────────────────────────────────────────────────────────
{
  const r = await exportDocx('> Quote line one\n> with **bold**\n>\n> second paragraph\n>\n> > nested\n\n---\n\nafter');
  const q1 = paraWith(r.document, 'Quote line one');
  check('quote uses the Quote style', /<w:pStyle w:val="Quote"\/>/.test(q1), q1);
  check('quote keeps inline bold', /<w:b\/>[\s\S]*?<w:t[^>]*>bold</.test(q1) && !textOf(q1).includes('**'), q1);
  check('quote paragraphs stay separate', textOf(paraWith(r.document, 'second paragraph')) === 'second paragraph');
  const ind = (p) => Number((p.match(/<w:ind w:left="(\d+)"/) || [])[1] || 0);
  const nested = paraWith(r.document, 'nested');
  check('nested quote is indented further', ind(nested) > ind(q1), [ind(nested), ind(q1)]);
  const qs = styleBlock(r.styles, 'Quote');
  check('Quote style has a left border', /<w:pBdr>[\s\S]*<w:left /.test(qs), qs);
  const hr = paragraphs(r.document).find((p) => /<w:pBdr>[\s\S]*<w:bottom /.test(p) && textOf(p) === '');
  check('thematic break is a bottom border', !!hr);
}

// ── images ──────────────────────────────────────────────────────────────────
{
  const md = '![red dot](' + PNG_DATA_URI + ')\n\n![remote](https://example.com/a.png "Title")\n\n![missing](https://example.com/404.png)\n\n![ref][img]\n\n[img]: https://example.com/a.png';
  const tree = E.parseMarkdown(md, lib);
  const urls = E.collectImageUrls(tree, true);
  check('image URLs to fetch: remote only, deduplicated, reference resolved', JSON.stringify(urls) === '["https://example.com/a.png","https://example.com/404.png"]', JSON.stringify(urls));
  check('no image URLs to fetch when embedding web images is off', JSON.stringify(E.collectImageUrls(tree, false)) === '[]', JSON.stringify(E.collectImageUrls(tree, false)));
  const remote = { type: 'png', data: PNG_1x1, width: 1600, height: 800 };
  const r = await exportDocx(md, { images: { 'https://example.com/a.png': remote } });
  const blips = r.document.match(/<a:blip r:embed=/g) || [];
  check('data URI and fetched images are embedded (3 drawings)', blips.length === 3, blips.length);
  check('media files are in the package', r.files.filter((f) => f.startsWith('word/media/')).length >= 2, r.files);
  check('alt text becomes the image description', /descr="red dot"/.test(r.document), (r.document.match(/<wp:docPr[^>]*>/g) || []).join(' '));
  const ext = (r.document.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g) || []).map((e) => e.match(/\d+/g).map(Number));
  const maxEmu = Math.round(9026 / 15) * 9525;
  check('wide image is scaled to the text width, aspect kept', ext.some(([cx, cy]) => cx <= maxEmu && cx > maxEmu - 9525 * 2 && Math.abs(cx / cy - 2) < 0.02), JSON.stringify(ext));
  const miss = paraWith(r.document, 'missing');
  check('image that could not be loaded becomes a link with its alt text', /<w:hyperlink /.test(miss) && r.rels.includes('https://example.com/404.png'), miss);
  check('report counts embedded and missing images', r.report.imagesEmbedded === 3 && r.report.imagesMissing === 1, JSON.stringify(r.report));
  check('image alone in a paragraph is centered', /<w:jc w:val="center"\/>/.test(paraWith(r.document, '') || paragraphs(r.document)[0]), paragraphs(r.document)[0]);
}
{
  const u = E.decodeDataUri(PNG_DATA_URI);
  check('decodeDataUri base64', u && u.mime === 'image/png' && u.data.length === PNG_1x1.length);
  const svg = E.decodeDataUri('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E');
  check('decodeDataUri percent-encoded', svg && svg.mime === 'image/svg+xml' && new TextDecoder().decode(svg.data).startsWith('<svg'));
  check('decodeDataUri rejects non-data URL', E.decodeDataUri('https://x/y.png') === null);
  check('sniffImage PNG size', JSON.stringify(E.sniffImage(PNG_1x1)) === '{"type":"png","width":1,"height":1}', JSON.stringify(E.sniffImage(PNG_1x1)));
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x0a, 0x00, 0x05, 0x00, 0, 0, 0]);
  check('sniffImage GIF size', JSON.stringify(E.sniffImage(gif)) === '{"type":"gif","width":10,"height":5}');
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03]);
  check('sniffImage JPEG size from SOF0', JSON.stringify(E.sniffImage(jpg)) === '{"type":"jpg","width":64,"height":32}', JSON.stringify(E.sniffImage(jpg)));
  check('sniffImage unknown (WebP) returns null', E.sniffImage(Uint8Array.from(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))) === null);
  check('fitImage keeps small images', JSON.stringify(E.fitImage(100, 50, 600)) === '{"width":100,"height":50}');
  check('fitImage scales wide images', JSON.stringify(E.fitImage(1200, 300, 600)) === '{"width":600,"height":150}');
}

// ── export flow: embedding web images is a switch, off by default ─────────────
{
  const SVG_URI = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2210%22%2F%3E';
  const md = '![dot](' + PNG_DATA_URI + ')\n\n![svg](' + SVG_URI + ')\n\n![remote](https://example.com/a.png)\n\n![missing](https://example.com/404.png)\n\n![ref][img]\n\n[img]: https://example.com/a.png';
  function makeIo() {
    const io = { fetchCalls: [], toImageCalls: 0 };
    io.fetch = async (url) => {
      io.fetchCalls.push(url);
      if (url.endsWith('/404.png')) return { ok: false, status: 404, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG_1x1.slice().buffer };
    };
    // stands in for the browser's canvas re-encode of formats Word cannot embed directly
    io.toImage = async (bytes) => { io.toImageCalls++; return E.sniffImage(bytes) ? null : { type: 'png', data: PNG_1x1, width: 10, height: 10 }; };
    return io;
  }
  async function run(embedRemote) {
    const io = makeIo();
    const tree = E.parseMarkdown(md, lib);
    const { doc, report } = await E.exportDocx(tree, lib, { paper: 'a4', font: 'zh-song', title: 't', embedRemote }, io);
    const zip = await JSZip.loadAsync(await docx.Packer.toBuffer(doc));
    return { io, report, document: await zip.file('word/document.xml').async('string'), rels: await zip.file('word/_rels/document.xml.rels').async('string') };
  }
  const off = await run(false);
  check('switch off: export makes no fetch call', off.io.fetchCalls.length === 0, JSON.stringify(off.io.fetchCalls));
  check('switch off: http(s) images become links with their alt text', /<w:hyperlink /.test(paraWith(off.document, '[remote]')) && off.rels.includes('Target="https://example.com/a.png"'), paraWith(off.document, 'remote'));
  check('switch off: data URI images are still embedded (PNG and re-encoded SVG)', (off.document.match(/<a:blip r:embed=/g) || []).length === 2 && off.io.toImageCalls === 1, (off.document.match(/<a:blip r:embed=/g) || []).length);
  check('switch off: report counts skipped web images, not failures', off.report.imagesEmbedded === 2 && off.report.imagesSkipped === 3 && off.report.imagesMissing === 0, JSON.stringify(off.report));
  const on = await run(true);
  check('switch on: each web image URL is fetched once', JSON.stringify(on.io.fetchCalls.slice().sort()) === '["https://example.com/404.png","https://example.com/a.png"]', JSON.stringify(on.io.fetchCalls));
  check('switch on: fetched images and data URIs are embedded', (on.document.match(/<a:blip r:embed=/g) || []).length === 4, (on.document.match(/<a:blip r:embed=/g) || []).length);
  check('switch on: image that fails to load stays a link', /<w:hyperlink /.test(paraWith(on.document, '[missing]')));
  check('switch on: report', on.report.imagesEmbedded === 4 && on.report.imagesMissing === 1 && on.report.imagesSkipped === 0, JSON.stringify(on.report));
  const dflt = await (async () => { const io = makeIo(); await E.exportDocx(E.parseMarkdown(md, lib), lib, { paper: 'a4', font: 'zh-song' }, io); return io; })();
  check('switch defaults to off when the option is missing', dflt.fetchCalls.length === 0, JSON.stringify(dflt.fetchCalls));
}

// ── footnotes ────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('Claim[^a] and another[^b].\n\n[^b]: Second note.\n[^a]: First **note**.\n\nUnknown[^zz].');
  check('footnote references are Word footnotes numbered by first use', /<w:footnoteReference w:id="1"\/>[\s\S]*<w:footnoteReference w:id="2"\/>/.test(r.document), r.document.match(/<w:footnoteReference[^>]*>/g));
  check('footnote text is in footnotes.xml', r.footnotes.includes('First ') && r.footnotes.includes('Second note.'), r.footnotes.slice(-400));
  check('footnote 1 holds the first referenced note', /<w:footnote w:id="1">[\s\S]*?First [\s\S]*?<\/w:footnote>/.test(r.footnotes));
  check('footnote keeps inline bold', /<w:footnote w:id="1">[\s\S]*?<w:b\/>[\s\S]*?note[\s\S]*?<\/w:footnote>/.test(r.footnotes));
  check('footnote definitions are not repeated as body text', !textOf(r.document).includes('Second note'));
  check('undefined footnote reference stays literal', textOf(r.document).includes('Unknown[^zz].'));
}

// ── raw HTML ────────────────────────────────────────────────────────────────
{
  const r = await exportDocx('<b>raw html</b><script>alert(1)</script> after\n\n<div align="center">\n  <img src="x" onerror="alert(2)">\n  <p>block text &amp; more</p>\n</div>\n\n<!-- comment -->\n\n<style>p{}</style>\n\nline<br/>two');
  const all = textOf(r.document);
  check('inline tags are dropped, their text kept', all.includes('raw html after'), all);
  check('script content is dropped', !all.includes('alert(1)') && !all.includes('alert(2)'), all);
  check('no tag text leaks into the document', !/<\/?(b|div|img|p|script|style)\b/.test(all), all);
  check('block HTML keeps its text with entities decoded', all.includes('block text & more'), all);
  check('HTML comments and style blocks produce nothing', !all.includes('comment') && !all.includes('p{}'), all);
  check('inline <br/> is a line break', /<w:br\/>/.test(paraWith(r.document, 'line')), paraWith(r.document, 'line'));
}

// ── fonts, language, page ────────────────────────────────────────────────────
{
  const zh = await exportDocx('中文 English');
  const dd = (zh.styles.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/) || [''])[0];
  check('default East Asian font is set (zh: SimSun)', /w:eastAsia="SimSun"/.test(dd), dd);
  check('default Latin font is set', /w:ascii="Calibri"/.test(dd) && /w:hAnsi="Calibri"/.test(dd), dd);
  check('East Asian language is set (zh-CN)', /<w:lang [^>]*w:eastAsia="zh-CN"/.test(dd), dd);
  check('runs with CJK text carry the eastAsia hint', /<w:rFonts w:hint="eastAsia"\/>[\s\S]*?<w:t[^>]*>中文 English</.test(zh.document), zh.document.slice(-600));
  const en = await exportDocx('English only');
  check('runs without CJK text have no hint', !/w:hint=/.test(en.document));
  const ja = await exportDocx('日本語', { font: 'ja-mincho' });
  check('ja preset: Yu Mincho + ja-JP', /w:eastAsia="Yu Mincho"/.test(ja.styles) && /w:eastAsia="ja-JP"/.test(ja.styles));
  const ko = await exportDocx('한국어', { font: 'ko-malgun' });
  check('ko preset: Malgun Gothic + ko-KR', /w:eastAsia="Malgun Gothic"/.test(ko.styles) && /w:eastAsia="ko-KR"/.test(ko.styles));
  check('every font preset has a label in all 4 languages', Object.keys(E.FONT_PRESETS).every((k) => ['en', 'zh', 'ja', 'ko'].every((l) => E.STRINGS[l]['font_' + k])));
  check('default font by page language', E.defaultFontFor('zh') === 'zh-song' && E.defaultFontFor('ja') === 'ja-mincho' && E.defaultFontFor('ko') === 'ko-malgun' && E.FONT_PRESETS[E.defaultFontFor('en')] !== undefined);
  check('A4 page size and 1-inch margins', /<w:pgSz w:w="11906" w:h="16838"/.test(zh.document) && /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/.test(zh.document));
  const letter = await exportDocx('x', { paper: 'letter' });
  check('Letter page size', /<w:pgSz w:w="12240" w:h="15840"/.test(letter.document));
  check('paperFor: Letter for US, Canada, Mexico, Philippines', ['en-US', 'en-CA', 'fr-CA', 'es-MX', 'en-PH', 'es-CL', 'es-CO'].every((l) => E.paperFor(l) === 'letter'));
  check('paperFor: A4 elsewhere and for bare language tags', ['en-GB', 'en-IN', 'de-DE', 'zh-CN', 'ja', 'ko-KR', 'en', '', undefined].every((l) => E.paperFor(l) === 'a4'));
  check('defaultPaper: A4 on zh / ja / ko pages even with an en-US browser', ['zh', 'ja', 'ko'].every((l) => E.defaultPaper(l, 'en-US') === 'a4'));
  check('defaultPaper: English page follows the browser region', E.defaultPaper('en', 'en-US') === 'letter' && E.defaultPaper('en', 'en-GB') === 'a4');
  check('document author is not "Un-named"', !zh.core.includes('Un-named'), zh.core);
}

// ── frontmatter ──────────────────────────────────────────────────────────────
{
  const r = await exportDocx('---\ntitle: My note\ntags:\n  - a\ndate: 2026-09-30\n---\n\n# Body');
  check('YAML frontmatter is not rendered', !textOf(r.document).includes('title:') && textOf(r.document) === 'Body', textOf(r.document));
  const k = await exportDocx('---\n\nIntro paragraph.\n\n---\n\nMore.');
  check('a leading thematic break followed by prose is kept', textOf(k.document).includes('Intro paragraph.') && textOf(k.document).includes('More.'), textOf(k.document));
}

// ── filename ─────────────────────────────────────────────────────────────────
{
  check('safeFilename strips reserved characters', E.safeFilename('a/b\\c:d*e?f"g<h>i|j') === 'abcdefghij', E.safeFilename('a/b\\c:d*e?f"g<h>i|j'));
  check('safeFilename drops a trailing .docx', E.safeFilename('Report.DOCX') === 'Report');
  check('safeFilename keeps CJK', E.safeFilename('  周报 2026 ') === '周报 2026');
  check('safeFilename falls back to "document"', E.safeFilename('...') === 'document' && E.safeFilename('') === 'document');
  check('safeFilename caps length at 80 characters', [...E.safeFilename('字'.repeat(200))].length === 80);
}

// ── preview HTML is escaped ──────────────────────────────────────────────────
{
  const html = E.renderHtml(E.parseMarkdown('[a](x" onmouseover="alert(1)) [b](javascript:alert(2)) <img src=x onerror=alert(3)>\n\n<script>alert(4)</script>\n\n![i](https://example.com/p.png)\n\n| h |\n|---|\n| <b>c</b> |', lib));
  check('preview: link target cannot add attributes', !/onmouseover=/.test(html.replace(/&quot;/g, '')) || !/<a [^>]*onmouseover/.test(html), html);
  check('preview: no event handler attribute anywhere', !/<[^>]+\son\w+=/.test(html), html);
  check('preview: javascript: link is not an href', !/href="javascript:/i.test(html), html);
  check('preview: raw HTML does not create tags', !/<img /.test(html) && !/<script/.test(html) && !/<b>/.test(html), html);
  check('preview: remote image is a placeholder, not loaded', !/src="https:\/\/example.com\/p.png"/.test(html) && html.includes('p.png'), html);
  const h2 = E.renderHtml(E.parseMarkdown('**注意：**这里\n\n- [x] done\n\n| a |\n|:-:|\n| 1 |', lib));
  check('preview: CJK bold', h2.includes('<strong>注意：</strong>这里'), h2);
  check('preview: task checkbox', /<input type="checkbox" disabled checked/.test(h2), h2);
  check('preview: column alignment', /<th style="text-align:center">/.test(h2), h2);
}

// ── strings ─────────────────────────────────────────────────────────────────
{
  const keys = Object.keys(E.STRINGS.en).sort().join(',');
  check('4 languages have the same STRINGS keys', ['zh', 'ja', 'ko'].every((l) => Object.keys(E.STRINGS[l]).sort().join(',') === keys));
  const used = [...source.matchAll(/\bS\.(\w+)|\bT\.(\w+)|fmt\('(\w+)'/g)].map((m) => m[1] || m[2] || m[3]);
  check('every string key used by the component exists', used.length > 10 && used.every((k) => E.STRINGS.en[k] !== undefined), used.filter((k) => E.STRINGS.en[k] === undefined));
  const vars = (str) => (str.match(/\{\w+\}/g) || []).sort().join(',');
  // tips is an object (toggletip text), checked below
  const textKeys = Object.keys(E.STRINGS.en).filter((k) => typeof E.STRINGS.en[k] === 'string');
  check('placeholders match across languages', textKeys.every((k) => ['zh', 'ja', 'ko'].every((l) => vars(E.STRINGS[l][k]) === vars(E.STRINGS.en[k]))));
  // toggletip text: the same keys in every language, plain sentences (no placeholders, line breaks or links)
  const tipKeys = Object.keys(E.STRINGS.en.tips).sort();
  for (const l of ['en', 'zh', 'ja', 'ko']) {
    check('STRINGS ' + l + ' tips keys', Object.keys(E.STRINGS[l].tips).sort().join(',') === tipKeys.join(','), Object.keys(E.STRINGS[l].tips));
    check('STRINGS ' + l + ' tips are plain sentences', tipKeys.every((k) => typeof E.STRINGS[l].tips[k] === 'string' && E.STRINGS[l].tips[k].length > 20 && !/\{\w+\}|\n|https?:\/\//.test(E.STRINGS[l].tips[k])));
    // the embed tip states what the export code does: off by default, 15 s, failures stay links
    check('STRINGS ' + l + ' embed tip names the 15 second limit', /15/.test(E.STRINGS[l].tips.embed));
  }
}

// ── large document ───────────────────────────────────────────────────────────
{
  const lines = [];
  for (let i = 0; i < 2000; i++) {
    lines.push('## 第 ' + i + ' 节', '', '这是**第 ' + i + ' 段**正文，含 `code` 与 [链接](https://example.com/' + i + ')。', '', '- 列表项 ' + i, '');
  }
  const md = lines.join('\n');
  const t0 = performance.now();
  const r = await exportDocx(md);
  const ms = performance.now() - t0;
  check('10,000-line document: all 2,000 headings exported', (r.document.match(/<w:pStyle w:val="Heading2"\/>/g) || []).length === 2000);
  check('10,000-line document converts in under 10 s (took ' + Math.round(ms) + ' ms)', ms < 10000 * PERF_SLACK, ms);
  console.log('info: 10,000-line document (' + md.length + ' chars) parsed, built and packed in ' + Math.round(ms) + ' ms');
}

// ── v2 page layout (DESIGN.md "Tool Pages v2", kind: convert) ────────────────
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script>\n  import'));
  check('the tool root is .mw-wrap (it gets the height of the first screen)', /^\s*<div class="mw-wrap" /.test(markup) && markup.trimEnd().endsWith('</div>'));
  check('editor and preview sit in the shared two-pane grid', markup.includes('class="mw-panes zt-io"') &&
    markup.includes('<div class="mw-pane mw-pane-editor zt-io-pane">') && markup.includes('<div class="mw-pane mw-pane-preview zt-io-pane">'));
  check('the editor and the preview fill their pane', (markup.match(/<[^>]*\bzt-io-fill\b[^>]*>/g) || []).map((m) => (m.match(/id="([\w-]+)"/) || [])[1]).join() === 'mw-editor,mw-preview');
  check('buttons, options and status come before the panes', markup.indexOf('id="mw-convert"') < markup.indexOf('class="mw-options"') &&
    markup.indexOf('class="mw-options"') < markup.indexOf('id="mw-status"') && markup.indexOf('id="mw-status"') < markup.indexOf('class="mw-panes zt-io"'));
  check('the privacy note stays under the preview', markup.indexOf('id="mw-preview"') < markup.indexOf('class="mw-privacy"'));
  const tipIds = (markup.match(/<Toggletip id="mw-tip-\w+"/g) || []).map((m) => m.slice(22, -1));
  check('one toggletip per explained control', tipIds.join() === 'filename,open,paper,font,embed,editor,preview', tipIds);
  check('every tip key has a toggletip', tipIds.slice().sort().join() === Object.keys(E.STRINGS.en.tips).sort().join());
  check('each toggletip shows its own text', tipIds.every((id) => new RegExp('<Toggletip id="mw-tip-' + id + '"[^>]*>\\{TIPS\\.' + id + '\\}</Toggletip>').test(markup)));
  check('no toggletip inside a label', !/<label[^>]*>(?:(?!<\/label>)[\s\S])*<Toggletip/.test(markup));
  check('toggletip text stays out of data-strings', source.includes('const { tips: TIPS, ...CLIENT_S } = S;') &&
    markup.includes('data-strings={JSON.stringify(CLIENT_S)}') && !/\bT\.tips\b/.test(source));
  // "Embed web images": off in the markup; what it sends is written under the privacy note and shown while the switch is on
  check('the embed switch is unchecked in the markup and described by its note and its toggletip',
    markup.includes('<input type="checkbox" id="mw-embed-remote" aria-describedby="mw-embed-note mw-tip-embed" />'));
  check('the network note is under the privacy note and hidden until the switch is on',
    /class="mw-privacy">[\s\S]*?<\/p>\s*<p id="mw-embed-note" class="mw-embed-note" hidden>\{S\.embedRemoteNote\}<\/p>/.test(markup) &&
    source.includes('.mw-embed-note[hidden] { display: none; }'));
  check('the network note names the IP address in every language', ['en', 'zh', 'ja', 'ko'].every((l) => /\bIP\b/.test(E.STRINGS[l].embedRemoteNote) && /http\(s\)/.test(E.STRINGS[l].embedRemoteNote)));
  const script = source.slice(source.indexOf('/* ── engine:end ── */'), source.lastIndexOf('</script>'));
  check('the note follows the switch: on load, on change, on Clear and on Ctrl/Cmd+L',
    script.includes('function syncEmbedNote() { embedNote.hidden = !embedRemoteBox.checked; }') &&
    /embedRemoteImages === true;\s*syncEmbedNote\(\);/.test(script) &&
    /addEventListener\('change', \(\) => \{\s*syncEmbedNote\(\);/.test(script) &&
    (script.match(/embedRemoteBox\.checked = false;\s*syncEmbedNote\(\);/g) || []).length === 2);
  check('the embed switch still starts from the saved value only', source.includes("embedRemoteBox.checked = ((window as any).ztPersist?.load(SLUG) || {}).embedRemoteImages === true;"));
  // ToolLayout's Ctrl/Cmd+L empties the editor without an input event; the tool drops the preview, status and switch state.
  check('Ctrl/Cmd+L refreshes the preview and clears the status and the switch',
    /e\.key !== 'l' && e\.key !== 'L'\)\) return;\s*setTimeout\(\(\) => \{\s*if \(editor\.value\) return;\s*clearTimeout\(timer\);\s*embedRemoteBox\.checked = false;\s*syncEmbedNote\(\);\s*setStatus\(''\);\s*refresh\(\);/.test(source));
  const style = source.slice(source.lastIndexOf('\n<style>\n'));
  check('stacking breakpoint is 860px, phone details at 640px', (style.match(/@media \((?:max|min)-width: \d+px\)/g) || []).join() === '@media (max-width: 860px),@media (max-width: 640px)');
  check('a long document scrolls inside the preview', source.includes('class="mw-preview zt-io-fill"') && /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(commonStyle) && /\.mw-preview \{\s*overflow: auto;/.test(style) && !/max-height: 640px|min-height: 420px/.test(style));
  check('stacked, both boxes get a height', /@media \(max-width: 860px\) \{[^}]*\}\s*\.mw-editor \{ height: \d+px; \}\s*\.mw-preview \{ height: \d+px; \}/.test(style));
  check('preview content rules stay global (the script writes it with innerHTML)', (style.match(/^  \.mw-preview :global\(/gm) || []).length >= 20);
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('listed as a convert page', layouts.includes("'markdown-to-word': 'convert'"));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/markdown-to-word', lang + '.mdx'), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const body = mdx.slice(front.length + 5);
    const steps = (front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).match(/^  - "(.*)"$/gm) || []).map((m) => m.slice(5, -1));
    check(lang + ' mdx: 5 steps in the frontmatter, within the llms limits', front.includes('\nsteps:\n') && steps.length === 5 && steps.every((x) => x.length <= 280 && !/\*\*/.test(x)) && steps.join('').length <= 1200, steps.length);
    check(lang + ' mdx: the steps use the current button names', [E.STRINGS[lang].openFile, E.STRINGS[lang].embedRemote, E.STRINGS[lang].download].every((name) => steps.join(' ').includes(name)));
    check(lang + ' mdx: no usage section in the body', !/^## (How to convert Markdown to Word|使用方法|使い方|사용 방법)\s*$/m.test(body));
    check(lang + ' mdx: the limits section stays', /^## (Limits|限制|制限|제한 사항)\s*$/m.test(body));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
