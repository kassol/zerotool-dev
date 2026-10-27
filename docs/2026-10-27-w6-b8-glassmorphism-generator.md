# W6 batch 8 — glassmorphism-generator 事实核对（2026-10-27/28）

范围：`src/content/tools/glassmorphism-generator/{en,zh,ja,ko}.mdx` 的 FAQ 与正文，以及 `src/components/tools/GlassmorphismGeneratorTool.astro` 的可见文案。未改 `engine:start/end`、逻辑、`steps`、`seoTitle`、FAQ 条数 / id / 顺序、`persistence.ts`、`network.ts`、统计代码与测试。基线 `d6b1e116`。

## 口径

- 实现主张以组件 file:line 为准；外部事实只用本轮抓取的一手来源（MDN browser-compat-data、W3C Filter Effects Level 2 编辑草案）。
- 竞品段落是 2026-10-02 的观察，本轮不重跑，日期保留，记为 qualified。
- 四语同题同改；无法核实的本地背景（微信配置、DADS、KRDS）不改，记为 unverified。
- 抓取 11 次（预算 10）：BCD 的 media-feature 路径连续 404，多花了 3 次；4 次拿到内容（其中微信页只返回导航壳）。见 JSON `fetch_log`。

## 总量

共审查 128 条语言级陈述：supported 89、corrected 12、qualified 20、unverified 7。

| 语言 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 31 | 23 | 2 | 5 | 1 |
| zh | 33 | 23 | 3 | 5 | 2 |
| ja | 32 | 21 | 4 | 5 | 2 |
| ko | 32 | 22 | 3 | 5 | 2 |

差异来自拆分条目：forced-colors 与 opaque-mode 的 ja（+ ko）单列修正，本地条目 zh / ja / ko 各 1。

## 修正（6 组，按语言计 12 条）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en:28 / zh:28 / ja:28 / ko:28（`privacy`） | 统计触发的描述从「成功生成代码的控件变更（松开滑块、离开颜色框）」改为列出真实触发集合：松开滑块、离开改过的颜色框、切换输出格式、预览背景、预览状态；无事件列表补上「重置」与系统偏好变化。 | `GlassmorphismGeneratorTool.astro:282-286` 的 wrap 级 `change` 处理器同时接收 `#gsg-preset`（:287）与 `#gsg-state`（:128）的变更，这两个只重绘预览、不改导出代码，同样发 `generate`。页面加载（:321）、键入（:278-281）、无效设置（:272-275）、文件选择（:283 早退）、重置（:302-306）与 `matchMedia` 变化（:319）不发。 |
| 2 | 同上 4 处 | 「设置同样不保存，刷新页面后恢复默认值」改为「设置不写入浏览器存储」。 | 组件无 `ztPersist` / storage（测试 :117 断言），`persistence.ts` 也没有该 slug。刷新后是否恢复默认还取决于浏览器对 range / select 的表单状态恢复，本轮未实测，因此删去该保证，只保留可证伪的存储事实。 |
| 3 | ja:25（`opaque-mode`） | 「OSの設定に対応するメディアクエリ」改为点名 `prefers-reduced-transparency` 与 `forced-colors`。 | 两种输出都含这两个媒体块（:160-164）；其余三语已点名（en:25、zh:25、ko:25）。 |
| 4 | ja:63 | 强制颜色模式补「フィルターも無効にします」。 | forced 块同时写 `-webkit-backdrop-filter: none; backdrop-filter: none`（:158）。 |
| 5 | ko:63 | 同上，改为「그림자와 필터를 없애며」。 | 同 :158；与 en:58 / zh:63 对齐。 |
| 6 | zh:81 | 「需要改偏移与扩散时」改为「需要改偏移与模糊时」。 | 固定值 `0 4px 24px` 是 offset-x、offset-y、blur，没有 spread（:155）。 |

## 已核对未改（要点）

- **默认值与示例**：白 15% / 12px / 180% 对应 `ranges` 与 `presets`（:70-76、:189）。四语第二个示例的填充值与回退对比度逐项复算：en `rgba(17, 34, 51, 0.60)` / 16.14、zh `rgba(0, 51, 102, 0.70)` / 12.60、ja `rgba(0, 23, 193, 0.75)` / 11.09、ko `rgba(0, 34, 68, 0.80)` / 16.00；默认 18.8831 → 18.88 与「截断到两位」一致（:246）。
- **回退结构**：先写 `background: fallback` 与两个 `none`，再由 `@supports (backdrop-filter: blur(0px)) or (-webkit-backdrop-filter: blur(0px))` 加半透明填充与滤镜（:154-157、:163）。前缀不提供可读回退，与四语正文一致。
- **状态规则**：`prefers-reduced-transparency` 恢复回退色并去掉滤镜，`glass-opaque` 在 CSS 为 `.glass.glass-opaque`、在 Tailwind 为 `&.glass-opaque`；关闭透明效果时 `@supports` 整块不输出（:160-164）。
- **强制颜色**：`background: Canvas`、`color: CanvasText`、`border-color: CanvasText`、`box-shadow: none`、两个滤镜 `none`（:158）；Tailwind 编译后仍保留该媒体查询（测试 :49）。
- **Tailwind v4**：`@utility glass`、`class="glass"`、需放进导入 Tailwind 的样式表；`package.json:45` 为 `^4.3.3`，安装版本 4.3.3，测试用真实编译器生成并断言 `.glass` 与 `forced-colors`（测试 :51-57）。
- **backdrop root**：Filter Effects Level 2 编辑草案（2026-10-02）§3 把 `filter`、`opacity < 1`、`mask` / `clip-path`、`backdrop-filter`、`mix-blend-mode`、`will-change`（会创建 root 的属性）列为触发条件，并明确 transform 不创建 Backdrop Root；正文的 2026-10-02 观察与机制一致。「尚未获得工作组共识」逐字对应草案 §3 与 Issues Index（issue 53）。
- **对比度估计**：Canvas 先 `blur()+saturate()`（:232），再按 `a*fill + (1-a)*pixel` 合成（:176），取卡片内缩矩形（`paddingLeft + borderWidth`）内的最低像素（:237-239），使用指定文字色而非字形像素（:173）。三行固定为 glass / unsupported / reduced（:244-248），与气泡文案一致。
- **WCAG**：4.5 / 3.0 阈值在 :180，显示截断在 :246；`4.499` 不通过经测试断言。正文与 SC 1.4.3 一致。
- **兼容性**：MDN BCD（今日抓取）为 Chrome 76、Edge 79、Firefox 103、Safari 18（无前缀），Safari 9 起有 `-webkit-`；四语版本号全部正确。BCD 另注 Firefox 123 前在未知 GPU 厂商的系统上不支持，页面未写，属省略而非错误。
- **可见文案**：9 个气泡的范围（blur 0–40、saturation 0–200%、border 0–4、radius 0–40、shadow 0–60%）与 `ranges`（:71-76）一致；state 气泡的「不改导出」与 `#gsg-state` 只影响预览（:261-264）一致；contrast / scope / system / forced 文案与 :241-248、:268-270 一致；空状态与图片错误文案与 :272-275、:299 一致。
- **隐私与网络**：脚本无 `fetch` / XHR / `sendBeacon` / storage / `innerHTML`（测试 :117）；`network.ts` 与 `persistence.ts` 均无该 slug；图片仅经 `URL.createObjectURL` + `Image.decode` 进入 canvas 预览（:295-296），退出时 revoke（:300）。`trackTool` 只在 `change` 且 `generate()` 成功时调用（:285），与改写后的隐私题一致。
- **steps**：5 条对应实际控件与按钮，条数 / 长度未变。

## 观察未改

- **qualified**：图片上限写作 20 MB，代码是 `20 * 1024 * 1024` 字节（20 MiB，:293），像素上限 `> 50,000,000` 才拒绝（:296）。对用户是「接受得比写的多」，未改文案，避免与全站其他工具的 MB 写法分叉。
- **qualified**：竞品段落（css.glass、Hype4）是 2026-10-02 的桌面 Chromium 观察，本轮未复测，日期保留。
- **qualified**：backdrop-root 的 Chromium 观察（filter / opacity / will-change / translateZ）同样是 2026-10-02 的实测，本轮只核了规范机制，未重跑浏览器。
- **unverified**：`prefers-reduced-transparency` 的具体版本（Chromium 118、Firefox 偏好开关、Safari 未列出）。MDN 页面今日仍标 Experimental / Limited availability / not Baseline，但兼容表由脚本渲染，BCD 的 media-feature 文件路径连续 404（`prefers-reduced-motion` 同样 404，说明是路径约定变了），未拿到逐项数据，正文未改。
- **unverified**：zh 的微信 `app.json` 两项（`navigationBarBackgroundColor` 为 HexColor、`navigationBarTextStyle` 限 black / white）。抓取只得到导航壳，未读到正文；按已知官方文档保留。
- **unverified**：ja 的 DADS（JIS X 8341-3:2016 AA、逐步追加 WCAG 2.1 / 2.2）与 ko 的 KRDS 魔法数字（50 = 4.5:1、40 = 3:1）。本轮未抓取这两个站点，保留原文。

## 来源（2026-10-27/28 抓取）

- MDN browser-compat-data，`css/properties/backdrop-filter.json`：<https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/backdrop-filter.json>
- W3C Filter Effects Module Level 2（Editor's Draft, 2 October 2026）：<https://drafts.csswg.org/filter-effects-2/>
- MDN `prefers-reduced-transparency`：<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-transparency>
- 微信小程序全局配置（只返回导航壳，未采信）：<https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html>

## 测试

- `node scripts/test-glassmorphism-generator.mjs`：122 passed / 0 failed（改后）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：23 PASS / 0 WARN / 1 FAIL。FAIL 为 `src/content/tools/url-parser/en.mdx:13` 的绝对措辞检查，该文件与 `UrlParserTool.astro` 在本共享工作树中已被其他批次修改，不属本工具范围；glassmorphism 四语页不在 FAIL 列表内。
- 未跑 `npm run build`（按要求）。

## 交付物

- 本文件。
- `docs/2026-10-27-w6-b8-glassmorphism-generator.json`：128 条语言级陈述、修正明细、来源与抓取记录。
