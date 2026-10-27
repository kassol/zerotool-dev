# 作品级复评与性能取证（2026-10-24）

> 本文是 v1.141.2 的修复前快照。三项问题的后续实现与验收见 [修复记录](2026-10-24-work-grade-fixes.md)；下方矩阵和基线数字保留原样。2026-10-28 的当前覆盖与判定见 [当前矩阵](2026-10-28-work-grade-current.md)。

基线：`v1.141.2` / `a9191f94b7f65cc6ca326e78bdc86b8df731aab7`。用户授权推进 W3/S3 性能补测与当前版本作品级复评。范围沿用原定 40 个精品工具 × W1–W7，以及站点 S1–S5。

**当前复评已形成完整判定矩阵；本机工具性能资格尚未完成。** 本轮确认三项产品问题：AES 过期结果写回、移动端实验室 LCP 不达标、韩文搜索别名漏召回。W3 的低负载采样、W4 的竞品动作对照、W6 的完整逐句出处表仍缺证据。当前没有工具可以宣告七项全过。

## 判定口径与范围

- 沿用 `2026-10-03-work-grade-standard.md`：每项为通过、不通过、证据不足。缺证据不推断为代码缺陷；旧自评数字不沿用到当前版本。
- 本地性能只接纳采样前、中、后一分钟 load average 均低于 10 的样本；串行执行，记录实际输入大小、哈希、可见性、最长任务及完成时间。未接纳的样本不用于通过或失败的时间判定。
- 远端 PageSpeed 是移动端实验室证据；No Data 保留为现场数据不足。TBT 不能替代 INP。
- AES 使用真实 Web Crypto。测试仅在文档内控制 deriveKey Promise 的完成时机，用于验证异步状态；没有替换算法，也没有把该延迟计入性能成绩。
- 实际完成四语言 × 两主题 × 两视口的 640 组截图与几何记录；代理目视抽查，用户自己的最终走查尚未进行。
- 本轮只增加评估文档和独立证据，未改产品源码、未部署、未提交 AdSense。

## 工具复评

✓ 通过；✗ 不通过；? 证据不足。

| 判据 | 通过 | 不通过 | 证据不足 |
|---|---:|---:|---:|
| W1 | 39 | 1 | 0 |
| W2 | 40 | 0 | 0 |
| W3 | 0 | 1 | 39 |
| W4 | 0 | 0 | 40 |
| W5 | 40 | 0 | 0 |
| W6 | 0 | 1 | 39 |
| W7 | 40 | 0 | 0 |

W4 的历史竞品记录主要比较正确性、联网与输出内容，缺少同一任务下前三竞品的点击与必要滚动次数，因此不能当作 W4 完整证据。W6 已完成当前处理、存储、联网披露的核对与 1,457 条四语候选陈述索引，但该索引还没有全部转成逐句 T7 出处表，因此保守记为证据不足。AES 的状态字节数错误另有直接失败证据。

| 工具 | W1 | W2 | W3 | W4 | W5 | W6 | W7 |
|---|---|---|---|---|---|---|---|
| zero-width-character-detector | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| totp-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| markdown-to-word | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| dns-lookup | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| aes-encrypt-decrypt | ✗ | ✓ | ✗ | ? | ✓ | ✗ | ✓ |
| qr-code-decoder | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| svg-to-png-converter | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| text-to-ascii-art | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| unicode-text-converter | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| file-hash-checker | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| image-to-base64 | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| pkce-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| ai-token-counter | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| text-to-binary | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| color-palette-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| color-shades-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| eyedropper-color-picker | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| wifi-qr-code-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| color-blindness-simulator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| har-file-analyzer | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| qr-code-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| ssl-certificate-decoder | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| string-escape | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| htpasswd-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| number-base | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| css-clip-path-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| protobuf-to-json | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| bcrypt-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| url-parser | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| markdown-table-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| image-color-palette | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| svg-optimizer | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| hmac-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| json-schema-validator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| json-formatter | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| openapi-validator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| jq-playground | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| sprite-sheet-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| cookie-parser | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |
| glassmorphism-generator | ✓ | ✓ | ? | ? | ✓ | ? | ✓ |

各格详细证据、历史差异点及当前回归日志索引见同目录 `2026-10-24-work-grade-results.json`。历史优势保留实测日期，不把旧竞品快照写成今天的行为。

## 站点复评

| 项目 | 自评 | 当前依据 |
|---|---|---|
| S1 | 不通过 | raw/site-search.jsonl: 48 actual search tasks; 44 find the expected tool.；raw/finding-inspections.json: json 포맷 returns no results; json 정렬 returns json-formatter; 141 unique cards and 11 populated categories. |
| S2 | 通过 | Current content parity 7,753 checks pass across all 141 tools.；640 current layout combinations retain the common v2 shell; existing final S2 closure remains valid. |
| S3 | 不通过 | Five remote Moto G Power/Slow 4G PageSpeed laboratory reports: mobile LCP 5.2–5.5 s; CLS 0.；All five report No Data for field experience; a field INP verdict remains unavailable.；Remote laboratory runs are independent of this Mac's load. No local high-load interaction duration is used to qualify INP. |
| S4 | 通过 | Production About/privacy/terms/contact and language samples return 200.；Current network/persistence disclosures and sensitive-page controls have current regression coverage. No email was sent; mail delivery is outside this check. |
| S5 | 通过 | 845 built HTML pages, 1,033 same-origin destinations; no missing navigational destination or asset. The sole /404/ entry is the 404 document's own canonical metadata.；640 tool-page combinations have zero observed page exceptions/rejections; 14 current production HTTP checks return 200. |

## 移动端性能

Google 远端 Lighthouse 13.5.0，Moto G Power，Slow 4G，单页初始加载。原始文字报告与截图均归档。

| 页面 | 移动端 LCP | TBT | CLS | 现场数据 |
|---|---:|---:|---:|---|
| `/` | 5.4 s | 50 ms | 0 | No Data |
| `/tools/` | 5.3 s | 80 ms | 0 | No Data |
| `/tools/json-formatter/` | 5.4 s | 20 ms | 0 | No Data |
| `/tools/dns-lookup/` | 5.2 s | 40 ms | 0 | No Data |
| `/tools/gif-compressor/` | 5.5 s | 130 ms | 0 | No Data |

GIF 页的详细报告指出了共享与本工具 CSS 的渲染阻塞、LCP 文本元素的呈现延迟，以及广告与 FundingChoices 脚本的未使用字节。这些是定位线索，尚不足以归因全部 LCP 延迟。需要做逐项差分测量，再决定优化方式。

本机负载门记录见 `raw/performance-load-gate.json` 与 `raw/serial-performance-gate.json`。40 个固定输入方案见 `raw/performance-workloads.json`。重生成的 8 个历史文本/JSON夹具全部 SHA-256 一致；已消失的历史照片和 HAR 不伪造为同一输入，新增合成图片/HAR明确记为新基线。需要分开观察文件打开、计算与导出；准备好的脚本及合并动作诊断窗口不能自动当作完成资格认定。

## 修复队列

### P1 · AES-ASYNC-01：旧异步任务在修改或清空后写回

复现一：输入 `ORIGINAL_SYNTHETIC_MESSAGE` 并开始加密，在派生密钥尚未完成时改成 `REPLACEMENT_INPUT`，再让真实运算完成。页面写回旧消息的 99 字符密文，却报告当前输入的 17 字节；随后用真实页面解密，得到原来的 26 字节消息。

复现二：加密尚未完成时在工具内按 Ctrl/⌘+L，观察到密码、明文和密文都已清空。旧任务完成后，密文重新出现，复制仍可用，状态显示“Encrypted 0 bytes”。

依据：`src/components/tools/AesEncryptDecryptTool.astro:793` 的任务没有输入代次校验；`:820`/`:829` 直接写回结果，`:821` 用当前明文重新计算字节数；`:853` 的清空分支没有使旧任务失效。对应原始记录 `raw/aes-async.jsonl`，两张复现截图。

验收建议：任务开始时固定输入、密钥设置、文件和字节数；编辑、换文件、清空时使旧任务失效；提交结果前校验任务身份。为修改输入、清空、解密迟到结果与文件切换增加确定性回归。先修 UI 状态层，保留受保护计算引擎。

### P1 · MOBILE-LCP-01：五个代表页面的移动端实验室 LCP 为 5.2–5.5 秒

先定位共享 CSS 的关键路径、首屏文本呈现和第三方脚本对加载的贡献，再分别验证改动。用相同移动端配置重复测量首页、目录、JSON、DNS、GIF页；现场 LCP/INP 数据不足仍单列。当前不能宣告 S3 达标。

### P2 · SEARCH-KO-01：韩文格式化别名没有召回 JSON Formatter

`json 포맷` 在首页/目录、1366/390 两视口共 4 次均未找到目标；独立复查仍返回 0 条。对照 `json 정렬` 返回 `json-formatter`。卡片名是 `JSON Formatter (JSON 정렬)`，当前别名仅含另外三种语言的名称。证据：`raw/site-search.jsonl`、`raw/finding-inspections.json`、韩文复现截图。

验收建议：补充对应的韩文任务别名与回归用例，保持现有分词和排序行为；确认四个组合都能找到目标，且 `gif 압축` 等已有查询保持正常。

## 检查与局限

- 当前 Node 22.23.3：audit **24 PASS / 0 WARN / 0 FAIL**；生产构建成功；564 个工具页 CSS 顺序通过；40 个工具加内容/搜索等共 **44 个回归脚本**均退出 0。外部工具链版本或未安装导致的 SKIP 保留在日志中。
- 640 组布局记录：页面横向溢出 0、捕获到的页面异常/未处理拒绝 0。两个工具栏的越界探针来自其内部横向滚动；Markdown 预览中的行内链接和禁用任务框不算交互目标缺陷。
- 845 个构建 HTML、1,033 个同源目标。唯一物理文件匹配例外是 `404.html` 自己的 `/404/` canonical，未发现缺失的可导航目标或静态资源；14 个生产 HTTP 样本全部 200。静态目标检查与在线抽样的覆盖范围分别保留。
- 设计探针 29 条提示已分类：文字中的 `<img>`、运行时才赋 src 的隐藏预览，以及既有语义边框不当作坏图或设计缺陷。两处进度条 width transition 只作为待测线索，未据此宣判超时。
- 所有 40 个工具的组件、四语内容与测试共 240 个源文件指纹保持不变。现有测试通过没有覆盖住本轮发现的 AES 迟到任务场景。
- 当前复评不能作为重提 AdSense 的通过证明。用户最终走查与实际重提仍是后续步骤。

完整证据目录：`/Users/kassol/Documents/zerotool-daily-metrics/strategy/work-grade-2026-10-24`。原始索引、截图、回归日志、固定输入清单、采样负载和可重放脚本由归档清单校验。
