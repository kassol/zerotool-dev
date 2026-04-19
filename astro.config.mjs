import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import partytown from '@astrojs/partytown';
import cloudflare from '@astrojs/cloudflare';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Parse _redirects source paths so CF Worker skips them (lets _redirects do 301)
const redirectsFile = fileURLToPath(new URL('./public/_redirects', import.meta.url));
const redirectExcludePatterns = fs.readFileSync(redirectsFile, 'utf-8')
  .split('\n')
  .filter(line => line.trim() && !line.trim().startsWith('#'))
  .map(line => line.trim().split(/\s+/)[0])
  .filter(path => path.startsWith('/'))
  .map(pattern => ({ pattern }));

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
  adapter: cloudflare({
    routes: {
      extend: {
        exclude: redirectExcludePatterns,
      },
    },
  }),
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

        // Language configs: regex, url builder, slug builder (base → lang slug)
        const LANGS = [
          { lang: 'en', re: /^\/blog\/([^/]+)\/$/, url: (s) => `${SITE}/blog/${s}/`, slug: (b) => b },
          { lang: 'zh', re: /^\/zh\/blog\/([^/]+)\/$/, url: (s) => `${SITE}/zh/blog/${s}/`, slug: (b) => `${b}-zh` },
          { lang: 'ja', re: /^\/ja\/blog\/([^/]+)\/$/, url: (s) => `${SITE}/ja/blog/${s}/`, slug: (b) => `${b}-ja` },
          { lang: 'ko', re: /^\/ko\/blog\/([^/]+)\/$/, url: (s) => `${SITE}/ko/blog/${s}/`, slug: (b) => `${b}-ko` },
        ];

        // Detect which language this URL belongs to and derive base slug
        let baseSlug = null;
        let currentLang = null;
        for (const { lang, re } of LANGS) {
          const m = pathname.match(re);
          if (m) {
            const suffix = lang === 'en' ? '' : `-${lang}`;
            if (suffix && !m[1].endsWith(suffix)) break;
            baseSlug = suffix ? m[1].slice(0, -suffix.length) : m[1];
            currentLang = lang;
            break;
          }
        }

        if (baseSlug) {
          // Build hreflang links for all language variants that exist on disk
          const links = LANGS
            .map(({ lang, url, slug }) => ({ lang, url: url(slug(baseSlug)), slug: slug(baseSlug) }))
            .filter(({ slug }) => blogSlugs.has(slug))
            .map(({ lang, url }) => ({ url, lang }));
          if (links.length > 1) item.links = links;

          // lastmod: prefer current lang's date, fall back to EN
          const currentSlug = currentLang === 'en' ? baseSlug : `${baseSlug}-${currentLang}`;
          const date = blogDates.get(currentSlug) || blogDates.get(baseSlug);
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
