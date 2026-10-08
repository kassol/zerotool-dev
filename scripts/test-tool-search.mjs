// Tests for the tool directory search (src/components/tool-search.mjs) used by
// ToolSearchBar.astro on the home page and /tools/ in four languages.
//
// Read: src/components/tool-search.mjs, src/data/tools.ts (real names and descriptions,
// transpiled with the project's TypeScript), src/i18n/*.json, the three directory components,
// and dist/ (optional: localized Quick launch labels and card attributes, after a build).
// Run:  node scripts/test-tool-search.mjs
//
// Before 2026-10-08 a card matched only when the whole query was a substring of
// "slug name description": "format json", "compress gif", "格式化 json", "dns 조회" and
// "gif 압축" found nothing, and "gif" listed Slugify first and GIF Compressor fifth.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  normalizeSearchText, tokenizeQuery, makeEntry, wordScore, scoreEntry, searchEntries,
} from '../src/components/tool-search.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let passes = 0;
let failures = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else { failures++; console.log('FAIL: ' + name + (detail ? ' — ' + detail : '')); }
}
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
};

// ---------- tokenizer ----------
eq('NFKC + lower case + full-width space', tokenizeQuery('ＪＳＯＮ　格式化').map((w) => w.text), ['json', '格式化']);
eq('Latin and CJK split without a space', tokenizeQuery('格式化json').map((w) => [w.text, w.cjk]), [['格式化', true], ['json', false]]);
eq('Hangul splits from Latin', tokenizeQuery('dns조회').map((w) => w.text), ['dns', '조회']);
eq('generic words dropped when others remain', tokenizeQuery('json formatter online').map((w) => w.text), ['json', 'formatter']);
eq('a generic word alone is kept', tokenizeQuery('tool').map((w) => w.text), ['tool']);
eq('list punctuation separates words', tokenizeQuery('json、yaml/toml').map((w) => w.text), ['json', 'yaml', 'toml']);
eq('hyphen stays inside a word (slugs)', tokenizeQuery('json-formatter').map((w) => w.text), ['json-formatter']);
eq('empty query', tokenizeQuery('   '), []);
eq('half-width katakana folds to full width', normalizeSearchText('ｶﾗｰ'), 'カラー');

// ---------- score tiers ----------
{
  const e = makeEntry({ slug: 'gif-compressor', name: 'GIF Compressor', description: 'Shrink animated GIFs.', altNames: ['GIF 压缩工具'] });
  eq('exact name', wordScore(e, 'gif compressor'), 100);
  eq('exact slug', wordScore(e, 'gif-compressor'), 100);
  eq('name prefix', wordScore(e, 'gif'), 80);
  eq('word start in name', wordScore(e, 'compress'), 60);
  eq('Latin word inside a name word (not at a word start)', wordScore(e, 'ompress'), 12);
  // CJK names have no word boundaries: a hit inside them keeps the inside-name score.
  const c = makeEntry({ slug: 'gif-compressor', name: 'GIF 压缩工具', description: '', altNames: [] });
  eq('CJK word inside a CJK name', wordScore(c, '缩工'), 40);
  eq('Latin word after a hyphen in the slug', wordScore(e, 'compressor'), 60);
  eq('other-language name, word start', wordScore(e, '压缩'), 30);
  eq('other-language name, inside', wordScore(e, '缩工'), 20);
  eq('description word start', wordScore(e, 'shrink'), 15);
  eq('inside description', wordScore(e, 'nimated'), 10);
  eq('no hit', wordScore(e, 'jpeg'), 0);
  check('every word must hit', scoreEntry(e, tokenizeQuery('gif jpeg'), 'gif jpeg') === 0);
  check('plural falls back to singular', scoreEntry(e, tokenizeQuery('gifs'), 'gifs') > 0);
  // CJK run not found as a whole: generic words removed, the rest covered by found pieces.
  const z = makeEntry({ slug: 'gif-compressor', name: 'GIF 压缩工具', description: '在浏览器中压缩 GIF 动图。', altNames: [] });
  check('CJK run covered by pieces', scoreEntry(z, tokenizeQuery('压缩动图'), '压缩动图') > 0);
  check('CJK run with an unknown piece fails', scoreEntry(z, tokenizeQuery('压缩视频'), '压缩视频') === 0);
  check('CJK run of only generic words is ignored next to another word', scoreEntry(z, tokenizeQuery('gif 在线工具'), 'gif 在线工具') > 0);
  // Equal scores keep the input order; better tiers come first.
  const list = [
    makeEntry({ slug: 'slugify', name: 'Slugify String', description: '', altNames: [] }),
    makeEntry({ slug: 'webp', name: 'WebP Converter', description: 'Convert GIF files.', altNames: [] }),
    makeEntry({ slug: 'gif-a', name: 'GIF A', description: '', altNames: [] }),
    makeEntry({ slug: 'gif-b', name: 'GIF B', description: '', altNames: [] }),
  ];
  eq('ranking: prefix, prefix (input order), description word start, inside a name word', searchEntries(list, 'gif'), [2, 3, 1, 0]);
  eq('empty query returns null (no filter)', searchEntries(list, ''), null);
}

// ---------- real data ----------
const src = readFileSync(join(root, 'src/data/tools.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { allTools } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const LANGS = ['en', 'zh', 'ja', 'ko'];
const entriesFor = (lang) => allTools.map((t) => makeEntry({
  slug: t.slug,
  name: t.translations[lang].name,
  description: t.translations[lang].description,
  altNames: LANGS.filter((l) => l !== lang).map((l) => t.translations[l].name),
}));
const slugsFor = (lang, q) => (searchEntries(entriesFor(lang), q) || []).map((i) => allTools[i].slug);
// The pre-2026-10-08 rule, for the record of what changed.
const oldCount = (lang, q) => allTools.filter((t) => `${t.slug} ${t.translations[lang].name.toLowerCase()} ${t.translations[lang].description.toLowerCase()}`.includes(q.trim().toLowerCase())).length;

const expectFirst = [
  ['en', 'format json', 'json-formatter'],
  ['en', 'compress gif', 'gif-compressor'],
  ['zh', '格式化 json', 'json-formatter'],
  ['zh', '格式化json', 'json-formatter'],
  ['ko', 'dns 조회', 'dns-lookup'],
  ['ko', 'gif 압축', 'gif-compressor'],
  ['ja', 'json 整形', 'json-formatter'],
  ['ja', 'ｇｉｆ　圧縮', 'gif-compressor'],
  // Names in other languages: the same queries work on every page.
  ['zh', 'compress gif', 'gif-compressor'],
  ['en', 'dns 조회', null],
  ['en', 'gif 압축', null],
  ['en', '格式化 json', 'json-formatter'],
];
for (const [lang, q, first] of expectFirst) {
  const got = slugsFor(lang, q);
  if (first) check(`${lang} "${q}" lists ${first} first`, got[0] === first, JSON.stringify(got.slice(0, 5)));
  else check(`${lang} "${q}" finds nothing (the word is only in the ko description)`, got.length === 0, JSON.stringify(got));
  console.log(`  ${lang} ${JSON.stringify(q)}: ${got.length} results (before: ${oldCount(lang, q)}), top 3: ${got.slice(0, 3).join(', ') || '—'}`);
}
for (const lang of LANGS) {
  const got = slugsFor(lang, 'gif');
  check(`${lang} "gif": the two GIF tools come first`, got.slice(0, 2).sort().join() === 'gif-compressor,gif-splitter', JSON.stringify(got));
  // "gif" is inside "slu-gif-y" (not at a word start): it ranks below description word starts.
  check(`${lang} "gif": slugify ranks after the tools whose description has the word "gif"`,
    got.indexOf('slugify') > got.indexOf('webp-converter') && got.indexOf('slugify') > got.indexOf('sprite-sheet-generator'), JSON.stringify(got));
}
// Full result lists recorded on 2026-10-08 before the word-start change; they must not change.
const unchanged = [
  ['en', 'format json', ['json-formatter', 'toml-json']],
  ['en', 'compress gif', ['gif-compressor']],
  ['zh', '格式化 json', ['json-formatter', 'json-xml-converter', 'env-file-parser']],
  ['ko', 'dns 조회', ['dns-lookup']],
  ['ko', 'gif 압축', ['gif-compressor']],
];
for (const [lang, q, list] of unchanged) eq(`${lang} "${q}" results unchanged`, slugsFor(lang, q), list);
for (const lang of LANGS) {
  for (const t of allTools) {
    const name = t.translations[lang].name;
    if (slugsFor(lang, name)[0] !== t.slug && !allTools.some((o) => o !== t && o.translations[lang].name === name)) {
      check(`${lang}: searching the exact name "${name}" lists ${t.slug} first`, false, JSON.stringify(slugsFor(lang, name).slice(0, 3)));
    }
    if (slugsFor(lang, t.slug)[0] !== t.slug) check(`${lang}: searching the slug ${t.slug} lists it first`, false);
  }
}
check('every tool can be found by its own name and slug', true);

// ---------- components ----------
const bar = readFileSync(join(root, 'src/components/ToolSearchBar.astro'), 'utf8');
const dir = readFileSync(join(root, 'src/components/ToolDirectory.astro'), 'utf8');
const filter = readFileSync(join(root, 'src/components/CategoryFilter.astro'), 'utf8');
check('ToolSearchBar uses tool-search.mjs', /from '\.\/tool-search\.mjs'/.test(bar) && /searchEntries\(/.test(bar));
check('cards carry name, description and other-language names', /data-name=\{tool\.name\}/.test(dir) && /data-desc=\{tool\.description\}/.test(dir) && /data-alt=\{tool\.altNames\}/.test(dir));
check('the old whole-string data-keywords match is gone', !/data-keywords/.test(dir + bar + filter));
check('Quick launch labels use the category i18n key', /<small>\{t\(lang, `category\.\$\{tool\.category\}`\)\}<\/small>/.test(dir) && !/<small>\{tool\.category\}<\/small>/.test(dir));
check('CategoryFilter delegates to window.__ztApply', /window\.__ztApply/.test(filter) && !/indexOf\(q\)/.test(filter));
const cats = [...filter.matchAll(/'(\w+)'/g)].map((m) => m[1]).filter((c) => c !== 'all');
for (const lang of LANGS) {
  const i18n = JSON.parse(readFileSync(join(root, `src/i18n/${lang}.json`), 'utf8'));
  for (const c of new Set(allTools.map((t) => t.category))) {
    const v = i18n[`category.${c}`] ?? i18n.category?.[c];
    check(`${lang}: category.${c} has a label`, typeof v === 'string' && v.length > 0 && (lang === 'en' || v !== c), String(v));
  }
}
check('category list parsed', cats.length >= 8);

// ---------- dist (optional) ----------
const distZh = join(root, 'dist/zh/index.html');
if (existsSync(distZh)) {
  for (const lang of LANGS) {
    const html = readFileSync(join(root, 'dist', lang === 'en' ? '' : lang, 'index.html'), 'utf8');
    const labels = [...html.matchAll(/class="panel-tool"[\s\S]*?<small[^>]*>([^<]*)<\/small>/g)].map((m) => m[1]);
    check(`dist ${lang}: Quick launch has 5 labels`, labels.length === 5, String(labels.length));
    if (lang !== 'en') check(`dist ${lang}: Quick launch labels are localized`, labels.every((l) => !/^(data|color|encoding|text|security|dev|api|image)$/.test(l)), labels.join(','));
    const tools = readFileSync(join(root, 'dist', lang === 'en' ? '' : lang, 'tools/index.html'), 'utf8');
    check(`dist ${lang}: /tools/ cards carry data-alt`, (tools.match(/data-alt="/g) || []).length === allTools.length);
    check(`dist ${lang}: /tools/ has no Quick launch panel`, !/class="hero-panel"/.test(tools));
  }
} else {
  console.log('SKIP: dist/ not built; run npm run build for the dist checks');
}

console.log(`Tool search: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
