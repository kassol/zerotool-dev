# AGENTS.md — src/content/

## 职责

Astro Content Collections 的根目录。包含两个 collection：`blog` 与 `tools`。Schema 由 `config.ts` 定义。

> **位置说明**：本文件位于 `src/content/`（collection 根目录的父级）而非 `src/content/blog/`。原因：`type: 'content'` collection 默认收录目录内所有 `.md/.mdx`，把 AGENTS.md 放进去会被当成博客条目导致 schema 校验失败。AGENTS.md 必须留在 `src/content/` 这一级，按内容覆盖到所有子 collection。

## 子 collection 概览

| Collection | 路径 | 文件数 | 用途 |
|------------|------|--------|------|
| `blog` | `src/content/blog/{base-slug}/{lang}.mdx` | 多语言文章（每篇一目录） | 博客内容（4 语言） |
| `tools` | `src/content/tools/{slug}/{lang}.mdx` | 100+ 工具 × 4 语言 | 每个工具页面的 SEO 文案 + FAQ + 正文 |

## blog collection

### 命名约定（关键）

每篇文章一个目录，目录名是 base slug；目录下放 4 个语言文件：

```
src/content/blog/csv-json-guide/
├── en.mdx
├── zh.mdx
├── ja.mdx
└── ko.mdx
```

URL 由 base slug 决定：
- `/blog/csv-json-guide/` → en.mdx
- `/zh/blog/csv-json-guide/` → zh.mdx
- `/ja/blog/csv-json-guide/` → ja.mdx
- `/ko/blog/csv-json-guide/` → ko.mdx

> 历史：迁移前曾用平铺命名 `{base-slug}-{lang}.mdx`（如 `csv-json-guide-zh.mdx`），URL 是 `/zh/blog/csv-json-guide-zh/`。`scripts/generate-blog-redirects.mjs` 现在生成反向 301（旧 URL → 新 URL）兼容已索引外链；几个月后可移除。

迁移驱动因素：旧设计需要每篇 × 3 lang × 2 trailing variants ≈ 540 条 base→lang `_redirects` 规则，叠加工具 alias 后总数突破 CF Pages 2100 条上限，导致末尾规则被截断 → 已索引 URL 404。新设计把这部分结构化到路由层，`_redirects` 只剩兼容层。

### Frontmatter 约定

```yaml
---
title: "..."
description: "..."
pubDate: 2026-04-20
updatedDate: 2026-04-25      # 可选，sitemap lastmod 优先用这个
heroImage: "/og/{slug}.png"  # 可选
lang: "en"                   # en/zh/ja/ko，必须与文件名（en.mdx/zh.mdx/...）一致
canonicalSlug: "csv-json-guide"  # 可选，仅用于跨语言关联标记；URL 已由目录名决定
---
```

`pubDate` 与 `updatedDate` 是 `astro.config.mjs` 中 sitemap `serialize()` 提取 `lastmod` 的来源，缺失会回落到当前时间。

### blog 模块规范

- 跨语言一致性：每篇 EN 文章应有对应的 ZH/JA/KO 版本（至少 ZH）。`src/components/SEO.astro` 会按磁盘存在性输出 hreflang，缺哪个就少哪个
- slug 唯一性：`base-slug` 在所有语言间共享；新增前先 grep 全目录避免冲突
- MDX 内嵌组件：可以 `{import Component from '...'}`，但避免运行时依赖
- 图片：放 `public/og/` 或 `public/`，文章中用绝对路径

## tools collection

每个工具一个目录，目录下有 4 个语言版本的 `.mdx`：

```
src/content/tools/{slug}/
├── en.mdx
├── zh.mdx
├── ja.mdx
└── ko.mdx
```

### Frontmatter 约定

```yaml
---
seoTitle: "..."          # 必填，工具页 <title>
seoDescription: "..."    # 必填，工具页 <meta description>
faqItems:                # 可选，结构化 FAQ
  - question: "..."
    answer: "..."
---
```

正文部分作为工具页底部的长尾内容（教程、用例、原理说明），SEO 关键。

### tools 模块规范

- 4 语言强制齐全：缺任一语言 `[slug].astro` 会在 `getEntry('tools', '${slug}/${lang}')` 处 throw error，build 直接挂
- 正文要原创，避免 4 语言间机翻雷同（影响 hreflang 评估）
- FAQ 数量建议 3-5 条，太少 SEO 弱，太多挤占阅读

## 共同约束

- **不要在 `src/content/blog/` 或 `src/content/tools/` 下放 `.md/.mdx` 之外的辅助文件**：会被 collection 当成数据条目，schema 校验失败 build 挂掉
- 若需要补充元数据/工具脚本，放 `scripts/` 或更上层目录
- Astro 5 的 `type: 'content'` 是 legacy API，未来可能迁移到 `loader: glob({ pattern: '**/*.mdx' })`，迁移时需把所有 `entry.slug` 改为 `entry.id`

## 依赖关系

- 上游：`config.ts`（schema 定义 + collection 注册）
- 下游：
  - `src/pages/blog/[slug].astro` 等 8 个 blog 路由
  - `src/pages/{lang}/tools/[slug].astro` 4 个 tool 路由
  - `src/components/SEO.astro` 用 blog collection 算 hreflang
  - `astro.config.mjs` sitemap `serialize()` 用 frontmatter 日期
  - `scripts/generate-blog-redirects.mjs` 用文件名生成 redirect
  - `scripts/audit.mjs` 静态校验文件命名 + frontmatter + 多语言齐全

## 变更日志

- 2026-04-26 — 初版（合并自 `src/content/blog/AGENTS.md`，迁移到此处规避 Astro collection schema 冲突）
- 2026-04-27 — 博客结构 B-migration：平铺 `{slug}-{lang}.mdx` → 目录 `{slug}/{lang}.mdx`，对齐 tools collection 风格；`_redirects` 大幅瘦身（~2470 → ~1100 条），脱离 CF Pages 2100 限制
