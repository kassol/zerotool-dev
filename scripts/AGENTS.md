# AGENTS.md — scripts/

## 职责

构建管线辅助脚本与维护工具，全部用 Node 直接跑（`.mjs` 或 `.js`），无 TypeScript 编译步骤。

## 文件清单

| 脚本 | 类型 | 用途 | 何时跑 |
|------|------|------|--------|
| `check-icon-coverage.mjs` | 校验 | 比对 `tools.ts` 与 `icons.ts`，缺图标即 exit 1 | `npm run build` 第 1 步 |
| `generate-og.mjs` | 生成 | 用 sharp（librsvg 渲染 SVG 模板）为每个工具（4 语言）与每篇博客生成 1200×630 OG 图，输出到 `public/og/{slug}[-{lang}].png` 与 `public/og/blog-{slug}[-{lang}].png`（EN 无后缀；构建产物，已 gitignore）。工具 name/description 从 `tools.ts` 每行的 `en/zh/ja/ko: { name, description }` 解析（支持单/双引号与反斜杠转义），任一工具缺任一语言即列出 slug 并 exit 1；工具图底部 badge 按语言本地化（措辞沿用 `src/i18n/*.json` 的 `tool.trustFree` / `hero.sub`）。`src/layouts/ToolLayout.astro` 按同一命名规则（`toolOgFileName()`）引用。标题与描述按估算字宽断行（拉丁单词不拆、CJK 逐字可断、基础禁则），各最多 3 行，超出末行加「…」。zh/ja/ko 工具图与博客图的 `<svg>` 带 `xml:lang`，字体栈以 `Noto Sans CJK SC/JP/KR` 开头，构建机需装 Noto CJK 字体（CI 在 build 前 `apt-get install fonts-noto-cjk`）；`CI` 环境变量为真且 `fc-list :lang=ja/zh/ko` 任一为空时 exit 1。被 import 时不生成图片 | `npm run build` 第 4 步 / `npm run generate-og` |
| `check-tool-css-order.mjs` | 校验 | 读 `dist/` 下 4 语言工具页 HTML 与 `dist/about/index.html`，按文档顺序列出 `<head>` 里的 CSS（`<link rel=stylesheet>` 与内联 `<style>`，先去掉 `<script>` 内容）。也出现在 about 页的算全站 CSS，不检查；出现在 ≥2 个工具页面的算共享工具 CSS（tool-common、ToolLayout、ShareButtons、AdUnit）；只出现在 1 个工具页面的算本工具 CSS。任一工具页有本工具 CSS 排在共享工具 CSS 之前、有本工具 CSS 却没有共享工具 CSS、或 `<head>` 里出现内联 `<style>`（`astro.config.mjs` 设了 `build.inlineStylesheets: 'never'`，打包 CSS 应全部外链；Astro 内联时会把相邻 chunk 合并成一个 `<style>`，块内顺序本脚本查不到），即列出页面并 exit 1。仓库目前没有 `<style is:inline>`；以后若有组件在 `<head>` 加 `is:inline` 样式也会被拦下，应改回组件普通 `<style>`。只写 stdout/stderr | `npm run build` 第 6 步（astro build 之后）；也可 `node scripts/check-tool-css-order.mjs [distDir]` |
| `generate-blog-redirects.mjs` | 后处理 | 扫 `src/content/blog/{baseSlug}/{zh,ja,ko}.mdx`，向 `dist/_redirects` 追加旧语言后缀 URL → 新目录 URL 的 301 | `npm run build` 第 7 步 |
| `sync-jq-web.mjs` | 同步 | 把 jq-web 运行时从 `node_modules` 复制到 `public/jq-web/`（gitignored），供 `jq-playground` 加载 | `npm run dev` / `npm run build` 前置步骤 |
| `sync-sql-js.mjs` | 同步 | 把 `node_modules/sql.js/dist/` 的 `sql-wasm.js` + `sql-wasm.wasm` 复制到 `public/sql-js/`（gitignored），供 `SqliteViewerTool` 选文件后懒加载 | `npm run dev` / `npm run build` 前置步骤 |
| `update-readme-tools.js` | 文档同步 | 用 `tools.ts` 的 slug + EN name 重写 README 的 `<!-- TOOLS-START/END -->` 段 | CI workflow `update-readme.yml` 在 master 分支 `tools.ts` 变化时自动跑 |
| `audit.mjs` | 巡检 | 全项目静态一致性审计：tools schema / 图标覆盖 / registry 映射（`registry.ts` 覆盖 `tools.ts` 全部 slug、组件文件存在、无孤儿组件）与工具路由注入（`astro.config.mjs` 从 registry 注入、`src/pages` 下无静态 `tools/[...]` 路由） / content/tools 多语言 / category 类型与 UI 对齐 / 基础页面齐全 / i18n key 对齐 / blog 命名 + frontmatter / _redirects 格式 / public 与 src/pages 下无 AGENTS.md | `.github/workflows/ci.yml` PR + master push 自动跑；本地 `node scripts/audit.mjs`（FAIL 退出码 1） |
| `audit-slug-aliases.mjs` | 巡检 | 审计 `_redirects` 与 slug 的对应关系，发现孤儿规则 | 手动按需 |
| `test-har-invariant.mjs` | 回归 | spec-driven 不变式测试：3 层（spec sum / 新算法 mirror / 旧错算法 regression guard）× 10 fixture；守住 HAR `connect + ssl` 双计 bug 不复发 | 手动按需 / 修改 `HarFileAnalyzerTool.astro` phase 逻辑前后 |
| `test-barcode-symbology.mjs` | 回归 | spec-driven 条码编码测试：从 `BarcodeGeneratorTool.astro` 抽取真实编码块（不 mirror，杜绝漂移），3 层（表结构不变式 / 已知校验位向量 / 独立解码器 round-trip）共 497 项 | 手动按需 / 修改 `BarcodeGeneratorTool.astro` 编码表或子集切换逻辑前后 |
| `test-secret-redactor.mjs` | 回归 | spec-driven 脱敏引擎测试：从 `SecretRedactorTool.astro` 抽取 `engine:start/end` 之间的真实代码，覆盖 26 条规则正例 + 已知误报反例、同值同占位符、重叠裁决、既有占位符跳号、还原往返与容错、缺失/未知占位符、1,000,000 字符耗时 | 手动按需 / 修改 `SecretRedactorTool.astro` 规则表或占位符逻辑前后 |
| `test-sqlite-viewer.mjs` | 回归 | 从 `SqliteViewerTool.astro` 抽取 `engine:start/end` 真实引擎块，用 node_modules 的 sql.js 建库，覆盖文件头校验、标识符转义、表/视图/索引列举、分页 SQL、CSV 转义（NULL / BLOB hex / 引号 / 换行）、内存副本写入与 schema 变化检测，共 34 项 | 手动按需 / 修改 `SqliteViewerTool.astro` 引擎块前后 |
| `test-pixelate-image.mjs` | 回归 | 从 `PixelateImageTool.astro` 抽取 `engine:start/end` 真实引擎块（`pixelate`/`normalizeRect`/`toImageCoords`），覆盖块平均值正确性（含不整除边缘块、alpha 加权与全透明块）、区域合成仅改区域内像素、`normalizeRect` 反向拖拽与越界裁剪、`toImageCoords` 坐标缩放映射，共 31 项 | 手动按需 / 修改 `PixelateImageTool.astro` 引擎块前后 |
| `test-gif-splitter.mjs` | 回归 | 从 `GifSplitterTool.astro` 抽取 `engine:start/end` 真实引擎块，测试内用独立 LZW 编码器构造 GIF 夹具，覆盖 GIF87a/89a 头校验与非 GIF 拒绝、单帧、disposal 0/1/2/3 合成、透明色、隔行、局部色表、LZW 码宽增长至 12 位与 clear code / 表满不清表、截断文件与非法码容错、循环次数、延迟映射、0×0 逻辑屏幕、越界帧、解码预算、选帧范围、文件名、雪碧图布局与 JSON、CRC32 与 STORED ZIP（回读解析 + 可用时 `unzip -t`，临时文件写入 `os.tmpdir()` 并清理）、分段解码（1 像素到超过整帧的多种分段大小与一次性解码逐像素一致，`lzwRun` 按上限停下并在码字中途续解）、帧内中途放弃后无残留状态、图像数据按子块链原地读取（码跨子块边界、长度 0 终止块、截断在子块头 / 子块中、链上逐字节截断与拷贝读取一致），共 224 项 | 手动按需 / 修改 `GifSplitterTool.astro` 引擎块前后 |
| `test-sprite-sheet-generator.mjs` | 回归 | 从 `SpriteSheetGeneratorTool.astro` 抽取 `engine:start/end` 真实引擎块，覆盖自然排序、帧名去重、图集文件名清洗、CSS 类名、SVG 固有尺寸、trim 包围盒（含全透明，与暴力解对比）、`nextPow2`、canvas 上限、填充率、MaxRects 装箱（固定种子随机 200 组：无重叠、在图集内、spacing / margin / extrude 间距不变式、Max width、2 的幂、超宽自动加宽；等尺寸紧密排布；超限结果；1000 张耗时与近方形）、网格单元格与居中坐标、JSON Hash / JSON Array / Sparrow XML / CSS 结构与转义，共 726 项；只写 stdout | 手动按需 / 修改 `SpriteSheetGeneratorTool.astro` 引擎块前后 |
| `test-check-tool-css-order.mjs` | 回归 | import `check-tool-css-order.mjs` 的导出函数，覆盖 CSS 资源提取（link 顺序、内联 style、非 stylesheet link、JSON-LD 中的 `<style>` 文本、body 内 style）、全站 / 共享 / 本工具分类、顺序规则与报错信息、工具页 `<head>` 内联 `<style>` 即失败（含全站内联样式、内联块排在共享 CSS 前的双重失败）、无本工具 CSS 的页面跳过、`os.tmpdir()` 下的夹具 dist 端到端（用后删除）、直接运行的退出码，共 26 项 | 手动按需 / 修改 `check-tool-css-order.mjs` 或工具路由入口的 import 顺序前后 |
| `test-generate-og.mjs` | 回归 | import `generate-og.mjs` 的导出函数，覆盖英文不拆词、CJK 按宽度断行、中英混排、禁则、3 行上限加「…」、标题与描述及底部 badge 不重叠、XML 转义、空描述、各语言字体栈与 `xml:lang`；`tools.ts` 4 语言解析（含转义引号、缺 zh/ja/ko 时报错并列出 slug、真实注册表全量解析）、工具图文件名、slug 不以 `-zh/-ja/-ko` 结尾（防 `{slug}-{lang}.png` 重名）、工具 badge 本地化 | 手动按需 / 修改 `generate-og.mjs` 断行或模板前后 |
| `deploy.sh` | 部署 | 本地构建 + `wrangler pages deploy`（需 `PROJECT_NAME` env） | 手工部署兜底 |
| `devto-article-draft.md` | 内容草稿 | 非脚本，是发到 dev.to 的草稿 | — |

## 构建管线（npm run build）

```
1. node scripts/check-icon-coverage.mjs   # 缺图标即停
2. node scripts/sync-jq-web.mjs           # 复制 jq-web 运行时到 public/jq-web/
3. node scripts/sync-sql-js.mjs           # 复制 sql.js 运行时到 public/sql-js/
4. node scripts/generate-og.mjs           # 生成 public/og/*.png
5. astro build                            # 编译到 dist/
6. node scripts/check-tool-css-order.mjs   # 工具页共享工具 CSS 须排在本工具 CSS 之前
7. node scripts/generate-blog-redirects.mjs  # 追加 dist/_redirects
```

## CI 巡检管线（.github/workflows/ci.yml）

```
audit job  →  node scripts/audit.mjs   # 全维度静态校验，FAIL 阻塞
build job  →  npm run build            # 完整构建烟囱测试，依赖 audit job 通过
```

新增检查维度时只改 `audit.mjs`，CI 自动覆盖；不需要改 workflow 文件。

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
- 2026-04-26 — 加入 `audit.mjs`（13 维度静态校验）+ CI 巡检管线说明
- 2026-05-22 — 加入 `test-har-invariant.mjs`（HAR waterfall spec-driven 回归测试，3 层 × 10 fixture）
- 2026-08-01 — 加入 `test-barcode-symbology.mjs`（条码符号集 spec-driven 回归测试；从组件源码抽取编码器 + 独立解码器 round-trip）
- 2026-09-23 — 加入 `test-secret-redactor.mjs`（secret-redactor 检测/脱敏/还原引擎 spec-driven 回归测试；从组件源码抽取引擎块）
- 2026-09-23 — `audit.mjs` 新增 `no_published_agents_md`：`public/`、`src/pages/` 下出现 AGENTS.md 即 FAIL
- 2026-09-23 — 加入 `sync-sql-js.mjs`（sqlite-viewer 的 sql.js WASM 运行时同步到 `public/sql-js/`）
- 2026-09-23 — 加入 `test-sqlite-viewer.mjs`（sqlite-viewer 引擎块回归测试，真实 sql.js 执行）
- 2026-09-23 — 加入 `test-pixelate-image.mjs`（pixelate-image 像素化/坐标映射引擎块回归测试）
- 2026-09-25 — 加入 `test-gif-splitter.mjs`（gif-splitter GIF 解析 / LZW / 帧合成 / ZIP 引擎块回归测试）
- 2026-09-25 — `generate-og.mjs` 改为按估算字宽断行（CJK 可断、基础禁则、3 行上限加「…」、描述随标题行数下移）；zh/ja/ko 博客图指定 Noto Sans CJK 字体与 `xml:lang`；CI 下缺 CJK 字体即 exit 1；import 时不执行生成。加入 `test-generate-og.mjs`
- 2026-09-25 — `generate-og.mjs` 为 zh/ja/ko 工具页生成 `{slug}-{lang}.png`（此前 414 个非 EN 工具页共用英文图），工具图 badge 按语言本地化；`tools.ts` 解析改为 4 语言且支持转义引号（修正 `eyedropper-color-picker` 英文描述在 `browser\'s` 处被截断），缺语言即 exit 1。生成数 650 → 1064 张
- 2026-09-25 — `generate-og.mjs` 先收集全部图片任务，再按 `os.availableParallelism()` 并发渲染（每张渲染基本单线程，串行时多核闲置）；输出与串行版本逐字节一致，1064 张本地耗时 41.0s → 12.7s
- 2026-09-25 — `test-gif-splitter.mjs` 跟随 gif-splitter 帧内分段解码（`createLzw`/`lzwRun` 状态对象 + `compositeSteps` 生成器，`createCompositor(gif, chunk).step()`）：新增分段与一次性解码逐像素一致、中途放弃无残留状态、图像数据按子块链原地读取的测试，120 → 224 项
- 2026-09-25 — 加入 `test-sprite-sheet-generator.mjs`（sprite-sheet-generator 命名 / trim / MaxRects 与网格布局 / 4 种数据格式引擎块回归测试）
- 2026-09-26 — 加入 `check-tool-css-order.mjs`（`npm run build` 第 6 步，工具页 CSS 顺序守护）与 `test-check-tool-css-order.mjs`；`audit.mjs` 的路由检查改为校验 `registry.ts` 的 slug → 组件文件名映射与 `toolRoutes()` 注入（不再检查 4 个 `[slug].astro`）
- 2026-09-26 — `check-tool-css-order.mjs` 新增断言：工具页 `<head>` 不得有内联 `<style>`（配合 `astro.config.mjs` 的 `build.inlineStylesheets: 'never'`，消除 Astro 合并内联 CSS 造成的顺序检查盲区）；测试 20 → 26 项
