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

function parseToolComponentMap(filePath) {
  const src = read(filePath);
  // Imports: tolerant to either route-relative paths (`../../components/tools/X.astro`)
  // or registry-relative paths (`./X.astro`). We store identifier -> filename so
  // downstream checks can validate component references without assuming the
  // identifier and the file basename are spelled identically.
  const imports = new Map();
  for (const m of src.matchAll(/^import\s+(\w+)\s+from\s+['"](?:[^'"]*\/)?(\w+)\.astro['"]/gm)) {
    imports.set(m[1], m[2]);
  }
  // Map keys + component refs (`export const toolComponentMap` in registry.ts).
  // Closing `};` may appear with or without a trailing newline depending on
  // formatting, so tolerate both.
  const mapMatch = src.match(/(?:export\s+)?const\s+toolComponentMap\b[\s\S]*?=\s*\{([\s\S]*?)\};/);
  if (!mapMatch) throw new Error(`No toolComponentMap in ${filePath}`);
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
  const registryPath = 'src/components/tools/registry.ts';

  if (!existsSync(join(ROOT, registryPath))) {
    fail('registry', 'shared toolComponentMap registry', [`${registryPath} does not exist`]);
    return;
  }

  const allComponents = new Set(
    listFiles('src/components/tools')
      .filter(f => f.endsWith('.astro'))
      .map(f => f.replace(/\.astro$/, ''))
  );

  const { imports, map } = parseToolComponentMap(registryPath);

  const registryIssues = [];
  for (const slug of toolSlugs) {
    if (!map.has(slug)) registryIssues.push(`${slug}: missing in toolComponentMap`);
  }
  for (const [, filename] of imports) {
    if (!allComponents.has(filename)) registryIssues.push(`import target missing: ${filename}.astro`);
  }
  for (const [slug, comp] of map) {
    if (!imports.has(comp)) registryIssues.push(`${slug}: maps to "${comp}" which is not imported`);
  }
  for (const slug of map.keys()) {
    if (!toolSlugs.has(slug)) registryIssues.push(`${slug}: map entry has no matching slug in tools.ts (dead alias — handle aliases via _redirects instead)`);
  }
  if (registryIssues.length === 0) pass('registry', `${registryPath} (${map.size} mappings)`);
  else fail('registry', registryPath, registryIssues);

  // Each route must import the shared registry rather than maintain its own map.
  for (const route of routes) {
    if (!existsSync(join(ROOT, route))) {
      fail(`route_${route}`, `route file ${route}`, ['file does not exist']);
      continue;
    }
    const src = read(route);
    if (!/from\s+['"][^'"]*components\/tools\/registry['"]/.test(src)) {
      fail(`route:${route}`, route, ['does not import { toolComponentMap } from the shared registry']);
    } else {
      pass(`route:${route}`, route);
    }
  }

  // Orphan components: present in src/components/tools/ but not pulled into the
  // registry. Compare against imported filenames (not identifiers), so a future
  // mismatch between the two also surfaces here.
  const importedFilenames = new Set(imports.values());
  const orphans = [...allComponents].filter(c => !importedFilenames.has(c));
  if (orphans.length === 0) pass('component_orphans', `component orphan check (${allComponents.size} components, all used)`);
  else fail('component_orphans', 'orphan components in src/components/tools/', orphans.map(o => `${o}.astro: not referenced in registry.ts`));
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
  // After B-migration: src/content/blog/{baseSlug}/{lang}.mdx
  const dir = 'src/content/blog';
  const baseSlugs = new Map();   // baseSlug → Set of langs
  const namingIssues = [];
  const frontmatterIssues = [];
  let totalFiles = 0;

  for (const entry of listFiles(dir)) {
    const abs = join(ROOT, dir, entry);
    if (!statSync(abs).isDirectory()) {
      namingIssues.push(`${entry}: loose file at blog root (must live in {baseSlug}/{lang}.mdx structure)`);
      continue;
    }
    const baseSlug = entry;
    const langs = new Set();

    for (const file of listFiles(`${dir}/${entry}`)) {
      if (!/\.mdx?$/.test(file)) continue;
      totalFiles++;
      const m = file.match(/^(en|zh|ja|ko)\.mdx?$/);
      if (!m) {
        namingIssues.push(`${entry}/${file}: filename must be {en|zh|ja|ko}.mdx`);
        continue;
      }
      const lang = m[1];
      langs.add(lang);

      const src = read(`${dir}/${entry}/${file}`);
      const fm = parseFrontmatter(src);
      if (!fm) {
        frontmatterIssues.push(`${entry}/${file}: missing or malformed frontmatter`);
        continue;
      }
      if (!fm.title) frontmatterIssues.push(`${entry}/${file}: missing title`);
      if (!fm.description) frontmatterIssues.push(`${entry}/${file}: missing description`);
      if (!fm.pubDate) frontmatterIssues.push(`${entry}/${file}: missing pubDate`);

      const fmLang = fm.lang || 'en';
      if (fmLang !== lang) {
        frontmatterIssues.push(`${entry}/${file}: frontmatter lang="${fmLang}" but filename implies "${lang}"`);
      }
    }
    baseSlugs.set(baseSlug, langs);
  }
  // Provide a synthetic file count for downstream PASS message
  const files = { length: totalFiles };

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

// Internal links inside blog mdx must match the file's own language. A zh.mdx
// linking `](/tools/foo)` ships readers to the EN tool page, breaking site
// language continuity and weakening hreflang signals. Rule:
//   zh|ja|ko.mdx ─ ](/tools|/category|/blog/...)            → FAIL
//   en.mdx       ─ ](/zh|/ja|/ko/...)                       → FAIL (reverse)
// Correct form: ](/{lang}/tools/{slug}/) for non-EN; ](/tools/{slug}/) for EN.
function checkBlogInternalLinks() {
  const dir = 'src/content/blog';
  const issues = [];
  const wrongInNonEn = /\]\((\/(?:tools|category|blog)\/[^)]+)\)/g;
  const wrongInEn = /\]\((\/(?:zh|ja|ko)\/[^)]+)\)/g;

  for (const entry of listFiles(dir)) {
    const abs = join(ROOT, dir, entry);
    if (!statSync(abs).isDirectory()) continue;

    for (const file of listFiles(`${dir}/${entry}`)) {
      const fm = file.match(/^(en|zh|ja|ko)\.mdx?$/);
      if (!fm) continue;
      const lang = fm[1];
      const relPath = `${dir}/${entry}/${file}`;
      const lines = read(relPath).split('\n');
      const re = lang === 'en' ? wrongInEn : wrongInNonEn;

      lines.forEach((line, idx) => {
        const lineRe = new RegExp(re.source, 'g');
        let mm;
        while ((mm = lineRe.exec(line)) !== null) {
          const url = mm[1];
          if (lang === 'en') {
            issues.push(`${relPath}:${idx + 1}: en file links to ${url} (en mdx must not point to /zh|/ja|/ko paths)`);
          } else {
            issues.push(`${relPath}:${idx + 1}: ${lang} file links to ${url} (should be /${lang}${url}/)`);
          }
        }
      });
    }
  }

  if (issues.length === 0) pass('blog_internal_links', 'blog internal links language-prefix check');
  else fail('blog_internal_links', 'blog internal links missing language prefix', issues);
}

// Layouts that render markdown/MDX must override Shiki's inline `style="..."`
// on <pre> and <span> with !important — otherwise the default github-dark
// theme bleeds dark backgrounds into light-mode pages and text becomes
// unreadable. ToolLayout had this for tool pages; ArticleLayout was missing
// it (2026-04-28 incident on blog pages).
function checkLayoutShikiOverride() {
  const issues = [];
  const layoutDir = 'src/layouts';
  const layoutPath = join(ROOT, layoutDir);
  if (!existsSync(layoutPath)) {
    pass('layout_shiki_override', 'layout Shiki override (no layouts dir)');
    return;
  }
  for (const file of readdirSync(layoutPath)) {
    if (!file.endsWith('.astro')) continue;
    const text = read(`${layoutDir}/${file}`);
    if (!/:global\(pre\)/.test(text)) continue;

    const preBlock = text.match(/:global\(pre\)\s*\{[^}]*\}/);
    if (preBlock && !/background[^;}]*!important/.test(preBlock[0])) {
      issues.push(`${file}: :global(pre) background lacks !important — Shiki inline style will win in light mode`);
    }

    const preCodeBlock = text.match(/:global\(pre code\)\s*\{[^}]*\}/);
    if (preCodeBlock) {
      if (!/background[^;}]*!important/.test(preCodeBlock[0])) {
        issues.push(`${file}: :global(pre code) background lacks !important`);
      }
      if (!/color[^;}]*!important/.test(preCodeBlock[0])) {
        issues.push(`${file}: :global(pre code) color lacks !important`);
      }
    }

    if (!/:global\(pre code \*\)/.test(text)) {
      issues.push(`${file}: missing :global(pre code *) selector — Shiki span colors will leak through`);
    }
  }
  if (issues.length === 0) pass('layout_shiki_override', 'layout Shiki override (pre/code !important guard)');
  else fail('layout_shiki_override', 'layout Shiki override missing', issues);
}

function checkPersistencePolicy() {
  const issues = [];

  const policySrc = read('src/data/persistence.ts');
  const policyMatch = policySrc.match(/export const toolPersistencePolicy\s*=\s*\{([\s\S]*?)\}\s+as const/);
  if (!policyMatch) {
    fail('persist_policy', 'ztPersist policy', ['Cannot find toolPersistencePolicy object in src/data/persistence.ts']);
    return;
  }
  const policy = {};
  const entryRegex = /'([^']+)':\s*'(input|preference|disabled)'/g;
  let em;
  while ((em = entryRegex.exec(policyMatch[1])) !== null) {
    policy[em[1]] = em[2];
  }

  const baseLayoutSrc = read('src/layouts/BaseLayout.astro');
  const toolLayoutSrc = read('src/layouts/ToolLayout.astro');
  if (!baseLayoutSrc.includes('disabledPersistenceSlugs')) {
    issues.push('BaseLayout.astro: early privacy wipe must use disabledPersistenceSlugs from src/data/persistence.ts');
  }
  if (!toolLayoutSrc.includes('toolPersistencePolicy')) {
    issues.push('ToolLayout.astro: ztPersist must use toolPersistencePolicy from src/data/persistence.ts');
  }

  const toolDir = join(ROOT, 'src/components/tools');
  const files = readdirSync(toolDir).filter(f => f.endsWith('.astro'));

  for (const file of files) {
    const src = read(`src/components/tools/${file}`);

    const directLs = src.match(/localStorage\.(setItem|getItem|removeItem)\s*\(/g);
    if (directLs && directLs.length > 0) {
      issues.push(`${file}: ${directLs.length} direct localStorage call(s); use window.ztPersist instead`);
    }

    const saveLits = [...src.matchAll(/ztPersist\.save\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    const loadLits = [...src.matchAll(/ztPersist\.load\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    // Tools that hold the slug in a variable (e.g. `var _slug = 'json-formatter'`)
    // — capture those bindings so policy lookup still works.
    const varBindings = [...src.matchAll(/\b(?:var|let|const)\s+(?:_slug|SLUG|slug)\s*=\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    const literalSlugs = [...new Set([...saveLits, ...loadLits, ...varBindings])];

    for (const slug of literalSlugs) {
      if (policy[slug] === 'disabled') {
        issues.push(`${file}: slug "${slug}" is policy=disabled but ztPersist.save/load is wired`);
      }
    }

    const hasSave = /ztPersist\.save\s*\(/.test(src);
    const hasClear = /ztPersist\.clear\s*\(/.test(src);
    if (hasSave && !hasClear) {
      const isAllPreference = literalSlugs.length > 0 && literalSlugs.every(s => policy[s] === 'preference');
      if (!isAllPreference) {
        const slugStr = literalSlugs.length > 0 ? `slug(s) "${literalSlugs.join(', ')}"` : 'unknown slug (variable)';
        issues.push(`${file}: ztPersist.save without ztPersist.clear (${slugStr}); Clear button should sync-clear`);
      }
    }
  }

  if (issues.length === 0) {
    pass('persist_policy', `ztPersist policy compliance (${Object.keys(policy).length} slugs declared, ${files.length} components scanned)`);
  } else {
    fail('persist_policy', 'ztPersist policy violations', issues);
  }
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
  checkBlogInternalLinks();
  checkLayoutShikiOverride();
  checkPersistencePolicy();
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
