# W6 B8 — jq-playground 事实核对（2026-10-27/28）

范围：`src/content/tools/jq-playground/{en,zh,ja,ko}.mdx` 的 FAQ 与正文、`JqPlaygroundTool.astro` 的可见文案（7 个说明气泡、`badIndent` 提示、`engineNote`），对照 `jq-playground-engine.js`、`public/jq-web/`、`ToolLayout.astro` 的 `ztPersist` 与快捷键。未改 FAQ 条数 / id / 顺序、steps、seoTitle / seoDescription、`engine:start` / `engine:end`、`persistence.ts`、`network.ts`、统计调用与测试脚本。基线 HEAD `c5cd5bf3`（工作树含其他 W6 批次改动，本次只改 jq-playground 四份 MDX 与组件四语言文案）。

## 修正（10 组，29 处文本）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | ja.mdx:75 | 「1.7.1 では、エラーメッセージに列番号が出ません」改为「フィルタのコンパイルエラーに列番号が出ません（JSON の構文エラーには出ます）」。jq 1.7.1 的解析错误带行列（实测 `{"日本":1 x}` → `at line 1, column 14`），编译错误只有行。 | 本机 `/usr/bin/jq` 为 `jq-1.7.1-apple`：`jq -n '.a \|'` → `at <top-level>, line 1:`（无列）；jq 1.8.0 NEWS「Include column number in parser and compiler error messages」。 |
| 2 | en.mdx:95、zh:79、ja:73、ko:80 | 「input.json 是输入内容加一个结尾换行」改为「输入非空且末尾没有换行时补一个」。`prepareInput()` 对已以 `\n` 结尾的输入不再追加，空输入保持为空。 | `jq-playground-engine.js:319-322`；实跑 `prepareInput('a') = "a\n"`、`prepareInput('a\n') = "a\n"`、`prepareInput('') = ""`。 |
| 3 | en.mdx:22、zh:22、ja:22、ko:22 | Ctrl/⌘+L 补「光标在工具内」条件。快捷键只在 `.tool-widget` 内焦点时生效，否则浏览器自己处理。 | `src/layouts/ToolLayout.astro:365-374`（`widget.contains(document.activeElement)`）。 |
| 4 | 同上四行 | 「事件包含工具名和动作」改为「工具的自定义事件…」，并写明 `copy` 只在复制输出成功时、`share` 只在复制分享链接成功时记录；复制命令行不记录。 | `JqPlaygroundTool.astro:1034`（输出复制 `'copy'`）、`:1041-1045`（分享链接 `'share'`）、`:1035`（复制命令无 action）；`src/layouts/BaseLayout.astro:207-212`（`tool_name` / `tool_action`）。 |
| 5 | en.mdx:31、zh:31、ja:31、ko:31 | 「用单引号包住过滤器」改为「按 POSIX shell 规则给过滤器和变量值加引号，需要时才用单引号并转义其中的单引号」。`shellQuote()` 对 `.foo` 这类安全词不加引号。 | `jq-playground-engine.js:82-87`。 |
| 6 | en.mdx:89、ko.mdx:68 | 「Show in input」补「编辑器中的输入」：打开文件后该按钮不渲染（`!state.file`）。 | `JqPlaygroundTool.astro:849-853`。 |
| 7 | en.mdx:89 | 「For a filter error」改为「filter compile error」：该按钮只在 `kind === 'compile'` 且有行号时出现；运行错误没有此按钮。 | `JqPlaygroundTool.astro:854-856`。 |
| 8 | en.mdx:114、zh:96、ja:90、ko:93 | `$ENV`「固定环境」改为「运行环境自己的值（HOME=/home/web_user，LANG 跟随浏览器语言）」；`now` 用浏览器时钟，`localtime` 用浏览器时区（原文「本地时间函数用浏览器时钟」把时区说成时钟）。 | `public/jq-web/jq.js:3578-3601`（`__localtime_js` 用 JS `Date` 本地时区）、`:3753-3768`（`LANG` 取 `navigator.languages[0]`，HOME `/home/web_user`）；实跑 `$ENV` 键为 `HOME LANG LOGNAME PATH PWD USER _`，`localtime` 小时等于本机 +08 本地时间。 |
| 9 | `JqPlaygroundTool.astro:90,203,315,427` | `badIndent` 由「--indent takes a number from 0 to 7」改为「本页的 --indent 接受 0–7；制表符用 --tab」。jq 1.7.1 实际接受 `--indent -1`（制表符），只是本页不支持。 | `jq --indent -1 -n '{"a":[1]}'` 输出制表符（jq 1.7.1 实测）；`parseJqCommand` 对 `-1` 返回 `badIndent`（`jq-playground-engine.js:238-242`）。 |
| 10 | zh.mdx:52 | 「页面在输出旁标出「退出码 1」」改为「两栏上方的状态行标出」；退出码在 `#jqp-statusline` / `#jqp-exit`，不在输出框旁。 | `JqPlaygroundTool.astro:510-516`（状态行在 `zt-io` 之前）、`:829-831`（`exitEl`）。 |

另修两处纯语法：ja.mdx:22「および エディタ内」去掉多余空格；ko.mdx:22「입력는」改为「입력은」。不算事实修正。

## 已核对未改（要点）

- **引擎与版本**：jq-web 0.6.2（`package.json:24`），`scripts/jq-web-patch.mjs:1-2` 写明由 jq 1.7.1 编译；测试 71 个 CLI 用例（`CLI_CASES` 71 项）逐字节比对，jq 1.7.1 手册 241 例中 239 例一致、2 例读 `$PAGER` 被排除（`test-jq-playground.mjs:185-206`）。
- **1.8 差异**：`trim`、`ltrim`、`rtrim`、`trimstr`、`toboolean`、`skip`、`add/1`、`@urid` 均为 1.8.0 新增；`ltrimstr` 非字符串报错、`limit` 负数报错、`[-1 as $x | 1,$x]` 由 `[-1,-1]` 变 `[1,-1]`，与 NEWS 一致。本机 1.7.1 验证 `trim/0`、`skip/2`、`add/1`、`@urid` 均「not defined」，`ltrimstr(1)` 返回原值，`limit(-1;…)` 不报错。
- **选项**：`-n -R -s -r -j -a -S -c -e --seq --stream`、`--tab`、`--indent 0–7` 与 `--arg` / `--argjson` 均由 `buildFlags()` 生成；`-e` 的 0 / 1 / 4 与 1.7.1 实测一致（true 0、false/null 1、无输出 4）。
- **上限**：自动运行 2 MiB、编辑器 2 MiB、文件 200 MiB、面板 1 MiB、高亮 256 KB、输出计数 50 MB（`JqPlaygroundTool.astro:593-599`）；文件超过 2 MiB 只显示前 20,000 字符（`:1109`）；停止预算 `10000 + round(input.length/1e6)*1000`（`:726`）。
- **隐私与存储**：工具在 Web Worker 中运行（`public/jq-web/jq-worker.js`），引擎文件来自本站 `/jq-web/`；`persist()` 保存 filter / opts / args 与 ≤40 KB 的输入（`:660-668`），`ztPersist` 单项 50 KiB（`ToolLayout.astro:128,228`）；Clear 调 `ztPersist.clear()` 后重新保存 filter/opts/args（`:1014-1021`）；Ctrl+L 由 ToolLayout 清空文本框与存储，组件清 args / 输出。
- **分享链接**：`encodeShare()` 只含 filter、flags、indent、变量名（`:600-615`）；`decodeShare()` 给变量空值 / `null`，不含输入与变量值；`applyShare()` 读取后 `history.replaceState` 去掉 hash（`:1133-1145`）。
- **统计动作**：`run`（提交修改 / 文件打开后成功）、`run-button`、`example`、`clear`、`copy`（输出）、`share`（分享链接）；只在 `exitCode === 0` 且同一 `runKey` 未记录时发送（`:719-726`、`:1034-1048`），输入中 / 初次恢复 / 停止 / 过期回包不发送。
- **可见文案**：7 个 Toggletip × 4 语言、`engineNote`、下载文件名（`output.json` / `output.jsonl`（-c）/ `output.txt`（-r/-j））、`20,000`、`2 MB`、`200 MB`、`1 MB`、`256 KB`、`0.25 s`、`Stop after 1 s` 与常量一致。
- **示例**：四语 17 处 `jqp-check` 由引擎复算（`test-jq-playground.mjs` 1,542 项），含 JSON Lines、运行时错误、`-e`、全角符号与雪花 ID。
- **竞品段落**：en / zh / ja / ko 各 3 条，日期均为 2026-10-02；本轮按指令未重跑，保留日期与原文。

## 未核实

- **Ubuntu 24.04 `1.7.1-3ubuntu0.24.04`、Debian 13 `1.7.1-6`**：`packages.ubuntu.com` 返回 500、`packages.debian.org` 与 `sources.debian.org` 返回反爬页，Launchpad 400。macOS 27 `/usr/bin/jq` 本轮实测 `jq-1.7.1-apple`；Homebrew 1.8.2 由 `formulae.brew.sh` API（生成日期 2026-10-27）核实。
- **竞品观察**：play.jqlang.org（jq 1.8、`repeat(1)` 约 30 秒超时）、jqkungfu.com、jsonwiz.com、json3.com、byteflow.tools 的 2026-10-02 实测未重跑。
- **分享链接与 GA page_location**：`#jq=` 片段在 `applyShare()` 之前已存在于地址栏；GA4 是否把片段写进 `page_location` 未实测，本轮未改隐私文字。属既有行为，建议单独核实。

## 限定（保留原文，不计为错误）

- FAQ / Limits 的「1 second per MB of input」：代码按 `input.length`（UTF-16 码元）计，1 MB 中文输入约 3 倍字符数，预算比按字节算更宽。四语与组件气泡一致；本批未改，避免与测试断言冲突。
- 「40 KB」输入上限同样按 UTF-16 长度判断（`PERSIST_INPUT_LIMIT`），不是 UTF-8 字节。
- 「Files up to 200 MB」「2 MB」按 1024 进制（`formatBytes` 也按 1024 显示），与十进制 MB 有约 5% 差异。

## 来源（2026-10-27/28 查阅）

- jq 1.8.2 NEWS（新增函数、行为变更、列号）：https://raw.githubusercontent.com/jqlang/jq/jq-1.8.2/NEWS.md
- jq 1.7.1 本机 `/usr/bin/jq`（`jq-1.7.1-apple`）：解析错误行列、编译错误无列、`-e` 0/1/4、`--indent -1`、1.8 函数缺失
- jq-web 0.6.2：`node_modules/jq-web/package.json`；`scripts/jq-web-patch.mjs:1-2`（jq 1.7.1）
- Emscripten 环境与本地时间：`public/jq-web/jq.js:3578-3601`、`:3753-3768`（实跑 `$ENV`、`localtime`）
- gojq 差异：https://raw.githubusercontent.com/itchyny/gojq/master/README.md（无 `-S` / `-a` / `--seq`、对象键无序、任意精度整数）
- Homebrew jq：https://formulae.brew.sh/api/formula/jq.json（1.8.2，generated 2026-10-27）

## 测试

- `node scripts/test-jq-playground.mjs`：1,542 passed / 0 failed / 0 skipped。
- `node scripts/test-tool-content-parity.mjs`：141 tools / 7,753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b8-jq-playground.md`
- `docs/2026-10-27-w6-b8-jq-playground.json`
