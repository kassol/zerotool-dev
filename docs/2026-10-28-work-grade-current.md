# 作品级当前矩阵（2026-10-28）

基线 `v1.142.6`（`6d576de1`）。本文件取代 `2026-10-24-work-grade-reassessment.md` 中的计数与判定，保留其原始证据索引。判定口径仍是 `2026-10-03-work-grade-standard.md`：通过 / 不通过 / 证据不足；缺证据不推断。

## 工具矩阵（40 个）

图例：✓ 通过；✗ 不通过；? 证据不足；◐ 已覆盖但仍有未核实项（W6）。

| 判据 | 通过 | 不通过 | 证据不足 | 说明 |
|---|---:|---:|---:|---|
| W1 结果可信 | 40 | 0 | 0 | AES 的 W1 按 v1.141.3 修复与回归改判为通过：输入 / 密钥 / 参数 / 文件 / 清空后旧任务不再写回，203 项页面回归与 32 个浏览器场景通过。其余 39 个维持 2026-10-24 的通过。 |
| W2 边界说清楚 | 40 | 0 | 0 | 沿用 2026-10-24 证据。 |
| W3 响应及时 | 0 | 0 | 40 | 本机负载窗口 14.99 / 12.08 / 8.39 / 11.40 / 11.47 / 10.09，采样期没有连续满足「前、中、后都低于 10」的窗口；10 个样本排除、30 个工具未跑，四个大文件 fixture 不在归档中；Windows 远程大文件的浏览器文件选择授权仍等 Sir 批准，试跑 0/18。见 `2026-10-28-w3-retest.md`。 |
| W4 交互顺手 | 7 | 0 | 33 | ZeroTool 主流程与键盘到达主输入框均 40 / 40 有记录（本轮 38 个，另 2 个用前批证据），本轮 13 个工具仅用键盘完成主流程。前三竞品对照：8 个 3 / 3 完成、8 个 1–2 / 3、24 个未完成；同时具备两项的 7 个。`svg-optimizer` 有 3 / 3 竞品但无键盘记录；`dns-lookup` 因前批把访客 IP 当成 A 记录，从 3 / 3 降为 2 / 3。见 `2026-10-28-w4-batch-c.md`。 |
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

- ZeroTool 真实任务：40 / 40 有输入、页面点击与结果 `scrollY` 记录；本轮重测 38 个，结果取得与否逐工具记在证据 JSON。
- 键盘到达主输入框：40 / 40 有 Tab 次数记录；本轮 13 个工具只用键盘完成主流程，加上前批的 text-to-binary、url-parser 共 15 个。
- 移动视口 390 × 844：40 / 40，横向溢出 0（前批）。
- 前三竞品完整对照（3 / 3，8 个）：json-formatter、number-base、string-escape、text-to-ascii-art、pkce-generator、text-to-binary、url-parser、svg-optimizer。
- 部分完成（1–2 / 3，8 个）：dns-lookup、markdown-table-generator、unicode-text-converter、color-shades-generator、image-to-base64、wifi-qr-code-generator、hmac-generator、color-palette-generator。
- 未完成竞品对照（24 个）：ai-token-counter、markdown-to-word、aes-encrypt-decrypt、qr-code-decoder、svg-to-png-converter、file-hash-checker、image-color-palette、totp-generator、har-file-analyzer、ssl-certificate-decoder、htpasswd-generator、css-clip-path-generator、protobuf-to-json、bcrypt-generator、json-schema-validator、openapi-validator、jq-playground、sprite-sheet-generator、cookie-parser、glassmorphism-generator、color-blindness-simulator、zero-width-character-detector、eyedropper-color-picker、qr-code-generator。
- 同时具备完整竞品对照与键盘证据的 7 个（W4 通过）：json-formatter、number-base、string-escape、text-to-ascii-art、pkce-generator、text-to-binary、url-parser。
- `svg-optimizer` 竞品 3 / 3、产物逐字节比较通过，但主流程是文件选择，未记录键盘路径，仍记证据不足。

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
- W4 从 2 个通过增到 7 个：新增 json-formatter、number-base、string-escape、text-to-ascii-art、pkce-generator；`dns-lookup` 因 A 记录未被真正核对而降为部分完成。
- W3 仍为全部证据不足：本轮采样窗口的 load average 为 11.40 / 11.47 / 10.09，10 个样本全部排除；Windows 远程大输入仍等 Sir 授权。
- S3 的实验室 LCP 已达标但自 v1.142.3 起未复测，INP 无现场数据。
- 不能宣告作品级全项通过，也不提交 AdSense 重提；这两件事等 Sir 走查后决定。
- 最终验证见 `2026-10-28-final-verification.md`。
