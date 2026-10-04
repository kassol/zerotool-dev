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
src/content/blog/pkce-generator-guide/
├── en.mdx
├── zh.mdx
├── ja.mdx
└── ko.mdx
```

URL 由 base slug 决定：
- `/blog/pkce-generator-guide/` → en.mdx
- `/zh/blog/pkce-generator-guide/` → zh.mdx
- `/ja/blog/pkce-generator-guide/` → ja.mdx
- `/ko/blog/pkce-generator-guide/` → ko.mdx

> 历史：迁移前曾用平铺命名 `{base-slug}-{lang}.mdx`（如 `csv-json-guide-zh.mdx`），URL 是 `/zh/blog/csv-json-guide-zh/`。`scripts/generate-blog-redirects.mjs` 现在生成反向 301（旧 URL → 新 URL）兼容已索引外链；几个月后可移除。

迁移驱动因素：旧设计需要每篇 × 3 lang × 2 trailing variants ≈ 540 条 base→lang `_redirects` 规则，叠加工具 alias 后总数突破 CF Pages 2100 条上限，导致末尾规则被截断 → 已索引 URL 404。新设计把这部分结构化到路由层，`_redirects` 只剩兼容层。

### Frontmatter 约定

```yaml
---
title: "..."
description: "..."
pubDate: 2026-04-20
updatedDate: 2026-04-25      # 可选，sitemap lastmod 优先用这个
ogImage: "/og/custom.png"    # 可选，仅在需要覆盖默认图时写；默认由 ArticleLayout 按文件路径推导
lang: "en"                   # en/zh/ja/ko，必须与文件名（en.mdx/zh.mdx/...）一致
tags: ["..."]                # 可选；用于"相关文章"模块
draft: false                 # 可选；为 true 时不会进入路由生成、hreflang 与语言切换
noindex: false               # 可选；为 true 时页面照常生成，但不让搜索引擎收录（见下）
---
```

`pubDate` 与 `updatedDate` 是 `astro.config.mjs` 中 sitemap `serialize()` 提取 `lastmod` 的来源，缺失会回落到当前时间。

### noindex

`noindex` 按语言文件分别设置：只在 `zh.mdx` 写 `noindex: true`，只影响 `/zh/blog/{base-slug}/`，其他语言版本照常收录。设了 `noindex: true` 的页面：

- 页面照常生成，博客列表、相关文章、语言切换照常链接它
- `<head>` 输出 `<meta name="robots" content="noindex,follow">`：不收录本页，页内链接（如指南指向工具页）照常传递
- 不进 sitemap（`astro.config.mjs` 的 sitemap `filter`），也不出现在其他语言版本 sitemap 条目的 alternate 链接里
- 其他语言版本的 hreflang 不再指向它；它自己不输出 hreflang（`src/components/SEO.astro`）

是否收录的判定集中在 `src/data/blog-index.mjs`（`isIndexable`：非 draft 且非 noindex），sitemap 与 hreflang 共用，测试见 `scripts/test-blog-index.mjs`。sitemap 侧用 js-yaml 解析 frontmatter，hreflang 侧用 Content Collection 数据，两边字段含义一致。

### blog 模块规范

- 跨语言一致性：每篇 EN 文章应有对应的 ZH/JA/KO 版本（至少 ZH）。`src/components/SEO.astro` 会按磁盘存在性输出 hreflang，缺哪个就少哪个
- slug 唯一性：`base-slug` 在所有语言间共享；新增前先 grep 全目录避免冲突
- 工具指南命名 `{toolSlug}-guide`（`toolSlug` 与 `src/data/tools.ts` 一致）：工具页据此显示「阅读指南」链接（`src/components/ToolPage.astro`，当前语言有该文章才显示），相关文章按工具分类加分（`src/layouts/ArticleLayout.astro`）。起别的目录名两者都不生效
- 相关文章：同语言内按共同标签数打分，超过半数文章都有的标签（如 `developer-tools`）不计分；标签宜写具体主题词
- MDX 内嵌组件：可以 `{import Component from '...'}`，但避免运行时依赖
- 图片：放 `public/`，文章中用绝对路径。`public/og/` 是 `generate-og.mjs` 的构建产物（已 gitignore），不要放手工图片

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
steps:                   # 可选，用法步骤（纯文本），v2 版式工具页必填
  - "..."
faqItems:                # 可选，结构化 FAQ
  - question: "..."
    answer: "..."
---
```

正文部分作为工具页底部的长尾内容（教程、用例、原理说明），SEO 关键。v2 版式的工具页（`src/data/tool-layouts.ts` 中的 slug）正文收在默认关闭的「示例、说明与常见问题」区，不再写「How to Use / 使用方法」一节：用法放进工具内的说明气泡与 `steps`。「Limits / 限制」一节留在正文里；只有与单个控件绑定的限制另写进该控件旁的说明气泡（决策人 2026-10-04 的决定）。json-formatter、color-palette-generator、har-file-analyzer 三个样板在这项决定之前完成，限制已全部写在气泡里，正文没有「限制」节，不回填。

`steps` 字段：
- 用途：给 `/llms-full.txt` 提供「How to use」步骤（`src/data/llms.mjs` 的 `toolSteps()`：有 `steps` 用它，没有时仍从正文第一个以「How to」开头的 H2 下的有序列表抓取）。页面本身不渲染 `steps`。
- 写法：每步一个字符串，纯文本（不写 Markdown，`plainText()` 只做兜底清理），按当前界面的按钮与选项名称措辞，与工具内说明气泡一致；每步 ≤ 280 字符、合计 ≤ 1200 字符、最多 8 步（`MAX_STEP_CHARS` / `MAX_HOWTO_CHARS` / `MAX_STEPS`，超出会被截断）。
- 范围：v2 版式工具页的 4 个语言都写（llms-full.txt 只用 en），其他工具不写；`scripts/test-llms-txt.mjs` 检查只有 `tool-layouts.ts` 中的 slug 有 `steps`、且 4 语言齐全。改界面文字时同步改 `steps`。

### tools 模块规范

- 4 语言强制齐全：缺任一语言 `src/components/ToolPage.astro` 会在 `getEntry('tools', '${slug}/${lang}')` 处 throw error，build 直接挂
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
  - `src/components/ToolPage.astro`（工具页主体，由 `astro.config.mjs` 的 `toolRoutes()` 注入的每工具路由渲染，4 语言）
  - `src/components/SEO.astro` 用 blog collection 算 hreflang（只含可收录的语言版本）
  - `astro.config.mjs` sitemap `filter()` / `serialize()` 经 `src/data/blog-index.mjs` 用 frontmatter 的 `draft` / `noindex` 与日期
  - `scripts/generate-blog-redirects.mjs` 用文件名生成 redirect
  - `scripts/audit.mjs` 静态校验文件命名 + frontmatter + 多语言齐全

## 变更日志

- 2026-10-03 — tools collection 新增可选 frontmatter `steps`（`config.ts`）。json-formatter、color-palette-generator、har-file-analyzer 改为 v2 版式：4 语言删去「用法」「限制」两节，用法写入 `steps`，限制移入工具内说明气泡，其余正文与 FAQ 收进折叠区。
- 2026-10-03 — 转换保真与 js-yaml 上限：yaml-toml、toml-json、yaml-json 四语言的限制段与 FAQ 改为「目标格式无法原样保存的值会停止转换并按路径列出」，示例输出与停止消息由 `test-yaml-toml.mjs`、`test-toml-json.mjs`、`test-conversion-fidelity.mjs` 经页面入口复算并核对逐字出现；yaml-toml 新增日期与「TOML 无法保存的值」两节（zh / ja / ko 另加限制段），toml-json 的转换示例去掉 `ratio = inf → null`；yaml-toml、yaml-json、yaml-validator、openapi-validator 四语言写明 js-yaml 4.3.2 的嵌套 100 层、合并键 10,000、单个合并键 100 个映射上限，js-yaml 版本文案改为 4.3.2。上一条中 yaml-toml 大整数「输出为浮点字面量」的示例已改为停止转换。

- 2026-10-03 — 转换保真补充：toml-json 四语言新增「精度超过毫秒的时间停止转 JSON」与「`-0.0` 保留负号」两条，yaml-toml 日期一节补 TOML → YAML 的精度停止与 YAML `-0.0` → TOML `-0.0`，yaml-json 限制段新增「日期必须存在、时间只保留到毫秒」一条（en / zh FAQ 同步），yaml-validator「预览是 JSON」一条补预览上方的提示、示例与预览中的实际值（四语言 FAQ 同步）；消息原文与示例由 `test-conversion-fidelity.mjs` 的 PAGE-TEXT-B 经页面入口复算并核对逐字出现。

- 2026-10-03 — 转换保真补充第二轮：toml-json 四语言 `-0.0` 一条改为两个方向（TOML `offset = -0.0` → `"offset": -0.0`）并写明 JSON 整数 `-0` 写成 `0`（引 TOML 1.0 integer）；yaml-toml 日期一节加 TOML 本地日期时间转 YAML 的停止消息与「整数值浮点数仍写成浮点数（`ratio = 1.0`）」；yaml-json「类型会变的值」表新增带偏移时间换成 UTC 与 `-0.0` 两行，限制段新增「JSON 整数 `-0` 写成 `0`」（引 YAML 1.2 core schema tag resolution）；yaml-validator「预览是 JSON」一条写明负零写 `-0.0`、时间戳显示为 UTC。示例与消息由 `test-conversion-fidelity.mjs` 的 PAGE-TEXT-C 经页面入口复算。

- 2026-10-02 — 解析器升级：yaml-toml 英文页注明 smol-toml 1.7.1，并同步大整数输出为浮点字面量的示例；该输入在 YAML 读入阶段已有的精度损失说明保留。

- 2026-10-02 — 发版收尾复核：sprite-sheet-generator-guide 四语言草稿的对比表与限制段改为支持 PNG / WebP（取决于浏览器编码能力），保留 draft 状态与其他正文。

- 2026-04-26 — 初版（合并自 `src/content/blog/AGENTS.md`，迁移到此处规避 Astro collection schema 冲突）
- 2026-04-27 — 博客结构 B-migration：平铺 `{slug}-{lang}.mdx` → 目录 `{slug}/{lang}.mdx`，对齐 tools collection 风格；`_redirects` 大幅瘦身（~2470 → ~1100 条），脱离 CF Pages 2100 限制
- 2026-09-25 — `public/og/` 改为构建产物并移出 git，博客图片不再放该目录
- 2026-09-25 — 博客 OG 图改由 `ArticleLayout` 按文件路径推导（`{dir}/en.mdx` → `/og/blog-{dir}.png`，其他语言 → `/og/blog-{dir}-{lang}.png`，与 `generate-og.mjs` 命名一致）；删除全部博客 frontmatter 的 `ogImage`（72 篇 zh/ja/ko 曾指向 EN 图，35 篇缺失而用 og-default）
- 2026-09-27 — 相关文章改为按相关度选（排除高频标签、同工具分类加分、按发布时间差补齐）；工具页链接同名 `{slug}-guide` 指南
- 2026-09-26 — tools collection 的下游从 4 个 `tools/[slug].astro` 改为 `src/components/ToolPage.astro`（工具页路由由 `toolRoutes()` 注入）
- 2026-09-29 — blog frontmatter `noindex` 写明用法与效果：robots `noindex,follow`，移出 sitemap 与 hreflang
