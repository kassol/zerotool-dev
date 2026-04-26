/**
 * generate-blog-redirects.mjs
 *
 * Post-build step: append back-compat 301 redirects to dist/_redirects.
 *
 * After the directory-structure migration (csv-json-guide-zh.mdx → csv-json-guide/zh.mdx),
 * canonical URLs are now `/{lang?}/blog/{baseSlug}/`. The old lang-suffixed URLs
 * (`/{lang}/blog/{baseSlug}-{lang}/`) that Google + sitemaps previously indexed
 * still need to resolve, so we 301 them to the new canonical URL.
 *
 * Drop these once Search Console shows zero hits on the legacy form (likely 6-12 months).
 *
 * Run after astro build (appends to dist/_redirects, never overwrites existing rules).
 */

import { readdir, appendFile, access, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '../src/content/blog');
const REDIRECTS_FILE = join(__dirname, '../dist/_redirects');

async function main() {
  try {
    await access(REDIRECTS_FILE);
  } catch {
    console.error('dist/_redirects not found — run astro build first');
    process.exit(1);
  }

  const lines = [];
  const dirs = await readdir(BLOG_DIR, { withFileTypes: true });

  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const baseSlug = dirent.name;

    const files = await readdir(join(BLOG_DIR, baseSlug));
    for (const file of files) {
      const m = file.match(/^(zh|ja|ko)\.mdx?$/);
      if (!m) continue;
      const lang = m[1];

      // Old URL: /{lang}/blog/{baseSlug}-{lang}/  →  New: /{lang}/blog/{baseSlug}/
      const oldSlug = `${baseSlug}-${lang}`;
      if (oldSlug === baseSlug) continue;
      lines.push(`/${lang}/blog/${oldSlug}/ /${lang}/blog/${baseSlug}/ 301`);
      lines.push(`/${lang}/blog/${oldSlug} /${lang}/blog/${baseSlug}/ 301`);
    }
  }

  if (lines.length === 0) {
    console.log('No translated blog posts found, nothing to append.');
    return;
  }

  lines.sort();
  const block = [
    '',
    '# Back-compat: old lang-suffixed URLs → new base-slug URLs (post-B-migration)',
    ...lines,
    '',
  ].join('\n');

  await appendFile(REDIRECTS_FILE, block, 'utf8');
  console.log(`Appended ${lines.length} legacy-URL back-compat redirects to dist/_redirects`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
