# W4 剩余工具移动视口检查（2026-10-27）

范围：作品级 40 个工具的 ZeroTool 生产页，视口 390 × 844 CSS px、deviceScaleFactor 1、移动模式。逐页读取 `document.documentElement.scrollWidth - clientWidth` 与 `h1`。这是布局与首屏可用性检查，不是交互流程，也不构成 W3 或 INP 证据。

## 结果

40 个页面全部满足：

- 横向溢出 `scrollWidth - clientWidth = 0`
- `h1` 与 `tools.ts` 名称一致
- 页面可纵向滚动，脚本未抛页面异常（导航超时另记，见下）

逐页记录见 `2026-10-27-w4-rest-mobile.json`。页面高度 2,322–4,684 px，属正常长页；没有把长页本身判为缺陷。

## 局限

- 本检查只读布局，没有在 390 px 下完成每个工具的真实任务；任务流程与竞品对照见批次 A 及后续批次。
- 页面加载期间出现两次 `ERR_SSL_PROTOCOL_ERROR`（`qr-code-decoder`、`color-blindness-simulator` 首次访问），同一时刻 `curl` 返回 200，重试后正常；按一次瞬时导航错误记录，不当作产品失败。
- 未模拟真实触控手势、软键盘或设备像素比 2/3；这些留给 Sir 走查。
