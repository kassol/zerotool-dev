// WebP Converter — generated result cards, download label, encoder fallback
//
// Read:  src/components/tools/WebpConverterTool.astro
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Static checks on the component source:
// - The result cards are built with innerHTML / createElement, so they do not get Astro's scope
//   attribute. Every rule for a class the script creates must be written as
//   `.wc-results :global(.class)` (AGENTS.md rule 11). Before the fix none of them were, so in the
//   built page the thumbnails were full size, the sizes had no color and error cards had no style.
// - "Download All" starts one download per file; the label no longer says ZIP (it never made one).
// - canvas.toBlob falls back to PNG when the browser has no encoder for the requested type
//   (HTML spec; Safari has no WebP encoder). The result is rejected instead of being saved as .webp.
// - Error cards use textContent with the raw file name (before the fix the name was HTML-escaped
//   first, so "a&b.png" showed as "a&amp;b.png").
//
// Run: node scripts/test-webp-converter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/WebpConverterTool.astro'), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); return; }
  failures++;
  console.log('FAIL ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const generated = new Set();
for (const m of script.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('wc-')) generated.add(c);
for (const m of script.matchAll(/className = '([^']+)'/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('wc-')) generated.add(c);
check('script creates wc- classes', generated.size >= 8, [...generated].join(' '));
for (const cls of generated) {
  if (cls === 'wc-status') continue; // set on a template element
  const uses = [...style.matchAll(new RegExp('(\\.wc-results :global\\()?\\.' + cls + '(?![\\w-])', 'g'))];
  if (uses.length === 0) continue;
  const bare = uses.filter((m) => !m[1]);
  check(`.${cls} rules are .wc-results :global(...)`, bare.length === 0, `${bare.length} scoped selector(s)`);
}

check('no "ZIP" in the component', !/ZIP/i.test(src.replace(/no ZIP/g, '')));
check('rejects a blob whose type differs from the requested type', /blob\.type !== outMime/.test(script));
check('error card shows the raw file name', /errEl\.textContent = r\.name/.test(script) && !/errEl\.textContent = esc\(/.test(script));

const sm = script.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/);
check('STRINGS found', !!sm);
if (sm) {
  const S = new Function('return ' + sm[1])();
  const keys = Object.keys(S.en).sort().join(',');
  for (const l of ['zh', 'ja', 'ko']) check(`STRINGS ${l} keys match en`, Object.keys(S[l]).sort().join(',') === keys);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
