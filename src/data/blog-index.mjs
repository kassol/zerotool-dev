// Which blog posts search engines are told about. A post is indexable when it is
// neither `draft` (no route) nor `noindex` (route exists, robots noindex). Both are
// set per language file, so each `{baseSlug}/{lang}` key is decided on its own.
// Only indexable posts go into the sitemap and into hreflang alternates.
//
// Plain JS with no Node imports: astro.config.mjs (sitemap) and
// components/SEO.astro (hreflang) share it, and scripts/test-blog-index.mjs
// imports it directly.
import yaml from 'js-yaml';

export const BLOG_LANGS = ['en', 'zh', 'ja', 'ko'];

export function blogPath(baseSlug, lang) {
  return lang === 'en' ? `/blog/${baseSlug}/` : `/${lang}/blog/${baseSlug}/`;
}

// `/blog/{baseSlug}/` or `/{zh|ja|ko}/blog/{baseSlug}/` → collection key `{baseSlug}/{lang}`.
// Other paths (blog index, tool pages, ...) → null.
export function blogKeyFromPath(pathname) {
  const m = pathname.match(/^\/(?:(zh|ja|ko)\/)?blog\/([^/]+)\/?$/);
  return m ? `${m[2]}/${m[1] ?? 'en'}` : null;
}

export function isIndexable(data) {
  return !data.draft && !data.noindex;
}

// Language versions of a post that hreflang may point to, in BLOG_LANGS order.
export function blogAlternates(baseSlug, indexableKeys) {
  return BLOG_LANGS
    .filter((lang) => indexableKeys.has(`${baseSlug}/${lang}`))
    .map((lang) => ({ lang, path: blogPath(baseSlug, lang) }));
}

// Sitemap filter: drop blog post URLs whose language version is not indexable.
// Non-blog URLs are kept.
export function keepInSitemap(pathname, indexableKeys) {
  const key = blogKeyFromPath(pathname);
  return key === null || indexableKeys.has(key);
}

export function parseFrontmatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? (yaml.load(m[1]) ?? {}) : {};
}

// files: iterable of { baseSlug, lang, source }.
// Returns the indexable keys and each post's sitemap lastmod (updatedDate, else pubDate).
export function buildBlogIndex(files) {
  const indexable = new Set();
  const dates = new Map();
  for (const { baseSlug, lang, source } of files) {
    const key = `${baseSlug}/${lang}`;
    const data = parseFrontmatter(source);
    if (isIndexable(data)) indexable.add(key);
    const date = data.updatedDate ?? data.pubDate;
    if (date) dates.set(key, new Date(date));
  }
  return { indexable, dates };
}
