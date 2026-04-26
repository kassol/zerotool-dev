#!/usr/bin/env node
/**
 * One-shot migration: src/content/blog/{slug}-{lang}.mdx → {slug}/{lang}.mdx
 *
 * Reversibility: this script only moves files (git mv equivalent). Run
 * `git restore --source=HEAD~ src/content/blog/` to roll back.
 *
 * Usage:
 *   node scripts/migrate-blog-structure.mjs --dry-run   # preview only
 *   node scripts/migrate-blog-structure.mjs             # execute
 */

import { readdirSync, mkdirSync, renameSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BLOG_DIR = join(ROOT, 'src/content/blog');
const DRY = process.argv.includes('--dry-run');
const LANG_RE = /^(.+?)-(zh|ja|ko)\.mdx?$/;

const moves = [];
for (const file of readdirSync(BLOG_DIR)) {
  const abs = join(BLOG_DIR, file);
  if (!statSync(abs).isFile()) continue;
  if (!/\.mdx?$/.test(file)) continue;

  const m = file.match(LANG_RE);
  let baseSlug, lang;
  if (m) {
    baseSlug = m[1];
    lang = m[2];
  } else if (/\.mdx?$/.test(file)) {
    baseSlug = file.replace(/\.mdx?$/, '');
    lang = 'en';
  }

  const targetDir = join(BLOG_DIR, baseSlug);
  const targetFile = join(targetDir, `${lang}.mdx`);
  moves.push({ from: abs, to: targetFile, baseSlug, lang });
}

console.log(`Planning ${moves.length} file moves into ${new Set(moves.map(m => m.baseSlug)).size} base-slug dirs.`);

const conflicts = moves.filter(m => existsSync(m.to));
if (conflicts.length > 0) {
  console.error(`\nConflicts (target already exists):`);
  for (const c of conflicts) console.error(`  ${c.to}`);
  process.exit(1);
}

if (DRY) {
  for (const m of moves.slice(0, 10)) {
    console.log(`  ${m.from.replace(ROOT, '.')} → ${m.to.replace(ROOT, '.')}`);
  }
  if (moves.length > 10) console.log(`  ... ${moves.length - 10} more`);
  console.log('\n(dry-run; no files changed)');
  process.exit(0);
}

let done = 0;
for (const m of moves) {
  mkdirSync(dirname(m.to), { recursive: true });
  renameSync(m.from, m.to);
  done++;
}
console.log(`\nMoved ${done} files into ${new Set(moves.map(m => m.baseSlug)).size} dirs.`);
