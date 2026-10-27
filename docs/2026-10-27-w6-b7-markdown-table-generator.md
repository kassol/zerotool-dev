# W6 batch 7 — markdown-table-generator 事实核对（2026-10-27）

范围：`src/content/tools/markdown-table-generator/{en,zh,ja,ko}.mdx` 的正文与 FAQ，`src/components/tools/MarkdownTableGeneratorTool.astro` 的可见文案；`src/data/persistence.ts`（第 59 行 `'markdown-table-generator': 'preference'`）与 `src/data/network.ts`（无本工具）只读核对。未改 `engine:start` / `engine:end`、脚本逻辑、FAQ 数量 / id / 顺序、steps、seoTitle、持久化策略与统计口径。基线为本工作树当前 HEAD；工作树中其他工具的改动不属于本批。

## 口径与总量

以 2026-10-28 抓取的 GFM 规范 §4.10、仓库内 2026-10-02 录制的渲染器 fixture、本地 markdownlint 0.40.0 / string-width 8.1.0、EastAsianWidth 18.0.0 fixture、组件源码和 Node 字节复算为准。竞品与渲染器旧观察保留原日期；今天未重跑的标为 unverified。

共审查 91 条语言级陈述：supported 32、corrected 26、qualified 20、unverified 13。四个语言同题同改；FAQ 仍为 5 条，id 与顺序未变。

| 语言 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 23 | 7 | 7 | 5 | 4 |
| zh | 23 | 8 | 7 | 5 | 3 |
| ja | 22 | 8 | 6 | 5 | 3 |
| ko | 23 | 9 | 6 | 5 | 3 |
| 合计 | 91 | 32 | 26 | 20 | 13 |

## 修正（6 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:143、zh.mdx:115、ja.mdx:102、ko.mdx:94 | 文件上限 `10 MB` 改为 `10 MiB（10 × 1024 × 1024 字节）`。`FILE_LIMIT = 10 * 1024 * 1024`（组件 1824 行），旧文案按十进制 MB 读会让 10.0–10.4 MB 的文件与「超过 10 MB」的提示矛盾。 | `src/components/tools/MarkdownTableGeneratorTool.astro:1824` |
| 2 | 同上四行 | 删除「其他编码的文件不会打开」的绝对说法。读取只检查字节：无效 UTF-8 在第一个无效字节处拒绝；旧编码的字节若恰好是合法 UTF-8 会按别的字符打开。补 GBK 张 `D5 C5`、Shift_JIS 東 `93 8C`、EUC-KR 김 `B1 E8` 在第 10 字节的示例，以及 GBK 模 `C4 A3` → `ģ`、EUC-KR 홍 `C8 AB` → `ȫ` 的反例。保留测试要求的四条引文原文（`byte 10 …` 等）。 | `firstBadUtf8` / `decodeTextFile`（组件 1788、1807 行）；Node 逐个字节复算；测试 fixture 用张 / 佐 / 김 的字节 |
| 3 | en.mdx:110 | CommonMark 机制由「`**` next to full-width punctuation does not open emphasis」改为「a `**` right after punctuation cannot close the emphasis」，并给出 `**注意**：ここ` 与「结尾 `**` 后加空格」两种写法。原句把「不能闭合」写成了「不能开始」。 | CommonMark 0.31.2 §6.2 flanking 规则；fixture 的 `**注意：**ここ` 在 GitHub / Gitee / Qiita / Zenn 都不加粗 |
| 4 | zh.mdx:93 | 同上：`**` 紧挨全角标点时「不能开始或结束强调」改为「紧跟在标点后面的 `**` 不能结束强调」，避免把 opener 也说成不能开始。 | 同上 |
| 5 | en.mdx:25、zh.mdx:25、ja.mdx:25、ko.mdx:25 | 导入统计去重口径由「unchanged import results are not counted again」改为「the same format and output are not counted again」。`runImport` 的 key 是 `JSON.stringify([format, lastMarkdown])`（组件 1771 行），同一输出换格式会再计一次；旧说法把「结果不变」说得比实现宽。 | `src/components/tools/MarkdownTableGeneratorTool.astro:1771–1774` |
| 6 | 组件 43、44、76、118、119、149、191、192、222、264、265、295 行 | 4 语言的可见文案同步：`fileTooBig` 改 10 MiB；`tips.import` 改 10 MiB 并说明「无效字节才拒绝、旧编码可能按别的字符打开」；`fileNotUtf8` 由「so the file is in another encoding」改为「this is not UTF-8 at that byte (another encoding …?)」，避免把损坏 / 截断文件也断言成其他编码（措辞限定，见下）。 | 组件源码与 `FILE_LIMIT`；`decodeTextFile` 的分支顺序（UTF-16 → NUL → 无效 UTF-8 → 解码） |

## 已核对未改（要点）

- **GFM 表格**（2026-10-28 抓取 cmark-gfm `spec.txt` §4.10）：单元格内的 `|` 必须转义（包括 code span）；表头与分隔行单元格数不同则不成表；数据行的多余单元格被忽略；空行或块级结构结束表格；空格在管道与内容之间会被 trim；表内不能放块级元素。四语文正文与此一致。
- **转义与换行**：fixture 的 `a\|b`、`` `a\|b` ``、`` `a|b` ``、`x\\|y`、`x\\\|y`、`<br>`、`**注意：**ここ` 六组在 GitHub / Gitee / Qiita / Zenn / micromark 上的结果与正文表格一致。`x\\|y` 在四家是一个单元格且显示 `x|y`，micromark 是两个单元格；工具输出 `\\\|` 时五家都读成 `\|`。`escapePipes` 保证不写出偶数个反斜杠（552–567 行）。
- **全角竖线**：GFM 只认 ASCII `|`，fixture 记录 GitHub / Gitee / Zenn / Qiita 都把 `｜` 表渲染成普通文字；`parseFullwidthTable`（785–798 行）按半角读取，且只把分隔行里的全角横线 / 长音符 / 冒号换成半角。
- **显示宽度**：EastAsianWidth 18.0.0 数据（`test-markdown-table-generator.eaw.json`）与组件内嵌范围一致；测试逐码点核对 1,114,112 个码点。`displayWidth` 按 string-width 8.1.0 的字素簇规则；markdownlint 0.40.0 的 MD060 确实 import string-width 8.1.0（`node_modules/markdownlint/lib/md060.mjs:5`），测试对 200 个随机表在 aligned / compact 两种排版各跑 MD055、MD056、MD058、MD060。正文的「EastAsianWidth 18.0.0」「string-width 8.1.0」「200 random tables」均成立。
- **CJK 示例**：en 的 Excel 季度表、zh 的全角竖线接口表、ja 的 ○× 表与全角竖线表、ko 的 업무 현황표与 셸 명령 표，全部由 `{/* mdt-check … */}` 标注的引擎复算逐字比对（测试 607 项全过）。
- **导入顺序与限制**：读取第一个 Markdown 表 / 第一个 `<table>`（727、1012 行）；网格显示前 1,000 行（414、1453、1886 行），输出含全部行；`[{"a":1},` 在 Detect 下按 JSON 读并报第 1 行第 10 列（`looksLikeJson` 1281–1284、`jsonSyntaxError` 1163 起）；CSV 未闭合引号按原样导入并注记行列（1302–1322）。均与正文一致。
- **隐私与统计**：`persistence.ts:59` 为 `preference`，页面加载 GA4 与 AdSense（`BaseLayout.astro:140、185`；本工具不在 `disabledPersistenceSlugs`）；`trackTool` 只发 `tool_name` / `tool_action`（`BaseLayout.astro:207`）。组件只保存 style / cell / breaks / ambiguous / view（1390 行），不写表格；`import_`、`paste_cells`、`align_`、工具栏按钮名、`copy`、`download` 的触发点与 FAQ 一致。`copy` 只在剪贴板写入成功后发送（1959–1963 行），`download` 在下载时发送（1987 行）。
- **10 MiB 数字**：`10 × 1024 × 1024 = 10,485,760` 字节；`fileTooBig` 与 `tips.import` 已同步为 10 MiB。

## 保留的限定（qualified）

- **emoji 与 UAX #11**：四语 FAQ / 正文说「CJK 与 emoji 计 2 列，as in UAX #11」。UAX #11 只定义 East Asian Width；RGI emoji 序列的 2 列来自 string-width 的字素与 emoji 规则，裸文本符号（如 ☺，EAW=A）默认计 1。结论对常见 emoji 成立，归因不完整；本轮未改文，避免在四语里引入更长的括注。
- **「pads to the widest cell」**：列宽小于分隔行下限时按 3 / 4 / 5 字符补齐（`buildMarkdown` 647 行），严格说不是「最宽单元格」。正文只说补到同一显示宽度，未列下限；本轮未改。
- **「Proportional fonts never line up」**：比例字体下字形宽度不等，无法保证对齐；「never」是绝对说法，未改。
- **Ctrl/⌘+L**：组件只在焦点位于 `.tool-widget` 内时清空（`ToolLayout.astro:361–375`）；FAQ 未限定焦点。与全站同类工具写法一致，未改。
- **1,000 行末行 Enter**：`keydown` 在 `r + 1 >= min(rows, GRID_LIMIT)` 且 `rows >= GRID_LIMIT` 时直接 return（1534–1535），最后一行不再新增。steps 写「最后一行会新增一行」未带此例外；steps 本批禁止修改。
- **Undo 范围**：提示写「上一次按钮操作、粘贴或导入」，代码还会回退 Enter 新增行（1536）与 Ctrl/⌘+L（1997）加入的快照；不影响按钮行为。
- **fileNotUtf8 文案**：已由「文件用的是其他编码」改为「这个位置不是 UTF-8（可能是其他编码）」，仍保留重存建议；测试要求的 `byte 10 …` 引文未动。

## 未核实（unverified）

- 竞品 13 条：tablesgenerator.com、tableconvert.com、tabletomarkdown.com、NotePM、markdowntoword.org 的 2026-10-02 行为（服务器 POST、空单元格、两行单元格、`a|b`、`_`、列宽、`:---`）。本轮未重跑；日期保留。
- 其中「三者 / 两者按字符数补空格」：tablesgenerator 与 tabletomarkdown 有 2026-10-02 记录，tableconvert 的补空格方式未在该记录中，故整句标 unverified，未改。
- 渲染器 2026-10-02 的 HTML 记录：fixture 在仓库内且测试通过，但今天未重新请求 GitHub / Gitee / Zenn / Qiita；正文保留日期，未写成今日结果。

## 发现的问题（未改）

- **B1** `tips.actions` / steps 的 Undo 范围未列 Enter 新增行与 Ctrl/⌘+L（组件 1536、1997）；文字是列举，不是错误，未改。
- **B2** 列宽下限 3 / 4 / 5 未写入正文（647 行）；短列会多出空格，建议在「Aligned columns」补一句，改动小但涉及四语。
- **B3** `parseFullwidthTable` 把所有 `｜` 都替换成 `|`（789 行），因此单元格里作为文字的全角竖线也会被当成分隔符；正文未提。属边角输入。
- **C1** `fileNotUtf8` 仍把无效 UTF-8 主要归因于其他编码；损坏 / 截断文件也会触发。已加「可能」，未彻底改写。
- **C2** `tips.output` 说预览里「only <br> becomes a line break」；`&lt;br&gt;` 这类实体在文本节点里也会被替换成 `<br>`。未实测，未改。
- **C3** 竞品段「all three pad by character count」中的 tableconvert 缺 2026-10-02 记录（见 unverified）。

## 来源（2026-10-28 查阅 / 复算）

- GitHub Flavored Markdown Spec 0.29 §4.10 Tables：https://raw.githubusercontent.com/github/cmark-gfm/master/test/spec.txt（2026-10-28 抓取）
- CommonMark 0.31.2 §6.2 Emphasis and strong emphasis（flanking 规则；用于 `**注意：**ここ` 的机制说明）
- `scripts/test-markdown-table-generator.fixtures.json`（recorded 2026-10-02）：GitHub / Gitee Markdown API、zenn-markdown-html 0.5.4、qiita_marker 0.23.9.0 的 HTML；foreign cases 含 two backslashes before a pipe、pipe inside code、row longer than header、full-width pipes、CJK punctuation next to `**`
- `scripts/test-markdown-table-generator.eaw.json`：EastAsianWidth-18.0.0.txt 的 W / F / A 区间
- 本地 `node_modules/markdownlint` 0.40.0、`markdownlint/node_modules/string-width` 8.1.0；`lib/md060.mjs:5` import string-width
- Node 24 复算：`firstBadUtf8` 对 `name,city\n` + GBK 张 / Shift_JIS 東 / EUC-KR 김 均返回 10；`C4 A3` 解码为 `ģ`；`C8 AB` 解码为 `ȫ`（无错误）
- `src/components/tools/MarkdownTableGeneratorTool.astro`：`FILE_LIMIT` 1824、`firstBadUtf8` 1788、`decodeTextFile` 1807、`resultKey` 1771、`savePrefs` 1390、`GRID_LIMIT` 414
- `src/data/persistence.ts:59`；`src/layouts/BaseLayout.astro:140、185、207`；`src/layouts/ToolLayout.astro:361–375`

## 测试

- `node scripts/test-markdown-table-generator.mjs`：607 passed / 0 failed / 0 skipped（修改后；页面 mdt-check、STRINGS、file 导入错误、legacy 字节 10、markdownlint 200 表全部通过）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。
- 未运行 `npm run build`（按任务要求）；未运行浏览器验收。

## 交付物

- `docs/2026-10-27-w6-b7-markdown-table-generator.json`：91 条（supported 32 / corrected 26 / qualified 20 / unverified 13），按语言 en 23、zh 23、ja 22、ko 23。
- 本文件。未改测试、engine 块、其他工具；工作树中其他文件的变化不属于本批。
