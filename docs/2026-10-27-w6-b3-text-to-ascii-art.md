# W6 batch 3 — text-to-ascii-art fact-check (2026-10-27)

Scope: 102 statement entries covering every FAQ answer, every body claim with a number, limit, privacy, network, storage, analytics, compatibility, competitor or precision assertion, and the visible component copy with the same claims. Long paragraphs that assert one claim count as one entry; the four-language component strings are grouped by message. Files: `src/content/tools/text-to-ascii-art/{en,zh,ja,ko}.mdx`, `src/components/tools/TextToAsciiArtTool.astro`, `src/data/persistence.ts`, `src/data/network.ts`. No engine block, logic, option, test or script changed.

## Corrections (31 statements)

The nine rows below are 31 statement entries: four languages per row, except the table headings (3, no en change) and the en-only summary (1); the Limits row groups the Latin, blocks and PNG sentences for each language.

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| FAQ privacy font requests | en.mdx:26 · zh.mdx:26 · ja.mdx:26 · ko.mdx:26 | "the tool only downloads the font file you select" → the tool requests the current font (Standard on first load) and all 12 when Preview all 12 fonts is opened (component 618, 708-723) |
| Standard glyph parity | en.mdx:76 · zh.mdx:85 · ja.mdx:104 · ko.mdx:88 | "Banner … and Standard are glyph-for-glyph the same" → the eight fonts are identical; Standard is identical apart from an added ಠ glyph (glyph comparison: 1 site-only code point U+0CA0) |
| `-S` description | en.mdx:87 · zh.mdx:96 · ja.mdx:97 · ko.mdx:99 | "overlaps by one column using the font's rules, even in fonts whose default is fitted" → forces smushing; uses the font's rules where it has them; a fitted font has none and falls back to the same overlapping as `-o` (figlet.c `-S` is SMO_FORCE; Banner/Block/Lean/Script/Mini/Shadow give `-S` == `-o`) |
| Limits: Latin / blocks / PNG | en.mdx:132,134,135 · zh.mdx:136,138,139 · ja.mdx:132,134,135 · ko.mdx:128,130,131 | "Latin script only" → mostly Latin, with Banner katakana + Cyrillic and Big Greek; "One block per line" → each input line is stacked, and a line longer than the width becomes several blocks; "16,384 per side … the canvas limit of iOS Safari" → the area 16,777,216 is iOS Safari's long-standing 4,096 × 4,096 canvas limit, while 16,384 per side is the tool's own bound and a wider PNG may still fail on a phone |
| Width-table headings | zh.mdx:99 · ja.mdx:106 · ko.mdx:102 | "width of each font / per font / by font" → "(partial)" / "（抜粋）" / "(일부)", because the tables list 8, 7 and 7 of the 12 fonts |
| Skipped-message quotes | ja.mdx:45 · zh.mdx:65 · ko.mdx:68 | The quoted messages followed the old template "the {font} font has no glyph for"; the component now says "Skipped in the {font} font" |
| Summary sentence | en.mdx:125 | "lists skipped characters by name" → "lists the characters it skipped": the tool shows the characters (or U+XXXX for invisible ones), not Unicode names |
| Component skipped message + input tip | component 43/76/109/142, 18/51/84/117 | "the {font} font has no glyph for" → "Skipped in the {font} font" / "已跳过（{font} 字体）" / "スキップしました（{font} フォント）" / "건너뜀({font} 글꼴)"; "Characters missing from the font" → "Characters the renderer skips". 3D-ASCII has blank glyphs for 14 punctuation marks and figlet drops control characters, so the old wording was false for those |
| Component PNG error | component 37/70/103/136 | "The image would be larger than a browser canvas allows" → "The PNG could not be created…"; the same string is used when `toBlob` returns null, not only for oversized images |

## Qualified (14 statements)

- FAQ figlet-match (4): the TAAG / figlet.js one-column observation is dated 2026-10-01 in the body but was present tense in the FAQ; the FAQ now gives the check date. The rest (2.2.5 port, site font files, command) is supported.
- figlet.js 1.11 history (4): it is the version the previous page used; current figlet.js is 1.12.0 and was not re-run.
- Shadow (4): "2007 revision" has no first-party source. The site's Shadow is glyph-identical to patorjk/figlet.js's `Shadow.flf` (line endings differ only) and differs from figlet 2.2.5's `shadow.flf` only in the space glyph (4 vs 3 columns). The text now states those checked facts.
- Width-40 examples (2): en `figlet -f small -w 40` and ko `figlet -f standard -w 40` are engine-recomputed; the 840 fixtures cover widths 8/20/30/45/80, not 40.

## Primary sources (all retrieved 2026-10-27)

- figlet 2.2.5 `figlet.c`, `figlet.6`, `fonts/*.flf` (including `utf8.flc`) and tags: <https://raw.githubusercontent.com/cmatsuoka/figlet/2.2.5/figlet.c>, <https://raw.githubusercontent.com/cmatsuoka/figlet/2.2.5/figlet.6>, <https://github.com/cmatsuoka/figlet/tree/2.2.5/fonts>, <https://api.github.com/repos/cmatsuoka/figlet/tags>. Checked: `-S` sets `SM_SMUSH` with `SMO_FORCE` (OR the font's `smush2`), `-o` sets `SM_SMUSH` with `SMO_YES`, `-k` is `SM_KERN`, `-W` is 0; tab becomes a space, `\r \v \f` become line breaks, other C0 controls and DEL are dropped; `DEFAULTCOLUMNS` 80 and `outlinelenlimit = outputwidth - 1`; the fonts directory has no Doom or 3D-ASCII; 2.2.5 is the newest tag.
- patorjk/figlet.js `fonts/Shadow.flf`, README (TAAG) and changelog: <https://github.com/patorjk/figlet.js>. `Shadow.flf` was added 2013-12-23; the README says the library was written to power TAAG; current version 1.12.0 (2026-09-27).
- MDN canvas maximum size (iOS 4,096 × 4,096; page last modified 2026-04-24): <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas#maximum_canvas_size>
- CommonMark 0.31.2 §6.7 hard line breaks (two or more spaces): <https://spec.commonmark.org/0.31.2/#hard-line-breaks>
- POSIX.1-2024 §2.7.4 here-document (quoted word → lines are not expanded): <https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html#tag_19_07_04>
- EditorConfig `trim_trailing_whitespace`: <https://spec.editorconfig.org/>
- pycodestyle W291 trailing whitespace: <https://pycodestyle.pycqa.org/en/latest/intro.html#error-codes>
- `motd(5)` (printed by `login(1)` after a successful login): <https://man7.org/linux/man-pages/man5/motd.5.html>
- Spring Boot banner (`banner.txt`, `spring.banner.location`, `spring.banner.charset`, `${spring-boot.formatted-version}`): <https://docs.spring.io/spring-boot/reference/features/spring-application.html#features.spring-application.banner>
- Michael Kaplan, "When is a backslash not a backslash?" (2005): <http://archives.miloush.net/michkap/archive/2005/09/17/469941.html>
- Microsoft Win32, "Security Considerations: International Features" (Japanese code page uses ¥ for backslash): <https://learn.microsoft.com/en-us/windows/win32/intl/security-considerations--international-features>
- WHATWG Encoding Standard, Shift_JIS / EUC-KR decoders (an ASCII byte maps to the same code point): <https://encoding.spec.whatwg.org/#shift_jis-decoder>

## Implementation checks (file:line)

- 12 fonts: `FONT_NAMES` at `TextToAsciiArtTool.astro:7`, select at 159; the menu equals the files in `public/figlet-fonts/` (test).
- Input limit: `MAX_INPUT = 2000` at 223; `render()` counts code points and shows `tooLong` at 688-689.
- Font requests: `fetch('/figlet-fonts/' + name + '.flf')` at 618; `renderGallery` loads all 12 at 708-723.
- Renderer: `smushModeFor` 292-298, `inputCodes` 302-312, `renderFiglet` 315-481.
- Skipped characters: `unsupportedChars` 487-498, `skippedMessage` 501-507 (invisible characters as U+XXXX).
- Copy formats: `formatOutput` 516-540 (Markdown fence longer than any backtick run, `#` / `//` comments, quoted heredoc delimiter); copy fallback 779-806.
- Command: `figletCommand` 552-574 (`-C utf8` for non-ASCII, `--` for leading `-`, `-w` omitted at 80, site `.flf` for Doom/3D-ASCII/Shadow and Standard with ಠ).
- PNG: `imageLayout` 584-590 (16,384 per side, 16,777,216 area, 2× when it fits); drawing and download 823-854.
- Analytics: `trackTool('text_to_ascii_art', …)` at 754-766; one `generate` per committed change, `copy` on a successful copy, `download` on a saved TXT or PNG, none on load or while typing.
- Storage/network: the component has no `localStorage`, `sessionStorage`, `ztPersist`, XHR or beacon call; its only network call is the font fetch. `src/data/persistence.ts:10-60` has no `text-to-ascii-art` entry, so the default policy is `input`, but the component never calls `ztPersist`, so nothing is saved.
- Network classification: `src/data/network.ts:5-10` and 22-24 do not list `text-to-ascii-art`; the same-origin font fetch is an asset, not an off-page feature request, so the trust bar stays `tool.trustPrivacy` and the privacy answer is accurate.

## Unverified (unchanged)

- Competitor comparisons (en.mdx:121-124, zh.mdx:125-129, ja.mdx:122-125, ko.mdx:118-121) are 2026-10-01 observations; not re-run.
- figlet.js 1.11 vs 8 of 12 fonts (en.mdx:74, zh.mdx:83, ja.mdx:102, ko.mdx:86) is historical; figlet.js is now 1.12.0 and was not re-run.
- The width-40 examples for Standard and Small are not in the 840 fixtures; see Qualified.
- The Japanese LAZE SOFTWARE recommendation (ja.mdx:47) was not re-checked.
- Apple publishes no canvas limit; the 4,096 × 4,096 figure is MDN's. iOS 18 may raise the limit, and Firefox/Safari desktop limits were not checked.
- The `pngTooLarge` string is also used when `toBlob` returns null; the new wording covers both cases, but the encoder-failure path was not exercised in a browser in this pass.

## Tests

- `node scripts/test-text-to-ascii-art.mjs` before edits: 2542 passed, 0 failed, 0 skipped, exit 0.
- After edits: 2542 passed, 0 failed, 0 skipped, exit 0 (no test file changed; the only text assertions are the `{font}` / `{chars}` placeholders and `STRINGS.en.pngTooLarge`, which is read from the component).
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed, exit 0.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL, exit 0.
