// llms.txt — builder unit tests and built-file checks
//
// Read:  src/data/llms.mjs, src/data/tools.ts, src/data/network.ts, src/data/persistence.ts,
//        src/i18n/*.json, dist/llms.txt, dist/{zh,ja,ko}/llms.txt, dist/llms-full.txt,
//        dist/sitemap-*.xml (run `npm run build` first)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: plain-text and frontmatter steps rules and limits; file structure per
// llmstxt.org (H1, blockquote, notes without headings, H2 file lists of `[name](url)`
// items); every zerotool.dev URL in the built files is in the sitemap (or is one of the
// llms files), every tool URL's slug is in tools.ts, and every tool in tools.ts is listed
// in each file; tools in network.ts carry their network note and no "stays offline"
// wording (for example "100% client-side"); the old hand-written files in public/ are gone.
//
// Run: node scripts/test-llms-txt.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { runInNewContext } from 'node:vm';
import { defineCollection } from 'astro/content/config';
import { z } from 'zod';
import {
  plainText, toolSteps, buildLlmsTxt, buildLlmsFullTxt, toolUrl, llmsUrl,
  MAX_STEPS, MAX_STEP_CHARS, MAX_HOWTO_CHARS, CATEGORY_ORDER, LLMS_LANGS, SITE,
} from '../src/data/llms.mjs';
import { parseToolsSource } from './generate-og.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function throws(name, fn, re) {
  try { fn(); check(name, false, 'did not throw'); } catch (e) { check(name, re.test(e.message), e.message); }
}

// Execute the complete tool content schema with the installed Astro/Zod implementation.
const configPath = join(root, 'src/content/config.ts');
const configSource = readFileSync(configPath, 'utf8');
const collections = runInNewContext(
  configSource.replace("import { defineCollection, z } from 'astro:content';", '')
    .replace('export const collections =', 'const collections =') + '\ncollections;',
  { defineCollection, z }, { filename: configPath },
);
const toolsSchema = collections.tools.schema;
const schemaFixture = { seoTitle: 'Test tool', seoDescription: 'Test tool description.' };
check('tools schema requires steps', !toolsSchema.safeParse(schemaFixture).success);
check('tools schema rejects empty steps', !toolsSchema.safeParse({ ...schemaFixture, steps: [] }).success);
check('tools schema accepts a short steps array', toolsSchema.safeParse({ ...schemaFixture, steps: ['Copy the result.'] }).success);

// Wording that says a tool makes no network requests. Network tools must not use it.
// "not uploaded" / "不上传" stays allowed: it is true for these tools (they download, not upload).
const OFFLINE_CLAIMS = [
  /100% client[- ]?side/i, /100% local/i, /runs? entirely (in|on) (your |the )?(browser|client)/i,
  /never leaves/i, /(no|nothing) (data |input )?(leaves|is sent)/i, /no network/i, /works offline/i,
  /纯浏览器端运行/, /100% 浏览器端/, /完全在浏览器中运行/, /数据不离开/, /不联网/, /离线/,
  /ブラウザ完結/, /ブラウザ外に出ません/, /通信しません/, /オフライン/,
  /100% 클라이언트/, /브라우저에서 완결/, /브라우저 밖으로 나가지/, /네트워크를 사용하지 않/, /오프라인/,
];
const offlineClaim = (text) => OFFLINE_CLAIMS.find((re) => re.test(text));

// ── Unit: plainText ──────────────────────────────────────────────────────────
equal('plainText strips tags and bold', plainText('Click <strong>Format</strong> to **prettify**.'), 'Click Format to prettify.');
equal('plainText keeps inline code', plainText('Paste into <code>&lt;head&gt;</code> or `a **b**`'), 'Paste into `<head>` or `a **b**`');
equal('plainText decodes entities', plainText('a &#123; b &#125; &amp; c&nbsp;d &rarr; e'), 'a { b } & c d → e');
equal('plainText keeps link text', plainText('See [RFC 6068](https://www.rfc-editor.org/rfc/rfc6068) ![x](y.png)'), 'See RFC 6068');
equal('plainText expands MDX string expressions', plainText("Type {'[x](url)'} here"), 'Type [x](url) here');
equal('plainText collapses whitespace', plainText('  a\n   b\t c '), 'a b c');
equal('plainText restores a string expression inside <code>', plainText(`click <code>+ nonce</code> to add <code>{"'nonce-{RANDOM}'"}</code>.`), "click `+ nonce` to add `'nonce-{RANDOM}'`.");

// ── Unit: frontmatter steps ──────────────────────────────────────────────────
equal('toolSteps cleans HTML fragments', toolSteps({ steps: ['Paste <strong>JSON</strong>.', 'Click Copy.'] }), ['Paste JSON.', 'Click Copy.']);
equal('toolSteps cleans Markdown, links and continuation whitespace', toolSteps({ steps: ['Paste **Markdown**.', 'Pick a [paper](https://example.com) size\n   and a font.', 'Click `Download`.'] }), ['Paste Markdown.', 'Pick a paper size and a font.', 'Click `Download`.']);
equal('toolSteps missing steps returns no steps', toolSteps({}), []);
equal('toolSteps empty steps returns no steps', toolSteps({ steps: [] }), []);
equal('toolSteps non-array steps returns no steps', toolSteps({ steps: 'Do it.' }), []);
const many = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}.`);
equal('toolSteps keeps at most MAX_STEPS', toolSteps({ steps: many }).length, MAX_STEPS);
const long = toolSteps({ steps: ['word '.repeat(200)] });
check('toolSteps cuts a long step to MAX_STEP_CHARS with …', long.length === 1 && long[0].length <= MAX_STEP_CHARS && long[0].endsWith('…'), JSON.stringify(long));
const wide = Array.from({ length: 8 }, (_, i) => `${'x'.repeat(270)} ${i}`);
const wideSteps = toolSteps({ steps: wide });
check('toolSteps keeps whole steps within MAX_HOWTO_CHARS', wideSteps.length === 4 && wideSteps.join('').length <= MAX_HOWTO_CHARS, `${wideSteps.length} steps, ${wideSteps.join('').length} chars`);

// ── Unit: builders on fixture data ───────────────────────────────────────────
const tr = (name, description) => ({ en: { name, description }, zh: { name: name + '-zh', description: description + '（中）' }, ja: { name: name + '-ja', description }, ko: { name: name + '-ko', description } });
const messagesFor = (lang) => ({
  'footer.tagline': `tagline-${lang}`,
  ...Object.fromEntries(CATEGORY_ORDER.map((c) => [`category.${c}`, `${c}-${lang}`])),
  'network.net-tool': `sends-${lang}`,
  'networkOptional.opt-tool': `option-${lang}`,
});
const fixture = {
  tools: [
    { slug: 'zeta', category: 'data', translations: tr('Zeta', 'Formats data.') },
    { slug: 'alpha', category: 'data', translations: tr('Alpha', 'Checks data') },
    { slug: 'net-tool', category: 'web', translations: tr('Net', 'Looks things up.') },
    { slug: 'opt-tool', category: 'text', translations: tr('Opt', 'Converts text.') },
    { slug: 'secret', category: 'security', translations: tr('Secret', 'Handles keys.') },
  ],
  networkSlugs: ['net-tool'],
  optionalNetworkSlugs: ['opt-tool'],
  sensitiveSlugs: ['secret'],
  messages: Object.fromEntries(LLMS_LANGS.map((l) => [l, messagesFor(l)])),
};
const fx = buildLlmsTxt(fixture, 'en');
const fxLines = fx.split('\n');
equal('fixture: H1 first', fxLines[0], '# ZeroTool');
equal('fixture: blockquote from footer.tagline', fxLines[2], '> tagline-en');
check('fixture: tool count in intro', fx.includes('has 5 free developer tools'));
check('fixture: tools sorted by slug within a category', fx.indexOf('[Alpha]') < fx.indexOf('[Zeta]'));
check('fixture: categories in filter order', fx.indexOf('## data-en') < fx.indexOf('## text-en') && fx.indexOf('## text-en') < fx.indexOf('## security-en') && fx.indexOf('## security-en') < fx.indexOf('## web-en'));
check('fixture: missing period added to description', fx.includes('(https://zerotool.dev/tools/alpha/): Checks data.'));
check('fixture: network note on the tool line', fx.includes('- [Net](https://zerotool.dev/tools/net-tool/): Looks things up. Network: sends-en.'));
check('fixture: optional network note on the tool line', fx.includes('Converts text. Network: option-en.'));
check('fixture: network tools listed in the notes', fx.includes('  - [Net](https://zerotool.dev/tools/net-tool/): sends-en.'));
check('fixture: sensitive tools listed', fx.includes('load neither: [Secret](https://zerotool.dev/tools/secret/).'));
check('fixture: other languages link to their llms.txt', ['zh', 'ja', 'ko'].every((l) => fx.includes(`](${llmsUrl(l)})`)));
const fxZh = buildLlmsTxt(fixture, 'zh');
check('fixture zh: localized names and URLs', fxZh.includes('- [Alpha-zh](https://zerotool.dev/zh/tools/alpha/): Checks data（中）。'));
check('fixture zh: CJK network label without a space', fxZh.includes('Looks things up.（中）。联网：sends-zh。'));
check('fixture zh: links back to the English file', fxZh.includes(`[English](${llmsUrl('en')})`));
throws('unknown category throws', () => buildLlmsTxt({ ...fixture, tools: [{ slug: 'x', category: 'misc', translations: tr('X', 'x') }] }, 'en'), /unknown category/);
throws('missing i18n network key throws', () => buildLlmsTxt({ ...fixture, networkSlugs: ['alpha'] }, 'en'), /missing i18n key network\.alpha/);
throws('unsupported language throws', () => buildLlmsTxt(fixture, 'fr'), /unsupported language/);
const pages = Object.fromEntries(fixture.tools.map((t) => [t.slug, { seoDescription: t.slug === 'zeta' ? 'Formats data.' : 'Page summary here.', steps: ['Do it.'] }]));
const fxFull = buildLlmsFullTxt(fixture, pages);
check('fixture full: one H2 per tool', (fxFull.match(/^## /gm) || []).length === fixture.tools.length);
const fullBlock = (name) => fxFull.slice(fxFull.indexOf(`## ${name}\n`)).split(/\n(?=## )/)[0];
check('fixture full: page summary omitted when equal to the description', !fullBlock('Zeta').includes('Page summary'), fullBlock('Zeta'));
check('fixture full: page summary shown when it differs', fullBlock('Alpha').includes('- Page summary: Page summary here.'), fullBlock('Alpha'));
check('fixture full: network none for local tools', fxFull.includes('- Network: None.'));
check('fixture full: network note for network tools', fxFull.includes('- Network: sends-en.'));
check('fixture full: sensitive storage line', /## Secret[\s\S]*?saves nothing in the browser/.test(fxFull));
check('fixture full: steps copied', fxFull.includes('How to use:\n\n1. Do it.'));
// Frontmatter steps are the only source; body content never supplies steps.
equal('toolSteps: frontmatter steps first', toolSteps({ steps: ['Paste `JSON`.', '**Copy** it.'], body: '## How to Use\n\n1. Old.\n' }), [plainText('Paste `JSON`.'), 'Copy it.']);
equal('toolSteps: empty steps do not read the body', toolSteps({ steps: [], body: '## How to Use\n\n1. Old.\n' }), []);
equal('toolSteps: no steps field does not read the body', toolSteps({ body: '## How to Use\n\n1. Old.\n' }), []);
equal('toolSteps: steps keep the MAX_STEPS limit', toolSteps({ steps: Array.from({ length: 12 }, (_, i) => 'Step ' + i + '.') }).length, MAX_STEPS);
const stepsPages = { ...pages, alpha: { ...pages.alpha, steps: ['From frontmatter.'] } };
const fxSteps = buildLlmsFullTxt(fixture, stepsPages);
check('fixture full: frontmatter steps replace the body steps', fxSteps.slice(fxSteps.indexOf('## Alpha\n')).split(/\n(?=## )/)[0].includes('How to use:\n\n1. From frontmatter.'));
throws('full: missing content entry throws', () => buildLlmsFullTxt(fixture, { zeta: pages.zeta }), /no English content entry/);

// ── Built files ──────────────────────────────────────────────────────────────
equal('public/llms.txt removed (generated by src/pages/llms.txt.ts)', existsSync(join(root, 'public', 'llms.txt')), false);
equal('public/llms-full.txt removed (generated by src/pages/llms-full.txt.ts)', existsSync(join(root, 'public', 'llms-full.txt')), false);

// Static files skip Pages Functions: /llms.txt is listed, /llms-full.txt falls under /*-*,
// /{zh,ja,ko}/llms.txt under /{lang}/*. No _redirects rule may catch them.
const routes = JSON.parse(readFileSync(join(root, 'public', '_routes.json'), 'utf-8'));
check('_routes.json excludes /llms.txt', routes.exclude.includes('/llms.txt'));
check('_routes.json excludes the other llms files', ['/*-*', '/zh/*', '/ja/*', '/ko/*'].every((p) => routes.exclude.includes(p)));
const redirectSources = readFileSync(join(root, 'public', '_redirects'), 'utf-8').split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((s) => s && !s.startsWith('#'));
check('_redirects has no rule for llms files', !redirectSources.some((s) => /llms/.test(s) || s === '/*'), redirectSources.filter((s) => /llms/.test(s)).join(' '));

const dist = join(root, 'dist');
const files = {
  en: join(dist, 'llms.txt'),
  zh: join(dist, 'zh', 'llms.txt'),
  ja: join(dist, 'ja', 'llms.txt'),
  ko: join(dist, 'ko', 'llms.txt'),
  full: join(dist, 'llms-full.txt'),
};
const missing = Object.values(files).filter((f) => !existsSync(f));
if (missing.length) {
  check('built llms files exist (run npm run build first)', false, missing.join(', '));
} else {
  for (const [name, file] of Object.entries(files)) {
    equal(`${name}: no NUL bytes (a kept piece that was not restored)`, readFileSync(file).indexOf(0), -1);
  }
  const tools = parseToolsSource(readFileSync(join(root, 'src', 'data', 'tools.ts'), 'utf-8'));
  const slugs = new Set(tools.map((t) => t.slug));
  const listOf = (source, name) => {
    const m = source.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) throw new Error(`cannot find ${name}`);
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  };
  const networkSource = readFileSync(join(root, 'src', 'data', 'network.ts'), 'utf-8').replace(/\/\/.*$/gm, '');
  const networkSlugs = listOf(networkSource, 'networkToolSlugs');
  const optionalSlugs = listOf(networkSource, 'optionalNetworkToolSlugs');
  const messages = Object.fromEntries(LLMS_LANGS.map((l) => [l, JSON.parse(readFileSync(join(root, 'src', 'i18n', `${l}.json`), 'utf-8'))]));
  check('network.ts lists parsed', networkSlugs.includes('meta-tag-generator') && optionalSlugs.includes('markdown-to-word'), JSON.stringify({ networkSlugs, optionalSlugs }));

  const sitemapUrls = new Set();
  for (const f of readdirSync(dist).filter((n) => /^sitemap-\d+\.xml$/.test(n))) {
    for (const m of readFileSync(join(dist, f), 'utf-8').matchAll(/<loc>([^<]+)<\/loc>/g)) sitemapUrls.add(m[1]);
  }
  check('sitemap read', sitemapUrls.size > slugs.size, `${sitemapUrls.size} URLs`);
  const llmsFileUrls = new Set([...LLMS_LANGS.map(llmsUrl), `${SITE}/llms-full.txt`]);

  const texts = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(f, 'utf-8')]));

  for (const [key, text] of Object.entries(texts)) {
    const lines = text.split('\n');
    equal(`${key}: H1 first`, lines[0], key === 'full' ? '# ZeroTool: full tool reference' : '# ZeroTool');
    check(`${key}: blockquote summary second`, lines[1] === '' && lines[2].startsWith('> '), lines.slice(0, 3).join(' | '));
    check(`${key}: only H1 and H2 headings`, !lines.some((l) => /^#{3,} /.test(l)) && lines.filter((l) => /^# /.test(l)).length === 1);

    const firstH2 = lines.findIndex((l) => l.startsWith('## '));
    const header = lines.slice(0, firstH2).join('\n');
    const claim = offlineClaim(header);
    check(`${key}: site notes make no blanket offline claim`, !claim, String(claim));

    if (key !== 'full') {
      // llmstxt.org: sections after the first H2 are file lists of `[name](url)` items.
      const bad = lines.slice(firstH2).filter((l) => l && !l.startsWith('## ') && !/^- \[[^\]]+\]\(https?:\/\/[^)\s]+\)(: .+)?$/.test(l));
      check(`${key}: H2 sections hold only "- [name](url): notes" items`, bad.length === 0, bad.slice(0, 3).join(' | '));
    }

    const urls = [...text.matchAll(/https:\/\/zerotool\.dev(\/[A-Za-z0-9._~/{}-]*)?/g)].map((m) => m[1] ? m[0] : m[0] + '/');
    const unknown = [...new Set(urls)].filter((u) => !sitemapUrls.has(u) && !llmsFileUrls.has(u) && !u.includes('{slug}'));
    check(`${key}: every zerotool.dev URL is in the sitemap or is an llms file`, unknown.length === 0, unknown.slice(0, 5).join(' '));
    const toolSlugsInFile = [...text.matchAll(/https:\/\/zerotool\.dev\/(?:(?:zh|ja|ko)\/)?tools\/([^/\s)]+)\//g)].map((m) => m[1]).filter((s) => s !== '{slug}');
    const notInTools = [...new Set(toolSlugsInFile)].filter((s) => !slugs.has(s));
    check(`${key}: every tool URL slug is in tools.ts`, notInTools.length === 0, notInTools.join(' '));

    const lang = key === 'full' ? 'en' : key;
    const absent = [...slugs].filter((s) => !text.includes(toolUrl(s, lang)));
    check(`${key}: every tool in tools.ts is listed`, absent.length === 0, absent.join(' '));
  }

  for (const lang of LLMS_LANGS) {
    const text = texts[lang];
    const lineFor = (slug) => text.split('\n').find((l) => l.startsWith(`- [`) && l.includes(`](${toolUrl(slug, lang)})`)) ?? '';
    for (const slug of [...networkSlugs, ...optionalSlugs]) {
      const line = lineFor(slug);
      const noteKey = networkSlugs.includes(slug) ? `network.${slug}` : `networkOptional.${slug}`;
      check(`${lang}: ${slug} entry carries its network note`, line.includes(messages[lang][noteKey]), line);
      const claim = offlineClaim(line);
      check(`${lang}: ${slug} entry has no offline wording`, !claim, `${claim} in ${line}`);
    }
  }

  const blocks = new Map();
  for (const block of texts.full.split(/\n(?=## )/).slice(1)) {
    const url = block.match(/^- URL: (\S+)$/m)?.[1];
    if (url) blocks.set(url, block);
  }
  equal('full: one entry per tool', blocks.size, slugs.size);
  for (const slug of slugs) {
    const block = blocks.get(toolUrl(slug)) ?? '';
    const isNetwork = networkSlugs.includes(slug) || optionalSlugs.includes(slug);
    if (isNetwork) {
      // The description lines; the "How to use" steps are quoted from the page and may say
      // when the tool stays offline (markdown-to-word: "while it is off, the export makes no network request").
      const descriptionLines = block.split('\n').filter((l) => /^- (Description|Page summary|Network):/.test(l)).join('\n');
      const claim = offlineClaim(descriptionLines);
      check(`full: ${slug} entry has no offline wording`, !claim, String(claim));
      check(`full: ${slug} entry states its network use`, !block.includes('- Network: None.') && block.includes(messages.en[networkSlugs.includes(slug) ? `network.${slug}` : `networkOptional.${slug}`]));
    } else {
      check(`full: ${slug} entry says Network: None`, block.includes('- Network: None.'), block.slice(0, 200));
    }
  }
  // Every registered tool has frontmatter steps in all four languages.
  const layoutSrc = readFileSync(join(root, 'src', 'data', 'tool-layouts.ts'), 'utf8');
  const layouts = [...layoutSrc.matchAll(/^\s*'([a-z0-9-]+)': '(?:convert|generate|analyze|compact|compare)',$/gm)].map((m) => m[1]);
  equal('steps: every tool has a legal layout kind', layouts.sort(), [...slugs].sort());
  const toolsDir = join(root, 'src', 'content', 'tools');
  const withSteps = [];
  for (const dir of readdirSync(toolsDir)) {
    for (const lang of LLMS_LANGS) {
      const src = readFileSync(join(toolsDir, dir, `${lang}.mdx`), 'utf8');
      const fm = src.split(/^---$/m)[1] ?? '';
      if (/^steps:/m.test(fm)) withSteps.push(`${dir}/${lang}`);
    }
  }
  equal('steps: exactly every tool, in every language', withSteps.sort(), [...slugs].flatMap((s) => LLMS_LANGS.map((l) => `${s}/${l}`)).sort());
  for (const slug of slugs) {
    for (const lang of LLMS_LANGS) {
      const fm = readFileSync(join(toolsDir, slug, `${lang}.mdx`), 'utf8').split(/^---$/m)[1];
      const { steps } = loadYaml(fm);
      check(`steps: ${slug}/${lang} meets plain-text and length limits`, Array.isArray(steps) && steps.length > 0 && steps.length <= MAX_STEPS && steps.every(step => typeof step === 'string' && step.trim() && step.length <= MAX_STEP_CHARS && !/<[^>]*>|\n/.test(step)) && steps.join('').length <= MAX_HOWTO_CHARS, JSON.stringify(steps));
      if (lang === 'en') {
        const block = blocks.get(toolUrl(slug)) ?? '';
        const expected = toolSteps({ steps }).map((step, i) => `${i + 1}. ${step}`).join('\n');
        check(`full: ${slug} lists all its frontmatter steps`, expected.length > 0 && block.includes('How to use:\n\n' + expected), block.slice(-MAX_HOWTO_CHARS - 100));
      }
    }
  }

}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
