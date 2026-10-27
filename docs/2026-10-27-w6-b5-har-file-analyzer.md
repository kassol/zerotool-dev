# W6 batch 5 — har-file-analyzer fact-check (2026-10-27)

Scope: 82 statements — the 20 FAQ answers (5 per language), every body claim about HAR versions, timings, redaction, Base64, storage, privacy, analytics, limits, competitor behaviour and numbers, and the visible copy of `src/components/tools/HarFileAnalyzerTool.astro`. Files: `src/content/tools/har-file-analyzer/{en,zh,ja,ko}.mdx`, visible `STRINGS` lines of the component, cross-checked against `src/data/persistence.ts` and `src/data/network.ts`. No change to FAQ count, ids or order, `steps`, `seoTitle`, `engine:start/end`, persistence, network, analytics or `scripts/`.

Result: 33 supported, 31 corrected (10 distinct claims), 16 qualified, 2 unverified. Everything below is verified against the shipped code (`file:line`) or a first-party source fetched on 2026-10-27.

## Corrections (10 claims: 9 in four languages, 1 English only)

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| HAR 1.2 reference | en.mdx:64 · zh.mdx:70 · ja.mdx:55 · ko.mdx:63 | Link went to `w3c.github.io/web-performance/specs/HAR/Overview.html`. That page marks itself "**DO NOT USE** … never published by the W3C Web Performance Working Group … abandoned". Replaced with the published HAR 1.2 spec (`softwareishard.com/blog/har-12-spec/`), the reference Chrome's own HAR writer cites in `Log.ts` |
| Chrome sanitized export, "nothing else" (§sanitized FAQ) | en.mdx:16 · zh.mdx:16 · ja.mdx:16 · ko.mdx:16 | "removes three headers and the cookie lists, and nothing else" → also "leaves out the data of Server-Sent Events messages". `Log.ts` sets `request.cookies = []`, `response.cookies = []`, filters `cookie` / `authorization` / `set-cookie`, and omits `_eventSourceMessages[].data` when `options.sanitize` |
| Chrome row of the comparison table | en.mdx:100 · zh.mdx:90 · ja.mdx:93 · ko.mdx:83 | "except the three headers" → "except the three headers and the cookie lists" (same source) |
| "searches the whole file for every value it removed" | en.mdx:49 · zh.mdx:49 · ja.mdx:49 · ko.mdx:47 | Absolute → the code's rule: 8+ characters with letters and digits, or 16+ characters, no spaces (`residueEligible`, HarFileAnalyzerTool.astro:1463). Plain-word values are deliberately not searched |
| Timing tolerance | en.mdx:22 · zh.mdx:22 · ja.mdx:22 · ko.mdx:22 | "larger than 1.5 ms" → "1.5 ms or more". `mismatch = abs(time - sum) >= TOL_MS`, `TOL_MS = 1.5` (`:745`, `:786`) |
| Exported file version | en.mdx:25 · zh.mdx:25 · ja.mdx:25 · ko.mdx:25 | "The export is a HAR 1.2 file" → "keeps the `log.version` of the input file (browsers write 1.2)". `redactJob` copies every `log` key except `entries` / `pages`, so a 1.1 input stays 1.1 |
| "a timing error on every HTTPS request" | en.mdx:74 · zh.mdx:80 · ja.mdx:65 · ko.mdx:73 | → "every HTTPS request that opened a new connection". A reused connection has `connect = ssl = -1`, both sums agree (`normalizeTimings`) |
| `_transferSize` attribution | en.mdx:74 · zh.mdx:80 · ja.mdx:65 · ko.mdx:73 | "`_transferSize` in Chrome and Safari" → "`_transferSize`, which Chrome writes; without it the tool adds `headersSize` and `bodySize`; Firefox reads `bodySize`". Matches `transferOf` (`:849`) and drops an unverified Safari claim |
| Optional drops | en.mdx:56 | "server IP addresses" → "server IP addresses and client IP headers". `IP_HEADERS` (`x-forwarded-for`, `x-real-ip`, `forwarded`, `cf-connecting-ip`, `true-client-ip`, `x-client-ip`, `x-cluster-client-ip`) are cleared only with the same `ips` option |
| `errVersion` copy | component 53 / 190 / 327 / 464 | "reads HAR 1.x (log.version 1.1 or 1.2)" → "reads HAR 1.x, so log.version must start with 1". `checkHar` accepts any `parseInt(version, 10) === 1`, including 1.3, and the spec's versioning scheme says 1.x is backward compatible |

## Primary sources (retrieved 2026-10-27)

- HAR 1.2 spec text (fetch of the W3C copy; the page states it was abandoned), `time` = `blocked + dns + connect + send + wait + receive`, `ssl` included in `connect`, `-1` = not applicable: <https://w3c.github.io/web-performance/specs/HAR/Overview.html>. Canonical location used in the text: <https://www.softwareishard.com/blog/har-12-spec/> (cited by Chrome's HAR writer; direct fetch failed with a transport error from this environment).
- Chrome DevTools 130 release notes, "HAR exports now exclude sensitive data by default", `Settings > Preferences > Network > Allow to generate HAR with sensitive data`, long-click → `Export HAR (with sensitive data)`: <https://developer.chrome.com/blog/new-in-devtools-130>
- `devtools-frontend/front_end/models/har/Log.ts` (sanitize block, `_transferSize`, `_blocked_queueing`, `time` excludes `ssl`): <https://raw.githubusercontent.com/ChromeDevTools/devtools-frontend/main/front_end/models/har/Log.ts>
- Firefox `NetworkTimings.sys.mjs` (`connect` = `tcpConnectEnd − connectStart`, `ssl` separate, total built from offsets so both are counted): <https://raw.githubusercontent.com/mozilla-firefox/firefox/main/devtools/shared/network-observer/NetworkTimings.sys.mjs>
- Alibaba Cloud PTS "使用HAR文件快速开始压测", upload under 10 MB, each request becomes a pressure-test API: <https://help.aliyun.com/zh/pts/performance-test-pts-3-0/use-cases/how-to-use-har-file-to-quickly-start-pressure-test>
- Okta, "Tracking Unauthorized Access to Okta's Support System", 2023-10-20 (stolen credential, "can also contain sensitive data, including cookies and session tokens", sanitize before sharing): <https://sec.okta.com/articles/2023/10/tracking-unauthorized-access-oktas-support-system>
- Kollus developer guide, "문제 해결을 위한 HAR 파일 생성" (support asks for a HAR of the playback problem): <https://docs.kollus.com/dev-guide/troubleshooting/developers/har-file/>

## Implementation checks (file:line)

- Version gate: `checkHar` `HarFileAnalyzerTool.astro:882` (missing version allowed, `parseInt(version, 10) !== 1` rejected); size cap `:746` (300,000,000 bytes; the test asserts it).
- Timings: `normalizeTimings` `:786`, `TOL_MS` `:745`, `_blocked_queueing` `:812`, Firefox detection by `creator.name` / `log.browser.name` `:893`.
- Transfer size: `transferOf` `:849`.
- Redaction scope: `isSensitiveName` `:1135`, `redactCookieHeader` / `redactSetCookie` `:1224`/`:1235`, `redactCredential` `:1249` (keeps the scheme word), `URL_HEADERS` / `IP_HEADERS` `:1121-1122`, `residueEligible` `:1463`.
- Base64: `readBody` `:1364` (text MIME list, UTF-8 only, `atob`, fatal decode); `writeBody` deletes `compression` and rewrites `size`.
- Verification of the saved copy: `countResidue` + `redactJob` phase 2; the saved text is parsed again and searched.
- Overview counts: `sensCount` `:1714`; Chrome-sanitized note requires `creator.name === 'WebInspector'` and zero cookie / set-cookie / authorization counts (`looksSanitizedChrome` `:1775`).
- Defaults behind the two FAQ claims: `exEverywhere` checked `:706`; `exCurlRedact` checked `:731`; scope all / filtered built from the same `filterRows`.
- Privacy: `persistence.ts:17` `'har-file-analyzer': 'disabled'` → `ToolLayout.astro:42` `sensitive` → `BaseLayout.astro:140/185` no AdSense / GA; stored value wiped at `ToolLayout.astro:190`; the script has no `fetch`, `XMLHttpRequest`, `sendBeacon`, `localStorage`, `sessionStorage` or `document.cookie` (test asserts this).

## Unverified (unchanged)

- Safari: "use the Export button in the Web Inspector Network tab" (FAQ + `exportHowTip`), and "Safari counts TLS inside connect" / the old `_transferSize` half. No WebKit source or Safari build was reachable in this pass; the transfer sentence was rewritten to the code's rule so it no longer depends on the Safari claim. The TLS sentence still names Safari.
- Firefox: "right-click the request list and choose Save All As HAR". Not exercised today.
- ja.mdx:30 intra-mart FAQ: HTTP 403 from this environment, so the Chrome 130 guidance attributed to that article is unverified.
- ko.mdx:30–32 Kollus `custom_key` = encrypted user key: the linked player-URL document was not fetched; only the HAR-request page was verified.
- Competitor tables and the "none of the three uploaded the file" lines are dated 2026-10-01 observations (en:96–105, zh:84–93, ja:87–96, ko:77–86); not re-run. Google's "top-level keys / first 3,000 characters" comes from a 2026-10-01 source reading.
- Component `exDone` / `exCheckScope` still say the re-check covers "the values this tool removed"; `countResidue` searches the same secret-shaped subset as the replacement pass. Left as is (UI copy, no behaviour change).
- Firefox `bodySize` = whole transfer, and Chrome 130's exact label `Export HAR (sanitized)`: consistent with the code and the blog, not re-measured.

## Tests

- `node scripts/test-har-file-analyzer.mjs`: 2187 passed, 0 failed, exit 0 (bash 4.2+ absent → cURL execution block skipped, as before).
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed, exit 0 (141 tools).
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL, exit 0.
