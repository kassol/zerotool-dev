// Markdown TOC Generator — anchors match each platform's heading-id rules
//
// Read:  src/components/tools/MarkdownTocGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), node_modules/github-slugger,
//        src/content/tools/markdown-toc-generator/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// References (not hand-written rules):
//   - GitHub: github-slugger 2.0.0 (`GithubSlugger#slug`, also used by Astro and rehype-slug),
//     run over a heading corpus and over every BMP code point.
//   - GitLab: the examples in the GitLab docs, "Heading anchors" (GitLab 17.0+ rules).
//   - Jekyll (kramdown-parser-gfm 1.1.0, Jekyll's default `input: GFM`) and kramdown
//     (kramdown 2.5.2, `input: kramdown`): the ids below were produced by running those gems
//     (Ruby 2.6.10) on the same corpus; see KRAMDOWN_IDS.
//   - Bitbucket Cloud: the `markdown-header-` prefix (Atlassian issue BCLOUD-8276).
// Defects covered (before the fix): Bitbucket prefix `markdown-`; GitHub style deleted "_",
// collapsed runs of spaces and trimmed hyphens; GitLab style collapsed "--" (GitLab 17.0+ does
// not); Jekyll style dropped non-ASCII (Jekyll's GFM parser keeps it) and never produced
// "section"; ids were de-duplicated only among headings inside the chosen level range;
// "a", "a-1", "a" gave a duplicate id; `## C#` lost its "#".
//
// Run: node scripts/test-markdown-toc-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import GithubSlugger, { slug as githubSlug } from 'github-slugger';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MarkdownTocGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MarkdownTocGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { parseHeadings, slugify, dedupe, renderTOC };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const ids = (titles, style) => E.dedupe(titles.map((t) => E.slugify(t, style)), style);

const CORPUS = ['Getting Started', 'Getting Started', 'Install', 'Install-1', 'Install', 'Héllo, World! 中文', 'API_v2 & config.yml', '1. Intro', 'Spaces  around', '!!!', 'Ⓐ circled', 'Ünïcödé — dash', 'C++ / C#', '日本語の見出し', '한국어 제목', 'Tab\there', 'emoji 🚀 launch', "Q&A: what's new?", 'Install'];

// kramdown 2.5.2 + kramdown-parser-gfm 1.1.0 on Ruby 2.6.10, `## <title>` per line, ids read
// from to_html (null = no id attribute).
const KRAMDOWN_IDS = {
  gfm: ['getting-started', 'getting-started-1', 'install', 'install-1', 'install-1', 'héllo-world-中文', 'api_v2--configyml', '1-intro', 'spaces--around', null, 'ⓐ-circled', 'ünïcödé--dash', 'c--c', '日本語の見出し', '한국어-제목', 'tab-here', 'emoji--launch', 'qa-whats-new', 'install-2'],
  kramdown: ['getting-started', 'getting-started-1', 'install', 'install-1', 'install-1', 'hllo-world-', 'apiv2--configyml', 'intro', 'spaces--around', 'section', 'circled', 'ncd--dash', 'c--c', 'section-1', 'section-2', 'tabhere', 'emoji--launch', 'qa-whats-new', 'install-2'],
};

// ── 1. GitHub against github-slugger ──
{
  const slugger = new GithubSlugger();
  eq('github ids for the corpus', ids(CORPUS, 'github'), CORPUS.map((t) => slugger.slug(t)));
  const s2 = new GithubSlugger();
  const tricky = ['a', 'a-1', 'a', 'a', 'a-2', 'A', '_x_', ' lead', 'trail ', 'two  spaces', '--', ''];
  eq('github de-duplication matches github-slugger', ids(tricky, 'github'), tricky.map((t) => s2.slug(t)));
  // Every BMP code point: github-slugger 2.0.0's table predates Unicode 14, so the only allowed
  // difference is a letter / mark / digit that the tool keeps and the old table drops.
  let bad = 0; let newer = 0; let firstBad = '';
  for (let cp = 0; cp <= 0xFFFF; cp++) {
    if (cp >= 0xD800 && cp <= 0xDFFF) continue;
    const ch = String.fromCodePoint(cp);
    const a = E.slugify('x' + ch + 'y', 'github');
    const b = githubSlug('x' + ch + 'y');
    if (a === b) continue;
    if (b === 'xy' && /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}]/u.test(ch)) { newer++; continue; }
    bad++;
    if (!firstBad) firstBad = 'U+' + cp.toString(16) + ' tool ' + a + ' slugger ' + b;
  }
  check('github: every BMP code point matches github-slugger (except characters newer than its table)', bad === 0, bad + ' differ, first ' + firstBad);
  check('github: characters newer than github-slugger\'s table stay under 200', newer < 200, String(newer));
}

// ── 2. GitLab docs example ──
eq('gitlab docs example', ids([
  'This heading has spaces in it',
  'This heading has a :thumbsup: in it',
  'This heading has Unicode in it: 한글',
  'This heading has spaces in it',
  'This heading has spaces in it',
  'This heading has 3.5 in it (and parentheses)',
  'This heading has  multiple spaces and --- hyphens_and_underscores',
], 'gitlab'), [
  'this-heading-has-spaces-in-it',
  'this-heading-has-a-thumbsup-in-it',
  'this-heading-has-unicode-in-it-한글',
  'this-heading-has-spaces-in-it-1',
  'this-heading-has-spaces-in-it-2',
  'this-heading-has-35-in-it-and-parentheses',
  'this-heading-has--multiple-spaces-and-----hyphens_and_underscores',
]);

// ── 3. Jekyll (GFM) and kramdown against the gems' output ──
const jek = ids(CORPUS, 'jekyll');
eq('jekyll (kramdown GFM) ids', jek.map((x) => (x === '' ? null : x)), KRAMDOWN_IDS.gfm);
eq('kramdown ids', ids(CORPUS, 'kramdown'), KRAMDOWN_IDS.kramdown);

// ── 4. Bitbucket ──
eq('bitbucket prefix', ids(['Getting Started', 'Getting Started'], 'bitbucket'), ['markdown-header-getting-started', 'markdown-header-getting-started_1']);

// ── 5. heading parser ──
eq('ATX closing sequence needs a space', E.parseHeadings('## C#\n## Title ##\n##No space\n   ### Indented\n    #### Code').map((h) => h.text), ['C#', 'Title', 'Indented']);
eq('setext and fences', E.parseHeadings('Top\n===\n\n```\n# not\n```\nSub\n---').map((h) => [h.level, h.text]), [[1, 'Top'], [2, 'Sub']]);

// ── 6. ids count all headings, not just the ones in the TOC ──
{
  const md = '# Setup\n## Setup\n### Setup\n## Usage\n#### Setup';
  const toc = E.renderTOC(E.parseHeadings(md), { minLevel: 2, maxLevel: 3, includeH1: true, bullet: '-', indent: '2', style: 'github' });
  eq('level range does not reset de-duplication', toc, '- [Setup](#setup-1)\n  - [Setup](#setup-2)\n- [Usage](#usage)');
}
{
  const toc = E.renderTOC(E.parseHeadings('## A_b c\n## A_b c'), { minLevel: 1, maxLevel: 6, includeH1: true, bullet: '-', indent: '2', style: 'gitlab' });
  eq('gitlab keeps underscores and de-duplicates', toc, '- [A_b c](#a_b-c)\n- [A_b c](#a_b-c-1)');
}

// ── 7. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/markdown-toc-generator', lang + '.mdx'), 'utf8');
  check(lang + ': page uses the markdown-header- prefix for Bitbucket', mdx.includes("markdown-header-") && !/#markdown-(?!header-)|<code>markdown-<\/code>/.test(mdx), lang);
  check(lang + ': page has 2 annotated TOC examples', [...mdx.matchAll(/\{\/\* mtoc: /g)].length === 2, lang);
  for (const m of mdx.matchAll(/\{\/\* mtoc: (\{.*?\}) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)) {
    const spec = JSON.parse(m[1]);
    const toc = E.renderTOC(E.parseHeadings(spec.md), Object.assign({ minLevel: 1, maxLevel: 6, includeH1: true, bullet: '-', indent: '2', style: 'github' }, spec.opts || {}));
    eq(lang + ': example ' + (spec.opts && spec.opts.style || 'github'), m[2].trim(), toc);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
