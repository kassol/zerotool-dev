// MDX code literal — built pages keep the quotes, dashes and dots that the source wrote
//
// Read:  every dist/**/*.html (run `npm run build` first), astro.config.mjs,
//        src/content/{tools,blog}/**/*.mdx and the other text files under src/
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: remark-smartypants (Astro's default for Markdown and MDX) changed every text
// node, including the text inside HTML <code> / <pre> written in MDX: "x" became “x”,
// -- became —, ... became …, so copied code was wrong. astro.config.mjs now sets
// markdown.smartypants: false (the MDX integration extends the Markdown config).
//
// 1. astro.config.mjs keeps `smartypants: false`.
// 2. No curly quote (U+2018 U+2019 U+201C U+201D), en / em dash (U+2013 U+2014) or
//    ellipsis (U+2026) inside <code> / <pre> that the source did not write.
//    Allow list: a character is allowed when the character and its neighbours (up to
//    3 characters before and 4 after, on the same line) appear literally in the page's
//    own MDX file (tools/{slug}/{lang}.mdx or blog/{dir}/{lang}.mdx) or in a non-content
//    file under src/ (components, layouts, data, i18n). On 2026-10-09 these were 982
//    characters on 313 pages, all typed as Unicode in the source: "…" as a placeholder
//    (`sk-ant-…`, `Bearer …`, `nonce="…"`), "—" as an empty table cell or a real dash
//    in sample text, “ ” ‘ ’ when the page talks about those characters. With
//    smartypants on (the v1.140.10 build), 943 of the 1,958 characters in code fail this check.
// 3. Known pages show the literal text (each was curly or dashed before the fix).
//
// Run: node scripts/test-mdx-code-literal.mjs   (--list prints every allowed character;
//      --dist <dir> checks another build)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distArg = process.argv.indexOf('--dist');
const dist = distArg > 0 ? process.argv[distArg + 1] : join(root, 'dist');
const LIST = process.argv.includes('--list');

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}

if (!existsSync(join(dist, 'index.html'))) {
  console.log('FAIL  dist/ not found — run `npm run build` first');
  process.exit(1);
}

// 1. Config
const config = readFileSync(join(root, 'astro.config.mjs'), 'utf8');
check('astro.config.mjs sets markdown.smartypants: false',
  /markdown:\s*\{[^}]*smartypants:\s*false/.test(config));
check('the mdx() integration does not turn smartypants back on',
  !/mdx\(\{[^)]*smartypants:\s*true/.test(config));

// Helpers
function walk(dir, keep, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');

// Text of each outermost <code> / <pre> element, scripts and styles removed.
function codeTexts(html) {
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const out = [];
  let depth = 0;
  let text = '';
  for (const tok of html.split(/(<[^>]*>)/)) {
    if (tok.startsWith('<')) {
      const m = /^<(\/?)(?:code|pre)\b/i.exec(tok);
      if (!m) continue;
      const was = depth;
      depth = Math.max(0, depth + (m[1] ? -1 : 1));
      if (was === 0 && depth > 0) text = '';
      if (was > 0 && depth === 0) out.push(text);
      continue;
    }
    if (depth > 0) text += decode(tok);
  }
  return out;
}

// 2. Allow list derived from the source
const FANCY = /[\u2018\u2019\u201C\u201D\u2013\u2014\u2026]/g;
const srcDir = join(root, 'src');
const sharedSource = walk(srcDir, (p) => !p.startsWith(join(srcDir, 'content') + '/')
  && /\.(astro|ts|js|mjs|json)$/.test(p)).map((p) => readFileSync(p, 'utf8')).join('\n\u0000\n');
const mdxCache = new Map();
function pageMdx(page) {
  const m = /^(?:(zh|ja|ko)\/)?(tools|blog)\/([^/]+)\/index\.html$/.exec(page);
  if (!m) return '';
  const file = join(srcDir, 'content', m[2], m[3], `${m[1] || 'en'}.mdx`);
  if (!mdxCache.has(file)) mdxCache.set(file, existsSync(file) ? readFileSync(file, 'utf8') : '');
  return mdxCache.get(file);
}

const pages = walk(dist, (p) => p.endsWith('.html')).map((p) => relative(dist, p)).sort();
let allowed = 0;
let codeSegments = 0;
const allowedPages = new Set();
const byChar = {};
const bad = [];
for (const page of pages) {
  const mdx = pageMdx(page);
  for (const text of codeTexts(readFileSync(join(dist, page), 'utf8'))) {
    codeSegments++;
    for (const m of text.matchAll(FANCY)) {
      const i = m.index;
      let a = i;
      let b = i + 1;
      while (a > 0 && i - a < 3 && text[a - 1] !== '\n') a--;
      while (b < text.length && b - i < 4 && text[b] !== '\n') b++;
      const window = text.slice(a, b);
      const from = mdx.includes(window) ? 'mdx' : sharedSource.includes(window) ? 'shared' : null;
      if (!from) { bad.push(`${page}: ${JSON.stringify(window)} in ${JSON.stringify(text.slice(0, 80))}`); continue; }
      allowed++;
      allowedPages.add(page);
      const key = `U+${m[0].codePointAt(0).toString(16).toUpperCase()} ${from}`;
      byChar[key] = (byChar[key] || 0) + 1;
      if (LIST) console.log(`allow ${page}: ${JSON.stringify(window)} (${from})`);
    }
  }
}
check('the build has code elements to scan', codeSegments > 1000, String(codeSegments));
check('no curly quote, dash or ellipsis in <code> / <pre> that the source did not write',
  bad.length === 0, `${bad.length} found:\n  ${bad.slice(0, 20).join('\n  ')}`);

// 3. Known pages, literal text
function hasCode(page, expected) {
  const file = join(dist, page);
  const texts = existsSync(file) ? codeTexts(readFileSync(file, 'utf8')) : [];
  check(`${page} shows <code>${expected}</code>`, texts.includes(expected),
    texts.length ? 'not among ' + texts.length + ' code elements' : 'page missing');
}
hasCode('tools/css-specificity-calculator/index.html', 'a[href="#top"]');
hasCode('tools/css-variables-generator/index.html',
  '.card { padding: var(--space-4); border-radius: var(--radius-md); }');
hasCode('zh/tools/typescript-to-zod/index.html', '"a" | "b" | "c"');
hasCode('zh/tools/typescript-to-zod/index.html', 'z.enum(["a", "b", "c"])');
hasCode('tools/svg-to-png-converter/index.html', 'width="120" height="60"');
hasCode('tools/basic-auth-header-generator/index.html', "curl -u 'Aladdin:open sesame' URL");

console.log(`allowed source characters in code: ${allowed} on ${allowedPages.size} pages ` +
  JSON.stringify(byChar));
console.log(`${passes} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
