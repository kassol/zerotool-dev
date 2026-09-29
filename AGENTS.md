# AGENTS.md — ZeroTool

> AI 协作约定，纳入 git 管理。面向 contributor 的公开工程指南见 `CONTRIBUTING.md`。

## 项目概述

ZeroTool（zerotool.dev）— 浏览器端开发者工具的多语言静态站（工具清单以 `src/data/tools.ts` 为准）。
- 纯客户端运算，零账号，零数据上传
- 4 语言：en（默认）/ zh / ja / ko
- 静态构建后部署在 Cloudflare Pages

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Astro 5 | `output: 'static'` + `@astrojs/cloudflare` adapter |
| 内容 | MDX | `@astrojs/mdx` 驱动博客 |
| 第三方脚本 | Partytown（`@qwik.dev/partytown`） | GA4 走 worker 线程，不阻塞主线程；snippet 由 `BaseLayout` 只在加载 GA4 的页面渲染，lib 文件由 `astro.config.mjs` 的 `partytown-lib` integration 复制到 `dist/~partytown/`。AdSense 需直接操作 DOM，走主线程 async 加载 |
| 多语言 | i18n JSON + 路由前缀 | `src/i18n/` + `src/pages/{lang}/*`；工具页路由由 `toolRoutes()` 注入，模式 `/[...lang]/tools/{slug}` |
| 图像 | sharp | 仅构建期使用，生成 OG 图 |
| 部署 | Cloudflare Pages | 项目名 `zerotool-dev`，生产分支 `master` |
| CLI | wrangler | dev 依赖，手工部署兜底 |

零运行时框架（无 React/Vue）。每个工具是单文件 `.astro` 组件 + 内联 `<script>`。

工具页路由不在 `src/pages/` 下：`astro.config.mjs` 的 `toolRoutes()` integration 按 `src/components/tools/registry.ts`（slug → 组件文件名）为每个工具生成一个入口（`.generated/tool-routes/{slug}.astro`，已 gitignore）并 `injectRoute`，一个入口覆盖 4 语言。入口只 import 本工具组件，页面主体在 `src/components/ToolPage.astro`。这样每个工具页只加载共享 CSS + 本工具 CSS；若改回单个 `[slug].astro` 动态路由，Astro 会把全部工具组件的 CSS 打进每一页。

## 目录索引

| 路径 | 职责 | 子 AGENTS.md |
|------|------|:------------:|
| `src/` | 源码主目录 | ✓ |
| `src/pages/` | 首页、工具目录、博客、静态页路由（多语言镜像在 `src/pages/{lang}/`）；工具页路由由 `astro.config.mjs` 的 `toolRoutes()` 注入，不在此目录 | — |
| `src/components/tools/` | 工具交互组件（单文件 .astro）+ `registry.ts`（slug → 组件文件名） | — |
| `.generated/tool-routes/` | `toolRoutes()` 每次 dev/build 生成的工具页入口，已 gitignore，不要手改 | — |
| `src/content/` | Astro Content Collections（blog + tools） | ✓ |
| `src/data/` | tools.ts 注册表 + icons.ts | ✓ |
| `src/i18n/` | UI 文案 JSON + 取词工具 | — |
| `src/layouts/` | BaseLayout / ToolLayout / ArticleLayout | — |
| `src/components/` | 通用组件（SEO、AdUnit、Filter、Search） | — |
| `scripts/` | 构建辅助脚本（OG / 图标校验 / redirects / audit） | ✓ |
| `docs/` | 内部设计 spec 与工程记录 | ✓ |
| `public/` | 静态资源 + 路由元文件（约定见下文「`public/` 约定」） | — |
| `.github/workflows/` | CI/CD | ✓ |

**约定**：
- AGENTS.md 不能放在 `src/content/{collection}/` 下（Astro 会按 collection schema 校验所有 .md 文件），必须放在 collection 父级（`src/content/AGENTS.md`）。
- AGENTS.md 不能放在 `src/pages/` 任何子目录下（Astro 会把 .md 当作页面渲染并写入 sitemap，泄漏内部文档）。路由的工程约定统一记入本文件。
- AGENTS.md 不能放在 `public/` 任何位置（构建时原样复制进 `dist/`，曾以 `/AGENTS.md` 公网可访问）。`public/` 的约定统一记入本文件「`public/` 约定」一节。
- 以上两条由 `scripts/audit.mjs` 的 `no_published_agents_md` 检查兜底，违反即 FAIL。

## `public/` 约定

静态资源 + Cloudflare Pages 路由元文件。`public/` 内容在 build 时原样复制到 `dist/`。

### 文件清单

| 文件/目录 | 作用 | 修改风险 |
|-----------|------|----------|
| `_redirects` | CF Pages 301 规则（旧链接→新链接） | 高：错一行影响 SEO 与外链可达性 |
| `_routes.json` | CF Pages Functions 路由白名单/黑名单 | 高：误配会让所有请求走 Functions，增加冷启动延迟 |
| `ads.txt` | AdSense 出版商声明（IAB 标准） | 中：内容必须与 AdSense dashboard 注册一致，否则广告停投 |
| `robots.txt` | 爬虫规则 + sitemap 指引 | 中：误 disallow 会让 Google 停止索引 |
| `favicon.svg` | 站点图标 | 低 |
| `og/` | 工具与博客 OG 图，均有 4 语言版本（工具 `{slug}.png` / `{slug}-{zh,ja,ko}.png`，博客 `blog-{dir}.png` / `blog-{dir}-{lang}.png`）。构建产物，已 gitignore，由 `scripts/generate-og.mjs` 在 build 时生成 | — 不要手编辑、不要提交，也不要放手工图片；本地 `npm run generate-og` 预览 |
| `og-default.png` | 没有专属 OG 图时的 fallback | 低 |
| `figlet-fonts/` | ASCII 艺术工具用的 figlet 字体 | 低 |
| `vendor/` | 第三方静态资源（如 wasm、字体） | 中 |
| `llms.txt` / `llms-full.txt` | 给 LLM 爬虫的站点摘要 | 低 |

### `_redirects` 规则约定

- 一行一条，格式 `<from> <to> <status>`
- 顺序：人工规则在前，构建后由 `scripts/generate-blog-redirects.mjs` 自动追加博客语言重定向
- **不要手工删除带 STA-编号注释的规则**（这些是历史 SEO 修复，对应 Linear 工单，删除会让旧搜索结果 404）
- 新增 slug 重定向遵循模式：bare slug → `/tools/{slug}/`

### `_routes.json` 约定

```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/", "/_astro/*", "/sitemap.xml", "/blog/*", "/zh/*", "/ja/*", "/ko/*", "/*-*", ...]
}
```

`exclude` 列表是关键：所有静态资源、博客、各语言路径要在这里排除掉，否则会被 Pages Functions 拦截，触发不必要的冷启动。新增静态路径前先确认是否需要追加 exclude。

### `ads.txt` 修改流程

1. 在 AdSense dashboard 拿新 publisher ID（`pub-XXXXXXXXXX`）
2. 改 `public/ads.txt` 为：`google.com, pub-XXXXXXXXXX, DIRECT, f08c47fec0942fa0`
3. 同步改 GitHub secret `PUBLIC_ADSENSE_PUBLISHER_ID` = `ca-pub-XXXXXXXXXX`（注意 `ca-` 前缀）
4. CF Pages 也有 env 副本，同步更新
5. tag 部署后 24-48h AdSense 自动重新校验

### `robots.txt` 当前策略

`Allow: /` + 指向 `https://zerotool.dev/sitemap-index.xml`。如果未来要 noindex 某些路径（如 `/draft/`），在这里加 `Disallow:`。

## 常用命令

```bash
npm run dev          # 本地开发，localhost:4321
npm run build        # 图标覆盖检查 → OG 生成 → astro build → 工具页 CSS 顺序检查 → 博客 redirect 追加
npm run generate-og  # 仅重生成 OG 图（public/og/*.png）
npm run preview      # 用 wrangler pages dev 本地预览 dist/（含 _redirects / _routes.json；astro preview 不支持 Cloudflare adapter）
node scripts/audit.mjs           # 静态一致性巡检（PR 前自检）
node scripts/audit.mjs --quiet   # 仅打印 WARN/FAIL
node scripts/audit.mjs --json    # 机器可读输出
PROJECT_NAME=zerotool-dev bash scripts/deploy.sh   # 手工部署兜底
```

## 部署机制

**触发**：push tag `vX.Y.Z` 到 origin → `.github/workflows/deploy.yml` → CF Pages 部署。
**关键**：日常 `git push origin master` 仅更新仓库，不会上线。要上线必须 tag。

**所需 GitHub secrets**：
- `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
- `PUBLIC_GA4_MEASUREMENT_ID`
- `PUBLIC_ADSENSE_PUBLISHER_ID`、`PUBLIC_ADSENSE_SLOT_TOP`、`PUBLIC_ADSENSE_SLOT_MID`、`PUBLIC_ADSENSE_SLOT_BOTTOM`

**Cloudflare 关联**：
- Pages 项目名：`zerotool-dev`，生产分支 `master`，构建产物 `dist/`
- 域名 `zerotool.dev` 由 Cloudflare DNS 托管
- `public/_routes.json` 限定 Pages Functions 拦截范围（排除 `_astro/*`、各语言路径、blog、sitemap）
- `public/_redirects` 由人工规则 + `scripts/generate-blog-redirects.mjs` 共同维护

## 第三方集成

| 服务 | 集成点 | 修改注意 |
|------|--------|----------|
| Google Analytics 4 | `src/layouts/BaseLayout.astro` 通过 Partytown 加载 `gtag.js`；`window.trackTool(name, action)` 发送 `tool_use` 自定义事件。敏感工具页（`src/data/persistence.ts` 中 policy 为 `disabled` 的 slug，4 语言路由）不加载 `gtag.js`：`ToolLayout` 向 `BaseLayout` 传 `sensitive`，`trackTool` 仍可调用，事件只进本地 `dataLayer` | 新增第三方脚本要同步 `BaseLayout.astro` 中 `partytownSnippet` 的 `forward` 列表 |
| Google Search Console | 域名级验证（Cloudflare DNS TXT 记录） | 切换 DNS 服务商时验证失效，需提前在新 DNS 加 TXT |
| Google AdSense | Auto Ads 主线程 async 加载（Partytown worker 不支持 adsbygoogle.js）；`src/components/AdUnit.astro` 手动广告位：设置了 publisher ID 时，`ToolLayout` 在非敏感工具页渲染 mid（相关工具之后）/ bottom（FAQ 之后）2 个位（`PUBLIC_ADSENSE_SLOT_MID` / `_BOTTOM`），H1 与工具之间不放广告；`ArticleLayout` 在博客文章渲染 top / bottom 2 个位（`PUBLIC_ADSENSE_SLOT_TOP` / `_BOTTOM`）。AdSense 后台 zerotool.dev 的自动广告总开关为关闭（2026-09-29 核实），Auto Ads 不投放，页面只有手动广告位；以后打开自动广告前，先在同一面板（Ads → 站点行的 Edit → Overlay formats）关掉锚定广告与插页广告，广告代码没有关闭开关（`data-overlays` 反而会强制开启锚定广告）；`public/ads.txt` 声明 publisher。敏感工具页（同上 `disabled` slug）不加载 `adsbygoogle.js`，`ToolLayout` 也不渲染 `AdUnit`，`BaseLayout` 也不注入 Partytown snippet | publisher ID 改动必须三处同步：`ads.txt`、env、CF Pages secret |
| Google Ads（投放后台） | 未集成 | 未来要投流量需新增 conversion tag（`AW-` ID） |

## 自动化质量门

| 检查 | 触发 | 阻塞条件 |
|------|------|----------|
| `scripts/check-icon-coverage.mjs` | `npm run build` 第 1 步 | 任何 slug 缺图标 |
| `scripts/audit.mjs` | `.github/workflows/ci.yml` audit job + 手动 | 任何 FAIL（发布目录含 AGENTS.md、schema 漂移、孤儿组件、路由缺失、i18n key 漂移、blog 命名违规等） |
| `scripts/check-tool-css-order.mjs` | `npm run build`（astro build 之后） | 任一工具页的共享工具 CSS（tool-common、ToolLayout、ShareButtons、AdUnit）没有排在本工具 CSS 之前，或 `<head>` 出现内联 `<style>` |
| `npm run build` | `.github/workflows/ci.yml` build job + 手动 | 任何编译错误 |

CI 在 PR 与 master push 时跑 `audit → build`，PR 必须两个 job 都过才能合并。Tag push 触发 `deploy.yml`，已经依赖前面 PR 的 CI 通过。

## 全局规范

1. **新工具清单**：完整步骤见 `CONTRIBUTING.md`「New Tool Checklist」。一句话总结：组件 + `components/tools/registry.ts`（加一行 `'{slug}': '{Name}Tool'`，路由自动注入） + `tools.ts` + `icons.ts` + 4 语言 `content/tools/{slug}/` mdx + 推荐 4 语言博客 + OG 验证 + audit/build + tag 部署。提交前跑 `node scripts/audit.mjs`
2. **i18n 完整性**：`src/data/tools.ts` 的 `translations` 必须含全部 4 语言；缺失会回退 EN，但提交前必须补齐
3. **图标同步**：每个 `tools.ts` 的 slug 必须在 `src/data/icons.ts` 有对应 SVG，`scripts/check-icon-coverage.mjs` 在 build 时校验
4. **博客命名**：博客使用目录结构 `src/content/blog/{base-slug}/{lang}.mdx`（如 `csv-json-guide/zh.mdx`）。旧的 `{base-slug}-{lang}.mdx` 只作为历史 URL 兼容形态，由 `generate-blog-redirects.mjs` 在构建后追加 301
5. **环境变量**：客户端 env 一律 `PUBLIC_` 前缀（Astro 约定），仅写入 `.env.local`（已 gitignore），CI 走 GitHub secrets
6. **敏感信息处理**：publisher ID / GA ID / API token / account ID 不写入任何文档（含本文件）。`.env.example` 仅留空模板。如需举例用 `XXXX` 占位
7. **commit message**：英文，动词开头，遵循 `feat/fix/chore/docs/refactor(scope): description` 格式，与现有历史一致
8. **部署仪式**：build 必须本地通过零错误才能 tag。tag 前先把所有改动 push 到 master，避免 tag 指向未推送的 commit
9. **AGENTS.md 体系**：新增子目录前先建对应 AGENTS.md 定义职责；约定调整先改文档再改代码
10. **工具 slug 重命名**：改 slug 必须同步——`src/data/tools.ts`、`src/data/icons.ts`、`src/components/tools/registry.ts`、`src/content/tools/{slug}/`，并在 `public/_redirects` 为 en + zh + ja + ko 旧路径加 301。若组件文件名也改名，需同步 registry 中的组件文件名。删除工具时 `_redirects` 仍保留指向最相关替代品，避免 404
11. **工具样式隔离**：每个工具页只加载共享 CSS + 本工具 CSS。组件不得依赖其他工具组件的样式；类名用本工具独有的前缀（新前缀先 grep `src/components/tools/` 确认没有被占用）；多个工具共用的规则放 `src/styles/tool-common.css`。脚本里用 `innerHTML` / `createElement` 生成的元素没有 scoped 属性，给它们的规则要写成 `:global(...)`

## 变更日志

- 2026-04-26 — 初始化 AGENTS.md 体系（根 + 6 子目录），梳理 CI/CD、Cloudflare、GA4/GSC/AdSense 集成关系
- 2026-04-26 — 加入 `scripts/audit.mjs` 与 `.github/workflows/ci.yml`；将 `src/content/blog/AGENTS.md` 合并迁移到 `src/content/AGENTS.md` 规避 Astro collection schema 冲突
- 2026-04-27 — 删除 `src/pages/tools/AGENTS.md`（Astro 把 `src/pages/` 下 .md 当作页面渲染，曾以 `/tools/AGENTS/` 公网泄漏并进入 sitemap）；slug 重命名约定上提至「全局规范」第 10 条；目录索引中 `src/pages/tools/` 不再标记子 AGENTS.md
- 2026-05-11 — 新增 `docs/` 内部设计 spec 目录，用于保存实现前的设计决策与验收标准
- 2026-09-23 — 敏感工具页（`persistence.ts` 中 `disabled` 的 slug）跳过 GA4 与 AdSense 脚本及 AdUnit 广告位；由 `ToolLayout` 计算 `sensitive` 传给 `BaseLayout`
- 2026-09-23 — AdSense 脚本移出 Partytown 改为主线程加载，Partytown `forward` 移除 `adsbygoogle`
- 2026-09-23 — 删除 `public/AGENTS.md`（构建时复制进 `dist/`，在 `/AGENTS.md` 公网可访问），内容并入本文件「`public/` 约定」；`audit.mjs` 新增 `no_published_agents_md` 检查
- 2026-09-23 — Partytown 改为只在加载 GA4 的页面注入：移除 `@astrojs/partytown`（它向每页注入 snippet，敏感页也会注册 service worker），改用 `@qwik.dev/partytown`，snippet 与 `forward` 配置移到 `BaseLayout`；`npm run preview` 改用 `wrangler pages dev dist`
- 2026-09-25 — `public/og/` 移出 git（`.gitignore` + `git rm --cached`），作为构建产物由 `generate-og.mjs` 在 build 时生成；此前提交的 661 张图中 650 张在 CI build 时被重新生成覆盖，git 里的版本从未上线；另 11 张无对应工具/博客、无页面引用的旧图此前随 checkout 部署，今后不再部署。CI 与 deploy workflow 在 build 前安装 `fonts-noto-cjk`，修复 zh/ja/ko 博客 OG 图显示方框
- 2026-09-25 — 工具 OG 图按语言生成：zh/ja/ko 工具页的 og:image 由 `ToolLayout` 指向 `/og/{slug}-{lang}.png`（此前 414 页共用英文图），`generate-og.mjs` 从 `tools.ts` 解析 4 语言 name/description 并本地化底部 badge；连字符文件名落在 `_routes.json` 的 `/*-*` 排除内
- 2026-09-26 — `tool-common.css` 的 `.tool-widget` 表单 fallback 焦点规则排除 `.tool-input` / `.tool-textarea`（此前其优先级更高，吃掉共享类聚焦时的 1px 主色内描边）；`BaseLayout` 暗色 token 块加 `color-scheme: dark`（原生滚动条与控件跟随暗色）；`ShareButtons` 的 `/vendor/qrcode.min.js` 改为首次打开微信分享弹窗时加载，不再在每个工具页同步加载
- 2026-09-26 — 工具页改为每个工具一个注入路由（`astro.config.mjs` 的 `toolRoutes()`，入口生成到 `.generated/tool-routes/`），删除 4 个 `tools/[slug].astro`；`registry.ts` 改为 slug → 组件文件名的数据映射；页面主体移到 `src/components/ToolPage.astro`。工具页首屏 CSS 从全部工具的 516KB 降到共享 + 本工具（抽样 37–45KB）。修复拆分后暴露的 6 组跨工具样式依赖（jwt-decoder、timestamp-converter、regex-tester、css-clip-path-generator、markdown-table-generator / meta-tag-generator、15 个用 `.btn-sm` 的工具），text-case / regex-tester / color-palette-generator / markdown-table-generator 的类名前缀改为 `tcase-` / `rgx-` / `cpal-` / `mdt-`，`.btn-sm` 移入 `tool-common.css`；新增全局规范第 11 条。`npm run build` 新增 `check-tool-css-order.mjs`
- 2026-09-26 — `astro.config.mjs` 设 `build.inlineStylesheets: 'never'`：打包 CSS 全部外链（此前小于 4KB 的 chunk 被内联，且相邻内联块会合并，CSS 顺序检查看不到块内顺序）。代价：工具页 CSS 请求 2–3 → 4 个（多出 69B 的 AdUnit 样式与 <4KB 的工具样式），博客文章页 2 → 3 个，首页、工具目录、about 不变；原始字节不变，gzip（按文件分别压缩）每页 +0–59B。`check-tool-css-order.mjs` 断言工具页 `<head>` 无内联 `<style>`
- 2026-09-26 — 博客列表（4 语言 index、首页最新 3 篇、文章页相关文章）同日文章按目录名升序作次级排序，结果不再随内容读取顺序变化；markdown-table-generator 去掉借自 meta-tag-generator 的两栏 grid（改回组件本身的单列）；timestamp-converter 结果行改由组件自有 `.tc-row` / `.tc-label` / `.tc-value` 规则（`.tc-results :global(...)`）生效，删除借自 text-case 的纵向排列规则
- 2026-09-27 — Partytown `forward` 由 `dataLayer.push` 改为 `gtag`，worker 内脚本改为 `window.gtag = function gtag() {...}`。原因：主线程 push 的 `arguments` 对象被 Partytown 序列化成普通对象，worker 里的 gtag.js 只处理 `arguments` 形式的命令，`tool_use` 事件全部丢失（此前 28 天计数为 0）。转发 `gtag` 后由 worker 端重建 `arguments`；Partytown 就绪前的调用由 snippet 排队。页面隐藏时不出现 `user_engagement`：主线程加载 GA4 的对照站（developers.google.com/analytics）在同样操作下也不发，属 GA4 自身行为（互动时长以 `_et` 附在其他事件上），与 Partytown 无关
- 2026-09-27 — 404 页（`src/pages/404.astro`）加路径规范化：Unicode 连字符（U+2011 等）换成 `-`、去掉尾随标点后 `location.replace` 重试一次（规范化幂等，不会循环）；来源是 AI 助手 / 聊天软件复制出的链接，GA 28 天 404 浏览约一半属于这类。`_redirects` 为 STA-585 删除的重复 slug（csv-to-json / yaml-to-json / string-to-slug）补 zh/ja/ko 工具路径与 4 语言博客 guide 的 301（原先只有英文工具路径）。html-to-markdown / markdown-preview / markdown-to-word 的 mdx 里 `<code>[x](url)</code>` 被 MDX 渲染成真链接 `href="url"`，改为 `{'[x](url)'}` 字面量
- 2026-09-27 — issue #27 backlog 批量处理：移动端（≤640px）触控目标统一到至少 44px（`.tool-input`、`.btn-copy`、`.btn-sm`、`.share-btn`、包裹单选 / 复选框的 label 行；label 规则用 `:where()` 零优先级，工具自己的 display / 对齐仍生效），桌面端尺寸不变，`DESIGN.md` 写明约定；pixelate-image 删掉把格式下拉框钉在 40px 的组件规则。color-shades-generator 色块文字色改用 WCAG 对比度判定（同 color-palette-generator），加 `test-color-shades-generator.mjs`。gif-splitter 进度条改按已解码与已绘制像素计（`createCompositor().progress()`），单张大帧解码时也前进。所有工具页共享的 CSS chunk 仍按 Astro 默认取第一个工具名（`aes-encrypt-decrypt.*.css`）：改名需要约 30 行依赖 Astro 内部 CSS 命名顺序的 `manualChunks`，收益只是文件名，不做。`public/_redirects` 删掉 4 条重复来源路径，`audit.mjs` 新增 `redirects_unique_source` 检查。pixelate-image 的 GIF 说明加到 gif-splitter 的链接（FAQ 答案按纯文本渲染，链接放在「限制」段，FAQ 写工具名）；openapi-to-typescript 博客删掉 schema 外的 `heroImage`
- 2026-09-27 — 博客相关文章改为按相关度选（`ArticleLayout.astro` 的 `selectRelatedPosts`，测试 `scripts/test-related-posts.mjs`）：同语言内按共同标签数打分，超过半数文章都有的标签（`developer-tools` / `开发者工具`）不计分；两篇都是 `{toolSlug}-guide` 且工具同分类再 +1；同分按发布时间差、再按目录名排序，不足 3 篇按发布时间补齐。此前按「任一共同标签 + 最新优先」，124 篇英文文章都带 `developer-tools`，几乎每篇都链向最新 3 篇。dist 统计英文博客页站内入链（排除博客列表页、自身各语言版本，只计 `<main>` 内链接）：零入链 114 → 3 篇，最大 124 → 12，中位数 0 → 3。工具页在当前语言有 `src/content/blog/{slug}-guide/{lang}.mdx` 时，于工具面板下方显示「阅读指南」卡片（`ToolPage.astro` 查找、`ToolLayout.astro` 的 `.tool-guide-link` 渲染，i18n key `tool.readGuide`），每种语言 117 个工具页有该链接。移动端 44px 收尾：csp-header-generator、dns-lookup、image-color-palette、meta-tag-generator、wifi-qr-code-generator 的下拉框加 `.tool-input` 并删掉组件里的 `min-height: 40px`（桌面端计算样式不变）；favicon-generator、html-minifier 的下拉框（组件没设 font-family，加 `.tool-input` 会变成等宽字体）与 json-to-csv 的分段按钮在组件的 ≤640px 规则里设 44px
- 2026-09-27 — 工具与指南的对应关系收敛到 `src/data/guides.ts` 的 `guideDirFor()`：默认 `{slug}-guide`，4 个目录名不同的已发布指南（aspect-ratio / lorem-ipsum / number-base / url-encode）走 `guideDirOverrides`。工具页「阅读指南」卡片与相关文章同分类加分都用它，此前这 4 个工具页没有指南链接、其中 2 篇指南零入链
- 2026-09-27 — 工具页正文表格在 ≤640px 改为 `display: block; overflow-x: auto`（`ToolLayout.astro` 的 `.tool-content :global(table)`），宽表格在自身框内横向滚动，不再撑宽页面（此前 text-case 溢出 4px、keycode-explorer 12px）；桌面端表格仍撑满正文宽度
- 2026-09-27 — 移动端密集小控件至少 24px（WCAG 2.2 AA 2.5.8），主要输入框和按钮仍为 44px，约定写入 `DESIGN.md`。390px 下低于 24px 的控件在各自组件的 ≤640px 规则里调到 24px：csp-header-generator 来源标签的 ×、css-variables-generator 的 ×、robots-txt-generator 的两种 ✕（24×24）、css-filter-generator 的 Reset、css-to-tailwind 的「Coverage notes」summary、qr-code-decoder / wifi-qr-code-generator 的「QR Code Generator →」交叉链接；桌面端尺寸不变。不改：color-converter / eyedropper-color-picker 的隐藏 `input[type=color]`（可见的 44px label 是点击目标）、markdown-preview 预览区内的链接（句内链接）与 disabled 任务复选框
- 2026-09-28 — 404 页的语言切换改为跳各语言首页（`BaseLayout` 新增 `langHomeOnly` prop，`404.astro` 传入）：此前按路径拼出 `/zh/404/` 等不存在的页面，GA 28 天有 2 次 `/zh/404/` 的 404 浏览
- 2026-09-28 — 新增 gif-compressor（image 类，持久化 `preference`，只存有损程度 / 颜色数 / 抽帧 / 抖动）。GIF 解码器从 `GifSplitterTool.astro` 引擎块原样复制（两个组件都是单文件 `is:inline` 脚本，抽共享模块要把 gif-splitter 改成打包脚本），`scripts/test-gif-compressor.mjs` 逐个声明比对两份源码，改一边必须同步另一边。gif-splitter 的 relatedSlugs 用 gif-compressor 替换 pixelate-image
- 2026-09-28 — 新增 image-splitter（image 类，持久化 `preference`，只存切割与导出设置，图片不落盘）。三种模式：行列等分（切线 `round(i × W / n)`，原尺寸输出）、按像素尺寸（外边距 / 间距，雪碧图）、Instagram 主页网格 / 轮播（1080 宽，裁剪或留边，按发布顺序编号）。原图上限沿用 gif-splitter 的 5000 万像素、单边 16,384 px，单块切片受 16,777,216 像素 canvas 上限约束。`crc32` / `zipStore` 从 `GifSplitterTool.astro` 原样复制，`scripts/test-image-splitter.mjs` 比对两份源码
- 2026-09-29 — 暂停新增工具，冻结期内只做已有页面的改版与精校。恢复条件与冻结期规则见 zerotool-forge skill 的 Phase 0
- 2026-09-29 — 站点层面改版：工具页去掉 H1 与工具之间的 top 广告位（`ToolLayout.astro`），H1 下直接是工具，mid / bottom 保留；博客文章的 top / bottom 不变，`PUBLIC_ADSENSE_SLOT_TOP` 仍由 `ArticleLayout` 使用。Auto Ads 的锚定 / 插页广告代码侧无法关闭（Google 文档：`data-overlays` 会在后台已关闭时重新开启锚定广告；`data-google-vignette="false"` 只挡单个链接触发，挡不住切回标签页、返回键等附加触发）；核实后台发现自动广告总开关本就关闭，锚定 / 插页广告不投放，无需改动。隐私说法按实际改写：页脚 `footer.tagline` 去掉「no tracking」，改为「无需注册；工具处理的数据留在浏览器里、不上传」；About（4 语言）新增「哪些数据留在设备上 / 统计与广告 / 开源」三段，敏感工具清单由 `persistence.ts` 的 `disabledPersistenceSlugs` 生成，并写明 DNS 查询与二维码解码 URL 模式会联网；隐私页（4 语言）补 AdSense 与广告 Cookie、删去「不设第三方广告 Cookie」与 GA4「IP 匿名化 / 会话 Cookie」的失实描述；`public/llms.txt` / `llms-full.txt`、color-contrast-checker 指南、favicon-generator 说明同步改掉「no tracking」类说法。页脚与 About 链接 GitHub 仓库，新增 i18n key `footer.github`。zero-width-character-detector 的工具说明、指南、`tools.ts` 描述与组件示例按一手来源改写：Tag 字符的已知风险是 ASCII smuggling（隐藏的提示注入指令，出处 Johann Rehberger 的 ASCII Smuggler，原先误署为 Joseph Thacker），OpenAI 没有公开说过用 Tag 字符给 ChatGPT 输出加水印；指南中「RFC 5198 废弃 Tag 块」的错误出处改为 RFC 2482 与 Unicode 码表。会联网的工具集中在 `src/data/network.ts` 的 `networkToolSlugs`（dns-lookup、qr-code-decoder 的 URL 模式、markdown-preview 的图片、meta-tag-generator 的预览图），这些工具页顶部不再显示「数据不离开浏览器」，改为 i18n key `network.{slug}` 写明发出什么、发给谁；About 的联网工具清单用同一份数据生成；meta-tag-generator FAQ 的「数据不离开浏览器」同步改正。zero-width 工具说明另修：ko 把 U+202D 误作「从右到左」（实为 LRO），zh/ja 把「跟踪像素」列为复制文本的风险，zh/ja/ko「仅清零宽字符」模式的字符范围与代码不符
- 2026-09-29 — 博客 frontmatter `noindex` 补全效果（为指南审计准备，用法见 `src/content/AGENTS.md`「noindex」）：`SEO.astro` 的 robots 由 `noindex,nofollow` 改为 `noindex,follow`，noindex 指南指向工具页的链接照常传递（另一个用到 noindex 的页面是 404，它不需要 nofollow，同样改为 follow）；noindex 的语言版本移出 sitemap（`astro.config.mjs` 的 sitemap `filter`）与其他语言版本的 sitemap alternate；其他语言版本的 hreflang 不再指向它，noindex 页面自己不输出 hreflang（404 页此前输出指向不存在的 `/zh/404/` 等的 hreflang，一并去掉）。判定集中在 `src/data/blog-index.mjs`，sitemap 侧 frontmatter 改用 js-yaml 解析（lastmod 与原正则提取逐篇一致），测试 `scripts/test-blog-index.mjs`。`audit.mjs` 不加 dist 检查：CI 的 audit job 在 build 之前运行，没有 dist
- 2026-09-29 — secret-redactor 按页面质量标准精品化（首批 4 个中的第 1 个）。90 天内工具页与指南都没有 GSC 曝光，title 用词按 SERP 与 Trends 选：en「Redact API Keys」（`tools.ts` name 改为 Redact API Keys & Secrets）、zh「API Key 脱敏」、ja「APIキー マスキング」、ko「API 키 마스킹」，zh/ja/ko title ≤ 30 字符（含后缀）。4 语言工具页正文重写：用法、两组由引擎实际跑出的输入 / 输出示例（各语言用本地场景：CI 日志与 docker-compose / Spring Boot 与钉钉 Webhook / LINE Bot 与 Chatwork / 네이버 API 与 Spring 설정）、与 gitleaks 和 GitHub Actions `::add-mask::` 的差异、限制；格式与规范都链到一手出处；zh/ja/ko 各加一张本地服务凭据能否识别的表（飞书 Webhook 路径令牌、企业微信 `key=`、kintone `X-Cybozu-Authorization`、카카오 `KakaoAK` 头识别不到，写明手动处理）。组件把类别开关移到输出框下方、输入框 8 行改 6 行，390×844 下复制按钮进入首屏。relatedSlugs：secret-redactor ↔ env-file-parser ↔ jwt-decoder 互相指向。指南 `secret-redactor-guide` 按审计规则第 2 步 4 语言 `noindex: true`（有信息型目标词但量级不达标，90 天非 `site:` 曝光 0），开头的虚构场景改为明示是常见情形
- 2026-09-29 — gif-compressor 按页面质量标准精品化（首批 4 个中的第 2 个）。90 天内工具页与指南没有 GSC 曝光，title 用词按 Trends（12 个月）与 SERP 选：en「GIF Compressor」（高于 compress gif）、zh「GIF 压缩」、ja「GIF 圧縮」、ko「GIF 용량 줄이기」（高于 GIF 압축，`tools.ts` ko name 同步改名）。组件把结果区（体积对比 + 下载按钮在前，预览在后）移到文件信息下方、设置之上，进度条移到文件信息下并加 aria-label；390×844 与 1366×900 下载入 GIF 后「下载」都在首屏（改后底边 y=821 / 557；改前 390×844 下在 y=2113–2157）。4 语言工具页正文重写：用维基共享资源上可下载的 3 个真实 GIF（旋转地球、牛顿摆、VisualEditor 录屏）写出尺寸、帧数、压缩前后字节数与耗时；与 gifsicle 1.93（`-O3 --lossy=80`）按 ffmpeg SSIM 对比体积并给出复现命令；限制段用 lazygit README 的演示 GIF（6320 万像素）说明超限；各语言用本地平台上限（公众号素材 10M、Qiita 单张 10MB、Zenn GitHub 连携 3MB、네이버 블로그 사진 20MB、GitHub 10MB，均链官方文档）。原 FAQ 与设置表里无出处的「231 帧录屏」数字换成上述文件的实测值。relatedSlugs：image-compressor 追加 gif-compressor、gif-splitter，与 gif-splitter、gif-compressor 组成互指的一组。指南 `gif-compressor-guide` 按审计规则第 2 步 4 语言 `noindex: true`（有信息型目标词，如 how gif compression works，量级不达标，90 天非 `site:` 曝光 0）
- 2026-09-29 — zero-width-character-detector 按页面质量标准精品化（首批 4 个中的第 3 个）。4 语言工具页与指南 90 天内都没有可见的非 `site:` 查询（en 工具页 15 次曝光全为匿名查询），title 用词按 Trends（12 个月）与 SERP 选：en「Invisible Character Detector」（`tools.ts` en name 同步改名，高于 zero width character detector）、zh「零宽字符检测」（zh SERP 以零宽隐写为主，正文说明本工具只检测不解码）、ja「見えない文字」（name 改为「見えない文字検出ツール」）、ko「보이지 않는 문자」（「공백 문자」的搜索意图是复制空白字符，不用；name 改为「보이지 않는 문자 감지기」）。组件：检测范围改为 Unicode 18.0 `DerivedCoreProperties.txt` 中 Default_Ignorable_Code_Point 的全部 4,174 个码点（新增 ALM U+061C 使双向类等于 PropList 的 Bidi_Control 全集，另补 U+115F / U+1160 / U+FFA0 韩文填充符、U+034F、U+17B4–17B5、蒙古文自由变体选择符、U+206A–206F 与保留码点）；引擎块加 `engine:start/end`，新增 `scripts/test-zero-width-character-detector.mjs`（逐码点比对 U+0000–U+10FFFF）；状态行与「复制清理后的文本」按钮移到输入框正下方，390×844 下按钮底边 y=820（改前 1164），1366×900 下 638（改前 1083）；「隐藏的 Tag 文本」示例改为带家庭 emoji 的聊天回复，演示「仅 Tag」保留 ZWJ 序列。4 语言正文重写：en 用 Tag 字符提示注入（金丝雀词 BANANA）与 Trojan Source `stretched-string.js`、zh 用零宽指纹（Zach Aysan 2017）与简历里的 Tag 指令、ja 用 PowerPoint 复制后 Shift_JIS 保存出「?」（Qiita）与询价邮件里的 Tag 指令、ko 用「공백 문자」U+3164 通过 `trim()` 与 RLO 文件名（MITRE ATT&CK T1036.002）；差异点按 2026-09-29 实测写明：Invisible Character Viewer 的一键清除把 👨‍👩‍👧 拆成 👨👩👧，ASCII Smuggler 能解码但不给清理后文本；限制段写明有宽度的空格（U+00A0、U+202F、U+3000、U+2800）不检测、emoji 旗帜的 Tag 字符会被清除、10 万个不可见字符约 10 秒才画完。relatedSlugs：zero-width ↔ string-escape ↔ unicode-text-converter 互指，secret-redactor 保持指向本工具。指南 `zero-width-character-detector-guide` 按审计规则第 2 步 4 语言 `noindex: true`（信息型目标词 ascii smuggling / invisible unicode characters 量级不达标，90 天非 `site:` 曝光 0），并按第 5 步删改无出处或错误的陈述：Word / Google Docs / Slack / Notion 插入不可见字符、Polyfill.io 用不可见字符、URL 解析器拒绝 ZWSP、Notepad 总写 BOM、不存在的「码点频次」与字节偏移功能、「四个」清除挡位、128 个可打印 ASCII、同类工具的无出处描述（改为实测对比）、String Escape 与 Unicode Text Converter 的功能描述
