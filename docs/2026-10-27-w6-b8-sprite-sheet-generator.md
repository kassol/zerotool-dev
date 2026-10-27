# W6 batch 8 — sprite-sheet-generator 事实核对（2026-10-27/28）

范围：`src/content/tools/sprite-sheet-generator/{en,zh,ja,ko}.mdx` 的正文与 FAQ，以及 `src/components/tools/SpriteSheetGeneratorTool.astro` 的可见文案（12 个说明气泡、状态行、导出提示）。基线工作树 HEAD `d6b1e116`；其他工具的改动不属于本批。

未改：`engine:start/end`、任何客户端脚本与测试、`persistence.ts`、`network.ts`、`tools.ts`、FAQ 条数与 id、FAQ 顺序、`steps`、`seoTitle`、`seoDescription`、统计事件。

## 修正（22 条陈述，5 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:82、zh:71、ja:74、ko:68 | Web3D Survey 的 Android 8192 px 支持率 `77%` 改为 `75%`，查阅日期 `2026-10-02` 改为 `2026-10-28`。 | 今日页面：Android `≥4096` 100%、`≥8192` 75%（`https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE`）。工具在任一边超过 4096 px 时提示（`SpriteSheetGeneratorTool.astro:1002`）。 |
| 2 | en.mdx:16、zh:16、ja:16、ko:16；组件 `tips.gif` en:22 / zh:83 / ja:144 / ko:205 | GIF 解码上限的计量方式由「所有帧合计 / 合計 / 모든 프레임을 합쳐」改为「画布面积 × 帧数 / canvas area × frame count」。 | `checkBudget()` 用 `gif.width * gif.height * n`（`SpriteSheetGeneratorTool.astro:1367-1376`）；`GS_LIMITS.maxPixels = 50000000`、`maxFrames = 1000`（`:1011`）。GIF 拆帧页四语已用「宽 × 高 × 帧数」写法。 |
| 3 | en.mdx:25、zh:25、ja:25、ko:25 | 限制题不再把 Unity 图集归到 free-tex-packer：Cocos / Godot 可用 TexturePacker 或 free-tex-packer；Unity 用 TexturePacker 或 Unity 的 Sprite Atlas。 | free-tex-packer README 的导出格式为 json、xml、css、pixi.js、godot、phaser、cocos2d，没有 Unity（`https://github.com/odrick/free-tex-packer`）。Cocos Creator 3.8 文档推荐 TexturePacker 4.x 生成 cocos2d-x plist，并注明不支持 4.x 以下格式（`https://docs.cocos.com/creator/3.8/manual/zh/asset/atlas.html`）。 |
| 4 | en.mdx:13 | PixiJS 用法由 `new Sprite()` / `new AnimatedSprite()` 改为带参数的 `new Sprite(sheet.textures['walk_01.png'])` 与 `new AnimatedSprite(sheet.animations.walk)`。 | JSON Hash 的 `textures` 键与 `animations` 字段由 PixiJS 8.22.0 的 `Spritesheet` 解析记录核对（`scripts/test-sprite-sheet-generator.mjs:624-725`，fixture `scripts/test-sprite-sheet-generator.fixtures.json`）。 |
| 5 | zh.mdx:13；组件 `noteCssFraction` en:69 / zh:130 / ja:191 / ko:252 | CSS 像素比的整除建议补上「外边距 / margin」：尺寸、间距、外边距都能被像素比整除。 | `layoutSheet()` 的帧坐标从 `margin + …` 开始（`SpriteSheetGeneratorTool.astro:768`、`:792`）；`exportNotes()` 的 `cssFraction` 检查帧的 `x`、`y` 与图集宽高（`:993-998`）。 |

## 已核对未改（要点）

- **FAQ 限制数字**：1000 张、单张 8192 px、图集 16384 px / 16,777,216 px、WebP 16383 px，与 `SSG_LIMITS`（`SpriteSheetGeneratorTool.astro:423`）、`fitsLimits()`（`:611`）、`exportNotes()`（`:1001`）一致。
- **FAQ 隐私**：只保存选项（含图集名），保存键为 `zt-input-sprite-sheet-generator`；`persistence.ts:51` 为 `preference`；`ztPersist.clear()` 对 `preference` 直接返回（`ToolLayout.astro:239-245`），Ctrl/⌘+L 由组件清空图片并重新保存选项（`SpriteSheetGeneratorTool.astro:2372-2379`）；图片、预览、导出文本不落盘；组件无 fetch / XHR / storage 直写（测试 `:741`）。
- **统计动作**：只有三处 `trackTool`：下载图片 `png` / `webp`（`:2492`）、下载数据 `data`（`:2503`）、复制数据 `copy`（`:2512`）；成功后才发。
- **示例数字**：en 95×45、134×100；zh 98×98、97×97；ja 144×192、148×198、32×76；ko 128×64、32×100。均由 `{/* ssg-check */}` 标注经引擎复算，`test-sprite-sheet-generator.mjs` 1,497 项通过。
- **Phaser / PixiJS**：JSON Hash、JSON Array、Sparrow XML 的帧名、trim 偏移与 `animations` 由 Phaser 3.90.0 / 4.2.1 与 PixiJS 8.22.0 的解析记录核对；PixiJS 的 JSON Array 纹理键为 `"0"`、`"1"`（测试 `:723`）。
- **Phaser issue #7245**：3.90 及更早的 `AtlasXML` 把裁剪后的宽高当作原尺寸；issue 于 2026-04-09 修复，Phaser 4.0.0 于 2026-04-10 发布，页面的「4.0.0 已修复」成立（`https://github.com/phaserjs/phaser/issues/7245`、`https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/CHANGELOG-v4.0.0.md`）。
- **GIF**：与 GIF 拆帧工具共用解码声明（组件注释与测试逐字比对）；处理 disposal 0/1/2/3、透明色、隔行、局部色表；帧名 `base-frame-001.png`（`frameFileName()` `:1392`）；超过预算回退首帧（`:1923-1936`）。
- **SVG**：`svgRasterSize()` 在无可用宽高或 viewBox 时返回 null（`:544-550`）；`intrinsicSize()` 按 CSS 绝对单位、em / rem 与 viewBox 计算（`:1452-1479`）；`buildSvg()` 删除外部图片引用；SVG 走 `<img>`，脚本不执行（`:1871-1891`）。`mm` / `pt` / `em` 的换算本轮未在浏览器中重新对比，标记为限定。
- **CSS**：`buildCss()` 按像素比除以 `w`、`h`、`x`、`y`，并写 `background-size`（`:952-978`）；`cssFraction` 提示（`:983-1000`）。
- **WebP**：`canvas.toBlob(..., 1)`（`:2489-2493`）。Chromium 与 Gecko 在 quality 100 都走无损编码（Gecko `nsWebPEncoder.cpp` 的 `quality == 100 ? WebPEncodeLosslessRGBA`）；caniuse 的 `toBlob` WebP 表格显示 Safari 到 27.2 仍不支持，Safari 选项禁用成立。Firefox 96+ 支持编码，同样在 100 时无损。
- **本地事实**：RPG Maker MZ 素材规格为 48×48 基准、4 方向（下、左、右、上）× 3 模式、每文件 8 角色、`$` 前缀单角色；Cocos Creator 3.8 的图集说明；Unity 2022.3 自动切片说明（Grid By Cell Size、Pixel Size、Offset、Padding、Keep Empty Rects）；KWCAG 2.2 5.1.1 第 2 条（有意义的背景图片需要替代文本）；free-tex-packer 的导出格式列表。

## 限定（4 条陈述）

- **预乘 alpha**：en:97 / zh:84 / ja:88 / ko:82 的 `rgb(200,100,50)` 观测来自 Chrome 152，正文把它写成「浏览器」的一般行为。具体数值是当次实测，未在 Firefox / Safari 重跑，保留日期与示例。
- **动画 WebP / APNG 只取首帧**：en:98 / zh:85 / ja:89 / ko:83。代码路径用 `createImageBitmap` 解码，APNG 与动画 WebP 的首帧行为本轮未在浏览器中重新验证。
- **SVG 的 mm / pt / em**：见上，代码按 96 dpi 与根 16 px 换算，未与 Chrome 今天的 naturalWidth 逐项对比。

## 未核实（9 条陈述）

- 2026-10-02 的竞品观察未重跑：en:86/88、zh:75/77、ja:78/80、ko:72/74（CodeAndWeb、free-tex-packer.org 0.6.7、のんびりスタジオ、MergeImage）。保留原文日期，不把当次观察改写成今天的结论。
- zh:48 的「半像素位置在不同浏览器里取整方式不一样」：未做跨浏览器取整实测，保留为经验说明。

## 未改（按冻结范围）

- `statusTooBig` 四语仍写「mobile browsers」的 canvas 上限（16,777,216 px、单边 16,384 px）。工具的实际硬限制是 `fitsLimits()`；`noteGpu` 在单边超过 4096 px 时另行提示。该句属于状态文案，不在本批 MDX 修正范围，未改。
- `tools.ts` 描述、`seoTitle`、`seoDescription`、FAQ id / 顺序、`steps`、`engine` 块、测试脚本均未改。

## 来源（查阅 2026-10-27/28）

- Web3D Survey MAX_TEXTURE_SIZE：https://web3dsurvey.com/webgl2/parameters/MAX_TEXTURE_SIZE
- Phaser issue #7245：https://github.com/phaserjs/phaser/issues/7245
- Phaser 4.0.0 changelog：https://github.com/phaserjs/phaser/blob/master/changelog/v4/4.0/CHANGELOG-v4.0.0.md
- Phaser / PixiJS 解析记录：`scripts/test-sprite-sheet-generator.fixtures.json`（3.90.0 / 4.2.1 / 8.22.0）
- free-tex-packer README：https://github.com/odrick/free-tex-packer
- Cocos Creator 3.8 图集资源：https://docs.cocos.com/creator/3.8/manual/zh/asset/atlas.html
- Unity 2022.3 자동 슬라이싱：https://docs.unity3d.com/kr/2022.3/Manual/sprite-automatic-slicing.html
- RPG Maker MZ 素材規格：https://rpgmakerofficial.com/product/mz/rpgmz_manual/01_11_01.html
- KWCAG 2.2 5.1.1：https://a11ykr.github.io/docs/kwcag2/
- Gecko WebP encoder：https://hg.mozilla.org/mozilla-central/raw-file/tip/image/encoders/webp/nsWebPEncoder.cpp
- caniuse `toBlob` WebP：https://caniuse.com/mdn-api_htmlcanvaselement_toblob_type_parameter_webp

## 测试

- `node scripts/test-sprite-sheet-generator.mjs`：1497 passed / 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。
- 未运行 `npm run build`（按任务要求）。

## 交付物

- `docs/2026-10-27-w6-b8-sprite-sheet-generator.json`：169 条（supported 134 / corrected 22 / qualified 4 / unverified 9），FAQ 107 条（按句拆分）、正文 54 条（按段落分组）、组件可见文案 8 条。
- 本文件。
