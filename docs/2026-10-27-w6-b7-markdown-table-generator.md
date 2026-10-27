# W6 batch 7 — markdown-table-generator fact check (2026-10-27)

Scope: `markdown-table-generator` en / zh / ja / ko tool pages and the visible strings of `MarkdownTableGeneratorTool.astro`. Read-only evidence: `engine:start/end`, `src/data/persistence.ts`, `src/data/network.ts`, the GFM fixtures and `scripts/test-markdown-table-generator.mjs`. FAQ count, ids, order, `steps`, `seoTitle`, the engine block, persistence / network policy, analytics and scripts were not changed.

## Counts

91 statements: 32 supported, 26 corrected, 20 qualified, 13 unverified.

| Language | Statements | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 23 | 10 | 7 | 4 | 2 |
| zh | 23 | 8 | 7 | 5 | 3 |
| ja | 23 | 7 | 6 | 5 | 5 |
| ko | 22 | 7 | 6 | 6 | 3 |

## Corrections

| # | Claim | file:line (en / zh / ja / ko) | Before → after | Evidence |
|---|---|---|---|---|
| 1 | Usage-event dedup | en:23 · zh:23 · ja:23 · ko:23 | "unchanged import results are not counted again" → "the same format and output are not counted again". The key is format + output, so changing the output format sends another event. | `resultKey` / `track()` in the component script. |
| 2 | CJK bold mechanism | en:110 · zh:110 · ja:110 · ko:110 | "`**` next to full-width punctuation does not open emphasis" → the opener can open, but a closing `**` after punctuation is not right-flanking and cannot close; examples `**注意**：ここ` and a space after the closing `**`. | CommonMark §6.2 delimiter runs; commonmark.js 0.31.2 and micromark 4.0.2 agree. |
| 3 | File limit | en:143 · zh:143 · ja:143 · ko:143 | "10 MB" → "10 MiB (10,485,760 bytes)" in the limit and the rejection message. | `FILE_LIMIT = 10 * 1024 * 1024` (component:1824). |
| 4 | Legacy encodings | en:143 · zh:143 · ja:143 · ko:143 | "a file in another encoding is not opened" → "usually rejected at the first invalid UTF-8 byte"; a legacy file can be valid UTF-8 and open as different characters (GBK `模` C4 A3 → `ģ`, EUC-KR `홍` C8 AB → `ȫ`). | `decodeTextFile` only rejects invalid UTF-8, NUL and UTF-16; local Node 24.14.0 decode. |

## Primary sources (retrieved 2026-10-27)

- GFM tables extension: <https://github.github.com/gfm/#tables-extension->
- CommonMark §6.2 emphasis: <https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis>
- GitHub Markdown API behaviour recorded in `scripts/test-markdown-table-generator.fixtures.json` (2026-10-02): <https://docs.github.com/en/rest/markdown>
- GitLab table requirements: <https://docs.gitlab.com/user/markdown/#tables>
- Obsidian table syntax: <https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax>

## Implementation checks (file:line)

- `FILE_LIMIT` and file read: `MarkdownTableGeneratorTool.astro:1824`; `decodeTextFile` beside it.
- Usage event: `track()` and `resultKey` in the same script.
- 10 MiB and encoding text: `issue.fileTooBig`, `fileNotUtf8` strings in `STRINGS`.

## Unverified

- 2026-10-02 competitor renderings (Tables Generator, TableConvert, TableToMarkdown, NotePM, MarkdownToWord) were not re-run.
- The exact acceptance of a table immediately after a paragraph in each renderer is recorded from fixtures, not re-tested today.
- Broken-column behaviour of editors outside the recorded four was not tested.

## Tests

- `node scripts/test-markdown-table-generator.mjs`: 607 passed, 0 failed.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL.
