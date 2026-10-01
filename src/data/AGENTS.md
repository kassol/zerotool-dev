# AGENTS.md — src/data/

## 职责

工具元数据的事实源。其他模块（路由、SEO、列表页、README 自动生成、OG 图）都从这里取数据。

## 文件

| 文件 | 内容 | 消费方 |
|------|------|--------|
| `tools.ts` | `allTools: ToolInfo[]`，每条含 slug、4 语言 translations、category、relatedSlugs | 所有工具页、列表页、`scripts/update-readme-tools.js`、`scripts/generate-og.mjs` |
| `icons.ts` | 每个 slug 对应的内联 SVG（Lucide 风格） | 列表页、ToolLayout、OG 图 |
| `guides.ts` | `guideDirFor(slug)`：工具对应的指南博客目录，默认 `{slug}-guide`；`guideDirOverrides` 记录 4 个目录名不同的已发布指南（改目录会改线上 URL） | `components/ToolPage.astro`（阅读指南卡片）、`layouts/ArticleLayout.astro`（相关文章同分类加分）、`scripts/test-related-posts.mjs` |
| `blog-index.mjs` | 博客可否收录的判定（`isIndexable`：非 draft 且非 noindex）、URL 与 collection key 互转、hreflang 备选语言、sitemap 过滤、frontmatter 解析（js-yaml）。纯 JS、不 import Node 模块，供 Astro 配置与组件共用 | `astro.config.mjs`（sitemap `filter` / `serialize`）、`components/SEO.astro`（hreflang）、`scripts/test-blog-index.mjs` |
| `network.ts` | `networkToolSlugs`：因功能需要会联网的工具；每个 slug 在 4 个 i18n JSON 里有 `network.{slug}`，写明发出什么、发给谁。新增会发请求的工具（`fetch`、外部 URL 的 `<img>` 等）必须加进来。只在用户打开某个选项后才联网的工具放 `optionalNetworkToolSlugs`（保留「100% 客户端」徽章，i18n key 为 `networkOptional.{slug}`），About 页用 `aboutNetworkToolSlugs` / `aboutNetworkNoteKey()` 同时列出两类 | `layouts/ToolLayout.astro`（顶部提示替换 `tool.trustPrivacy`，并隐藏 `tool.trustClient`「100% 客户端」徽章）、`pages/{,zh/,ja/,ko/}about.astro`（联网工具清单） |
| `llms.mjs` | llms 文件生成规则（纯 JS）：`buildLlmsTxt(data, lang)`、`buildLlmsFullTxt(data, pages)`、`howToSteps(body)`；各语言的站点说明是唯一手写内容 | `src/pages/llms.txt.ts`、`src/pages/{zh,ja,ko}/llms.txt.ts`、`src/pages/llms-full.txt.ts`、`scripts/test-llms-txt.mjs` |
| `llms-input.ts` | 为 llms 端点收集数据：`tools.ts`、`network.ts`、`persistence.ts`、4 语言 i18n、英文工具页 mdx 的 `seoDescription` 与正文 | 上述 llms 端点 |

## ToolInfo schema

```typescript
interface ToolTranslation {
  name: string;
  description: string;
}

interface ToolInfo {
  slug: string;                                    // URL slug；工具页路由由 astro.config.mjs 的 toolRoutes() 按 components/tools/registry.ts 注入
  translations: Record<'en'|'zh'|'ja'|'ko', ToolTranslation>;  // 4 语言必填
  category: 'data'|'encoding'|'text'|'security'|'dev'|'api'|'color'|'image';
  relatedSlugs?: string[];                         // 可选，工具页底部「相关工具」
}
```

## 强制约束

1. **4 语言完整**：`translations` 必须有 `en/zh/ja/ko` 全部 key。回退会发生但应避免（影响 SEO 和用户体验）
2. **slug 唯一**：新增前 grep `slug:` 确认无冲突
3. **slug 格式**：`kebab-case`，仅 `a-z0-9-`，不允许大写、下划线、点
4. **category 枚举封闭**：`scripts/audit.mjs` 把 `tools.ts` 的 `category` 联合类型当作单源，从这里 grep 出可选值并与 `src/components/CategoryFilter.astro` 比对。要新增分类必须先改类型联合，再同步 UI 过滤器
5. **图标必配**：`tools.ts` 每加一条，必须在 `icons.ts` 加同名 key 的 SVG。`scripts/check-icon-coverage.mjs` 在 `npm run build` 第一步校验，缺图标会让构建失败

## icons.ts 规范

- Lucide 风格：`viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-width="2"`、`stroke-linecap="round"`、`stroke-linejoin="round"`
- 不引外部图标库，全部内联 SVG 字符串
- key 与 `tools.ts` 的 slug 完全一致

## 修改副作用

| 改动 | 触发的下游变化 |
|------|----------------|
| 新增 tool | push master 后自动跑 `update-readme.yml`，README.md 工具表自动更新 |
| 改 name/description | 翻译影响 4 语言页面 SEO title/description |
| 改 slug | 必须同步：`pages/tools/`、`pages/{lang}/tools/`、`icons.ts`、`_redirects`（加 301） |
| 改 category | 列表页过滤器映射可能要改 |

## 变更日志

- 2026-04-26 — 初版
- 2026-09-26 — `ToolInfo.slug` 注释改为指向 `toolRoutes()` 注入的工具路由（原 `pages/{lang}/tools/[slug].astro` 已删除）
- 2026-09-27 — 新增 `guides.ts`（工具 → 指南博客目录映射）
- 2026-09-29 — 新增 `network.ts`（会联网的工具清单，工具页顶部提示与 About 共用）
- 2026-09-29 — 新增 `blog-index.mjs`（博客 noindex / draft 判定，sitemap 与 hreflang 共用）
- 2026-09-30 — `network.ts` 新增 `optionalNetworkToolSlugs`（默认不联网、打开选项后才联网的工具，首个为 markdown-to-word 的「嵌入网络图片」）
- 2026-09-30 — 新增 `llms.mjs` 与 `llms-input.ts`（llms 文件由构建期端点生成，工具条目随 `tools.ts` / `network.ts` / `persistence.ts` 自动更新）
- 2026-10-01 — 新增 `deepseek-v4-tokenizer.mjs`（生成文件，勿手改）：ai-token-counter 的 DeepSeek V4 词表与合并表，由 `scripts/build-deepseek-tokenizer.mjs` 从 DeepSeek 官方 tokenizer.json 生成，页面按需动态 import（约 1.08 MB，gzip 577 KB）
