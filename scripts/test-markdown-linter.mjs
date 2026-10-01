// Markdown Linter — the results quoted on the English page come from markdownlint
//
// Read:  src/components/tools/MarkdownLinterTool.astro, src/content/tools/markdown-linter/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the component calls markdownlint's `lint` with only `strings` (default rules, inline
// configuration comments allowed); the changelog and heading examples on the English page,
// formatted the way the result list and Copy Results show them; markdownlint-disable /
// -enable and -disable-next-line comments switch rules off inside the document; the rule count
// quoted in the FAQ.
//
// Run: node scripts/test-markdown-linter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lint } from 'markdownlint/promise';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownLinterTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/markdown-linter/en.mdx'), 'utf8');

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

const run = async (content) => (await lint({ strings: { content } })).content;
// The text the result list shows: rule, "L n", description — detail [context]
const shown = (i) => `${i.ruleNames[0]} L ${i.lineNumber} ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`;
// The text Copy Results writes
const copied = (i) => `L ${i.lineNumber} [${i.ruleNames[0]}] ${i.ruleDescription}${i.errorDetail ? ' — ' + i.errorDetail : ''}${i.errorContext ? ' [' + i.errorContext + ']' : ''}`;

eq('component lints with default options', /lintFn\(\{ strings: \{ content: content \} \}\)/.test(source), true);

// changelog example
const changelog = '# Changelog\n\n## 1.2.0\n\n### Added\n\n- Export button\n\n## 1.1.0\n\n### Added\n\n* Dark mode\n\nSee https://example.com/releases';
eq('page shows the changelog', page.includes(changelog), true);
eq('changelog without a final line break adds MD047', (await run(changelog)).map((i) => i.ruleNames[0]).includes('MD047'), true);
eq('changelog results', (await run(changelog + '\n')).map((i) => `L${i.lineNumber} ${i.ruleNames[0]}`), ['L13 MD004', 'L11 MD024', 'L15 MD034']);

// heading example
const headings = 'Intro paragraph\n## Setup\n#### Install\nRun `npm install`.\n```\nnpm test\n```';
eq('page shows the heading example', page.includes(headings.replace(/`/g, '\\`')), true);
const hr = await run(headings + '\n');
eq('heading example: eight results', hr.length, 8);
for (const quote of [
  shown(hr.find((i) => i.ruleNames[0] === 'MD001')),
  shown(hr.find((i) => i.ruleNames[0] === 'MD022')),
  shown(hr.find((i) => i.ruleNames[0] === 'MD041')),
  copied(hr.find((i) => i.ruleNames[0] === 'MD001')),
]) eq('page quotes ' + quote, page.includes(quote), true);
eq('MD031 and MD040 on line 5', hr.filter((i) => i.lineNumber === 5).map((i) => i.ruleNames[0]), ['MD031', 'MD040']);

// inline configuration comments
const long = 'This line is deliberately longer than eighty characters so that MD013 would normally report it.';
eq('MD013 without a comment', (await run('# Notes\n\n' + long + '\n')).map((i) => i.ruleNames[0]), ['MD013']);
eq('markdownlint-disable / -enable', await run('# Notes\n\n<!-- markdownlint-disable MD013 -->\n' + long + '\n<!-- markdownlint-enable MD013 -->\n'), []);
eq('markdownlint-disable-next-line', await run('# Notes\n\n<!-- markdownlint-disable-next-line MD034 -->\nSee https://example.com\n'), []);

// rule count in the FAQ (markdownlint enables every rule by default)
const rules = (await import(join(root, 'node_modules/markdownlint/lib/rules.mjs'))).default;
eq('FAQ rule count', page.includes('all ' + rules.length + ' of its rules'), true);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
