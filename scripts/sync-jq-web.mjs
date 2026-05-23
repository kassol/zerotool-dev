#!/usr/bin/env node
// Copy jq-web runtime (jq.js + jq.wasm) from node_modules to public/jq-web/
// so the JqPlaygroundTool can load them via a plain <script> tag at runtime.
// Run before `astro dev` and `astro build` so dev / CI / prod all stay in sync.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const src = join(repoRoot, 'node_modules', 'jq-web');
const dst = join(repoRoot, 'public', 'jq-web');

const files = ['jq.js', 'jq.wasm'];

if (!existsSync(src)) {
  console.error('[sync-jq-web] node_modules/jq-web is missing. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

for (const f of files) {
  const from = join(src, f);
  const to = join(dst, f);
  if (!existsSync(from)) {
    console.error(`[sync-jq-web] missing source file: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, to);
  const size = (statSync(to).size / 1024).toFixed(1);
  console.log(`[sync-jq-web] copied ${f} (${size} KB)`);
}
