// IndexNow release submission — URL mapping and key file test
//
// Read:  scripts/indexnow-urls.mjs (imported), src/components/tools/registry.ts,
//        src/data/tools.ts, public/{key}.txt, public/_routes.json, public/_redirects,
//        astro.config.mjs, dist/sitemap-index.xml + dist/sitemap-*.xml (run
//        `npm run build` first)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: changed source file → page paths (tool mdx → one language page, tool
// component → 4 language pages via registry.ts, tools.ts / registry.ts → the slugs
// whose line changed, blog mdx → one post, static pages, dynamic route templates and
// layouts / i18n / styles / shared components → "global", files that do not render
// pages → ignored); the dist sitemap as the final filter (draft, noindex and 301'd
// blog URLs drop out); global changes add all sitemap URLs only with `all`; previous
// tag selection; batching at 10,000; status code meanings; request body; key format
// and key file served as a static asset (not routed to Functions, not redirected).
//
// Run: node scripts/test-indexnow-urls.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SITE,
  INDEXNOW_KEY,
  KEY_LOCATION,
  MAX_URLS_PER_POST,
  toolPath,
  diffKeyedLines,
  parseToolsLines,
  parseRegistryLines,
  componentSlugMap,
  mapChangedFiles,
  selectUrls,
  parseSitemapLocs,
  previousTag,
  chunk,
  requestBody,
  describeStatus,
  blogState,
  toolState,
  pageSource,
  parseRedirects,
  redirectTarget,
  redirectMatches,
  retiredUrls,
} from './indexnow-urls.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const sorted = (iter) => [...iter].sort();

// ── Key ──────────────────────────────────────────────────────────────────────
check('key is 8–128 chars of a-z A-Z 0-9 -', /^[a-zA-Z0-9-]{8,128}$/.test(INDEXNOW_KEY), INDEXNOW_KEY);
equal('key location is the site root', KEY_LOCATION, `${SITE}/${INDEXNOW_KEY}.txt`);
const keyFile = join(root, 'public', `${INDEXNOW_KEY}.txt`);
check('public/{key}.txt exists', existsSync(keyFile));
if (existsSync(keyFile)) {
  equal('key file content is exactly the key', readFileSync(keyFile, 'utf8'), INDEXNOW_KEY);
}
const otherKeyFiles = readdirSync(join(root, 'public')).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f) && f !== `${INDEXNOW_KEY}.txt`);
equal('no stale key files in public/', otherKeyFiles, []);

const routes = JSON.parse(readFileSync(join(root, 'public/_routes.json'), 'utf8'));
check('_routes.json excludes the key file from Functions', routes.exclude.includes(`/${INDEXNOW_KEY}.txt`));

check('redirect matcher sanity', redirectMatches('/blog/*', '/blog/x/') && !redirectMatches('/blog/*', '/x.txt') && redirectMatches('/:a.txt', '/k.txt'));
// dist/_redirects = public/_redirects + rules appended by generate-blog-redirects.mjs.
for (const file of ['public/_redirects', 'dist/_redirects']) {
  if (!existsSync(join(root, file))) continue;
  const sources = readFileSync(join(root, file), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
  equal(`no ${file} rule matches the key file`, sources.filter((s) => redirectMatches(s, `/${INDEXNOW_KEY}.txt`)), []);
}
const distRoutes = join(root, 'dist/_routes.json');
if (existsSync(distRoutes)) {
  check('dist/_routes.json excludes the key file', JSON.parse(readFileSync(distRoutes, 'utf8')).exclude.includes(`/${INDEXNOW_KEY}.txt`));
  equal('dist key file is a copy of public', readFileSync(join(root, 'dist', `${INDEXNOW_KEY}.txt`), 'utf8'), INDEXNOW_KEY);
}

const astroConfig = readFileSync(join(root, 'astro.config.mjs'), 'utf8');
check('SITE matches astro.config.mjs', astroConfig.includes(`const SITE = '${SITE}';`));

// ── Paths ────────────────────────────────────────────────────────────────────
equal('toolPath en', toolPath('base64', 'en'), '/tools/base64/');
equal('toolPath ja', toolPath('base64', 'ja'), '/ja/tools/base64/');

// ── Keyed line diff (tools.ts / registry.ts keep one entry per line) ─────────
const toolsOld = [
  'export type Lang = \'en\';',
  'export const allTools = [',
  "  { slug: 'a', translations: { en: { name: 'A' } }, category: 'dev' },",
  "  { slug: 'b', translations: { en: { name: 'B' } }, category: 'dev' },",
  "  { slug: 'c', translations: { en: { name: 'C' } }, category: 'dev' },",
  '];',
].join('\n');
const toolsOnlyB = toolsOld.replace("name: 'B'", "name: 'B2'");
equal('tools.ts: one entry changed → that slug only', diffKeyedLines(toolsOld, toolsOnlyB, parseToolsLines), { keys: ['b'], other: false });
const toolsAddRemove = toolsOld.replace(/\n.*slug: 'c'.*\n/, "\n  { slug: 'd', translations: { en: { name: 'D' } }, category: 'dev' },\n");
equal('tools.ts: added and removed entries', diffKeyedLines(toolsOld, toolsAddRemove, parseToolsLines), { keys: ['c', 'd'], other: false });
const toolsReordered = toolsOld.replace(/(\n.*slug: 'a'.*)(\n.*slug: 'b'.*)/, '$2$1');
equal('tools.ts: reorder only is not a per-slug change but still reported as other', diffKeyedLines(toolsOld, toolsReordered, parseToolsLines), { keys: [], other: true });
const toolsHeader = toolsOld.replace("Lang = 'en'", "Lang = 'en' | 'zh'");
equal('tools.ts: change outside entries → other', diffKeyedLines(toolsOld, toolsHeader, parseToolsLines), { keys: [], other: true });
equal('tools.ts: file added (no old source)', diffKeyedLines(null, toolsOld, parseToolsLines), { keys: ['a', 'b', 'c'], other: true });
equal('tools.ts: unchanged', diffKeyedLines(toolsOld, toolsOld, parseToolsLines), { keys: [], other: false });

const regOld = "export const toolComponentFiles = {\n  'a': 'ATool',\n  'b': 'BTool',\n};\n";
const regNew = "export const toolComponentFiles = {\n  'a': 'ATool',\n  'b': 'BNewTool',\n};\n";
equal('registry.ts: renamed component → that slug', diffKeyedLines(regOld, regNew, parseRegistryLines), { keys: ['b'], other: false });

const realRegistry = readFileSync(join(root, 'src/components/tools/registry.ts'), 'utf8');
const realTools = readFileSync(join(root, 'src/data/tools.ts'), 'utf8');
const regMap = parseRegistryLines(realRegistry);
const toolMap = parseToolsLines(realTools);
check('real registry.ts parses (>100 entries)', regMap.size > 100, String(regMap.size));
equal('real tools.ts slugs == registry.ts slugs', sorted(toolMap.keys()), sorted(regMap.keys()));
equal('real registry: markdown-to-word', regMap.get('markdown-to-word'), "  'markdown-to-word': 'MarkdownToWordTool',");

// ── Component → slugs ───────────────────────────────────────────────────────
const compSlugs = componentSlugMap(realRegistry);
equal('component reverse lookup', compSlugs.get('MarkdownToWordTool'), ['markdown-to-word']);
const twoSlugs = componentSlugMap("  'x': 'SharedTool',\n  'y': 'SharedTool',\n");
equal('component used by two slugs → both', twoSlugs.get('SharedTool'), ['x', 'y']);

// ── mapChangedFiles ─────────────────────────────────────────────────────────
function ctx(extra = {}) {
  return { componentSlugs: compSlugs, keyedDiffs: {}, ...extra };
}
{
  const r = mapChangedFiles(['src/content/tools/base64/ja.mdx', 'src/content/tools/base64/en.mdx'], ctx());
  equal('tool mdx → that language page', sorted(r.paths), ['/ja/tools/base64/', '/tools/base64/']);
  equal('tool mdx is not global', r.global, []);
}
{
  const r = mapChangedFiles(['src/content/tools/base64/diagram.png'], ctx());
  equal('other file in a tool content dir → 4 languages', sorted(r.paths), sorted(['en', 'zh', 'ja', 'ko'].map((l) => toolPath('base64', l))));
}
{
  const r = mapChangedFiles(['src/components/tools/MarkdownToWordTool.astro'], ctx());
  equal('tool component → 4 language pages', sorted(r.paths), sorted(['/tools/markdown-to-word/', '/zh/tools/markdown-to-word/', '/ja/tools/markdown-to-word/', '/ko/tools/markdown-to-word/']));
}
{
  const r = mapChangedFiles(['src/components/tools/NotInRegistryTool.astro'], ctx());
  equal('component not in registry → global', r.global, ['src/components/tools/NotInRegistryTool.astro']);
  equal('component not in registry → no paths', r.paths.size, 0);
}
{
  const r = mapChangedFiles(['src/data/tools.ts'], ctx({ keyedDiffs: { 'src/data/tools.ts': { keys: ['base64'], other: false } } }));
  equal('tools.ts one slug → 4 language pages', r.paths.size, 4);
  check('tools.ts one slug → ja page', r.paths.has('/ja/tools/base64/'));
  equal('tools.ts one slug → not global', r.global, []);
}
{
  const r = mapChangedFiles(['src/data/tools.ts'], ctx({ keyedDiffs: { 'src/data/tools.ts': { keys: ['base64'], other: true } } }));
  equal('tools.ts change outside entries → global', r.global, ['src/data/tools.ts']);
  equal('tools.ts change outside entries still maps the changed slug', r.paths.size, 4);
}
{
  const r = mapChangedFiles(['src/components/tools/registry.ts'], ctx({ keyedDiffs: { 'src/components/tools/registry.ts': { keys: ['base64'], other: false } } }));
  equal('registry.ts one slug → 4 language pages', r.paths.size, 4);
}
{
  const r = mapChangedFiles(['src/content/blog/csv-json-guide/zh.mdx', 'src/content/blog/aes-encrypt-decrypt-guide/en.mdx'], ctx());
  equal('blog mdx → that post', sorted(r.paths), ['/blog/aes-encrypt-decrypt-guide/', '/zh/blog/csv-json-guide/']);
}
{
  const r = mapChangedFiles(['src/content/blog/aes-encrypt-decrypt-guide/cover.png'], ctx());
  equal('other file in a blog dir → 4 languages', r.paths.size, 4);
}
{
  const r = mapChangedFiles(['src/pages/about.astro', 'src/pages/ja/about.astro', 'src/pages/index.astro', 'src/pages/ko/index.astro', 'src/pages/tools/index.astro', 'src/pages/zh/blog/index.astro'], ctx());
  equal('static pages', sorted(r.paths), sorted(['/about/', '/ja/about/', '/', '/ko/', '/tools/', '/zh/blog/']));
}
{
  const files = [
    'src/pages/blog/[slug].astro',
    'src/layouts/BaseLayout.astro',
    'src/layouts/ToolLayout.astro',
    'src/components/SEO.astro',
    'src/components/ToolPage.astro',
    'src/i18n/en.json',
    'src/styles/tool-common.css',
    'src/data/network.ts',
    'src/content/config.ts',
    'astro.config.mjs',
  ];
  const r = mapChangedFiles(files, ctx());
  equal('templates, layouts, i18n, styles, shared components → global', r.global, files);
  equal('global files add no paths by themselves', r.paths.size, 0);
}
{
  const files = [
    'AGENTS.md',
    'src/AGENTS.md',
    'src/data/AGENTS.md',
    'scripts/test-markdown-to-word.mjs',
    'package.json',
    'package-lock.json',
    '.github/workflows/deploy.yml',
    'docs/spec.md',
    'public/_redirects',
    'public/vendor/protobuf.min.js',
    'README.md',
  ];
  const r = mapChangedFiles(files, ctx());
  equal('files that do not render pages → ignored', r.ignored, files);
  equal('ignored files → no paths, not global', [r.paths.size, r.global.length], [0, 0]);
}

// ── selectUrls: sitemap is the final filter ─────────────────────────────────
{
  const sitemap = [`${SITE}/`, `${SITE}/tools/base64/`, `${SITE}/ja/tools/base64/`, `${SITE}/blog/x-guide/`];
  const paths = new Set(['/tools/base64/', '/ja/tools/base64/', '/zh/blog/x-guide/', '/blog/gone-guide/']);
  const r = selectUrls({ paths, global: [], sitemapUrls: sitemap, all: false });
  equal('only sitemap URLs, sorted, absolute', r.urls, [`${SITE}/ja/tools/base64/`, `${SITE}/tools/base64/`]);
  equal('paths not in sitemap are reported', r.notInSitemap, ['/blog/gone-guide/', '/zh/blog/x-guide/']);
  equal('no global → full not used', r.full, false);

  const g = selectUrls({ paths, global: ['src/layouts/BaseLayout.astro'], sitemapUrls: sitemap, all: false });
  equal('global without all → mapped URLs only', g.urls.length, 2);
  equal('global without all → full not used', g.full, false);

  const a = selectUrls({ paths, global: ['src/layouts/BaseLayout.astro'], sitemapUrls: sitemap, all: true });
  equal('all → every sitemap URL', a.urls, [...sitemap].sort());
  equal('all → full used', a.full, true);

  const dup = selectUrls({ paths: new Set(['/tools/base64/']), global: [], sitemapUrls: [...sitemap, `${SITE}/tools/base64/`], all: true });
  equal('duplicates in sitemap are removed', dup.urls.length, 4);
}

// ── Sitemap parsing ──────────────────────────────────────────────────────────
equal('parseSitemapLocs', parseSitemapLocs('<urlset><url><loc>https://a/x/</loc></url><url><loc> https://a/y/ </loc><xhtml:link href="https://a/z/"/></url></urlset>'), ['https://a/x/', 'https://a/y/']);
equal('parseSitemapLocs decodes &amp;', parseSitemapLocs('<loc>https://a/?p=1&amp;q=2</loc>'), ['https://a/?p=1&q=2']);

// Real dist sitemap: draft, noindex and 301'd blog URLs are not in it, so mapping
// their mdx files submits nothing.
const indexPath = join(root, 'dist/sitemap-index.xml');
check('dist/sitemap-index.xml exists (run npm run build first)', existsSync(indexPath));
if (existsSync(indexPath)) {
  const sitemapUrls = parseSitemapLocs(readFileSync(indexPath, 'utf8'))
    .flatMap((loc) => parseSitemapLocs(readFileSync(join(root, 'dist', new URL(loc).pathname), 'utf8')));
  check('dist sitemap has URLs', sitemapUrls.length > 500, String(sitemapUrls.length));
  check('dist sitemap URLs are all on SITE', sitemapUrls.every((u) => u.startsWith(SITE + '/')));
  const r = mapChangedFiles([
    'src/content/blog/json-formatter-guide/en.mdx',      // draft: true, 301 to /tools/json-formatter/
    'src/content/blog/aes-encrypt-decrypt-guide/zh.mdx', // noindex: true
    'src/content/blog/aes-encrypt-decrypt-guide/en.mdx', // indexable
    'src/content/tools/markdown-to-word/ko.mdx',
  ], ctx());
  const s = selectUrls({ paths: r.paths, global: r.global, sitemapUrls, all: false });
  equal('real sitemap: draft, noindex and 301 drop out', s.urls, [`${SITE}/blog/aes-encrypt-decrypt-guide/`, `${SITE}/ko/tools/markdown-to-word/`]);
  equal('real sitemap: dropped paths reported', s.notInSitemap, ['/blog/json-formatter-guide/', '/zh/blog/aes-encrypt-decrypt-guide/']);
  check('real sitemap: key file is not in sitemap', !sitemapUrls.includes(KEY_LOCATION));
  check('real sitemap: fewer URLs than one POST allows', sitemapUrls.length <= MAX_URLS_PER_POST);
}

// ── Pages removed from the index this release (draft / 301, noindex, deleted) ─
equal('blogState: file missing', blogState(null), 'missing');
equal('blogState: draft', blogState('---\ntitle: x\ndraft: true\n---\nbody'), 'draft');
equal('blogState: draft wins over noindex', blogState('---\ndraft: true\nnoindex: true\n---\n'), 'draft');
equal('blogState: noindex', blogState('---\nnoindex: true\n---\n'), 'noindex');
equal('blogState: indexable', blogState('---\ntitle: x\n---\nnoindex: true in body'), 'indexable');
equal('toolState', [toolState('a', regOld), toolState('z', regOld), toolState('a', null)], ['live', 'missing', 'missing']);

equal('pageSource: en blog', pageSource('/blog/x-guide/'), { kind: 'blog', file: 'src/content/blog/x-guide/en.mdx' });
equal('pageSource: zh blog', pageSource('/zh/blog/x-guide/'), { kind: 'blog', file: 'src/content/blog/x-guide/zh.mdx' });
equal('pageSource: ja tool', pageSource('/ja/tools/base64/'), { kind: 'tool', slug: 'base64' });
equal('pageSource: static page', pageSource('/about/'), null);
equal('pageSource: blog index', pageSource('/blog/'), null);

const rules = parseRedirects([
  '# comment',
  '/blog/a-guide /tools/a/ 301',
  '/blog/a-guide/ /tools/a/ 301',
  '/zh/blog/a-guide/ /zh/tools/a/ 301',
  '/old/* /new/:splat 301',
  '',
].join('\n'));
equal('parseRedirects skips comments and blanks', rules.length, 4);
equal('redirectTarget: canonical path', redirectTarget('/blog/a-guide/', rules), '/tools/a/');
equal('redirectTarget: splat rule', redirectTarget('/old/x/', rules), '/new/:splat');
equal('redirectTarget: none', redirectTarget('/ja/blog/a-guide/', rules), null);

{
  const states = new Map([
    ['/blog/a-guide/', { from: 'indexable', to: 'draft' }],        // merged into tool, 301
    ['/zh/blog/a-guide/', { from: 'noindex', to: 'draft' }],        // noindex page now 301
    ['/ja/blog/a-guide/', { from: 'indexable', to: 'draft' }],      // draft, no rule → 404
    ['/blog/b-guide/', { from: 'indexable', to: 'noindex' }],
    ['/zh/blog/b-guide/', { from: 'noindex', to: 'noindex' }],      // already noindex: skip
    ['/blog/new-guide/', { from: 'missing', to: 'draft' }],         // never public: skip
    ['/blog/c-guide/', { from: 'indexable', to: 'missing' }],
    ['/old/x/', { from: 'indexable', to: 'missing' }],
    ['/tools/gone/', { from: 'live', to: 'missing' }],
    ['/tools/still/', { from: 'live', to: 'live' }],                // not in sitemap for another reason: skip
    ['/about/', undefined],                                          // no source state: skip
  ]);
  const r = retiredUrls({ paths: [...states.keys()], states, redirects: rules });
  equal('retired URLs and reasons', r, [
    { url: `${SITE}/blog/a-guide/`, reason: 'draft, 301 → /tools/a/' },
    { url: `${SITE}/blog/b-guide/`, reason: 'noindex' },
    { url: `${SITE}/blog/c-guide/`, reason: 'deleted, 404' },
    { url: `${SITE}/ja/blog/a-guide/`, reason: 'draft, 404' },
    { url: `${SITE}/old/x/`, reason: 'deleted, 301 → /new/:splat' },
    { url: `${SITE}/tools/gone/`, reason: 'deleted, 404' },
    { url: `${SITE}/zh/blog/a-guide/`, reason: 'draft, 301 → /zh/tools/a/' },
  ]);
  const r302 = retiredUrls({ paths: ['/blog/t/'], states: new Map([['/blog/t/', { from: 'indexable', to: 'draft' }]]), redirects: parseRedirects('/blog/t/ /blog/') });
  equal('retired: rule without status is 302 (Cloudflare default)', r302[0].reason, 'draft, 302 → /blog/');
  check('retired: only the canonical URL (no slashless variant)', !r.some((x) => x.url === `${SITE}/blog/a-guide`));
}

const distRedirects = join(root, 'dist/_redirects');
if (existsSync(distRedirects)) {
  const real = parseRedirects(readFileSync(distRedirects, 'utf8'));
  equal('dist/_redirects: merged guide → tool page', redirectTarget('/blog/json-formatter-guide/', real), '/tools/json-formatter/');
  equal('dist/_redirects: zh merged guide → zh tool page', redirectTarget('/zh/blog/json-formatter-guide/', real), '/zh/tools/json-formatter/');
  equal('dist/_redirects: noindex guide has no rule', redirectTarget('/zh/blog/aes-encrypt-decrypt-guide/', real), null);
  const realDraft = readFileSync(join(root, 'src/content/blog/json-formatter-guide/en.mdx'), 'utf8');
  const realNoindex = readFileSync(join(root, 'src/content/blog/aes-encrypt-decrypt-guide/zh.mdx'), 'utf8');
  equal('real frontmatter states', [blogState(realDraft), blogState(realNoindex)], ['draft', 'noindex']);
}

// ── Previous tag ─────────────────────────────────────────────────────────────
const tags = ['v1.9.0', 'v1.10.0', 'v1.138.9', 'v1.138.10', 'v1.138.11', 'v1.138.12', 'not-a-version'];
equal('previous tag by version order', previousTag(tags, 'v1.138.11'), 'v1.138.10');
equal('previous tag: 10 > 9', previousTag(tags, 'v1.138.10'), 'v1.138.9');
equal('previous tag: minor 10 > 9', previousTag(tags, 'v1.138.9'), 'v1.10.0');
equal('previous tag: newer tags ignored', previousTag(tags, 'v1.138.12'), 'v1.138.11');
equal('previous tag: none older', previousTag(tags, 'v1.9.0'), null);
equal('previous tag: current not in list uses version order', previousTag(['v1.0.0', 'v1.0.2'], 'v1.0.1'), 'v1.0.0');

// ── Batching, request body, status codes ─────────────────────────────────────
equal('MAX_URLS_PER_POST', MAX_URLS_PER_POST, 10000);
equal('chunk 25001 → 10000/10000/5001', chunk(Array.from({ length: 25001 }, (_, i) => i), 10000).map((c) => c.length), [10000, 10000, 5001]);
equal('chunk empty → none', chunk([], 10000), []);
equal('request body', requestBody(['https://zerotool.dev/tools/base64/']), {
  host: 'zerotool.dev',
  key: INDEXNOW_KEY,
  keyLocation: KEY_LOCATION,
  urlList: ['https://zerotool.dev/tools/base64/'],
});
equal('200 ok', describeStatus(200).ok, true);
equal('202 ok (key validation pending)', [describeStatus(202).ok, /pending/i.test(describeStatus(202).meaning)], [true, true]);
for (const code of [400, 403, 422, 429, 500]) {
  equal(`${code} not ok`, describeStatus(code).ok, false);
}
check('403 meaning mentions key', /key/i.test(describeStatus(403).meaning));
check('429 meaning mentions too many', /too many/i.test(describeStatus(429).meaning));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
