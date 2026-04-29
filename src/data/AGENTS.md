# AGENTS.md — src/data/

## 职责

工具元数据的事实源。其他模块（路由、SEO、列表页、README 自动生成、OG 图）都从这里取数据。

## 文件

| 文件 | 内容 | 消费方 |
|------|------|--------|
| `tools.ts` | `allTools: ToolInfo[]`，每条含 slug、4 语言 translations、category、relatedSlugs | 所有工具页、列表页、`scripts/update-readme-tools.js`、`scripts/generate-og.mjs` |
| `icons.ts` | 每个 slug 对应的内联 SVG（Lucide 风格） | 列表页、ToolLayout、OG 图 |

## ToolInfo schema

```typescript
interface ToolTranslation {
  name: string;
  description: string;
}

interface ToolInfo {
  slug: string;                                    // URL slug，由动态路由 pages/{lang}/tools/[slug].astro 消费
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
