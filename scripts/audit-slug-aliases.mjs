#!/usr/bin/env node
/**
 * audit-slug-aliases.mjs
 * Audits slug alias coverage and reports (or writes) missing redirects.
 *
 * Usage:
 *   node scripts/audit-slug-aliases.mjs          # report only
 *   node scripts/audit-slug-aliases.mjs --write  # report + append to _redirects
 */

import { readFileSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WRITE_MODE = process.argv.includes('--write');

// ---------------------------------------------------------------------------
// 1. Parse tools.ts → [{ slug, name }]
// ---------------------------------------------------------------------------
const toolsTs = readFileSync(join(ROOT, 'src/data/tools.ts'), 'utf8');

const toolEntries = [];
const slugRe = /slug:\s*'([^']+)'/g;
let m;
while ((m = slugRe.exec(toolsTs)) !== null) {
  const slug = m[1];
  const after = toolsTs.slice(m.index, m.index + 800);
  const nameMatch = after.match(/en:\s*\{\s*name:\s*'([^']+)'/);
  if (nameMatch) toolEntries.push({ slug, name: nameMatch[1] });
}

// ---------------------------------------------------------------------------
// 2. Parse _redirects → Set of already-covered alias slugs (no lang, no slash)
// ---------------------------------------------------------------------------
const redirectsPath = join(ROOT, 'public/_redirects');
const redirectsRaw = readFileSync(redirectsPath, 'utf8');

const coveredAliases = new Set();
for (const line of redirectsRaw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const match = trimmed.match(/^\/(?:(?:zh|ja|ko)\/)?tools\/([^\s/]+)\/?/);
  if (match) coveredAliases.add(match[1]);
}

// ---------------------------------------------------------------------------
// 3. Alias generation: name-derived + hand-curated extras
// ---------------------------------------------------------------------------
function toKebab(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Hand-curated: aliases that real users are likely to type but that are NOT
// derivable from the English name alone. Derived from issue history (STA-509,
// STA-527, STA-542) and common search patterns.
const EXTRAS = {
  'lorem-ipsum':          ['lorem-ipsum-generator'],
  'rsa-key-generator':    ['rsa-key-pair-generator', 'rsa-keygen'],
  'color-converter':      ['hex-to-rgb', 'rgb-to-hex', 'hex-rgb-converter'],
  'regex-tester':         ['regexp-tester', 'regex-checker', 'regular-expression-tester'],
  'password-generator':   ['random-password-generator', 'secure-password-generator'],
  'chmod-calculator':     ['linux-permissions-calculator', 'file-permissions-calculator'],
  'sql-formatter':        ['sql-beautifier', 'sql-formatter-online'],
  'xml-formatter':        ['xml-beautifier', 'xml-formatter-online'],
  'ascii-converter':      ['ascii-to-text', 'text-to-ascii'],
  'curl-to-code':         ['curl-converter', 'curl-to-python', 'curl-to-javascript'],
  'json-to-zod':          ['json-to-zod-schema'],
  'env-file-parser':      ['env-parser', 'dotenv-parser', 'dotenv-viewer'],
  'css-variables-generator': ['css-variables', 'css-custom-properties-generator'],
  'css-flexbox-generator':   ['css-flexbox', 'flexbox-generator', 'flexbox-playground'],
  'json-to-json-schema':  ['json-schema-generator'],
  'morse-code-translator':['morse-translator', 'morse-code', 'morse-code-converter'],
  'aes-encrypt-decrypt':  ['aes-encryption', 'aes-encryptor', 'aes-tool'],
  'unicode-text-converter':['unicode-converter', 'fancy-text-generator'],
  'text-to-binary':       ['binary-converter', 'text-binary-converter'],
  'nato-phonetic-alphabet':['nato-alphabet', 'phonetic-alphabet-converter'],
  'string-to-slug':       ['slug-converter', 'slug-tool'],
  'slugify':              ['slug-generator', 'slugify-tool'],
  'html-to-jsx':          ['html-jsx-converter', 'react-jsx-converter'],
  'csv-to-sql':           ['csv-sql-converter', 'csv-to-insert'],
  'svg-to-jsx':           ['svg-jsx', 'svg-to-react'],
  'protobuf-to-json':     ['proto-to-json', 'protobuf-converter'],
  'json-to-kotlin':       ['json-to-kotlin-class', 'json-kotlin'],
  'json-to-java-pojo':    ['json-to-pojo', 'json-java-class'],
  'json-to-typescript':   ['json-to-ts', 'json-typescript-interface'],
  'json-to-python-dataclass': ['json-to-dataclass', 'json-python-class'],
  'csv-to-markdown':      ['csv-to-markdown-table', 'csv-markdown-table'],
  'typescript-to-zod':    ['ts-to-zod-schema'],
  'fake-data-generator':  ['test-data-generator', 'mock-data-generator', 'dummy-data-generator'],
  'url-parser':           ['url-analyzer', 'url-splitter'],
  'http-status-codes':    ['http-codes', 'status-codes', 'http-status-code-list'],
  'hmac-generator':       ['hmac', 'hmac-signature-generator'],
  'line-tools':           ['line-sorter', 'remove-duplicate-lines', 'sort-lines', 'remove-duplicates'],
  'markdown-preview':     ['markdown-editor', 'markdown-renderer', 'markdown-viewer'],
  'markdown-linter':      ['markdown-checker', 'markdown-lint'],
  'markdown-table-generator': ['markdown-table'],
  'markdown-to-word':     ['md-to-docx', 'md-to-word', 'markdown-to-word-converter'],
  'css-specificity-calculator': ['css-specificity', 'selector-specificity'],
  'css-unit-converter':   ['px-to-rem', 'rem-to-px', 'css-units'],
  'css-to-tailwind':      ['tailwind-converter', 'tailwind-css-converter', 'css-to-tailwind-converter'],
  'number-base':          ['base-converter', 'binary-hex-converter'],
  'yaml-json':            ['yaml-json-converter'],
  'csv-json':             ['csv-json-converter'],
  'diff-checker':         ['code-diff', 'file-diff'],
  'text-case':            ['case-converter'],
  'html-entity':          ['html-entity-converter'],
  'cron-parser':          ['cron-job-parser', 'cron-schedule'],
  'word-counter':         ['online-word-counter'],
  'qr-code-decoder':      ['read-qr-code', 'scan-qr-code'],
};

function generateCandidates(slug, name) {
  const candidates = new Set();

  // A) Name-derived alias (converts the English name to kebab-case)
  const nameKebab = toKebab(name);
  if (nameKebab !== slug) candidates.add(nameKebab);

  // B) Hand-curated extras
  for (const alias of (EXTRAS[slug] || [])) {
    candidates.add(alias);
  }

  // Remove the slug itself and ensure clean format
  candidates.delete(slug);

  return [...candidates].filter(
    c => c.length > 3 && /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(c) && !c.includes('--')
  );
}

// ---------------------------------------------------------------------------
// 4. Compute missing aliases
// ---------------------------------------------------------------------------
const missing = [];
for (const { slug, name } of toolEntries) {
  const candidates = generateCandidates(slug, name);
  const uncovered = candidates.filter(alias => !coveredAliases.has(alias));
  if (uncovered.length > 0) {
    missing.push({ slug, name, aliases: uncovered });
  }
}

const totalMissing = missing.reduce((s, t) => s + t.aliases.length, 0);

// ---------------------------------------------------------------------------
// 5. Print markdown report
// ---------------------------------------------------------------------------
const lines = [
  `# Slug Alias Audit Report — STA-548`,
  ``,
  `**Date:** ${new Date().toISOString().slice(0, 10)}`,
  `**Tools audited:** ${toolEntries.length}`,
  `**Existing aliases covered in _redirects:** ${coveredAliases.size}`,
  `**Tools with uncovered aliases:** ${missing.length}`,
  `**Total missing alias slugs:** ${totalMissing}`,
  `**Lines to be added to _redirects:** ${totalMissing * 8} (4 langs × 2 trailing-slash variants)`,
  ``,
  `## Missing Aliases by Tool`,
  ``,
];

for (const { slug, name, aliases } of missing) {
  lines.push(`### ${name} (\`${slug}\`)`);
  for (const alias of aliases) {
    lines.push(`- \`/tools/${alias}\` → \`/tools/${slug}/\``);
  }
  lines.push('');
}

const reportText = lines.join('\n');
console.log(reportText);

// ---------------------------------------------------------------------------
// 6. Optional: append to _redirects
// ---------------------------------------------------------------------------
if (WRITE_MODE) {
  let block = `\n# 301 redirects: batch alias补全 (STA-548)\n`;

  for (const { slug, name, aliases } of missing) {
    block += `\n# ${name} (${slug}) aliases\n`;
    for (const alias of aliases) {
      for (const lang of ['', 'zh', 'ja', 'ko']) {
        const prefix = lang ? `/${lang}` : '';
        block += `${prefix}/tools/${alias} ${prefix}/tools/${slug}/ 301\n`;
        block += `${prefix}/tools/${alias}/ ${prefix}/tools/${slug}/ 301\n`;
      }
    }
  }

  appendFileSync(redirectsPath, block, 'utf8');
  const addedLines = block.split('\n').filter(l => l.includes(' 301')).length;
  console.error(`\n✓ Appended ${addedLines} redirect lines to _redirects`);
}
