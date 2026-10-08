// Blog related posts selection — regression test
//
// Read:  src/layouts/ArticleLayout.astro (extracts the real block between the
//        `engine:start` / `engine:end` markers, so this test cannot drift from the
//        shipped source), src/content/blog/*/*.mdx and src/data/tools.ts (real-data
//        checks)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: tags on more than half of the posts in a language do not score, the
// same-tool-category bonus for tool guide posts (guideDirFor), ties ordered by publish
// time gap and then dir name, fill with nearest posts when fewer than 3 score,
// determinism (input order does not change the result), self exclusion, same
// language only, and on the real blog: no post links to itself, and no English post
// gets links from more than a quarter of the other English posts.
//
// Run: node scripts/test-related-posts.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/layouts/ArticleLayout.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in ArticleLayout.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const { selectRelatedPosts, COMMON_TAG_SHARE } =
  new Function(block + '\nreturn { selectRelatedPosts, COMMON_TAG_SHARE };')();

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const DAY = 86400000;
const post = (dir, day, tags = [], lang = 'en') => ({ dir, lang, tags, time: day * DAY });
const dirs = (list) => list.map((p) => p.dir);
const pick = (current, posts, cats = {}, limit = 3) => dirs(selectRelatedPosts(current, posts, cats, limit));

// ---------- 1. common tag does not score ----------
{
  // "common" is on 5 of 6 posts (> 50%); "rare" is on 2.
  const cur = post('cur', 10, ['common', 'rare']);
  const posts = [
    cur,
    post('a', 11, ['common']),
    post('b', 12, ['common']),
    post('c', 13, ['common']),
    post('d', 30, ['common', 'rare']),
    post('e', 9, []),
  ];
  const got = pick(cur, posts);
  check('common tag: shared rare tag ranks first', got[0] === 'd', JSON.stringify(got));
  // Without the rare tag, all others score 0: nearest publish time wins.
  deepEqual('common tag: only common tag shared = no score, nearest time order', got, ['d', 'a', 'e']);
  check('COMMON_TAG_SHARE is 0.5', COMMON_TAG_SHARE === 0.5, String(COMMON_TAG_SHARE));
}
{
  // Exactly 50% is not above the share: the tag still scores.
  const cur = post('cur', 10, ['half']);
  const posts = [cur, post('a', 50, ['half']), post('b', 11, []), post('c', 12, [])];
  deepEqual('common tag: tag on exactly half of posts still scores', pick(cur, posts), ['a', 'b', 'c']);
}
{
  // Share is counted per language: a tag common in zh does not affect en.
  const cur = post('cur', 10, ['t']);
  const posts = [
    cur, post('a', 40, ['t']), post('b', 11, []), post('c', 12, []),
    post('z1', 10, ['t'], 'zh'), post('z2', 10, ['t'], 'zh'), post('z3', 10, ['t'], 'zh'),
  ];
  deepEqual('common tag: share counted in the current language only', pick(cur, posts), ['a', 'b', 'c']);
}
{
  // Duplicate tags on one post count once: b would outrank the nearer c otherwise.
  const cur = post('cur', 10, ['x', 'x']);
  const posts = [
    cur, post('a', 11, ['y']), post('b', 40, ['x', 'x']), post('c', 35, ['x']), post('d', 12, []),
    post('e', 200, []), post('f', 200, []),
  ];
  deepEqual('duplicate tags score once', pick(cur, posts), ['c', 'b', 'a']);
}

// ---------- 2. category bonus ----------
{
  const cats = { 'json-formatter-guide': 'data', 'yaml-json-guide': 'data', 'regex-tester-guide': 'code', 'uuid-generator-guide': 'ids' };
  const cur = post('json-formatter-guide', 10);
  const posts = [
    cur,
    post('regex-tester-guide', 11),
    post('uuid-generator-guide', 10),
    post('yaml-json-guide', 60),
    post('json-formatter-cheat-sheet', 10),
  ];
  const got = pick(cur, posts, cats);
  check('category: same-category guide ranks first despite larger time gap', got[0] === 'yaml-json-guide', JSON.stringify(got));
  // A tag match plus category beats a tag match alone.
  const cur2 = post('json-formatter-guide', 10, ['t1']);
  const posts2 = [
    cur2,
    post('regex-tester-guide', 10, ['t1']),
    post('yaml-json-guide', 90, ['t1']),
    post('other', 10, []),
    post('other2', 10, []),
    post('other3', 10, []),
    post('other4', 10, []),
  ];
  deepEqual('category: tag + category beats tag only', pick(cur2, posts2, cats), ['yaml-json-guide', 'regex-tester-guide', 'other']);
  // No bonus when the dir is not a known tool guide.
  const cur3 = post('base64-encoding-explained', 10);
  const posts3 = [cur3, post('yaml-json-guide', 90), post('regex-tester-guide', 11)];
  deepEqual('category: non-guide current post gets no bonus', pick(cur3, posts3, { ...cats, 'base64-guide': 'encoding' }), ['regex-tester-guide', 'yaml-json-guide']);
  const cur4 = post('unknown-tool-guide', 10);
  const posts4 = [cur4, post('yaml-json-guide', 90), post('regex-tester-guide', 11), post('unknown2-guide', 50)];
  deepEqual('category: unknown tool guide gets no bonus', pick(cur4, posts4, cats), ['regex-tester-guide', 'unknown2-guide', 'yaml-json-guide']);
  // Object prototype keys are not guides.
  const cur5 = post('constructor', 10);
  const posts5 = [cur5, post('toString', 90), post('x', 11)];
  deepEqual('category: prototype keys are not guide dirs', pick(cur5, posts5, cats), ['x', 'toString']);
}

// ---------- 3. tie order: time gap, then dir ----------
{
  const cur = post('cur', 100, ['t']);
  const posts = [
    cur,
    post('x1', 100), post('x2', 100), post('x3', 100), post('x4', 100), post('x5', 100),
    post('far', 150, ['t']),
    post('before', 97, ['t']),
    post('after', 103, ['t']),
    post('near', 101, ['t']),
  ];
  deepEqual('ties: smaller absolute time gap first, then dir name', pick(cur, posts, {}, 4), ['near', 'after', 'before', 'far']);
}

// ---------- 4. fill ----------
{
  const cur = post('cur', 100, ['t']);
  const posts = [cur, post('match', 10, ['t']), post('n1', 99), post('n2', 102), post('n3', 130)];
  deepEqual('fill: 1 match + 2 nearest', pick(cur, posts), ['match', 'n1', 'n2']);
  const small = [cur, post('only', 5)];
  deepEqual('fill: fewer posts than limit returns all others', pick(cur, small), ['only']);
  deepEqual('fill: single post returns empty list', pick(cur, [cur]), []);
}

// ---------- 5. determinism ----------
{
  const cur = post('cur', 100, ['t']);
  const base = [cur];
  for (let i = 0; i < 40; i++) base.push(post('p' + String(i).padStart(2, '0'), 100 + (i % 5) - 2, i % 3 ? [] : ['t']));
  const first = pick(cur, base);
  let same = true;
  for (let seed = 1; seed <= 20; seed++) {
    const shuffled = base.slice();
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (JSON.stringify(pick(cur, shuffled)) !== JSON.stringify(first)) same = false;
  }
  check('determinism: 20 shuffled input orders give the same result', same);
  // Scoring posts are p00, p03, ..., p39; gap is |i % 5 - 2| days.
  deepEqual('determinism: equal score and gap ordered by dir name', first, ['p12', 'p27', 'p03']);
}

// ---------- 6. self exclusion, same language ----------
{
  const cur = post('cur', 10, ['t']);
  const posts = [cur, post('cur', 10, ['t'], 'zh'), post('a', 10, ['t'], 'ja'), post('b', 50, []), post('c', 60, [])];
  const got = pick(cur, posts);
  check('self: current dir never returned', !got.includes('cur'), JSON.stringify(got));
  deepEqual('language: only same-language posts returned', got, ['b', 'c']);
  check('language: returned posts all have the current language',
    selectRelatedPosts(cur, posts, {}, 3).every((p) => p.lang === 'en'));
}

// ---------- 7. real blog data ----------
{
  const blogDir = join(root, 'src/content/blog');
  const toolsSrc = readFileSync(join(root, 'src/data/tools.ts'), 'utf8');
  const cats = {};
  // Mirror guideDirFor() in src/data/guides.ts.
  const overrides = {};
  const guidesSrc = readFileSync(join(root, 'src/data/guides.ts'), 'utf8');
  for (const m of guidesSrc.matchAll(/^\s*'([^']+)':\s*'([^']+)',$/gm)) overrides[m[1]] = m[2];
  check('real data: guide dir overrides parsed', Object.keys(overrides).length > 0, JSON.stringify(overrides));
  for (const dir of Object.values(overrides)) {
    check(`real data: override guide ${dir} exists`, existsSync(join(blogDir, dir, 'en.mdx')));
  }
  for (const m of toolsSrc.matchAll(/\{\s*slug:\s*'([^']+)'[\s\S]*?category:\s*'([a-z]+)'/g)) {
    cats[overrides[m[1]] ?? `${m[1]}-guide`] = m[2];
  }
  check('real data: tools.ts categories parsed', Object.keys(cats).length > 100, String(Object.keys(cats).length));
  for (const lang of ['en', 'zh']) {
    const posts = [];
    for (const dir of readdirSync(blogDir).sort()) {
      const file = join(blogDir, dir, lang + '.mdx');
      if (!existsSync(file)) continue;
      const fm = readFileSync(file, 'utf8').split('---')[1];
      if (/^draft:\s*true/m.test(fm)) continue;
      const date = /^pubDate:\s*"?([^"\n]+)"?/m.exec(fm)[1];
      const tagLine = /^tags:\s*(\[.*\])/m.exec(fm);
      posts.push({ dir, lang, tags: tagLine ? JSON.parse(tagLine[1]) : [], time: new Date(date).getTime() });
    }
    const inbound = new Map(posts.map((p) => [p.dir, 0]));
    let selfLinks = 0;
    let short = 0;
    for (const p of posts) {
      const got = selectRelatedPosts(p, posts, cats, 3);
      if (got.length !== Math.min(3, posts.length - 1)) short++;
      for (const r of got) {
        if (r.dir === p.dir) selfLinks++;
        inbound.set(r.dir, inbound.get(r.dir) + 1);
      }
    }
    const max = Math.max(...inbound.values());
    check(`real data (${lang}): ${posts.length} posts, none links to itself`, selfLinks === 0, String(selfLinks));
    check(`real data (${lang}): every post gets 3 related posts`, short === 0, String(short));
    check(`real data (${lang}): no post is related to more than a quarter of posts`, max <= posts.length / 4, 'max ' + max);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
