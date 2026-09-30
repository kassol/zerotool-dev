// IndexNow release submission — pure helpers (no git, no network, no file access).
// scripts/indexnow-submit.mjs does the I/O; scripts/test-indexnow-urls.mjs tests this module.
//
// Protocol: https://www.indexnow.org/documentation (checked 2026-09-30)
// - key: 8–128 characters of a-z, A-Z, 0-9 and "-"; hosted as UTF-8 `{key}.txt` at the
//   site root, containing the key.
// - POST JSON { host, key, keyLocation, urlList } to https://api.indexnow.org/indexnow,
//   up to 10,000 URLs per POST. Submitted URLs are shared with all participating engines.
// - Status codes: see STATUS below.
// Guidance: https://www.indexnow.org/faq (checked 2026-09-30)
// - "It is not designed for submitting every URL on your site at once. If your entire
//   site has been recently updated, such as after a migration or redesign, it is
//   acceptable to submit all URLs."
// - "Avoid submitting every small layout or cosmetic change."
// So a change to a shared file (layout, i18n, styles) does not submit the whole
// sitemap by itself; `all` (the --all flag) does, for a redesign.

export const SITE = 'https://zerotool.dev';
export const INDEXNOW_KEY = 'cb742ae5a7b4c3ed945013823039558f';
export const KEY_LOCATION = `${SITE}/${INDEXNOW_KEY}.txt`;
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const MAX_URLS_PER_POST = 10000;
export const LANGS = ['en', 'zh', 'ja', 'ko'];

const STATUS = {
  200: { ok: true, meaning: 'OK: URLs submitted' },
  202: { ok: true, meaning: 'Accepted: URLs received, key validation pending' },
  400: { ok: false, meaning: 'Bad request: invalid format' },
  403: { ok: false, meaning: 'Forbidden: key not valid (key file not found, or key not in the file)' },
  422: { ok: false, meaning: 'Unprocessable Entity: URLs do not belong to the host, or the key does not match the protocol schema' },
  429: { ok: false, meaning: 'Too Many Requests (potential spam)' },
};

export function describeStatus(code) {
  return STATUS[code] ?? { ok: false, meaning: `Unexpected status ${code}` };
}

export function toolPath(slug, lang) {
  return lang === 'en' ? `/tools/${slug}/` : `/${lang}/tools/${slug}/`;
}

function blogPath(dir, lang) {
  return lang === 'en' ? `/blog/${dir}/` : `/${lang}/blog/${dir}/`;
}

// tools.ts and registry.ts keep one entry per line. Each parser returns
// Map<slug, line> in file order.
function parseLines(source, re) {
  const map = new Map();
  for (const line of (source ?? '').split('\n')) {
    const m = line.match(re);
    if (m) map.set(m[1], line);
  }
  return map;
}

export function parseToolsLines(source) {
  return parseLines(source, /^\s*\{\s*slug:\s*'([^']+)'/);
}

export function parseRegistryLines(source) {
  return parseLines(source, /^\s*'([^']+)':\s*'[^']+',?\s*$/);
}

// Slugs whose entry line was added, removed or changed. `other` is true when a line
// outside the entries changed or the entries were reordered: that can change every
// page that uses the file, so the caller treats the file as global.
export function diffKeyedLines(oldSource, newSource, parse) {
  const before = parse(oldSource);
  const after = parse(newSource);
  const keys = new Set();
  for (const [k, line] of after) if (before.get(k) !== line) keys.add(k);
  for (const k of before.keys()) if (!after.has(k)) keys.add(k);

  const rest = (src, map) => {
    const entryLines = new Set(map.values());
    return (src ?? '').split('\n').filter((l) => !entryLines.has(l)).join('\n');
  };
  const commonOrder = (a, b) => [...a.keys()].filter((k) => b.has(k)).join('\n');
  const other = oldSource == null || newSource == null
    || rest(oldSource, before) !== rest(newSource, after)
    || commonOrder(before, after) !== commonOrder(after, before);
  return { keys: [...keys].sort(), other };
}

// Component file name → slugs that use it.
export function componentSlugMap(...registrySources) {
  const map = new Map();
  for (const source of registrySources) {
    for (const line of (source ?? '').split('\n')) {
      const m = line.match(/^\s*'([^']+)':\s*'([^']+)',?\s*$/);
      if (!m) continue;
      const slugs = map.get(m[2]) ?? [];
      if (!slugs.includes(m[1])) slugs.push(m[1]);
      map.set(m[2], slugs);
    }
  }
  return map;
}

const KEYED_FILES = new Set(['src/data/tools.ts', 'src/components/tools/registry.ts']);

// files: repo-relative paths changed between two releases.
// ctx.componentSlugs: componentSlugMap(...); ctx.keyedDiffs: { [file]: diffKeyedLines(...) }.
// Returns the site paths of pages whose own source changed, the changed files that
// affect many pages (global), and files that do not render pages (ignored).
export function mapChangedFiles(files, ctx) {
  const paths = new Set();
  const global = [];
  const ignored = [];
  const addTool = (slug) => LANGS.forEach((l) => paths.add(toolPath(slug, l)));

  for (const file of files) {
    let m;
    if (/(^|\/)(AGENTS|CONTEXT)\.md$/.test(file)) {
      ignored.push(file);
    } else if ((m = file.match(/^src\/content\/tools\/([^/]+)\/([^/]+)$/))) {
      const lang = m[2].match(/^(en|zh|ja|ko)\.mdx$/)?.[1];
      if (lang) paths.add(toolPath(m[1], lang));
      else addTool(m[1]);
    } else if ((m = file.match(/^src\/content\/blog\/([^/]+)\/([^/]+)$/))) {
      const lang = m[2].match(/^(en|zh|ja|ko)\.mdx$/)?.[1];
      if (lang) paths.add(blogPath(m[1], lang));
      else LANGS.forEach((l) => paths.add(blogPath(m[1], l)));
    } else if (KEYED_FILES.has(file)) {
      const diff = ctx.keyedDiffs[file] ?? { keys: [], other: true };
      diff.keys.forEach(addTool);
      if (diff.other) global.push(file);
    } else if ((m = file.match(/^src\/components\/tools\/([^/]+)\.astro$/))) {
      const slugs = ctx.componentSlugs.get(m[1]);
      if (slugs?.length) slugs.forEach(addTool);
      else global.push(file);
    } else if ((m = file.match(/^src\/pages\/(.+)\.(astro|md|mdx)$/)) && !file.includes('[')) {
      const route = m[1].replace(/(^|\/)index$/, '');
      paths.add(route ? `/${route}/` : '/');
    } else if (file.startsWith('src/') || file === 'astro.config.mjs') {
      global.push(file);
    } else {
      ignored.push(file);
    }
  }
  return { paths, global, ignored };
}

// The sitemap is the final filter: draft posts have no page, and noindex posts and
// redirected URLs are not in it. With `all`, every sitemap URL is submitted.
export function selectUrls({ paths, sitemapUrls, all }) {
  const inSitemap = new Set(sitemapUrls);
  const notInSitemap = [];
  const urls = new Set();
  for (const p of paths) {
    const url = SITE + p;
    if (inSitemap.has(url)) urls.add(url);
    else notInSitemap.push(p);
  }
  if (all) sitemapUrls.forEach((u) => urls.add(u));
  return { urls: [...urls].sort(), notInSitemap: notInSitemap.sort(), full: Boolean(all) };
}

export function parseSitemapLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
}

function versionParts(tag) {
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// The highest vX.Y.Z tag below `current`. The caller passes tags reachable from
// the current release, so tags on other branches are not candidates.
export function previousTag(tags, current) {
  const cur = versionParts(current);
  if (!cur) return null;
  let best = null;
  for (const tag of tags) {
    const v = versionParts(tag);
    if (v && compareVersions(v, cur) < 0 && (!best || compareVersions(v, best.v) > 0)) best = { tag, v };
  }
  return best?.tag ?? null;
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function requestBody(urlList) {
  return { host: new URL(SITE).host, key: INDEXNOW_KEY, keyLocation: KEY_LOCATION, urlList };
}
