# W3 大输入性能修复（2026-11-03）

基线 `v1.142.8`（`40c1c344`），工作起点 `fd6d9447`。目标：把 2026-11-03 W3 采样中 10 个不通过工具在固定输入下的主线程最长任务降到 100 ms 以内，输出与行为不变，用同一套脚本复测。

测量入口：`/private/tmp/zerotool-w3-20261103/scripts/w3-fix-retest.mjs`，步骤、完成判定与 `w3-run.mjs` 相同；原始记录在 `raw/fix-samples.jsonl`（第一轮 `fix-samples-round1.jsonl`，第二轮 `round2`），不覆盖 2026-11-03 的历史样本。负载门：2026-11-03 批准的 1 分钟 load `< 15`；每个样本记录前 / 中 / 后 load。

## 测量口径变更（Sir 2026-11-03 批准）

`cookie-parser`、`markdown-table-generator`、`hmac-generator` 三项的固定输入改为用 `page.evaluate` 设置 `value` 并派发一次 `input` 事件（`inputType: 'insertFromPaste'`），再用 `Tab` 触发 `change`；输入规模、内容与 SHA-256 均不变（记录在样条的 `input` 与 `fillMethod` 字段）。原因：

- 同一台机器、同一个浏览器，用一个**没有任何工具代码**的页面（`data:text/html,<textarea>`）执行原来的 `page.fill`（CDP `Input.insertText`）：1,000 行 `Set-Cookie`（58,779 字节）产生 795 ms 长任务、2,000 个 `beforeinput` / `input` 事件；5 MiB 单行产生 545 ms 长任务。这一步与页面代码无关。
- 该插入方式逐行写入，不等同于用户的一次粘贴。用单次赋值 + 一次 `input` 更接近粘贴，也让测量反映工具自身的主线程工作。

真实用户一次性粘贴同等大小的文本时，浏览器仍要为插入与排版付出这部分成本（上表的 795 ms / 545 ms 是同一台机器上的量级），这次变更只把该成本从 longtask 统计中排除。

## 结果

10 个工具的三个样本全部 ≤ 100 ms（负载 3.7–8.6）：

| 工具 | 改前最长任务 | 复测（r1 / r2 / r3） | 墙钟 ms |
|---|---:|---|---|
| `text-to-binary` | 631 ms | 82 / 58 / 57 | 639 / 495 / 405 |
| `unicode-text-converter` | 667 ms（墙钟 31 s） | 60 / 61 / 61 | 516 / 518 / 906 |
| `markdown-to-word` | 1,629 ms | 0 / 0 / 0 | 282 / 278 / 265 |
| `image-to-base64` | 102 ms | 0 / 0 / 0 | 235 / 243 / 234 |
| `aes-encrypt-decrypt` | 167 ms | 0 / 62 / 0 | 2995 / 1951 / 2764 |
| `qr-code-decoder` | 161 ms | 65 / 0 / 65 | 1433 / 1303 / 1467 |
| `eyedropper-color-picker` | 462 ms（3 个样本中的 1 个） | 0 / 0 / 0 | 352 / 327 / 345 |
| `cookie-parser`（单次赋值） | 1,868 ms | 0 / 0 / 0 | 546 / 378 / 375 |
| `markdown-table-generator`（单次赋值） | 1,158 ms | 0 / 0 / 0 | 323 / 322 / 326 |
| `hmac-generator`（单次赋值） | 346 ms | 0 / 0 / 0 | 847 / 808 / 781 |

`0` 表示 `PerformanceObserver` 没有记录到 ≥ 50 ms 的任务，是「小于 50 ms」的上界。

## 逐工具实现

### `text-to-binary`

两个文本框加 `wrap="off"`（`TextToBinaryTool.astro`）。9 万字符的一整段此前逐字断行，插入时约 630 ms；关闭软换行后不再需要逐行计算断点。

### `unicode-text-converter`

- 输入框 `wrap="off"`（10.5 万字符的一次插入）。
- 每张卡片只渲染前 2,000 个字符（`PREVIEW_CHARS`）；`convert()` 增加可选的 `parts` / `limit` / `distinct` 参数，一次字素切分复用到 23 种样式，缺失字符仍按全文计算。「复制」调用 `fullText()`，复制与处理仍是完整文本。
- 卡片下方写明「只显示前 2,000 个字符（共 N 个），复制会复制全部」。

### `markdown-to-word`

- 引擎（解析 / 预览 HTML / .docx 构建 / 图片准备）移到 `markdown-to-word-engine.js`，页面与 Worker 共用；`test-markdown-to-word.mjs` 改为读该模块。
- 新增 `markdown-to-word.worker.js`：解析、`buildDocx`、`Packer.toBlob` 在 Worker 内运行，返回字节与图片报告；页面只负责预览 HTML 和不大于 300 个块的展示。
- 预览最多渲染 300 个块（`PREVIEW_BLOCKS`），导出仍遍历整棵树。
- 超过 20 万字符的文档不再放进可见 textarea（`LARGE_DOC`）：编辑器隐藏，显示「文档共 N 个字符」与「显示文本」；导出使用完整的 `docSource`。

### `image-to-base64`

- 超过 2 MiB 的文件（`LAZY_LIMIT`）在加载时不再生成完整 Base64；长度用文件字节数算出，「复制」与「下载 .txt」第一次使用时才按 3 MiB 分片读取编码（`encodeFile` / `materialize`）。
- 85 MiB 文件的输出仍是 118,838,638 个字符，状态、复制与下载内容不变。

### `aes-encrypt-decrypt`

- 文件加解密移入 Worker：页面把自己的 `engine:start/end` 文本取出，拼上消息处理函数，用 Blob URL 建 classic Worker，因此没有第二份引擎副本需要同步。
- Worker 读取文件、派生密钥、加密 / 解密、生成版本前缀并打包成 `Blob`；页面拿到的是 Blob 引用，不再复制 200 MB。
- 没有 Worker 时回退到页面内的 8 MiB 分片读取（测试环境走这条路径）。

### `qr-code-decoder`

- 新增 Worker：`createImageBitmap` → `OffscreenCanvas` → `getImageData` → zxing-wasm `readBarcodes`，全部在 Worker 内；页面不再解码、绘制或读取 12 MP 像素。
- Worker 返回结果与一个不超过 480 px 的预览位图（`createImageBitmap` 缩放），页面只画这个位图。
- Worker 不可用（旧浏览器、测试替身）时回退到页面原来的 canvas + wasm 路径。

### `eyedropper-color-picker`

- 打开图片时只做一次 sRGB 绘制；Display P3 副本（另一次 28 MP 绘制）改为第一次取色时再建（`p3pending`）。取色结果与 P3 读数不变。

### `cookie-parser`

- 输入防抖 150 ms（此前 1,000 个 `input` 事件各渲染一次）。
- Set-Cookie 卡片首屏 50 张、每次「显示更多」追加 200 张；JSON、脱敏副本与请求模拟仍使用全部 1,000 条。

### `markdown-table-generator`

- 超过 200 行时按 50 行一批追加网格，批间用 `scheduler.postTask` 让出；200 行及以内仍一次生成，测试与即时编辑不受影响。

### `hmac-generator`

无应用侧改动；5 MiB 的固定输入用 Sir 批准的单次赋值口径测量。

## 行为变化与取舍

- Unicode 卡片与 Markdown 预览显示的是前 N 个字符 / 块，复制与导出仍是完整内容；页面上都有说明。
- 超过 20 万字符的 Markdown 文档默认不显示编辑器，避免 960,000 字符的排版；「显示文本」会加载全文并承担一次排版开销。
- Set-Cookie 结果首屏 50 张卡片，其余按「显示更多」追加；JSON、脱敏副本和模拟仍使用全部 1,000 条。
- `markdown-to-word` 的引擎从 `.astro` 移到同目录模块，测试同步改为读模块。

## 复测脚本与原始记录

- 脚本：`/private/tmp/zerotool-w3-20261103/scripts/w3-fix-retest.mjs`；样条的 `fillMethod` 字段写明该项用的是 `CDP Input.insertText` 还是「value + one input event (Sir 2026-11-03)」。
- 原始记录：`raw/fix-samples.jsonl`（10 个工具 × 3 个样本，包含 0 ms 的样本与负载三元组）；此前的两轮在 `raw/fix-samples-round1.jsonl`、`raw/fix-samples-round2.jsonl`。
- 矩阵：`docs/2026-10-28-work-grade-current.md` / `.json` 的 W3 行改为 40 通过 / 0 不通过 / 0 证据不足。
