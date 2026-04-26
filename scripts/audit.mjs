#!/usr/bin/env node
/**
 * audit.mjs — comprehensive static audit
 *
 * Validates project consistency across tools, content, routes, i18n, and blog.
 * Designed to run locally and in CI. Exit code:
 *   0 — all checks PASS or WARN
 *   1 — any check FAIL
 *
 * Usage:
 *   node scripts/audit.mjs            # full report, exits non-zero on FAIL
 *   node scripts/audit.mjs --json     # JSON output for tooling
 *   node scripts/audit.mjs --quiet    # only print summary + failures
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARGS = new Set(process.argv.slice(2));
const JSON_MODE = ARGS.has('--json');
const QUIET = ARGS.has('--quiet');

const LANGS = ['en', 'zh', 'ja', 'ko'];
const NON_EN_LANGS = ['zh', 'ja', 'ko'];
const BASE_PAGES = ['about', 'contact', 'privacy', 'terms', 'index'];

// Categories are read from the ToolInfo type declaration in tools.ts so the
// type definition stays the single source of truth. UI filter is read from
// CategoryFilter.astro and cross-checked against the type.
function readDeclaredCategories() {
  const src = read('src/data/tools.ts');
  const m = src.match(/category:\s*([^;\n]+);/);
  if (!m) throw new Error('Cannot find category union type in src/data/tools.ts');
  return m[1].split('|').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}

function readUiCategories() {
  const src = read('src/components/CategoryFilter.astro');
  const m = src.match(/const categories\s*=\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/['"`]/g, '')).filter(s => s && s !== 'all');
}

// ─────────────────────────────────────────────────────────────────────────────
// Result accumulator
// ─────────────────────────────────────────────────────────────────────────────

const checks = [];

function record(id, name, status, issues = [], detail = '') {
  checks.push({ id, name, status, issues, detail });
}

function pass(id, name, detail = '') { record(id, name, 'PASS', [], detail); }
function warn(id, name, issues, detail = '') { record(id, name, 'WARN', issues, detail); }
function fail(id, name, issues, detail = '') { record(id, name, 'FAIL', issues, detail); }

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function listFiles(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter(f => !f.startsWith('.') && f !== 'AGENTS.md');
}

// Parse tools.ts by extracting allTools array literal and evaluating each entry
// as a JS object. This relies on tools.ts entries being plain literals (no
// TypeScript-only syntax like `as` casts within the array body).
function parseTools() {
  const src = read('src/data/tools.ts');
  const m = src.match(/export const allTools[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!m) throw new Error('Cannot locate allTools array in src/data/tools.ts');

  const body = m[1];
  const blocks = [];
  let depth = 0, start = -1, inStr = false, strChar = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === strChar) inStr = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = true; strChar = c; continue; }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) blocks.push(body.slice(start, i + 1));
    }
  }

  return blocks.map((block, idx) => {
    try {
      // eslint-disable-next-line no-new-func
      return new Function(`return ${block}`)();
    } catch (e) {
      throw new Error(`Failed to parse tool entry #${idx}: ${e.message}\n${block.slice(0, 200)}`);
    }
  });
}

function parseIcons() {
  const src = read('src/data/icons.ts');
  const matches = [...src.matchAll(/'([^']+)':\s*'<svg/g)];
  return new Set(matches.map(m => m[1]));
}

function parseToolComponentMap(routePath) {
  const src = read(routePath);
  // imports
  const imports = new Set();
  for (const m of src.matchAll(/^import\s+(\w+)\s+from\s+'\.\.\/(?:\.\.\/)*components\/tools\/(\w+)\.astro'/gm)) {
    imports.add(m[2]);
  }
  // map keys + component refs (non-greedy across the type annotation that may contain `=>`)
  const mapMatch = src.match(/const\s+toolComponentMap\b[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!mapMatch) throw new Error(`No toolComponentMap in ${routePath}`);
  const entries = [...mapMatch[1].matchAll(/'([^']+)':\s*(\w+)/g)];
  const map = new Map();
  for (const m of entries) map.set(m[1], m[2]);
  return { imports, map };
}

function parseFrontmatter(src) {
  const m = src.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return null;
  const yaml = m[1];
  const obj = {};
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    obj[k] = v;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checks
// ─────────────────────────────────────────────────────────────────────────────

function checkToolsSchema(tools, validCategories) {
  const issues = [];
  const slugs = new Set();

  for (const t of tools) {
    if (!t.slug || typeof t.slug !== 'string') {
      issues.push(`tool entry missing slug: ${JSON.stringify(t).slice(0, 80)}`);
      continue;
    }
    if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(t.slug)) {
      issues.push(`${t.slug}: invalid slug format (must be kebab-case [a-z0-9-])`);
    }
    if (slugs.has(t.slug)) issues.push(`${t.slug}: duplicate slug`);
    slugs.add(t.slug);

    if (!t.translations) {
      issues.push(`${t.slug}: missing translations`);
      continue;
    }
    for (const lang of LANGS) {
      const tr = t.translations[lang];
      if (!tr) {
        issues.push(`${t.slug}: missing ${lang} translation`);
        continue;
      }
      if (!tr.name?.trim()) issues.push(`${t.slug}/${lang}: empty name`);
      if (!tr.description?.trim()) issues.push(`${t.slug}/${lang}: empty description`);
    }

    if (!validCategories.includes(t.category)) {
      issues.push(`${t.slug}: category "${t.category}" not declared in ToolInfo type (declared: ${validCategories.join(', ')})`);
    }

    if (t.relatedSlugs) {
      if (!Array.isArray(t.relatedSlugs)) {
        issues.push(`${t.slug}: relatedSlugs must be array`);
      }
    }
  }

  // Cross-validate relatedSlugs against the slug universe
  for (const t of tools) {
    if (!Array.isArray(t.relatedSlugs)) continue;
    for (const r of t.relatedSlugs) {
      if (!slugs.has(r)) issues.push(`${t.slug}: relatedSlugs references unknown slug "${r}"`);
    }
  }

  if (issues.length === 0) pass('tools_schema', `tools.ts schema (${tools.length} tools)`);
  else fail('tools_schema', 'tools.ts schema', issues);
  return slugs;
}

function checkIconCoverage(toolSlugs) {
  const iconKeys = parseIcons();
  const issues = [];
  for (const s of toolSlugs) {
    if (!iconKeys.has(s)) issues.push(`${s}: missing icon in icons.ts`);
  }
  for (const k of iconKeys) {
    if (!toolSlugs.has(k)) issues.push(`${k}: orphan icon (no matching tool slug)`);
  }
  if (issues.length === 0) pass('icon_coverage', `icons.ts coverage (${iconKeys.size} icons)`);
  else fail('icon_coverage', 'icons.ts coverage', issues);
}

function checkRouteRegistration(toolSlugs) {
  const routes = [
    'src/pages/tools/[slug].astro',
    'src/pages/zh/tools/[slug].astro',
    'src/pages/ja/tools/[slug].astro',
    'src/pages/ko/tools/[slug].astro',
  ];

  const allComponents = new Set(
    listFiles('src/components/tools')
      .filter(f => f.endsWith('.astro'))
      .map(f => f.replace(/\.astro$/, ''))
  );

  const usedComponents = new Set();

  for (const route of routes) {
    if (!existsSync(join(ROOT, route))) {
      fail(`route_${route}`, `route file ${route}`, ['file does not exist']);
      continue;
    }
    const issues = [];
    const { imports, map } = parseToolComponentMap(route);

    // Every tool slug must have a map entry
    for (const slug of toolSlugs) {
      if (!map.has(slug)) issues.push(`${slug}: missing in toolComponentMap`);
    }

    // Every imported component file must exist
    for (const comp of imports) {
      if (!allComponents.has(comp)) issues.push(`import target missing: ${comp}.astro`);
      usedComponents.add(comp);
    }

    // Every map entry must reference an imported component
    for (const [slug, comp] of map) {
      if (!imports.has(comp)) issues.push(`${slug}: maps to "${comp}" which is not imported`);
    }

    if (issues.length === 0) pass(`route:${route}`, route);
    else fail(`route:${route}`, route, issues);
  }

  // Orphan components: present in src/components/tools/ but not used by any route
  const orphans = [...allComponents].filter(c => !usedComponents.has(c));
  if (orphans.length === 0) pass('component_orphans', `component orphan check (${allComponents.size} components, all used)`);
  else fail('component_orphans', 'orphan components in src/components/tools/', orphans.map(o => `${o}.astro: not referenced by any [slug].astro route`));
}

function checkContentTools(toolSlugs) {
  const dir = 'src/content/tools';
  const dirs = listFiles(dir).filter(f => statSync(join(ROOT, dir, f)).isDirectory());
  const issues = [];

  for (const slug of toolSlugs) {
    if (!dirs.includes(slug)) {
      issues.push(`${slug}: missing src/content/tools/${slug}/ directory`);
      continue;
    }
    const langFiles = listFiles(`${dir}/${slug}`);
    for (const lang of LANGS) {
      if (!langFiles.includes(`${lang}.mdx`)) {
        issues.push(`${slug}: missing src/content/tools/${slug}/${lang}.mdx`);
      }
    }
  }

  // Orphan content directories
  for (const d of dirs) {
    if (!toolSlugs.has(d)) issues.push(`${d}: orphan content/tools directory (no matching slug)`);
  }

  if (issues.length === 0) pass('content_tools', `content/tools coverage (${dirs.length} dirs × ${LANGS.length} langs)`);
  else fail('content_tools', 'content/tools coverage', issues);
}

function checkCategoryFilterAlignment(declaredCategories, tools) {
  const ui = readUiCategories();
  const issues = [];
  if (!ui) {
    fail('category_filter_ui', 'CategoryFilter parse', ['could not parse categories array in CategoryFilter.astro']);
    return;
  }
  const usedInData = new Set(tools.map(t => t.category));

  for (const c of declaredCategories) {
    if (!ui.includes(c)) issues.push(`type-declared "${c}" missing from CategoryFilter UI`);
  }
  for (const c of ui) {
    if (!declaredCategories.includes(c)) issues.push(`UI-declared "${c}" missing from ToolInfo type union`);
  }
  for (const c of usedInData) {
    if (!ui.includes(c)) {
      const tools_in_cat = tools.filter(t => t.category === c).map(t => t.slug);
      issues.push(`category "${c}" is used by ${tools_in_cat.length} tool(s) but absent from UI filter — those tools cannot be filtered: ${tools_in_cat.join(', ')}`);
    }
  }

  if (issues.length === 0) pass('category_filter_alignment', `category type ↔ UI alignment (${ui.length} categories)`);
  else fail('category_filter_alignment', 'category type ↔ UI alignment', issues);
}

function checkBasePages() {
  const issues = [];

  // EN base pages live at src/pages/{name}.astro
  for (const page of BASE_PAGES) {
    if (page === 'index') {
      if (!existsSync(join(ROOT, 'src/pages/index.astro'))) issues.push(`en: missing index.astro`);
    } else {
      if (!existsSync(join(ROOT, `src/pages/${page}.astro`))) issues.push(`en: missing ${page}.astro`);
    }
  }

  // Non-EN base pages live at src/pages/{lang}/{name}.astro
  for (const lang of NON_EN_LANGS) {
    for (const page of BASE_PAGES) {
      if (!existsSync(join(ROOT, `src/pages/${lang}/${page}.astro`))) {
        issues.push(`${lang}: missing ${page}.astro`);
      }
    }
  }

  if (issues.length === 0) pass('base_pages', `base pages × 4 langs (${BASE_PAGES.length} pages)`);
  else fail('base_pages', 'base pages multilingual coverage', issues);
}

function checkI18nKeys() {
  const data = {};
  for (const lang of LANGS) {
    data[lang] = JSON.parse(read(`src/i18n/${lang}.json`));
  }
  const allKeys = new Set();
  for (const lang of LANGS) for (const k of Object.keys(data[lang])) allKeys.add(k);

  const issues = [];
  for (const lang of LANGS) {
    for (const k of allKeys) {
      if (!(k in data[lang])) issues.push(`${lang}.json: missing key "${k}"`);
      else if (typeof data[lang][k] !== 'string' || !data[lang][k].trim()) {
        issues.push(`${lang}.json: key "${k}" is empty or non-string`);
      }
    }
  }

  if (issues.length === 0) pass('i18n_keys', `i18n key alignment (${allKeys.size} keys × 4 langs)`);
  else fail('i18n_keys', 'i18n key alignment', issues);
}

function checkBlog() {
  const dir = 'src/content/blog';
  const files = listFiles(dir).filter(f => f.endsWith('.mdx') || f.endsWith('.md'));

  const namingIssues = [];
  const frontmatterIssues = [];
  const baseSlugs = new Map();   // baseSlug → Set of langs

  for (const file of files) {
    const m = file.match(/^(.+?)(?:-(zh|ja|ko))?\.mdx?$/);
    if (!m) {
      namingIssues.push(`${file}: unrecognized name`);
      continue;
    }
    const baseSlug = m[1];
    const lang = m[2] || 'en';

    if (!baseSlugs.has(baseSlug)) baseSlugs.set(baseSlug, new Set());
    baseSlugs.get(baseSlug).add(lang);

    // Frontmatter check
    const src = read(`${dir}/${file}`);
    const fm = parseFrontmatter(src);
    if (!fm) {
      frontmatterIssues.push(`${file}: missing or malformed frontmatter`);
      continue;
    }
    if (!fm.title) frontmatterIssues.push(`${file}: missing title`);
    if (!fm.description) frontmatterIssues.push(`${file}: missing description`);
    if (!fm.pubDate) frontmatterIssues.push(`${file}: missing pubDate`);

    const fmLang = fm.lang || 'en';
    if (fmLang !== lang) {
      frontmatterIssues.push(`${file}: frontmatter lang="${fmLang}" but filename suffix implies "${lang}"`);
    }
  }

  if (namingIssues.length === 0) pass('blog_naming', `blog file naming (${files.length} files)`);
  else fail('blog_naming', 'blog file naming convention', namingIssues);

  if (frontmatterIssues.length === 0) pass('blog_frontmatter', `blog frontmatter integrity`);
  else fail('blog_frontmatter', 'blog frontmatter integrity', frontmatterIssues);

  // Coverage: every base-slug must have EN; non-EN languages are warnings
  const enMissing = [];
  const langGaps = [];
  for (const [base, langs] of baseSlugs) {
    if (!langs.has('en')) enMissing.push(`${base}: has non-EN translations but no EN base`);
    for (const lang of NON_EN_LANGS) {
      if (!langs.has(lang)) langGaps.push(`${base}: missing ${lang} translation`);
    }
  }

  if (enMissing.length === 0) pass('blog_en_baseline', `blog EN baseline (${baseSlugs.size} base slugs)`);
  else fail('blog_en_baseline', 'blog EN baseline', enMissing);

  if (langGaps.length === 0) pass('blog_lang_coverage', `blog full multilingual coverage`);
  else warn('blog_lang_coverage', 'blog multilingual gaps (non-blocking)', langGaps,
    `${langGaps.length} translation gaps across ${baseSlugs.size} base slugs`);
}

function checkRedirects() {
  const issues = [];
  const path = 'public/_redirects';
  if (!existsSync(join(ROOT, path))) {
    fail('redirects_file', '_redirects file', ['public/_redirects does not exist']);
    return;
  }
  const lines = read(path).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) {
      issues.push(`line ${i + 1}: malformed redirect "${line}"`);
      continue;
    }
    const status = parts[2];
    if (status && !/^(200|30[1-8])$/.test(status)) {
      issues.push(`line ${i + 1}: unusual status code "${status}"`);
    }
  }
  if (issues.length === 0) pass('redirects_format', `_redirects format (${lines.length} lines)`);
  else warn('redirects_format', '_redirects format anomalies', issues);
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

let toolSlugs;
try {
  const tools = parseTools();
  const declaredCategories = readDeclaredCategories();
  toolSlugs = checkToolsSchema(tools, declaredCategories);
  checkIconCoverage(toolSlugs);
  checkRouteRegistration(toolSlugs);
  checkContentTools(toolSlugs);
  checkCategoryFilterAlignment(declaredCategories, tools);
  checkBasePages();
  checkI18nKeys();
  checkBlog();
  checkRedirects();
} catch (e) {
  fail('fatal', 'audit setup', [e.message, e.stack].filter(Boolean));
}

// ─────────────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────────────

const summary = {
  total: checks.length,
  pass: checks.filter(c => c.status === 'PASS').length,
  warn: checks.filter(c => c.status === 'WARN').length,
  fail: checks.filter(c => c.status === 'FAIL').length,
};

if (JSON_MODE) {
  console.log(JSON.stringify({ summary, checks }, null, 2));
} else {
  const ICON = { PASS: 'ok', WARN: '!!', FAIL: 'XX' };
  if (!QUIET) {
    console.log(`\n# ZeroTool Audit Report\n`);
    console.log(`Date: ${new Date().toISOString()}\n`);
  }

  // Detail listing
  for (const c of checks) {
    if (QUIET && c.status === 'PASS') continue;
    console.log(`[${ICON[c.status]}] ${c.status} — ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    if (c.issues.length > 0) {
      const shown = c.issues.slice(0, 50);
      for (const issue of shown) console.log(`     - ${issue}`);
      if (c.issues.length > shown.length) {
        console.log(`     ... ${c.issues.length - shown.length} more`);
      }
    }
  }

  console.log(`\n## Summary`);
  console.log(`PASS: ${summary.pass}  WARN: ${summary.warn}  FAIL: ${summary.fail}  (total ${summary.total})`);
}

process.exit(summary.fail > 0 ? 1 : 0);
