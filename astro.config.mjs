import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import partytown from '@astrojs/partytown';
import cloudflare from '@astrojs/cloudflare';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Build blog slug set for hreflang pairing in sitemap
const blogDir = fileURLToPath(new URL('./src/content/blog', import.meta.url));
const blogSlugs = new Set(
  fs.readdirSync(blogDir)
    .filter(f => /\.mdx?$/.test(f))
    .map(f => f.replace(/\.mdx?$/, ''))
);

// Build blog date map for sitemap lastmod
const blogDates = new Map();
for (const file of fs.readdirSync(blogDir).filter(f => /\.mdx?$/.test(f))) {
  const content = fs.readFileSync(join(blogDir, file), 'utf-8');
  const match = content.match(/updatedDate:\s*([\d-]+)/)
    || content.match(/pubDate:\s*([\d-]+)/);
  if (match) {
    const slug = file.replace(/\.mdx?$/, '');
    blogDates.set(slug, new Date(match[1]));
  }
}

const SITE = 'https://zerotool.dev';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: cloudflare(),
  trailingSlash: 'always',

  integrations: [
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          zh: 'zh',
          ja: 'ja',
          ko: 'ko',
        },
      },
      serialize(item) {
        const { pathname } = new URL(item.url);

        // EN blog post: /blog/{slug}/
        const enMatch = pathname.match(/^\/blog\/([^/]+)\/$/);
        if (enMatch) {
          const slug = enMatch[1];
          const zhSlug = `${slug}-zh`;
          if (blogSlugs.has(zhSlug)) {
            item.links = [
              { url: `${SITE}/blog/${slug}/`, lang: 'en' },
              { url: `${SITE}/zh/blog/${zhSlug}/`, lang: 'zh' },
            ];
          }
          const date = blogDates.get(slug);
          if (date) item.lastmod = date;
          return item;
        }

        // ZH blog post: /zh/blog/{slug-zh}/
        const zhMatch = pathname.match(/^\/zh\/blog\/([^/]+)\/$/);
        if (zhMatch && zhMatch[1].endsWith('-zh')) {
          const zhSlug = zhMatch[1];
          const enSlug = zhSlug.slice(0, -3);
          if (blogSlugs.has(enSlug)) {
            item.links = [
              { url: `${SITE}/blog/${enSlug}/`, lang: 'en' },
              { url: `${SITE}/zh/blog/${zhSlug}/`, lang: 'zh' },
            ];
          }
          const date = blogDates.get(zhSlug) || blogDates.get(enSlug);
          if (date) item.lastmod = date;
          return item;
        }

        // Non-blog pages: use build date
        item.lastmod = new Date();
        return item;
      },
    }),
    partytown({
      // Forward GA4 + AdSense calls from main thread to worker
      config: {
        forward: ['dataLayer.push', 'adsbygoogle'],
      },
    }),
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh', 'ja', 'ko'],
    routing: {
      prefixDefaultLocale: false,  // English at root path
    },
  },
});
