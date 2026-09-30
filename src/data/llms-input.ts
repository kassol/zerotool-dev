// Collects the data src/data/llms.mjs builds the llms files from. Used by the
// llms endpoints in src/pages/.
import { getCollection } from 'astro:content';
import { allTools } from './tools';
import { networkToolSlugs, optionalNetworkToolSlugs } from './network';
import { disabledPersistenceSlugs } from './persistence';
import en from '../i18n/en.json';
import zh from '../i18n/zh.json';
import ja from '../i18n/ja.json';
import ko from '../i18n/ko.json';

export function llmsSiteData() {
  return {
    tools: allTools,
    networkSlugs: networkToolSlugs,
    optionalNetworkSlugs: optionalNetworkToolSlugs,
    sensitiveSlugs: disabledPersistenceSlugs,
    messages: { en, zh, ja, ko } as Record<string, Record<string, string>>,
  };
}

// English tool page content by slug: { seoDescription, body }.
export async function englishToolPages() {
  const entries = await getCollection('tools', (entry) => entry.slug.endsWith('/en'));
  return Object.fromEntries(
    entries.map((entry) => [entry.slug.slice(0, -'/en'.length), { seoDescription: entry.data.seoDescription, body: entry.body }]),
  );
}

export function textResponse(text: string) {
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
