# W6 batch 5 — qr-code-generator 事实核对（2026-10-27）

范围：`src/content/tools/qr-code-generator/{en,zh,ja,ko}.mdx` 与 `src/components/tools/QrCodeGeneratorTool.astro` 的可见文案。基线 HEAD `f358d03c`。未改 `engine:start` / `engine:end`、持久化、联网声明、统计、测试脚本、FAQ 条数 / id / 顺序与 steps。逐条证据见同目录 `2026-10-27-w6-b5-qr-code-generator.json`。

## 总量

共审查 201 条陈述：supported 152、corrected 19、qualified 18、unverified 12。四个语言同题同改。

| 语言 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 52 | 42 | 4 | 5 | 1 |
| zh | 51 | 38 | 6 | 4 | 3 |
| ja | 49 | 36 | 4 | 5 | 4 |
| ko | 49 | 36 | 5 | 4 | 4 |

## 修正（6 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en:71 / zh:71 / ja:66 / ko:64 | 静区小节号由「2006 版 §8.1」改为 §5.3.7。 | ISO/IEC 18004:2006 目录：§5.3.7 Quiet zone；§8.1 是 Symbol printing and marking — Dimensions（第 60 页）。4 模块值见 §5.3.7 与 §8.1 的 `4X`。 |
| 2 | en:33 / zh:33 / ja:33 / ko:39 | 「允许分段 / 混用」的引用由附录 J 改为 §6.3.6；附录 J 改述为「怎样选总位数最少的分法」。 | ISO/IEC 18004:2006 目录：§6.3.6 Mixing modes；Annex J（informative）Optimisation of bit stream length。 |
| 3 | zh:25、zh:48 | 删除「中文（简繁体）和韩文每字 13 位」的说法，改为：ISO/IEC 18004 没有中文 13 位模式，GB/T 18284 的汉字模式用 GB2312、每字 13 位，本工具不提供；DENSO FAQ 只说明中文 / 韩文可按各自字符编码放进字节模式。 | ISO/IEC 18004:2006 §6.3 只有 numeric / alphanumeric / byte / Kanji（另有 ECI、Structured Append、FNC1）；DENSO FAQ「Is it possible to encode Chinese or Korean」答 Yes，按字符编码存为二进制、读方须用同一编码；未提 13 位模式。 |
| 4 | ko:25、ko:50 | 删除「한글을 13비트로 압축하는 모드」，改为 ISO/IEC 18004 无此模式、工具按 UTF-8 字节写入；DENSO 的说明改为「한글은 바이트 모드로 넣고 읽는 쪽이 같은 문자 인코딩을 써야 한다」。 | 同第 3 条；engine 只实现 N / A / B / K 四模式（`QrCodeGeneratorTool.astro:488`）。 |
| 5 | en:22、zh:22、ja:22、ja:33 | CJK「每字 3 字节」限定为「大多数 / ほとんど」并补「基本平面以外 4 字节」。 | UTF-8 对 U+10000 以上码点为 4 字节；已有 984 字上限本就是近似值（2,953 ÷ 3）。 |
| 6 | en:47、zh:60、ko:54 | 删除「RFC 2426 §4」的小节号，只引 RFC 2426。 | 本轮未能取得 RFC 2426 原文核对小节号（见「未核实」）；转义规则本身由 `buildVcard` / `vEsc` 与测试 237 项覆盖。 |

## 已核对未改（要点）

- **容量**：40-L 的 7,089 数字 / 4,296 英数字 / 2,953 字节 / 1,817 汉字与 40-M / Q / H 的 2,331 / 1,663 / 1,273 字节，由 `dataCodewords()`（`QrCodeGeneratorTool.astro:484`）与 node-qrcode 在 160 组版本 / 等级上逐一比对，`test-qr-code-generator.mjs:104–111`。
- **示例**：en 的 v2-M 172/224、`HTTPS://ZEROTOOL.DEV` v1、2,400 字符 19,220 / 18,672（69 为按字节向上取整）；zh 的 v3-M 268/352、H 版 v4、800 汉字 19,220 / 18,672；ja 的 v9 / 汉字节模式 v5、`会議室…` v4 / K4 N1 K18；ko 的 v5 73 字节、SMSTO A7 N12 B42、1,000 字 24,020 / 23,648（47）。全部由 `qrg-check` 注解经引擎复算（`test-qr-code-generator.mjs:439–456`），本轮另用同一引擎复核。
- **zh 汉字模式示例**：`K7 B6 K4 B3 K5 B3 K18`、622 / 688 位、7 段、34 个汉字模式字符（30 汉字 + 4 全角标点）+ 12 字节，与页面逐项一致。
- **vCard / MECARD**：vCard 3.0 的 CRLF、N / FN、`X-PHONETIC-*`、逗号 / 分号 / 反斜杠 / 换行转义（`buildVcard:683–700`、`vEsc:673`）；MECARD 的 N / SOUND / TEL / EMAIL / URL / ADR 与 `;;` 结尾（`buildMecard:703–718`）。NTT DOCOMO 存档格式表只有 N / SOUND / TEL / TEL-AV / EMAIL / NOTE / BDAY / ADR / URL / NICKNAME，**没有** ORG 与 TITLE，故「MECARD 没有公司和职位字段」成立；zxing 的 DoCoMo 解析器额外接受 ORG，属扩展，不影响该句。示例版本 v8 / v5（en）、v8 / v4（zh、ko）、v11 / v7 / 汉字节模式 v6（ja）全部复算一致。
- **其他格式**：`mailto:`（RFC 6068，换行 %0D%0A）、`tel:`（去空格，保留 `- . ( )`）、`SMSTO:`（ZXing Barcode Contents）、`geo:`（范围校验）由 `buildEmail:737` / `buildPhone:747` / `buildSms:755` / `buildGeo:763` 生成；测试把四种格式解码后交本站 QR Code Reader 的 `classify()` 读回（`:251–263`）。
- **静区 / 像素 / 颜色 / ECI**：默认 4 模块（`:414`），小于 4 警告（`:928`）；PNG 每模块整数像素，v2 + 4 静区在 1024 目标下为 31 px / 1023 px（`:626–630`，测试 193）；SVG 单路径 + `shape-rendering="crispEdges"`（`:644–650`）；反色码被 zxing-cpp 读出且标 inverted（测试 225），ISO 2006 §5.2 明列 reflectance reversal；字节模式默认 ISO/IEC 8859-1（ISO 2006 §6.3.1 第 981 行：ECI 000003），组件不加 ECI（`:903–905`），测试 176 断言 `]Q1` / `hasECI=false`。
- **汉字模式**：13 位 / 字（`charCost:538`）、表只建 8140–9FFC 与 E040–EAA4（`:512–530`）、8 个歧义码排除（`:511`）；默认关闭（`:431`）；缩小提示只在自动版本且文本含假名 / 汉字时出现（`:920–926`）。
- **隐私 / 统计**：`persistence.ts:27` 为 `preference`；`savePrefs()`（`:821–829`）保存的 9 个键与四语隐私题列出的项完全一致，输入文本不写入；`track()`（`:784`）只在成功下载 PNG / SVG 或复制时调用，载荷为工具名与动作；页面不属于 sensitive，故加载 GA4 / AdSense（`ToolLayout` 的 sensitive 分支）。
- **271 字节**：DENSO FAQ 原文「271 bytes or so (for Version 10 with error correction level L)」，与组件 `wDense` 一致（`:927` 在 version > 10 时提示）。
- **颜色阈值**：Cognex 的 ISO/IEC 15415 分级表以 40% 为 C 级下限；组件以 WCAG 相对亮度差代替反射率，页面已写明是 stand-in，本轮保留并标 qualified。
- **组件可见文案**：四语各 8 条（`tips.contact`、`tips.status`、`tips.ecl`、`tips.quiet`、`tips.colors`、`tips.kanji`、`wDense`、`eclL`）共 32 条与代码一致，未改；其余 `tips.input` / `tips.export` / `wKanjiHint` / `wMecard` / `wTelLocal` 等也逐条对过。

## 未核实

- 竞品行为与数字（en 的 Bitly / QRCode Monkey / GenQRCode，zh 的草料 / QRCode Monkey，ja 的 QR のススメ / QRCode Monkey，ko 的 GenQRCode / QR Code Generator，以及 ko 的 Naver 段落）是 2026-10-01 的观察，本轮未重跑、未重取一手页面；页面日期保留。
- 「PNG 不带 DPI」：`canvas.toBlob('image/png')` 的实际块布局本轮未解析验证（SIZES 上限 4096 已由 `:282` 确认）。
- `X-PHONETIC-*` 被 Android vCard 库读取：链接保留，本轮未抓 Android 源码。
- 「ZXing 等读码库按字节识别 UTF-8」：测试只证明 zxing-cpp 的往返，未读取 ZXing 的探测实现。
- RFC 2426 的小节号（因此第 6 组删除）；RFC 3986 / 6068 / 3966 / 5870 本轮未重取原文。
- ja 页末「QRコード是デンソーウェーブ的注册商标」：本轮未查商标注册簿。

## 发现的问题

- **C 档**：`errSize` 的 `{over} bytes too many` 用 `Math.ceil((bits - capacity) / 8)`（`:614`），68.5 字节会显示 69；页面示例照实复算，未改。若改为保留一位小数或写「至少 68 字节」，需同时改四语与测试。
- **C 档**：`wDense` 以 `version > 10` 触发（`:927`），而 DENSO 的 271 字节是 10-L；10-H 的容量远低于 271 字节，提示阈值偏松。
- **C 档**：`SIZES` 含 256 px（`:282`），版本 40 + 静区 4 为 185 模块，实际输出 185 px，选择项仍标 256 px；状态行会写实际尺寸。
- 无 A / B 档：未发现与代码或一手来源冲突且会影响用户判断的剩余陈述。

## 来源（2026-10-27 抓取）

- ISO/IEC 18004:2006（law.resource.org 的 IBR 副本，8.5 MB PDF）：https://law.resource.org/pub/us/cfr/ibr/inc/iec/iec.18004.2006.pdf — 目录（§5.3.7、§6.3.6、Annex J、§8.1）、§5.2 reflectance reversal、§6.3.1 ECI 000003、§6.3.5 Kanji mode、§8.1 `4X` quiet zone。
- DENSO WAVE FAQ（EN）：https://www.qrcode.com/en/faq.html — 271 bytes / Version 10-L、red-light scanners、Chinese/Korean as binary with matching charset、4-module white space。
- DENSO WAVE FAQ（JA）：https://www.qrcode.com/faq.html — 「運用時は、この周りに4セル分の空白が必要です」、赤色光の説明。
- NTT DOCOMO MECARD 格式表（2016-03-04 存档）：https://web.archive.org/web/20160304025131/https://www.nttdocomo.co.jp/english/service/developer/make/content/barcode/function/application/addressbook/index.html — 字段清单（无 ORG / TITLE）。
- 页面已引、本轮未重取：Cognex ISO/IEC 15415 分级表、ZXing Barcode Contents、Android VCardConstants、RFC 2426 / 3986 / 6068 / 3966 / 5870。

## 测试

- `node scripts/test-qr-code-generator.mjs`：255 passed / 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7,753 passed / 0 failed（141 个工具）。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。
- 未运行 `npm run build`（按任务要求）。

## 交付物

- `docs/2026-10-27-w6-b5-qr-code-generator.json`：201 条（supported 152 / corrected 19 / qualified 18 / unverified 12）。
- 本文件。未改 engine 块、persistence / network、统计、测试或其他工具；工作树中其他工具的改动不属于本批。
