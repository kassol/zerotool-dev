# W6 batch 5：color-blindness-simulator 内容核对（2026-10-27）

基线 `f358d03c`。范围：`src/content/tools/color-blindness-simulator/{en,zh,ja,ko}.mdx`、`src/components/tools/ColorBlindnessSimulatorTool.astro` 的可见文案与页面行为、`src/data/persistence.ts`、`src/data/network.ts`。逐条证据见同目录 `2026-10-27-w6-b5-color-blindness-simulator.json`。

## 口径与总量

外部事实用 2026-10-27 抓取的一手来源：Webvision《Color Perception》Table 1、Chromium `vision_deficiency.cc`、MDN canvas maximum size、Gao & Tian 2023（Int J Ophthalmol）PDF、Simunovic 2010（Eye）摘要、CUDO 指南 PDF。实现主张以组件 file:line 为准；2026-10-02 的竞品观察保留原日期，未复测的数字按历史观察记录。

FAQ 按条核对 20 条答案，正文按声明核对 78 条，组件可见文案分 12 组，另核 4 条 seoDescription。共 114 条陈述：supported 82、corrected 9、qualified 12、unverified 11。

| 工具 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| color-blindness-simulator | 114 | 82 | 9 | 12 | 11 |

未改：FAQ 条数 / id / 顺序、steps、seoTitle、`engine:start/end` 块、`persistence.ts` / `network.ts`、统计调用与脚本。

## 修正要点

- **画布上限（4 语 FAQ `max-size`）**：「所有主流浏览器都接受的画布上限 / the largest canvas every current browser accepts」改为 iOS Safari 的 4,096 × 4,096（MDN：iOS 设备的 canvas 上限即此值），并写明 16,777,216 是**面积**上限。`fitImageSize` 只按面积缩放（`ColorBlindnessSimulatorTool.astro:839-845`），极端长宽比的图片可能超过浏览器边长上限，PNG 导出会失败（`downloadType` 捕获后显示 `renderFailed`，`:1256-1287`）。四语同步。
- **P3 占比（4 语 Limits）**：补上代码里的两个条件——占比按**预览**（缩略图）统计，且只在 ≥ 0.1% 时显示（`gamutShare` 用 `th.w` / `th.h`，`:1018-1027`；`share >= 0.001`，`:1036-1037`）。原文只说「浏览器能按 Display P3 读取时提示」，会让人以为任意比例都会显示。
- **ja 的「純色」（标题、表头、正文）**：`#008000` 是 CSS 色名 `green`（半亮度绿），不是纯色；这组颜色实际是 CSS 色名 `red` / `green` / `blue` / `yellow`。改为「CSS 色名」，HEX 与已复算的 ΔEOK / 对比度不变（0.166 / 1.33 等仍由引擎复算）。

## 核验与保留

- **患病率表**逐项与 Webvision Table 1 一致：deuteranomaly 5% / 0.4%、deuteranopia 1.5% / 0.01%、protanomaly 1% / 0.01%、protanopia 1% / 0.01%、tritanopia 0.008% / 0.008%、总体约 8% / 0.5%；tritanomaly 与各类 monochromacy 原文为 rare。
- **Chromium 源码**确认 FAQ 的说法：DevTools 的 protanopia / deuteranopia / tritanopia 用 Machado 1.0 矩阵的 3 位小数版本，另有 achromatopsia 滤镜，没有异常色觉模式；`#2CA02C` 在 P3 屏的 32 级差异由 `test-color-blindness-simulator.mjs` 的 24 色对照复算。
- **中文研究** PDF 摘要：17,303 人中 381 人（2.20%），男 368（4.11%）、女 13（0.16%），与 zh 段一致。
- **Eye 摘要**只确认 8% 男性 / 0.5% 女性，未包含 zh / en 引用的「视杆单色视 1/33,000–50,000」；该句标 unverified，未改数字。
- 全部带 `cbs-check` 标注的示例由引擎复算通过；未加标注的数值也复核过：MUI 四色在全部 8 种模拟下任一对对比度最大 2.07:1（页面「都低于 3:1」成立）；KRDS 四色白底 4.559–4.651:1、互比最大 1.020:1、全色盲 0.000；xuecan 的 0.567 矩阵在线性光下复现 rgb(192,190,43) / rgb(146,147,105)，Toolpods 在 sRGB 值上复现 rgb(77,79,135) / rgb(177,175,18)，imageonline 复现 #9F8F36。

## 发现的问题

- **B 档（已在文案写明，代码未改）**：画布检查只有面积，没有边长。`fitImageSize`（`ColorBlindnessSimulatorTool.astro:839-845`，与 `EyedropperColorPickerTool.astro` 逐字共享）对 16,000 × 1,000 这类图片放行，但 iOS Safari 的 4,096 边长上限会让 `canvasFor` / `getImageData` 失败，PNG 导出报错。要修需同时限制边长，并同步两个组件与测试里的逐字比对。
- **C 档**：`zh` 的限制段比 `en` / `ja` / `ko` 少两条（严重程度只作用于三种色弱、手机不能用屏幕截取），不是错误，覆盖不同。
- **C 档**：ja 卡片用「3型（強度）/ 3型（弱度）」，FAQ 用「2色覚 / 異常3色覚」；`local-type-names` 一题已解释对应关系，未统一标签。
- **C 档**：`tips.open` 的格式清单只写 PNG / JPEG / WebP / GIF / AVIF / SVG，`isImageFile` 还接受 BMP、ICO、HEIC / HEIF、TIFF（`:1072-1074`），后两者另有一句浏览器解码说明。
- **C 档（未复核）**：Eye 的 1/33,000–50,000、日本眼科学会 5% / 0.2%、人卫临床助手 5% / 0.7%、KDCA 5.9% / 0.4%、KNHANES 2014–2015 细项、CUDO 第 3 版 Q4 与 CUD 検証描述，今天没有重新抓取原文；CUD 指南 PDF 为图片版，四个 HEX 无法从文本确认。均保留原引用并标 unverified。

## 验证

- `node scripts/test-color-blindness-simulator.mjs` → 1126 passed, 0 failed
- `node scripts/test-tool-content-parity.mjs` → 7753 passed, 0 failed
- `node scripts/audit.mjs --quiet` → PASS 24、WARN 0、FAIL 0
- 未跑 `npm run build`（按要求）。

## 剩余

本文件只覆盖 `color-blindness-simulator` 一个工具；同批其他工具与其他批次的进度不在本文统计。
