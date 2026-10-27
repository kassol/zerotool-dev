# W6 batch 8 — json-formatter 事实核对（2026-10-27/28）

范围：`src/content/tools/json-formatter/{en,zh,ja,ko}.mdx` 全部 FAQ 与正文陈述，以及 `JsonFormatterTool.astro` 的可见文案（STRINGS 气泡、状态行、错误文案）。对照 `json-formatter-engine.js`、`json-formatter-run.js`、`persistence.ts`、`network.ts`。未改 FAQ 条数 / id / 顺序、steps、seoTitle、seoDescription、`engine:start` / `engine:end`、脚本、`persistence.ts`、`network.ts`、统计调用。基线 HEAD `fd541a7b`。

## 修正（9 组／18 处语言行，JSON 记录按段合并为 13 条）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en:33 | 「accepts the same documents as `JSON.parse`」补限定「apart from a leading byte order mark (below)」。工具会先去掉开头 BOM 再解析，同语下一句已写明 `JSON.parse` 拒绝 BOM，前句因此自相矛盾。 | `json-formatter-engine.js:437-440`（`charCodeAt(0) === 0xfeff` 去掉并置 `bom`）；`scripts/test-json-formatter.mjs:129` 比较前 `replace(/^\ufeff/, '')`，测试注释写 "a BOM is removed first"。RFC 8259 §8.1：实现 MAY ignore BOM（2026-10-28 抓取 rfc-editor.org/rfc/rfc8259.txt）。 |
| 2 | en:180 | 「With 4 spaces and Escape non-ASCII on … byte-for-byte what Python 3.12's `json.tool` prints」改为写明还需 Sort keys，且「apart from its final newline」。`json.tool` 默认按输入顺序输出、末尾带换行；示例输入是乱序键。 | 测试只对 `--sort-keys` 变体比 sortKeys（`test-json-formatter.mjs:449-456`），比对值为 `fmtOut(...) + '\n'`（`:453`）；`python3 -m json.tool --compact` 实测输出带结尾 LF。 |
| 3 | zh:148、ja:99/106、ko:124 | 同一 Python 对齐说法：「逐字节相同」/「1 バイトも違いません」/「같은 출력」改为「除末尾换行外」。面板输出没有结尾换行（下载 pretty 时才补 `'\n'`）。 | `JsonFormatterTool.astro:968`（`outText + (mode === 'min' ? '' : '\n')`）；测试 `:453` 手动 `+ '\n'`。 |
| 4 | en:19、zh:19、ja:19、ko:19（FAQ non-ascii） | 「every character outside ASCII / 非 ASCII 字符 / ASCII 以外 / ASCII가 아닌 문자」改为「outside printable ASCII」并给出 U+0020–U+007E。Python `ensure_ascii` 转义的是 non-ASCII **and non-printable**，含 DEL（U+007F）；工具 `quote()` 的 ASCII 模式同样从 U+007F 起（测试断言 DEL 被转义）。 | Python 3.15 文档 `ensure_ascii`（2026-10-27 抓取 docs.python.org/3/library/json.html）；`json-formatter-engine.js:524`（`[\u007f-\uffff]`）；`test-json-formatter.mjs:289`（`é😀\u007f~` → `\u00e9\ud83d\ude00\u007f~`）。 |
| 5 | ja:61 | 「エラーになるのは、文字列の外にある全角文字だけです」改为「文字列の外に全角文字があるとエラーになります」。原句把错误原因限定为全角字符，ASCII 拼写错误同样报错。 | `jsonSyntaxError()` 的 `badNumber` / `badLiteral` / `missingComma` 等路径（engine:70-136）；`fullWidth` 只是其中一类。 |
| 6 | zh:82 | JSON5 / JSONC 提示的引文用「、」连接两项，实际 `changeList()` 用 `", "` 连接。改为 `, `。 | `JsonFormatterTool.astro:613`（`join(', ')`）；zh `STRINGS.changes`（`:152-158`）。 |
| 7 | zh:144、ja:95、ko:114 | UTF-8 报错引文补「（从 0 数）」/「（0 から数えて）」/「(0부터 셈)」，与实际消息一致。 | `STRINGS.zh.notUtf8`（`:129`）、`ja.notUtf8`（`:230`）、`ko.notUtf8`（`:331`）。 |
| 8 | zh:144 | BOM 句补「RFC 8259 第 8.1 节允许解析器忽略它」（en / ja / ko 已有）。原句只给 `JSON.parse` 报错这个理由，与本工具的自有解析器无关。 | engine:436 注释 + RFC 8259 §8.1。 |
| 9 | zh:164、ko:124 | 「`jq -S`、`--sort-keys`」补全为「`python3 -m json.tool --sort-keys`」（原句缺命令，易读成 jq 的选项）。 | 测试 `:449-456` 的 Python 变体参数。 |

未改语言的地方：en / ja / ko 的 FAQ 与正文没有第 5–9 条的对应错误；四语在第 1–4 条上同步改写（en 只涉及英文句）。

## 已核对未改（要点）

- **数字**：`JSON.parse('1830000000000000001')` → `1830000000000000000`；`String(1845223349876512769)` → `1845223349876512800`（zh 页两处一致）；`[1.0,1e2,0.10,-0,1e400]` 的 JS 读数实测 `[1,100,0.1,0,null]`；RFC 8259 §6 区间 `[-(2^53)+1, (2^53)-1]` 与四语引文一致。
- **jq / Python 对照表**（ja:119-124）逐项本机实跑：jq 1.7.1-apple `[1.0,1E+2,12345678901234567890,1E+400,1.5E-7]`；Python 3.12.2 `[1.0,100.0,12345678901234567890,Infinity]`；`JSON.parse`→`stringify` 的 `1` / `100` / `null` 一致。测试本次 0 SKIP（两套版本都在）。
- **JSONTestSuite**：fixture 318 个文件（95 y_ / 188 n_ / 35 i_），测试 202 passed、0 failed。
- **JSON5**：fixture 103 例、`json5@2.2.3`；规范 1.0.0 的 U+3000（Zs）、FEFF、U+2028/2029 空白、十六进制、`.5`、尾逗号、单引号、标识符键逐项对照（2026-10-28 抓取 spec.json5.org）。`0x1F90 → 8080`、`0xFFFFFFFFFFFFFFFFF` 精确（BigInt）由测试断言。
- **BOM 与 UTF-16**：`analyze()` 去 BOM 并报告；`decodeBytes()` 接受 BOM 的 UTF-16LE/BE 并以 `encodingNote` 提示；无 BOM 的 UTF-16 报 `utf16NoBom`；非 UTF-8 报首个坏字节偏移（0 起算）。
- **错误诊断**：`lineCol` / `jsonSyntaxError` 与 JSON Schema Validator 逐字相同（测试比对），行列以 1 起算；`codeFrame` 给上一行、出错行与 caret；长行按 72 字符截取。四语错误表 6 行、ja / ko / zh 示例块由测试复算（`jf:` 标注，`test-json-formatter.mjs:508-528`）。
- **树形**：每次 200 子项（`CHUNK=200`）、`EXPAND_LIMIT=2000`、JSON Pointer 空根显示 `""`、jq 根路径 `.`、重复键标 `duplicate`。
- **存储与统计**：`persistence.ts` 无 json-formatter（默认 `input`），`ztPersist` 单条上限 `50*1024` 字节的 JSON 文本，溢出时 `save()` 直接返回、旧值保留；输入 `< 200_000` 字符才随设置保存（`:578`）；Clear 调 `clear()` 后 `save()` 写入无 input 的设置；Ctrl/⌘+L 监听只在输入为空时 `run(true); save()`（`:1029-1031`）。`trackTool('json_formatter', action)` 只在 `run(force, 'format'|'minify')` 且 `view.ok`、当前输入/选项未变、与上次记录不同（`:802-805`）；键入 / 恢复 / 无效 / 失败 / AbortError / 过期结果均不记录（`:776-777`、`:798-800`）。页面不在 `network.ts`，加载 GA4 与 AdSense（ToolLayout 只对 `disabled` 与联网工具特殊处理）。
- **可见文案**：输入气泡「up to 50 MB / 2 MB 以上按 Format」与 `FILE_LIMIT=50*1024*1024`、`AUTO_LIMIT=2_000_000` 一致（单位见「未改」）；输出气泡的 1 MB 截断 = `HIGHLIGHT_LIMIT`；NaN/Infinity 在 JSON5 模式下报 `nonFinite`；jq 1.7.1 对孤立高低代理项的行为与 `surrNote` 一致（测试实跑）。

## 未核实

- 竞品段落（en:201-209、zh:168-172、ja:130-134、ko:118-122）全部为 2026-10-02 的观察，本轮未重跑。保留日期与原文；其中 en 表 JSONLint 的 `E008` 错误码未能从本次抓取的一手来源确认，维持原记录。
- 50 MB / 50 KB / 2 MB / 1 MB 的「MB / KB」写法沿用界面与 `size()` 的输出（脚本按字符数格式化），未改脚本；精确值为 52,428,800 字节、51,200 字节 JSON 文本、2,000,000 个 UTF-16 码元、1,000,000 个字符。要写成 MiB 需同时改 `size()` 与全部气泡，超出本轮范围。
- 10.7 MB / 2–4 秒 / 1–2 秒为 2026-10-03 的本机测量（AGENTS.md 同日条目），未重测。

## 未改（按冻结范围）

- steps 四语第 1 步仍写「2 MB 以内随输入格式化」。实际阈值是 2,000,000 个 UTF-16 码元（`AUTO_LIMIT`），与界面 `size()` 的字符计数口径一致；steps 按指令未动。
- 组件 `numNoteJs` 在 `1e400` 这类溢出值上说「值已改变」，而 `numberOut()` 对非有限值保留原字面量（`engine:526-530`），同一条注记的 `numOverflow` 又写「Kept as written」。可见文案矛盾，属脚本内文案，未改。

## 计数

JSON 记录 56 条：supported 29、qualified 11、corrected 13、unverified 3。测试：`test-json-formatter.mjs` 202 passed / 0 failed / 0 skipped；`test-tool-content-parity.mjs` 7753 passed / 0 failed（141 个工具）；`audit.mjs --quiet` 24 PASS / 0 WARN / 0 FAIL。

