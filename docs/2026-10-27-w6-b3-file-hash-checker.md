# W6 batch 3 — file-hash-checker fact-check (2026-10-27)

Scope: 96 statements — all 5 FAQ answers sentence by sentence, 5 steps, every body claim with a number, limit, privacy, network, storage, analytics, format or compatibility assertion, and the four visible component tips with the same claims. Files: `src/content/tools/file-hash-checker/{en,zh,ja,ko}.mdx`, visible copy of `src/components/tools/FileHashCheckerTool.astro`. No engine block, worker protocol, persistence/network policy, analytics or script changed.

## Counts

| Result | Statements |
|---|---:|
| Supported | 62 |
| Corrected | 28 |
| Qualified (text unchanged) | 4 |
| Unverified (text unchanged) | 2 |
| **Total** | **96** |

## Corrections (7 claim groups × 4 languages = 28 statements)

| # | Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|---|
| 1 | Memory use with large files | en:16 · zh:16 · ja:16 · ko:16 | "memory use stays near 100 MB even for a 4 GB ISO" → "memory use does not grow with file size; the 1 GB test added about 100 MB". The worker reuses one 1 MB buffer; the old sentence turned a measured 1 GB result into a claim about 4 GB. |
| 2 | Length diagnosis | en:22 · zh:22 · ja:22 · ko:22 | "a value of another length lost or gained a character" → add that 56 digits is SHA-224, which the tool does not compute and reports as unsupported. `hash-length` in `FileHashCheckerTool.astro` already distinguishes 56 digits; the FAQ did not. |
| 3 | PowerShell table input | en:62 · zh:55 · ja:46 · ko:60 | "table or Format-List output" → `Format-List` uses the `Path`; table rows carry no file name, so select every file in the table. The parser ignores the `Path` column and cannot attribute a table row to one selected file. |
| 4 | Bare 64/128-digit digest | en:69,94 · zh:83 · ja:48,69 · ko:58,77 | "a SHA3 value is reported as unsupported" → a labelled SHA3/BLAKE2 value is unsupported; a bare 64- or 128-digit digest is indistinguishable from SHA-256/SHA-512 and is compared as that algorithm, with a note when it does not match. |
| 5 | Limits: labelled unsupported algorithms | en:94 · ja:69 · ko:77 · zh (limits line) | The limits line now says labelled values and files named for them are reported unsupported, while bare digests are compared and noted. Aligns the limits with the new FAQ wording. |
| 6 | SHA-1 collision source | en:96 · zh:83 · ja:72 · ko:80 | `SHAttered` → Google's 2017 announcement of the first SHA-1 collision. The SHAttered site is the CWI/Google collision page; the Google Security Blog post is the first-party announcement of the same result. |
| 7 | Component folder tip | component 73/146/215/284 | "Choose a folder is available on computers" → "shown on wider screens". `FileHashCheckerTool.astro` hides the folder button at the mobile breakpoint, so "on computers" promised it to a narrow desktop window that does not show it. |

## Primary sources (retrieved 2026-10-27)

- MDN `SubtleCrypto.digest()` — takes a whole `BufferSource`: <https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest>
- hash-wasm 4.12.0 (incremental hashing, used by the worker): <https://github.com/Daninet/hash-wasm>
- Microsoft Learn `Get-FileHash` — default SHA256, upper-case hex, `Format-List` fields: <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash>
- GNU coreutils cksum output modes (escaped file names): <https://www.gnu.org/software/coreutils/manual/html_node/cksum-output-modes.html>
- Google Security Blog, first SHA-1 collision, 2017-02-23: <https://security.googleblog.com/2017/02/announcing-first-sha1-collision.html>
- Node.js v24.21.0 `SHASUMS256.txt` (34 lines): <https://nodejs.org/dist/v24.21.0/SHASUMS256.txt>
- W3C Subresource Integrity: <https://www.w3.org/TR/SRI/>
- npm registry `hash-wasm` 4.12.0 integrity value: <https://registry.npmjs.org/hash-wasm/4.12.0>

## Implementation checks (file:line)

- One worker per algorithm; SHA-256 starts automatically: `src/components/tools/FileHashCheckerTool.astro:719` (`MAX_FILES = 1000`), 864 (file cap), 1146 (copy/download disabled until a result exists).
- Streaming read and 1 MB buffer: `public/vendor/file-hash-worker.js` (BYOB reader with a 1 MB buffer; `importScripts('/vendor/hash-wasm.min.js')`).
- Checksum-file size limit and list parsing: `FileHashCheckerTool.astro` `listTooBig` at 49/118/187/256 and the list parser in the `engine:start/end` block.
- Folder button hidden at the mobile breakpoint: component style block, `.fhc-dir-btn` media query; the tip now says "wider screens".
- Privacy: `src/data/persistence.ts:15` `'file-hash-checker': 'disabled'` → `ToolLayout.astro:42` sensitive → `BaseLayout.astro:139/184` no AdSense or GA; the component and worker contain no `fetch` / XHR / storage calls (static assertions in `test-file-hash-checker.mjs`).

## Qualified (unchanged)

- 1 GB SHA-256 ≈ 4 s and ~100 MB extra memory: measured 2026-10-01 on an Apple M1 Max; the date stays in the body.
- Ubuntu 24.04.5 ISO match: measured 2026-10-01 against the official `SHA256SUMS`.
- Competitor table (emn178, BrowserTools.jp, PiliApp, tool.lu): 2026-10-01 observations, not re-run today.
- `Get-FileHash` table rows cannot be attributed to one file: this is a property of the parser and the documented output; the text now states it as a limitation.

## Unverified (unchanged)

- The exact peak memory of the worker on files above 1 GB was not re-measured; only the 1 GB observation is cited.
- BLAKE3 is listed as unsupported because it is not in the worker's `importScripts` bundle; no BLAKE3 sample was run in this pass.

## Tests

- `node scripts/test-file-hash-checker.mjs`: 474 passed, 0 failed.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL.
