# W6 batch 3 — unicode-text-converter fact-check (2026-10-27)

Scope: 136 statements — all 24 FAQ answers, 16 steps, 8 SEO fields, 68 body / limits / table / competitor statements across the four MDX files, and 20 visible component-copy statements. Files: `src/content/tools/unicode-text-converter/{en,zh,ja,ko}.mdx`, visible copy of `src/components/tools/UnicodeTextConverterTool.astro`. No engine block, persistence/network data, analytics, test or script changed.

## Corrections (36 statements, 11 claim groups)

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| CJK scope | en.mdx:15 · zh.mdx:15 · ja.mdx:15 · ko.mdx:15 | "Unicode only encodes Latin letters and digits for these styles" → "this tool's styles cover Latin letters and digits". Unicode's Mathematical Alphanumeric Symbols also encode Greek (U+1D6A8–U+1D7CB), which the tool does not use; the old sentence was false. The status line lists up to 8 distinct characters (`component:526`). |
| Other-script note | component:25/60/93/126 | "No styled forms exist for {chars}" → "This tool has no styled form for {chars}". Unicode has mathematical Greek (U+1D6A8–U+1D7CB); the tool does not implement it, so the absolute wording was false for Greek text. |
| Missing letters | en.mdx:18 · zh.mdx:18 · ja.mdx:18 · ko.mdx:18 | "No subscript b, c, d, f, g or q in fonts most people have" → "Unicode has none at all". They are not encoded in Unicode 18.0; this is not a font gap. Also: Small Caps changes lowercase only, capitals stay as typed and are **not** listed, and the card lists only the first 12 (`component:511`). |
| Math styles without digits | en.mdx:64 | "Italic, script and Fraktur have no digits" → the eight math styles that lack digits (italic, bold italic, script, bold script, Fraktur, bold Fraktur, sans-serif italic, sans-serif bold italic). |
| Enclosed-letter emoji | en.mdx:65 | "🅰 🅱 🅾 🅿 … the blood-type buttons … show red icons" → 🅰 🅱 🅾 are the blood-type buttons, 🅿 is the P button, and emoji presentation is coloured (P is blue). |
| Small Caps capitals | en.mdx:66,104 · zh.mdx:79 · ja.mdx:83 · ko.mdx:86 | The row and the limits now say capitals stay as typed; `TABLES.smallCaps[UPPER] = UPPER` (component:282) and the missing note skips them. |
| Superscript / subscript versions | en.mdx:66 · zh.mdx:81 · ja.mdx:85 · ko.mdx:88 | "Unicode 14.0 and 18.0 added some of them" → 14.0 (C, F, Q, q via U+A7F2–A7F4 and U+107A5), 17.0 (S via U+A7F1) and 18.0 (subscript w, y, z via U+209D–U+209F). The old text omitted 17.0. |
| NFKC exclusions | en.mdx:89 | "small capitals or negative squared" → "small capitals, negative circled or negative squared". U+1F150 has no decomposition mapping, like U+1F170; both need the reverse table. |
| Reverse-table styles | en.mdx:90 | "plus a table for the styles NFKC leaves alone" → the three styles named: small capitals, negative circled, negative squared. |
| Status count | component:24/59/92/125 | "{n} styled characters were turned back into plain letters" → "{n} changes were made to turn the input back into plain text". `toPlain` counts fullwidth characters and removed U+0332/U+0333/U+0335–U+0338 marks, so the count is changes, not only fancy letters. |
| Missing-note and Plain-text trigger | component:31-32, 64-65, 97-98, 130-131 | The card tip now says Small Caps capitals are not listed; the Plain text tip now says the card appears whenever the plain conversion changes the input (fancy letters, fullwidth letters, marks), while ¹ ² ³ and circled digits on their own stay as typed and do not show it (`keepInSource`). |

`en.mdx:66` appears in both the small-caps and version rows; the 36 statements are counted once each. The matching JSON has the per-statement before/after text.

## Qualifications applied (4 statements edited; 10 more qualified unchanged)

- `en.mdx:72`: "Bold is the one serif style with no gaps" was ambiguous (bold italic and bold Fraktur have no letter holes, only missing digits). Changed to "whose letters and digits are all in one run".
- `zh.mdx:41`, `ja.mdx:42`, `ko.mdx:43`: "most / 多く / 많은 generators return fullwidth text unchanged" softened to "some / 一部 / 일부", because the dated 2026-10-01 pass covered one competitor per language.

The other 10 qualified entries are unchanged: the four seoDescriptions (accents are kept in 13 styles, left as typed in 10), the four "font rendering depends" limits, `en.mdx:95` "most generators skip accented letters", and `en.mdx:58` "after each character" (the next sentence and the code use grapheme clusters; `Intl.Segmenter` is required for the guarantee).

## Primary sources (retrieved 2026-10-27)

- UnicodeData 18.0 (header dated 2026-06-29): <https://www.unicode.org/Public/18.0.0/ucd/UnicodeData.txt>
- DerivedAge 18.0 (2026-06-29): <https://www.unicode.org/Public/18.0.0/ucd/DerivedAge.txt>
- emoji-data 18.0, names for U+1F170/1F171/1F17E/1F17F: <https://www.unicode.org/Public/18.0.0/ucd/emoji/emoji-data.txt>
- UTR #25 §2.1, quoted sentence: <https://www.unicode.org/reports/tr25/>
- NVDA 2026.1 changelog, 2024.3 and 2025.1 sections: <https://download.nvaccess.org/releases/2026.1/documentation/changes.html>
- MySQL 8.4 Reference Manual 12.9.2 ("Supports BMP characters only"): <https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb3.html>
- Mathematical Alphanumeric Symbols chart: <https://www.unicode.org/charts/PDF/U1D400.pdf>
- MDN `String.prototype.normalize` (NFKC examples): <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize>
- UAX #29 (grapheme clusters): <https://www.unicode.org/reports/tr29/>
- Python 3.12.2 local codec run, 2026-10-27: GBK/GB18030, Shift_JIS/CP932, ISO-2022-JP, EUC-KR/CP949. All table values on the zh/ja/ko pages reproduced exactly.

## Implementation checks (file:line)

- 23 styles: `UnicodeTextConverterTool.astro:193-199`; the count test asserts 23.
- Math offsets and Letterlike exceptions: 206-225; 24 exceptions (italic 1, script 11, Fraktur 5, double-struck 7).
- Small Caps capitals: 282 (`TABLES.smallCaps[UPPER[u]] = UPPER[u]`); `convert('ABC','smallCaps')` returns `ABC` with `missing: []`.
- Display caps: `r.missing.slice(0, 12)` at 511 (card note) and `info.others.slice(0, 8)` at 526 (status line); both append `…` when longer.
- Fullwidth: 284-287 (U+FF01–U+FF5E + space → U+3000); `analyze('ＡＢＣ').source === 'ABC'`.
- Reverse table: 291-297 (every style), then NFKC ranges at 359-370; `toPlain` at 383-403.
- Graphemes: 299-310 (`Intl.Segmenter`, fallback `Array.from`); marks skipped on `LINE_BREAK`.
- Accent-preserving styles: 320-323 (`KEEPS_MARKS`, 13 styles); `convert('é', id)` returns `é` with `missing: ['é']` for the eight other styles.
- Strip marks: 357 (`U+0332 U+0333 U+0335 U+0336 U+0337 U+0338`).
- Copy and analytics: 485-498; `trackTool('unicode_text_converter', 'copy_' + id)` fires only after a successful copy, and carries no text.
- Privacy: component has no `localStorage` / `ztPersist` / `fetch` / XHR; `persistence.ts` has no entry for the slug and the component never calls `ztPersist`, so nothing is saved. `ToolLayout.astro:42` marks only `disabled` slugs sensitive; this slug loads GA4 (`BaseLayout.astro:185`) and AdSense (`BaseLayout.astro:140`).
- Encoding tables: Python 3.12.2 `str.encode` on 2026-10-27; every byte on the three pages matched, including `①` CP932 87 40 and `Ｂ` ISO-2022-JP 1B 24 42 23 42 1B 28 42.

## Unverified (unchanged)

- Competitor comparisons (`en.mdx:95`, `zh.mdx:71`, `ja.mdx:74`, `ko.mdx:76`) are dated 2026-10-01 observations and were not re-run.
- The "whether a style shows up depends on the fonts" limit (`en.mdx:107` and translations) is a general rendering statement with no single first-party source; marked qualified, not changed.
- The grapheme-cluster guarantee depends on `Intl.Segmenter`; without it the code falls back to code points and ZWJ / skin-tone sequences can split. Marked qualified; the page does not state the fallback.
- The "common fonts do not have them yet" clause was removed because font coverage has no source in this pass; the page now states only what the tool does.

## Tests

- `node scripts/test-unicode-text-converter.mjs` after edits: 215 passed, 0 failed, exit 0.
- `node scripts/test-tool-content-parity.mjs` after edits: 7753 passed, 0 failed, exit 0.
- `node scripts/audit.mjs --quiet` after edits: 24 PASS, 0 WARN, 0 FAIL, exit 0.
- No `npm run build` (per task).

## Files changed

- `src/content/tools/unicode-text-converter/en.mdx`
- `src/content/tools/unicode-text-converter/zh.mdx`
- `src/content/tools/unicode-text-converter/ja.mdx`
- `src/content/tools/unicode-text-converter/ko.mdx`
- `src/components/tools/UnicodeTextConverterTool.astro` (STRINGS visible copy only)
- `docs/2026-10-27-w6-b3-unicode-text-converter.md`
- `docs/2026-10-27-w6-b3-unicode-text-converter.json`
