// Tool page CSS order check — regression test
//
// Read:  scripts/check-tool-css-order.mjs (imported; importing it runs no check)
// Write: fixture dist trees under os.tmpdir() (removed at the end), stdout (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: CSS resource extraction (link order, inline <style>, non-stylesheet links ignored,
// "<style>" text inside JSON-LD ignored, body ignored), classification (site-wide / shared
// tool / own tool), the site-then-shared-then-own order rule and its failure messages, no
// inline <style> in <head> on tool pages, pages without own tool CSS, chunk-name checks
// (site.<hash>.css, no _slug_ leftover), a fixture dist tree end to end, and the exit code
// of a direct run.
//
// Run: node scripts/test-check-tool-css-order.mjs

import { cssResources, checkOrder, checkDist } from './check-tool-css-order.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
const page = (head, body = '') => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
const SITE = '/_astro/site.1234abcd.css';

// ---------- cssResources ----------
equal('links and inline styles in document order',
  cssResources(page(`${link('/a.css')}<style>.x{}</style>${link('/b.css')}`)),
  ['/a.css', 'inline:.x{}', '/b.css']);
equal('non-stylesheet links ignored',
  cssResources(page(`<link rel="preload" href="/f.woff2"><link rel="icon" href="/i.svg">${link('/a.css')}`)),
  ['/a.css']);
equal('"<style>" text inside JSON-LD ignored',
  cssResources(page(`<script type="application/ld+json">{"q":"<style> and </head> tags"}</script>${link('/a.css')}`)),
  ['/a.css']);
equal('styles after </head> ignored',
  cssResources(page(link('/a.css'), '<style>.body{}</style>')),
  ['/a.css']);
equal('style with attributes kept',
  cssResources(page('<style type="text/css">.y{}</style>')),
  ['inline:.y{}']);

// ---------- checkOrder ----------
const site = new Set([SITE]);
const toolPages = (cssBySlug) => Object.entries(cssBySlug).flatMap(([slug, css]) =>
  ['', 'zh/'].map((p) => ({ path: `${p}tools/${slug}/`, slug, css })));

let r = checkOrder(toolPages({
  a: [SITE, '/shared.css', '/a.css'],
  b: [SITE, '/shared.css', '/b.css'],
}), site);
equal('site, then shared, then own passes', r.problems, []);
equal('pages with own CSS are counted', r.checked, 4);

r = checkOrder(toolPages({
  a: [SITE, '/a.css', '/shared.css'],
  b: [SITE, '/shared.css', '/b.css'],
}), site);
equal('own before shared fails once per page', r.problems.length, 2);
check('failure names both files', /tool CSS \/a\.css comes before shared tool CSS \/shared\.css/.test(r.problems[0]), r.problems[0]);

r = checkOrder(toolPages({
  a: ['/shared.css', '/a.css', SITE],
  b: [SITE, '/shared.css', '/b.css'],
}), site);
equal('tool CSS before site CSS fails', r.problems.length, 2);
check('site failure names both files', /tool CSS \/shared\.css comes before site CSS \/_astro\/site\.1234abcd\.css/.test(r.problems[0]), r.problems[0]);

r = checkOrder(toolPages({
  a: ['/shared.css', '/a.css'],
  b: [SITE, '/shared.css', '/b.css'],
}), site);
equal('missing site CSS fails', r.problems.length, 2);
check('missing site message counts resources', /1 site CSS resource\(s\) missing/.test(r.problems[0]), r.problems[0]);

r = checkOrder(toolPages({
  a: [SITE, '/shared.css', '/a.css', '/ad.css'],
  b: [SITE, '/shared.css', '/ad.css', '/b.css'],
}), site);
equal('a second shared resource after own CSS fails', r.problems.length, 2);

r = checkOrder(toolPages({
  a: [SITE, '/shared.css', '/a.css'],
  b: [SITE, '/shared.css', 'inline:.b{}'],
}), site);
equal('inline <style> in <head> fails once per page', r.problems.length, 2);
check('inline failure names the size and the setting', /1 inline <style> in <head> \(4 chars\).*inlineStylesheets: 'never'/.test(r.problems[0]), r.problems[0]);

r = checkOrder(toolPages({
  a: [SITE, '/shared.css', 'inline:.a{}'],
  b: [SITE, 'inline:.b{}', '/shared.css'],
}), site);
equal('inline <style> fails on every page; inline before shared CSS also fails the order', r.problems.length, 6);
check('inline resource in an order failure is named by size', r.problems.some((p) => /tool CSS <style> \(4 chars\) comes before/.test(p)), r.problems.join(' | '));

r = checkOrder(toolPages({
  a: ['/shared.css', '/a.css', 'inline:.site{}'],
  b: ['/shared.css', '/b.css', 'inline:.site{}'],
}), new Set(['inline:.site{}']));
equal('a site-wide inline <style> on a tool page also fails', r.problems.length, 8);

r = checkOrder(toolPages({
  a: [SITE, '/a.css'],
  b: [SITE, '/shared.css', '/b.css'],
  c: [SITE, '/shared.css', '/c.css'],
}), site);
equal('own CSS without shared tool CSS fails', r.problems.filter((p) => p.includes('no shared tool CSS')).length, 2);

r = checkOrder(toolPages({
  a: [SITE, '/shared.css'],
  b: [SITE, '/shared.css'],
}), site);
equal('pages without own CSS are skipped', [r.checked, r.problems.length], [0, 0]);

// ---------- checkDist on a fixture tree ----------
const tmp = mkdtempSync(join(tmpdir(), 'css-order-'));
function writeDist(name, cssBySlug, { siteHref = SITE } = {}) {
  const dist = join(tmp, name);
  mkdirSync(join(dist, 'about'), { recursive: true });
  writeFileSync(join(dist, 'about', 'index.html'), page(link(siteHref)));
  mkdirSync(join(dist, 'tools'), { recursive: true });
  writeFileSync(join(dist, 'tools', 'index.html'), page(link(siteHref)));
  mkdirSync(join(dist, 'blog', 'post'), { recursive: true });
  writeFileSync(join(dist, 'blog', 'post', 'index.html'), page(link(siteHref) + link('/article.css')));
  for (const [slug, css] of Object.entries(cssBySlug)) {
    for (const prefix of ['', 'zh/', 'ja/', 'ko/']) {
      mkdirSync(join(dist, prefix, 'tools', slug), { recursive: true });
      const head = css.map((c) => (c.startsWith('.') ? `<style>${c}</style>` : link(c))).join('');
      writeFileSync(join(dist, prefix, 'tools', slug, 'index.html'), page(head));
    }
  }
  return dist;
}
const good = writeDist('good', {
  a: [SITE, '/shared.css', '/a.css'],
  b: [SITE, '/shared.css', '/b.css'],
});
const inlined = writeDist('inlined', {
  a: [SITE, '/shared.css', '/a.css'],
  b: [SITE, '/shared.css', '.b{}'],
});
const bad = writeDist('bad', {
  a: [SITE, '/a.css', '/shared.css'],
  b: [SITE, '/shared.css', '/b.css'],
});
const siteLast = writeDist('site-last', {
  a: ['/shared.css', '/a.css', SITE],
  b: ['/shared.css', '/b.css', SITE],
});
const slugName = writeDist('slug-name', {
  a: ['/_astro/_slug_.abcd1234.css', '/shared.css', '/a.css'],
  b: ['/_astro/_slug_.abcd1234.css', '/shared.css', '/b.css'],
}, { siteHref: '/_astro/_slug_.abcd1234.css' });

r = checkDist(good);
equal('fixture dist: 8 tool pages, all pass', [r.pages, r.checked, r.problems.length], [8, 8, 0]);
r = checkDist(bad);
equal('fixture dist: 4 pages of tool a fail', r.problems.length, 4);
r = checkDist(inlined);
equal('fixture dist: 4 pages of tool b fail for inline <style>', [r.problems.length, r.problems.every((p) => p.includes('tools/b/') && p.includes('inline <style>'))], [4, true]);
r = checkDist(siteLast);
equal('fixture dist: site CSS last fails every page', [r.problems.length, r.problems.every((p) => p.includes('comes before site CSS'))], [8, true]);
r = checkDist(slugName);
equal('fixture dist: _slug_ site chunk name fails', [r.problems.length, r.problems.filter((p) => p.includes('is not named site.<hash>.css')).length, r.problems.filter((p) => p.includes('still carries the first-parent name')).length], [9, 1, 8]);
let threw = false;
try { checkDist(join(tmp, 'missing')); } catch { threw = true; }
check('missing dist throws', threw);

const script = fileURLToPath(new URL('./check-tool-css-order.mjs', import.meta.url));
equal('direct run exits 0 on a good dist', spawnSync(process.execPath, [script, good]).status, 0);
equal('direct run exits 1 on a bad dist', spawnSync(process.execPath, [script, bad]).status, 1);
equal('direct run exits 1 on a dist with inline <style>', spawnSync(process.execPath, [script, inlined]).status, 1);
equal('direct run exits 1 on a dist with site CSS last', spawnSync(process.execPath, [script, siteLast]).status, 1);
equal('direct run exits 1 on a dist with a _slug_ chunk name', spawnSync(process.execPath, [script, slugName]).status, 1);
equal('direct run exits 1 on a missing dist', spawnSync(process.execPath, [script, join(tmp, 'missing')]).status, 1);

rmSync(tmp, { recursive: true, force: true });

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
