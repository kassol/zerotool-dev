// Read: real site registries, i18n, Markdown/link builders, endpoints, routing
// and dist (build first). Write: stdout only. No network or browser state.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import domino from '@mixmark-io/domino';
import {
  SITE, LLMS_LANGS, CATEGORY_ORDER, AGENT_DOCUMENTS, agentResources,
  buildAgentMarkdown, buildLlmsTxt, langPrefix, toolUrl, llmsUrl,
} from '../src/data/llms.mjs';
import { aiQuestion, aiLinks } from '../src/data/agents.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const exists = (path) => existsSync(new URL(path, root));
let passes = 0, failures = 0;
function check(name, condition, detail = '') {
  if (condition) passes++;
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); }
}
function equal(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
}
function throws(name, fn, pattern) {
  try { fn(); check(name, false); }
  catch (error) { check(name, pattern.test(error.message), error.message); }
}
async function importTs(path) {
  const js = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const [{ allTools }, network, persistence] = await Promise.all([
  importTs('src/data/tools.ts'), importTs('src/data/network.ts'), importTs('src/data/persistence.ts'),
]);
const data = {
  tools: allTools,
  networkSlugs: network.networkToolSlugs,
  optionalNetworkSlugs: network.optionalNetworkToolSlugs,
  sensitiveSlugs: persistence.disabledPersistenceSlugs,
  messages: Object.fromEntries(LLMS_LANGS.map((lang) => [lang, JSON.parse(read(`src/i18n/${lang}.json`))])),
};
const resources = new Set(LLMS_LANGS.flatMap((lang) => agentResources(lang).map(({ href }) => href)));
const expectedDocuments = ['index', 'categories', 'about'];
equal('only the three implemented document types are published', AGENT_DOCUMENTS, expectedDocuments);
throws('unknown document rejected', () => buildAgentMarkdown(data, '../privacy'), /unsupported document/);
for (const fn of [agentResources, aiQuestion, aiLinks]) {
  throws('unsupported language rejected', () => fn('fr'), /unsupported language/);
}
throws('document builder rejects unknown language', () => buildAgentMarkdown(data, 'index', 'fr'), /unsupported language/);
throws('category builder rejects unknown category', () => buildAgentMarkdown({
  ...data, tools: [{ ...allTools[0], category: 'made-up' }],
}, 'categories'), /unknown category/);

const builtSitemap = readdirSync(new URL('dist/', root))
  .filter((name) => /^sitemap-\d+\.xml$/.test(name))
  .map((name) => read(`dist/${name}`)).join('\n');
const sitemapUrls = new Set([...builtSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
check('HTML sitemap is available', sitemapUrls.size > allTools.length);
check('machine documents stay outside the HTML sitemap', ![...sitemapUrls].some((url) => /\.(?:md|txt)\/?$/.test(url)));
const routes = JSON.parse(read('public/_routes.json'));
const distRoutes = JSON.parse(read('dist/_routes.json'));
const excluded = (path, rules) => rules.exclude.some((rule) =>
  new RegExp(`^${rule.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path));
const redirectPatterns = read('dist/_redirects').split('\n').map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/)[0])
  .map((pattern) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));
check('Pages serves Markdown with an explicit MIME type', /^\/\*\.md\n\s+Content-Type: text\/markdown; charset=utf-8$/m.test(read('dist/_headers')));
const responseSource = read('src/data/llms-input.ts').match(/export function markdownResponse\(text: string\) \{([\s\S]*?)\n\}/)?.[1];
check('Astro Markdown response helper exists', !!responseSource);
if (responseSource) {
  const response = new Function('text', responseSource)('# Test\n');
  equal('Astro response has the Markdown MIME type', response.headers.get('Content-Type'), 'text/markdown; charset=utf-8');
  equal('Astro response preserves UTF-8 content', await response.text(), '# Test\n');
}
for (const path of resources) {
  check(`${path}: generated file exists`, exists(`dist${path}`));
  check(`${path}: no handwritten public copy`, !exists(`public${path}`));
  check(`${path}: bypasses Functions in source and built routes`, excluded(path, routes) && excluded(path, distRoutes));
  check(`${path}: no redirect intercepts the file`, !redirectPatterns.some((pattern) => pattern.test(path)));
}

const footerKeys = Object.keys(data.messages.en).filter((key) => /^footer\.(agents|resource|ask|aiHint)/.test(key));
const endpoints = new Map([
  ['chatgpt', ['https://chatgpt.com', '/']],
  ['claude', ['https://claude.ai', '/new']],
  ['perplexity', ['https://www.perplexity.ai', '/search']],
  ['google-ai', ['https://www.google.com', '/search']],
  ['grok', ['https://grok.com', '/']],
]);
for (const lang of LLMS_LANGS) {
  const prefix = langPrefix(lang);
  const messages = data.messages[lang];
  check(`${lang}: all footer keys translated`, footerKeys.every((key) => typeof messages[key] === 'string' && messages[key].trim()));
  const question = aiQuestion(lang);
  equal(`${lang}: prompt contains only the two public source URLs`,
    question.match(/https:\/\/\S+/g), [llmsUrl(lang), `${SITE}${prefix}/index.md`]);
  check(`${lang}: links fit common URL length limits`, aiLinks(lang).every(({ href }) => href.length < 2000));
  equal(`${lang}: exactly five assistants`, aiLinks(lang).map(({ id }) => id), [...endpoints.keys()]);
  for (const assistant of aiLinks(lang)) {
    const url = new URL(assistant.href);
    equal(`${lang}/${assistant.id}: expected HTTPS destination`, [url.origin, url.pathname], endpoints.get(assistant.id));
    equal(`${lang}/${assistant.id}: question survives URL encoding`, url.searchParams.get('q'), question);
    equal(`${lang}/${assistant.id}: only declared URL parameters`,
      [...url.searchParams.keys()].sort(), assistant.id === 'google-ai' ? ['q', 'udm'] : ['q']);
    if (assistant.id === 'google-ai') {
      equal(`${lang}: Google AI Mode parameter`, url.searchParams.get('udm'), '50');
      equal(`${lang}: destination is accurately named`, assistant.name, 'Google AI Mode');
    }
  }
  const mdFiles = expectedDocuments.map((document) => `${prefix}/${document}.md`);
  const discovery = buildLlmsTxt(data, lang);
  check(`${lang}: llms discovers all Markdown companions`, mdFiles.every((path) => discovery.includes(`](${SITE}${path})`)));
  for (const document of expectedDocuments) {
    const path = `${prefix}/${document}.md`;
    const text = buildAgentMarkdown(data, document, lang);
    equal(`${path}: built content agrees with registry`, read(`dist${path}`), text);
    check(`${path}: one H1 and no HTML document wrapper`, (text.match(/^# /gm) || []).length === 1 && !/^<(?:!doctype|html)\b/im.test(text));
    for (const [, url] of text.matchAll(/\]\((https:\/\/zerotool\.dev\/[^)]+)\)/g)) {
      const pathname = new URL(url).pathname;
      check(`${path}: resolvable ${pathname}`, resources.has(pathname) ? exists(`dist${pathname}`) : sitemapUrls.has(url));
    }
  }
  const categories = buildAgentMarkdown(data, 'categories', lang);
  const catalogUrls = [...categories.matchAll(/^- \[[^\]]+\]\((https:\/\/zerotool\.dev\/(?:(?:zh|ja|ko)\/)?tools\/[^/]+\/)\):/gm)].map((m) => m[1]);
  equal(`${lang}: each tool appears once in its language`, [...catalogUrls].sort(), allTools.map((tool) => toolUrl(tool.slug, lang)).sort());
  let offset = -1;
  for (const category of CATEGORY_ORDER) {
    const members = allTools.filter((tool) => tool.category === category).sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
    const heading = `## ${messages[`category.${category}`]} (${members.length})\n`;
    const position = categories.indexOf(heading);
    check(`${lang}/${category}: category order and derived count`, position > offset);
    offset = position;
    const block = categories.slice(position).split(/\n(?=## )/)[0];
    const actual = [...block.matchAll(/^- \[[^\]]+\]\(([^)]+)\):/gm)].map((m) => m[1]);
    equal(`${lang}/${category}: membership and stable slug order`, actual, members.map((tool) => toolUrl(tool.slug, lang)));
  }
  for (const slug of [...data.networkSlugs, ...data.optionalNetworkSlugs]) {
    const line = categories.split('\n').find((line) => line.includes(`](${toolUrl(slug, lang)}):`)) || '';
    const key = `${data.networkSlugs.includes(slug) ? 'network' : 'networkOptional'}.${slug}`;
    check(`${lang}/${slug}: catalog discloses actual network use`, line.includes(messages[key]));
  }
  const about = buildAgentMarkdown(data, 'about', lang);
  check(`${lang}: sensitive tools are disclosed`, data.sensitiveSlugs.every((slug) => about.includes(`](${toolUrl(slug, lang)})`)));
  check(`${lang}: about explains storage and analytics`, about.includes('localStorage') && about.includes('Google Analytics 4') && about.includes('Google AdSense'));
  check(`${lang}: adding a registry tool updates counts and catalog`, (() => {
    const extra = { ...allTools[0], slug: 'agent-test-fixture' };
    const changed = buildAgentMarkdown({ ...data, tools: [...allTools, extra] }, 'categories', lang);
    return changed.includes(toolUrl(extra.slug, lang)) && changed !== categories;
  })());
  const endpoint = read(`src/pages${prefix}/[document].md.ts`);
  check(`${lang}: static endpoint uses the supported documents and current language`,
    endpoint.includes('AGENT_DOCUMENTS.map') && endpoint.includes(`params.document, '${lang}'`));

  const blogUrl = [...sitemapUrls].find((url) => new RegExp(`^${SITE}${prefix}/blog/[^/]+/$`).test(url));
  check(`${lang}: an indexable article is available for footer verification`, !!blogUrl);
  const article = blogUrl ? new URL(blogUrl).pathname.slice(prefix.length + 1) + 'index.html' : null;
  for (const page of ['index.html', 'about/index.html', 'tools/index.html', 'tools/json-formatter/index.html', 'tools/aes-encrypt-decrypt/index.html', ...(article ? [article] : [])]) {
    const label = `${prefix}/${page}`;
    const document = domino.createWindow(read(`dist${label}`)).document;
    const footer = document.querySelector('.footer-agents');
    check(`${label}: agent resources are in the footer`, footer?.parentElement?.tagName === 'FOOTER');
    if (!footer) continue;
    equal(`${label}: localized resource links`, Array.from(footer.querySelectorAll('.footer-resources a')).map((a) => a.getAttribute('href')),
      agentResources(lang).map(({ href }) => href));
    equal(`${label}: heading translated`, footer.querySelector('h2')?.textContent, messages['footer.agents']);
    for (const [i, a] of Array.from(footer.querySelectorAll('.footer-resources a')).entries()) {
      const resource = agentResources(lang)[i];
      equal(`${label}/${resource.name}: language and accessible explanation`,
        [a.getAttribute('hreflang'), a.getAttribute('aria-label')],
        [resource.lang, `${resource.name} — ${messages[resource.descriptionKey]}`]);
    }
    const links = Array.from(footer.querySelectorAll('[data-ai-provider]'));
    equal(`${label}: exactly five AI links`, links.length, 5);
    for (const [i, a] of links.entries()) {
      const assistant = aiLinks(lang)[i];
      equal(`${label}/${assistant.id}: fixed generated href`, a.getAttribute('href'), assistant.href);
      equal(`${label}/${assistant.id}: localized accessible name`, a.getAttribute('aria-label'),
        messages['footer.askProvider'].replace('{provider}', assistant.name));
      check(`${label}/${assistant.id}: isolated external navigation`,
        a.getAttribute('target') === '_blank' && ['noopener', 'noreferrer', 'external'].every((rel) => a.getAttribute('rel').split(' ').includes(rel)) &&
        a.getAttribute('referrerpolicy') === 'no-referrer' && a.getAttribute('data-astro-prefetch') === 'false');
      check(`${label}/${assistant.id}: inline decorative icon`, a.querySelector('svg')?.getAttribute('aria-hidden') === 'true');
    }
    check(`${label}: no footer scripts or remote assets`, !footer.querySelector('script, img, iframe, object, use'));
    check(`${label}: no AI service is prefetched`, !Array.from(document.querySelectorAll('link')).some((a) =>
      /preconnect|prefetch|preload/.test(a.getAttribute('rel')) && /chatgpt|claude|perplexity|google\.com|grok/.test(a.getAttribute('href'))));
  }
}
// This module is build-time only and intentionally has no browser inputs or side effects.
check('AI link builder has no browser or network dependencies', !/\b(?:window|document|localStorage|sessionStorage|fetch|XMLHttpRequest|sendBeacon|trackTool)\s*[.(]/.test(read('src/data/agents.mjs')));
console.log(`\nAgent footer: ${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
