# AGENTS.md — src/content/blog/

## 职责

MDX 博客文章源文件。Astro Content Collections 在构建期把所有 `.mdx` 编译进 `dist/`。

## 命名约定（关键）

| 语言 | 文件名格式 | 示例 |
|------|-----------|------|
| EN（默认） | `{base-slug}.mdx` 或 `{base-slug}-guide.mdx` | `csv-json-guide.mdx` |
| ZH | `{base-slug}-zh.mdx` 或 `{base-slug}-guide-zh.mdx` | `csv-json-guide-zh.mdx` |
| JA | `{base-slug}-ja.mdx` 或 `{base-slug}-guide-ja.mdx` | `csv-json-guide-ja.mdx` |
| KO | `{base-slug}-ko.mdx` 或 `{base-slug}-guide-ko.mdx` | `csv-json-guide-ko.mdx` |

构建时 `scripts/generate-blog-redirects.mjs` 扫描所有 `*-{zh|ja|ko}.mdx`，向 `dist/_redirects` 追加：

```
/{lang}/blog/{base-slug}/ /{lang}/blog/{base-slug}-{lang}/ 301
/{lang}/blog/{base-slug}  /{lang}/blog/{base-slug}-{lang}/ 301
```

文件名错了 → redirect 链路断、hreflang 失效、Search Console 报「无替代页面」。

## Frontmatter 约定

```yaml
---
title: "..."
description: "..."
pubDate: 2026-04-20
updatedDate: 2026-04-25      # 可选，sitemap lastmod 优先用这个
heroImage: "/og/{slug}.png"  # 可选
lang: "en"                   # en/zh/ja/ko，必须与文件名后缀一致
canonicalSlug: "csv-json-guide"  # 可选，跨语言变体组的根 slug
---
```

`pubDate` 与 `updatedDate` 是 `astro.config.mjs` 中 sitemap `serialize()` 提取 `lastmod` 的来源，缺失会回落到当前时间。

## 模块规范

- **跨语言一致性**：每篇 EN 文章应有对应的 ZH/JA/KO 版本（至少 ZH）。`src/components/SEO.astro` 会按磁盘存在性输出 hreflang，缺哪个就少哪个，不报错但影响 SEO
- **slug 唯一性**：`base-slug` 在所有语言间共享；新增前先 grep 全目录避免冲突
- **MDX 内嵌组件**：可以用 `{import Component from '...'}` 拉组件，但要避免运行时依赖
- **图片**：放 `public/og/` 或 `public/`，文章中用绝对路径 `/og/foo.png`

## 依赖关系

- 上游：`src/content/config.ts`（schema 校验 frontmatter）
- 下游：
  - `src/pages/blog/[slug].astro` 等动态路由渲染
  - `src/layouts/ArticleLayout.astro` 提供布局
  - `astro.config.mjs` 的 sitemap `serialize()` 用 frontmatter 的日期
  - `scripts/generate-blog-redirects.mjs` 用文件名后缀生成 redirect

## 变更日志

- 2026-04-26 — 初版
