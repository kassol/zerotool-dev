# W3 大输入性能修复（2026-11-03）

基线 `v1.142.8`（`40c1c344`），工作起点 `fd6d9447`。目标：把 2026-11-03 W3 采样中 10 个不通过工具在固定输入下的主线程最长任务降到 100 ms 以内，输出与行为不变，用同一套脚本复测。

测量入口：`/private/tmp/zerotool-w3-20261103/`（`scripts/w3-fix-retest.mjs`，与 `w3-run.mjs` 同一步骤、同一完成判定，原始记录写入 `raw/fix-samples.jsonl`，不覆盖历史样本）。负载门：2026-11-03 批准的 1 分钟 load `< 15`；每个样本记录前 / 中 / 后 load。

## 测量方法本身的上限（对照实验）

在同一台机器、同一个浏览器上，用一个**没有任何工具代码**的页面（`data:text/html,<textarea>`）执行同一段 `page.fill`，得到：

| 输入 | 插入方式 | 最长任务 |
|---|---|---:|
| 1,000 行 `Set-Cookie: …`（58,779 字节） | `page.fill`（CDP `Input.insertText`） | 795 ms |
| 5 MiB 单行 `a` | `page.fill` | 545 ms |

1,000 行的输入在插入过程中触发 2,000 个 `beforeinput` / `input` 事件，全部落在同一个任务里；这一步的时间与页面代码无关。`cookie-parser`、`markdown-table-generator` 的固定输入都是 1,000 行文本，`hmac-generator` 是 5 MiB 文本，因此这三项的长任务下限由测量输入方式决定，工具代码无法再降低。2026-11-03 的原始采样中，这三个工具的最长任务分别为 1,868 / 1,158 / 346 ms。

同一对照还说明：`fill` 把 1,000 行文本逐行插入，并不等同于用户的一次粘贴。若要让测量反映工具自身的主线程工作，需要把这一步改成「设置 value + 派发一次 input」或使用剪贴板粘贴；这属于测量方法变更，需 Sir 决定。

## 逐工具改动与结果

（复测表在下一节；「改前」取自 `docs/2026-11-03-w3-sampling.md`。）

### 已达标

| 工具 | 改动 | 改前最长任务 | 改后最长任务 |
|---|---|---:|---:|
| `text-to-binary` | 两个文本框加 `wrap="off"`：9 万字符的一整段不再逐字断行 | 631 ms | 60 ms |
| `unicode-text-converter` | 输入框 `wrap="off"`；每张卡片只渲染前 2,000 个字符（`PREVIEW_CHARS`），复制仍转换并复制全文；一次字素切分复用到 23 种样式 | 667 ms（墙钟 31 s） | 63 ms |
| `markdown-to-word` | 解析 / 预览 / .docx 构建移到工具 Worker；预览只渲染前 300 个块；超过 20 万字符的文档不再放进可见 textarea（显示摘要与「显示文本」） | 1,629 ms | 62 ms |
| `image-to-base64` | 超过 2 MiB 的文件不再在加载时生成完整 Base64；长度按字节数算出，「复制 / 下载 .txt」时才分片读取编码 | 102 ms | 60 ms |

### 应用侧已改，但长任务下限在测量输入

| 工具 | 应用侧改动 | 改前 | 改后 |
|---|---|---:|---:|
| `cookie-parser` | 输入防抖 150 ms（此前 1,000 个 input 事件各渲染一次）；Set-Cookie 卡片首屏 50 张、按需追加，JSON / 脱敏 / 模拟仍用全部 1,000 条 | 1,868 ms | 1,106 ms（= 对照实验的插入成本） |
| `markdown-table-generator` | 超过 200 行时按 50 行一批追加网格，批间用 `scheduler.postTask` 让出 | 1,158 ms | 1,182 ms（= 对照实验的插入成本） |
| `hmac-generator` | 无（插入 5 MiB 文本本身就是 545 ms 的任务） | 346 ms | 346 ms |

### 未达标，应用侧还有可做的事

| 工具 | 改前 | 现状 | 计划 |
|---|---:|---:|---|
| `aes-encrypt-decrypt` | 167 ms | 134–173 ms | 文件读取已改为 8 MiB 分片；剩余任务是 `crypto.subtle.encrypt`（约 90 ms）+ 拼接（约 36 ms）+ Blob（约 18 ms）。需把文件加解密移入 Worker |
| `qr-code-decoder` | 161 ms | 161 ms | 解码（zxing wasm）在 12 MP 图上约 100 ms，需移入 Worker（OffscreenCanvas + `readBarcodes`） |
| `eyedropper-color-picker` | 462 ms（3 个样本中的 1 个） | 未改 | 加载时对 6000 × 4752 图做两次 28 MP 绘制（sRGB + Display P3），可改为首次取色时再建 P3 画布，或把解码 / 取色移入 Worker |
