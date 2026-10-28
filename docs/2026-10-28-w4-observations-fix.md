# W4 交互观察修复（2026-10-28）

范围：`docs/2026-10-28-w4-batch-e.md`「子代理报告的 ZeroTool 交互观察」中记录、尚未改代码的 7 条。基线 `v1.142.6`（HEAD `6220ac65` 之后只有文档提交），本地构建用 `npm run build`，`wrangler pages dev dist` 在 `127.0.0.1:8820` 提供，ego-browser（Chromium 152）视口 1366 × 900、DPR 1。生产站 `https://zerotool.dev` 只用于复现记录里已有的坐标。

约束：不改受保护 `engine:start/end` 块，不改隐私与统计策略，四语可见文案同步。最终没有改动任何引擎块；隐私与统计策略未改。

## 结论

| 项 | 结果 |
|---|---|
| 1 动作按钮在输入之前 | 已修 3 个工具（AES / bcrypt / sprite）；同一累计口径的 Tab 次数从 57 / 53 / 85 降到 17 / 14 / 42 |
| 2 SSL 解码卡片离输入太远 | 未复现为「卡片从 y≈1316 开始」；记录证据后跳过 |
| 3 htpasswd 关闭折叠区的按钮排到工具框外 | 已修；关闭的 `<details>` 不再布局 |
| 4 HAR 默认摘要看不到字面 404 | 已修；概览 findings 写出状态码 |
| 5 color-blindness 首张卡片超出首屏 | 已修；首行 3 张卡片底边 876.47 < 900 |
| 6 zero-width 清理结果框下沿超出 65 px | 已修；底边 897.95 < 900 |
| 7 bcrypt 成本 12 的耗时文案 | 无合格 load 窗口；四语文案与数字未改，只记录（见第 7 节） |

本轮修复不改变任何工具的三项判定。本文基线时的 W4 计数为 30 个通过、4 个外部阻塞、6 个缺口；之后批次 G 的 W4 更新见 `2026-10-28-work-grade-current.md` / `2026-10-28-w4-batch-g.md`。

## 1. 动作按钮排在输入之前

### 复现（生产 / 本地一致）

从页面顶部按 Tab，记录到主输入与动作按钮的次数：

| 工具 | 记录值（从页面顶部累计） | 本轮复现值（改前） | 现象 |
|---|---:|---:|---|
| aes-encrypt-decrypt | 56 到 Encrypt（记录写 57 次 Tab） | 10 到 Encrypt，12 到 plaintext | Encrypt 在 plaintext 之前，输入后要绕整页 |
| bcrypt-generator | 53 到 Generate hash | 11 到 Generate hash，15 到 password | 同上 |
| sprite-sheet-generator | 85 到 Download PNG（7 选图 + 25 到格式 + 53 到下载） | 7 到 Select images；下载在格式选项之前 | 选完图与格式要绕回下载 |

### 改法

- AES：把 `.aes-actions` 从 `.aes-keybar` 移到 `.aes-io` 之后（DOM 顺序变成 key → plaintext → ciphertext → actions），根元素从 flex column 改为 grid，`grid-template-areas: "keybar actions" / "feedback feedback" / "io io" / "note note"` 把按钮放回 key 旁边的视觉位置；≤860px 单列时 areas 变成 keybar / actions / feedback / io / note。
- bcrypt：生成面板把 `.bcg-actions` 移到密码字段之后，验证面板移到两个字段之后；`.bcg-panel` 内用 `order` 把按钮放回密码上方、状态行之前的视觉位置。
- sprite：把 `.ssg-export` 移到选项面板之后（Tab 先经过图片格式、名称和复选框），`.ssg-rail > *` 用 `order` 把导出块放回状态行之后、图片列表之前。

没有改任何按钮 id、事件绑定、引擎或文案。

### 改后实测

| 工具 | 改后 Tab 次数 | 视觉位置 |
|---|---|---|
| aes-encrypt-decrypt | key 8、plaintext 12、Encrypt 17 | keybar 与 actions 同一行 y=192–233；io y=274–825；note 仍在底部 |
| bcrypt-generator | password 13、Generate 14 | opts y=246、actions y=327、status y=378、password y=459（与改前视觉顺序相同） |
| sprite-sheet-generator | Select images 7、Image format 29、Sheet name 33、Download PNG 42 | 导出块 y=469、图片列表 y=619、选项 y=934（与改前视觉顺序相同） |

桌面与 390 × 844 均横向溢出 0：AES 手机 keybar y=308–400、actions y=404–448；bcrypt 手机 actions y=454–498、password y=610–654；sprite 手机拖放区 y=282–462。静态回归见 `scripts/test-aes-encrypt-decrypt.mjs`、`test-bcrypt-generator.mjs`、`test-sprite-sheet-generator.mjs` 新增的 DOM 顺序与 order 断言。

## 2. SSL 解码卡片从 y≈1316 开始 — 未复现，跳过

用 `fixtures/w4-cert.pem`（1,241 字节）在本地页面粘贴，输入框从空状态的 511 px 收到 128 px，结果容器 `#scd-results` 的顶边是 **524.66**，不是 1316。结果里的第一张链卡片 524.66–715.06，链项里的 `w4.example` 在 **618.74**，首屏可见。

`w4.example` 的下一处出现是详情卡片里的主题行 `CN=w4.example,O=ZeroTool W4,C=US`，位于 **1316.11**；它是详情卡片的一行文本，不是卡片起点。W4 记录里的 1316 与这一行完全吻合，判断是当时把详情里的主题行当成了「解码卡片」的起点。工具已经在首屏显示链卡片与证书名，不改代码。

证据：本地页面 `#scd-results` 顶边 524.66，第一张卡片 524.66–715.06，链项名 618.74，主题行 1316.11；`scrollY` 0。生产站 v1.142.7 清空后粘贴同一 PEM 的坐标相同（结果 524.66、链项名 618.74、主题行 1316.11）。

## 3. htpasswd 关闭的批量折叠区按钮排到工具框外

复现：关闭的 `#htpw-batch-section` 里 `.htpw-section-body` 的计算样式仍是 `display: flex`（作者样式覆盖了 UA 对关闭 `<details>` 子元素的 `display: none`），`#htpw-batch-run` 在文档 y=1011.8–1051.8，工具框底边 870.0。`.htpw-options-body` 同样受影响。

改法：只加两条规则，恢复关闭状态：

```css
.htpw-options:not([open]) > .htpw-options-body,
.htpw-section:not([open]) > .htpw-section-body { display: none; }
```

改后：`#htpw-batch-section` 的 body 计算 `display: none`，rect 全 0；`#htpw-batch-run` rect 全 0，工具框底边 869.98，页面不再有工具框外的可见按钮。回归断言在 `scripts/test-htpasswd-generator.mjs`。

## 4. HAR 的 404 要点开请求行才看得到

复现：载入 2 个请求（200 + 404）的 `w4.har` 后，默认 Overview 的 findings 只有「1 request returned 4xx or 5xx」，页面文本里没有字面 `404`；切到 Requests 页签后请求行本身已有 `404`，不需要点开请求行。W4 记录里「要点开请求行」不准确，但默认概览确实看不到具体码。

改法：Overview 的 findings 在 4xx/5xx 数量后追加实际状态码（数字，不新增四语文案）：

```text
1 request returned 4xx or 5xx (404)
```

改后：载入后不切页签，`#har-findings` 文本为 `1 request returned 4xx or 5xx (404)`，页面文本含 `404`。多码时按数值列出，例如 `(404, 500)`。回归断言在 `scripts/test-har-file-analyzer.mjs`。

## 5. color-blindness 首张卡片底部超出首屏

复现：载入 `palette-2x2.png` 后，首行卡片 y=441.09–944.21，底边超出 900 视口 44.21 px；卡片画布 422.74 × 422.74。

改法：只在 ≥861px 限制卡片的方形预览高度，按窗口高度收回并保持比例：

```css
@media (min-width: 861px) {
  .cbs-card-canvas { max-height: clamp(220px, calc(100svh - 545px), 420px); object-fit: contain; }
}
```

改后：画布 422.74 × 355（object-fit: contain，内容不拉伸），首行 3 张卡片 y=441.09–876.47，底边在 900 以内；横向溢出 0，手机断点不受影响。回归断言在 `scripts/test-color-blindness-simulator.mjs`。

## 6. zero-width 清理结果框下沿超出 65 px

复现：输入 `a\u200Bb` 后，`#zwcd-cleaned` y=844.80–964.80，下沿超出 900 视口 64.80 px。原因是结果栅格里统计栏高 264.85 px，预览降到 50.41 px 也不影响栅格高度。

改法：只在 ≥861px 限制结果栅格的高度并允许内部滚动，清理框留在栅格下方：

```css
@media (min-width: 861px) {
  .zwcd-viz-wrap { max-height: clamp(160px, calc(100svh - 686px), 280px); }
  .zwcd-grid { max-height: clamp(160px, calc(100svh - 702px), 280px); overflow: auto; }
}
```

改后：栅格高 198（900 视口），`#zwcd-cleaned` y=777.95–897.95，底边 897.95 < 900；横向溢出 0。手机仍用原来的 420 px 结果滚动区。回归断言在 `scripts/test-zero-width-character-detector.mjs`。

## 7. bcrypt 成本 12 的耗时文案

页面文案由一次成本 8 的同步 bench 外推（`ms × 2^(12−8)`），W4 记录页面写 1.8 s、实际 8.8 / 9.9 s。本轮在 load 1 分钟 53–83 的高负载窗口复测：页面估计 362 ms，实际一次 6.5 s（load 前 53.47，中段 53.5–54.5，后 54.48），样本不合格（要求 load 前 / 中 / 后均 < 10），未据此改数字。

低负载窗口：从 08:50 到 09:16 每 30 秒检查一次 load 1 分钟，最低约 36.9（全量测试结束后），从未低于 9.5；同机 `node`、Nowledge Mem、Xcode、magpie 等进程持续占用 CPU。没有合格样本，四语文案与数字保持原样，只记录。高负载下实际耗时远大于外推值，与 bcryptjs 异步 hash 每约 100 ms 让出后用 `setTimeout` 续跑、机器繁忙时回调被推迟一致；这不构成改数字的依据。

## 生产站复核（v1.142.7 部署后）

在 `https://zerotool.dev` 用同一组输入复测：HAR 概览 findings 为 `1 request returned 4xx or 5xx (404)` 且页面文本含 `404`；htpasswd 关闭的批量区 body 计算 `display: none`、`#htpw-batch-run` rect 全 0；color-blindness 首张卡片 441.09–876.47，画布 `max-height` 355px；zero-width 清理框 777.95–897.95，栅格高 198；AES 从页面顶部 Tab 到 plaintext 12、到 Encrypt 17。部署后的页面与本地构建一致。

## 验证

- 定向测试：`test-aes-encrypt-decrypt` 532、`test-bcrypt-generator` 1713、`test-sprite-sheet-generator` 1498、`test-htpasswd-generator` 1579（1 SKIP，本机 htpasswd 无 SHA-2 crypt）、`test-har-file-analyzer` 2191、`test-color-blindness-simulator` 1127、`test-zero-width-character-detector` 1375，全部 0 失败。
- `node scripts/audit.mjs`：24 PASS / 0 WARN / 0 FAIL。
- 构建：`npm run build` 通过，564 个工具页 CSS 顺序检查通过。
- 全量 `scripts/test-*.mjs`（Node 22.23.3）：结果见下方「全量测试」。
- 浏览器：改后 1366 × 900 与 390 × 844 的布局、Tab 次数、结果坐标见各节；未重算 W4 竞品矩阵，因为本轮没有改变任何工具的三项判定。

## 全量测试

Node 22.23.3（CI 版本）依次运行 `scripts/test-*.mjs` 170 个脚本，全部退出 0，`TOTAL_FAILED=0`；输出中的 SKIP 仍是各脚本原有的可选工具链 / 平台项（本机共 14 行）。日志在仓库外 `w4-obs/test-all.log`。

## 完成判定

- 已修并验证：第 1、3、4、5、6 条。
- 未复现，按约定跳过：第 2 条；证据见第 2 节。
- 条件关闭，未改数字：第 7 条；没有 load 前 / 中 / 后均 < 10 的窗口，按任务约定只记录。
- 没有剩余代码工作；本轮未改 W4 判定。基线时为 30 通过 / 4 外部阻塞 / 6 缺口；批次 G 之后以 `2026-10-28-work-grade-current.md` 为准。
