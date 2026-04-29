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
| 第三方脚本 | Partytown | GA4 + AdSense 走 worker 线程，不阻塞主线程 |
| 多语言 | i18n JSON + 路由前缀 | `src/i18n/` + `src/pages/{lang}/*` |
| 图像 | sharp | 仅构建期使用，生成 OG 图 |
| 部署 | Cloudflare Pages | 项目名 `zerotool-dev`，生产分支 `master` |
| CLI | wrangler | dev 依赖，手工部署兜底 |

零运行时框架（无 React/Vue）。每个工具是单文件 `.astro` 组件 + 内联 `<script>`。

## 目录索引

| 路径 | 职责 | 子 AGENTS.md |
|------|------|:------------:|
| `src/` | 源码主目录 | ✓ |
| `src/pages/tools/` | 工具路由入口（多语言镜像在 `src/pages/{lang}/tools/`） | — |
| `src/components/tools/` | 工具交互组件（单文件 .astro） | — |
| `src/content/` | Astro Content Collections（blog + tools） | ✓ |
| `src/data/` | tools.ts 注册表 + icons.ts | ✓ |
| `src/i18n/` | UI 文案 JSON + 取词工具 | — |
| `src/layouts/` | BaseLayout / ToolLayout / ArticleLayout | — |
| `src/components/` | 通用组件（SEO、AdUnit、Filter、Search） | — |
| `scripts/` | 构建辅助脚本（OG / 图标校验 / redirects / audit） | ✓ |
| `public/` | 静态资源 + 路由元文件 | ✓ |
| `.github/workflows/` | CI/CD | ✓ |

**约定**：
- AGENTS.md 不能放在 `src/content/{collection}/` 下（Astro 会按 collection schema 校验所有 .md 文件），必须放在 collection 父级（`src/content/AGENTS.md`）。
- AGENTS.md 不能放在 `src/pages/` 任何子目录下（Astro 会把 .md 当作页面渲染并写入 sitemap，泄漏内部文档）。`src/pages/{lang}/tools/` 等路由入口的工程约定统一记入本文件。

## 常用命令

```bash
npm run dev          # 本地开发，localhost:4321
npm run build        # 图标覆盖检查 → OG 生成 → astro build → 博客 redirect 追加
npm run generate-og  # 仅重生成 OG 图（public/og/*.png）
npm run preview      # 本地预览 dist/
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
| Google Analytics 4 | `src/layouts/BaseLayout.astro` 通过 Partytown 加载 `gtag.js`；`window.trackTool(name, action)` 发送 `tool_use` 自定义事件 | 新增第三方脚本要同步 `astro.config.mjs` 的 Partytown `forward` 列表 |
| Google Search Console | 域名级验证（Cloudflare DNS TXT 记录） | 切换 DNS 服务商时验证失效，需提前在新 DNS 加 TXT |
| Google AdSense | Auto Ads via Partytown；`src/components/AdUnit.astro` 手动位组件（当前未启用）；`public/ads.txt` 声明 publisher | publisher ID 改动必须三处同步：`ads.txt`、env、CF Pages secret |
| Google Ads（投放后台） | 未集成 | 未来要投流量需新增 conversion tag（`AW-` ID） |

## 自动化质量门

| 检查 | 触发 | 阻塞条件 |
|------|------|----------|
| `scripts/check-icon-coverage.mjs` | `npm run build` 第 1 步 | 任何 slug 缺图标 |
| `scripts/audit.mjs` | `.github/workflows/ci.yml` audit job + 手动 | 任何 FAIL（schema 漂移、孤儿组件、路由缺失、i18n key 漂移、blog 命名违规等） |
| `npm run build` | `.github/workflows/ci.yml` build job + 手动 | 任何编译错误 |

CI 在 PR 与 master push 时跑 `audit → build`，PR 必须两个 job 都过才能合并。Tag push 触发 `deploy.yml`，已经依赖前面 PR 的 CI 通过。

## 全局规范

1. **新工具清单**：完整步骤见 `CONTRIBUTING.md`「New Tool Checklist」。一句话总结：组件 + `components/tools/registry.ts` + `tools.ts` + `icons.ts` + 4 语言 `content/tools/{slug}/` mdx + 推荐 4 语言博客 + OG 验证 + audit/build + tag 部署。提交前跑 `node scripts/audit.mjs`
2. **i18n 完整性**：`src/data/tools.ts` 的 `translations` 必须含全部 4 语言；缺失会回退 EN，但提交前必须补齐
3. **图标同步**：每个 `tools.ts` 的 slug 必须在 `src/data/icons.ts` 有对应 SVG，`scripts/check-icon-coverage.mjs` 在 build 时校验
4. **博客命名**：博客使用目录结构 `src/content/blog/{base-slug}/{lang}.mdx`（如 `csv-json-guide/zh.mdx`）。旧的 `{base-slug}-{lang}.mdx` 只作为历史 URL 兼容形态，由 `generate-blog-redirects.mjs` 在构建后追加 301
5. **环境变量**：客户端 env 一律 `PUBLIC_` 前缀（Astro 约定），仅写入 `.env.local`（已 gitignore），CI 走 GitHub secrets
6. **敏感信息处理**：publisher ID / GA ID / API token / account ID 不写入任何文档（含本文件）。`.env.example` 仅留空模板。如需举例用 `XXXX` 占位
7. **commit message**：英文，动词开头，遵循 `feat/fix/chore/docs/refactor(scope): description` 格式，与现有历史一致
8. **部署仪式**：build 必须本地通过零错误才能 tag。tag 前先把所有改动 push 到 master，避免 tag 指向未推送的 commit
9. **AGENTS.md 体系**：新增子目录前先建对应 AGENTS.md 定义职责；约定调整先改文档再改代码
10. **工具 slug 重命名**：改 slug 必须同步——`src/data/tools.ts`、`src/data/icons.ts`、`src/components/tools/registry.ts`、`src/content/tools/{slug}/`，并在 `public/_redirects` 为 en + zh + ja + ko 旧路径加 301。若组件文件名也改名，需同步 registry import。删除工具时 `_redirects` 仍保留指向最相关替代品，避免 404

## 变更日志

- 2026-04-26 — 初始化 AGENTS.md 体系（根 + 6 子目录），梳理 CI/CD、Cloudflare、GA4/GSC/AdSense 集成关系
- 2026-04-26 — 加入 `scripts/audit.mjs` 与 `.github/workflows/ci.yml`；将 `src/content/blog/AGENTS.md` 合并迁移到 `src/content/AGENTS.md` 规避 Astro collection schema 冲突
- 2026-04-27 — 删除 `src/pages/tools/AGENTS.md`（Astro 把 `src/pages/` 下 .md 当作页面渲染，曾以 `/tools/AGENTS/` 公网泄漏并进入 sitemap）；slug 重命名约定上提至「全局规范」第 10 条；目录索引中 `src/pages/tools/` 不再标记子 AGENTS.md
