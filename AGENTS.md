# AGENTS.md — ZeroTool

> AI 协作约定，纳入 git 管理。面向 contributor 的公开工程指南见 `CONTRIBUTING.md`。

## 项目概述

ZeroTool（zerotool.dev）— 100 个浏览器端开发者工具的多语言静态站。
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
| Google AdSense | Auto Ads 主线程 async 加载（Partytown worker 不支持 adsbygoogle.js）；`src/components/AdUnit.astro` 手动广告位：设置了 publisher ID 时，`ToolLayout` 在非敏感工具页渲染 top / mid / bottom 3 个位（slot ID 来自 `PUBLIC_ADSENSE_SLOT_*`）；`public/ads.txt` 声明 publisher。敏感工具页（同上 `disabled` slug）不加载 `adsbygoogle.js`，`ToolLayout` 也不渲染 `AdUnit`，`BaseLayout` 也不注入 Partytown snippet | publisher ID 改动必须三处同步：`ads.txt`、env、CF Pages secret |
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
