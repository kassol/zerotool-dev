# W6 batch 3 — zero-width-character-detector fact-check (2026-10-27)

Scope: 196 language-level statements (58 claim groups): all 6 FAQ answers, 5 steps, both examples in each language, the two tables, the decode examples and rules, the competitor section, all 9 limits bullets, and the component's 5 toggletips plus status strings. Files: `src/content/tools/zero-width-character-detector/{en,zh,ja,ko}.mdx`, visible copy of `src/components/tools/ZeroWidthCharacterDetectorTool.astro`, `src/data/persistence.ts`, `src/data/network.ts`. No engine block, logic, option, test or script changed.

## Counts

| Result | Statements |
|---|---:|
| Supported | 130 |
| Corrected | 54 |
| Qualified (text unchanged) | 8 |
| Unverified | 4 |
| **Total** | **196** |

## Corrections (14 claim groups = 54 language-level statements)

| # | Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|---|
| 1 | Tag block ↔ ASCII | en.mdx:13,37,77 · zh.mdx:13,57,71 · ja.mdx:13,59,75 · ko.mdx:13,62,101 | "U+E0000–U+E007F mirror ASCII" / "与 ASCII 一一对应" → only U+E0020–U+E007E correspond to ASCII; the rest of the block is U+E0000 (reserved), U+E0001 LANGUAGE TAG and U+E007F CANCEL TAG |
| 2 | Decoded tag output | en.mdx:28 · zh.mdx:28 · ja.mdx:28 · ko.mdx:28 | "joined into an English sentence" / "英文句子" / "そのまま英文" / "그대로 영어 문장" → "a line of ASCII text" (the decoder accepts any printable ASCII, not only English) |
| 3 | What tag text can carry | zh.mdx:63 · ja.mdx:65 | "只能藏英文、数字和标点" / "英数字と記号" → ASCII text (letters, digits, punctuation and spaces); CJK instructions cannot be encoded |
| 4 | StegZero and raw digits | en.mdx:28 | "StegZero passphrase frames and custom formats … for those it shows the raw digit string" → passphrase frames get the locked-frame message; only payloads matching no format show the raw digit string (`decodeHidden` sets `raw` only when there are no readings and no encrypted frame) |
| 5 | U+200A and 330k | en.mdx:127 · zh.mdx:122 · ja.mdx:120 · ko.mdx:109 | "330k's page lets you tick U+200A and labels it a zero-width space" → "U+200A is a hair space with width; it is not flagged, and a message that uses it as a digit does not decode". The 330k page's checkbox list is U+200B, U+200C, U+200D, U+200E, U+202A, U+202C, U+202D, U+2062, U+2063 and U+FEFF; it has no U+200A |
| 6 | Preview capacity | en.mdx:125 · zh.mdx:126 · ja.mdx:124 · ko.mdx:113 | "20,000 other characters" → "20,000 other UTF-16 units"; `VIZ_UNITS = 20000` counts UTF-16 units, so astral characters use two |
| 7 | Custom code tables | en.mdx:127 · zh.mdx:123 · ja.mdx:121 · ko.mdx:110 | "custom code tables cannot be read" → custom tables whose symbols-per-character count is not fixed cannot be read. `decRadix` tries any fixed-width base-N alphabet, including 330k's user-selected set, so the absolute was false |
| 8 | Lone-character count | component:65/171/277/383; en.mdx:109 · zh.mdx:107 · ja.mdx:107 · ko.mdx:94 | "{n} lone joiners or BOMs were ignored" / "単独のジョイナーまたは BOM" → "lone joiners, BOMs and other format characters". `ignored` counts every single-character run in `DEC_STEG`, which also contains ZWSP, LRM/RLM, LRE/PDF/LRO, the word joiner and U+2061–U+2064 (all General_Category Cf) |
| 9 | 8-symbol fingerprint | zh.mdx:45 | "任何两种零宽字符排成 8 个都能读出点什么" → "even one readable character may be a coincidence". Eight symbols give one byte; many byte values are printable, so the old claim was false in the other direction |
| 10 | Removing the ZWSP | ja.mdx:45 | "3 行とも改行だけが残り" (only the line breaks remain) → "各行末のゼロ幅スペースだけが消え" (only the trailing ZWSP disappears); the following output block keeps the text |
| 11 | Emoji in the meta description | ja.mdx:3 · ko.mdx:3 | "絵文字は崩れません" / "이모지는 그대로" → "絵文字を残すこともできます" / "이모지를 남길 수도 있습니다". Default Strip: All removes ZWJ and VS16, so the absolute was false; Tag only or Bidi only keeps them |
| 12 | Competitor observations | en.mdx:116,122 · zh.mdx:116 · ja.mdx:114 · ko.mdx:103 | "Most viewers remove everything" → "The viewers we tested remove everything"; "ASCII Smuggler decodes … gives no cleaned copy" → "When we tested it on 2026-09-29 …"; "Invisible Character Viewer marks these spaces" → "flagged these spaces when we tested it on 2026-09-29". All are now labelled as 2026-09-29 observations |
| 13 | Zach Aysan attribution | en.mdx:127 | "the 8-bit marks Zach Aysan described" → "the presence or absence of a single zero-width character that Zach Aysan described". The 2017 article describes presence/absence bits, not 8-bit marks |
| 14 | U+202F wording | en.mdx:13 | "a visible space character" → "a space with width" (U+202F is General_Category Zs; it has width but no visible glyph). zh/ja/ko already said "有宽度 / 幅のある / 폭이 있는" |

## Primary sources (retrieved 2026-10-27)

- Unicode 18.0 `DerivedCoreProperties.txt`, Date 2026-08-07, Default_Ignorable_Code_Point total 4,174: <https://www.unicode.org/Public/18.0.0/ucd/DerivedCoreProperties.txt>
- Unicode 18.0 `emoji-sequences.txt`, Version 18.0, Date 2026-04-30, exactly three `RGI_Emoji_Tag_Sequence` entries (gbeng / gbsct / gbwls, lines 842–844): <https://www.unicode.org/Public/emoji/latest/emoji-sequences.txt>
- Unicode 18.0 `DerivedName.txt`, Date 2026-06-29: U+E0001 LANGUAGE TAG, U+E0020 TAG SPACE, U+E007E TAG TILDE, U+E007F CANCEL TAG: <https://www.unicode.org/Public/18.0.0/ucd/extracted/DerivedName.txt>
- Unicode 18.0 `UnicodeData.txt`: U+00A0, U+200A, U+202F and U+3000 are General_Category Zs; U+2800 is So: <https://www.unicode.org/Public/18.0.0/ucd/UnicodeData.txt>
- 330k Unicode Steganography page and its character picker (`chars` array: U+200B, U+200C, U+200D, U+200E, U+202A, U+202C, U+202D, U+2062, U+2063, U+FEFF; no U+200A): <https://330k.github.io/misc_tools/unicode_steganography.html>
- Rust Security Response WG, CVE-2021-42574, 2021-11-01, and the rustc deny-by-default lint list (`text_direction_codepoint_in_literal`, `text_direction_codepoint_in_comment`): <https://blog.rust-lang.org/2021/11/01/cve-2021-42574/>, <https://doc.rust-lang.org/rustc/lints/listing/deny-by-default.html>
- Johann Rehberger, "ASCII Smuggler Tool", 2024-01-14 ("Tags Unicode Block mirrors ASCII"; filter tags at prompting and response times): <https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/>
- Rumi, "New ChatGPT Models Seem to Leave Watermarks on Text", 2025-04-20, updates 2025-04-22 (OpenAI: "a quirk of large-scale reinforcement learning") and 2025-04-23: <https://www.rumidocs.com/newsroom/new-chatgpt-models-seem-to-leave-watermarks-on-text>
- StegCloak README: `-n, --nocrypt` defaults to false (encryption on), AES-256-CTR, HMAC integrity: <https://github.com/KuroLabs/stegcloak>
- Qiita, "パワポをコピーしてテキスト保存したら疑問形になった話", 2024-08-29 (U+200B before the newline; Shift_JIS save turns it into "?"; Sakura Editor warns): <https://qiita.com/t_o01/items/17b600722a5a219fe27b>
- Unipiz, "공백문자 복사하기 →ㅤ", 2020-10-21: <https://unipiz.tistory.com/8>
- MITRE ATT&CK T1036.002 Right-to-Left Override (modified 2026-05-12; `xcod.scr` displayed as `rcs.docx`): <https://attack.mitre.org/techniques/T1036/002/>
- Zach Aysan, "Zero-Width Characters", 2017-12-30 (single-type presence/absence; survives formatting removal): <https://www.zachaysan.com/writing/2017-12-30-zero-width-characters>

## Implementation checks (file:line)

- Flagged set (Default_Ignorable_Code_Point + Bidi_Control + tag/variation/format ranges): `src/components/tools/ZeroWidthCharacterDetectorTool.astro:649-718`; RGI flag exclusion 726-740 and 748-755; preview limits 773-774, chunking 783-813, paging 1355-1366.
- Strip modes 819-835; mode selection 1348-1352. Decode runs and `ignored` 916-928; `decodeHidden` 1267-1305 (raw only at 1303); tag runs 930-943; variation selectors 945-966; StegCloak decrypt 1017-1045; StegZero 1059-1101; fixed-width base-N 1161-1216.
- Copy/download: 1482-1483 (disabled when empty), 1630-1642 (`text/plain;charset=utf-8`, `cleaned.txt`). UI copy: 7-432; changed `ignored` strings 65/171/277/383.
- Privacy: `src/data/persistence.ts:29` `'zero-width-character-detector': 'disabled'`; `ToolLayout.astro:42` sensitive → `BaseLayout.astro:139` no AdSense and `:184` no GA4; component script has no storage/network/DOM-writing call except the escaped preview (`scripts/test-zero-width-character-detector.mjs:724-735`).
- 4,174 set assertion: test lines 68-80; 100k pagination and full counts: 194-223, 292-311; RGI flags: 575-584.

## Qualified (unchanged)

- "On every change the page tries …" (4): payloads over 200,000 candidate characters stop before decoding and show the "Decode anyway" button (`DEC_MAX_PAYLOAD = 200000`; component 873, 1277, 1585). The FAQ describes the normal path and the component states the exception; no text change.
- "It shows a result only when the whole payload decodes to readable characters" (4): `decReadable` accepts at least 90% printable characters, and tag runs need two consecutive tag characters; short or guessed readings are labelled possible rather than hidden. The sentence is accurate at the user-visible level; no text change.

## Unverified (unchanged)

- Teeqq and LittleOne formats (4): no reference encoder or sample was checked in this pass; the text keeps them in the "cannot be read" list.
- "Invisible Character Viewer flagged these spaces" (en.mdx:122): now explicitly a 2026-09-29 observation; that specific space check was not re-run today.
- "LLMs still read" tag payloads (4) and "OpenAI has not said" (4): no new first-party statement was found; both remain qualified negatives, not contradicted.

## Found but not fixed (out of scope)

- `src/data/tools.ts:151` describes the tool as "Emoji stay intact" (en), "絵文字は崩れません" (ja), "이모지는 그대로" (ko). Default Strip: All removes ZWJ/VS16, so the absolute is false; the MDX meta descriptions were corrected, but `tools.ts` is outside this batch's file set and also feeds the tool cards and OG images.
- Root `AGENTS.md` (2026-10-14 entry) repeats "U+200A … 330k's page lets you tick and labels as a zero-width space"; that historical changelog is not edited here.

## Tests

- Before edits: `node scripts/test-zero-width-character-detector.mjs` 1374 passed, 0 failed; `node scripts/test-tool-content-parity.mjs` 7753 passed, 0 failed; `node scripts/audit.mjs --quiet` 24 PASS, 0 WARN, 0 FAIL.
- After edits: the same three commands give 1374 passed / 0 failed, 7753 passed / 0 failed, 24 PASS / 0 WARN / 0 FAIL. No test assertion needed changing (the tests check structure, fixtures and examples, not this prose).
