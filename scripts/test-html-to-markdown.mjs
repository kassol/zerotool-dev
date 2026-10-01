// HTML to Markdown — converter options, fenced code language, GFM table cells
//
// Read:  src/components/tools/HtmlToMarkdownTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers), node_modules/turndown and
//        node_modules/turndown-plugin-gfm, public/vendor/turndown*.js
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the page loads the same turndown / turndown-plugin-gfm code as node_modules
// (whitespace-insensitive compare), so running the engine with the npm packages tests the
// shipped behaviour; ATX headings, `-` bullets, `*` emphasis, `* * *` rules, fenced code with
// the language from `language-*`; a literal | in a table cell is escaped as \| and a line
// break in a cell becomes <br> (both used to split the row); tables without a header row are
// kept as HTML; the examples on the English tool page.
//
// Run: node scripts/test-html-to-markdown.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/HtmlToMarkdownTool.astro'), 'utf8');

const startIndex = source.indexOf('// engine:start');
const endIndex = source.indexOf('// engine:end');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlToMarkdownTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const createConverter = new Function(block + '\nreturn createConverter;')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail ? '\n  ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

const squash = (s) => s.replace(/\s+/g, '');
check('vendor turndown is the npm browser build',
  squash(readFileSync(join(root, 'public/vendor/turndown.umd.js'), 'utf8')) ===
  squash(readFileSync(join(root, 'node_modules/turndown/lib/turndown.browser.umd.js'), 'utf8')));
check('vendor turndown-plugin-gfm is the npm build',
  squash(readFileSync(join(root, 'public/vendor/turndown-plugin-gfm.js'), 'utf8')) ===
  squash(readFileSync(join(root, 'node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js'), 'utf8')));

const td = createConverter(require('turndown'), require('turndown-plugin-gfm'));
const md = (html) => td.turndown(html);

// ---------- options ----------
eq('atx heading', md('<h1>Title</h1>'), '# Title');
eq('bullet marker and nested list',
  md('<ul><li>Step one</li><li>Step two<ul><li>Sub step</li></ul></li></ul><ol start="3"><li>Third</li><li>Fourth</li></ol>'),
  '-   Step one\n-   Step two\n    -   Sub step\n\n3.  Third\n4.  Fourth');
eq('emphasis', md('<p><strong>b</strong> <em>i</em></p>'), '**b** *i*');
eq('horizontal rule keeps the turndown default', md('<hr>'), '* * *');
eq('br is two spaces + newline', md('line one<br>line two'), 'line one  \nline two');
eq('markdown characters in text are escaped', md('<p>5 * 3, _a_</p>'), '5 \\* 3, \\_a\\_');
eq('link with title', md('<h2>Install</h2><p>Run <code>npm i turndown</code> and see the <a href="https://github.com/mixmark-io/turndown" title="repo">README</a>.</p>'),
  '## Install\n\nRun `npm i turndown` and see the [README](https://github.com/mixmark-io/turndown "repo").');
eq('image', md('<img src="a.png" alt="Logo">'), '![Logo](a.png)');
eq('del is not converted (strikethrough plugin not loaded)', md('<p><del>old</del> new</p>'), 'old new');

// ---------- code ----------
eq('fenced code with language', md('<pre><code class="language-python">print("hi")\n</code></pre>'), '```python\nprint("hi")\n```');
eq('fenced code without language', md('<pre><code>x = 1</code></pre>'), '```\nx = 1\n```');
eq('pre without code is not fenced', md('<pre>a\n  b</pre>'), 'a\n  b');

// ---------- tables ----------
eq('header table', md('<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Alice</td><td>Engineer</td></tr></tbody></table>'),
  '| Name | Role |\n| --- | --- |\n| Alice | Engineer |');
eq('pipe in a cell is escaped', md('<table><tr><th>Flag</th><th>Meaning</th></tr><tr><td><code>a|b</code></td><td>x | y</td></tr></table>'),
  '| Flag | Meaning |\n| --- | --- |\n| `a\\|b` | x \\| y |');
eq('br in a cell becomes <br>', md('<table><tr><th>H</th></tr><tr><td>line<br>break</td></tr></table>'),
  '| H |\n| --- |\n| line<br>break |');
eq('first cell prefix', md('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'),
  '| A | B |\n| --- | --- |\n| 1 | 2 |');
eq('table without header row stays HTML', md('<table><tr><td>A</td></tr></table>'),
  '<table><tbody><tr><td>A</td></tr></tbody></table>');

// ---------- page example ----------
eq('page example: release notes table',
  md('<table><thead><tr><th>Option</th><th>Values</th></tr></thead><tbody><tr><td><code>--format</code></td><td>json | yaml<br>default: json</td></tr></tbody></table>'),
  '| Option | Values |\n| --- | --- |\n| `--format` | json \\| yaml<br>default: json |');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
