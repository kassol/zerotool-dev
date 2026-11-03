# 2026-11-03 技术 SEO 与 gif-compressor TBT 审计

> 2026-11-03 修复记录（随 v1.142.12）：12 个短别名（24 条 301）与 `robots.txt` / `ads.txt` / `favicon.svg` / `vendor/*` / `~partytown/*` 已加入 `_routes.json` exclude，24 条全部恢复 301；sitemap 不再给非博客 URL 写构建时间 `lastmod`（661 条 URL、69 条博客 lastmod、非博客 0）；`WebApplication` 补 `url`；noindex 博客不再输出 Article/Breadcrumb；Article 补 `mainEntityOfPage`。下方审计数字保留修复前快照，TBT 与广告位建议未实施。

审计对象：v1.142.11 构建（`dist/`，2026-11-03 14:19，845 个 HTML、652 条 sitemap URL）。本地核对用 `wrangler pages dev dist`（127.0.0.1:8791），生产核对用 `curl https://zerotool.dev`。审计期间 `dist/` 于 14:54 被另一构建清空，下列数字均取自清空前的同一份构建。

## 1. Sitemap

| 类别 | URL 数 |
|---|---|
| 工具页 `/tools/{slug}/` | 141 × 4 = 564 |
| 工具目录 `/tools/` | 1 × 4 = 4 |
| 静态页（首页、about、contact、privacy、terms） | 5 × 4 = 20 |
| 博客（含 4 个列表页） | en 37 / ja 20 / ko 5 / zh 2 = 64 |
| 合计 | 652 |

- 652 条全部以 `/` 结尾；0 条无尾斜杠变体；0 条在 sitemap 里却又是 `_redirects` 的来源（1,998 条规则逐条比对）。
- 0 个 noindex 页面进入 sitemap：845 个 HTML − 193 个 noindex = 652，与 sitemap 一一对应，无多余、无遗漏。
- `lastmod` 是构建时间：591 / 652 条（91%）为 `2026-11-03T06:19:00.79xZ`，来自 `astro.config.mjs:153` 的 `item.lastmod = new Date()`；只有博客正文用 frontmatter 日期（`astro.config.mjs:149`）。其中 588 条非博客 URL（564 工具页 + 24 静态/目录）时间戳几乎完全相同。
- 633 / 652 条带 `xhtml:link` 语言备选；19 条单语言博客没有，因为 `astro.config.mjs:144-147` 只在 `links.length > 1` 时写入。

## 2. Hreflang

- 588 个非博客可收录页（564 工具页 + 20 静态 + 4 工具目录）输出 `en/zh/ja/ko` + `x-default`（`SEO.astro:96-100`）。
- 博客按 `blogAlternates()` 只列可收录语言，`x-default` 仅在 EN 可收录时给出（`SEO.astro:78-86`）；19 条单语言博客因此没有 `x-default`。
- 全站逐页比对：0 条指向不存在的 URL，0 条指向 noindex 页面，0 对不互指。
- 193 个 noindex 页面与 404 不输出任何 hreflang（`SEO.astro:67`），与 sitemap 过滤一致。

| 样本 | hreflang |
|---|---|
| `/tools/gif-compressor/` 四语（`dist/tools|zh|ja|ko/tools/gif-compressor/index.html`） | en, zh, ja, ko, x-default（四语文件完全相同） |
| `/tools/`、`/about/` 四语 | en, zh, ja, ko, x-default |
| `/blog/mime-type-lookup-guide/`（zh/ja/ko 为 noindex） | en, x-default |
| 上述指南的 `zh` 版本 | 无（页面本身 noindex，0 条 hreflang） |
| 19 条单语言博客 | 仅该语言，无 x-default |

结论：hreflang 无缺陷；唯一取舍是单语言博客缺 `x-default`（Google 视为可选）。

## 3. Canonical

10 页抽样，全部自指、均带尾斜杠：

| 页面 | canonical |
|---|---|
| `/`、`/tools/`、`/about/`、`/terms/` | 自身 |
| `/tools/gif-compressor/` 与 zh/ja/ko 版本 | 各自自身 |
| `/blog/mime-type-lookup-guide/`、`/zh/blog/mime-type-lookup-guide/` | 各自自身 |
| `dist/404.html` | `https://zerotool.dev/404/`（该路径不存在；页面本身 noindex） |

- 845 页中 844 页自指，0 个 canonical 指向某个 301 来源。
- `/protobuf`、`/tools/css`、`/tools/AGENTS` 生产与本地均返回 301（→ `/tools/protobuf-to-json/`、`/tools/`、`/tools/`），v1.142.10 的排除仍生效（`public/_routes.json:16-18`）。
- 同类问题另有 12 条路径未修，返回 200（见第 6 节）。它们的 canonical 指向正确目标，不构成索引错误。

## 4. 结构化数据

| 页面类型 | JSON-LD | 页数 |
|---|---|---|
| 工具页（4 语） | WebApplication + FAQPage + BreadcrumbList | 564 |
| 博客文章（含 noindex） | Article + BreadcrumbList | 252 |
| 首页（4 语） | WebSite | 4 |
| 404、`/tools/`、`/blog/`、about/privacy/terms/contact（各 4 语） | 无 | 25 |

来源：`ToolLayout.astro:57-70`（WebApplication，`applicationCategory: UtilityApplication`、`offers.price: "0"`）、`:72-79`（FAQPage）、`:85-103`（BreadcrumbList）；`ArticleLayout.astro:92-134`；`index.astro:15-19`。

- 0 页出现重复 `@type`，0 个块 JSON 解析失败；FAQPage 的 `mainEntity` 为 4–7 条，无空数组。
- 无非法嵌套：FAQPage 与 WebApplication 同级分开，Article 的 `publisher` 是内联 Organization。
- 缺口 1：WebApplication 没有 `url`，canonical 已在 HTML 里但 schema 未引用。
- 缺口 2：Article 缺 `mainEntityOfPage`。
- 缺口 3：192 个 noindex 博客页仍输出 Article + BreadcrumbList（占全站 28%）。noindex 下不会产生富结果，只多付字节。
- 缺口 4：`/tools/` 与 `/blog/` 两个目录页没有任何 JSON-LD（含 BreadcrumbList）。

## 5. gif-compressor 的 TBT

`dist/tools/gif-compressor/index.html`：132,541 B HTML（`<` 计数 1,282）、13 个内联 `<script>`（10 个 JS 共约 78 KB、3 个 JSON-LD）、4 个阻塞样式表（52.3 KB 原始 / 10.4 KB gzip）、33 个 `.zt-tip` 按钮、无 webfont、无 preconnect。

内联脚本（字节）：58,447 工具引擎（`GifCompressorTool.astro:243` 起 `is:inline`）、7,058 持久化策略、4,330 分享、2,471 导航，其余 6 块 2,288 / 1,649 / 844 / 691 / 319 / 205，JSON-LD 3 块共 3,913 B。

生产页 138,045 B，比本地多：`adsbygoogle.js`（2 个 `<ins class="adsbygoogle">`，页面另有 2 个 `push({})`）、GA4 `gtag.js`（181,581 B gzip / 542,002 B 原始）、9 处 Partytown 引用。本地 `dist/` 没有 GA 与 AdSense（构建未设 `PUBLIC_*`），用它复测会低估；467 ms 只能来自带环境变量的构建或生产页。

| # | 主线程贡献者 | 证据 | 置信 |
|---|---|---|---|
| 1 | adsbygoogle.js + 2 个广告位 | 生产 HTML 的 2 个 `<ins>`；`BaseLayout.astro:148-178` 在 DOMContentLoaded + 2×rAF + `requestIdleCallback(timeout:1000)` 注入，落在 TBT 统计窗（FCP→TTI）内；`AdUnit.astro:29-30` 有 2 次 `push({})` | 高 |
| 2 | ~78 KB 首方内联 JS 在解析期同步执行，10 个内联 JS 块，无 defer | 上表字节数；`is:inline` 在 body 解析时即运行 | 中高 |
| 3 | 138 KB HTML + 52 KB CSS 的解析 / 样式 / 布局 | 标签数约 1,282；4 个 `<link rel=stylesheet>`（site、tool-shared、adunit、gif-compressor） | 中 |
| 4 | gtag.js（542 KB 原始） | 走 Partytown worker（`BaseLayout.astro:185-191`），主线程只剩 snippet 与 `gtag` 转发；worker 启动仍有成本 | 低 |
| 5 | 工具自身初始化 | 排除：脚本尾部只有 `loadPrefs()` + `applyPrefsToUI()` + 约 20 个监听器 + 1 个 MutationObserver（`GifCompressorTool.astro:1780-1806`）；载入不解码 GIF，2 个预览 `<img>` 无 `src` | 排除 |

修复清单（按收益排序）：

| 优先 | 修复 | 工作量 | 风险 |
|---|---|---|---|
| P1 | 广告位改为进入视口或首次交互后挂载 / `push`，或去掉工具页 mid 位（`ToolLayout.astro:304`、`:323`） | 0.5–1 天 | 中（收入、AdSense 政策） |
| P2 | 58 KB 引擎从 `is:inline` 改为打包 defer / module，或延迟到 `requestIdleCallback` 再初始化 | 1–2 天 | 中（`scripts/test-early-input.mjs` 要求脚本运行前的输入也生效） |
| P3 | 为 `pagead2.googlesyndication.com`、`www.googletagmanager.com` 加 preconnect | 10 分钟 | 低（改善 LCP，不影响 TBT） |
| P4 | 合并 10 个内联 JS 块，删掉重复的小 IIFE | 0.5 天 | 低 |

## 6. `_routes.json` 与 301

`public/_routes.json` 有 20 条 exclude：`/`、`/_astro/*`、`/sitemap.xml`、`/blog/*`、`/zh/*`、`/ja/*`、`/ko/*`、`/*-*`、`/base64`、`/chmod`、`/g`、`/protobuf`、`/tools/AGENTS`、`/tools/css`、`/slugify`、`/llms.txt`、`/index.md`、`/categories.md`、`/about.md`、IndexNow 密钥。

与 1,998 条 301 逐条比对：1,974 条返回 301；24 条（12 个路径 × 有/无尾斜杠）返回 200，响应体是目标页（生产同样如此，`cf-cache-status: DYNAMIC`）。

| 路径（`public/_redirects` 行号） | 目标 |
|---|---|
| `/tools/sha256`（201-202） | `/tools/hash-generator/` |
| `/tools/uuid`（221-222）、`/tools/guid`（225-226） | `/tools/uuid-generator/` |
| `/tools/webp`（249-250）、`/tools/totp`（271-272） | `/tools/webp-converter/`、`/tools/totp-generator/` |
| `/tools/openapi`（285-286）、`/tools/jsonpath`（343-344） | `/tools/openapi-validator/`、`/tools/jsonpath-tester/` |
| `/tools/htaccess`（361-362）、`/tools/htpasswd`（367-368） | `/tools/htaccess-generator/`、`/tools/htpasswd-generator/` |
| `/tools/ulid`（373-374）、`/tools/hmac`（581-582） | `/tools/ulid-generator/`、`/tools/hmac-generator/` |
| `/tools/yamllint`（295-296） | `/tools/yaml-validator/` |

`dist/_redirects` 已 1,998 条，接近 Cloudflare Pages 的 2,100 条静态规则上限（AGENTS.md 2026-10-01 条目记录），后续再加别名前应先合并同类规则。

实验（`dist` 临时副本，仓库未改）：

1. 给 `/tools/sha256` 加一条 exclude → `/tools/sha256` 与 `/tools/sha256/` 都变 301。
2. 删掉那两条规则 → `/tools/sha256` 301 到 `/tools/sha256/`，后者 404。

即：请求被 Functions 接住后，规则以 200 重写返回；加 exclude 让它回到静态层按 301 处理。12 个路径都不在 sitemap 里，canonical 指向正确目标，属于「重复 URL + 浪费抓取」。

未排除的 28 个来源里，24 个（12 个路径的两种写法）返回 200；其余来源（含 `/g`、`/g/`）正常 301。说明「被 Functions 接住」本身不必然破坏规则，这 12 条是唯一失败的一组，具体触发条件未查明。

其他被 Functions 接住的静态资源（生产 200 + DYNAMIC）：`/robots.txt`、`/ads.txt`、`/favicon.svg`、`/vendor/{bcryptjs,nanoid,protobuf,qrcode,turndown}.min.js`、`/~partytown/partytown.js`；`/_redirects`、`/_routes.json`、`/_headers` 返回 23,340 B 的 404 页。`/sitemap-index.xml` 由 `/*-*` 覆盖。EN 工具页走 Functions（`/tools/*` 未排除），但三次采样 TTFB 与已排除的 `/zh/tools/...` 无差别（1.12–1.22 s 对 0.98–1.22 s），无可归因的冷启动证据。

## 优先修复

| 优先 | 修复 | 工作量 | 风险 |
|---|---|---|---|
| P1 | 12 条短别名加 `_routes.json` exclude，回归 24 条 301（第 6 节） | 30 分钟 | 低 |
| P2 | 工具页广告位延迟挂载或去掉 mid 位（第 5 节） | 0.5–1 天 | 中 |
| P3 | sitemap `lastmod` 改用内容日期（第 1 节） | 2 小时 | 低 |
