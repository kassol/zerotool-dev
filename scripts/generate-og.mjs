/**
 * generate-og.mjs — Build-time OG image generator
 *
 * Read:  src/data/tools.ts, src/content/blog/**
 * Write: public/og/{slug}[-{lang}].png (tools) and public/og/blog-{slug}[-{lang}].png (blog posts),
 *        1200×630 each; EN has no suffix. public/og/ is a build artifact and is not tracked in git.
 * Uses sharp (librsvg) + SVG template. Runs before `astro build` via package.json scripts.
 *
 * zh/ja/ko images need a CJK font (Noto Sans CJK) installed on the build host.
 * When CI is set, the script exits 1 if fontconfig reports no ja/zh/ko font.
 *
 * Importing this module does not generate images; only direct execution runs main().
 */

import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, 'public', 'og');

const W = 1200;
const H = 630;
const MARGIN_X = 72;
export const TEXT_MAX_WIDTH = W - MARGIN_X * 2;

const SYSTEM_FONT_STACK = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const CJK_FONT_BY_LANG = {
  zh: 'Noto Sans CJK SC',
  ja: 'Noto Sans CJK JP',
  ko: 'Noto Sans CJK KR',
};

export function fontFamilyFor(lang) {
  const cjk = CJK_FONT_BY_LANG[lang];
  return cjk ? `'${cjk}', ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK;
}

/**
 * Average advance widths in em, per character class.
 * Measured with sharp/librsvg (ink width of the full class sample at 100px, divided by
 * glyph count) and rounded up to the widest of the three fonts the stack resolves to:
 * macOS SF Pro, Linux DejaVu Sans (what `sans-serif` resolves to on the CI runner, and
 * the widest of the three), and Noto Sans CJK. DejaVu values:
 *   weight 800: upper 0.753, lower 0.633, digit 0.686, space 0.348, punctuation 0.389
 *   weight 400: upper 0.670, lower 0.560, digit 0.624, space 0.317, punctuation 0.336
 * CJK ideographs, kana, Hangul and full-width forms measured 0.99–0.994 em in Noto Sans CJK.
 */
export const CHAR_WIDTH_EM = {
  bold: { upper: 0.76, lower: 0.64, digit: 0.7, space: 0.35, other: 0.4, wide: 1 },
  regular: { upper: 0.68, lower: 0.57, digit: 0.63, space: 0.32, other: 0.34, wide: 1 },
};

const ELLIPSIS = '…';

// Characters that must not start a line (closing brackets, CJK punctuation, prolonged
// sound mark, middle dot, small kana, the second half of "——") and characters that must
// not end a line (opening brackets).
const NO_LINE_START = new Set([
  ...'、。，．：；！？）」』】〉》〕］｝〙〗ー・…‥—ゝゞヽヾ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
  ...',.:;!?)]}%',
]);
const NO_LINE_END = new Set([...'（「『【〈《〔［｛〘〖', ...'([{']);
// Half-width middle dot separates terms in Korean titles ("camelCase·snake_case") without spaces.
const BREAK_AFTER = new Set(['·']);

function isWide(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x1100 && c <= 0x11ff) || // Hangul Jamo
    (c >= 0x2e80 && c <= 0x303f) || // CJK radicals, symbols and punctuation
    (c >= 0x3040 && c <= 0x33ff) || // Hiragana, Katakana, Hangul compat Jamo, CJK compat
    (c >= 0x3400 && c <= 0x4dbf) || // CJK Extension A
    (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
    (c >= 0xac00 && c <= 0xd7af) || // Hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
    (c >= 0xff00 && c <= 0xff60) || // Full-width forms
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x20000 && c <= 0x3fffd) || // CJK Extension B and later
    ch === '—' || ch === '…'
  );
}

// Hangul is written with spaces between words, so it wraps at spaces like Latin text.
function isHangul(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0xac00 && c <= 0xd7af) || (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f);
}

export function charWidth(ch, fontSize, weight = 'regular') {
  const t = CHAR_WIDTH_EM[weight];
  let em;
  if (ch === ' ') em = t.space;
  else if (isWide(ch)) em = t.wide;
  else if (/[A-Z]/.test(ch)) em = t.upper;
  else if (/[a-z]/.test(ch)) em = t.lower;
  else if (/[0-9]/.test(ch)) em = t.digit;
  else if (/\p{L}/u.test(ch)) em = t.lower;
  else em = t.other;
  return em * fontSize;
}

export function textWidth(text, fontSize, weight = 'regular') {
  let w = 0;
  for (const ch of text) w += charWidth(ch, fontSize, weight);
  return w;
}

/**
 * Split text into unbreakable units. A break is allowed at a space, after "·", and next to
 * an ideograph or kana; Latin and Hangul words stay whole. Characters in NO_LINE_START are
 * glued to the unit before them, and characters in NO_LINE_END to the unit after them.
 */
function toUnits(text) {
  const raw = [];
  let word = '';
  for (const ch of text) {
    if (ch === ' ' || (isWide(ch) && !isHangul(ch))) {
      if (word) raw.push(word);
      word = '';
      raw.push(ch);
    } else {
      word += ch;
      if (BREAK_AFTER.has(ch)) {
        raw.push(word);
        word = '';
      }
    }
  }
  if (word) raw.push(word);

  const units = [];
  for (const piece of raw) {
    const prev = units[units.length - 1];
    const glueToPrev =
      prev !== undefined && prev !== ' ' && piece !== ' ' &&
      (NO_LINE_START.has([...piece][0]) || NO_LINE_END.has([...prev].at(-1)));
    if (glueToPrev) units[units.length - 1] = prev + piece;
    else units.push(piece);
  }
  return units;
}

// Drop whole units from the end until the line plus "…" fits; cut characters only when
// the first unit alone is too wide.
function truncateWithEllipsis(line, maxWidth, fontSize, weight) {
  const fits = (s) => textWidth(s.trimEnd() + ELLIPSIS, fontSize, weight) <= maxWidth;
  const units = toUnits(line);
  while (units.length > 1 && !fits(units.join(''))) units.pop();
  let chars = [...units.join('').trimEnd()];
  while (chars.length > 0 && !fits(chars.join(''))) chars.pop();
  while (chars.length > 0 && (chars.at(-1) === ' ' || NO_LINE_END.has(chars.at(-1)))) chars.pop();
  return chars.join('') + ELLIPSIS;
}

/**
 * Wrap text into lines that fit maxWidth, using estimated glyph widths.
 * Returns at most maxLines lines; if the text needs more, the last line ends with "…".
 */
export function wrapLines(text, { fontSize, maxWidth = TEXT_MAX_WIDTH, maxLines = 3, weight = 'regular' }) {
  const lines = [];
  let current = '';
  const push = () => {
    const trimmed = current.trimEnd();
    if (trimmed) lines.push(trimmed);
    current = '';
  };

  for (const unit of toUnits(text.trim())) {
    if (unit === ' ') {
      if (current) current += ' ';
      continue;
    }
    if (textWidth(current + unit, fontSize, weight) <= maxWidth) {
      current += unit;
      continue;
    }
    push();
    if (textWidth(unit, fontSize, weight) <= maxWidth) {
      current = unit;
      continue;
    }
    // A single unit wider than the line: break it at character boundaries.
    for (const ch of unit) {
      if (current && textWidth(current + ch, fontSize, weight) > maxWidth) push();
      current += ch;
    }
  }
  push();

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = truncateWithEllipsis(kept[maxLines - 1], maxWidth, fontSize, weight);
  return kept;
}

export const TOOL_LANGS = ['en', 'zh', 'ja', 'ko'];

/**
 * Tool OG image file name. EN keeps `{slug}.png`; other languages get `{slug}-{lang}.png`,
 * the same suffix rule as blog images. The hyphen also keeps the URL inside the `/*-*`
 * exclude of public/_routes.json. src/layouts/ToolLayout.astro builds the same path.
 */
export function toolOgFileName(slug, lang) {
  return lang === 'en' ? `${slug}.png` : `${slug}-${lang}.png`;
}

// A single- or double-quoted JS string literal with backslash escapes.
const STRING_LITERAL = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;
const JS_ESCAPES = { n: '\n', t: '\t', r: '\r' };

function unquote(literal) {
  return literal.slice(1, -1).replace(/\\(.)/g, (_, ch) => JS_ESCAPES[ch] ?? ch);
}

/**
 * Parse the tool list from the source text of src/data/tools.ts.
 * Each tool occupies a single line in tools.ts. Returns
 * [{ slug, translations: { en: { name, description }, zh, ja, ko } }].
 * Throws when any tool line lacks a `{lang}: { name, description }` block for one of
 * TOOL_LANGS, and names every affected slug.
 */
export function parseToolsSource(source) {
  const tools = [];
  const problems = [];
  for (const line of source.split('\n')) {
    const slugMatch = line.match(/\{\s*slug:\s*'([^']+)'/);
    if (!slugMatch) continue;
    const slug = slugMatch[1];

    const translations = {};
    const missing = [];
    for (const lang of TOOL_LANGS) {
      const re = new RegExp(
        String.raw`\b${lang}:\s*\{\s*name:\s*(${STRING_LITERAL}),\s*description:\s*(${STRING_LITERAL})\s*\}`
      );
      const m = line.match(re);
      if (m) translations[lang] = { name: unquote(m[1]), description: unquote(m[2]) };
      else missing.push(lang);
    }
    if (missing.length > 0) problems.push(`${slug} (${missing.join(', ')})`);
    else tools.push({ slug, translations });
  }
  if (problems.length > 0) {
    throw new Error(
      'cannot parse name/description in src/data/tools.ts for: ' + problems.join('; ') +
      '. Each tool line needs `{lang}: { name: \'...\', description: \'...\' }` for ' + TOOL_LANGS.join('/') + '.'
    );
  }
  return tools;
}

async function parseToolsFromSource() {
  const source = await readFile(join(projectRoot, 'src', 'data', 'tools.ts'), 'utf-8');
  return parseToolsSource(source);
}

/** Escape XML special chars so SVG stays valid. */
function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tool image footer. zh/ja/ko wording follows tool.trustFree and hero.sub in src/i18n/*.json.
export const TOOL_BADGE = {
  en: 'Free · Browser-based · No Sign-up',
  zh: '免费 · 纯浏览器端运行 · 无需注册',
  ja: '無料 · ブラウザ完結 · 登録不要',
  ko: '무료 · 브라우저에서 바로 실행 · 회원가입 불필요',
};

export const TITLE = { fontSize: 72, weight: 'bold', maxLines: 3, firstBaseline: 220, lineHeight: 78 };
export const DESC = { fontSize: 32, weight: 'regular', maxLines: 3, minFirstBaseline: 370, gapAfterTitle: 72, lineHeight: 42 };

/** Line breaks and baselines for the title and description blocks. */
export function layoutText(name, description) {
  const titleLines = wrapLines(name, TITLE);
  const titleYs = titleLines.map((_, i) => TITLE.firstBaseline + i * TITLE.lineHeight);
  const lastTitleY = titleYs.at(-1) ?? TITLE.firstBaseline;
  const descStart = Math.max(DESC.minFirstBaseline, lastTitleY + DESC.gapAfterTitle);
  const descLines = description ? wrapLines(description, DESC) : [];
  const descYs = descLines.map((_, i) => descStart + i * DESC.lineHeight);
  return { titleLines, titleYs, descLines, descYs };
}

function tspans(lines, ys) {
  return lines.map((line, i) => `<tspan x="${MARGIN_X}" y="${ys[i]}">${esc(line)}</tspan>`).join('');
}

export function buildSvg(name, description, type = 'tool', lang = 'en') {
  const isBlog = type === 'blog';
  const fontFamily = fontFamilyFor(lang);
  const langAttr = CJK_FONT_BY_LANG[lang] ? ` xml:lang="${lang}"` : '';
  const { titleLines, titleYs, descLines, descYs } = layoutText(name, description);

  // Brand accent gradient stops
  const gradient = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stop-color="#0d1117"/>
        <stop offset="100%" stop-color="#161b22"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${isBlog ? '#7c3aed' : '#0070f3'}"/>
        <stop offset="100%" stop-color="${isBlog ? '#a855f7' : '#00b4ff'}"/>
      </linearGradient>
    </defs>
  `;

  // Background
  const bg = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;

  // Left accent bar
  const accentBar = `<rect x="0" y="0" width="8" height="${H}" fill="url(#accent)"/>`;

  // Top-left brand badge
  const brand = `
    <text x="72" y="80"
      font-family="${fontFamily}"
      font-size="28" font-weight="700" fill="${isBlog ? '#a855f7' : '#3b9eff'}" letter-spacing="0.5">ZeroTool</text>
  `;

  // Tool/post name — large, white
  const titleTspans = tspans(titleLines, titleYs);
  const title = `
    <text
      font-family="${fontFamily}"
      font-size="72" font-weight="800" fill="#f0f6fc" letter-spacing="-1">
      ${titleTspans}
    </text>
  `;

  // Description — gray, smaller
  const descTspans = tspans(descLines, descYs);
  const desc = `
    <text
      font-family="${fontFamily}"
      font-size="32" font-weight="400" fill="#8b949e">
      ${descTspans}
    </text>
  `;

  // Bottom badge
  const badgeText = isBlog ? 'Blog · ZeroTool' : (TOOL_BADGE[lang] ?? TOOL_BADGE.en);
  const badge = `
    <text x="72" y="${H - 52}"
      font-family="${fontFamily}"
      font-size="22" fill="#484f58" font-weight="400">${badgeText}</text>
  `;

  // Bottom-right domain
  const domain = `
    <text x="${W - 48}" y="${H - 52}" text-anchor="end"
      font-family="${fontFamily}"
      font-size="24" fill="#30363d" font-weight="600">zerotool.dev</text>
  `;

  // Decorative circle (top-right)
  const decoColor = isBlog ? '#7c3aed' : '#0070f3';
  const deco = `
    <circle cx="${W - 80}" cy="80" r="180" fill="none" stroke="${decoColor}" stroke-width="1.5" opacity="0.12"/>
    <circle cx="${W - 80}" cy="80" r="120" fill="none" stroke="${decoColor}" stroke-width="1" opacity="0.08"/>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"${langAttr}>
  ${gradient}
  ${bg}
  ${deco}
  ${accentBar}
  ${brand}
  ${title}
  ${desc}
  ${badge}
  ${domain}
</svg>`;
}

/**
 * On CI, stop the build when fontconfig has no font for a CJK language.
 * Without one, librsvg renders zh/ja/ko titles as missing-glyph boxes.
 */
function assertCjkFontsOnCi() {
  if (!process.env.CI) return;
  for (const lang of ['ja', 'zh', 'ko']) {
    let families = '';
    try {
      families = execFileSync('fc-list', [`:lang=${lang}`, 'family'], { encoding: 'utf-8' }).trim();
    } catch (err) {
      console.error(`generate-og: cannot run fc-list to check CJK fonts (${err.message}).`);
      process.exit(1);
    }
    if (!families) {
      console.error(
        `generate-og: no font for :lang=${lang} is installed. zh/ja/ko OG images would render as boxes.\n` +
        '  Install Noto CJK fonts before the build, for example: sudo apt-get install -y fonts-noto-cjk'
      );
      process.exit(1);
    }
  }
}

async function main() {
  assertCjkFontsOnCi();
  await mkdir(outputDir, { recursive: true });

  const tools = await parseToolsFromSource();
  // Collect every image first, then render them in parallel: each render is
  // mostly single-threaded SVG text layout, so a serial loop leaves cores idle.
  const jobs = [];

  // Tool OG images, one per language
  for (const tool of tools) {
    for (const lang of TOOL_LANGS) {
      const { name, description } = tool.translations[lang];
      jobs.push({ kind: 'tool', fileName: toolOgFileName(tool.slug, lang), svg: buildSvg(name, description, 'tool', lang) });
    }
  }

  // Blog OG images
  const blogContentDir = join(projectRoot, 'src', 'content', 'blog');
  const blogEntries = await readdir(blogContentDir, { withFileTypes: true });

  function addBlogJob(content, ogSlug, lang = 'en') {
    const titleMatch = content.match(/^title:\s*['"](.*?)['"]?\s*$/m)
      || content.match(/^title:\s*(.+?)\s*$/m);
    const descMatch = content.match(/^description:\s*['"](.*?)['"]?\s*$/m)
      || content.match(/^description:\s*(.+?)\s*$/m);
    if (!titleMatch) return;
    const name = titleMatch[1].replace(/^['"]|['"]$/g, '');
    const description = descMatch ? descMatch[1].replace(/^['"]|['"]$/g, '') : '';
    jobs.push({ kind: 'blog', fileName: `blog-${ogSlug}.png`, svg: buildSvg(name, description, 'blog', lang) });
  }

  // Flat layout: src/content/blog/{slug}.mdx
  for (const entry of blogEntries) {
    if (!entry.isFile() || !/\.mdx?$/.test(entry.name)) continue;
    const content = await readFile(join(blogContentDir, entry.name), 'utf-8');
    addBlogJob(content, entry.name.replace(/\.mdx?$/, ''));
  }

  // Directory layout: src/content/blog/{slug}/{lang}.mdx
  // EN gets blog-{slug}.png; other locales get blog-{slug}-{lang}.png to match existing convention.
  for (const entry of blogEntries) {
    if (!entry.isDirectory()) continue;
    const subDir = join(blogContentDir, entry.name);
    const langFiles = (await readdir(subDir)).filter(f => /^(en|zh|ja|ko)\.mdx?$/.test(f));
    for (const langFile of langFiles) {
      const lang = langFile.replace(/\.mdx?$/, '');
      const content = await readFile(join(subDir, langFile), 'utf-8');
      addBlogJob(content, lang === 'en' ? entry.name : `${entry.name}-${lang}`, lang);
    }
  }

  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      await sharp(Buffer.from(job.svg))
        .png({ compressionLevel: 9, palette: false })
        .toFile(join(outputDir, job.fileName));
      process.stdout.write(`  [${job.kind}] ${job.fileName}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), jobs.length) }, worker));
  const generated = jobs.length;

  console.log(`\nOG images generated: ${generated} files → public/og/`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(err => {
    console.error('generate-og failed:', err);
    process.exit(1);
  });
}
