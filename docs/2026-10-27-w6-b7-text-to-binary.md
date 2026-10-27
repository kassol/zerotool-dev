# W6 batch 7 — text-to-binary 事实核对（2026-10-27/28）

范围：`src/content/tools/text-to-binary/{en,zh,ja,ko}.mdx` 与 `src/components/tools/TextToBinaryTool.astro` 的可见文案（frontmatter、`STRINGS`、提示气泡、状态与错误模板）。未改 `engine:start` / `engine:end`、解析与统计逻辑、`persistence.ts`、`network.ts`、`steps`、`seoTitle`、FAQ 条数 / id / 顺序。基线 `d6b1e116`（本工具的改动随 `6d576de1` 提交；工作区另有并行批次改动，不在本次范围）。

## 口径

- 实现主张以组件 file:line 为准；外部事实用 2026-10-27 抓取的一手来源（列表在文末）。
- 竞品段落、Word / 微软拼音的界面路径与 2026-09-30 的浏览器观察是历史记录，保留日期，本轮标为 unverified，不改写成今日结论。
- 四语同题同改；只改事实与措辞，不扩展功能。
- 前一份同路径的 72 条摘要引用了 `decodeGroups` / `updateStats` / `errLong` / `errMixed` / `errCharAt`，这些标识符在组件中不存在，行号也与 FAQ 不符；本报告按组件实际代码重建并取代它。

## 总量

共审查 166 组陈述：supported 116、corrected 26、qualified 11、unverified 13。

> 汇总口径：本报告 166 条，取代前一份 72 条摘要。`docs/2026-10-27-w6-batch-7.md` 与根 `AGENTS.md` 已按本报告更新（batch-7 653 条；八批 4,503 条：supported 3,064 / corrected 773 / qualified 428 / unverified 238）。

| 语言 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 48 | 33 | 8 | 4 | 3 |
| zh | 39 | 27 | 6 | 2 | 4 |
| ja | 40 | 28 | 6 | 3 | 3 |
| ko | 39 | 28 | 6 | 2 | 3 |

## 修正（按语言计）

1. **短组规则**（en:16 / zh:16 / ja:16 / ko:16）：旧答案说「连续串的总位数必须是 8 的倍数」。组件对单个 1–7 位组补前导 0 成一个字节（`1001000` → `H`）；只有超过 8 位的组才必须是 8 的倍数。四语改写并补例子。依据 `TextToBinaryTool.astro:264-293`；`scripts/test-text-to-binary.mjs:127`。
2. **错误清单**（en:19 / zh:19 / ja:19 / ko:19）：旧答案说「所有位都用上」且把「位数不是 8 的倍数」列为一般错误。实际条件是每组能读成字节且字节合法；位数错误只针对单个长组或超过 8 位的组，短组与长组混排另有 `mixedGroups`。四语改写。依据 `TextToBinaryTool.astro:258-284`。
3. **UTF-16 的后果**（en:25 / en:101 / zh:94 / ja:99 / ko:97）：旧答案说 UTF-16 要么报错、要么带控制字符警告。反例：U+4E2D 的 UTF-16BE 是 `4E 2D`，本工具读成 `N-`，没有控制字符提示；带 BOM 的 UTF-16 首字节 `FE` 直接报 `invalidLead`。改为「不带 BOM 的 ASCII-only UTF-16 通过并提示 NUL；其他不带 BOM 的 UTF-16 可能静默读成无关 ASCII」。依据 `TextToBinaryTool.astro:299-330`；Node 实测。
4. **控制字符与 BOM**（en:72 / zh:76 / ja:80 / ko:79）：旧正文说「两种情况会输出文字并附提示」，其中 BOM 情况实际不提示；并且只统计 C0（除 tab / LF / CR）与 DEL，C1（U+0080–U+009F）不统计。四语改为「C0 或 DEL 时提示；C1 不提示；BOM 保留但不提示」。依据 `TextToBinaryTool.astro:332-343`、`:362-373`；WHATWG Encoding。
5. **状态行计数**（en:13）：旧 FAQ 说状态行总是显示字符、码点、字节数。实际只在码点数与字符数不同时（如家庭 emoji）显示码点数，且只在编码方向；解码只显示字节 → 字符。改为「编码时显示字符与字节；不同时补码点」。依据 `TextToBinaryTool.astro:425-427`。
6. **统计措辞**（en:28 / zh:28 / ja:28 / ko:28）：旧答案说「页面统计只记录工具名和方向」。页面浏览也会被 GA4 记录；收窄为「使用事件只记录工具名和方向」。事件名、触发时机、去重与不含内容均与代码一致。依据 `TextToBinaryTool.astro:413-462`、`BaseLayout.astro:207-212`。
7. **可见气泡**（en:23-24 / zh:51-52 / ja:79-80 / ko:107-108）：`1 to 4 bytes per character` / 「每个字符 1 到 4 个字节」/「1 文字は 1〜4 バイト」/「한 글자는 1~4바이트」与工具自己的字素簇计数冲突（家庭 emoji 1 字符 18 字节）；改为「每个码点」。`A continuous string is cut every 8 bits` 等改为「超过 8 位的连续串」。
8. **日语引用**（ja:59）：Shift_JIS 的「あ」错误引用只到「前に先頭バイトがありません。」，实际消息还有「UTF-8 として不正です。」；补全引文。

## 已核对未改（要点）

- **字节表**：`A` 41、`中` E4 B8 AD、`😀` F0 9F 98 80、`我/爱/你`、`こ/ん`、`한/글`、`あ` 82 A0、`ｶﾞ` EF BD B6 EF BE 9E 全部与 RFC 3629 / Python 3.12 / 组件输出一致（`test-text-to-binary.mjs:61-79`）。
- **分组**：单个 7 位组补 0；8 组 7 位 → `HiHiHiHi`（`test:127`）；16 位 + `01` 混合 → `mixedGroups` 第 2 组；`0b` 前缀、逗号/分号/顿号/全角 ０１ 均可读。
- **错误位置**：`01001000 0110100x` 第 17 字符；`010010000110100` 15 位余 7；`11100100 10111000` 3 字节只到 2；`10111000` 无首字节；`ED A0 80` 代理项；全部与引擎实跑一致。
- **UTF-8 判定**：C0/C1/F5–FF、超长、代理项、>U+10FFFF 拒绝；2 万组随机字节与 `TextDecoder({fatal:true})` 完全一致（`test:176-184`）。
- **BOM**：`EF BB BF` 保留为 U+FEFF（`ignoreBOM:true`），与 WHATWG UTF-8 decode 的默认丢弃不同。
- **隐私**：组件无 `fetch` / `XMLHttpRequest` / `sendBeacon` / `localStorage` / `sessionStorage` / `ztPersist`；`persistence.ts` 无 `text-to-binary` 条目，`network.ts` 也无。默认 `input` 策略的 ztPersist 只在工具调用 `save` 时写，组件从未调用（`ToolLayout.astro:222-249`）。
- **统计**：`trackTool('text_to_binary', 'text_to_binary'|'binary_to_text')`；change / 分隔符 / 按钮 / Ctrl+Enter 成功时发；输入中不发；按方向 + 结果去重；`BaseLayout.astro:207-212` 只写 `tool_name` / `tool_action`。
- **未配对代理项**：`TextEncoder` 输出 U+FFFD（EF BF BD），状态行 `noteSurrogate` 报告个数（`test:98-102`）。
- **竞品段落**：2026-09-30 的 RapidTables / 67tool / Rakko / onul.works 行保留原文与日期；本工具列已复核（Hi、第 17 字符、第 1 字节等）。竞品侧未重跑。

## 未核实

- Word / PowerPoint 的 AutoCorrect › AutoFormat As You Type 路径（en:22）与微软拼音 Shift+空格（zh:22）：界面标签随版本变化，未在今日核实。
- 四语竞品段落（en:76-85、zh:78-90、ja:82-95、ko:81-93）：2026-09-30 观察，未重跑。
- 四语长度 / 耗时（en:105、zh:98、ja:103、ko:101）：原 Chromium 测试机测量，今日未在 Chromium 重测；`175,000 × 9 − 1 = 1,574,999` 与「约 157 万」吻合，工具无大小上限。

## 未改的引擎 / 文案问题

- `err.incomplete` 把「输入截断」和「下一字节不是 10xxxxxx」合并：`11100100 01000001` 返回 `got=1`，消息说「只有 1 个字节」，但第二个字节其实存在（只是不是后续字节）。依据 `TextToBinaryTool.astro:322-324`；改引擎或测试超出本次范围。
- `err.overlong` / `err.surrogate` / `err.tooLarge` 只报检测到的前 2 个字节（3–4 字节序列的前缀），文案「Bytes N–M」是前缀而非完整序列（`:325-326`）。
- `noteControl` 不统计 C1；正文已写明，运行时消息未改（`:332-343`）。
- `tips.sep` 的「reads every one of these separators」把「None」也算作分隔符；连续串路径实际可用（`:22`）。
- 四语正文的首字节模式列表只列了 `0xxxxxxx`、`1110xxxx`、`11110xxx`、`10xxxxxx`，省略 2 字节首字节 `110xxxxx`；不是错误陈述，但列表不完整，未在本轮补写（避免扩大范围）。

## 验证

- `node scripts/test-text-to-binary.mjs`：236 passed, 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7,753 passed, 0 failed（141 tools）。
- `node scripts/audit.mjs --quiet`：24 PASS, 0 WARN, 0 FAIL。
- 未运行 `npm run build`（按任务要求）。

## 证据来源（2026-10-27 抓取）

- RFC 3629 §3（1–4 字节与首字节模式）、§4（ABNF 字节范围）、§6（BOM）、§7（示例）：<https://www.rfc-editor.org/rfc/rfc3629>
- WHATWG Encoding，UTF-8 decode（BOM 丢弃）与 TextDecoder fatal：<https://encoding.spec.whatwg.org/#utf-8-decode>
- Unicode UAX #29（extended grapheme clusters）：<https://www.unicode.org/reports/tr29/>
- Apple QA1173（HFS Plus 使用 Normal Form D 变体）：<https://developer.apple.com/library/archive/qa/qa1173/_index.html>
- 本地复算：Node 22.23.3 / Python 3.12，2026-10-27（字节表、分组、UTF-16 反例、`1001000` → `H`）。
