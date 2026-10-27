// Rename Astro CSS chunks that are named after their first parent page.
//
// Astro 5 names a CSS chunk after the first page that imports it (css-asset-name.js,
// shortHashedName). A stylesheet shared by every page therefore lands as
// `_slug_.<hash>.css` (after src/pages/blog/[slug].astro), and the shared tool CSS
// lands as `aes-encrypt-decrypt.<hash>.css` (the first tool page in registry order).
// Both names mislead in the network panel: the file is not the blog route and not
// the AES tool's styles.
//
// This script runs after `astro build`, before check-tool-css-order, and renames the
// chunks by what they actually are:
//   site.*.css         referenced by a non-tool, non-blog page (about, contact, home)
//   article.*.css      referenced only by blog pages
//   adunit.*.css       only on tool pages, smaller than 1 KB (the AdUnit slot)
//   tool-shared.*.css  on more than one tool page, not site-wide (shared tool CSS)
// Per-tool CSS (one tool page) keeps the tool name Astro already gives it.
// Every HTML reference is rewritten; the build has no other reference to these files.
//
// Run: node scripts/rename-css-chunks.mjs [distDir] [--dry-run]

import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_HREF_RE = /<link\b[^>]*\brel=["']?stylesheet\b[^>]*>/gi;
const HREF_RE = /\bhref=["']?([^"'\s>]+)/i;
const SMALL_CHUNK_BYTES = 1024;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

export function cssResources(html) {
  const out = [];
  for (const m of html.matchAll(CSS_HREF_RE)) {
    const href = m[0].match(HREF_RE);
    if (href) out.push(href[1]);
  }
  return out;
}

export function isToolPage(rel) {
  return /^(?:zh|ja|ko)\/tools\/[^/]+\/index\.html$/.test(rel) || /^tools\/[^/]+\/index\.html$/.test(rel);
}

export function isBlogPage(rel) {
  return /^(?:zh|ja|ko)\/blog\//.test(rel) || /^blog\//.test(rel);
}

export function isHomePage(rel) {
  return /^(?:zh|ja|ko\/)?index\.html$/.test(rel);
}

export function isNotFoundPage(rel) {
  return /^(?:zh|ja|ko\/)?404\.html$/.test(rel);
}

function toolSlug(rel) {
  return rel.split('/').filter(Boolean)[rel.startsWith('tools/') ? 1 : 2];
}

// pages: [{ rel, css: [href, ...] }]. sizes: Map(href -> bytes).
// Returns Map(href -> 'site' | 'article' | 'adunit' | 'tool-shared' | 'home' | 'not-found' | null).
export function classifyChunks(pages, sizes) {
  const refs = new Map();
  for (const page of pages) {
    for (const href of page.css) {
      if (!refs.has(href)) refs.set(href, []);
      refs.get(href).push(page.rel);
    }
  }
  // Site-wide: linked by every HTML page. Only the BaseLayout stylesheet qualifies; a
  // home-page or 404-only chunk does not.
  let siteHrefs = null;
  for (const page of pages) {
    const set = new Set(page.css);
    siteHrefs = siteHrefs ? new Set([...siteHrefs].filter((h) => set.has(h))) : set;
  }
  const kinds = new Map();
  for (const [href, list] of refs) {
    let kind = null;
    if (siteHrefs?.has(href)) {
      kind = 'site';
    } else if (list.every(isBlogPage)) {
      kind = 'article';
    } else if ((sizes.get(href) ?? 0) < SMALL_CHUNK_BYTES && list.some(isToolPage)) {
      // The AdUnit stylesheet is small and appears on tool pages and blog articles.
      kind = 'adunit';
    } else if (list.every(isToolPage)) {
      if (new Set(list.map(toolSlug)).size > 1) kind = 'tool-shared';
    } else if (list.every(isHomePage)) {
      kind = 'home';
    } else if (list.every(isNotFoundPage)) {
      kind = 'not-found';
    }
    kinds.set(href, kind);
  }
  return kinds;
}

function splitName(href) {
  const name = basename(href);
  const m = name.match(/^(.*)\.([A-Za-z0-9_-]{8})\.css$/);
  if (!m) return null;
  return { base: m[1], hash: m[2] };
}

export function renameCssChunks(distDir, { dryRun = false } = {}) {
  const files = walk(distDir);
  const pages = files.map((file) => ({
    file,
    rel: relative(distDir, file).split(sep).join('/'),
    css: cssResources(readFileSync(file, 'utf8')).filter((href) => href.startsWith('/_astro/')),
  }));
  const sizes = new Map();
  for (const page of pages) {
    for (const href of page.css) {
      if (sizes.has(href)) continue;
      const file = join(distDir, href);
      sizes.set(href, existsSync(file) ? statSync(file).size : 0);
    }
  }
  const kinds = classifyChunks(pages, sizes);
  const renames = new Map();
  for (const [href, kind] of kinds) {
    if (!kind) continue;
    const parts = splitName(href);
    if (!parts) continue;
    const next = `/_astro/${kind}.${parts.hash}.css`;
    if (next !== href) renames.set(href, next);
  }
  if (renames.size === 0) return { renamed: 0, pages: files.length };
  for (const [from, to] of renames) {
    const src = join(distDir, from);
    if (!existsSync(src)) throw new Error(`${from} is referenced but missing`);
    if (existsSync(join(distDir, to))) throw new Error(`${to} already exists`);
    if (!dryRun) renameSync(src, join(distDir, to));
  }
  for (const page of pages) {
    let html = readFileSync(page.file, 'utf8');
    let changed = false;
    for (const [from, to] of renames) {
      if (!html.includes(from)) continue;
      html = html.split(from).join(to);
      changed = true;
    }
    if (changed && !dryRun) writeFileSync(page.file, html);
  }
  return { renamed: renames.size, pages: files.length, renames: Object.fromEntries(renames) };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const distDir = resolve(args.find((a) => !a.startsWith('--')) ?? fileURLToPath(new URL('../dist', import.meta.url)));
  try {
    const result = renameCssChunks(distDir, { dryRun });
    if (result.renamed === 0) {
      console.log(`rename-css-chunks: nothing to rename in ${result.pages} HTML files`);
    } else {
      const list = Object.entries(result.renames).map(([from, to]) => `${basename(from)} -> ${basename(to)}`).join(', ');
      console.log(`rename-css-chunks: ${dryRun ? 'would rename' : 'renamed'} ${result.renamed} chunk(s) across ${result.pages} HTML files: ${list}`);
    }
  } catch (e) {
    console.error(`rename-css-chunks: ${e.message}`);
    process.exit(1);
  }
}
