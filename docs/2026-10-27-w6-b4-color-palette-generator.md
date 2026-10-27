# W6 batch 4 — color-palette-generator 事实核对（2026-10-27）

范围：`src/content/tools/color-palette-generator/{en,zh,ja,ko}.mdx` 与 `src/components/tools/ColorPaletteGeneratorTool.astro` 的可见文案（5 个说明气泡 × 4 语言、状态行、错误文案）。未改 `engine:start` / `engine:end`、脚本、`persistence.ts`、`network.ts`、`tools.ts`、FAQ 条数与 id、steps、seoTitle / seoDescription。基线 HEAD `c5cd5bf3`。

> 与已提交版本的关系：HEAD `f358d03c` 另有一份同名的 76 条版本。该版本的修正 1–6 与本次独立复核结论一致，对应文字已在树中；修正 7「Material HCT contrast（en:87）」在四语页面与组件中都没有对应句子（也没有 4.48 / 4.68 或 HCT 字样），属于过期或错误的证据，不并入本文件。本文件以 165 条逐句记录取代该版本。

## 修正（15 条陈述，7 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:24、zh:24、ja:24、ko:24（FAQ privacy） | 补「怎样删除已保存的设置」：清除本站数据；Ctrl/⌘+L 只清空颜色输入框，不删除设置。 | `persistence.ts:55` 为 `preference`；`ToolLayout.astro:128-246` 的 `ztPersist.clear()` 对 `preference` 直接返回，设置存于 `localStorage['zt-input-color-palette-generator']`。 |
| 2 | en.mdx:53、zh:53、ja:66、ko:53 | 新增：输入本身是超出 sRGB 的 `oklch()` 时也会先映射，基色色块是最接近的可显示颜色，状态行说明。 | `parseFunction()` 的 oklch 分支调用 `oklchTo8bit()` 并 push `mapped`（组件 549-551 行）；`note_inputMapped`（en:59 等）。原页只写了「旋转后的色」会被映射。 |
| 3 | en.mdx:56 | 「非 plain hex 都显示读取结果」改为「有效的非 6 位 HEX 输入」才显示。 | `applyInput()`：`state.readAs = /^#?[0-9a-f]{6}$/i.test(raw.trim()) ? '' : res.hex`；3/4/8 位 HEX 也会显示，无效输入显示错误而非读取结果。 |
| 4 | zh.mdx:71 | 「本工具接受这两种写法，读取结果写在状态栏」改为：`rgb()` 写状态行，6 位 HEX（带不带 #）原样使用、不写读取行。 | 同上；`3b82f6` 命中 6 位 HEX 正则，`readAs` 为空。 |
| 5 | en.mdx:70 | 导出示例补「On the OKLCH wheel」：示例第二值 `oklch(62.47% 0.1317 75.15)` 是 OKLCH 色环的补色 `#B57A00`；默认 HSL 色环的补色是 `#F6AF3B`。 | 引擎实跑：`formatValue([#B57A00],'oklch')` 与示例逐字相同；HSL 补色 `#F6AF3B` → `oklch(80.26% 0.1496 75.13)`。 |
| 6 | en.mdx:85、ja.mdx:76、ko.mdx:78 | 测试说明改为与实际一致：css-tree 解析 CSS / `@theme`、v3 配置按 CommonJS 执行、JSON 用 `JSON.parse`；Dart Sass 与 Tailwind v4 只在 `PALETTE_TOOLCHAIN_DIR` 存在时编译，否则 SKIP。 | `scripts/test-color-palette-generator.mjs:437-466`；本次运行输出 2 项 SKIP。 |
| 7 | ko.mdx:53 | 「위 두 결과도 모두 조정된 색입니다」改为「위 두 결과에도 조정된 색이 있습니다」。两组各只有 1 / 2 个色块被映射，并非整组。 | 实跑 `#FEE500`：complementary mapped=1、splitComplementary mapped=2，基色不映射。 |

## 已核对未改（要点）

- **七种配色与偏移**：complementary 0/180、split 0/150/210、analogous −30/0/30、triadic 0/120/240、tetradic 0/60/180/240（矩形）、square 0/90/180/270；非单色只旋转色相（`SCHEMES`、`rotate()`）。
- **表格数值**：四语表格 7 行 × 4 个基色全部由引擎复算一致（`#3B82F6`、`#1677FF`、`#F08300`、`#FEE500`）；MDX 的 `{/* palette: */}` 标注 24 处由测试复算，753 passed。
- **单色档位**：HSL 15 / 32.5 / 50 / 67.5 / 85%；基色 HSL L 分别为 59.80 / 54.31 / 47.06 / 49.80，最近档 67.5 / 50 / 50 / 50，基色只出现一次；OKLCH 档位 0.30–0.90（页面只描述 HSL 表）。
- **CSS Color 4 引用**：§7 为 `hsl()`/`hsla()`、§7.1 为 HSL→sRGB（2026-10-27 抓取）；§14.2.1 / §14.2.2 为二分 + 局部 MINDE，JND 0.02 逐字核实；148 个名称与 §6.1 表行数一致。
- **对比度**：`#3B82F6` 对白 3.6779、HSL 补色 `#F6AF3B` 1.8896；OKLCH triad 3.678 / 3.947 / 3.371，HSL triad 3.678 / 3.580 / 1.382；`#E24956` 对 `#3BA01B` 1.171；`#FF9E16` 2.068、`#1677FF` 4.104、`#AD7300` 4.016；`#F08300` OKLCH 三色 L 71.62 / 72.49 / 71.64、对比 1.012–1.166，HSL 1.734 / 4.279；`#0019FE` 8.171 / 6.389、`#DBDEFF` 黑字 15.905、`#FEE500` 黑字 16.422。
- **映射数量**：24 个 OKLCH 色块中 `#3B82F6` 11、`#1677FF` 13、`#F08300` 14、`#FEE500` 16（实跑）。
- **输入格式**：HEX 3/4/6/8（可无 #）、`rgb()`/`rgba()`、`hsl()`/`hsla()`（逗号与空格、角度单位）、`oklch()`、148 个名称；alpha 忽略并给说明（`#RGBA`/`#RRGGBBAA` 非 ff 也提示）；NFKC；`lab()`/`lch()`/`oklab()`/`hwb()`/`color()` 报不支持；末尾分号与整串引号被去掉。
- **隐私与统计**：只保存 space / format / code；不发送颜色（无 fetch / XHR）；`trackTool` 只在 input change、picker change、random、copy_swatch / copy_scheme_* / copy_export_* 调用；`?color=` 只读入输入框、不改写地址，页面浏览统计按完整地址记录。
- **导出与精度**：变量名为 key + 位置（CSS/Tailwind 前缀不同）；`formatValue()` 逐级增加小数直到读回同一 8 位色；`hsl(217, 100%, 61%)` = `#3884FF`、`hsl(215, 100%, 54%)` = `#1476FF` 实跑一致；Tailwind v4 的 `--color-*` 命名空间与 `@theme` 生成 `bg-*` 由官方文档核实。
- **本地事实**：Ant Design SeedToken `colorPrimary` 默认 `#1677ff`（官方 customize-theme 表）；Kakao 设计指南容器 `#FEE500`、符号 `#000000`、标签 `#000000 85%`，并规定不得使用表外颜色；Tailwind v3 `blue-500` = `#3b82f6`、v4 `blue-500` = `oklch(62.3% 0.214 259.815)`，后者超出 sRGB，工具读作 `#2B7FFF`。
- **组件可见文案**：`tipInput` / `tipWheel` / `tipFormat` / `tipCode` / `tipMapped` 四语 20 条与本轮核对的实现一致（名称数、忽略 alpha、只存设置、整数 HSL 丢色示例、◆ 与 JND）。

## 未核实

- 竞品段落 11 条为 2026-10-01 的观察，本轮未重跑：en:82/84/85（Adobe Color、Coolors）、zh:71/72（color5.com、Adobe）、ja:79/80（colortool.blog、Adobe）、ko:81/82（teck-tani.com、Adobe）。保留日期原文；其中可由引擎复算的数值（`#3C83F6`、`#3884FF`）已单独核对。
- ja:65 的 CUDO 引文（「できるだけ明度差をつけた配色にしましょう」与红绿建议）出自《CUDO 推奨配色セット ガイドブック》第 3 版 PDF；官网 HTML 未显示该句，本轮未下载 PDF 逐字核对，保留引用与链接。

## 未改（按冻结范围）

- steps 四语第 3 步仍写「基色…数值不变 / unchanged / 値は変わりません / 값은 바뀌지 않습니다」。对超出 sRGB 的 `oklch()` 输入或越界 `rgb()` / `hsl()` 输入，基色是映射 / 截断后的 8 位色。本轮在正文补了映射说明，steps 按指令未动。
- `tools.ts` 描述、`seoTitle`、`seoDescription`、FAQ id / 顺序、engine 块、测试脚本均未改。

## 来源（查阅 2026-10-27）

- CSS Color 4（CRD 2026-10-27）：https://www.w3.org/TR/css-color-4/（§6.1 名称表 148 行、§7 HSL、§14.2.1/§14.2.2 JND 0.02）
- Tailwind CSS v4 Colors：https://tailwindcss.com/docs/colors（`--color-*`、`@theme`、blue-500）
- Tailwind CSS v3 Customizing Colors：https://v3.tailwindcss.com/docs/customizing-colors（blue-500 #3b82f6）
- Ant Design Customize Theme：https://ant.design/docs/react/customize-theme（SeedToken `colorPrimary` #1677ff）
- Kakao 登录设计指南：https://developers.kakao.com/docs/latest/ko/kakaologin/design-guide（#FEE500 / #000000 85%）
- WCAG 2.2 Understanding 1.4.3：https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html（4.5:1 / 3:1）
- CUDO 推奨配色セット：https://cudo.jp/?page_id=1565（仅核实页面与 PDF 链接，引文未逐字核对）

## 测试

- `node scripts/test-color-palette-generator.mjs`：753 passed / 0 failed / 2 skipped（Dart Sass、Tailwind v4 工具链未设）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b4-color-palette-generator.json`：165 条（supported 138 / corrected 15 / qualified 1 / unverified 11），含 FAQ 逐句、正文要点与 20 条组件气泡文案。
- 本文件。工作树中其他工具的改动不属于本批。
