# W6 batch 2 — cookie-parser fact-check (2026-10-27)

Scope: 96 statements — all 76 candidate lines, the 6 FAQ answers missing from the index, and 14 claims from examples, server tables and limits. Files: `src/content/tools/cookie-parser/{en,zh,ja,ko}.mdx`, visible copy of `src/components/tools/CookieParserTool.astro`. No engine block, logic, option, test or script changed.

## Corrections (6 claims × 4 languages = 24 statements)

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| 400-day cap | en.mdx:19,77 · zh.mdx:19,70 · ja.mdx:19,66 · ko.mdx:19,61; component 156/379/602/825 | "browsers cap any lifetime at 400 days" → "Chrome cuts any lifetime at 400 days (since 104); RFC 6265bis recommends 400 days" |
| SameSite default | en.mdx:22 · zh.mdx:22 · ja.mdx:22 · ko.mdx:22; component 179/402/625/848 and 196/419/642/865 | "Firefox and Safari still send it cross-site" → "do not apply that default; Safari also blocks third-party cookies by default" |
| Domain equal to host | en.mdx:78 · zh.mdx:71 · ja.mdx:67 · ko.mdx:62 | "Domain equals the response host → host-only (§5.7 step 9)" → only when the Domain is a public suffix equal to the host; otherwise a domain cookie (step 10) |
| `__Http-` prefixes | en.mdx:82 · zh.mdx:75 · ja.mdx:71 · ko.mdx:66 | "`__Http-` and `__Host-Http-` also need HttpOnly" → "`__Http-` needs Secure and HttpOnly; `__Host-Http-` needs all four" |
| Chromium deviations | en.mdx:87 · zh.mdx:80 · ja.mdx:76 · ko.mdx:71 | "followed the RFC on dates … differed on these points" (4 bullets) → dates removed, 6 bullets added: Expires year 1600 dropped, year 10000 capped at 400 days |
| PSL load trigger | en.mdx:113 · zh.mdx:105 · ja.mdx:99 · ko.mdx:96 | "loads the first time you parse Set-Cookie/cookies.txt" → also on first input focus and on entering a Domain in the builder |

## Primary sources (all retrieved 2026-10-27)

- RFC 6265bis-22 (2025-12-01), §5.1.1, §5.4, §5.5, §5.6, §5.6.7.2, §5.7 steps 9–10, §5.8.3: <https://www.ietf.org/archive/id/draft-ietf-httpbis-rfc6265bis-22.txt>
- layered cookies -02, §4.1.3.3 (`__Http-`) and §4.1.3.4 (`__Host-Http-`): <https://www.ietf.org/archive/id/draft-ietf-httpbis-layered-cookies-02.txt>
- CHIPS -01, §2.1/§2.3 (Partitioned requires Secure): <https://www.ietf.org/archive/id/draft-cutler-httpbis-partitioned-cookies-01.txt>
- MDN BCD `Set-Cookie.json`: SameSite Lax default (Chrome 80, Edge 86, Firefox 69 behind `network.cookie.sameSite.laxByDefault`, Safari false), None requires Secure (Firefox 131), Partitioned (114/141/26.2), `__Http-` (140/143): <https://raw.githubusercontent.com/mdn/browser-compat-data/main/http/headers/Set-Cookie.json>
- Chrome 400-day cap, M104, page updated 2023-01-12: <https://developer.chrome.com/blog/cookie-max-age-expires>
- WebKit full third-party cookie blocking, 2020-03-24: <https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/>
- curl cookies.txt (7 TAB fields, `#HttpOnly_`): <https://curl.se/docs/http-cookies.html>
- php-src PHP-8.4 `main/php_variables.c` (first wins, `.`/space→`_`, raw-url decode) and `ext/standard/head.c` (empty setcookie → `deleted`): <https://raw.githubusercontent.com/php/php-src/PHP-8.4/main/php_variables.c>, <https://raw.githubusercontent.com/php/php-src/PHP-8.4/ext/standard/head.c>
- Python 3.12 `http.cookies` docs plus CPython 3.12.2 run (last wins, quotes removed, space drops the whole header): <https://docs.python.org/3/library/http.cookies.html>
- cookie 0.7.2 and 1.1.1 source; cookie-parser 1.4.7 depends on cookie 0.7.2: <https://unpkg.com/cookie@0.7.2/dist/index.js>, <https://unpkg.com/cookie@1.1.1/dist/index.js>, <https://www.npmjs.com/package/cookie-parser/v/1.4.7>
- Tomcat 10.1 Context `sessionCookiePath` default: <https://tomcat.apache.org/tomcat-10.1-doc/config/context.html>
- Baidu Analytics cookie list (`Hm_lvt_` = visitor history): <https://tongji.baidu.com/holmes/Analytics/%E9%9A%90%E7%A7%81%E5%90%88%E8%A7%84%E6%8C%87%E5%8D%97/%E7%99%BE%E5%BA%A6%E7%BB%9F%E8%AE%A1%E7%9B%B8%E5%85%B3Cookie%E5%88%97%E8%A1%A8>
- Public Suffix List plus the pinned local copy (2026-10-01, commit 6cd82aff, ICANN 6,949 / private 3,384): <https://publicsuffix.org/>

## Implementation checks (file:line)

- Sizes 4096/1024: `CookieParserTool.astro:1068-1069`, checks at 1483/1493. Max-Age wins and 400-day cap: 1539-1570.
- Date algorithm: 1118; public suffix + host-only: 1212, 1572-1596 (`domainSuffixHost` only for a public suffix equal to the host).
- Prefix conditions: 1616-1627 (`__Http-` requires Secure+HttpOnly only).
- Order and creation time: 1792-1805 (new order on replace, like Chromium), 1808-1827 (longer path, then earlier order).
- PSL load: `ensurePsl` 1924, triggers 2148 (Set-Cookie/cookies.txt), 2265 (input focus), 2307 (builder Domain). gzip -9 size 44,872 B.
- Privacy: `persistence.ts:44` disabled → `ToolLayout.astro:42` sensitive → `BaseLayout.astro:139/184` no ads/GA; wipe at `ToolLayout.astro:187-192`; component has no storage or network calls.

## Unverified (unchanged)

- Competitor comparisons (en:109, zh:101, ja:95, ko:92) are dated 2026-10-02 observations; no browser re-run in this pass.
- Firefox/Safari 400-day expiry cap has no primary source here, so the text now attributes the cap to Chrome and the RFC recommendation.
- Deleting a Partitioned cookie also needs the same Partitioned flag (`buildJar` key); the duplicate-name FAQ still names only Domain and Path. Left as a qualified caveat.

## Tests

- `node scripts/test-cookie-parser.mjs` before edits: 1927 passed, 0 failed, 0 skipped, exit 0.
- After edits: 1927 passed, 0 failed, 0 skipped, exit 0.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL, exit 0.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed, exit 0.
