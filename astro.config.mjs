import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import partytown from '@astrojs/partytown';
import cloudflare from '@astrojs/cloudflare';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Build blog slug + date maps from new structure: {baseSlug}/{lang}.mdx
// Keys are `{baseSlug}/{lang}` to match Astro Content Collection entry slugs.
const blogDir = fileURLToPath(new URL('./src/content/blog', import.meta.url));
const blogSlugs = new Set();
const blogDates = new Map();
for (const dirent of fs.readdirSync(blogDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const baseSlug = dirent.name;
  const subDir = join(blogDir, baseSlug);
  for (const file of fs.readdirSync(subDir)) {
    if (!/\.mdx?$/.test(file)) continue;
    const lang = file.replace(/\.mdx?$/, '');
    const key = `${baseSlug}/${lang}`;
    blogSlugs.add(key);

    const content = fs.readFileSync(join(subDir, file), 'utf-8');
    const match = content.match(/updatedDate:\s*([\d-]+)/)
      || content.match(/pubDate:\s*([\d-]+)/);
    if (match) blogDates.set(key, new Date(match[1]));
  }
}

const SITE = 'https://zerotool.dev';
const pagePathRe = /^\/(?:(?:zh|ja|ko)(?:\/|$))?(?:tools|blog|about|privacy|terms|contact)(?:\/|$)|^\/(?:zh|ja|ko)$/;

function withTrailingSlashHref(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
  const hashIndex = href.indexOf('#');
  const beforeHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const query = queryIndex >= 0 ? beforeHash.slice(queryIndex) : '';
  const lastSegment = path.split('/').pop() ?? '';

  if (path === '/' || path.endsWith('/') || lastSegment.includes('.') || !pagePathRe.test(path)) return href;
  return `${path}/${query}${hash}`;
}

function rehypeTrailingSlashLinks() {
  return (tree) => {
    const visit = (node) => {
      if (node?.type === 'element' && node.properties && typeof node.properties.href === 'string') {
        node.properties.href = withTrailingSlashHref(node.properties.href);
      }
      if (Array.isArray(node?.children)) node.children.forEach(visit);
    };
    visit(tree);
  };
}

// https://astro.build/config
export default defineConfig({
  site: SITE,
  output: 'static',
  adapter: cloudflare(),
  trailingSlash: 'always',

  integrations: [
    mdx({
      rehypePlugins: [rehypeTrailingSlashLinks],
    }),
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

        // Each blog URL is `/{lang?}/blog/{baseSlug}/`. Collection entry keys are `{baseSlug}/{lang}`.
        const LANGS = [
          { lang: 'en', re: /^\/blog\/([^/]+)\/$/, urlPrefix: '' },
          { lang: 'zh', re: /^\/zh\/blog\/([^/]+)\/$/, urlPrefix: '/zh' },
          { lang: 'ja', re: /^\/ja\/blog\/([^/]+)\/$/, urlPrefix: '/ja' },
          { lang: 'ko', re: /^\/ko\/blog\/([^/]+)\/$/, urlPrefix: '/ko' },
        ];

        let baseSlug = null;
        let currentLang = null;
        for (const { lang, re } of LANGS) {
          const m = pathname.match(re);
          if (m) {
            baseSlug = m[1];
            currentLang = lang;
            break;
          }
        }

        if (baseSlug) {
          const links = LANGS
            .filter(({ lang }) => blogSlugs.has(`${baseSlug}/${lang}`))
            .map(({ lang, urlPrefix }) => ({ url: `${SITE}${urlPrefix}/blog/${baseSlug}/`, lang }));
          if (links.length > 1) item.links = links;

          const date = blogDates.get(`${baseSlug}/${currentLang}`) || blogDates.get(`${baseSlug}/en`);
          if (date) item.lastmod = date;
          return item;
        }

        item.lastmod = new Date();
        return item;
      },
    }),
    partytown({
      // Forward GA4 + AdSense calls from main thread to worker.
      // Preserve dataLayer.push on the main thread so early tool_use calls remain visible
      // even before the Partytown worker has finished booting.
      config: {
        forward: [['dataLayer.push', { preserveBehavior: true }], 'adsbygoogle'],
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
