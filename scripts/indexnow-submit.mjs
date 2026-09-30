// IndexNow release submission — tell IndexNow engines (Bing and others) which pages
// changed in a release.
//
// Read:  git history (tags, `git diff` between two releases, tools.ts / registry.ts at
//        both releases), dist/sitemap-index.xml + dist/sitemap-*.xml (run after build)
// Network (without --dry-run): GET https://zerotool.dev/{key}.txt until it serves the
//        key, then POST the URL list to https://api.indexnow.org/indexnow
// Write: stdout / stderr only
// Exit:  0 on success or nothing to submit; 1 on any error (the deploy workflow runs
//        this step with continue-on-error, so a failure does not fail the deploy)
//
// Usage:
//   node scripts/indexnow-submit.mjs --dry-run --from v1.138.10 --to v1.138.11
//   node scripts/indexnow-submit.mjs --to v1.138.11          # from = previous tag
//   node scripts/indexnow-submit.mjs --all --to v1.139.0      # whole sitemap (redesign)
// Options:
//   --to <tag>       release being deployed (default: $GITHUB_REF_NAME on a tag push)
//   --from <ref>     previous release (default: highest vX.Y.Z tag below --to that is
//                    reachable from --to)
//   --dry-run        print the URLs, send nothing
//   --all            submit every sitemap URL (see scripts/indexnow-urls.mjs for why
//                    this is not automatic)
//   --dist <dir>     build output directory (default: dist)
//   --key-timeout <s> how long to wait for the live key file (default: 300)
//
// URL rules and protocol references: scripts/indexnow-urls.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  ENDPOINT,
  INDEXNOW_KEY,
  KEY_LOCATION,
  MAX_URLS_PER_POST,
  chunk,
  componentSlugMap,
  describeStatus,
  diffKeyedLines,
  mapChangedFiles,
  parseRegistryLines,
  parseSitemapLocs,
  parseToolsLines,
  previousTag,
  requestBody,
  selectUrls,
} from './indexnow-urls.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inActions = process.env.GITHUB_ACTIONS === 'true';

function fail(message) {
  console.error(inActions ? `::error title=IndexNow submission failed::${message}` : `ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { dryRun: false, all: false, dist: 'dist', keyTimeout: 300 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--from') opts.from = value();
    else if (a === '--to') opts.to = value();
    else if (a === '--dist') opts.dist = value();
    else if (a === '--key-timeout') opts.keyTimeout = Number(value());
    else fail(`unknown option ${a}`);
  }
  return opts;
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function gitShow(rev, path) {
  try {
    execFileSync('git', ['cat-file', '-e', `${rev}:${path}`], { cwd: root, stdio: 'ignore' });
  } catch {
    return null; // file does not exist at this revision
  }
  return git('show', `${rev}:${path}`);
}

function readSitemap(distDir) {
  const indexPath = join(distDir, 'sitemap-index.xml');
  if (!existsSync(indexPath)) fail(`${indexPath} not found; run npm run build first`);
  return parseSitemapLocs(readFileSync(indexPath, 'utf8'))
    .flatMap((loc) => parseSitemapLocs(readFileSync(join(distDir, new URL(loc).pathname), 'utf8')));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForKeyFile(timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let last = '';
  for (;;) {
    try {
      const res = await fetch(`${KEY_LOCATION}?check=${Date.now()}`, { cache: 'no-store' });
      const body = (await res.text()).trim();
      if (res.status === 200 && body === INDEXNOW_KEY) {
        console.log(`Key file is live: ${KEY_LOCATION} (200, ${res.headers.get('content-type')})`);
        return;
      }
      last = `status ${res.status}${res.status === 200 ? ', content does not match the key' : ''}`;
    } catch (err) {
      last = err.message;
    }
    if (Date.now() >= deadline) fail(`key file ${KEY_LOCATION} not served after ${timeoutSeconds}s (last: ${last})`);
    console.log(`Waiting for key file (${last}) ...`);
    await sleep(10000);
  }
}

// Retries only network errors and 5xx; 4xx answers are final.
async function post(urlList) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(requestBody(urlList)),
      });
      const text = await res.text();
      if (res.status < 500 || attempt === 3) return { status: res.status, text };
      console.log(`HTTP ${res.status}, retry ${attempt}/2 in 15s`);
    } catch (err) {
      if (attempt === 3) return { status: 0, text: err.message };
      console.log(`Network error (${err.message}), retry ${attempt}/2 in 15s`);
    }
    await sleep(15000);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const to = opts.to ?? (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  if (!to) fail('pass --to <tag>');
  const from = opts.from ?? previousTag(git('tag', '--merged', to, '--list', 'v*').split('\n').filter(Boolean), to);
  if (!from) {
    console.log(`No release before ${to}; nothing to compare. Skipping IndexNow.`);
    return;
  }

  const files = git('diff', '--name-only', '--no-renames', from, to).split('\n').filter(Boolean);
  const keyedDiffs = {};
  for (const [file, parse] of [['src/data/tools.ts', parseToolsLines], ['src/components/tools/registry.ts', parseRegistryLines]]) {
    if (files.includes(file)) keyedDiffs[file] = diffKeyedLines(gitShow(from, file), gitShow(to, file), parse);
  }
  const registryPath = 'src/components/tools/registry.ts';
  const componentSlugs = componentSlugMap(gitShow(to, registryPath), gitShow(from, registryPath));
  const mapped = mapChangedFiles(files, { componentSlugs, keyedDiffs });
  const sitemapUrls = readSitemap(resolve(root, opts.dist));
  const { urls, notInSitemap } = selectUrls({ paths: mapped.paths, sitemapUrls, all: opts.all });

  console.log(`IndexNow: ${from} → ${to}, ${files.length} changed files`);
  for (const [file, d] of Object.entries(keyedDiffs)) {
    console.log(`  ${file}: entries changed for ${d.keys.length ? d.keys.join(', ') : '(none)'}${d.other ? '; other lines changed too' : ''}`);
  }
  if (mapped.global.length) {
    console.log(`Shared files changed (${mapped.global.length}); they affect many pages:`);
    mapped.global.forEach((f) => console.log(`  ${f}`));
    console.log(opts.all
      ? `--all: submitting all ${sitemapUrls.length} sitemap URLs.`
      : `Not submitting the whole sitemap (${sitemapUrls.length} URLs) for shared-file changes (IndexNow FAQ: avoid layout or cosmetic changes; submit all URLs only after a redesign or migration). Use --all for that.`);
  }
  if (notInSitemap.length) {
    console.log(`Skipped, not in the sitemap (draft, noindex, redirected or deleted) (${notInSitemap.length}):`);
    notInSitemap.forEach((p) => console.log(`  ${p}`));
  }
  console.log(`URLs to submit: ${urls.length}`);
  urls.forEach((u) => console.log(`  ${u}`));

  if (opts.dryRun) {
    console.log('Dry run: nothing sent.');
    return;
  }
  if (urls.length === 0) {
    console.log('Nothing to submit.');
    return;
  }

  await waitForKeyFile(opts.keyTimeout);
  let failed = false;
  for (const batch of chunk(urls, MAX_URLS_PER_POST)) {
    const { status, text } = await post(batch);
    const { ok, meaning } = describeStatus(status);
    console.log(`POST ${ENDPOINT}: ${batch.length} URLs → HTTP ${status} (${status === 0 ? text : meaning})`);
    if (!ok) {
      failed = true;
      if (text && status !== 0) console.log(`Response body: ${text.slice(0, 500)}`);
    }
  }
  if (failed) fail(`IndexNow did not accept the URL list; see the HTTP status above`);
}

main().catch((err) => fail(err.stack ?? String(err)));
