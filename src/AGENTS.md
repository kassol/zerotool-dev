# AGENTS.md — src/

## 职责

应用源码主目录，按 Astro 5 约定组织。所有客户端代码、内容、数据、布局、i18n 在这里。

## 目录结构

```
src/
├── components/         通用组件（顶层，含工具页主体 ToolPage.astro）+ tools/（每个工具的交互组件 + registry.ts）
├── content/            Content Collections（blog + tools），见 content/AGENTS.md
│   ├── blog/           MDX 博客文章（{base-slug}/{en,zh,ja,ko}.mdx）
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

- **客户端入口在 Astro `<script>` 中**：每个工具的页面交互写在对应 `.astro` 脚本，不引入运行时框架。ai-token-counter 与 json-formatter 的大文本引擎、runner 和 Worker 放在同目录的工具专用文件中；Worker 由 Vite 打包，页面只接收有界展示数据。
- **零外部运行时依赖**：图标、SVG 全部内联；新增 npm 依赖前必须先评估是否能用浏览器原生 API 替代
- **路径导入**：跨目录引用用相对路径（`../i18n/utils`），不配 alias
- **类型源**：`data/tools.ts` 的 `ToolInfo` 是其他模块的事实类型源，不另立类型
- **i18n 取词**：`import { t } from '../i18n/utils'` 拿 UI 文案；工具 name/description 走 `getToolName(tool, lang)` / `getToolDescription(tool, lang)`

## 依赖关系

- `astro.config.mjs` 的 `toolRoutes()` 读 `components/tools/registry.ts`（slug → 组件文件名），为每个工具生成入口 `.generated/tool-routes/{slug}.astro` 并注入路由 `/[...lang]/tools/{slug}`（4 语言共用一个入口）
- 入口 → `components/ToolPage.astro`（取 content 条目、渲染 `ToolLayout`）+ 只 import 本工具的 `components/tools/{Name}Tool.astro`（放进 `tool` slot）；非 EN 页向组件传 `lang` prop
- 每个工具页的 CSS = 全站 CSS + 共享工具 CSS（`tool-common.css`、`ToolLayout`、`ShareButtons`、`AdUnit`）+ 本工具组件 CSS。组件不能依赖其他工具组件的样式（根 AGENTS.md 全局规范第 11 条）
- `BaseLayout.astro` → `i18n/utils.t()`（导航 / footer）
- `components/SEO.astro` → `getCollection('blog')` 列出可收录（非 draft、非 noindex，判定在 `data/blog-index.mjs`）的语言变体生成 hreflang；noindex 页面不输出 hreflang
- 工具页 → `data/tools.ts` 取元数据，`data/icons.ts` 取 SVG

## 新增/重命名约束

- 新增工具 slug：必须同步 `components/tools/{Name}Tool.astro` + `components/tools/registry.ts`（一行 `'{slug}': '{Name}Tool'`） + `data/tools.ts` + `data/icons.ts` + `content/tools/{slug}/{en,zh,ja,ko}.mdx`
- 重命名 slug：必须在 `public/_redirects` 加 301 规则，避免老链接 404 影响 SEO
- 新增 i18n 文案 key：4 个 JSON 文件同步加，避免运行时回退到 key 字符串

## 变更日志

- 2026-10-03 — 工具页改版样板（分支 `proto/tool-page-redesign`，未合并）：新增 `components/Toggletip.astro`（原生 popover 的说明气泡，内容写在 HTML 里，点击 / 触控打开，点外部或 Esc 关闭，无 popover 支持时退回 hidden）与 `data/tool-layouts.ts`；`ToolLayout` 对其中的 slug 渲染 v2 版式。json-formatter、color-palette-generator、har-file-analyzer 三个组件改为占满首屏的布局并加控件旁说明。

- 2026-10-03 — json-formatter 引擎原样移到 `json-formatter-engine.js`；`json-formatter-run.js`（`viewOf`、runner、客户端）与 `json-formatter.worker.js` 承担解析、序列化、高亮、文件解码与树分页，页面只做展示。ai-token-counter 的 Worker 改为在入口用 `?url` 引入词表、运行时 `import(url)`，因为 Vite 的 IIFE Worker 不能拆分 chunk（此前正式构建失败）。

- 2026-10-02 — ai-token-counter 的统计、预分词与 BPE 移到可终止的工具专用 Worker；原算法声明机械迁移到 `ai-token-counter-engine.js`，客户端只接收计数、统计与每种分词器前 2,000 个展示 token。输入变化 / 清空终止旧 Worker，加载失败可重试；词表仍按需加载，Worker 由 Vite 按内容生成版本地址。

- 2026-10-02 — color-shades-generator 任意颜色解析失败时清空当前色阶、导出代码与注记，并禁用复制全部和下载；合法输入恢复后重新启用。修复此前仅空输入会清空、其他非法输入仍可复制或下载旧色阶的问题。
- 2026-10-02 — bcrypt worker URL 在构建期按源码 SHA-256 生成版本参数，协议更新自动避开旧缓存；worker 保留 generate / verify 旧协议以兼容已缓存页面。修正博客目录说明。
- 2026-04-26 — 初版
- 2026-09-26 — 工具页路由改为 `astro.config.mjs` 的 `toolRoutes()` 按 registry 注入（每工具一个入口），删除 `pages/tools/[slug].astro` 与 `pages/{lang}/tools/[slug].astro`；`registry.ts` 改为 slug → 组件文件名；新增 `components/ToolPage.astro`
