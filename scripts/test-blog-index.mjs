// Blog indexability (sitemap filter + hreflang alternates) — regression test
//
// Read:  src/data/blog-index.mjs (imported), src/content/blog/*/*.mdx (real-data
//        checks), src/components/SEO.astro and astro.config.mjs (wiring checks)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: blog URL → collection key, draft / noindex decide indexability, hreflang
// alternates skip non-indexable language versions, sitemap keeps non-blog URLs and
// drops non-indexable blog URLs, frontmatter parsing (per-language noindex, quoted
// values, CRLF, missing frontmatter), lastmod from updatedDate then pubDate; on the
// real blog: every file parses and lastmod equals the regex extraction used before
// this module; SEO.astro emits `noindex,follow` and both SEO.astro and
// astro.config.mjs use the shared module.
//
// Run: node scripts/test-blog-index.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  blogAlternates,
  blogKeyFromPath,
  blogPath,
  buildBlogIndex,
  isIndexable,
  keepInSitemap,
  parseFrontmatter,
} from '../src/data/blog-index.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const fm = (fields, body = 'Body text.') => `---\n${fields}\n---\n\n${body}\n`;

// ---------- 1. blog URL → key ----------
deepEqual('en post', blogKeyFromPath('/blog/json-guide/'), 'json-guide/en');
deepEqual('zh post', blogKeyFromPath('/zh/blog/json-guide/'), 'json-guide/zh');
deepEqual('ja post', blogKeyFromPath('/ja/blog/json-guide/'), 'json-guide/ja');
deepEqual('ko post', blogKeyFromPath('/ko/blog/json-guide/'), 'json-guide/ko');
deepEqual('post without trailing slash', blogKeyFromPath('/zh/blog/json-guide'), 'json-guide/zh');
deepEqual('en blog index', blogKeyFromPath('/blog/'), null);
deepEqual('zh blog index', blogKeyFromPath('/zh/blog/'), null);
deepEqual('tool page', blogKeyFromPath('/tools/json-formatter/'), null);
deepEqual('zh tool page', blogKeyFromPath('/zh/tools/json-formatter/'), null);
deepEqual('home', blogKeyFromPath('/'), null);
deepEqual('unknown language prefix', blogKeyFromPath('/fr/blog/json-guide/'), null);
deepEqual('nested path', blogKeyFromPath('/blog/a/b/'), null);
deepEqual('blogPath en', blogPath('x', 'en'), '/blog/x/');
deepEqual('blogPath ko', blogPath('x', 'ko'), '/ko/blog/x/');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  deepEqual(`blogPath round trip ${lang}`, blogKeyFromPath(blogPath('x-guide', lang)), `x-guide/${lang}`);
}

// ---------- 2. indexability ----------
check('default is indexable', isIndexable({}) === true);
check('draft:false noindex:false is indexable', isIndexable({ draft: false, noindex: false }) === true);
check('noindex is not indexable', isIndexable({ noindex: true }) === false);
check('draft is not indexable', isIndexable({ draft: true }) === false);
check('draft + noindex is not indexable', isIndexable({ draft: true, noindex: true }) === false);

// ---------- 3. hreflang alternates ----------
{
  const all = new Set(['p/en', 'p/zh', 'p/ja', 'p/ko', 'other/en']);
  deepEqual('all four languages, fixed order', blogAlternates('p', all), [
    { lang: 'en', path: '/blog/p/' },
    { lang: 'zh', path: '/zh/blog/p/' },
    { lang: 'ja', path: '/ja/blog/p/' },
    { lang: 'ko', path: '/ko/blog/p/' },
  ]);
  const noZh = new Set(['p/en', 'p/ja', 'p/ko']);
  deepEqual('non-indexable zh is skipped', blogAlternates('p', noZh).map((a) => a.lang), ['en', 'ja', 'ko']);
  deepEqual('no indexable versions', blogAlternates('missing', all), []);
  deepEqual('other posts do not leak in', blogAlternates('other', all).map((a) => a.lang), ['en']);
  deepEqual('prefix slug does not match', blogAlternates('p-2', all), []);
}

// ---------- 4. sitemap filter ----------
{
  const keys = new Set(['p/en', 'p/ja']);
  check('non-blog URL kept', keepInSitemap('/tools/json-formatter/', keys));
  check('home kept', keepInSitemap('/', keys));
  check('blog index kept', keepInSitemap('/zh/blog/', keys));
  check('indexable en post kept', keepInSitemap('/blog/p/', keys));
  check('indexable ja post kept', keepInSitemap('/ja/blog/p/', keys));
  check('noindex zh post dropped', !keepInSitemap('/zh/blog/p/', keys));
  check('unknown post dropped', !keepInSitemap('/blog/unknown/', keys));
}

// ---------- 5. frontmatter + buildBlogIndex ----------
{
  deepEqual('missing frontmatter → {}', parseFrontmatter('no frontmatter here'), {});
  deepEqual('empty frontmatter → {}', parseFrontmatter('---\n\n---\nbody'), {});
  check('CRLF frontmatter parsed', parseFrontmatter('---\r\ntitle: "A"\r\nnoindex: true\r\n---\r\nbody').noindex === true);
  check('body text is not frontmatter',
    parseFrontmatter(fm('title: "A"', 'noindex: true\n---\nmore')).noindex === undefined);

  const files = [
    { baseSlug: 'p', lang: 'en', source: fm('title: "P"\npubDate: 2026-04-01\nlang: "en"') },
    { baseSlug: 'p', lang: 'zh', source: fm('title: "P"\npubDate: 2026-04-01\nupdatedDate: 2026-05-02\nlang: "zh"\nnoindex: true') },
    { baseSlug: 'p', lang: 'ja', source: fm('title: "P"\npubDate: "2026-04-03"\nlang: "ja"\nnoindex: false') },
    { baseSlug: 'p', lang: 'ko', source: fm('title: "P"\npubDate: 2026-04-01\nlang: "ko"\ndraft: true') },
    { baseSlug: 'q', lang: 'en', source: fm('title: "Q: colon"\ntags: ["a", "b"]') },
  ];
  const { indexable, dates } = buildBlogIndex(files);
  deepEqual('noindex and draft are per language', [...indexable].sort(), ['p/en', 'p/ja', 'q/en']);
  deepEqual('pubDate used when no updatedDate', dates.get('p/en')?.toISOString(), '2026-04-01T00:00:00.000Z');
  deepEqual('updatedDate wins', dates.get('p/zh')?.toISOString(), '2026-05-02T00:00:00.000Z');
  deepEqual('quoted date parsed as UTC day', dates.get('p/ja')?.toISOString(), '2026-04-03T00:00:00.000Z');
  check('no date → no lastmod', !dates.has('q/en'));
  deepEqual('sitemap alternates for p skip zh (noindex) and ko (draft)',
    blogAlternates('p', indexable).map((a) => a.path), ['/blog/p/', '/ja/blog/p/']);
}

// ---------- 6. real blog ----------
{
  const blogDir = join(root, 'src/content/blog');
  const files = [];
  const parseErrors = [];
  for (const baseSlug of readdirSync(blogDir)) {
    const subDir = join(blogDir, baseSlug);
    if (!statSync(subDir).isDirectory()) continue;
    for (const file of readdirSync(subDir)) {
      if (!/\.mdx?$/.test(file)) continue;
      const source = readFileSync(join(subDir, file), 'utf8');
      const lang = file.replace(/\.mdx?$/, '');
      try {
        const data = parseFrontmatter(source);
        for (const flag of ['draft', 'noindex']) {
          if (data[flag] !== undefined && typeof data[flag] !== 'boolean') {
            parseErrors.push(`${baseSlug}/${file}: ${flag} is not a boolean`);
          }
        }
      } catch (e) {
        parseErrors.push(`${baseSlug}/${file}: ${e.message}`);
      }
      files.push({ baseSlug, lang, source });
    }
  }
  check('real blog has posts', files.length > 100, String(files.length));
  deepEqual('every real frontmatter parses, flags are booleans', parseErrors, []);

  // lastmod must not change versus the regex extraction astro.config.mjs used before.
  const { dates } = buildBlogIndex(files);
  const mismatches = [];
  for (const { baseSlug, lang, source } of files) {
    const m = source.match(/updatedDate:\s*([\d-]+)/) || source.match(/pubDate:\s*([\d-]+)/);
    const before = m ? new Date(m[1]).toISOString() : undefined;
    const after = dates.get(`${baseSlug}/${lang}`)?.toISOString();
    if (before !== after) mismatches.push(`${baseSlug}/${lang}: ${before} → ${after}`);
  }
  deepEqual('real lastmod unchanged', mismatches, []);
}

// ---------- 7. wiring ----------
{
  const seo = readFileSync(join(root, 'src/components/SEO.astro'), 'utf8');
  check('SEO.astro robots is noindex,follow', seo.includes('content="noindex,follow"'));
  check('SEO.astro has no nofollow', !seo.includes('nofollow'));
  check('SEO.astro filters hreflang by isIndexable', /getCollection\('blog',\s*\(\{ data \}\) => isIndexable\(data\)\)/.test(seo));
  check('SEO.astro builds alternates with blogAlternates', seo.includes('blogAlternates(baseSlug, indexableBlogKeys)'));
  const config = readFileSync(join(root, 'astro.config.mjs'), 'utf8');
  check('sitemap filter uses keepInSitemap', /filter:\s*\(page\)\s*=>\s*keepInSitemap\(/.test(config));
  check('sitemap alternates use blogAlternates', config.includes('blogAlternates(baseSlug, indexableBlogKeys)'));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
