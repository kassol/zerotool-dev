# W6 batch 7 — image-color-palette 事实核对（2026-10-27/28）

范围：`src/content/tools/image-color-palette/{en,zh,ja,ko}.mdx` 与 `src/components/tools/ImageColorPaletteTool.astro` 的可见文案（9 个状态 / 气泡字符串 × 4 语言）。未改 `engine:start` / `engine:end`、客户端脚本逻辑、`persistence.ts`、`network.ts`、`tools.ts`、FAQ 条数与 id、steps、seoTitle / seoDescription。工作树中其他工具的 W6 改动不属于本批。

基线：`src/data/persistence.ts:56` 为 `preference`；`src/data/network.ts` 的联网工具清单不含本工具。

## 修正（38 条陈述，12 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en:13、zh:13、ja:13、ko:13（FAQ privacy） | 补「清除本站数据删除设置」，统计动作改为与实际事件一致（extract、sample、copy、copy code、export_gpl、export_ase）。 | 设置经 `ztPersist.save(SLUG, state)` 保存 `k / sort / pick / vivid / ignoreWhite / ignoreBlack / code / values`（组件 920-943）；`Ctrl/⌘+L` 的 `clearAll()` 只清图片与色板、保留设置（1426-1446）；`track('extract')` 1194、`sample` 1400、`copy` 993、`copy_code` 1373、`export_gpl` 1359、`export_ase` 1365。 |
| 2 | en:22、zh:22、ja:22、ko:22（FAQ fewer-colors） | 「visible pixels 落在少于 k 个组」改为「过滤后剩下的组少于 k」：状态行报的是 `included.length`，不是全部可见像素的分组数。 | `extractPalette()` 先按 `ignoreWhite` / `ignoreBlack` 分出 `included`，`res.groups = included.length`（748-756）；`fewer` 只在 `result.groups < result.k` 时显示（1232）。 |
| 3 | en:25、zh:25、ja:25、ko:25（FAQ export） | `.gpl` 文件名不是只有 HEX：条目名为 `#HEX (序号, 占比)`。改为「以 HEX 值命名；.gpl 条目还带位置与占比」。 | `gplFile()` 853 行 `toHex(e.rgb) + ' (' + (i + 1) + ', ' + fmtShare(...) + ')'`；`.ase` 名为纯 HEX（873）。 |
| 4 | zh:19、zh:46 | 「像素按不透明度计权」改为「加权」。 | 同一句的四语对照（en / ja / ko 均为 weighted / 重み付け / 가중）；代码 620 行 `wt = a / 255`。 |
| 5 | en:60、zh:48、ja:61、ko:47（CSS Color 4 链接） | `#binsearch` 不是当前 CSS Color 4 的锚点，改为 `#GM-chroma-local-MINDE`（§14.1.5 给出「one JND is an OkLCh difference of 0.02」）。 | 2026-10-27 抓取 CSS Color 4 ED：§14.1.5、§14.2.1 `#GMA-Binary-local-MINDE`、§14.2.2 `#pseudo-binsearch`；文档中不存在 `binsearch` 锚点。`MERGE_DE = 0.02`（组件 600）。 |
| 6 | en:64、zh:52、ko:49（导出段） | 原文说所有代码导出都「命名为 palette-1..n 并把占比写进注释」。实际：值列表无名称 / 占比，JSON 无注释且固定 hex + RGB + OKLCH + share；Tailwind v3 的键为 `palette: {1..n}`。改为分格式说明。 | `exportCode()` 817-839：`list` 只 `join('\n')`；`css` / `tw4` / `scss` / `tw3` 才写 `fmtShare` 注释；`json` 固定 `{hex, rgb, oklch, share}`。 |
| 7 | en:42、en:45（Starry Night 示例） | 原文未说明 Swatch 设置：列的是 Cluster average，下一段却换成 most common shades。补「Swatch = Cluster average」，下一段补「Swatch 回到 Most common shade」。 | 默认 `state.pick = 'common'`（920）；两段 `icp-check` 分别带 `"pick":"average"` 与默认 common（43、46、48 行）。 |
| 8 | ja:49（最も多い色合いの定義） | 「そのクラスタで最も多くの画素を占める色合い」错：实现取的是**最重颜色组**的 shade；组内某色过半才是精确源色，否则是该组平均。改为实现定义。 | `extractPalette()` 760-776：`heavy` 为最大 `g.w` 的成员组，`common = included[heavy].shade`；`shade` 由 `match * 2 > count` 决定精确色或组均值（625-641）。 |
| 9 | ja:72、ko:58（竞品网络观察） | 「どのページも / 세 페이지 모두」把 node-vibrant（库，不是页面）也算进去。改为点名实际检查的两个网站：patto-tool.com / imageonline.io（ja）、vivoldi / imageonline.io（ko）。 | 2026-10-02 记录为「均未观察到上传请求」；node-vibrant 4.0.4 在 Node 中运行，没有页面请求可测。日期保留。 |
| 10 | en:79、zh:75、ja:78、ko:64（P3 限制） | 状态行只在 gamut ≥ 0.001 时显示；原文说「给出比例」会让 0.05% 看起来像 0%。补「达到 0.1% 时显示」。 | `gamutNote()`：`im.gamutState === 'done' && im.gamut >= 0.001` 才 `fill(t.gamut, …)`（1125-1129）；`fmtShare` 截断到一位小数（811-814）。 |
| 11 | en:80、zh:76、ja:79、ko:65（GIF 限制） | 「只取第一帧」对 `<img>` + `drawImage` 不成立：读到的是绘制当时显示的那一帧。改为「只取一帧（读取时显示的那一帧），不读整段动画」。 | `openFile()` 用 `new Image()` + `decode()` 后 `setImage()` 直接 `drawImage`（1182-1195、1131-1139），没有定位帧 0 的代码。 |
| 12 | 组件 72、149、226、303（`fewer` 状态） | 「The visible pixels fall into…」与 FAQ 同样的问题：改为「After the filters / 过滤后 / フィルター後 / 필터 후」。 | 同修正 2。 |

## 已核对未改（要点）

- **采样与分组**：`SAMPLE_AREA = 262144`（596）；`fitImageSize()` 按面积缩小（546-552）；采样画布 `imageSmoothingEnabled = false`（1137）。`BIN_BITS = 5` → 32 级 / 通道、每级 8 个值、32,768 组（597-598）；`binKey` 用 `r >> 3`（606-609）。Color Thief 的 5-bit `sigbits` 本轮未抓源码，列为限定（`qualified`），不改数字。
- **聚类**：`kmeans()` 以最重组的 OKLab 为第一个种子，之后取 `w × D²` 最大者，平局取小索引（658-713）；Lloyd 迭代到无变化；`mergeClose()` 以 `d < 0.02` 合并（716-737）。开启 vivid 时 a/b 差乘 2（651-655）。
- **占比**：`share = c.w / hist.total`（769），`hist.total` 为 alpha/255 加权和（620-623）；全透明像素跳过（619），透明比例按像素数计（755-756）。被过滤的权重计入分母，所以占比之和可小于 100%。
- **Most common shade**：`exact` 只在组内某色 `match * 2 > count` 时为真（625-641）；否则 `shade` 为组均值。页面「超过一半」与代码的严格大于一致。
- **导出**：六种代码格式（list / css / scss / tw4 / tw3 / json）与四种值格式（hex / rgb / hsl / oklch）由 `exportCode()` / `formatValue()` 实现（504-526、817-839）；JSON 字段为 hex、rgb、oklch、share（836-838）。`formatValue()` 逐级加小数直到读回同一 8 位色（509-523）。Tailwind v4 的 `--color-*` → `bg-*` 由官方 Theme variables 文档核实（2026-10-27）；`bg-palette-1` 对应 `--color-palette-1`（822-824）。
- **调色板文件**：`.gpl` 为 `GIMP Palette` + `Name:` + `Columns:` + `R G B<TAB>name`（849-856）；`.ase` 为 ASEF 1.0、组块 0xC001 + 颜色块 0x0001 + 组结束 0xC002（863-896）。GIMP 3.0 文档同时列出 `.gpl` 与 `.ase` 导入；Krita 文档列出 `.gpl` 与 `.ase`；Inkscape 手册说明把 `.gpl` 放进 palettes 文件夹。FAQ 与正文的这三个应用说法成立。
- **P3**：`countOutOfSrgb()` 用 P3→sRGB 矩阵与 0.0075 容差（535-574）；`opaqueOnly()` 只计 alpha = 255（1010-1013）；文件走 Worker（`createImageBitmap` + `OffscreenCanvas`，1014-1123），示例 / SVG 走页面，两者均按 16 行读取（1008、1029-1031、1063-1072）。状态行阈值 0.001（1128）。
- **隐私与统计**：组件无 `fetch` / `XMLHttpRequest` / `sendBeacon` / `localStorage` / `sessionStorage` / `document.cookie`（grep 0 条）；只经 `ztPersist` 存设置（925-943）。`?color=` 链接由 `toolLink()` 生成（899-901），`color-shades-generator` 与 `color-palette-generator` 都用 `new URLSearchParams(location.search).get('color')` 读取（两组件 931 / 969 行）。
- **示例**：四语 19 处 `icp-check` 标注（en 6、zh 5、ja 4、ko 4）由 `test-image-color-palette.mjs` 用 `public/images/icp-*` 解码复算；banner 的 86,400 / 30,000 / 3,600 / 120,000、透明 71.4%、忽略 25.0% / 20.1% / 3.7% 全部一致。图片实际尺寸 400×300、512×406、512×344、512×358、512×413、400×400 与页面 `width` / `height` 一致（sharp 读取）。
- **本地事实**：Tailwind v4 `@theme` 的 `--color-*` 命名空间生成 `bg-*`；GIMP / Krita 的 `.ase`、`.gpl` 导入；Inkscape 的 `.gpl` 路径；CSS Color 4 的 JND 0.02。上述均已抓取当天页面。

## 未核实

- 三幅画的来源页（MoMA、The Met、国家遗产厅）本轮未抓取，正文的创作年代 / 收藏信息保留原链接与原文；三张本地图片尺寸已核对。
- Adobe 的 `.ase` 支持：`helpx.adobe.com` 的 Illustrator 与 Photoshop 帮助页两次返回 403，未取得原文；FAQ 与正文的「Illustrator / Photoshop / InDesign 作为色板库」保留，GIMP 与 Krita 的导入已由各自文档核实。
- 「HEIC 只有 Safari 能打开」本轮未找到一手来源（MDN 的图片格式指南没有 HEIC 行）；保留原文，未改。
- 竞品段落（en:69-73、zh:66-67、ja:68-72、ko:54-58）为 2026-10-02 的观察，本轮未重跑；日期与数值原样保留。
- Color Thief 的 5-bit `sigbits` 未抓源码；页面只写「与 Color Thief 的中值切割相同精度」，列为限定，不改数字。

## 未改（按冻结范围）

- FAQ 条数（5）、id、顺序；四语 steps；seoTitle / seoDescription；`engine:start` / `engine:end`；客户端脚本逻辑；`persistence.ts` / `network.ts`；统计事件代码；`tools.ts`；测试脚本。
- 竞品段落的日期与观察值；页面示例的 `icp-check` 数值。

## 来源（查阅 2026-10-27/28）

- CSS Color 4（Editor's Draft, 27 October 2026）：https://drafts.csswg.org/css-color-4/（§14.1.5「one JND is an OkLCh difference of 0.02」、§14.2.1 `#GMA-Binary-local-MINDE`、§14.2.2 `#pseudo-binsearch`；`#binsearch` 不存在）
- Tailwind CSS v4 Theme variables：https://tailwindcss.com/docs/theme（`--color-*` 命名空间、`bg-*`）
- Krita Palette Docker：https://docs.krita.org/en/reference_manual/dockers/palette_docker.html（导入 `.gpl`、`.ase`）
- GIMP 3.0 Palettes Dialog：https://docs.gimp.org/3.0/en/gimp-palette-dialog.html（Import Palette 列出 `.gpl`、`.ase`）
- Inkscape Manual, The Color Palette：https://inkscape-manuals.readthedocs.io/en/latest/palette.html（`.gpl` 放入 palettes 文件夹）
- MDN Image file type and format guide：https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types（无 HEIC 条目，未据此确认 Safari 限制）
- Adobe Illustrator 帮助页：https://helpx.adobe.com/illustrator/desktop/manage-colors/use-swatches/share-swatches-between-applications.html（403，未读取）

## 测试

- `node scripts/test-image-color-palette.mjs`：651 passed / 0 failed（含 19 处 `icp-check` 复算、P3 两条路径、导出与 `.gpl` / `.ase` 回读、四语气泡 / steps / 正文约定）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b7-image-color-palette.json`：144 条（supported 75 / corrected 38 / qualified 10 / unverified 21），覆盖 5 条 FAQ × 4 语言、正文按段落 / 要点、组件 9 条可见文案 × 4 语言。
- 本文件。
