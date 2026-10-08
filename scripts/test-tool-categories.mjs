// Tests for the 11 tool categories (plan approved 2026-10-08).
//
// Read: src/data/tools.ts (transpiled with the project's TypeScript), src/components/CategoryFilter.astro,
// src/data/llms.mjs, src/i18n/*.json, src/layouts/BaseLayout.astro, src/components/ToolDirectory.astro,
// src/layouts/ToolLayout.astro, src/components/tools/*.astro, DESIGN.md, and dist/ (optional, after a build).
// Run:  node scripts/test-tool-categories.mjs
//
// Before 2026-10-08 there were 8 categories and "dev" held 60 of 141 tools. The table below is the
// single list of which tool belongs to which category; change it together with tools.ts.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CATEGORY_ORDER } from '../src/data/llms.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
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

// Order = filter chip order = llms.txt section order.
const TABLE = [
  ['data', ['JSON & Data', 'JSON 与数据', 'JSON・データ', 'JSON·데이터'], 'json-formatter, json-diff, jsonpath-tester, jq-playground, json-schema-validator, json-to-json-schema, jsonl-converter, yaml-json, yaml-validator, yaml-toml, toml-json, json-xml-converter, xml-formatter, csv-json, json-to-csv, csv-to-sql, sqlite-viewer, protobuf-to-json'],
  ['code', ['Code & Types', '代码与类型', 'コード・型', '코드·타입'], 'json-to-typescript, json-to-zod, typescript-to-zod, json-to-kotlin, json-to-java-pojo, json-to-go-struct, json-to-python-dataclass, json-to-mongoose, openapi-to-typescript, html-to-jsx, svg-to-jsx, curl-to-code, sql-formatter, graphql-formatter, html-minifier, regex-tester, keycode-explorer'],
  ['text', ['Text & Markdown', '文本与 Markdown', 'テキスト・Markdown', '텍스트·Markdown'], 'text-case, word-counter, line-tools, diff-checker, lorem-ipsum, slugify, unicode-text-converter, text-to-ascii-art, string-escape, zero-width-character-detector, ai-token-counter, markdown-preview, markdown-linter, markdown-to-word, markdown-table-generator, markdown-toc-generator, html-to-markdown, csv-to-markdown'],
  ['encoding', ['Encoding', '编码', 'エンコード', '인코딩'], 'base64, url-encode, html-entity, ascii-converter, text-to-binary, morse-code-translator, nato-phonetic-alphabet, number-base, image-to-base64'],
  ['security', ['Crypto & Auth', '加密与认证', '暗号・認証', '암호·인증'], 'hash-generator, file-hash-checker, hmac-generator, password-generator, bcrypt-generator, htpasswd-generator, aes-encrypt-decrypt, rsa-key-generator, ssl-certificate-decoder, csr-decoder, secret-redactor, totp-generator, pkce-generator, jwt-decoder, jwt-generator, basic-auth-header-generator'],
  ['web', ['Web & HTTP', '网络与 HTTP', 'Web・HTTP', '웹·HTTP'], 'http-status-codes, http-header-analyzer, cookie-parser, har-file-analyzer, url-parser, dns-lookup, ip-subnet-calculator, mime-type-lookup, openapi-validator, csp-header-generator, meta-tag-generator, robots-txt-generator, htaccess-generator'],
  ['css', ['CSS', 'CSS', 'CSS', 'CSS'], 'css-to-tailwind, css-unit-converter, css-specificity-calculator, css-variables-generator, css-grid-generator, css-flexbox-generator, css-gradient-generator, css-filter-generator, css-clip-path-generator, css-triangle-generator, css-clamp-calculator, box-shadow-generator, glassmorphism-generator, cubic-bezier-generator'],
  ['color', ['Color', '颜色', 'カラー', '색상'], 'color-converter, color-palette-generator, color-shades-generator, color-contrast-checker, color-blindness-simulator, eyedropper-color-picker, image-color-palette'],
  ['image', ['Image', '图片', '画像', '이미지'], 'svg-to-png-converter, svg-optimizer, webp-converter, image-compressor, exif-metadata-viewer, favicon-generator, pixelate-image, gif-splitter, gif-compressor, sprite-sheet-generator, image-splitter, aspect-ratio'],
  ['ids', ['IDs & QR', 'ID 与二维码', 'ID・QRコード', 'ID·QR코드'], 'uuid-generator, ulid-generator, nano-id-generator, fake-data-generator, qr-code-generator, qr-code-decoder, wifi-qr-code-generator, barcode-generator, iban-validator-parser'],
  ['devops', ['DevOps & Time', '运维与时间', '運用・日時', '운영·시간'], 'timestamp-converter, timezone-converter, cron-parser, cron-job-generator, chmod-calculator, docker-to-compose, gitignore-generator, env-file-parser'],
];
const COUNTS = { data: 18, code: 17, text: 18, encoding: 9, security: 16, web: 13, css: 14, color: 7, image: 12, ids: 9, devops: 8 };
const KEYS = TABLE.map(([k]) => k);
const LANGS = ['en', 'zh', 'ja', 'ko'];

// ---------- table itself ----------
const tableSlugs = TABLE.flatMap(([, , s]) => s.split(', '));
eq('table: 11 categories', KEYS.length, 11);
eq('table: 141 slugs', tableSlugs.length, 141);
eq('table: no slug listed twice', new Set(tableSlugs).size, tableSlugs.length);
for (const [k, , s] of TABLE) eq(`table: ${k} count`, s.split(', ').length, COUNTS[k]);

// ---------- tools.ts ----------
const toolsSrc = read('src/data/tools.ts');
const js = ts.transpileModule(toolsSrc, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { allTools } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
eq('tools.ts: 141 tools', allTools.length, 141);
eq('tools.ts: same slug set as the table', allTools.map((t) => t.slug).sort(), [...tableSlugs].sort());
for (const [k, , s] of TABLE) {
  eq(`tools.ts: ${k} holds exactly the table's tools`, allTools.filter((t) => t.category === k).map((t) => t.slug).sort(), s.split(', ').sort());
}
const union = /category:\s*([^;\n]+);/.exec(toolsSrc)[1].split('|').map((s) => s.trim().replace(/'/g, ''));
eq('tools.ts: type union lists the 11 keys in table order', union, KEYS);

// ---------- filter chips, llms ----------
const filterSrc = read('src/components/CategoryFilter.astro');
const chips = /const categories\s*=\s*\[([^\]]+)\]/.exec(filterSrc)[1].split(',').map((s) => s.trim().replace(/['"]/g, ''));
eq('CategoryFilter: All, then the table order', chips, ['all', ...KEYS]);
eq('llms CATEGORY_ORDER: table order', CATEGORY_ORDER, KEYS);

// ---------- i18n ----------
for (const [i, lang] of LANGS.entries()) {
  const msgs = JSON.parse(read(`src/i18n/${lang}.json`));
  for (const [k, labels] of TABLE) eq(`${lang}: category.${k}`, msgs[`category.${k}`], labels[i]);
  const extra = Object.keys(msgs).filter((key) => key.startsWith('category.')).map((key) => key.slice(9))
    .filter((k) => !KEYS.includes(k) && !['all', 'recent', 'filterLabel'].includes(k));
  eq(`${lang}: no unused category.* keys`, extra, []);
}

// ---------- color tokens ----------
const base = read('src/layouts/BaseLayout.astro');
const rootBlock = /:root \{([\s\S]*?)\n  \}/.exec(base)[1];
const darkMedia = /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n    \}/.exec(base)[1];
const darkAttr = /\n  \[data-theme="dark"\] \{([\s\S]*?)\n  \}/.exec(base)[1];
const tokensIn = (block) => Object.fromEntries([...block.matchAll(/--color-cat-([a-z]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
const light = tokensIn(rootBlock);
const dark1 = tokensIn(darkMedia);
const dark2 = tokensIn(darkAttr);
eq('BaseLayout: light tokens are the 11 keys', Object.keys(light), KEYS);
eq('BaseLayout: dark (system) tokens are the 11 keys', Object.keys(dark1), KEYS);
eq('BaseLayout: dark (toggle) tokens match dark (system)', dark2, dark1);
check('BaseLayout: code / web keep the old dev / api light values', light.code === 'oklch(48% 0.075 255)' && light.web === 'oklch(52% 0.09 300)', JSON.stringify(light));
const design = read('DESIGN.md');
for (const k of KEYS) {
  check(`DESIGN.md: ${k} row matches BaseLayout`, design.includes(`| \`--color-cat-${k}\` | \`${light[k]}\` | \`${dark1[k]}\` |`));
}

// OKLCH → OKLab distance and WCAG contrast (sRGB, clipped).
const parseOklch = (s) => { const m = /oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)/.exec(s); return [m[1] / 100, +m[2], +m[3]]; };
const toLab = ([l, c, h]) => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
const de = (a, b) => Math.hypot(...toLab(a).map((v, i) => v - toLab(b)[i]));
const lum = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const [r, g, bl] = rgb.map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
};
const contrast = (x, y) => { const [a, b] = [lum(toLab(x)), lum(toLab(y))].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
for (const [theme, set, bg, minC] of [['light', light, [0.994, 0.006, 78], 4.4], ['dark', dark1, [0.15, 0.012, 65], 7]]) {
  let min = Infinity;
  let pair = '';
  for (let i = 0; i < KEYS.length; i++) for (let j = i + 1; j < KEYS.length; j++) {
    const d = de(parseOklch(set[KEYS[i]]), parseOklch(set[KEYS[j]]));
    if (d < min) { min = d; pair = KEYS[i] + '/' + KEYS[j]; }
  }
  check(`${theme}: every pair of category colors differs by ΔEOK ≥ 0.05`, min >= 0.05, `${min.toFixed(3)} ${pair}`);
  for (const k of KEYS) {
    const c = contrast(parseOklch(set[k]), bg);
    check(`${theme}: ${k} icon contrast ≥ ${minC}:1`, c >= minC, c.toFixed(2));
  }
}

// ---------- selectors and borrowed tokens ----------
const dir = read('src/components/ToolDirectory.astro');
const layout = read('src/layouts/ToolLayout.astro');
for (const k of KEYS) {
  check(`ToolDirectory: card + panel selector for ${k}`, dir.includes(`.tool-card[data-category="${k}"],\n  .panel-tool[data-category="${k}"] { --category-color: var(--color-cat-${k}); }`));
  check(`ToolLayout: related-card selector for ${k}`, layout.includes(`.related-card[data-category="${k}"] { --category-color: var(--color-cat-${k}); }`));
}
const used = new Set();
for (const f of ['src/components/ToolDirectory.astro', 'src/layouts/ToolLayout.astro', ...readdirSync(join(root, 'src/components/tools')).filter((n) => n.endsWith('.astro')).map((n) => 'src/components/tools/' + n)]) {
  for (const m of read(f).matchAll(/var\(--color-cat-([a-z]+)\)/g)) {
    used.add(m[1]);
    check(`${f}: --color-cat-${m[1]} is defined`, KEYS.includes(m[1]));
  }
}
check('tool components borrow category tokens', used.size >= KEYS.length);
check('BarcodeGenerator uses its own category color', /\.bcode-wrap \{ --category-color: var\(--color-cat-ids\)/.test(read('src/components/tools/BarcodeGeneratorTool.astro')));
check('CssClampCalculator uses its own category color', /--category-color: var\(--color-cat-css\)/.test(read('src/components/tools/CssClampCalculatorTool.astro')));

// ---------- dist (optional) ----------
const distTools = join(root, 'dist/tools/index.html');
if (existsSync(distTools)) {
  for (const [i, lang] of LANGS.entries()) {
    const html = readFileSync(join(root, lang === 'en' ? 'dist/tools/index.html' : `dist/${lang}/tools/index.html`), 'utf8');
    const chipLabels = [...html.matchAll(/<button[^>]*class="chip[^"]*"[^>]*data-cat="([a-z]+)"[^>]*>\s*([^<]+?)\s*</g)].map((m) => [m[1], m[2]]);
    eq(`dist ${lang}: filter chips in order with localized labels`, chipLabels.filter(([c]) => c !== 'recent'), [['all', JSON.parse(read(`src/i18n/${lang}.json`))['category.all']], ...TABLE.map(([k, labels]) => [k, labels[i].replace(/&/g, '&amp;')])]);
    // Attribute values may contain ">", so read each card's attributes as quoted strings.
    const cards = html.split('class="tool-card"').slice(1).map((chunk) => {
      const attrs = Object.fromEntries([...chunk.matchAll(/\s([a-z-]+)="([^"]*)"/g)].slice(0, 8).map((m) => [m[1], m[2]]));
      return [attrs['data-category'], attrs['data-slug']];
    });
    eq(`dist ${lang}: 141 cards`, cards.length, 141);
    for (const [k, , s] of TABLE) {
      eq(`dist ${lang}: ${k} cards`, cards.filter(([c]) => c === k).map(([, slug]) => slug).sort(), s.split(', ').sort());
    }
  }
} else {
  console.log('SKIP: dist/ not built; run npm run build for the dist checks');
}

console.log(`Tool categories: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
