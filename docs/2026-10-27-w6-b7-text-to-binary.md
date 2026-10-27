# W6 batch 7 — text-to-binary fact check (2026-10-27)

Scope: `text-to-binary` en / zh / ja / ko tool pages and the visible strings of `TextToBinaryTool.astro`. Read-only evidence: `engine:start/end`, `src/data/persistence.ts`, `src/data/network.ts`, `scripts/test-text-to-binary.mjs`. FAQ count, ids, order, `steps`, `seoTitle`, the engine block, persistence / network policy, analytics and scripts were not changed.

## Counts

72 statements: 44 supported, 24 corrected, 2 qualified, 2 unverified.

## Corrections (6 claim groups × 4 languages)

| # | Claim | file:line (en / zh / ja / ko) | Before → after | Evidence |
|---|---|---|---|---|
| 1 | Short binary groups | en:16 · zh:16 · ja:16 · ko:16 | "a continuous string is split into 8-bit bytes, so its length must be a multiple of 8" → a group longer than 8 bits must be a multiple of 8; when no group is longer, a 1–7-bit group is one byte with leading zeros (`1001000` → `H`). | `decodeGroups` in the engine block; matches Python `bin()`-style output and the test vectors. |
| 2 | Status counts | en:14 · zh:14 · ja:14 · ko:14 | "shows the character, code point and byte counts" → on encode it shows character and byte counts, and adds the code point count only when it differs (family emoji). | `updateStats` / status construction in the script. |
| 3 | Error diagnosis | en:18 · zh:18 · ja:18 · ko:18 | "a bit count that is not a multiple of 8" → names a group longer than 8 bits whose length is not a multiple of 8, and a short group mixed with a longer one; also gives the position of a non-0/1 character. | `decodeGroups` error codes `errLong`, `errMixed`, `errCharAt`. |
| 4 | Legacy encodings | en:20 · zh:20 · ja:20 · ko:20 | "bytes in those encodings give an error or show control characters" → they are read as UTF-8: usually fail the check or turn into unrelated ASCII. ASCII-only UTF-16 without BOM passes with NUL and a warning; other UTF-16 without BOM can pass silently (U+4E2D is 4E 2D in UTF-16BE → `N-`). | `TextDecoder` with `fatal` and the test's UTF-16 cases. |
| 5 | Analytics wording | en:22 · zh:22 · ja:22 · ko:22 | "the page analytics record …" → "the usage event records …"; same triggers (commit / separator / successful action), no typing. | `trackTool` calls in the script. |
| 6 | Control characters and BOM | en body | "if the result contains control characters" → C0 controls other than tab and line breaks, or DEL; C1 controls are not counted. The BOM is kept without a warning. | warning builder in the script. |

## Primary sources (retrieved 2026-10-27)

- RFC 3629 (UTF-8): <https://www.rfc-editor.org/rfc/rfc3629>
- WHATWG Encoding, UTF-8 decode (BOM handling): <https://encoding.spec.whatwg.org/#utf-8-decode>
- Unicode UAX #29 (grapheme clusters, status count): <https://www.unicode.org/reports/tr29/>

## Implementation checks (file:line)

- Group reading and errors: `engine:start/end` `decodeGroups` / `encodeText`.
- Warning builder for control characters: page script beside `showDecoded`.
- Privacy: no storage or network calls in the script; `persistence.ts` has no `text-to-binary` entry; analytics sends tool name and direction only.

## Unverified

- 2026-09-30 competitor observations (RapidTables, 67tool, Rakko, onul.works) were not re-run.
- UTF-16 without BOM is documented as a possible silent pass; no exhaustive fixture for every byte pair was generated in this pass.

## Tests

- `node scripts/test-text-to-binary.mjs`: 236 passed, 0 failed.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL.
