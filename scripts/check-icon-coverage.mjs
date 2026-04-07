#!/usr/bin/env node
/**
 * Verifies every slug in tools.ts has a corresponding entry in icons.ts.
 * Exits with code 1 if any slug is missing an icon.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const toolsSource = readFileSync(join(root, 'src/data/tools.ts'), 'utf8');
const iconsSource = readFileSync(join(root, 'src/data/icons.ts'), 'utf8');

// Extract slugs from tools.ts: slug: 'some-slug'
const slugMatches = [...toolsSource.matchAll(/slug:\s*'([^']+)'/g)];
const toolSlugs = slugMatches.map(m => m[1]);

// Extract keys from icons.ts: 'some-key':
const iconMatches = [...iconsSource.matchAll(/'([^']+)':\s*'<svg/g)];
const iconKeys = new Set(iconMatches.map(m => m[1]));

const missing = toolSlugs.filter(slug => !iconKeys.has(slug));

if (missing.length > 0) {
  console.error('Icon coverage check failed. Missing icons for:');
  missing.forEach(slug => console.error(`  - ${slug}`));
  process.exit(1);
}

console.log(`Icon coverage OK: ${toolSlugs.length} tools, all have icons.`);
