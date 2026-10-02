// Markdown Table Generator — record how GitHub, Zenn and Qiita render the generator's output
//
// Read:  src/components/tools/MarkdownTableGeneratorTool.astro (engine block between the
//        `engine:start` / `engine:end` markers)
// Write: scripts/test-markdown-table-generator.fixtures.json
// Net:   POST https://api.github.com/markdown (unauthenticated, mode "markdown" = how .md files
//        render) and POST https://gitee.com/api/v5/markdown (unauthenticated), one request per case
// Needs: --zenn-dir <dir>  a directory whose node_modules has zenn-markdown-html
//        (the 2026-10-02 run used zenn-markdown-html 0.5.4, which bundles markdown-it 14.3.2)
//        --qiita           run qiita_marker in Docker (`ruby:3.3` image; 2026-10-02: qiita_marker 0.23.9.0)
//
// Each case is a table and output options. The fixture stores the Markdown the engine wrote and the
// HTML each platform returned, so the test can check that (1) the engine still writes the same
// Markdown and (2) every platform shows each cell as the expected text.
//
// Run: node scripts/gen-markdown-table-generator-fixtures.mjs --zenn-dir /tmp/zenn --qiita

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownTableGeneratorTool.astro'), 'utf8');
const s = source.indexOf('/* ── engine:start ── */');
const e = source.indexOf('/* ── engine:end ── */');
const E = new Function(source.slice(s, e) + '\nreturn { buildMarkdown };')();

const args = process.argv.slice(2);
const zennDir = args[args.indexOf('--zenn-dir') + 1];
const useQiita = args.includes('--qiita');
if (!args.includes('--zenn-dir') || !zennDir) { console.error('usage: --zenn-dir <dir> [--qiita]'); process.exit(1); }

const plain = { style: 'aligned', plain: true, newline: 'br', ambiguousWide: false };
const md = { style: 'aligned', plain: false, newline: 'br', ambiguousWide: false };
const t = (headers, rows, align) => ({ headers, rows, align: align || headers.map(() => 'none') });

// expect: the text each cell should show (header row first). Omitted = the cells themselves.
const CASES = [
  { name: 'plain punctuation', opts: plain, table: t(['Pattern', 'Meaning'], [
    ['a|b', 'pipe'], ['C:\\Users\\me\\', 'Windows path ending in a backslash'], ['x\\|y', 'backslash then pipe'],
    ['5*3*2', 'asterisks'], ['_id', 'leading underscore'], ['snake_case_name', 'underscores inside a word'],
    ['`code`', 'backticks'], ['~/.ssh', 'tilde'], ['[link](x)', 'brackets'], ['<b>bold</b>', 'raw HTML'],
    ['&copy; &amp; &#169;', 'entity references'], ['AT&T', 'ampersand'], ['$5 and $10', 'dollar signs'], ['a\\b', 'lone backslash'],
  ]) },
  { name: 'plain line breaks', opts: plain, table: t(['Key', 'Value'], [['multi', 'line one\nline two'], ['ends with backslash', 'a\\\nb'], ['tab', 'a\tb']]),
    expect: [['Key', 'Value'], ['multi', 'line one\nline two'], ['ends with backslash', 'a\\\nb'], ['tab', 'a b']] },
  { name: 'markdown cells', opts: md, table: t(['Syntax', 'Cell'], [
    ['bold', '**strong**'], ['code with pipe', '`a|b`'], ['escaped pipe', 'a\\|b'], ['backslash pipe', 'a\\\\|b'], ['link', '[ZeroTool](https://zerotool.dev/)'],
  ]), expect: [['Syntax', 'Cell'], ['bold', 'strong'], ['code with pipe', 'a|b'], ['escaped pipe', 'a|b'], ['backslash pipe', 'a\\|b'], ['link', 'ZeroTool']] },
  { name: 'cjk and emoji, aligned', opts: md, table: t(['項目', '説明', '数'], [['東京', '本社 🏢', '120'], ['대한민국', '서울特別市', '7'], ['○ × ①', 'ambiguous width', '3']], ['left', 'center', 'right']) },
  { name: 'compact', opts: { style: 'compact', plain: false, newline: 'space', ambiguousWide: false }, table: t(['a', 'b'], [['1', 'x\ny'], ['', '']], ['none', 'right']),
    expect: [['a', 'b'], ['1', 'x y'], ['', '']] },
];

// Markdown not written by the engine, kept to document how the renderers differ.
const FOREIGN = [
  { name: 'two backslashes before a pipe', markdown: '| a | b |\n|---|---|\n| x\\\\|y | 2 |' },
  { name: 'pipe inside code without a backslash', markdown: '| a |\n|---|\n| `x|y` |' },
  { name: 'row longer than the header', markdown: '| a |\n|---|\n| 1 | 2 | 3 |' },
  { name: 'header and delimiter cell counts differ', markdown: '| a | b |\n|---|\n| 1 | 2 |' },
  { name: 'table right after a paragraph line', markdown: 'Some text\n| a | b |\n|---|---|\n| 1 | 2 |' },
  { name: 'CJK punctuation next to **', markdown: '| a |\n|---|\n| **注意：**ここ |' },
];

async function github(text) {
  const res = await fetch('https://api.github.com/markdown', {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'zerotool-fixture' },
    body: JSON.stringify({ text, mode: 'markdown' }),
  });
  if (!res.ok) throw new Error('GitHub API ' + res.status + ' ' + (await res.text()));
  return res.text();
}

async function gitee(text) {
  const res = await fetch('https://gitee.com/api/v5/markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('Gitee API ' + res.status + ' ' + (await res.text()));
  return JSON.parse(await res.text());
}

const zennPkg = JSON.parse(readFileSync(join(zennDir, 'node_modules/zenn-markdown-html/package.json'), 'utf8'));
const zennMod = await import(pathToFileURL(join(zennDir, 'node_modules/zenn-markdown-html', zennPkg.main)).href);
const zennRender = zennMod.default?.default || zennMod.default || zennMod;
const zennVersion = zennPkg.version;
const mdItVersion = JSON.parse(readFileSync(join(zennDir, 'node_modules/zenn-markdown-html/node_modules/markdown-it/package.json'), 'utf8')).version;

function qiitaRenderAll(texts) {
  const dir = mkdtempSync(join(tmpdir(), 'mdt-qiita-'));
  try {
    writeFileSync(join(dir, 'in.json'), JSON.stringify(texts));
    writeFileSync(join(dir, 'r.rb'), [
      "require 'json'", "require 'qiita_marker'",
      "texts = JSON.parse(File.read('in.json'))",
      "out = texts.map { |t| QiitaMarker.render_html(t, [:UNSAFE], [:table, :strikethrough, :autolink]) }",
      "puts JSON.generate({ 'version' => Gem.loaded_specs['qiita_marker'].version.to_s, 'html' => out })",
    ].join('\n'));
    const outText = execFileSync('docker', ['run', '--rm', '-v', dir + ':/w', '-w', '/w', 'ruby:3.3', 'sh', '-c', 'gem install qiita_marker -v 0.23.9.0 >/dev/null 2>&1 && ruby r.rb'], { encoding: 'utf8' });
    return JSON.parse(outText.trim().split('\n').pop());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const cases = [];
for (const c of CASES) {
  const markdown = E.buildMarkdown(c.table, c.opts).markdown;
  cases.push({ name: c.name, table: c.table, opts: c.opts, markdown, expect: c.expect || [c.table.headers].concat(c.table.rows) });
}
const foreign = FOREIGN.map((f) => ({ ...f }));
const all = cases.concat(foreign);
for (const item of all) {
  item.github = await github(item.markdown);
  item.gitee = await gitee(item.markdown);
  item.zenn = String(await zennRender(item.markdown));
}
let qiitaVersion = null;
if (useQiita) {
  const q = qiitaRenderAll(all.map((x) => x.markdown));
  qiitaVersion = q.version;
  all.forEach((x, i) => { x.qiita = q.html[i]; });
}

const fixture = {
  recorded: new Date().toISOString().slice(0, 10),
  renderers: { github: 'api.github.com/markdown mode=markdown', gitee: 'gitee.com/api/v5/markdown', zenn: 'zenn-markdown-html ' + zennVersion + ' (markdown-it ' + mdItVersion + ')', qiita: qiitaVersion ? 'qiita_marker ' + qiitaVersion : null },
  cases,
  foreign,
};
writeFileSync(join(root, 'scripts/test-markdown-table-generator.fixtures.json'), JSON.stringify(fixture, null, 1) + '\n');
console.log('wrote', cases.length, 'cases and', foreign.length, 'foreign samples');
