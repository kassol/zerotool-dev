# Link assets and outreach order (2026-11-03)

Five assets from existing site data, twenty targets, a four-week order, exclusions. No code changes, no ranking promises. Third-party rules checked on 2026-11-03 where marked; the rest are unverified.

Baseline: Bing 287/8,304 (2026-10-21→27), 31.3 daily clicks, TOTP 367/814 = 45.1%; AI citations 1,952 weekly / 316.6 daily; GSC non-brand 3/582/0.52% (`docs/2026-11-03-growth-baseline.md`). GSC links and referring sites were 0 on 2026-10-06 (`~/Documents/zerotool-daily-metrics/backlink-ledger.csv`).

## 1. Five citable assets

### A. Two Resolvers, Two Answers: Cloudflare and Google DoH Compared
**Thesis.** The same name can return different A records, different SERVFAIL notes and different TXT text, and the JSON shows which difference you are seeing.
**Data.** `https://zerotool.dev/blog/dns-lookup-guide/`: `www.qq.com` under `edns_client_subnet` returned `121.14.77.201` / `121.14.77.221` for `114.114.114.0/24`, `43.159.109.55` for `8.8.8.0/24` and `43.168.224.173` for `139.130.4.0/24`; Cloudflare ignored the parameter and returned `43.159.109.55`. `dnssec-failed.org` gives `EDE(9)` from Cloudflare (`DNSKEY Missing`) and Google (`extended_dns_errors`). The same DKIM key is 425 characters from Cloudflare and 420 joined from Google. Cloudflare's AD flag differed by record type across 30 queries without `do=1`.
**Format.** Comparison table plus a fetch script for both endpoints, ECS on Google only, printing rcode, AD, EDE and raw TXT.
**Audience.** SRE, platform and network engineers, DNS operators.
**Host.** Extend `https://zerotool.dev/blog/dns-lookup-guide/` (3,341 words); link from `/tools/dns-lookup/`.

### B. RFC 6238 by Hand: 18 Vectors and the 32-Byte Key Trap
**Thesis.** The test table is easy to quote and easy to fail: the SHA-256 and SHA-512 rows use 32- and 64-byte keys, not the 20-byte key printed above the table.
**Data.** `https://zerotool.dev/blog/totp-generator-guide/`: at Unix time 59, HMAC-SHA-1 is `75a48a19…`, offset 11, `0x41397eea` = 1,094,287,082, giving `94287082` (8 digits) and `287082` (6). The guide has all 18 rows and both longer Base32 keys. `/tools/totp-generator/` at fixed time 59 shows `94287082`, previous `84755224`, next `37359152`.
**Format.** Step walkthrough, 18-row table, Node/Python snippets that recompute every row.
**Audience.** Backend/auth engineers, security reviewers, QA.
**Host.** Extend `https://zerotool.dev/blog/totp-generator-guide/`; link from `/tools/totp-generator/`.

### C. QR Capacity Is a Mode Problem, Not a Size Problem
**Thesis.** Capacity is set by mode and version first; error correction is the second lever, and the 7/15/25/30% recovery figures hide how many codewords each step adds.
**Data.** `https://zerotool.dev/tools/qr-code-generator/`: 40-L maxima are 7,089 digits / 4,296 alphanumeric / 2,953 bytes / 1,817 Kanji; 40-M/Q/H byte maxima are 2,331 / 1,663 / 1,273. Upper-case `HTTPS://ZEROTOOL.DEV` fits version 1 at L; lower case needs version 2. 2,400 characters at M need 19,220 bits against 18,672 at 40-M (69 bytes over) but fit at L. `scripts/test-qr-code-generator.mjs` checks 160 capacity combinations.
**Format.** Capacity matrix, version/ECC decision table, exact status-line examples.
**Audience.** Print/design engineers, marketing ops, frontend developers.
**Host.** `https://zerotool.dev/blog/qr-code-generator-guide/` (826 words, the thinnest guide); link from the tool.

### D. 111, 133, 172: The Same 192 Characters in Three Tokenizers
**Thesis.** CJK token counts differ by more than half across o200k_base, cl100k_base and DeepSeek, so a "4 characters per token" rule undercounts where context and budget matter.
**Data.** `https://zerotool.dev/blog/ai-token-counter-guide/`: four texts with full counts (7/7/7; 4/7/4; 7/10/7; 7/10/6), and a 192-character code-review sample at 111 DeepSeek / 133 o200k / 172 cl100k, a 55% spread; "4 characters per token" predicts 48. It records that Claude 4.7+ adds about 30% more tokens, and that Claude/Gemini tokenizers are not published for local use. `/tools/ai-token-counter/` has the 14-model price/context table; `scripts/build-deepseek-tokenizer.mjs` reproduces the DeepSeek counts.
**Format.** Comparison table, method note, script that reproduces the counts.
**Audience.** LLM application developers, cost/context planners, technical writers.
**Host.** Extend `https://zerotool.dev/blog/ai-token-counter-guide/` (1,594 words); link from the tool.

### E. Five Markdown Renderers, One Table: Measured Differences
**Thesis.** Renderer differences are concentrated and reproducible: five renderers agree on most tables and disagree on a short, testable list.
**Data.** `https://zerotool.dev/blog/markdown-table-generator-guide/` records outputs on 2026-10-02 from the GitHub and Gitee Markdown APIs, qiita_marker 0.23.9.0, zenn-markdown-html 0.5.4 and micromark. `\\|` is one cell on GitHub, Gitee, Qiita and Zenn but two in micromark; an unescaped `|` splits on all five; header/delimiter mismatch means no table on all five; a table can start right after a paragraph; full-width `｜` means no table on all five; `**注意：**ここ` is not bold on all five. `https://zerotool.dev/blog/markdown-cheat-sheet/` §"Where Platforms Differ" adds newlines, raw HTML and CJK bold. Fixtures: `scripts/test-markdown-table-generator.fixtures.json`.
**Format.** Renderer × input matrix, fixture JSON, publishing checklist.
**Audience.** Docs engineers, technical writers, DevRel, OSS maintainers.
**Host.** Extend `https://zerotool.dev/blog/markdown-table-generator-guide/` (1,554 words); the cheat sheet links to it.

## 2. Twenty targets

Assets: MD = Markdown, TOK = token counting, DNS = DoH comparison, QR = QR capacity, TOTP = RFC 6238.

| # | Target | Type | Pitch (asset) | Rule / risk |
|---|---|---|---|---|
| 1 | [Show HN](https://news.ycombinator.com/showhn.html) | Community | QR: "Show HN: a QR generator that names version and ECC." | Own work, no AI text, no vote asks; one shot. |
| 2 | [Lobsters](https://lobste.rs/about) | Community | DNS: measured DoH/EDE differences. | Self-promo under 25%; accounts under 70 days cannot self-promote (2026-11-03). |
| 3 | [dev.to](https://dev.to/) | Publishing | MD: full matrix plus fixture JSON; tool link at the end. | Dofollow only if indexed (ledger); thin repost gets noindexed. |
| 4 | [Qiita](https://qiita.com/terms) | Community (JP) | TOTP: Japanese walkthrough with all 18 vectors and the key-length trap. | Terms forbid SEO/promotional articles (plan); link attribute unverified. |
| 5 | [Zenn](https://zenn.dev/terms) | Community (JP) | MD: "Zenn vs GitHub vs Qiita on the same table." | Body links nofollow (verified); no ads or machine text. |
| 6 | [GeekNews](https://news.hada.io/guidelines) | Community (KR) | QR: Show GN, capacity numbers in Korean. | Account ≥7 days; repeated source posts throttled; content-farm sources banned (plan). |
| 7 | [r/webdev](https://www.reddit.com/r/webdev/) | Community | QR: Saturday Showoff thread only. | No self-promotion; Saturday feedback only (plan); new accounts removed. |
| 8 | [r/devops](https://www.reddit.com/r/devops/) | Community | DNS: "Why the same name SERVFAILs with different EDE notes." | Self-promo limits unverified (403, 2026-11-03); blog-spam risk. |
| 9 | [r/networking](https://www.reddit.com/r/networking/) | Community | DNS: ECS experiment, three subnets, three answers. | Unverified; expert scrutiny; no link in the title. |
| 10 | [r/LocalLLaMA](https://www.reddit.com/r/LocalLLaMA/) | Community | TOK: "Same 192 characters, 111/133/172 tokens", method included. | Unverified; promotional tone rejected. |
| 11 | [Console.dev](https://console.dev/selection-criteria) | Newsletter | TOK: developer tool; one paragraph. | Editorial, no paid reviews; low acceptance; site ads may count against. |
| 12 | [JavaScript Weekly](https://javascriptweekly.com/) | Newsletter | TOK: JS implementation of the three counts, not a tool list. | Submission method unverified; web links dofollow (2026-09-22). |
| 13 | [Web Tools Weekly](https://webtoolsweekly.com/submit/) | Newsletter | QR: one-line tool suggestion for a web app. | Submit via X/Bluesky DM; no articles (2026-11-03); single DM. |
| 14 | [Frontend Focus](https://frontendfoc.us/) | Newsletter | MD: renderer differences for docs. | Cooperpress editorial; rules unverified. |
| 15 | [Node Weekly](https://nodeweekly.com/) | Newsletter | TOTP: Node crypto walkthrough that reproduces all 18 vectors. | Rules unverified; same editorial risk. |
| 16 | [okhosting/awesome-dns](https://github.com/okhosting/awesome-dns) | Awesome list | DNS: one line in the tools section. | No CONTRIBUTING; list holds self-promoted single-page tools; nofollow. |
| 17 | [CENTRprojects/awesome-dns](https://github.com/CENTRprojects/awesome-dns/blob/main/contributing.md) | Awesome list | DNS: curated for DNS operators. | Requires DNS as main purpose (2026-11-03); multi-tool site likely out of scope. |
| 18 | [awesome-qr-code](https://github.com/make-github-pseudonymous-again/awesome-qr-code) | Awesome list | QR: add under Apps, one-line reason. | One link per PR; 5 votes to merge; https (2026-11-03). |
| 19 | [mundimark/awesome-markdown](https://github.com/mundimark/awesome-markdown) | Awesome list | MD: add to UPCOMING.md first. | 2026 policy: UPCOMING.md, source link, commercial page if ads (2026-11-03). |
| 20 | [Markdown Guide tools](https://www.markdownguide.org/tools/) | Docs/directory | MD: suggest the table generator. | Contribution rules unverified; directory listing, low authority. |

Excluded: V2EX, 阮一峰周刊, AlternativeTo, DevHunt, Product Hunt, free-for-dev, SaaSHub (`2026-09-29-channel-evaluation.md`).

## 3. Four-week order

Asset order: MD → TOK → TOTP → DNS → QR. TOTP ships with TOK in week 2; it is a small extension and gives Qiita a Japanese article.

| Week | Asset | Five targets | Measure |
|---|---|---|---|
| 1 (11-03→11-09) | MD | 3 dev.to, 13 Web Tools Weekly, 20 Markdown Guide, 5 Zenn, 19 mundimark | Referring domains; GSC links; guide sessions; tool clicks. |
| 2 (11-10→11-16) | TOK + TOTP | 4 Qiita, 10 r/LocalLLaMA, 11 Console.dev, 12 JavaScript Weekly, 15 Node Weekly | Same; AI citations against 1,952. |
| 3 (11-17→11-23) | DNS | 9 r/networking, 8 r/devops, 16 okhosting, 17 CENTR, 2 Lobsters | Bing clicks vs 230–344; GSC links; dns-lookup referrals. |
| 4 (11-24→11-30) | QR | 18 awesome-qr-code, 7 r/webdev, 6 GeekNews, 14 Frontend Focus, 1 Show HN | Bing clicks; TOTP share vs 45.1%; referring domains; AI citations. |

Log every submission in `backlink-ledger.csv` with date, channel, source URL, target URL, rel, anchor and status. A nofollow link counts as referral and credibility, not as a ranking gain. Record all four metrics weekly; the table names the primary one.

Review on 2026-12-01 with the same queries and filters: referring domains and GSC links (record only; GSC lags), Bing weekly clicks (230–344 is inside the band), TOTP share (below 40% is progress), AI citations (record only). A missing link is a fact, not a reason to resubmit.

## 4. Do not do

- No paid links, guest posts, exchanges, PBNs or submission services; none before 80 free links.
- No mass DMs or emails; one submission per channel, no follow-up for 14 days. The Web Tools Weekly DM is allowed because its page asks for it.
- No link drops in unrelated threads or "great post, also check my tool" replies.
- No AI-written community posts; HN and Zenn ban them, and GeekNews/Qiita remove promotional or low-quality posts.
- No vote solicitation, multiple accounts, or duplicate posts without a canonical.
- No unsupported claims: no "100% client-side", no "faster than X" without measurement.
- Do not submit the multi-tool site to single-purpose DNS lists; submit a standalone asset only if it exists.

## 2026-11-04 执行记录

- dev.to：2026-11-04 发布五篇，每篇两处链向 `zerotool.dev`，curl 核对 `rel="noopener noreferrer"`（无 nofollow），均已记入 `backlink-ledger.csv`：
  - [Five Markdown Renderers, One Table: Where They Actually Differ](https://dev.to/kassol/five-markdown-renderers-one-table-where-they-actually-differ-509c)
  - [111, 133, 172: The Same 192 Characters in Three Tokenizers](https://dev.to/kassol/111-133-172-the-same-192-characters-in-three-tokenizers-lp)
  - [QR Capacity Is a Mode Problem Before It Is a Size Problem](https://dev.to/kassol/qr-capacity-is-a-mode-problem-before-it-is-a-size-problem-5535)
  - [RFC 6238 by Hand: One TOTP Code, 18 Vectors, and the 32-Byte Key Trap](https://dev.to/kassol/rfc-6238-by-hand-one-totp-code-18-vectors-and-the-32-byte-key-trap-5f5b)
  - [One Domain, Different Answers: Reading Cloudflare and Google DoH JSON](https://dev.to/kassol/one-domain-different-answers-reading-cloudflare-and-google-doh-json-206m)
- 免账号投稿逐项核对后均未执行：Cooperpress 的 Airtable 分享链接返回 “This private share link is no longer available.”；Console.dev 只提供 `hello@console.dev` 邮件；Markdown Guide 需要 GitHub wiki 编辑；Web Tools Weekly 需要 X / Bluesky 私信。按 Sir 2026-11-04 的决定，邮件与其余账号暂不做。
