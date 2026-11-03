# Growth content changes (2026-11-03)

Record of the title, description and internal-link work for the 2026-11-03 growth batch. Shipped as v1.142.11. No tool logic, calculation engine, privacy policy, analytics or deployment configuration changed.

The starting point is the GSC page list for 2026-08-01 → 2026-10-31 (clicks = 0). Page-level impressions include `site:` and brand queries, so the numbers below are a prioritisation list, not a non-brand opportunity estimate. No ranking or CTR result is promised.

## Summary

| # | URL | Clicks | Impressions | Position | Status |
|---:|---|---:|---:|---:|---|
| 1 | `/tools/line-tools/` | 0 | 93 | 18.8 | Changed, four languages |
| 2 | `/tools/yaml-validator/` | 0 | 71 | 17.1 | Changed, four languages |
| 3 | `/blog/protobuf-to-json-guide/` | 0 | 70 | 15.4 | Not changed: draft + 301 |
| 4 | `/blog/markdown-preview-guide/` | 0 | 69 | 12.0 | Not changed: draft + 301 |
| 5 | `/tools/jsonl-converter/` | 0 | 66 | 10.7 | Changed, four languages |
| 6 | `/tools/gitignore-generator/` | 0 | 62 | 12.9 | Changed, four languages |
| 7 | `/tools/base64/` | 0 | 59 | 6.1 | Changed, four languages |
| 8 | `/blog/dns-lookup-guide/` | 0 | 57 | 4.6 | Changed (en); page is `noindex` |
| 9 | `/blog/aspect-ratio-calculator-guide/` | 0 | 57 | 9.7 | Changed (en) |
| 10 | `/tools/yaml-json/` | 0 | 56 | 16.2 | Changed, four languages |

Seven pages received a live, indexable change. One live page received a new title and description but remains `noindex`. Two URLs were not edited because they are no longer live pages; evidence is in the section below.

## TOTP concentration work

### Added FAQ

One question was added to `src/content/tools/totp-generator/{en,zh,ja,ko}.mdx`, after `everyday-use`, with the same id in all four languages:

- id: `validator-vs-generator`
- English: "Is this page a TOTP validator, or the same as Google Authenticator?"
- Chinese: "这个页面是 TOTP 验证器吗？和 Google Authenticator（谷歌验证器）有什么区别？"

The answer separates three things that the Bing queries mix together: a generator (this page), an authenticator app that stores the secret (Google Authenticator, Microsoft Authenticator, password managers), and a server-side validator. It also states that the page does not store the secret and does not confirm acceptance with a service.

This covers the adjacent Bing queries `2fa验证器`, `totp验证器` and `谷歌2fa生成器` without adding a separate keyword page or repeating the existing `everyday-use` answer.

### Added links

`src/content/tools/totp-generator/{en,zh,ja,ko}.mdx` now end with a "Related Tools and Next Steps" section linking to:

- the TOTP guide (`/blog/totp-generator-guide/` and its language versions)
- HMAC Generator
- QR Code Reader
- QR Code Generator
- Password Generator

The temporary bottom sentence that linked only HMAC and Password Generator was replaced by this section. Links inside the Limits section to the QR tools were kept.

### Reciprocal links

No `relatedSlugs` change was needed. The existing data already points both ways:

- `src/data/tools.ts:69` — TOTP lists `hmac-generator`, `qr-code-decoder`, `qr-code-generator`, `password-generator`.
- `src/data/tools.ts:38` — Password Generator lists `totp-generator`.
- `src/data/tools.ts:39` — QR Code Generator lists `totp-generator`.
- `src/data/tools.ts:64` — HMAC Generator lists `totp-generator`.
- `src/data/tools.ts:103` — QR Code Reader lists `totp-generator`.

The guide is linked from the TOTP page itself, which is the page that receives the search traffic.

## Page changes

### 1. `/tools/line-tools/`

Old title (en, 70 characters): `Remove Duplicate Lines & Sort Lines Online — Free Text Tool | ZeroTool`

New title (en, 53 characters): `Remove Duplicate Lines & Sort Lines Online | ZeroTool`

Old description: `Remove duplicate lines, sort alphabetically or numerically, reverse, shuffle, and trim text lines. Free, browser-based, no server required.`

New description: `Remove duplicate lines, sort A–Z or numerically, reverse, shuffle, trim, and delete blank lines. Runs in your browser; no upload.`

Reason: the page has six actions, but the old title spent characters on "Free Text Tool" and omitted empty-line removal. The new title keeps the two strongest actions and fits the 60-character budget. The description names all six actions.

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | 在线去重排序工具 — 免费文本行处理 \| ZeroTool | 在线去重排序工具 — 文本行处理 \| ZeroTool |
| ja | テキスト行ツール — 重複削除・ソート 無料オンライン \| ZeroTool | テキスト行ツール — 重複削除・ソート \| ZeroTool |
| ko | 텍스트 줄 도구 — 무료 온라인 \| ZeroTool | 텍스트 줄 도구 — 중복 삭제·정렬 \| ZeroTool |

Added links: Text Case Converter, Word & Character Counter, Slugify String. `src/content/tools/line-tools/*.mdx`.

### 2. `/tools/yaml-validator/`

Old title (en, 78 characters): `YAML Validator Online — Check YAML Syntax with Line & Column Errors | ZeroTool`

New title (en, 55 characters): `YAML Validator Online — Line & Column Errors | ZeroTool`

Old description: `Validate YAML syntax online. Get precise error messages with line and column numbers, see a parsed structure preview on success. Free, runs in your browser — your data is not uploaded.`

New description: `Validate YAML syntax with line and column numbers, multiple documents, and a JSON preview that lists values it cannot show exactly.`

Reason: the old title repeated the tool name and wasted space; the page's differentiators are line/column errors, multiple documents and the preview's loss warnings. The new description states the multi-document support and the warnings instead of a generic privacy sentence.

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | YAML 语法验证器 — 在线检查 YAML 错误并定位行列号 \| ZeroTool | YAML 语法验证 — 行列号定位 \| ZeroTool |
| ja | YAML バリデーター — 行・列番号付きでYAML構文をオンライン検証 \| ZeroTool | YAML 検証 — 行・列番号で確認 \| ZeroTool |
| ko | YAML 유효성 검사기 — 줄/열 번호로 YAML 구문 온라인 검사 \| ZeroTool | YAML 검사 — 줄·열 오류 표시 \| ZeroTool |

Added links: YAML to JSON Converter, JSON Schema Validator, OpenAPI Validator. `src/content/tools/yaml-validator/*.mdx`.

### 3. `/blog/protobuf-to-json-guide/` — not changed

The page is `draft: true` in all four languages (`src/content/blog/protobuf-to-json-guide/en.mdx:6`) and all eight URL forms are 301-redirected to the tool page (`public/_redirects:1066-1073`). The GSC impressions are historical. Editing the draft frontmatter would not produce a live page or change a search result.

The live surface is `/tools/protobuf-to-json/`. Its current title is `Protobuf to JSON Decoder, With or Without .proto | ZeroTool` (59 characters) and its description already covers decoding with or without `.proto`, hex/Base64/gRPC input, ProtoJSON output, int64/Timestamp preservation and encoding back. No change was made because the title and description already match the redirect intent and fit the length convention.

### 4. `/blog/markdown-preview-guide/` — not changed

The page is `draft: true` in all four languages (`src/content/blog/markdown-preview-guide/en.mdx:6`) and all eight URL forms are 301-redirected to the tool page (`public/_redirects:1149-1156`). Same reasoning as the Protobuf guide.

The live surface is `/tools/markdown-preview/`. Its current title is `Markdown Preview & Editor — Free Online | ZeroTool` (50 characters), and the description names CommonMark, GFM, tables, task lists, nested lists, footnotes and autolinks. No change was made because the title and description already match the redirect intent.

### 5. `/tools/jsonl-converter/`

Old title (en, 63 characters): `JSONL Converter Online — JSON Lines / NDJSON to JSON | ZeroTool`

New title (en, 50 characters): `JSONL to JSON Converter — NDJSON Online | ZeroTool`

Old description: `Convert JSONL and NDJSON to JSON arrays and back, validate each line, and export valid records in your browser. Large IDs and other numbers keep the exact digits you pasted.`

New description: `Convert JSONL or NDJSON to a JSON array and back, validate each line, and keep large IDs exactly as pasted. Runs in your browser.`

Reason: the page already ranks at position 10.7, the best of the tool pages in this batch. The old title spent characters on the repeated "JSON Lines / NDJSON" expansion and did not state the round trip. The new title uses the query form "JSONL to JSON" and keeps NDJSON. The description keeps the large-integer proof point.

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | JSONL 转换器 — JSON Lines / NDJSON 转 JSON \| ZeroTool | JSONL 转 JSON — 在线 \| ZeroTool |
| ja | JSONL コンバーター — JSON Lines / NDJSON を JSON に変換 \| ZeroTool | JSONL を JSON に変換 \| ZeroTool |
| ko | JSONL 변환기 — JSON Lines / NDJSON를 JSON으로 변환 \| ZeroTool | JSONL ↔ JSON 변환 \| ZeroTool |

Added links: JSON Formatter, jq Playground, JSON Schema Validator. `src/content/tools/jsonl-converter/*.mdx`.

### 6. `/tools/gitignore-generator/`

Old title (en, 75 characters): `Gitignore Generator — Free Online Multi-Stack .gitignore Builder | ZeroTool`

New title (en, 54 characters): `Gitignore Generator — 200+ Templates Online | ZeroTool`

Old description: `Build a .gitignore from 200+ official github/gitignore templates — pick languages, frameworks, IDEs, and OS, merge with deduplication, copy or download. Runs in your browser.`

New description: `Build a .gitignore from 237 official github/gitignore templates. Merge languages, frameworks, IDEs and OS, then copy or download.`

Reason: the page has 237 templates, not "200+"; the description now states the exact count. "Multi-Stack .gitignore Builder" was longer and less concrete than the template count. The new title fits the 60-character budget.

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | Gitignore 生成器 — 多 Stack .gitignore 在线合成 \| ZeroTool | Gitignore 生成 — 模板合并 \| ZeroTool |
| ja | Gitignore ジェネレーター — マルチ Stack .gitignore オンラインビルダー \| ZeroTool | Gitignore テンプレート生成 \| ZeroTool |
| ko | Gitignore 생성기 — 멀티 Stack .gitignore 온라인 빌더 \| ZeroTool | Gitignore 템플릿 생성기 \| ZeroTool |

Added links: Env File Parser, .htaccess Generator, Robots.txt Generator. `src/content/tools/gitignore-generator/*.mdx`.

### 7. `/tools/base64/`

Old title (en, 52 characters): `Base64 Encode & Decode Online — Free Tool | ZeroTool`

New title (en, 55 characters): `Base64 Encode & Decode Online — Text & Files | ZeroTool`

Old description: `Encode text to Base64 or decode Base64 strings back to plain text instantly. Free, browser-based, no data sent to servers.`

New description: `Encode text or files to Base64, decode back to UTF-8, switch between Standard and URL-safe, and add a Data URI prefix. No upload.`

Reason: the page is at position 6.1, the best position in the batch. The old title's "Free Tool" carried no information. The new title names the file mode, which is a real capability and a common reason to choose this page over a text-only encoder. The description adds URL-safe and Data URI, and says decoding returns UTF-8 text instead of the overbroad "plain text".

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | Base64 编码解码工具 — 免费在线 \| ZeroTool | Base64 编码解码 — 文件与文本 \| ZeroTool |
| ja | Base64 エンコード・デコード — 無料オンライン \| ZeroTool | Base64 エンコード・デコード \| ZeroTool |
| ko | Base64 인코드 / 디코드 — 무료 온라인 \| ZeroTool | Base64 인코딩·디코딩 \| ZeroTool |

Added links: Image to Base64 Converter, Basic Auth Header Generator, JWT Decoder. `src/content/tools/base64/*.mdx`.

### 8. `/blog/dns-lookup-guide/`

Old title (en, 65 characters): `DNS Lookup in the Browser: A, MX, TXT, and CAA via DNS-over-HTTPS`

New title (en, 50 characters): `DNS Lookup in the Browser: DoH for A, MX, TXT, CAA`

Old description: `Look up DNS records from any browser without dig, nslookup, or whatsmydns. How DoH unlocks A, AAAA, CNAME, MX, TXT, NS, SOA, CAA, PTR, and SRV in a fetch() call — with DNSSEC, TXT-segment, and propagation gotchas.`

New description: `How DNS-over-HTTPS returns A, AAAA, CNAME, MX, TXT, NS, SOA, CAA, PTR and SRV from a browser fetch, with DNSSEC and TXT gotchas.`

Reason: the title now names DoH once instead of repeating "DNS-over-HTTPS", and fits 60 characters. The description keeps the record list and the two main caveats.

Important: this page is `noindex: true` (`src/content/blog/dns-lookup-guide/en.mdx:7`), so the change does not make it eligible for search. It was edited because it is a live internal page, but the review must not treat it as an indexable opportunity. Removing `noindex` is a separate decision and was not done.

The page already links to the tool, HTTP Header Analyzer, IP Subnet Calculator, SSL Certificate Decoder and URL Parser. No additional link was needed.

### 9. `/blog/aspect-ratio-calculator-guide/`

Old title (en, 71 characters): `How to Find Aspect Ratio: Formula, Worked Examples and Resolution Table`

New title (en, 44 characters): `How to Find Aspect Ratio: Formula & Examples`

Old description: `The aspect ratio formula with worked examples: simplify width:height with the GCD, solve for a missing side, fit 2.39:1 into 16:9, and a table of common resolutions with exact ratios.`

New description: `Reduce a width and height to a ratio with the GCD, solve for a missing side, fit 2.39:1 into 16:9, and check common resolutions.`

Reason: the search-intent words are "how to find aspect ratio" and the worked formula. "Resolution Table" pushed the title past 60 characters and described the last section rather than the main promise. The description keeps the four tasks and drops the repetition of "worked examples".

The guide already linked to the Aspect Ratio Calculator (twice), Image Compressor and Image Splitter. One link was added to the SVG to PNG Converter, where setting one side lets the other follow the source ratio.

Only the English version was changed. The Chinese, Japanese and Korean versions are `noindex` and were left untouched to avoid creating a title mismatch without a search surface.

### 10. `/tools/yaml-json/`

Old title (en, 64 characters): `YAML to JSON Converter Online — Free Data Format Tool | ZeroTool`

New title (en, 50 characters): `YAML to JSON Converter Online — Two-Way | ZeroTool`

Old description: `Convert YAML to JSON and JSON to YAML instantly. Supports nested objects, arrays, multi-line strings. Free, browser-based, no server required.`

New description: `Convert YAML to JSON and JSON to YAML in both directions. Nested objects, arrays, multi-line strings; values that cannot convert exactly are listed.`

Reason: "Free Data Format Tool" did not describe the page. The new title states the round trip, which is the main difference from a one-way converter. The description adds the loss listing, which the page implements and documents.

Localized titles:

| Language | Old | New |
|---|---|---|
| zh | YAML JSON 互转工具 — 免费数据格式转换 \| ZeroTool | YAML JSON 互转 — 双向 \| ZeroTool |
| ja | YAML JSON 変換器 — 無料オンライン \| ZeroTool | YAML JSON 相互変換 \| ZeroTool |
| ko | YAML JSON 변환기 — 무료 온라인 \| ZeroTool | YAML JSON 상호 변환 \| ZeroTool |

Added links: YAML Validator, TOML to JSON Converter, JSON Formatter. `src/content/tools/yaml-json/*.mdx`.

## Length check

All changed English titles are at most 60 characters; all changed zh/ja/ko titles are at most 30 characters including `| ZeroTool`.

| Page | en | zh | ja | ko |
|---|---:|---:|---:|---:|
| line-tools | 53 | 27 | 30 | 30 |
| yaml-validator | 55 | 28 | 29 | 30 |
| jsonl-converter | 50 | 28 | 27 | 26 |
| gitignore-generator | 54 | 30 | 29 | 28 |
| base64 | 55 | 30 | 28 | 25 |
| yaml-json | 50 | 28 | 25 | 26 |
| aspect-ratio guide | 44 | — | — | — |
| dns-lookup guide | 50 | — | — | — |

Several old localized titles were above the 30-character convention; the new values bring them inside it.

## Files changed

- `src/content/tools/totp-generator/{en,zh,ja,ko}.mdx`
- `src/content/tools/line-tools/{en,zh,ja,ko}.mdx`
- `src/content/tools/yaml-validator/{en,zh,ja,ko}.mdx`
- `src/content/tools/jsonl-converter/{en,zh,ja,ko}.mdx`
- `src/content/tools/gitignore-generator/{en,zh,ja,ko}.mdx`
- `src/content/tools/base64/{en,zh,ja,ko}.mdx`
- `src/content/tools/yaml-json/{en,zh,ja,ko}.mdx`
- `src/content/blog/aspect-ratio-calculator-guide/en.mdx`
- `src/content/blog/dns-lookup-guide/en.mdx`
- `docs/2026-11-03-growth-baseline.md`
- `docs/2026-11-03-growth-content-changes.md`
- `AGENTS.md` changelog entry

No component, engine, `tools.ts` description, `persistence.ts`, `network.ts`, analytics or redirect file changed.

## Verification

Run on 2026-11-03 with Node 24.14.0.

| Check | Result |
|---|---|
| `node scripts/audit.mjs --quiet` | 24 PASS, 0 WARN, 0 FAIL |
| `npm run build` | Passed; 564 tool pages checked for CSS order; 845 HTML files processed |
| `node scripts/test-tool-content-parity.mjs` | 7,753 passed, 0 failed (141 tools) |
| `node scripts/test-llms-txt.mjs` | 1,010 passed, 0 failed |
| `node scripts/test-blog-index.mjs` | 54 passed, 0 failed |
| `node scripts/test-related-posts.mjs` | 32 passed, 0 failed |
| Targeted tool tests | totp 296; line-tools 1,618; yaml-validator 762; jsonl 1,130; gitignore 556; base64 1,064; aspect-ratio 520; dns 519; yaml-json 775; markdown-preview 683; protobuf 401 — all 0 failed |
| Full `scripts/test-*.mjs` run | 169 of 170 scripts exited 0. `test-csv-json.mjs` exited 139 in the parallel batch, then passed alone: 990 passed, 0 failed. |
| Internal link check | 123 links in the changed files; 0 missing targets in `dist/` |
| Title length check | All changed en titles ≤60; all changed zh/ja/ko titles ≤30 including `| ZeroTool` |

The full test run used the build made after the content edits. Two blog `updatedDate` values were changed after that build; the site was rebuilt afterwards, and audit, parity, llms, blog-index, related-posts and all eleven targeted tool tests were rerun on the final build with the results above.

The CSV failure is the known intermittent exit 139 under a loaded batch; the individual rerun is the recorded result. No other script failed.
