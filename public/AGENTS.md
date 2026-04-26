# AGENTS.md — public/

## 职责

静态资源 + Cloudflare Pages 路由元文件。`public/` 内容在 build 时原样复制到 `dist/`。

## 文件清单

| 文件/目录 | 作用 | 修改风险 |
|-----------|------|----------|
| `_redirects` | CF Pages 301 规则（旧链接→新链接） | 高：错一行影响 SEO 与外链可达性 |
| `_routes.json` | CF Pages Functions 路由白名单/黑名单 | 高：误配会让所有请求走 Functions，增加冷启动延迟 |
| `ads.txt` | AdSense 出版商声明（IAB 标准） | 中：内容必须与 AdSense dashboard 注册一致，否则广告停投 |
| `robots.txt` | 爬虫规则 + sitemap 指引 | 中：误 disallow 会让 Google 停止索引 |
| `favicon.svg` | 站点图标 | 低 |
| `og/` | 工具 OG 图（构建时由 `scripts/generate-og.mjs` 生成） | — 不要手编辑，删了重 build 即可 |
| `og-default.png` | 没有专属 OG 图时的 fallback | 低 |
| `figlet-fonts/` | ASCII 艺术工具用的 figlet 字体 | 低 |
| `vendor/` | 第三方静态资源（如 wasm、字体） | 中 |
| `llms.txt` / `llms-full.txt` | 给 LLM 爬虫的站点摘要 | 低 |

## `_redirects` 规则约定

- 一行一条，格式 `<from> <to> <status>`
- 顺序：人工规则在前，构建后由 `scripts/generate-blog-redirects.mjs` 自动追加博客语言重定向
- **不要手工删除带 STA-编号注释的规则**（这些是历史 SEO 修复，对应 Linear 工单，删除会让旧搜索结果 404）
- 新增 slug 重定向遵循模式：bare slug → `/tools/{slug}/`

## `_routes.json` 约定

```json
{
  "version": 1,
  "include": ["/*"],
  "exclude": ["/", "/_astro/*", "/sitemap.xml", "/blog/*", "/zh/*", "/ja/*", "/ko/*", "/*-*", ...]
}
```

`exclude` 列表是关键：所有静态资源、博客、各语言路径要在这里排除掉，否则会被 Pages Functions 拦截，触发不必要的冷启动。新增静态路径前先确认是否需要追加 exclude。

## `ads.txt` 修改流程

1. 在 AdSense dashboard 拿新 publisher ID（`pub-XXXXXXXXXX`）
2. 改 `public/ads.txt` 为：`google.com, pub-XXXXXXXXXX, DIRECT, f08c47fec0942fa0`
3. 同步改 GitHub secret `PUBLIC_ADSENSE_PUBLISHER_ID` = `ca-pub-XXXXXXXXXX`（注意 `ca-` 前缀）
4. CF Pages 也有 env 副本，同步更新
5. tag 部署后 24-48h AdSense 自动重新校验

## `robots.txt` 当前策略

`Allow: /` + 指向 `https://zerotool.dev/sitemap-index.xml`。如果未来要 noindex 某些路径（如 `/draft/`），在这里加 `Disallow:`。

## 变更日志

- 2026-04-26 — 初版
