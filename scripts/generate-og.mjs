/**
 * generate-og.mjs — Build-time OG image generator
 *
 * Generates one 1200×630 PNG per tool into public/og/[slug].png.
 * Uses sharp (bundled with the project) + SVG template.
 * Run automatically before `astro build` via package.json scripts.
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, 'public', 'og');

const tools = [
  { slug: 'json-formatter',       name: 'JSON Formatter',               description: 'Format and validate JSON instantly' },
  { slug: 'base64',               name: 'Base64 Encoder/Decoder',        description: 'Encode or decode Base64 strings' },
  { slug: 'uuid-generator',       name: 'UUID Generator',                description: 'Generate UUIDs v1, v4, and v7' },
  { slug: 'url-encode',           name: 'URL Encoder/Decoder',           description: 'Encode or decode URL components' },
  { slug: 'text-case',            name: 'Text Case Converter',           description: 'Convert text between cases' },
  { slug: 'markdown-preview',     name: 'Markdown Preview',              description: 'Live preview Markdown rendering' },
  { slug: 'color-converter',      name: 'Color Converter',               description: 'Convert between HEX, RGB, HSL' },
  { slug: 'regex-tester',         name: 'Regex Tester',                  description: 'Test regular expressions with live matching' },
  { slug: 'hash-generator',       name: 'Hash Generator',                description: 'Generate MD5, SHA-1, SHA-256 hashes' },
  { slug: 'timestamp-converter',  name: 'Timestamp Converter',           description: 'Convert Unix timestamps to dates' },
  { slug: 'jwt-decoder',          name: 'JWT Decoder',                   description: 'Decode and inspect JWT tokens' },
  { slug: 'diff-checker',         name: 'Diff Checker',                  description: 'Compare two texts side by side' },
  { slug: 'password-generator',   name: 'Password Generator',            description: 'Generate strong random passwords' },
  { slug: 'qr-code-generator',    name: 'QR Code Generator',             description: 'Generate QR codes from text or URLs' },
  { slug: 'cron-parser',          name: 'Cron Expression Parser',        description: 'Parse and explain cron expressions' },
  { slug: 'lorem-ipsum',          name: 'Lorem Ipsum Generator',         description: 'Generate placeholder text instantly' },
  { slug: 'word-counter',         name: 'Word & Character Counter',      description: 'Count words, characters, sentences' },
  { slug: 'chmod-calculator',     name: 'Chmod Calculator',              description: 'Calculate Linux file permissions' },
  { slug: 'csv-json',             name: 'CSV to JSON Converter',         description: 'Convert between CSV and JSON formats' },
  { slug: 'html-entity',          name: 'HTML Entity Encoder/Decoder',   description: 'Encode and decode HTML entities' },
  { slug: 'yaml-json',            name: 'YAML to JSON Converter',        description: 'Convert between YAML and JSON formats' },
  { slug: 'line-tools',           name: 'Line Tools',                    description: 'Remove duplicates, sort, transform text lines' },
  { slug: 'number-base',          name: 'Number Base Converter',         description: 'Convert between binary, octal, decimal, hex' },
  { slug: 'sql-formatter',        name: 'SQL Formatter',                 description: 'Format, beautify, and minify SQL queries' },
  { slug: 'aspect-ratio',         name: 'Aspect Ratio Calculator',       description: 'Calculate and resize aspect ratios' },
  { slug: 'xml-formatter',        name: 'XML Formatter',                 description: 'Format, beautify, and minify XML documents' },
  { slug: 'ascii-converter',      name: 'ASCII Converter',               description: 'Convert between text and ASCII codes' },
];

/** Escape XML special chars so SVG stays valid. */
function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Wrap long text into multiple <tspan> lines.
 * @param {string} text
 * @param {number} maxCharsPerLine
 * @param {number} x
 * @param {number} yStart
 * @param {number} lineHeight
 */
function wrapText(text, maxCharsPerLine, x, yStart, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines
    .map((line, i) =>
      `<tspan x="${x}" y="${yStart + i * lineHeight}">${esc(line)}</tspan>`
    )
    .join('');
}

function buildSvg(name, description) {
  const W = 1200;
  const H = 630;

  // Brand accent gradient stops
  const gradient = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1" gradientUnits="objectBoundingBox">
        <stop offset="0%" stop-color="#0d1117"/>
        <stop offset="100%" stop-color="#161b22"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0070f3"/>
        <stop offset="100%" stop-color="#00b4ff"/>
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
      font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="28" font-weight="700" fill="#3b9eff" letter-spacing="0.5">ZeroTool</text>
  `;

  // Tool name — large, white
  const titleTspans = wrapText(name, 26, 72, 220, 78);
  const title = `
    <text
      font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="72" font-weight="800" fill="#f0f6fc" letter-spacing="-1">
      ${titleTspans}
    </text>
  `;

  // Description — gray, smaller
  const descTspans = wrapText(description, 52, 72, 370, 42);
  const desc = `
    <text
      font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="32" font-weight="400" fill="#8b949e">
      ${descTspans}
    </text>
  `;

  // Bottom badge: free · browser-based · no sign-up
  const badge = `
    <text x="72" y="${H - 52}"
      font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="22" fill="#484f58" font-weight="400">Free · Browser-based · No Sign-up</text>
  `;

  // Bottom-right domain
  const domain = `
    <text x="${W - 48}" y="${H - 52}" text-anchor="end"
      font-family="ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      font-size="24" fill="#30363d" font-weight="600">zerotool.dev</text>
  `;

  // Decorative circle (top-right)
  const deco = `
    <circle cx="${W - 80}" cy="80" r="180" fill="none" stroke="#0070f3" stroke-width="1.5" opacity="0.12"/>
    <circle cx="${W - 80}" cy="80" r="120" fill="none" stroke="#0070f3" stroke-width="1" opacity="0.08"/>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
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

async function main() {
  await mkdir(outputDir, { recursive: true });

  let generated = 0;
  for (const tool of tools) {
    const svg = buildSvg(tool.name, tool.description);
    const outPath = join(outputDir, `${tool.slug}.png`);

    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, palette: false })
      .toFile(outPath);

    generated++;
    process.stdout.write(`  [${generated}/${tools.length}] ${tool.slug}.png\n`);
  }

  console.log(`\nOG images generated: ${generated} files → public/og/`);
}

main().catch(err => {
  console.error('generate-og failed:', err);
  process.exit(1);
});
