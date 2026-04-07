#!/usr/bin/env node
// Reads tool slugs + EN names from src/data/tools.ts and regenerates
// the <!-- TOOLS-START --> ... <!-- TOOLS-END --> section in README.md.
// Exits with code 1 if README was changed (so CI can commit); 0 if no change.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const TOOLS_TS = path.join(ROOT, 'src/data/tools.ts');
const README = path.join(ROOT, 'README.md');

const toolsContent = fs.readFileSync(TOOLS_TS, 'utf8');

// Extract slug + EN name pairs in order
const slugs = [...toolsContent.matchAll(/slug:\s*'([^']+)'/g)].map(m => m[1]);
const names = [...toolsContent.matchAll(/en:\s*\{\s*name:\s*'([^']+)'/g)].map(m => m[1]);

if (slugs.length !== names.length) {
  console.error(`Mismatch: ${slugs.length} slugs vs ${names.length} EN names`);
  process.exit(2);
}

const count = slugs.length;
const rows = slugs.map((slug, i) =>
  `| ${names[i]} | [/tools/${slug}](https://zerotool.dev/tools/${slug}) |`
).join('\n');

const tableBlock = `<!-- TOOLS-START -->
| Tool | URL |
|------|-----|
${rows}
<!-- TOOLS-END -->`;

let readme = fs.readFileSync(README, 'utf8');

// Update tool count in the intro line
readme = readme.replace(
  /— \d+ tools and growing\./,
  `— ${count} tools and growing.`
);

// Replace the tools table block
const before = readme;
readme = readme.replace(
  /<!-- TOOLS-START -->[\s\S]*?<!-- TOOLS-END -->/,
  tableBlock
);

if (readme === before) {
  console.log('README already up to date.');
  process.exit(0);
}

fs.writeFileSync(README, readme, 'utf8');
console.log(`README updated: ${count} tools.`);
process.exit(1); // signal to CI that a commit is needed
