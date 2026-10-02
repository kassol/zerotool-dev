#!/usr/bin/env node
// Copy the jq-web runtime from node_modules to public/jq-web/ (gitignored) for jq-playground:
//   jq.js        node_modules/jq-web/jq.js with the patch from scripts/jq-web-patch.mjs
//   jq.wasm      node_modules/jq-web/jq.wasm, unchanged
//   jq-worker.js src/components/tools/jq-playground.worker.js, unchanged (classic worker that
//                loads jq.js with importScripts)
// Read:  node_modules/jq-web/{jq.js,jq.wasm,package.json}, src/components/tools/jq-playground.worker.js
// Write: public/jq-web/{jq.js,jq.wasm,jq-worker.js}
// Exit 1 when a file is missing, the jq-web version is not the patched one, or a patch does not
// apply. Run before `astro dev` and `astro build` so dev / CI / prod stay in sync.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { patchJqWeb, JQ_WEB_VERSION } from './jq-web-patch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const src = join(repoRoot, 'node_modules', 'jq-web');
const dst = join(repoRoot, 'public', 'jq-web');

if (!existsSync(src)) {
  console.error('[sync-jq-web] node_modules/jq-web is missing. Run `npm install` first.');
  process.exit(1);
}
const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;
if (version !== JQ_WEB_VERSION) {
  console.error(`[sync-jq-web] jq-web ${version} installed; scripts/jq-web-patch.mjs is written for ${JQ_WEB_VERSION}. Check the patch against the new jq.js first.`);
  process.exit(1);
}

mkdirSync(dst, { recursive: true });

function report(name) {
  console.log(`[sync-jq-web] wrote ${name} (${(statSync(join(dst, name)).size / 1024).toFixed(1)} KB)`);
}

try {
  writeFileSync(join(dst, 'jq.js'), patchJqWeb(readFileSync(join(src, 'jq.js'), 'utf8')));
} catch (e) {
  console.error('[sync-jq-web] ' + e.message);
  process.exit(1);
}
report('jq.js');

for (const [from, name] of [
  [join(src, 'jq.wasm'), 'jq.wasm'],
  [join(repoRoot, 'src', 'components', 'tools', 'jq-playground.worker.js'), 'jq-worker.js'],
]) {
  if (!existsSync(from)) {
    console.error(`[sync-jq-web] missing source file: ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(dst, name));
  report(name);
}
