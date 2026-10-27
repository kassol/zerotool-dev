// Tool page CSS order check (runs after rename-css-chunks.mjs)
//
// Read:  dist/tools/*/index.html, dist/{zh,ja,ko}/tools/*/index.html, all other dist HTML
// Write: stdout only
// Exit:  0 if every tool page links site CSS first, then shared tool CSS, then its own
//        tool CSS, and has no inline <style> in <head>, 1 otherwise
//
// Each tool page has its own injected route (toolRoutes() in astro.config.mjs), so its CSS
// comes in parts. Astro orders the parts by an import-position heuristic; the generated
// tool entry imports src/styles/site.css first, then ToolLayout and tool-common.css, then
// the tool component. The tool component styles must come after the shared tool styles
// (tool-common.css, ToolLayout, ShareButtons), as they did when all tool CSS was one file;
// otherwise equal-specificity rules change winners. Site CSS must come before both so a
// tool rule wins over a site rule of equal specificity.
//
// CSS resources are <link rel="stylesheet"> hrefs and inline <style> blocks, in document order.
// - site-wide: on every non-tool HTML page (BaseLayout) — must come before tool CSS
// - shared tool CSS: on the pages of 2 or more tools (and not site-wide)
// - own tool CSS: on the pages of 1 tool only
// Every site resource must come before every tool resource, and every shared tool resource
// before every own tool resource on the page.
// A page with own tool CSS but no shared tool CSS also fails: the order cannot be checked.
// CSS files must not carry the first-parent chunk names: `_slug_.*` is the blog route and a
// shared chunk named after one tool is not that tool's CSS (rename-css-chunks.mjs fixes both).
//
// A tool page must have no <style> in <head>. astro.config.mjs sets
// build.inlineStylesheets: 'never', so all bundled CSS is linked as files. If Astro inlines
// CSS again, it merges adjacent chunks into one <style>, and the order inside that block
// cannot be checked here. The repo has no <style is:inline>; a component that adds one in
// <head> also fails this check. Move such styles into the component's normal <style> block.
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
    const inline = page.css.filter((r) => r.startsWith('inline:'));
    if (inline.length > 0) {
      problems.push(`${page.path}: ${inline.length} inline <style> in <head> (${inline.map((r) => r.length - 7).join(', ')} chars); bundled CSS must be linked (build.inlineStylesheets: 'never')`);
    }
    if (own.length === 0) continue;
    checked++;
    const site = [];
    page.css.forEach((r, i) => {
      if (siteWide.has(r)) site.push(i);
    });
    if (site.length !== siteWide.size) {
      problems.push(`${page.path}: ${siteWide.size - site.length} site CSS resource(s) missing`);
    }
    if (site.length > 0 && shared.length + own.length > 0 && Math.max(...site) > Math.min(...shared, ...own)) {
      const name = (i) => (page.css[i].startsWith('inline:') ? `<style> (${page.css[i].length - 7} chars)` : page.css[i]);
      problems.push(`${page.path}: tool CSS ${name(Math.min(...shared, ...own))} comes before site CSS ${name(Math.max(...site))}`);
    }
    if (shared.length === 0) {
      problems.push(`${page.path}: no shared tool CSS found before the tool CSS`);
    } else if (Math.max(...shared) > Math.min(...own)) {
      const name = (i) => (page.css[i].startsWith('inline:') ? `<style> (${page.css[i].length - 7} chars)` : page.css[i]);
      problems.push(`${page.path}: tool CSS ${name(Math.min(...own))} comes before shared tool CSS ${name(Math.max(...shared))}`);
    }
  }
  return { checked, problems };
}

function walkHtml(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function isToolPageFile(distDir, file) {
  const rel = file.slice(distDir.length + 1).split('\\').join('/');
  return /^(?:zh|ja|ko\/)?tools\//.test(rel);
}

// Site-wide CSS is what every non-tool page links (BaseLayout). Tool pages are excluded
// because they add shared and per-tool CSS on top. Blog pages add ArticleLayout CSS, which
// the intersection over all non-tool pages removes.
export function siteWideResources(distDir) {
  let set = null;
  for (const file of walkHtml(distDir)) {
    if (isToolPageFile(distDir, file)) continue;
    const css = new Set(cssResources(readFileSync(file, 'utf8')).filter((r) => !r.startsWith('inline:')));
    if (css.size === 0) continue;
    set = set ? new Set([...set].filter((r) => css.has(r))) : css;
  }
  return set ?? new Set();
}

export function checkDist(distDir) {
  const siteWide = siteWideResources(distDir);
  if (siteWide.size === 0) throw new Error('no site-wide CSS found on non-tool pages');
  const pages = listToolPages(distDir).map((p) => ({ ...p, css: cssResources(readFileSync(p.file, 'utf8')) }));
  if (pages.length === 0) throw new Error(`no tool pages found in ${distDir}`);
  const problems = [];
  for (const r of siteWide) {
    if (!/^\/_astro\/site\.[A-Za-z0-9_-]{8}\.css$/.test(r)) {
      problems.push(`site CSS ${r} is not named site.<hash>.css; run scripts/rename-css-chunks.mjs`);
    }
  }
  for (const page of pages) {
    for (const r of page.css) {
      if (r.startsWith('/_astro/_slug_')) {
        problems.push(`${page.path}: CSS chunk ${r} still carries the first-parent name; run scripts/rename-css-chunks.mjs`);
      }
    }
  }
  const result = checkOrder(pages, siteWide);
  const unique = [...new Set([...problems, ...result.problems])];
  return { pages: pages.length, checked: result.checked, problems: unique };
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
    console.error(`check-tool-css-order: ${result.problems.length} problem(s) in tool page CSS`);
    for (const p of result.problems.slice(0, 20)) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`check-tool-css-order: ${result.pages} tool pages, no inline <style> in <head>, ${result.checked} with own tool CSS, site CSS first and shared tool CSS before own tool CSS on all`);
}
