# AGENTS.md — scripts/

## 职责

构建管线辅助脚本与维护工具，全部用 Node 直接跑（`.mjs` 或 `.js`），无 TypeScript 编译步骤。

## 文件清单

| 脚本 | 类型 | 用途 | 何时跑 |
|------|------|------|--------|
| `check-icon-coverage.mjs` | 校验 | 比对 `tools.ts` 与 `icons.ts`，缺图标即 exit 1 | `npm run build` 第 1 步 |
| `generate-og.mjs` | 生成 | 用 sharp + figlet 为每个工具生成 OG 图，输出到 `public/og/{slug}.png` | `npm run build` 第 2 步 / `npm run generate-og` |
| `generate-blog-redirects.mjs` | 后处理 | 扫 `src/content/blog/*-{zh,ja,ko}.mdx`，向 `dist/_redirects` 追加语言版 301 | `npm run build` 第 4 步 |
| `update-readme-tools.js` | 文档同步 | 用 `tools.ts` 的 slug + EN name 重写 README 的 `<!-- TOOLS-START/END -->` 段 | CI workflow `update-readme.yml` 在 master 分支 `tools.ts` 变化时自动跑 |
| `audit-slug-aliases.mjs` | 巡检 | 审计 `_redirects` 与 slug 的对应关系，发现孤儿规则 | 手动按需 |
| `deploy.sh` | 部署 | 本地构建 + `wrangler pages deploy`（需 `PROJECT_NAME` env） | 手工部署兜底 |
| `devto-article-draft.md` | 内容草稿 | 非脚本，是发到 dev.to 的草稿 | — |

## 构建管线（npm run build）

```
1. node scripts/check-icon-coverage.mjs   # 缺图标即停
2. node scripts/generate-og.mjs           # 生成 public/og/*.png
3. astro build                            # 编译到 dist/
4. node scripts/generate-blog-redirects.mjs  # 追加 dist/_redirects
```

任何步骤失败必须停止构建，不要 `|| true` 兜底（除了 `update-readme.yml` 的 README 自动更新场景，那里失败可以容忍）。

## 模块规范

- **副作用清晰**：脚本注释开头必须写明读写哪些文件
- **idempotent**：重复运行不应产生差异（`generate-blog-redirects.mjs` 当前是 append 模式，依赖 `astro build` 每次重写 `_redirects` 实现幂等）
- **退出码语义**：失败用 `process.exit(1)`，禁止吞错继续
- **路径**：用 `import.meta.url` + `fileURLToPath` 拿绝对路径，不假设 cwd

## 新增脚本约束

- 加入 `npm run build` 管线前先评估对构建时长的影响
- 必须在本文件登记，写明触发时机和副作用
- 不引入新依赖前先看 `package.json` 是否已有可复用工具（如 sharp、figlet、js-yaml、ajv）

## 变更日志

- 2026-04-26 — 初版
