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
// - Guide (src/content/blog/webp-converter-guide/{en,ja}.mdx): the text-chart sizes are re-encoded
//   with sharp and (when cwebp 1.6.0 is installed) cwebp; the Node chunk-reader block is run.
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

// ---------- guide examples (src/content/blog/webp-converter-guide/{en,ja}.mdx) ----------
// {/* webp-check: {"tool":"cwebp"|"sharp", "args":[…] | "options":{…}, "bytes":N} */} annotations
// re-encode public/images/nato-phonetic-alphabet-ja.png (a file in this repository): with sharp
// (devDependency, bundles libwebp 1.6.0) always, with cwebp only when `cwebp -version` is 1.6.0
// (other versions give other sizes; SKIP). The byte count, written with thousands separators, must
// appear in the page within 2500 characters after the annotation. The Node block preceded by
// {/* webp-run: {"expect":"…"} */} is run; stdout must equal "expect" and its "// …" comments.
// Photo and screenshot rows in the guides need inputs that are not in the repository and a browser,
// so they are not recomputed here.
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const sharp = (await import('sharp')).default;
  const chart = join(root, 'public/images/nato-phonetic-alphabet-ja.png');
  let cwebp = null;
  try { cwebp = execFileSync('cwebp', ['-version']).toString().trim().split('\n')[0]; } catch { cwebp = null; }
  const tmp = mkdtempSync(join(tmpdir(), 'webp-guide-'));
  const fmt = (n) => n.toLocaleString('en-US');
  const cache = new Map();
  async function encode(spec) {
    const key = JSON.stringify([spec.tool, spec.args, spec.options]);
    if (cache.has(key)) return cache.get(key);
    let bytes;
    if (spec.tool === 'sharp') bytes = (await sharp(chart).webp(spec.options).toBuffer()).length;
    else {
      const out = join(tmp, cache.size + '.webp');
      execFileSync('cwebp', ['-quiet', ...spec.args, chart, '-o', out]);
      bytes = readFileSync(out).length;
    }
    cache.set(key, bytes);
    return bytes;
  }
  try {
    for (const lang of ['en', 'ja']) {
      const rel = 'src/content/blog/webp-converter-guide/' + lang + '.mdx';
      const path = join(root, rel);
      if (!existsSync(path)) { check(rel + ' exists', false); continue; }
      const text = readFileSync(path, 'utf8');
      let count = 0;
      for (const m of text.matchAll(/\{\/\* webp-check: (\{.*?\}) \*\/\}/g)) {
        count++;
        const spec = JSON.parse(m[1]);
        const label = rel + ' ' + spec.tool + ' ' + JSON.stringify(spec.args || spec.options);
        check(label + ' quotes ' + fmt(spec.bytes), text.slice(m.index, m.index + 2500).includes(fmt(spec.bytes)));
        if (spec.tool === 'cwebp' && cwebp !== '1.6.0') { console.log('SKIP ' + label + ' (cwebp ' + (cwebp || 'missing') + ')'); continue; }
        const got = await encode(spec);
        check(label + ' = ' + spec.bytes + ' bytes', got === spec.bytes, got);
      }
      check(rel + ' has webp-check annotations', count >= 5, count);
      const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion|まとめ)/mi].filter((re) => re.test(text));
      check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
      check(rel + ' cites Google 26% and 25–34%', /26\s?%/.test(text) && /25[–〜~]34\s?%/.test(text));
    }
    const en = readFileSync(join(root, 'src/content/blog/webp-converter-guide/en.mdx'), 'utf8');
    let runs = 0;
    for (const m of en.matchAll(/\{\/\* webp-run: (\{.*?\}) \*\/\}\s*```js\n([\s\S]*?)```/g)) {
      runs++;
      const spec = JSON.parse(m[1]);
      writeFileSync(join(tmp, 'kind.mjs'), m[2]);
      const out = execFileSync(process.execPath, [join(tmp, 'kind.mjs')]).toString().trim();
      check('en.mdx webp-run output', out === spec.expect, out);
      const shown = [...m[2].matchAll(/^\/\/ (.+)$/gm)].map((x) => x[1]).filter((l) => !l.startsWith('webp-kind.mjs')).join('\n');
      check('en.mdx webp-run output comments', shown === out, shown);
    }
    check('en.mdx has a runnable code block', runs === 1, runs);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
