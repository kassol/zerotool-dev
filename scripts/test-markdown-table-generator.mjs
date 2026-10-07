// Markdown Table Generator — engine tests
// Also reads src/styles/tool-common.css for the shared fill and toggletip rules.
//
// Read:  src/components/tools/MarkdownTableGeneratorTool.astro (the real engine between the
//        `engine:start` / `engine:end` markers and the STRINGS table between `strings:start` /
//        `strings:end`), src/content/tools/markdown-table-generator/*.mdx and
//        src/content/blog/markdown-table-generator-guide/{en,ja}.mdx (examples marked
//        `{/* mdt-check: … */}`), scripts/test-markdown-table-generator.fixtures.json (GitHub,
//        Zenn and Qiita renderings recorded by gen-markdown-table-generator-fixtures.mjs) and
//        scripts/test-markdown-table-generator.eaw.json (East Asian Width ranges parsed from
//        EastAsianWidth-18.0.0.txt)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the rewrite: a pipe after a backslash was escaped as "\\|", which micromark splits into
// two cells; a line break inside a cell went into the Markdown as a raw newline and ended the row;
// rows of pasted data longer than the header lost their extra cells; Excel data whose first cell
// was empty lost a column (the whole input was trimmed); a quote in the middle of a field
// ('5" pipe') started a quoted field; columns were not padded, so CJK tables did not line up.
// Expected now (each checked below against micromark, markdownlint, string-width or the recorded
// platform output).
//
// Run: node scripts/test-markdown-table-generator.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';
import { parse as parse5Parse, parseFragment } from 'parse5';
import { decodeHTML } from 'entities';
import { lint } from 'markdownlint/promise';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const commonStyle = readFileSync(join(root, 'src/styles/tool-common.css'), 'utf8');
const source = readFileSync(join(root, 'src/components/tools/MarkdownTableGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
if (s < 0 || e <= s) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(s, e) + `
return { eastAsianWidthClass, displayWidth, encodeCell, escapePipes, escapeInline, buildMarkdown, splitRow,
  parseMarkdownTable, parseDelimited, detectDelimiter, detectFormat, rowsToTable, jsonToTable, htmlTableRows,
  gridFromHtmlRows, parseFullwidthTable, emptyTable, cloneTable, insertRow, deleteRow, insertColumn, deleteColumn, moveColumn,
  moveRow, cellNumber, sortRows, transpose };`)();

let passes = 0;
let failures = 0;
let skips = 0;
function check(name, ok, detail) {
  if (ok) passes++;
  else { failures++; console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
function eq(name, got, want) {
  const a = JSON.stringify(got); const b = JSON.stringify(want);
  check(name, a === b, 'got ' + a + ', expected ' + b);
}
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' — ' + why); }
function throwsCode(name, fn, code) {
  try { fn(); check(name, false, 'no error'); }
  catch (err) { check(name, err.code === code, 'code ' + err.code + ' / ' + err.message); }
}

// Seeded PRNG so failures reproduce.
let seed = 20261002;
function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pick(a) { return a[Math.floor(rnd() * a.length)]; }
function randString(pool, max) {
  const n = Math.floor(rnd() * max);
  let out = '';
  for (let i = 0; i < n; i++) out += pick(pool);
  return out;
}

const render = (md, dangerous) => micromark(md, { extensions: [gfm()], htmlExtensions: [gfmHtml()], allowDangerousHtml: !!dangerous });

// Text of each th / td in the first <table> of an HTML string: <br> is "\n", entities decoded.
function tableTexts(html) {
  const doc = parseFragment(html);
  const rows = [];
  function textOf(n) {
    if (n.nodeName === '#text') return n.value;
    if (n.nodeName === 'br') return '\n';
    return (n.childNodes || []).map(textOf).join('');
  }
  function walk(n) {
    if (n.nodeName === 'tr') rows.push((n.childNodes || []).filter((c) => c.nodeName === 'td' || c.nodeName === 'th').map(textOf));
    (n.childNodes || []).forEach(walk);
  }
  walk(doc);
  return rows;
}

/* ── STRINGS ── */
{
  const a = source.indexOf('/* ── strings:start ── */');
  const b = source.indexOf('/* ── strings:end ── */');
  const STRINGS = new Function(source.slice(a, b).replace('const STRINGS =', 'return') )();
  const langs = ['en', 'zh', 'ja', 'ko'];
  const keys = Object.keys(STRINGS.en).sort();
  langs.forEach((l) => eq('STRINGS ' + l + ' keys', Object.keys(STRINGS[l]).sort(), keys));
  langs.forEach((l) => keys.forEach((k) => {
    if (typeof STRINGS.en[k] !== 'string') return; // tips: checked below
    const want = (STRINGS.en[k].match(/\{\w+\}/g) || []).sort();
    const got = (STRINGS[l][k].match(/\{\w+\}/g) || []).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) check('STRINGS ' + l + '.' + k + ' placeholders', false, got + ' vs ' + want);
  }));
  passes++;
  // toggletip text: the same keys in every language, plain sentences (no placeholders, lists or links)
  const tipKeys = Object.keys(STRINGS.en.tips).sort();
  langs.forEach((l) => {
    eq('STRINGS ' + l + ' tips keys', Object.keys(STRINGS[l].tips).sort(), tipKeys);
    tipKeys.forEach((k) => check('STRINGS ' + l + '.tips.' + k + ' is a plain sentence', typeof STRINGS[l].tips[k] === 'string' && STRINGS[l].tips[k].length > 20 && !/\{\w+\}|\n|https?:/.test(STRINGS[l].tips[k])));
  });
  // every T.xxx used by the script exists
  const used = [...new Set([...source.slice(e).matchAll(/\bT\.(\w+)/g)].map((m) => m[1]))];
  used.forEach((k) => check('STRINGS has ' + k, k in STRINGS.en));
  // error codes thrown by the engine have messages
  ['noData', 'jsonNotArray', 'jsonEmpty', 'jsonItem', 'jsonSyntax', 'htmlNoTable', 'mdNotFound'].forEach((k) => check('STRINGS error ' + k, k in STRINGS.en));
}

/* ── East Asian Width (UAX #11) ── */
{
  const fx = JSON.parse(readFileSync(join(root, 'scripts/test-markdown-table-generator.eaw.json'), 'utf8'));
  check('EAW fixture is 18.0.0', /EastAsianWidth-18\.0\.0/.test(fx.source), fx.source);
  const want = new Map();
  for (const [cls, ranges] of [['W', fx.W], ['W', fx.F], ['A', fx.A]]) for (const [a, b] of ranges) want.set(a + '-' + b, cls);
  const flat = [];
  for (const [k, cls] of want) { const [a, b] = k.split('-').map(Number); flat.push([a, b, cls]); }
  flat.sort((x, y) => x[0] - y[0]);
  let wrong = 0; let first = '';
  let fi = 0;
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    while (fi < flat.length && flat[fi][1] < cp) fi++;
    const expected = fi < flat.length && flat[fi][0] <= cp ? flat[fi][2] : 'N';
    const got = E.eastAsianWidthClass(cp);
    if (got !== expected) { wrong++; if (!first) first = cp.toString(16) + ' ' + got + '/' + expected; }
  }
  check('EAW class of all 1,114,112 code points matches EastAsianWidth-18.0.0.txt', wrong === 0, wrong + ' wrong, first ' + first);
}

/* ── Display width vs string-width 8.1.0 (what markdownlint MD060 uses) ── */
{
  const swDir = join(root, 'node_modules/markdownlint/node_modules/string-width');
  const ver = existsSync(join(swDir, 'package.json')) ? JSON.parse(readFileSync(join(swDir, 'package.json'), 'utf8')).version : null;
  if (ver !== '8.1.0') skip('display width vs string-width', 'string-width ' + ver + ' (compared only against 8.1.0)');
  else {
    const stringWidth = (await import(pathToFileURL(join(swDir, 'index.js')).href)).default;
    const pool = ['a', 'Z', '1', ' ', '-', '|', 'é', 'e\u0301', 'ß', 'Ω', 'Я', '中', '文', '日本', 'あ', 'ア', 'ｱ', 'ｶﾞ', 'ﾊﾟ', 'ｰ', '한', '글', '각', '\u1100\u1161', '１', 'Ａ', '　', '。', '、', '！',
      '○', '×', '①', '→', '※', '±', '°', '§', '“', '…', '😀', '👍🏽', '👨‍👩‍👧', '🇯🇵', '#️⃣', '❤️', '✔', '☺', '\u200b', '\u200d', '\ufe0f', '\u00ad', '\t', '\u3000', '𠮷', '𩸽', '◆', 'Ⅳ', '㎡', '㈱'];
    let bad = 0; let ex = '';
    for (let i = 0; i < 4000; i++) {
      const str = randString(pool, 12);
      for (const amb of [false, true]) {
        const a = E.displayWidth(str, amb); const b = stringWidth(str, { ambiguousIsNarrow: !amb });
        if (a !== b) { bad++; if (!ex) ex = JSON.stringify(str) + ' ' + a + ' vs ' + b; }
      }
    }
    check('display width equals string-width 8.1.0 on 8,000 random strings', bad === 0, bad + ' differ, e.g. ' + ex);
    eq('width of 東京 / ｶﾞ / 👨‍👩‍👧 / ○ (narrow) / ○ (wide)', [E.displayWidth('東京'), E.displayWidth('ｶﾞ'), E.displayWidth('👨‍👩‍👧'), E.displayWidth('○', false), E.displayWidth('○', true)], [4, 2, 2, 1, 2]);
  }
}

/* ── Escaping ── */
eq('escapePipes: none, odd and even backslash runs', ['a|b', 'a\\|b', 'a\\\\|b', '|', 'a\\\\\\|b'].map(E.escapePipes), ['a\\|b', 'a\\|b', 'a\\\\\\|b', '\\|', 'a\\\\\\|b']);
eq('escapeInline keeps intraword underscores', E.escapeInline('snake_case_name _x_ y_'), 'snake_case_name \\_x\\_ y\\_');
eq('escapeInline: < only before a tag or autolink start', E.escapeInline('a < b <b> </i> <!-- x <3'), 'a < b \\<b> \\</i> \\<!-- x <3');
eq('escapeInline: & only before a character reference', E.escapeInline('AT&T &copy; &#169; &#x41; & ;'), 'AT&T \\&copy; \\&#169; \\&#x41; & ;');
eq('escapeInline: backslash before punctuation / letter', E.escapeInline('C:\\Users\\ a\\*'), 'C:\\Users\\ a\\\\\\*');
eq('encodeCell: line breaks to <br>, ends trimmed', E.encodeCell('  a  \n b\n\n', { plain: false, newline: 'br' }).md, 'a<br>b');
eq('encodeCell: line breaks to spaces', E.encodeCell('a\nb', { plain: false, newline: 'space' }).md, 'a b');
eq('encodeCell: tab to space, counted', E.encodeCell('a\tb', { plain: false, newline: 'br' }), { md: 'a b', info: { breaks: 0, tabs: 1, pipes: 0 } });
eq('encodeCell: pipes counted', E.encodeCell('a|b|c', { plain: false, newline: 'br' }).info.pipes, 2);
eq('encodeCell: CRLF is one break', E.encodeCell('a\r\nb', { plain: false, newline: 'br' }).md, 'a<br>b');

/* ── Plain text cells render as typed (micromark, 2,000 random tables) ── */
{
  const pool = ['a', 'b', 'Z', '1', ' ', '|', '\\', '*', '_', '`', '~', '[', ']', '(', ')', '<', '>', '&', '#', ';', '$', '!', '"', "'", ':', '/', '-', '+', '=', '.', ',', '{', '}', '^', '%', '?', '@', 'é', '中', 'x;', 'amp;', '#169;', '\n'];
  let bad = 0; let ex = '';
  for (let i = 0; i < 2000; i++) {
    const cols = 1 + Math.floor(rnd() * 3);
    const t = E.emptyTable(cols, 1 + Math.floor(rnd() * 3), 'H');
    t.headers = t.headers.map(() => randString(pool, 10));
    t.rows = t.rows.map((r) => r.map(() => randString(pool, 14)));
    t.align = t.align.map(() => pick(['none', 'left', 'center', 'right']));
    const opts = { style: pick(['aligned', 'compact']), plain: true, newline: 'br', ambiguousWide: false };
    const md = E.buildMarkdown(t, opts).markdown;
    const got = tableTexts(render(md, true));
    const norm = (c) => c.replace(/\t/g, ' ').split('\n').map((l) => l.replace(/^ +| +$/g, '')).join('\n').replace(/^\n+|\n+$/g, '');
    const want = [t.headers.map(norm)].concat(t.rows.map((r) => r.map(norm)));
    if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; if (!ex) ex = JSON.stringify(md) + ' → ' + JSON.stringify(got) + ' want ' + JSON.stringify(want); }
  }
  check('plain-text cells render as typed in micromark (2,000 random tables)', bad === 0, bad + ' differ: ' + ex);
}

/* ── Markdown cells render in a table the way they render in a paragraph ── */
{
  const pool = ['a', 'b', ' ', '|', '\\', '*', '_', '`', '~', '[', ']', '(', ')', '<', '>', '&', 'amp;', '#', '!', 'x', 'é'];
  let bad = 0; let ex = ''; let n = 0;
  for (let i = 0; i < 3000; i++) {
    const m = 'x' + randString(pool, 12) + 'y';
    if (m.includes('`') && m.includes('\\')) continue; // \| inside a code span: see the fixture case
    n++;
    const cell = E.encodeCell(m, { plain: false, newline: 'br' }).md;
    const inTable = render('| h |\n| --- |\n| ' + cell + ' |', true).match(/<td>([\s\S]*)<\/td>/)[1];
    const inPara = render(m, true).replace(/^<p>|<\/p>\n?$/g, '');
    if (inTable !== inPara) { bad++; if (!ex) ex = JSON.stringify(m) + ': ' + inTable + ' vs ' + inPara; }
  }
  check('Markdown cells render the same in a table as in a paragraph (' + n + ' random cells)', bad === 0, bad + ' differ: ' + ex);
}

/* ── Output passes markdownlint table rules ── */
{
  const pool = ['a', 'bc', ' ', 'Long text', '東京', 'データ', '한글', '😀', '👍🏽', 'ｶﾞ', '|', '**b**', '`x`', '\n', 'é', '１２', 'x'];
  const docs = [];
  for (let i = 0; i < 200; i++) {
    const cols = 1 + Math.floor(rnd() * 4);
    const t = E.emptyTable(cols, Math.floor(rnd() * 4), 'H');
    t.headers = t.headers.map(() => randString(pool, 4));
    t.rows = t.rows.map((r) => r.map(() => randString(pool, 5)));
    t.align = t.align.map(() => pick(['none', 'left', 'center', 'right']));
    docs.push(t);
  }
  for (const style of ['aligned', 'compact']) {
    const strings = {};
    docs.forEach((t, i) => { strings['t' + i] = '# T\n\n' + E.buildMarkdown(t, { style, plain: false, newline: 'br', ambiguousWide: false }).markdown + '\n'; });
    const res = await lint({ strings, config: { default: false, MD055: { style: 'leading_and_trailing' }, MD056: true, MD058: true, MD060: { style } } });
    const errs = Object.values(res).flat();
    check('markdownlint MD055 / MD056 / MD058 / MD060 style "' + style + '" (200 random tables)', errs.length === 0, errs.slice(0, 2).map((x) => x.ruleNames[0] + ' ' + x.errorDetail).join('; '));
  }
}

/* ── Aligned layout details ── */
eq('aligned: widths, alignment padding and delimiter colons', E.buildMarkdown({ headers: ['Name', '都市', 'n'], rows: [['Alice', '東京', '7'], ['Bo', 'NY', '120']], align: ['none', 'center', 'right'] }, { style: 'aligned', plain: false, newline: 'br', ambiguousWide: false }).markdown,
  '| Name  | 都市  |    n |\n| ----- | :---: | ---: |\n| Alice | 東京  |    7 |\n| Bo    |  NY   |  120 |');
eq('compact: one space around pipes, short delimiters', E.buildMarkdown({ headers: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']], align: ['none', 'left', 'center', 'right'] }, { style: 'compact', plain: false, newline: 'br', ambiguousWide: false }).markdown,
  '| a | b | c | d |\n| --- | :--- | :---: | ---: |\n| 1 | 2 | 3 | 4 |');
eq('ambiguous-width option widens ○', E.buildMarkdown({ headers: ['対応'], rows: [['○'], ['×']], align: ['none'] }, { style: 'aligned', plain: false, newline: 'br', ambiguousWide: true }).markdown,
  '| 対応 |\n| ---- |\n| ○   |\n| ×   |');

/* ── Markdown table parsing ── */
{
  // Round trip: generated tables parse back to the same cells.
  const pool = ['a', 'b', ' ', '|', '*', '_', '`', '中', '\n', 'x'];
  let bad = 0; let ex = '';
  for (let i = 0; i < 1000; i++) {
    const cols = 1 + Math.floor(rnd() * 3);
    const t = E.emptyTable(cols, Math.floor(rnd() * 3), 'H');
    t.headers = t.headers.map(() => 'h' + randString(pool, 5));
    t.rows = t.rows.map((r) => r.map(() => randString(pool, 6)));
    t.align = t.align.map(() => pick(['none', 'left', 'center', 'right']));
    const md = E.buildMarkdown(t, { style: pick(['aligned', 'compact']), plain: false, newline: 'br', ambiguousWide: false }).markdown;
    const p = E.parseMarkdownTable('Intro paragraph.\n\n' + md + '\n\nAfter.');
    const norm = (c) => c.split('\n').map((l) => l.trim()).join('\n').replace(/^\n+|\n+$/g, '');
    const want = { headers: t.headers.map(norm), rows: t.rows.map((r) => r.map(norm)), align: t.align };
    if (!p || JSON.stringify(p.table) !== JSON.stringify(want)) { bad++; if (!ex) ex = JSON.stringify(md) + ' → ' + JSON.stringify(p && p.table); }
  }
  check('generated tables parse back to the same cells (1,000 random)', bad === 0, ex);

  // Structure agrees with micromark on hand-written tables.
  const docs = [
    '| a | b |\n|---|---|\n| 1 | 2 |',
    'a | b\n--|--\n1 | 2',
    '| a |\n| --- |\n| 1 |\n| 2 |',
    'Some text\n| a | b |\n|---|---|\n| 1 | 2 |\nbar\n\nafter',
    '| a | b | c |\n|:-|:-:|-:|\n| 1 |',
    '| a |\n|---|\n| 1 |\n- list',
    '| a |\n|---|\n| 1 |\n> quote',
    '| a |\n|---|\n| 1 |\n# heading',
    '| a |\n|---|\n| 1 |\n```\ncode\n```',
    '| a |\n|---|\n| 1 |\n***',
    '| a |\n|---|\n| 1 |\n<div>x</div>',
    '| a |\n|---|\n| 1 |\n1. item',
    '```\n| a |\n|---|\n```\n\n| real |\n|---|\n| 1 |',
    '   | indented |\n   | --- |\n   | 3 spaces |',
    '| a | b |\n| - | - |\n| `x\\|y` | z\\|w |',
    '| a |\n|---|\n|---|',
    '|a|b|\n|-|-|\n|1|2|',
    '| a |\n|---|\n| x<br>y |',
    '| x | y |\n| --- | --- |\n| | |\n| 1 | |',
  ];
  docs.forEach((doc, i) => {
    const p = E.parseMarkdownTable(doc);
    const html = render(doc, true);
    const mm = tableTexts(html);
    if (!p) { check('parse doc ' + i + ' (micromark has no table either)', mm.length === 0, html); return; }
    // compare structure and each cell's inline rendering
    const ours = [p.table.headers].concat(p.table.rows).map((r) => r.map((c) => {
      const cell = E.encodeCell(c, { plain: false, newline: 'br' }).md;
      return tableTexts(render('| h |\n|---|\n| ' + cell + ' |', true))[1][0];
    }));
    eq('parse doc ' + i + ' matches micromark', ours, mm);
  });
  eq('parse alignment', E.parseMarkdownTable('| a | b | c | d |\n|---|:--|:-:|--:|').table.align, ['none', 'left', 'center', 'right']);
  check('no table when header and delimiter counts differ', E.parseMarkdownTable('| a | b |\n|---|\n| 1 | 2 |') === null);
  check('no table without any pipe', E.parseMarkdownTable('a\n---\n1') === null);
  const extra = E.parseMarkdownTable('| a |\n|---|\n| 1 | 2 | 3 |\n| 4 |');
  eq('longer rows: kept as columns and reported', [extra.table.headers, extra.table.rows, extra.extraRows, extra.addedColumns], [['a', 'Column 2', 'Column 3'], [['1', '2', '3'], ['4', '', '']], 1, [2, 3]]);
  const two = E.parseMarkdownTable('| a |\n|---|\n| 1 |\n\ntext\n\n| b |\n|---|\n| 2 |');
  eq('first of two tables, with line range', [two.tables, two.startLine, two.endLine, two.table.headers], [2, 1, 3, ['a']]);
  const dbl = E.parseMarkdownTable('| a | b |\n|---|---|\n| x\\\\|y | 2 |');
  eq('"\\\\|" read the GitHub way (one cell) and reported', [dbl.table.rows[0], dbl.doubleBackslash], [['x\\|y', '2'], 1]);
  check('our own escape is not reported as "\\\\|"', E.parseMarkdownTable(E.buildMarkdown({ headers: ['a'], rows: [['x\\|y']], align: ['none'] }, { style: 'aligned', plain: true, newline: 'br' }).markdown).doubleBackslash === 0);
  eq('<br> variants become line breaks', E.parseMarkdownTable('| a |\n|---|\n| x<br>y<BR/>z<br />w |').table.rows[0][0], 'x\ny\nz\nw');
  const fw = E.parseFullwidthTable('｜ 項目 ｜ 状態 ｜\n｜ーーー｜：－－：｜\n｜ 東京 ｜ ○ ｜');
  eq('full-width pipes read as ASCII, delimiter row with full-width hyphens and colons', [fw.table, fw.fullwidth], [{ headers: ['項目', '状態'], rows: [['東京', '○']], align: ['none', 'center'] }, true]);
  check('full-width colon in a cell is kept', E.parseFullwidthTable('｜注意：A｜B｜\n｜---｜---｜\n｜x｜y｜').table.headers[0] === '注意：A');
  check('no full-width pipe: null', E.parseFullwidthTable('| a |\n|---|') === null);
  eq('detectFormat finds a full-width table', E.detectFormat('｜a｜b｜\n｜-｜-｜'), 'markdown');
  eq('BOM and CRLF', E.parseMarkdownTable('\uFEFF| a |\r\n|---|\r\n| 1 |\r\n').table, { headers: ['a'], rows: [['1']], align: ['none'] });
}

/* ── CSV / TSV ── */
{
  const P = E.parseDelimited;
  eq('RFC 4180 example 6 (quoted CRLF)', P('"aaa","b \r\nbb","ccc"\r\nzzz,yyy,xxx', ','), [['aaa', 'b \r\nbb', 'ccc'], ['zzz', 'yyy', 'xxx']]);
  eq('RFC 4180 example 7 (doubled quote)', P('"aaa","b""bb","ccc"', ','), [['aaa', 'b"bb', 'ccc']]);
  eq('trailing newline adds no row', P('a,b\n', ','), [['a', 'b']]);
  eq('empty fields kept, including a leading empty cell', P('\tQ1\tQ2\r\nNorth\t1\t\r\n', '\t'), [['', 'Q1', 'Q2'], ['North', '1', '']]);
  eq('quote in the middle of a field is text', P('5" pipe\t12', '\t'), [['5" pipe', '12']]);
  eq('quoted field followed by text is read as text', P('"x"y,z', ','), [['"x"y', 'z']]);
  eq('Excel TSV with a multi-line cell and quotes', P('Name\tNote\r\nA\t"line 1\nsaid ""hi"""\r\n', '\t'), [['Name', 'Note'], ['A', 'line 1\nsaid "hi"']]);
  eq('BOM removed', P('\uFEFFa,b', ','), [['a', 'b']]);
  eq('unterminated quote reads to the end', P('a,"b\nc', ','), [['a', '"b'], ['c']]);
  // Random round trip through an RFC 4180 writer.
  const pool = ['a', 'b', ' ', ',', ';', '\t', '"', '\n', '\r\n', '中', ''];
  let bad = 0; let ex = '';
  for (let i = 0; i < 1000; i++) {
    const delim = pick([',', ';', '\t']);
    const rows = [];
    const cols = 1 + Math.floor(rnd() * 4);
    for (let r = 0; r < 1 + Math.floor(rnd() * 4); r++) { const row = []; for (let c = 0; c < cols; c++) row.push(randString(pool, 5)); rows.push(row); }
    // A last row with one empty field is indistinguishable from a trailing line break.
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0] === '') continue;
    const q = (v) => (/[",;\t\r\n]/.test(v) || v.startsWith('"') ? '"' + v.replace(/"/g, '""') + '"' : v);
    const text = rows.map((r) => r.map(q).join(delim)).join('\r\n') + (rnd() < 0.5 ? '\r\n' : '');
    const got = P(text, delim);
    if (JSON.stringify(got) !== JSON.stringify(rows)) { bad++; if (!ex) ex = JSON.stringify(text) + ' → ' + JSON.stringify(got); }
  }
  check('CSV / TSV written by an RFC 4180 writer reads back (1,000 random)', bad === 0, ex);
  eq('detectDelimiter', ['a\tb\n1\t2', 'a,b\n1,2', 'a;b;c\n1,5;2;3', 'x\n"a,b";c\n', 'a|b\n1|2', 'single'].map(E.detectDelimiter), ['\t', ',', ';', ',', '|', ',']);
  eq('detectFormat', ['[{"a":1}]', '{"a":1}', '<table><tr><td>1</td></tr></table>', '| a |\n|---|', 'a\tb', 'a,b', '[not json', '  '].map(E.detectFormat), ['json', 'json', 'html', 'markdown', 'tsv', 'csv', 'csv', 'empty']);
  const r2t = E.rowsToTable([['a', 'b'], ['1', '2', '3'], ['4']], true, 'Column');
  eq('rows longer than the header add columns', r2t, { table: { headers: ['a', 'b', 'Column 3'], rows: [['1', '2', '3'], ['4', '', '']], align: ['none', 'none', 'none'] }, addedColumns: [3] });
  eq('no header row: Column N headers', E.rowsToTable([['1', '2']], false, 'Col').table.headers, ['Col 1', 'Col 2']);
  throwsCode('no data', () => E.rowsToTable([], true, 'C'), 'noData');
}

/* ── JSON ── */
eq('keys from all objects', E.jsonToTable([{ a: 1 }, { b: 2, a: 3 }]), { headers: ['a', 'b'], rows: [['1', ''], ['3', '2']] });
eq('nested values are JSON text', E.jsonToTable([{ user: { name: 'Alice' }, tags: ['x', 'y'], n: null, ok: true }]).rows, [['{"name":"Alice"}', '["x","y"]', '', 'true']]);
eq('prototype key names', E.jsonToTable([{ constructor: 1 }, { toString: 'x' }]), { headers: ['constructor', 'toString'], rows: [['1', ''], ['', 'x']] });
eq('one object is one row', E.jsonToTable({ a: 1, b: 'x' }), { headers: ['a', 'b'], rows: [['1', 'x']] });
eq('array of arrays is rows', E.jsonToTable([['a', 'b'], [1, null]]), { headers: null, rows: [['a', 'b'], ['1', '']] });
throwsCode('not an array or object', () => E.jsonToTable(3), 'jsonNotArray');
throwsCode('empty array', () => E.jsonToTable([]), 'jsonEmpty');
throwsCode('second item not an object', () => E.jsonToTable([{ a: 1 }, 2]), 'jsonItem');

/* ── HTML tables (parse5 stands in for the browser DOM) ── */
{
  const A = {
    name: (n) => (n.nodeName === '#text' ? '#text' : n.nodeName === '#comment' ? '#comment' : n.nodeName),
    children: (n) => (n.nodeName === 'template' ? [] : n.childNodes || []),
    text: (n) => n.value || '',
    attr: (n, a) => { const x = (n.attrs || []).find((y) => y.name === a); return x ? x.value : null; },
  };
  const read = (html) => { const r = E.htmlTableRows(parse5Parse(html), A); return r && { grid: E.gridFromHtmlRows(r.rows), headerRow: r.headerRow }; };
  // Excel puts in-cell line breaks as <br style="mso-data-placement:same-cell;"> and wraps source lines.
  const excel = read('<html><body><table border=0><tr height=20><td height=20 width=64>Region</td><td width=64>Sales\n  Q1</td></tr>'
    + '<tr><td>North</td><td align=right>1,200</td></tr><tr><td>Note</td><td>line 1<br style="mso-data-placement:same-cell;" />line 2</td></tr></table></body></html>');
  eq('Excel-style clipboard HTML', excel.grid.rows, [['Region', 'Sales Q1'], ['North', '1,200'], ['Note', 'line 1\nline 2']]);
  const spans = read('<table><thead><tr><th colspan=2>Name</th><th>Age</th></tr></thead><tbody><tr><td rowspan=2>A</td><td>x</td><td>1</td></tr><tr><td>y</td><td>2</td></tr></tbody><tfoot><tr><td>Total</td><td></td><td>3</td></tr></tfoot></table>');
  eq('colspan / rowspan expand, thead and tfoot order', [spans.grid.rows, spans.grid.spans, spans.headerRow], [[['Name', '', 'Age'], ['A', 'x', '1'], ['', 'y', '2'], ['Total', '', '3']], 2, true]);
  const misc = read('<div><p>before</p><table><tr><td><b>bold</b> &amp; <i>it</i>&nbsp;</td><td><p>para 1</p><p>para 2</p></td><td><script>x()</script>ok</td></tr></table><table><tr><td>second</td></tr></table></div>');
  eq('inline markup, entities, paragraphs, script skipped, first table only', misc.grid.rows, [['bold & it', 'para 1\npara 2', 'ok']]);
  check('no table', read('<p>none</p>') === null);
  const tfootFirst = read('<table><tfoot><tr><td>F</td></tr></tfoot><tbody><tr><td>B</td></tr></tbody></table>');
  eq('tfoot written before tbody still comes last', tfootFirst.grid.rows, [['B'], ['F']]);
}

/* ── Editing ── */
{
  const base = () => ({ headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']], align: ['left', 'right'] });
  let t = base(); E.insertRow(t, 1); eq('insert row', t.rows, [['1', '2'], ['', ''], ['3', '4']]);
  t = base(); E.deleteRow(t, 0); eq('delete row', t.rows, [['3', '4']]);
  t = base(); E.insertColumn(t, 1, 'new'); eq('insert column', [t.headers, t.align, t.rows], [['a', 'new', 'b'], ['left', 'none', 'right'], [['1', '', '2'], ['3', '', '4']]]);
  t = base(); E.deleteColumn(t, 0); eq('delete column', [t.headers, t.align, t.rows], [['b'], ['right'], [['2'], ['4']]]);
  t = { headers: ['a'], rows: [['1']], align: ['none'] }; E.deleteColumn(t, 0); eq('last column stays', t.headers, ['a']);
  t = base(); E.moveColumn(t, 0, 1); eq('move column', [t.headers, t.align, t.rows[0]], [['b', 'a'], ['right', 'left'], ['2', '1']]);
  t = base(); E.moveRow(t, 1, 0); eq('move row', t.rows, [['3', '4'], ['1', '2']]);
  eq('cellNumber', ['1,200', '¥3,400', '５０', '12%', '−3', '1e3', '.5', '1,2', 'abc', '', '1.2.3'].map(E.cellNumber).map((x) => (Number.isNaN(x) ? 'NaN' : x)), [1200, 3400, 50, 12, -3, 1000, 0.5, 'NaN', 'NaN', 'NaN', 'NaN']);
  t = { headers: ['n'], rows: [['10'], [''], ['9'], ['1,200'], ['-1']], align: ['none'] };
  eq('numeric sort, empty last', [E.sortRows(t, 0, 'asc', 'en'), t.rows.map((r) => r[0])], ['number', ['-1', '9', '10', '1,200', '']]);
  E.sortRows(t, 0, 'desc', 'en'); eq('numeric sort desc, empty still last', t.rows.map((r) => r[0]), ['1,200', '10', '9', '-1', '']);
  t = { headers: ['s'], rows: [['item10'], ['Item2'], ['item1'], ['b'], ['a']], align: ['none'] };
  eq('text sort uses numeric collation', [E.sortRows(t, 0, 'asc', 'en'), t.rows.map((r) => r[0])], ['text', ['a', 'b', 'item1', 'Item2', 'item10']]);
  t = { headers: ['k', 'v'], rows: [['x', '1'], ['y', '1'], ['z', '0']], align: ['none', 'none'] };
  E.sortRows(t, 1, 'asc', 'en'); eq('stable for equal keys', t.rows.map((r) => r[0]), ['z', 'x', 'y']);
  t = base(); const tr = E.transpose(t);
  eq('transpose', tr, { headers: ['a', '1', '3'], rows: [['b', '2', '4']], align: ['none', 'none', 'none'] });
  eq('transpose twice restores cells', (() => { const x = E.transpose(E.transpose(base())); return [x.headers, x.rows]; })(), [['a', 'b'], [['1', '2'], ['3', '4']]]);
  t = base(); const cl = E.cloneTable(t); cl.rows[0][0] = 'changed'; check('cloneTable is deep', t.rows[0][0] === '1');
}

/* ── Platform renderings recorded by gen-markdown-table-generator-fixtures.mjs ── */
{
  const fx = JSON.parse(readFileSync(join(root, 'scripts/test-markdown-table-generator.fixtures.json'), 'utf8'));
  check('fixture lists renderer versions', !!(fx.renderers && fx.renderers.github && fx.renderers.gitee && fx.renderers.zenn && fx.renderers.qiita), JSON.stringify(fx.renderers));
  fx.cases.forEach((c) => {
    eq('fixture "' + c.name + '": engine still writes the recorded Markdown', E.buildMarkdown(c.table, c.opts).markdown, c.markdown);
    for (const p of ['github', 'gitee', 'zenn', 'qiita']) eq('fixture "' + c.name + '" on ' + p, tableTexts(c[p]), c.expect);
    eq('fixture "' + c.name + '" in micromark', tableTexts(render(c.markdown, true)), c.expect);
  });
  const F = Object.fromEntries(fx.foreign.map((f) => [f.name, f]));
  const two = F['two backslashes before a pipe'];
  eq('"\\\\|": GitHub, Gitee, Zenn and Qiita keep one cell', ['github', 'gitee', 'zenn', 'qiita'].map((p) => tableTexts(two[p])[1]), [['x|y', '2'], ['x|y', '2'], ['x|y', '2'], ['x|y', '2']]);
  eq('"\\\\|": micromark splits the cell', tableTexts(render(two.markdown))[1], ['x\\', 'y']);
  const code = F['pipe inside code without a backslash'];
  eq('unescaped pipe in a code span splits the row everywhere', ['github', 'gitee', 'zenn', 'qiita'].map((p) => tableTexts(code[p])[1]).concat([tableTexts(render(code.markdown))[1]]), [['`x'], ['`x'], ['`x'], ['`x'], ['`x']]);
  const long = F['row longer than the header'];
  eq('extra cells are dropped everywhere', ['github', 'gitee', 'zenn', 'qiita'].map((p) => tableTexts(long[p])[1]).concat([tableTexts(render(long.markdown))[1]]), [['1'], ['1'], ['1'], ['1'], ['1']]);
  const mism = F['header and delimiter cell counts differ'];
  eq('header / delimiter mismatch is no table anywhere', ['github', 'gitee', 'zenn', 'qiita'].map((p) => /<table/.test(mism[p])).concat([/<table/.test(render(mism.markdown))]), [false, false, false, false, false]);
  const para = F['table right after a paragraph line'];
  eq('a table can follow a paragraph line directly', ['github', 'gitee', 'zenn', 'qiita'].map((p) => tableTexts(para[p]).length).concat([tableTexts(render(para.markdown)).length]), [2, 2, 2, 2, 2]);
  const nb = F['no blank lines around the table'];
  const nbWant = [['Name', 'Role'], ['Ana', 'Dev'], ['Ben', 'QA'], ['Cy', ''], ['Next paragraph.', '']];
  eq('no blank lines: table after the paragraph line, extra cell dropped, next line becomes a row', ['github', 'gitee', 'zenn', 'qiita'].map((p) => tableTexts(nb[p])).concat([tableTexts(render(nb.markdown))]), [nbWant, nbWant, nbWant, nbWant, nbWant]);
  eq('no blank lines: parseMarkdownTable reads the same rows', E.parseMarkdownTable(nb.markdown).table.rows.map((r) => r.slice(0, 2)), nbWant.slice(1));
  const fwp = F['full-width pipes'];
  eq('full-width pipes are no table anywhere', ['github', 'gitee', 'zenn', 'qiita'].map((p) => /<table/.test(fwp[p])).concat([/<table/.test(render(fwp.markdown))]), [false, false, false, false, false]);
  const cjk = F['CJK punctuation next to **'];
  eq('**注意：**ここ is not bold on GitHub, Gitee, Zenn, Qiita or micromark', ['github', 'gitee', 'zenn', 'qiita'].map((p) => /<strong>/.test(cjk[p])).concat([/<strong>/.test(render(cjk.markdown))]), [false, false, false, false, false]);
}

/* ── Examples on the tool pages and in the guide ── */
{
  const files = [];
  const toolDir = join(root, 'src/content/tools/markdown-table-generator');
  readdirSync(toolDir).forEach((f) => files.push(join(toolDir, f)));
  const guideDir = join(root, 'src/content/blog/markdown-table-generator-guide');
  ['en.mdx', 'ja.mdx'].forEach((f) => files.push(join(guideDir, f)));
  const decode = (x) => decodeHTML(x.replace(/<[^>]+>/g, ''));
  let count = 0;
  files.forEach((file) => {
    const text = readFileSync(file, 'utf8');
    const rel = file.slice(root.length + 1);
    // {/* mdt-check: {"table": …, "opts": …} */} followed by a code block with the expected output.
    const re = /\{\/\* mdt-check: (\{[\s\S]*?\}) \*\/\}\s*(?:<pre><code>([\s\S]*?)<\/code><\/pre>|```[a-z]*\n([\s\S]*?)\n```)/g;
    let m;
    while ((m = re.exec(text))) {
      count++;
      let spec;
      try { spec = JSON.parse(m[1]); } catch (err) { check(rel + ' mdt-check JSON', false, err.message); continue; }
      const want = m[2] !== undefined ? decode(m[2]) : m[3];
      let got;
      if (spec.import) {
        const fmtName = spec.import.format;
        let t;
        if (fmtName === 'markdown') t = (E.parseMarkdownTable(spec.import.text) || E.parseFullwidthTable(spec.import.text)).table;
        else if (fmtName === 'json') { const j = E.jsonToTable(JSON.parse(spec.import.text)); t = j.headers ? { headers: j.headers, rows: j.rows, align: j.headers.map(() => 'none') } : E.rowsToTable(j.rows, true, 'Column').table; }
        else t = E.rowsToTable(E.parseDelimited(spec.import.text, fmtName === 'tsv' ? '\t' : fmtName === 'csv-semicolon' ? ';' : E.detectDelimiter(spec.import.text)).filter((r) => !(r.length === 1 && r[0] === '')), spec.import.firstRowHeader !== false, 'Column').table;
        if (spec.align) t.align = spec.align;
        got = E.buildMarkdown(t, Object.assign({ style: 'aligned', plain: false, newline: 'br', ambiguousWide: false }, spec.opts || {})).markdown;
      } else {
        got = E.buildMarkdown(spec.table, Object.assign({ style: 'aligned', plain: false, newline: 'br', ambiguousWide: false }, spec.opts || {})).markdown;
      }
      eq(rel + ' example ' + count, got, want);
    }
  });
  check('pages carry mdt-check examples', count >= 8, String(count));
}

/* ── Static checks on the page script ── */
{
  const script = source.slice(source.indexOf('<script>'), source.indexOf('</script>'));
  const inner = [...script.matchAll(/\.innerHTML\s*=/g)].length;
  check('innerHTML only for the micromark preview', inner === 1 && /previewEl\.innerHTML = lib\.render\(md\)/.test(script), String(inner));
  check('preview keeps micromark safe defaults', /allowDangerousHtml: false/.test(script) && /allowDangerousProtocol: false/.test(script));
  check('no direct storage, cookie or network access', !/localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon/.test(script));
  const persistence = readFileSync(join(root, 'src/data/persistence.ts'), 'utf8');
  check("persistence policy is 'preference'", /'markdown-table-generator': 'preference'/.test(persistence));
  check('IME composition does not trigger Enter navigation', /e\.isComposing/.test(script));
}

/* ── v2 page layout (DESIGN.md "Tool Pages v2", kind: convert) ── */
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script>'));
  check('the tool root is .mdt-wrap (it gets the height of the first screen)', /^\s*<div class="mdt-wrap" /.test(markup));
  check('grid and output sit in the shared two-pane grid', markup.includes('class="mdt-panels zt-io"') &&
    markup.includes('<div class="mdt-in zt-io-pane">') && markup.includes('<section class="mdt-out zt-io-pane"'));
  eq('the grid, the import box, the output and the preview fill their pane',
    (markup.match(/<[^>]*\bzt-io-fill\b[^>]*>/g) || []).map((m) => (m.match(/id="([\w-]+)"/) || [])[1]).sort(),
    ['mdt-grid-wrap', 'mdt-import', 'mdt-output', 'mdt-preview']);
  check('both tab panels are inside the input pane', /<div class="mdt-in zt-io-pane">[\s\S]*id="mdt-panel-edit"[\s\S]*id="mdt-panel-import"[\s\S]*<section class="mdt-out/.test(markup));
  check('buttons, options and status come before the panes', markup.indexOf('id="mdt-copy"') < markup.indexOf('class="mdt-out-opts"') &&
    markup.indexOf('class="mdt-out-opts"') < markup.indexOf('id="mdt-status"') && markup.indexOf('id="mdt-status"') < markup.indexOf('class="mdt-panels zt-io"'));
  check('notes stay under the output', markup.indexOf('id="mdt-preview"') < markup.indexOf('id="mdt-notes"') && markup.indexOf('id="mdt-notes"') < markup.indexOf('</section>'));
  const tipIds = (markup.match(/<Toggletip id="mdt-tip-\w+"/g) || []).map((m) => m.slice(23, -1));
  eq('one toggletip per explained control', tipIds, ['style', 'cell', 'breaks', 'ambiguous', 'grid', 'actions', 'import', 'header', 'output']);
  const a = source.indexOf('/* ── strings:start ── */');
  const b = source.indexOf('/* ── strings:end ── */');
  const STRINGS = new Function(source.slice(a, b).replace('const STRINGS =', 'return'))();
  eq('every tip key has a toggletip', tipIds.slice().sort(), Object.keys(STRINGS.en.tips).sort());
  tipIds.forEach((id) => check('toggletip ' + id + ' shows TIPS.' + id, new RegExp('<Toggletip id="mdt-tip-' + id + '"[^>]*>\\{TIPS\\.' + id + '\\}</Toggletip>').test(markup)));
  check('no toggletip inside a label or the tablist', !/<label[^>]*>(?:(?!<\/label>)[\s\S])*<Toggletip/.test(markup) && !/role="tablist">(?:(?!<\/div>)[\s\S])*<Toggletip/.test(markup));
  check('toggletip text stays out of data-strings', source.includes('const { tips: TIPS, ...CLIENT_L } = L;') && markup.includes('data-strings={JSON.stringify(CLIENT_L)}') && !/\bT\.tips\b/.test(source.slice(e)));
  check('the grid hint moved into the grid toggletip', !/gridHint|mdt-hint/.test(source));
  // ToolLayout's Ctrl/Cmd+L empties the textareas without input events; the tool resets the table and writes the output again.
  check('Ctrl/Cmd+L resets the table, the output and the status', /e\.key !== 'l' && e\.key !== 'L'[\s\S]{0,300}table = emptyTable\(3, 3, T\.header\);[\s\S]{0,120}renderGrid\(\);\s*updateOutput\(\);\s*setStatus\(T\.cleared, 'success'\);/.test(source));
  const style = source.slice(source.indexOf('<style is:global>'));
  check('stacking breakpoint is 860px, phone details at 640px', (style.match(/@media \((?:max|min)-width: \d+px\)/g) || []).join() === '@media (max-width: 860px),@media (max-width: 640px)');
  check('a long table scrolls inside its pane', source.includes('class="mdt-grid-wrap zt-io-fill"') && source.includes('class="mdt-preview zt-io-fill"') && /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(commonStyle) && /\.mdt-grid-wrap \{ overflow: auto;/.test(style));
  check('every selector keeps the mdt- prefix', [...style.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|[\s,>+~(])\.([a-z][\w-]*)/gm)].every((m) => m[2].startsWith('mdt-') || ['btn-primary', 'btn-ghost', 'zt-tip', 'tool-label'].includes(m[2])));
  check('the actions toggletip keeps its width next to the scrolling button row', source.includes('<Toggletip id="mdt-tip-actions"') && /\.zt-tip\s*\{[^}]*flex:\s*none;/.test(commonStyle));
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('listed as a convert page', layouts.includes("'markdown-table-generator': 'convert'"));
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const mdx = readFileSync(join(root, 'src/content/tools/markdown-table-generator', lang + '.mdx'), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const body = mdx.slice(front.length + 5);
    const steps = (front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).match(/^  - "(.*)"$/gm) || []).map((x) => x.slice(5, -1));
    eq(lang + ' mdx: 5 steps in the frontmatter', steps.length, 5);
    check(lang + ' mdx: steps are plain text within the llms limits', steps.every((x) => x.length <= 280 && !/[*`"]/.test(x)) && steps.join('').length <= 1200);
    check(lang + ' mdx: no usage section in the body', !/^## (How to use|使用方法|使い方|사용 방법)\s*$/im.test(body));
    check(lang + ' mdx: the limits section stays', /^## (Limits|限制|制限|제한)\s*$/m.test(body));
  }
}

console.log(`\n${passes} passed, ${failures} failed, ${skips} skipped`);
process.exit(failures ? 1 : 0);
