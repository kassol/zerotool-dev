// Tool page CSS order check (runs after astro build)
//
// Read:  dist/tools/*/index.html, dist/{zh,ja,ko}/tools/*/index.html, dist/about/index.html
// Write: stdout only
// Exit:  0 if every tool page links its shared tool CSS before its own tool CSS, 1 otherwise
//
// Each tool page has its own injected route (toolRoutes() in astro.config.mjs), so its CSS
// comes in parts. Astro orders the parts by an import-position heuristic, and the tool
// entry imports tool-common.css first to put the shared part first. The tool component
// styles must come after the shared tool styles (tool-common.css, ToolLayout, ShareButtons),
// as they did when all tool CSS was one file; otherwise equal-specificity rules change winners.
//
// CSS resources are <link rel="stylesheet"> hrefs and inline <style> blocks, in document order.
// - site-wide: also on dist/about/index.html (BaseLayout) — not checked
// - shared tool CSS: on the pages of 2 or more tools (and not site-wide)
// - own tool CSS: on the pages of 1 tool only
// Every shared tool resource must come before every own tool resource on the page.
// A page with own tool CSS but no shared tool CSS also fails: the order cannot be checked.
//
// Run: node scripts/check-tool-css-order.mjs [distDir]

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANG_PREFIXES = ['', 'zh/', 'ja/', 'ko/'];

export function cssResources(html) {
  // Drop <script> bodies first: JSON-LD text can contain "<style>" or "</head>".
  const head = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').split(/<\/head>/i)[0];
  const out = [];
  for (const m of head.matchAll(/<link\b[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (m[0].startsWith('<style') || m[0].startsWith('<STYLE')) {
      out.push(`inline:${m[1]}`);
    } else if (/\brel=["']?stylesheet\b/i.test(m[0])) {
      const href = m[0].match(/\bhref=["']?([^"'\s>]+)/i);
      if (href) out.push(href[1]);
    }
  }
  return out;
}

export function listToolPages(distDir) {
  const pages = [];
  for (const prefix of LANG_PREFIXES) {
    const dir = join(distDir, prefix, 'tools');
    if (!existsSync(dir)) continue;
    for (const slug of readdirSync(dir, { withFileTypes: true })) {
      if (!slug.isDirectory()) continue;
      const file = join(dir, slug.name, 'index.html');
      if (existsSync(file)) pages.push({ path: `${prefix}tools/${slug.name}/`, slug: slug.name, file });
    }
  }
  return pages;
}

// pages: [{ path, slug, css: [resource, ...] }], siteWide: Set of resources
export function checkOrder(pages, siteWide) {
  const slugsByResource = new Map();
  for (const page of pages) {
    for (const r of page.css) {
      if (siteWide.has(r)) continue;
      if (!slugsByResource.has(r)) slugsByResource.set(r, new Set());
      slugsByResource.get(r).add(page.slug);
    }
  }
  const problems = [];
  let checked = 0;
  for (const page of pages) {
    const shared = [];
    const own = [];
    page.css.forEach((r, i) => {
      if (siteWide.has(r)) return;
      (slugsByResource.get(r).size >= 2 ? shared : own).push(i);
    });
    if (own.length === 0) continue;
    checked++;
    if (shared.length === 0) {
      problems.push(`${page.path}: no shared tool CSS found before the tool CSS`);
    } else if (Math.max(...shared) > Math.min(...own)) {
      const name = (i) => (page.css[i].startsWith('inline:') ? `<style> (${page.css[i].length - 7} chars)` : page.css[i]);
      problems.push(`${page.path}: tool CSS ${name(Math.min(...own))} comes before shared tool CSS ${name(Math.max(...shared))}`);
    }
  }
  return { checked, problems };
}

export function checkDist(distDir) {
  const about = join(distDir, 'about', 'index.html');
  if (!existsSync(about)) throw new Error(`${about} not found (run astro build first)`);
  const siteWide = new Set(cssResources(readFileSync(about, 'utf8')));
  const pages = listToolPages(distDir).map((p) => ({ ...p, css: cssResources(readFileSync(p.file, 'utf8')) }));
  if (pages.length === 0) throw new Error(`no tool pages found in ${distDir}`);
  return { pages: pages.length, ...checkOrder(pages, siteWide) };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const distDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));
  let result;
  try {
    result = checkDist(distDir);
  } catch (e) {
    console.error(`check-tool-css-order: ${e.message}`);
    process.exit(1);
  }
  if (result.problems.length > 0) {
    console.error(`check-tool-css-order: ${result.problems.length} tool page(s) with wrong CSS order`);
    for (const p of result.problems.slice(0, 20)) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-tool-css-order: ${result.pages} tool pages, ${result.checked} with own tool CSS, shared tool CSS first on all`);
}
