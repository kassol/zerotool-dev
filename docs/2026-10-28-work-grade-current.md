# 作品级当前矩阵（2026-10-28）

基线 `v1.142.7`（`c938cb57`）。本文件取代 `2026-10-24-work-grade-reassessment.md` 中的计数与判定，保留其原始证据索引。判定口径仍是 `2026-10-03-work-grade-standard.md`：通过 / 不通过 / 证据不足；缺证据不推断。

2026-10-28 批次 G 按 Sir 批准的「备选站」规则重测了 W4 的最后 10 个工具：前三名里某站无法完成同一任务时，按同一次搜索结果顺延取下一个可用站点补足。结果 6 个通过、4 个待 Sir 决定；W4 通过从 30 增至 36。证据见 `2026-10-28-w4-batch-g.md` / `.json`。

## 工具矩阵（40 个）

图例：✓ 通过；✗ 不通过；? 证据不足；◐ 已覆盖但仍有未核实项（W6）。

| 判据 | 通过 | 不通过 | 证据不足 | 说明 |
|---|---:|---:|---:|---|
| W1 结果可信 | 40 | 0 | 0 | AES 的 W1 按 v1.141.3 修复与回归改判为通过：输入 / 密钥 / 参数 / 文件 / 清空后旧任务不再写回，203 项页面回归与 32 个浏览器场景通过。其余 39 个维持 2026-10-24 的通过。 |
| W2 边界说清楚 | 40 | 0 | 0 | 沿用 2026-10-24 证据。 |
| W3 响应及时 | 0 | 0 | 40 | 本轮不新增采样：起始 load 11.50 / 13.28 / 14.80，中段 11.45 / 10.50 / 10.32（22:03Z），均未同时低于 10；按约定记录实际值并跳过 30 个工具的补跑。上一轮的 10 个样本排除、四个大文件 fixture 缺失与 Windows 远程大文件的文件选择授权仍等 Sir 批准（试跑 0 / 18）。见 `2026-10-28-w3-retest.md`。 |
| W4 交互顺手 | 36 | 0 | 4 | 40 个工具都走了一遍同任务：ZeroTool 鼠标主流程 40 / 40，键盘到达主输入框 40 / 40，纯键盘完成主流程 39 / 40（`eyedropper-color-picker` 的像素取样只能用指针）。竞品 3 格及以上 37 个、1–2 格 3 个（`protobuf-to-json` 1、`color-palette-generator` 2、`qr-code-generator` 2）、0 格 0 个；同时具备竞品与键盘两项的 36 个。批次 G 用备选站规则补齐最后 10 个：6 个通过，4 个待 Sir 决定（见 `2026-10-28-w4-batch-g.md`）；子代理交互观察的修复与复核见 `2026-10-28-w4-observations-fix.md`。 |
| W5 看起来是一个整体 | 40 | 0 | 0 | 沿用 2026-10-24 的 640 组四语 × 两主题 × 两视口记录。 |
| W6 说真话 | 40 | 0 | 0 | 覆盖率 40 / 40。八批共审查 4,503 条语言级陈述：supported 3,064、corrected 773、qualified 428、unverified 238；未核实项均在逐工具证据中标出，主要是带日期的竞品 / 浏览器观察与少数无法取得的一手来源。 |
| W7 有一处做得比别人好 | 40 | 0 | 0 | 沿用 2026-10-24 证据。 |

没有任何工具七项全过：W3 对全部 40 个仍为证据不足。

## W6 批次计数

| 批次 | 工具 | 陈述 | supported | corrected | qualified | unverified |
|---|---|---:|---:|---:|---:|---:|
| 1 | dns、markdown-to-word、qr-decoder、aes、totp | 406 | 311 | 42 | 44 | 9 |
| 2 | ssl、cookie、bcrypt、hmac、json-schema | 488 | 315 | 102 | 44 | 27 |
| 3 | zero-width、svg-to-png、ascii、unicode、file-hash | 636 | 403 | 157 | 45 | 31 |
| 4 | image-to-base64、pkce、ai-token、color-palette、color-shades | 569 | 426 | 66 | 46 | 31 |
| 5 | eyedropper、wifi、color-blindness、har、qr-generator | 574 | 385 | 87 | 66 | 36 |
| 6 | string-escape、htpasswd、number-base、clip-path、protobuf | 646 | 493 | 75 | 50 | 28 |
| 7 | text-to-binary、url-parser、markdown-table、image-palette、svg-optimizer | 653 | 394 | 147 | 61 | 51 |
| 8 | json-formatter、openapi、jq、sprite、glassmorphism | 531 | 337 | 97 | 72 | 25 |
| **合计** | **40** | **4,503** | **3,064** | **773** | **428** | **238** |

逐工具记录：`2026-10-25-w6-statements.json`（第 1 批）、`2026-10-27-w6-b{2..8}-{slug}.md` / `.json` 与对应批次汇总。

## W4 覆盖明细

- ZeroTool 真实任务：40 / 40 有输入、页面点击、结果或产物与 `scrollY` 记录；40 个工具全部重测。
- 键盘到达主输入框：40 / 40 有 Tab 次数记录；纯键盘完成主流程 39 / 40。`eyedropper-color-picker` 的图片像素取样只能用指针（画布 `tabIndex` −1，没有键盘光标）；`protobuf-to-json` 现在可以只用键盘完成（含原生 .proto 选择框，全程 84 次 Tab）。
- 移动视口 390 × 844：40 / 40，横向溢出 0（前批）。
- 竞品 3 格及以上（37 个）：ai-token-counter、bcrypt-generator、color-blindness-simulator、color-shades-generator、cookie-parser、css-clip-path-generator、dns-lookup、file-hash-checker、glassmorphism-generator、har-file-analyzer、hmac-generator、htpasswd-generator、image-to-base64、json-formatter、json-schema-validator、markdown-table-generator、markdown-to-word、number-base、pkce-generator、qr-code-decoder、sprite-sheet-generator、ssl-certificate-decoder、string-escape、svg-optimizer、svg-to-png-converter、text-to-ascii-art、text-to-binary、unicode-text-converter、url-parser、zero-width-character-detector，加上批次 G 的 aes-encrypt-decrypt（4）、image-color-palette、jq-playground、openapi-validator、totp-generator、wifi-qr-code-generator、eyedropper-color-picker（4）。
- 部分完成（1–2 格，3 个）：protobuf-to-json（1 / 6）、color-palette-generator（2 / 10）、qr-code-generator（2 / 10）。
- 未完成（0 格）：0 个。
- W4 通过（竞品 3 格及以上 + 键盘 + 主流程，36 个）：上列 37 个中除 `eyedropper-color-picker` 外的 36 个。
- 外部阻塞：0 个。批次 E 的 4 个已按备选站规则处理：`openapi-validator` 顺延到 OpenFormatter，`totp-generator` 的 totp.app 在 Add 之后有密钥字段（批次 E 记的「无表单」不成立），`wifi-qr-code-generator` 顺延到 TEC-IT / qifi，`qr-code-generator` 顺延后只有 2 个站点能交付 PNG。
- 待 Sir 决定（4 个，不是通过）：`eyedropper-color-picker`（是否加键盘光标）、`protobuf-to-json`（该次结果仅 1 / 6 可完成）、`color-palette-generator`（2 / 10）、`qr-code-generator`（2 / 10，问题在 PNG 是否算唯一产物）。

## 站点矩阵（S1–S5）

| 项 | 判定 | 依据 |
|---|---|---|
| S1 首页与目录 | 通过 | 韩文 `json 포맷` 别名召回修复（v1.141.3），143 项搜索回归；四语首页 / 目录 32 组、192 次查询通过。 |
| S2 一致性 | 通过 | 内容 parity 7,753 项，141 个工具全部规则；640 组布局记录保持。 |
| S3 速度 | 证据不足 | 移动端实验室 LCP 在 v1.141.3 部署后为 1.67–1.74 s（五页中位数，Google PSI，2026-10-24），CLS 0.00000–0.00129；v1.142.3 起的 `site.css` 提取与 CSS chunk 重命名没有复测。CrUX 现场数据仍为 No Data，INP 无法判定。测量记录在仓库外 `strategy/work-grade-fixes-2026-10-24/README.md`，口径见 `2026-10-24-work-grade-fixes.md`。 |
| S4 可信页面 | 通过 | About / 隐私 / 条款 / 联系 / 语言样本 200；披露与敏感页控制有当前回归。 |
| S5 没有明显缺陷 | 通过 | 845 个构建 HTML、1,033 个同源目标；404 页路径归一化兜底；本轮构建与浏览器检查未新增坏链或页面异常。 |

## 结论

- W6 覆盖完成，W1 的 AES 改判完成；W5 / W7 / W2 沿用既有通过。
- W4 从 30 个通过增到 36 个：批次 G 把最后 10 个工具按备选站规则重测，6 个通过（aes、jq、image-color-palette、openapi、totp、wifi），4 个待 Sir 决定（eyedropper 键盘取舍、protobuf 1 / 6、color-palette 2 / 10、qr 2 / 10）。
- W3 仍为全部证据不足：本轮 load 11.45 / 10.50 / 10.32 未达门槛，30 个工具未补跑；Windows 远程大输入仍等 Sir 授权。
- S3 的实验室 LCP 已达标但自 v1.142.3 起未复测，INP 无现场数据。
- 不能宣告作品级全项通过，也不提交 AdSense 重提；这两件事等 Sir 走查后决定。
- 最终验证见 `2026-10-28-final-verification.md`。
