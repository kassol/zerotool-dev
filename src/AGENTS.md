# AGENTS.md — src/

## 职责

应用源码主目录，按 Astro 5 约定组织。所有客户端代码、内容、数据、布局、i18n 在这里。

## 目录结构

```
src/
├── components/         通用组件（顶层，含工具页主体 ToolPage.astro）+ tools/（每个工具的交互组件 + registry.ts）
├── content/            Content Collections（blog + tools），见 content/AGENTS.md
│   ├── blog/           MDX 博客文章（多语言后缀文件）
│   ├── tools/          工具内容（每 slug × 4 lang）
│   └── config.ts       Content Collections schema
├── data/               tools.ts 注册表 + icons.ts → 见子 AGENTS.md
├── i18n/               UI 文案 JSON（en/zh/ja/ko）+ utils.ts
├── layouts/
│   ├── BaseLayout.astro     全局壳：导航 / 主题切换 / GA4 / AdSense / 语言切换
│   ├── ToolLayout.astro     工具页布局（含 SEO + AdUnit 槽位）
│   └── ArticleLayout.astro  博客文章布局
├── pages/              路由（约定见根 AGENTS.md；src/pages/ 下禁止放 .md）；工具页路由不在这里，由 astro.config.mjs 的 toolRoutes() 注入
└── styles/             全局 CSS
```

## 模块规范

- **客户端代码必须在 Astro `<script>` 中**：每个工具的 JS 写在对应 `.astro` 内联 `<script>`，不引入运行时框架
- **零外部运行时依赖**：图标、SVG 全部内联；新增 npm 依赖前必须先评估是否能用浏览器原生 API 替代
- **路径导入**：跨目录引用用相对路径（`../i18n/utils`），不配 alias
- **类型源**：`data/tools.ts` 的 `ToolInfo` 是其他模块的事实类型源，不另立类型
- **i18n 取词**：`import { t } from '../i18n/utils'` 拿 UI 文案；工具 name/description 走 `getToolName(tool, lang)` / `getToolDescription(tool, lang)`

## 依赖关系

- `astro.config.mjs` 的 `toolRoutes()` 读 `components/tools/registry.ts`（slug → 组件文件名），为每个工具生成入口 `.generated/tool-routes/{slug}.astro` 并注入路由 `/[...lang]/tools/{slug}`（4 语言共用一个入口）
- 入口 → `components/ToolPage.astro`（取 content 条目、渲染 `ToolLayout`）+ 只 import 本工具的 `components/tools/{Name}Tool.astro`（放进 `tool` slot）；非 EN 页向组件传 `lang` prop
- 每个工具页的 CSS = 全站 CSS + 共享工具 CSS（`tool-common.css`、`ToolLayout`、`ShareButtons`、`AdUnit`）+ 本工具组件 CSS。组件不能依赖其他工具组件的样式（根 AGENTS.md 全局规范第 11 条）
- `BaseLayout.astro` → `i18n/utils.t()`（导航 / footer）
- `components/SEO.astro` → `getCollection('blog')` 列出存在的语言变体，过滤无效 hreflang
- 工具页 → `data/tools.ts` 取元数据，`data/icons.ts` 取 SVG

## 新增/重命名约束

- 新增工具 slug：必须同步 `components/tools/{Name}Tool.astro` + `components/tools/registry.ts`（一行 `'{slug}': '{Name}Tool'`） + `data/tools.ts` + `data/icons.ts` + `content/tools/{slug}/{en,zh,ja,ko}.mdx`
- 重命名 slug：必须在 `public/_redirects` 加 301 规则，避免老链接 404 影响 SEO
- 新增 i18n 文案 key：4 个 JSON 文件同步加，避免运行时回退到 key 字符串

## 变更日志

- 2026-04-26 — 初版
- 2026-09-26 — 工具页路由改为 `astro.config.mjs` 的 `toolRoutes()` 按 registry 注入（每工具一个入口），删除 `pages/tools/[slug].astro` 与 `pages/{lang}/tools/[slug].astro`；`registry.ts` 改为 slug → 组件文件名；新增 `components/ToolPage.astro`
