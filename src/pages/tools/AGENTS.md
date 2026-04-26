# AGENTS.md — src/pages/tools/

## 职责

工具页面的 EN（默认）路由入口。每个 `.astro` 文件对应一个工具的英文页。

## 目录结构

```
src/pages/tools/
├── index.astro     工具列表页（按 category 分组、可搜索）
└── [slug].astro    动态路由：根据 slug 渲染对应工具组件
```

多语言镜像位于：
- `src/pages/zh/tools/` — 中文
- `src/pages/ja/tools/` — 日文
- `src/pages/ko/tools/` — 韩文

> 当前实现：每个语言的 `tools/[slug].astro` 和 `tools/index.astro` 是独立文件，复用 `src/components/tools/` 下的同一交互组件，通过 prop 传 `lang`。

## 模块规范

- **路由命名**：URL slug 必须与 `src/data/tools.ts` 的 `slug` 字段精确一致
- **trailingSlash**：项目全局 `'always'`，所有内部链接必须以 `/` 结尾，否则 SEO 重定向链路被破坏
- **lang prop**：所有工具页必须显式传 `lang={'en'|'zh'|'ja'|'ko'}` 给 `BaseLayout` 和 `ToolLayout`
- **canonicalUrl**：`SEO` 组件默认用当前 pathname；只有在多 URL 指向同一内容时才覆盖
- **noindex**：默认 false。仅在草稿、staging 临时页打开

## 新工具页模板

最小骨架（EN 版，其它语言镜像同结构）：

```astro
---
import ToolLayout from '../../layouts/ToolLayout.astro';
import MyTool from '../../components/tools/MyTool.astro';
import { allTools, getToolName, getToolDescription } from '../../data/tools';

const tool = allTools.find(t => t.slug === 'my-tool')!;
---

<ToolLayout
  title={getToolName(tool, 'en')}
  description={getToolDescription(tool, 'en')}
  lang="en"
  slug="my-tool"
>
  <MyTool lang="en" />
</ToolLayout>
```

镜像到 `zh/ja/ko` 时仅替换 `lang` 字符串和导入路径深度（`../../../`）。

## 依赖关系

- 上游：`src/data/tools.ts`（slug、translations）、`src/data/icons.ts`（图标）
- 下游：`src/components/tools/*Tool.astro`（实际工具实现）、`src/layouts/ToolLayout.astro`

## 重命名注意

- 改 slug → 必须在 `public/_redirects` 加 4 条 301（en + zh + ja + ko）
- 改 slug → 必须同步 `src/data/tools.ts` + `src/data/icons.ts` 的 key
- 删除工具 → 保留 `_redirects` 重定向到最相关替代品，避免 404

## 变更日志

- 2026-04-26 — 初版
