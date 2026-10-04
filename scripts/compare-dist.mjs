#!/usr/bin/env node
// Compare the tool pages of two builds: node scripts/compare-dist.mjs <baseline dist> <new dist>
// Reads tools/{slug}/index.html and {zh,ja,ko}/tools/{slug}/index.html in both directories
// (slugs: union of both sides; a page missing on one side counts as different).
// Before comparing it collapses whitespace and replaces the content hash in /_astro/ file names.
// Writes nothing; prints to stdout. Exit 0 when every page is the same, 1 otherwise, 2 on bad usage.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [baseDir, newDir] = process.argv.slice(2);
if (!baseDir || !newDir || !existsSync(baseDir) || !existsSync(newDir)) {
  console.error('Usage: node scripts/compare-dist.mjs <baseline dist> <new dist>');
  process.exit(2);
}

const PREFIXES = ['', 'zh/', 'ja/', 'ko/'];
const MAX_DIFFS = 3;   // differences printed per page
const CONTEXT = 200;   // characters printed per side
const LOOKAHEAD = 400; // tokens searched to line the two pages up again after a difference

const slugsOf = (dir) => PREFIXES.flatMap((p) => {
  const tools = join(dir, p, 'tools');
  return existsSync(tools) ? readdirSync(tools).filter((s) => existsSync(join(tools, s, 'index.html'))) : [];
});
const slugs = [...new Set([...slugsOf(baseDir), ...slugsOf(newDir)])].sort();

const normalize = (html) => html
  .replace(/(\/_astro\/[^"'\s)]+)\.[\w-]{8}(\.[a-z0-9]+)/g, '$1.HASH$2')
  .replace(/\s+/g, ' ')
  .replace(/> </g, '><');
const load = (dir, page) => {
  const file = join(dir, page);
  return existsSync(file) ? normalize(readFileSync(file, 'utf8')) : null;
};
const clip = (tokens) => { const s = tokens.join(''); return s.length > CONTEXT ? s.slice(0, CONTEXT) + '…' : s; };

// Split at tag starts, walk both token lists, and after a mismatch look ahead for the
// nearest point where they agree again.
function differences(a, b) {
  const x = a.split(/(?=<)/), y = b.split(/(?=<)/);
  const out = [];
  let i = 0, j = 0;
  while ((i < x.length || j < y.length) && out.length < MAX_DIFFS) {
    if (x[i] === y[j]) { i++; j++; continue; }
    let di = x.length - i, dj = y.length - j;
    search: for (let sum = 1; sum <= LOOKAHEAD; sum++) {
      for (let p = 0; p <= sum; p++) {
        const q = sum - p;
        if (i + p < x.length && j + q < y.length && x[i + p] === y[j + q]) { di = p; dj = q; break search; }
      }
    }
    out.push({ before: clip(x.slice(Math.max(0, i - 1), i)), base: clip(x.slice(i, i + di)), next: clip(y.slice(j, j + dj)) });
    i += di; j += dj;
  }
  return out;
}

let same = 0;
const different = [];
for (const slug of slugs) {
  for (const prefix of PREFIXES) {
    const page = `${prefix}tools/${slug}/index.html`;
    const a = load(baseDir, page), b = load(newDir, page);
    if (a === null && b === null) continue;
    if (a === b) { same++; continue; }
    different.push(page);
    console.log(`\n≠ ${page}`);
    if (a === null || b === null) { console.log(`  missing in ${a === null ? 'baseline' : 'new'} build`); continue; }
    for (const d of differences(a, b)) {
      console.log(`  after: ${d.before}`);
      console.log(`    base: ${d.base || '(nothing)'}`);
      console.log(`    new : ${d.next || '(nothing)'}`);
    }
  }
}

console.log(`\nSame: ${same}  Different: ${different.length}  (total ${same + different.length} pages, ${slugs.length} slugs)`);
if (different.length) console.log('Different pages:\n' + different.map((p) => '  ' + p).join('\n'));
process.exit(different.length ? 1 : 0);
