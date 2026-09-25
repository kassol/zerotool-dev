// OG image generator — line wrapping and SVG regression test
//
// Read:  scripts/generate-og.mjs (imported; importing it does not generate images), src/data/tools.ts
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: English words stay whole, CJK text wraps by estimated width, mixed CJK/Latin text,
// line-start / line-end prohibition rules, the 3-line limit with "…", XML escaping,
// empty description, per-language font stack and xml:lang, and the vertical layout bounds
// (description never overlaps the title or the bottom badge). Also covers tools.ts parsing
// for all 4 languages (escaped quotes, missing zh/ja/ko throws), tool OG file names, no slug
// ending in -zh/-ja/-ko, and the localized tool badge.
//
// Run: node scripts/test-generate-og.mjs

import {
  wrapLines,
  textWidth,
  layoutText,
  buildSvg,
  fontFamilyFor,
  parseToolsSource,
  toolOgFileName,
  TOOL_LANGS,
  TOOL_BADGE,
  TEXT_MAX_WIDTH,
  TITLE,
  DESC,
} from './generate-og.mjs';
import { readFileSync } from 'node:fs';

// ---------- harness ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail));
}
function equal(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}
function deepEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
function allFit(name, lines, opts) {
  for (const line of lines) {
    const w = textWidth(line, opts.fontSize, opts.weight);
    check(`${name}: "${line}" fits`, w <= (opts.maxWidth ?? TEXT_MAX_WIDTH), `width ${w.toFixed(1)}`);
  }
}

const NO_START = [...'、。，．：；！？）」』】〉》ー・'];
const NO_END = [...'（「『【〈《'];
function checkKinsoku(name, lines) {
  lines.forEach((line, i) => {
    if (i > 0) check(`${name}: line ${i} start`, !NO_START.includes([...line][0]), JSON.stringify(line));
    if (i < lines.length - 1) check(`${name}: line ${i} end`, !NO_END.includes([...line].at(-1)), JSON.stringify(line));
  });
}

const title = { ...TITLE, maxLines: 99 };
const desc = { ...DESC, maxLines: 99 };

// ---------- English: words are never split ----------
{
  const text = 'JSON to Python Dataclass Generator: Convert API Responses into Typed Code';
  const lines = wrapLines(text, title);
  check('en: more than one line', lines.length > 1, JSON.stringify(lines));
  equal('en: rejoin equals input', lines.join(' '), text);
  const words = new Set(text.split(' '));
  for (const line of lines) {
    for (const w of line.split(' ')) check(`en: "${w}" is a whole word`, words.has(w));
  }
  allFit('en title', lines, title);
  deepEqual('en: short text is one line', wrapLines('Hash Generator', title), ['Hash Generator']);
  deepEqual('en: surrounding spaces trimmed', wrapLines('  Hash   Generator  ', title), ['Hash   Generator']);
}

// ---------- English: a word wider than the line is cut at characters ----------
{
  const long = 'x'.repeat(60);
  const lines = wrapLines(long, title);
  check('en: oversized word split', lines.length > 1, JSON.stringify(lines));
  equal('en: oversized word keeps all chars', lines.join(''), long);
  allFit('en oversized', lines, title);
}

// ---------- CJK: wraps by width ----------
{
  const text = '图片转换在线指南涵盖格式介绍国内平台现状浏览器兼容性降级方案自动优化及命令行用法';
  const lines = wrapLines(text, title);
  check('zh: wraps into several lines', lines.length >= 3, JSON.stringify(lines));
  allFit('zh title', lines, title);
  equal('zh: no characters lost', lines.join(''), text);
  // A 72px bold title holds 14 full-width characters: 14 × 72 = 1008 ≤ 1056 < 15 × 72.
  equal('zh: first line holds 14 ideographs', [...lines[0]].length, 14);

  const ja = 'GIF アニメをコマ単位で PNG・JPG に分割保存し、フレーム時間付き JSON とスプライトシートを作る方法を解説。';
  const jaLines = wrapLines(ja, desc);
  allFit('ja desc', jaLines, desc);
  check('ja desc: wraps', jaLines.length >= 2, JSON.stringify(jaLines));
}

// ---------- Mixed CJK / Latin ----------
{
  const text = 'JSON 转 Python Dataclass：一键生成 dataclass、Pydantic 或 TypedDict 定义';
  const lines = wrapLines(text, title);
  allFit('mixed', lines, title);
  const latin = ['JSON', 'Python', 'Dataclass', 'dataclass', 'Pydantic', 'TypedDict'];
  for (const w of latin) {
    check(`mixed: "${w}" not split`, lines.some(l => l.includes(w)), JSON.stringify(lines));
  }
  equal('mixed: no characters lost (spaces aside)', lines.join('').replace(/ /g, ''), text.replace(/ /g, ''));

  const ko = '텍스트 케이스 변환 가이드: camelCase·snake_case·PascalCase·kebab-case 완벽 정리';
  const koLines = wrapLines(ko, title);
  allFit('ko', koLines, title);
  check('ko: "PascalCase" not split', koLines.some(l => l.includes('PascalCase')), JSON.stringify(koLines));
  for (const w of ko.split(' ').filter(w => /[가-힣]/.test(w) && !w.includes('·'))) {
    check(`ko: Hangul word "${w}" not split`, koLines.some(l => l.split(' ').includes(w)), JSON.stringify(koLines));
  }
}

// ---------- Line-start / line-end prohibition ----------
{
  // Place each prohibited closing mark exactly where a naive width break would put it at a line start.
  for (const mark of NO_START) {
    const text = '一'.repeat(14) + mark + '二'.repeat(10);
    const lines = wrapLines(text, title);
    checkKinsoku(`no-start "${mark}"`, lines);
    allFit(`no-start "${mark}"`, lines, title);
    equal(`no-start "${mark}": no characters lost`, lines.join(''), text);
  }
  // Place each opening bracket exactly at the end of a full line.
  for (const mark of NO_END) {
    const text = '一'.repeat(13) + mark + '二'.repeat(10);
    const lines = wrapLines(text, title);
    checkKinsoku(`no-end "${mark}"`, lines);
    equal(`no-end "${mark}": no characters lost`, lines.join(''), text);
  }
  const dash = '一'.repeat(13) + '——' + '二'.repeat(10);
  const dashLines = wrapLines(dash, title);
  check('"——" stays on one line', dashLines.some(l => l.includes('——')), JSON.stringify(dashLines));
}

// ---------- 3-line limit with ellipsis ----------
{
  const en = 'Why Every Developer Needs a Toolbox: Building Efficient Workflows with Browser Tools That Never Upload Your Data';
  const lines = wrapLines(en, TITLE);
  equal('limit en: 3 lines', lines.length, 3);
  check('limit en: ends with …', lines[2].endsWith('…'), lines[2]);
  check('limit en: cut at a word boundary', en.includes(lines[2].slice(0, -1) + ' '), lines[2]);
  allFit('limit en', lines, TITLE);

  const zh = '在'.repeat(100);
  const zhLines = wrapLines(zh, DESC);
  equal('limit zh: 3 lines', zhLines.length, 3);
  check('limit zh: ends with …', zhLines[2].endsWith('…'), zhLines[2]);
  allFit('limit zh', zhLines, DESC);

  const exact = wrapLines('一'.repeat(14 * 3), TITLE);
  equal('limit: exactly 3 full lines get no …', exact.some(l => l.includes('…')), false);
}

// ---------- Layout: description follows the title and stays above the badge ----------
{
  const BADGE_BASELINE = 630 - 52;
  const DESC_DESCENT = 0.3 * DESC.fontSize;
  const BADGE_CAP = 0.8 * 22;
  const longTitle = 'Title '.repeat(40);
  const longDesc = 'Description '.repeat(60);
  for (const [name, t, d] of [
    ['1-line title', 'Hash', longDesc],
    ['3-line title', longTitle, longDesc],
  ]) {
    const L = layoutText(t, d);
    const gap = L.descYs[0] - L.titleYs.at(-1);
    check(`layout ${name}: desc below title`, gap >= DESC.gapAfterTitle, `gap ${gap}`);
    check(`layout ${name}: desc above badge`, L.descYs.at(-1) + DESC_DESCENT < BADGE_BASELINE - BADGE_CAP, `last ${L.descYs.at(-1)}`);
  }
  deepEqual('layout: 1-line title keeps desc at 370', layoutText('Hash', 'Short').descYs, [370]);
}

// ---------- Empty description ----------
{
  const L = layoutText('Hash Generator', '');
  deepEqual('empty desc: no lines', L.descLines, []);
  const svg = buildSvg('Hash Generator', '', 'blog', 'en');
  const descText = svg.match(/fill="#8b949e">([\s\S]*?)<\/text>/);
  check('empty desc: no tspan in description', descText && !descText[1].includes('<tspan'), descText && descText[1]);
}

// ---------- XML escaping ----------
{
  const svg = buildSvg('A & B <C> "D"', 'x < y && y > z', 'tool');
  check('escape: & escaped', svg.includes('A &amp; B'), svg);
  check('escape: < > escaped', svg.includes('&lt;C&gt;') && svg.includes('x &lt; y &amp;&amp; y &gt; z'));
  check('escape: quotes escaped', svg.includes('&quot;D&quot;'));
  check('escape: no raw <C>', !svg.includes('<C>'));
}

// ---------- Font stack and xml:lang ----------
{
  const system = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  equal('font en', fontFamilyFor('en'), system);
  equal('font zh', fontFamilyFor('zh'), `'Noto Sans CJK SC', ${system}`);
  equal('font ja', fontFamilyFor('ja'), `'Noto Sans CJK JP', ${system}`);
  equal('font ko', fontFamilyFor('ko'), `'Noto Sans CJK KR', ${system}`);

  const tool = buildSvg('Hash', 'd', 'tool');
  check('tool svg: no xml:lang', !tool.includes('xml:lang'));
  check('tool svg: system stack only', !tool.includes('Noto'));
  const enBlog = buildSvg('Hash', 'd', 'blog', 'en');
  check('en blog svg: no xml:lang', !enBlog.includes('xml:lang'));
  for (const [lang, font] of [['zh', 'SC'], ['ja', 'JP'], ['ko', 'KR']]) {
    const svg = buildSvg('标题', '描述', 'blog', lang);
    check(`${lang} blog svg: xml:lang`, svg.includes(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" xml:lang="${lang}">`));
    check(`${lang} blog svg: Noto first`, svg.includes(`font-family="'Noto Sans CJK ${font}', ui-sans-serif`));
  }
}

// ---------- tools.ts parsing: 4 languages, escaped quotes ----------
{
  const line = String.raw`  { slug: 'eye-drop', translations: { en: { name: 'Eye Drop', description: 'Uses the browser\'s API — "native".' }, zh: { name: '吸色器', description: '使用浏览器的 \'EyeDropper\' API。' }, ja: { name: "スポイト", description: "ブラウザの \"API\" を使用。" }, ko: { name: '스포이트', description: 'C:\\path 브라우저.' } }, category: 'color', relatedSlugs: ['color-converter'] },`;
  const source = ['export const allTools: ToolInfo[] = [', line, '];'].join('\n');
  const tools = parseToolsSource(source);
  equal('parse: one tool', tools.length, 1);
  equal('parse: slug', tools[0].slug, 'eye-drop');
  deepEqual('parse: en', tools[0].translations.en, { name: 'Eye Drop', description: 'Uses the browser\'s API — "native".' });
  deepEqual('parse: zh', tools[0].translations.zh, { name: '吸色器', description: '使用浏览器的 \'EyeDropper\' API。' });
  deepEqual('parse: ja (double quotes)', tools[0].translations.ja, { name: 'スポイト', description: 'ブラウザの "API" を使用。' });
  deepEqual('parse: ko (escaped backslash)', tools[0].translations.ko, { name: '스포이트', description: 'C:\\path 브라우저.' });
}

// ---------- tools.ts parsing: missing zh/ja/ko throws and names the slug ----------
{
  const full = (slug) => `  { slug: '${slug}', translations: { en: { name: 'A', description: 'a' }, zh: { name: 'B', description: 'b' }, ja: { name: 'C', description: 'c' }, ko: { name: 'D', description: 'd' } }, category: 'dev' },`;
  for (const lang of ['zh', 'ja', 'ko']) {
    const broken = full(`no-${lang}`).replace(new RegExp(`${lang}: \\{ name: '.', description: '.' \\},? ?`), '');
    let err = null;
    try { parseToolsSource([full('ok-tool'), broken].join('\n')); } catch (e) { err = e; }
    check(`parse missing ${lang}: throws`, err !== null, broken);
    check(`parse missing ${lang}: names slug and language`, err && err.message.includes(`no-${lang} (${lang})`), err && err.message);
    check(`parse missing ${lang}: healthy slug not named`, err && !err.message.includes('ok-tool'), err && err.message);
  }
  let err = null;
  try { parseToolsSource(full('bad-desc').replace("description: 'a'", 'description: a')); } catch (e) { err = e; }
  check('parse unquoted en: throws', err && err.message.includes('bad-desc (en)'), err && err.message);
}

// ---------- tools.ts parsing: the real registry ----------
{
  const source = readFileSync(new URL('../src/data/tools.ts', import.meta.url), 'utf-8');
  const tools = parseToolsSource(source);
  const slugLines = source.split('\n').filter(l => /\{\s*slug:\s*'/.test(l)).length;
  equal('real tools.ts: every slug line parsed', tools.length, slugLines);
  check('real tools.ts: non-empty', tools.length > 0);
  for (const tool of tools) {
    for (const lang of TOOL_LANGS) {
      const t = tool.translations[lang];
      check(`real ${tool.slug} ${lang}: name and description`, t.name.length > 0 && t.description.length > 0);
      check(`real ${tool.slug} ${lang}: no stray backslash`, !/\\/.test(t.name + t.description), t.description);
    }
    // `{slug}-{lang}.png` must not collide with another tool's `{slug}.png`.
    check(`real ${tool.slug}: no -zh/-ja/-ko suffix`, !/-(zh|ja|ko)$/.test(tool.slug));
  }
  const eyedropper = tools.find(t => t.slug === 'eyedropper-color-picker');
  check('real eyedropper: escaped quote kept', eyedropper && eyedropper.translations.en.description.includes("browser's native EyeDropper API"));

  const names = new Set();
  for (const tool of tools) for (const lang of TOOL_LANGS) names.add(toolOgFileName(tool.slug, lang));
  equal('real tools.ts: OG file names are unique', names.size, tools.length * TOOL_LANGS.length);
}

// ---------- Tool OG file names ----------
{
  equal('file name en', toolOgFileName('json-formatter', 'en'), 'json-formatter.png');
  equal('file name zh', toolOgFileName('json-formatter', 'zh'), 'json-formatter-zh.png');
  equal('file name ja', toolOgFileName('base64', 'ja'), 'base64-ja.png');
  equal('file name ko', toolOgFileName('base64', 'ko'), 'base64-ko.png');
}

// ---------- Tool badge and language per tool image ----------
{
  const en = buildSvg('Hash', 'd', 'tool', 'en');
  check('tool en badge', en.includes('>Free · Browser-based · No Sign-up</text>'));
  for (const [lang, font] of [['zh', 'SC'], ['ja', 'JP'], ['ko', 'KR']]) {
    const svg = buildSvg('哈希', '描述', 'tool', lang);
    check(`tool ${lang} badge`, svg.includes(`>${TOOL_BADGE[lang]}</text>`), TOOL_BADGE[lang]);
    check(`tool ${lang}: no English badge`, !svg.includes('No Sign-up'));
    check(`tool ${lang}: xml:lang`, svg.includes(`xml:lang="${lang}"`));
    check(`tool ${lang}: Noto first`, svg.includes(`font-family="'Noto Sans CJK ${font}', ui-sans-serif`));
    check(`tool ${lang} badge fits`, textWidth(TOOL_BADGE[lang], 22) < 1200 - 72 - 48 - textWidth('zerotool.dev', 24) - 40);
  }
  check('blog badge unchanged for zh', buildSvg('标题', '描述', 'blog', 'zh').includes('>Blog · ZeroTool</text>'));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
