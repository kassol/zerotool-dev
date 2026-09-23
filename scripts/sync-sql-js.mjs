#!/usr/bin/env node
// Copy the sql.js runtime (sql-wasm.js + sql-wasm.wasm) from node_modules to public/sql-js/
// so SqliteViewerTool can load them lazily via a <script> tag after the user picks a file.
// Read: node_modules/sql.js/dist/  Write: public/sql-js/ (gitignored)
// Run before `astro dev` and `astro build` so dev / CI / prod all stay in sync.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const src = join(repoRoot, 'node_modules', 'sql.js', 'dist');
const dst = join(repoRoot, 'public', 'sql-js');

const files = ['sql-wasm.js', 'sql-wasm.wasm'];

if (!existsSync(src)) {
  console.error('[sync-sql-js] node_modules/sql.js is missing. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

for (const f of files) {
  const from = join(src, f);
  const to = join(dst, f);
  if (!existsSync(from)) {
    console.error(`[sync-sql-js] missing source file: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, to);
  const size = (statSync(to).size / 1024).toFixed(1);
  console.log(`[sync-sql-js] copied ${f} (${size} KB)`);
}
