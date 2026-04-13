/**
 * generate-blog-redirects.mjs
 * Scans src/content/blog/ for non-English posts and appends 301 redirects to dist/_redirects.
 * Redirect pattern: /{lang}/blog/{base-slug}/ -> /{lang}/blog/{base-slug}-{lang}/ 301
 * Run after astro build (appends to dist/_redirects, never overwrites existing rules).
 */

import { readdir, appendFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '../src/content/blog');
const REDIRECTS_FILE = join(__dirname, '../dist/_redirects');
const LANG_SUFFIX_RE = /^(.+)-(zh|ja|ko)\.mdx?$/;

async function main() {
  // Ensure dist/_redirects exists (astro build should have created it)
  try {
    await access(REDIRECTS_FILE);
  } catch {
    console.error('dist/_redirects not found — run astro build first');
    process.exit(1);
  }

  const files = await readdir(BLOG_DIR);
  const lines = [];

  for (const file of files) {
    const match = file.match(LANG_SUFFIX_RE);
    if (!match) continue;

    const [, baseSlug, lang] = match;
    const langSlug = `${baseSlug}-${lang}`;

    // Skip if base-slug equals lang-slug (no redundant redirect)
    if (baseSlug === langSlug) continue;

    lines.push(`/${lang}/blog/${baseSlug}/ /${lang}/blog/${langSlug}/ 301`);
    lines.push(`/${lang}/blog/${baseSlug} /${lang}/blog/${langSlug}/ 301`);
  }

  if (lines.length === 0) {
    console.log('No non-English blog posts found, nothing to append.');
    return;
  }

  lines.sort();
  const block = [
    '',
    '# Auto-generated blog locale redirects',
    ...lines,
    '',
  ].join('\n');

  await appendFile(REDIRECTS_FILE, block, 'utf8');
  console.log(`Appended ${lines.length} blog locale redirect(s) to dist/_redirects`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
