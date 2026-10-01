// Slugify — symbol and letter mappings are applied
//
// Read:  src/components/tools/SlugifyTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: letters outside the table fall back to their base letter (NFD, then combining marks
// removed; Łódź → lodz) and letters without a decomposition map by the sindresorhus/transliterate
// table (ł → l, đ → d, œ → oe, ı → i). Also every entry of the mapping table on the tool page. Before the fix the lookup ran only
// on non-ASCII characters (/[^\u0000-\u007E]/), so the ASCII symbols & @ # % + were never
// mapped and became separators (Rock & Roll → rock-roll). Symbols map to a separate word,
// as sindresorhus/slugify does for & → " and " (Tom&Jerry → tom-and-jerry); letters map in
// place (Crème → creme). Expected values are literals written from the page's table.
// Also: lowercase / trim options, the three separators, removed CJK input.
//
// Run: node scripts/test-slugify.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SlugifyTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SlugifyTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { slugify };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const DEF = { separator: '-', lowercase: true, trim: true };
const s = (text, opts) => E.slugify(text, Object.assign({}, DEF, opts || {}));
const t = (input, expected, opts) => eq(JSON.stringify(input) + (opts ? ' ' + JSON.stringify(opts) : ''), s(input, opts), expected);

// ---------- the reported defect: ASCII symbol mappings ----------
t('Rock & Roll', 'rock-and-roll');
t('Tom&Jerry', 'tom-and-jerry');
t('me@example', 'me-at-example');
t('C# Guide', 'c-hash-guide');
t('100% Pure', '100-percent-pure');
t('C++', 'c-plus-plus');

// ---------- non-ASCII symbol mappings ----------
t('© 2024 Acme', 'c-2024-acme');
t('Brand®', 'brand-r');
t('Name™', 'name-tm');
t('5€', '5-euro');
t('£10', 'pound-10');
t('¥500', 'yen-500');
t('30°C', '30-deg-c');
t('3×4', '3-x-4');
t('8÷2', '8-div-2');

// ---------- letter mappings (lowercase) ----------
t('àáâãäå', 'aaaaaa');
t('æ', 'ae');
t('ç', 'c');
t('èéêë', 'eeee');
t('ìíîï', 'iiii');
t('ð', 'd');
t('ñ', 'n');
t('òóôõöø', 'oooooo');
t('ùúûü', 'uuuu');
t('ý', 'y');
t('þ', 'th');
t('ß', 'ss');
// uppercase letters, with Lowercase off
const keep = { lowercase: false };
t('ÀÁÂÃÄÅ', 'AAAAAA', keep);
t('Æ', 'AE', keep);
t('Ç', 'C', keep);
t('ÈÉÊË', 'EEEE', keep);
t('ÌÍÎÏ', 'IIII', keep);
t('Ð', 'D', keep);
t('Ñ', 'N', keep);
t('ÒÓÔÕÖØ', 'OOOOOO', keep);
t('ÙÚÛÜ', 'UUUU', keep);
t('Ý', 'Y', keep);
t('Þ', 'TH', keep);
t('Crème Brûlée', 'creme-brulee');
t('Straße', 'strasse');

// ---------- options ----------
t('Rock & Roll', 'Rock-and-Roll', keep);
t('Rock & Roll', 'rock_and_roll', { separator: '_' });
t('Rock & Roll', 'rock.and.roll', { separator: '.' });
t('Hello World!', 'hello-world-', { trim: false });
t('  Hello   World  ', 'hello-world');
t('snake_case and-kebab.dot', 'snake-case-and-kebab-dot');
t('Hello World!', 'hello-world');

// ---------- removed characters ----------
// letters outside the table: NFD + remove Mn falls back to the base letter (was removed: Łódź → od)
t('Łódź', 'lodz');
t('ŁÓDŹ', 'LODZ', { lowercase: false });
t('Škoda', 'skoda');
t('Tiếng Việt', 'tieng-viet');
t('İstanbul', 'istanbul');
t('Ångström', 'angstrom');
t('cafe\u0301 noir', 'cafe-noir');
// letters without a decomposition, from sindresorhus/transliterate
t('Đặng', 'dang');
// page limitation: no language-specific rules
t('ä ö ü', 'a-o-u');
t('İ', 'I', keep);
t('œuvre', 'oeuvre');
t('Œ', 'OE', keep);
t('ẞ', 'Ss', keep);
t('ı', 'i');
t('Ħal', 'hal');
t('ĳssel', 'ijssel');
t('Ĳ', 'IJ', keep);
t('ə', 'a');
t('Ł', 'L', keep);
t('ł', 'l');
t('đ', 'd');
t('Đ', 'D', keep);
t("John's Guide", 'john-s-guide');
t('你好', '');
t('日本語 Guide', 'guide');

// en tool page: Examples and comparison tables
t('10 Tips & Tricks for Node.js (2026 Edition)!', '10-tips-and-tricks-for-node-js-2026-edition');
t('Crème Brûlée: A 30-Minute Recipe', 'creme-brulee-a-30-minute-recipe');
t('Straße in Łódź', 'strasse-in-lodz');
t('C++ vs C# — Which One?', 'c-plus-plus-vs-c-hash-which-one');
t('東京 Travel Guide 2026', 'travel-guide-2026');
t('user_profile.v2', 'user-profile-v2');
t('fooBar 123 $#%', 'foobar-123-hash-percent');
t('я люблю единорогов', '');
t('I ♥ Dogs', 'i-dogs');
t('Fußgängerübergänge', 'fussgangerubergange');
t('Conway\u2019s Law', 'conways-law');
t("Conway's Law", 'conway-s-law');
{
  const got = E.slugify('10 Tips & Tricks for Node.js (2026 Edition)!', { separator: '_', lowercase: false, trim: true });
  check('page example, underscore + case kept', got === '10_Tips_and_Tricks_for_Node_js_2026_Edition', got);
  const dot = E.slugify('..', { separator: '.', lowercase: true, trim: false });
  check('page FAQ: punctuation-only input with Trim off and dot separator gives "."', dot === '.', dot);
}

// ---------- guide examples (src/content/blog/slugify-guide/{en,ja}.mdx) ----------
// Annotation {/* sl-check: {"input":"…","slug":"…"} */}: the tool's output with default options
// must equal "slug"; a non-empty slug must appear in the page text after the annotation (within
// 4000 characters). Code blocks preceded by {/* sl-run: {"lang":"node","expect":"…"} */} are run;
// stdout must equal "expect" and the "// …" output comments in the block.
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  for (const lang of ['en', 'ja']) {
    const rel = 'src/content/blog/slugify-guide/' + lang + '.mdx';
    const path = join(root, rel);
    if (!existsSync(path)) { check(rel + ' exists', false); continue; }
    const text = readFileSync(path, 'utf8');
    let count = 0;
    for (const m of text.matchAll(/\{\/\* sl-check: (\{.*?\}) \*\/\}/g)) {
      count++;
      let spec;
      try { spec = JSON.parse(m[1]); } catch (e) { check(rel + ' annotation is JSON', false, m[1]); continue; }
      eq(rel + ' ' + JSON.stringify(spec.input), s(spec.input), spec.slug);
      if (spec.slug) check(rel + ' quotes ' + spec.slug + ' after the annotation', text.slice(m.index, m.index + 4000).includes('`' + spec.slug + '`'), spec.slug);
    }
    check(rel + ' has sl-check annotations', count >= (lang === 'en' ? 7 : 9), count);
    let runs = 0;
    for (const m of text.matchAll(/\{\/\* sl-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g)) {
      runs++;
      const spec = JSON.parse(m[1]);
      const dir = mkdtempSync(join(tmpdir(), 'slugify-run-'));
      try {
        writeFileSync(join(dir, 'main.mjs'), m[2]);
        const out = execFileSync(process.execPath, [join(dir, 'main.mjs')]).toString().trim();
        eq(rel + ' code block ' + runs, out, spec.expect);
        const shown = [...m[2].matchAll(/^\/\/ (.+)$/gm)].map((x) => x[1]).join('\n');
        eq(rel + ' code block ' + runs + ' output comments', shown, out);
      } catch (e) {
        check(rel + ' code block ' + runs, false, String(e.stderr || e.message).slice(0, 300));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    check(rel + ' has a runnable code block', runs >= 1, runs);
    const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion|まとめ)/mi].filter((re) => re.test(text));
    check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
