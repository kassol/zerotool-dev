# AGENTS.md — .github/workflows/

## 职责

GitHub Actions 工作流。两条 pipeline，目标分离明确。

## 工作流清单

| 文件 | 触发 | 作用 | 写权限 |
|------|------|------|--------|
| `ci.yml` | PR 到 `master` + push 到 `master` | audit job → build job，PR 阻塞合并 | 默认 read |
| `deploy.yml` | push tag `v*` | 构建并部署到 Cloudflare Pages | `deployments: write` |
| `update-readme.yml` | push 到 `master` 且 `src/data/tools.ts` 变化 | 自动重写 README 工具表并 commit 回 master | `contents: write` |

## ci.yml 详解

**触发**：`pull_request.branches: [master]` 与 `push.branches: [master]`。配 `concurrency.cancel-in-progress` 取消同 ref 上的旧 run。

**两个 job 串行**：
1. `audit` — `node scripts/audit.mjs`，覆盖 13 维度（tools schema / icons / route / content/tools / category 对齐 / base pages / i18n / blog 命名 / blog frontmatter / blog EN baseline / blog 多语言 / redirects 格式 / 组件孤儿）。任何 FAIL 退出 1
2. `build` — `npm run build`，依赖 audit 通过。注入空字符串到 PUBLIC_* env（生产值仅 deploy.yml 使用）。失败时上传 `dist/` artifact 便于排查

**新增检查维度**：只改 `scripts/audit.mjs`，不需要动 workflow。CI 自动覆盖。

## deploy.yml 详解

**触发**：`push.tags: ['v*']`。日常 push 不触发，只有 `git push origin vX.Y.Z` 才会跑。

**步骤**：
1. checkout
2. setup Node 22 + npm cache
3. `npm ci`
4. `npm run build` — 注入 5 个 PUBLIC_* env（GA4 + AdSense publisher + 3 slot ID）
5. `wrangler pages project create zerotool-dev --production-branch master`（continue-on-error，幂等）
6. `wrangler pages deploy dist --project-name=zerotool-dev --branch=master`

**所需 secrets**：
- `CLOUDFLARE_API_TOKEN` — 需要 Pages:Edit 权限
- `CLOUDFLARE_ACCOUNT_ID`
- `PUBLIC_GA4_MEASUREMENT_ID` — 形如 `G-XXXX`
- `PUBLIC_ADSENSE_PUBLISHER_ID` — 形如 `ca-pub-XXXX`
- `PUBLIC_ADSENSE_SLOT_TOP` / `PUBLIC_ADSENSE_SLOT_MID` / `PUBLIC_ADSENSE_SLOT_BOTTOM`

CF Pages dashboard 也有同名 env 副本（用于 preview 部署）。改 secret 时记得两处同步。

## update-readme.yml 详解

**触发**：`push.branches: [master]` + `paths: ['src/data/tools.ts']`。

**关键风险**：这个 workflow 会用 `github-actions[bot]` 身份 commit & push 回 master。如果它跑挂了或被本地的强制 push 覆盖，README 工具表会与实际工具不同步。`scripts/update-readme-tools.js` 后挂 `|| true`，失败会被吞掉，仅留下 commit step 失败的 log。

**避免冲突**：本地改 `tools.ts` 后 push 前，最好先本地跑一次 `node scripts/update-readme-tools.js` + 手动 commit README，避免 bot 后续跑时产生空 commit。

## 修改约束

- 不要在 workflow 里 echo secrets（即使是部分）
- 新增 secret 必须在根 `AGENTS.md` 的「所需 GitHub secrets」列表登记
- 新增 workflow 必须在本文件登记，写明触发条件、写权限、副作用
- 保留 `permissions:` 的最小权限原则，不用默认 `contents: write`

## 变更日志

- 2026-04-26 — 初版
- 2026-04-26 — 加入 `ci.yml`（audit + build 双 job），覆盖 PR 与 master push
