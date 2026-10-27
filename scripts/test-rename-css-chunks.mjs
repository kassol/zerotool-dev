// rename-css-chunks — regression test
//
// Read:  scripts/rename-css-chunks.mjs (imported; importing it runs nothing)
// Write: fixture dist trees under os.tmpdir() (removed at the end), stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: owner classification from the pages that link a chunk (site / article / adunit /
// tool-shared / per-tool untouched), file rename, HTML reference rewrite on every page,
// --dry-run, idempotence, and the direct-run exit code.
//
// Run: node scripts/test-rename-css-chunks.mjs

import { classifyChunks, renameCssChunks, isToolPage, isBlogPage, isHomePage, isNotFoundPage } from './rename-css-chunks.mjs';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}, got ${a}`);
}

const link = (href) => `<link rel="stylesheet" href="${href}">`;
const page = (head) => `<!DOCTYPE html><html><head>${head}</head><body></body></html>`;

// ---------- page kind helpers ----------
equal('tool page detection', [
  isToolPage('tools/a/index.html'),
  isToolPage('zh/tools/a/index.html'),
  isToolPage('blog/x/index.html'),
  isToolPage('tools/index.html'),
  isToolPage('about/index.html'),
], [true, true, false, false, false]);
equal('blog page detection', [
  isBlogPage('blog/x/index.html'),
  isBlogPage('ja/blog/x/index.html'),
  isBlogPage('ja/tools/a/index.html'),
], [true, true, false]);
equal('home and 404 detection', [
  isHomePage('index.html'),
  isHomePage('ko/index.html'),
  isHomePage('ko/tools/index.html'),
  isNotFoundPage('404.html'),
  isNotFoundPage('404/index.html'),
], [true, true, false, true, false]);

// ---------- classifyChunks ----------
const sizes = new Map([
  ['/_astro/_slug_.aaaaaaaa.css', 2000],
  ['/_astro/_slug_.bbbbbbbb.css', 3000],
  ['/_astro/_slug_.cccccccc.css', 69],
  ['/_astro/aes-encrypt-decrypt.dddddddd.css', 5000],
  ['/_astro/a.eeeeeeee.css', 1200],
  ['/_astro/b.ffffffff.css', 1300],
]);
const pages = [
  { rel: 'about/index.html', css: ['/_astro/_slug_.aaaaaaaa.css'] },
  { rel: 'contact/index.html', css: ['/_astro/_slug_.aaaaaaaa.css'] },
  { rel: 'blog/post/index.html', css: ['/_astro/_slug_.aaaaaaaa.css', '/_astro/_slug_.bbbbbbbb.css'] },
  { rel: 'tools/a/index.html', css: ['/_astro/_slug_.aaaaaaaa.css', '/_astro/_slug_.cccccccc.css', '/_astro/aes-encrypt-decrypt.dddddddd.css', '/_astro/a.eeeeeeee.css'] },
  { rel: 'zh/tools/a/index.html', css: ['/_astro/_slug_.aaaaaaaa.css', '/_astro/_slug_.cccccccc.css', '/_astro/aes-encrypt-decrypt.dddddddd.css', '/_astro/a.eeeeeeee.css'] },
  { rel: 'tools/b/index.html', css: ['/_astro/_slug_.aaaaaaaa.css', '/_astro/_slug_.cccccccc.css', '/_astro/aes-encrypt-decrypt.dddddddd.css', '/_astro/b.ffffffff.css'] },
];
const kinds = classifyChunks(pages, sizes);
equal('site chunk', kinds.get('/_astro/_slug_.aaaaaaaa.css'), 'site');
equal('article chunk', kinds.get('/_astro/_slug_.bbbbbbbb.css'), 'article');
equal('adunit chunk', kinds.get('/_astro/_slug_.cccccccc.css'), 'adunit');
equal('shared tool chunk', kinds.get('/_astro/aes-encrypt-decrypt.dddddddd.css'), 'tool-shared');
equal('per-tool chunk left alone', [kinds.get('/_astro/a.eeeeeeee.css'), kinds.get('/_astro/b.ffffffff.css')], [null, null]);

// ---------- rename on a fixture tree ----------
const tmp = mkdtempSync(join(tmpdir(), 'css-rename-'));
const dist = join(tmp, 'dist');
const files = {
  'about/index.html': page(link('/_astro/_slug_.aaaaaaaa.css')),
  'contact/index.html': page(link('/_astro/_slug_.aaaaaaaa.css')),
  'blog/post/index.html': page(link('/_astro/_slug_.aaaaaaaa.css') + link('/_astro/_slug_.bbbbbbbb.css')),
  'tools/a/index.html': page(link('/_astro/_slug_.aaaaaaaa.css') + link('/_astro/_slug_.cccccccc.css') + link('/_astro/aes-encrypt-decrypt.dddddddd.css') + link('/_astro/a.eeeeeeee.css')),
  'zh/tools/a/index.html': page(link('/_astro/_slug_.aaaaaaaa.css') + link('/_astro/_slug_.cccccccc.css') + link('/_astro/aes-encrypt-decrypt.dddddddd.css') + link('/_astro/a.eeeeeeee.css')),
  'tools/b/index.html': page(link('/_astro/_slug_.aaaaaaaa.css') + link('/_astro/_slug_.cccccccc.css') + link('/_astro/aes-encrypt-decrypt.dddddddd.css') + link('/_astro/b.ffffffff.css')),
};
for (const [rel, html] of Object.entries(files)) {
  mkdirSync(join(dist, rel, '..'), { recursive: true });
  writeFileSync(join(dist, rel), html);
}
mkdirSync(join(dist, '_astro'), { recursive: true });
for (const [href, size] of sizes) {
  writeFileSync(join(dist, href), `/* ${href} */\n${'x'.repeat(size)}`);
}

const dry = renameCssChunks(dist, { dryRun: true });
equal('dry run reports the four renames', [dry.renamed, Object.keys(dry.renames).length], [4, 4]);
check('dry run leaves files in place', existsSync(join(dist, '/_astro/_slug_.aaaaaaaa.css')));

const first = renameCssChunks(dist);
equal('first run renames four chunks', first.renamed, 4);
for (const name of ['site.aaaaaaaa.css', 'article.bbbbbbbb.css', 'adunit.cccccccc.css', 'tool-shared.dddddddd.css']) {
  check(`renamed to ${name}`, existsSync(join(dist, '_astro', name)));
}
for (const name of ['_slug_.aaaaaaaa.css', '_slug_.bbbbbbbb.css', '_slug_.cccccccc.css', 'aes-encrypt-decrypt.dddddddd.css']) {
  check(`old name removed: ${name}`, !existsSync(join(dist, '_astro', name)));
}
for (const name of ['a.eeeeeeee.css', 'b.ffffffff.css']) {
  check(`per-tool chunk kept: ${name}`, existsSync(join(dist, '_astro', name)));
}
const about = readFileSync(join(dist, 'about', 'index.html'), 'utf8');
check('about page points at site chunk', about.includes('/_astro/site.aaaaaaaa.css') && !about.includes('_slug_'), about);
const blog = readFileSync(join(dist, 'blog', 'post', 'index.html'), 'utf8');
check('blog page points at article chunk', blog.includes('/_astro/article.bbbbbbbb.css') && !blog.includes('_slug_'), blog);
const toolA = readFileSync(join(dist, 'tools', 'a', 'index.html'), 'utf8');
check('tool page points at site, adunit and shared chunks', ['site.aaaaaaaa.css', 'adunit.cccccccc.css', 'tool-shared.dddddddd.css', 'a.eeeeeeee.css'].every((n) => toolA.includes(n)) && !toolA.includes('_slug_'), toolA);

const second = renameCssChunks(dist);
equal('second run is a no-op', second.renamed, 0);

// ---------- direct run ----------
const script = fileURLToPath(new URL('./rename-css-chunks.mjs', import.meta.url));
equal('direct run exits 0 on a renamed tree', spawnSync(process.execPath, [script, dist]).status, 0);
equal('direct run exits 0 with --dry-run', spawnSync(process.execPath, [script, dist, '--dry-run']).status, 0);

rmSync(tmp, { recursive: true, force: true });

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
