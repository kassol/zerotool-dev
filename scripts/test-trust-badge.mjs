#!/usr/bin/env node
// Trust bar wording on tool pages (src/layouts/ToolLayout.astro, i18n key tool.trustClient).
// The badge states a concrete fact ("Runs in your browser") with no "100%" or other absolute
// wording. Network tools (src/data/network.ts networkToolSlugs) do not show it; tools that use
// the network only after an option is turned on (optionalNetworkToolSlugs) keep it, and in place
// of tool.trustPrivacy ("data never leaves your browser") show trustOptional.{slug}, which names
// the condition (2026-10-08: markdown-to-word downloads web images when Embed web images is on).
// Reads src/i18n/*.json, and the built tool pages in dist/ (run `npm run build` first).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'zh', 'ja', 'ko'];
let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) passed++;
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const ABSOLUTE = [/100\s*%/, /\bentirely\b/i, /\bonly\b/i, /完全/, /纯/, /完結/, /100퍼센트/];
const EXPECTED = {
  en: 'Runs in your browser',
  zh: '在浏览器中处理',
  ja: 'ブラウザ内で処理',
  ko: '브라우저에서 처리',
};

const badge = {};
const dicts = {};
for (const lang of LANGS) {
  const dict = JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${lang}.json`), 'utf8'));
  dicts[lang] = dict;
  badge[lang] = dict['tool.trustClient'];
  const optional = dict['trustOptional.markdown-to-word'];
  check(`${lang}: trustOptional.markdown-to-word is set`, typeof optional === 'string' && optional.length > 0);
  check(`${lang}: tool.trustClient is set`, typeof badge[lang] === 'string' && badge[lang].length > 0);
  const hit = ABSOLUTE.find((re) => re.test(badge[lang] ?? ''));
  check(`${lang}: tool.trustClient has no absolute wording`, !hit, `"${badge[lang]}" matches ${hit}`);
  check(`${lang}: tool.trustClient wording`, badge[lang] === EXPECTED[lang], `got "${badge[lang]}"`);
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function trustItems(html) {
  const m = html.match(/<ul class="tool-head-trust"[^>]*>([\s\S]*?)<\/ul>/);
  if (!m) return null;
  return [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => decode(x[1].replace(/<[^>]+>/g, '').trim()));
}

const dist = join(ROOT, 'dist');
if (!existsSync(join(dist, 'tools/base64/index.html'))) {
  console.log('SKIP dist checks: dist/ not built');
} else {
  const cases = [
    ['base64', 'plain'],
    ['svg-to-png-converter', 'plain'],
    ['markdown-to-word', 'optional'],
    ['dns-lookup', 'network'],
    ['meta-tag-generator', 'network'],
  ];
  for (const lang of LANGS) {
    for (const [slug, kind] of cases) {
      const file = join(dist, lang === 'en' ? '' : lang, 'tools', slug, 'index.html');
      const items = trustItems(readFileSync(file, 'utf8'));
      check(`${lang}/${slug}: trust bar found`, Array.isArray(items));
      if (!items) continue;
      const text = items.join(' | ');
      check(`${lang}/${slug}: no "100%" in trust bar`, !/100\s*%/.test(text), text);
      if (kind === 'network') check(`${lang}/${slug}: network tool hides the badge`, !items.includes(badge[lang]), text);
      else check(`${lang}/${slug}: badge shown`, items[0] === badge[lang], text);
      const privacy = dicts[lang]['tool.trustPrivacy'];
      if (kind === 'optional') {
        check(`${lang}/${slug}: optional-network tool does not claim data never leaves`, !items.includes(privacy), text);
        check(`${lang}/${slug}: optional-network tool states the condition`, items[1] === dicts[lang][`trustOptional.${slug}`], text);
      } else if (kind === 'plain') {
        check(`${lang}/${slug}: plain tool shows the privacy item`, items[1] === privacy, text);
      }
    }
  }
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
