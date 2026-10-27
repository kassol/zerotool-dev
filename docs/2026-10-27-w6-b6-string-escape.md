# W6 batch 6 — string-escape 事实核对（2026-10-27/28）

范围：`src/content/tools/string-escape/{en,zh,ja,ko}.mdx` 与 `src/components/tools/StringEscapeTool.astro` 的可见文案。未改 `engine:start` / `engine:end`、逻辑、测试、`persistence.ts`、`network.ts`、统计与 steps。基线 `c5cd5bf3`。

## 口径

- 实现主张以组件 file:line 为准；外部事实用本轮抓取的一手来源；旧仓库记录只当历史。
- 竞品段落是 2026-10-01 的观察，本轮不重跑，保留日期并记为 qualified。
- 四语同题同改；FAQ 条数 / id / 顺序与 seoTitle 未动。

## 总量

共审查 61 组陈述：supported 34、corrected 19、qualified 8、unverified 0。四语各 15 组，另加英文的性能一句。

| 语言 | 陈述 | supported | corrected | qualified |
|---|---:|---:|---:|---:|
| en | 16 | 8 | 6 | 2 |
| zh | 15 | 8 | 5 | 2 |
| ja | 15 | 10 | 3 | 2 |
| ko | 15 | 8 | 5 | 2 |

## 修正（8 组条目，按语言计 19 条）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en:23 / zh:23 / ja:23 / ko:23 | SQL 注入题的原因由「数据库、设置、字符集」改为「SQL 方言与配置（例如 `NO_BACKSLASH_ESCAPES`）与字符集」。 | OWASP SQL Injection Prevention Cheat Sheet（2026-10-27 抓取）：「Escaping All Dynamic Inputs (STRONGLY DISCOURAGED)」「Escaping depends on the SQL dialect and configuration: for example, MySQL's NO_BACKSLASH_ESCAPES mode…」。 |
| 2 | en:82 / zh:74 / ko:85 | NUL 后接数字由「必须写 `\x00`」改为「工具写成 `\x00`，`\u0000` 同样有效」；HTML 的 emoji 由「要写成一个引用」改为「数字引用必须是一个 `&#x1F600;`」。直接写 😀 本来就不需要引用。 | ECMA-262 `\0` 的 lookahead 与 Annex B LegacyOctalEscapeSequence；WHATWG HTML §13.2.5.84（代理项引用 → U+FFFD）。引擎 `jsonEscape` 未涉及；JS 分支在 660 行。 |
| 3 | en:43 | 「the tool checks every input against it」改为「the test suite checks the output against it」。 | 运行时不调用 `JSON.parse`；比对在 `test-string-escape.mjs` 156–163 行。 |
| 4 | en:102 | 「OWASP's two fixes」改为「two OWASP approaches」，并补全角 `＝ ＋ － ＠`。 | OWASP CSV Injection：清理步骤是「加引号 + 前置单引号 + 双写引号」，Tab 是单独的「Excel-resistant mitigation」。 |
| 5 | zh:90 / ko:98 | 补全角 `＝ ＋ － ＠`；ko 补 Tab 与换行。 | 同上；OWASP 页面明确列出全角变体「may be interpreted as formulas in some locales (e.g., Japanese environments)」。引擎 `FORMULA_START`（1019 行）也含 U+FF1D / FF0B / FF0D / FF20。 |
| 6 | en:121 / zh:107 / ja:115 / ko:115 | CSV 反转义由「只读一个字段、不读整份文件」改为：带引号字段去掉引号；多个未加引号字段原样返回并加说明；不读整份文件。Shell 由「遇到未加引号的空白就停止」改为「词间未加引号的空白报错，末尾空白忽略」。 | `csvUnescape`（1034–1056）：无引号且含分隔符时 `done(text, notes)`；`shellUnescape`（1186–1192）：中间空白 `fail('shellWords')`，末尾空白 `break`。 |
| 7 | en:127 | 36 万字符「well under a second」改为「about a second on a desktop machine（测试允许 1.5 s）」。 | `test-string-escape.mjs:602` 的上限是 1.5 s × CI 倍数；本轮该断言通过。 |
| 8 | 组件 `csvBareQuote`（en:63 / zh:151 / ja:239 / ko:327） | 「RFC 4180 requires such a field to be quoted」改为「RFC 4180 does not allow a `"` there: enclose the field in quotes and write `"` as `""`」。 | RFC 4180 §2 第 5 条是「may not appear」，第 6 条用「should be enclosed」，不是 requires。 |

按语言计 19 条修正：SQL 题 4 条、details 3 条、CSV 段 3 条、limits 4 条、性能 1 条、组件错误文案 4 条。逐条见 JSON。

## 已核对未改（要点）

- 11 种格式、选项与方向与 `MODE_LIST` / `DEFAULT_OPTS` / `applyUI` 一致；`steps` 6 条对应界面。
- JSON：RFC 8259 §7 的 7 个转义与 `\uXXXX`；`jsonEscape` 与 `JSON.stringify` 同一写法；`jsonAscii` 与 Python `json.dumps(ensure_ascii=True)` 一致（测试 137–151）。
- JavaScript：strict 求值、`\01` 报错、`\u{…}`、U+2028/2029 总是转义、模板字符串 `${` 转义（651–669）。
- Java：JLS §3.3 先译 Unicode 转义，`\u000a` / `\u0022` 报错；`\u` 后 4 位、八进制 0–377（738–794）。
- C：C11 §6.4.4.4；`??` 第二个 `?` 写 `\?`；U+0080–U+009F 按 UTF-8 字节；`\x` 读尽后续十六进制位（798–867）。
- Python：`repr`/`ascii` 规则、`\N{}` 不支持、未知转义保留反斜杠并注 SyntaxWarning（881–942）。
- HTML：`createHTMLDocument` + textarea RCDATA，脚本不执行、图片不加载；C1 数字引用按 Windows-1252（1358–1366）；代理项引用两个 U+FFFD（WHATWG §13.2.5.84）。
- XML：XML 1.0 Char 范围、5 个预定义实体、`&#xD;`、属性值 Tab/LF（969–1014）。
- SQL：ISO 单引号加倍；MySQL 8.4 表 11.1 与 `NO_BACKSLASH_ESCAPES`；PostgreSQL（`standard_conforming_strings=on`）、SQLite、SQL Server、Oracle 反斜杠普通；NUL 在 PostgreSQL 字符串常量不允许（1059–1110）。
- CSV：RFC 4180 §2；OWASP 全角变体与 Tab 前缀；`'` 前置 + 引号 = OWASP 三步清理（1021–1056）。
- Shell：`shlex.quote` 同输出；`$'…'` 的 `\u`/`\U` 是 bash 扩展，POSIX.1-2024 §2.2.4 的转义表没有这两项（1167–1292）。
- `network.ts` 的 `networkToolSlugs` 不含 string-escape（grep 0 条），与「不上传输入」的说明一致。
- 隐私/统计：`persistence.ts:54` 为 `preference`；`savePrefs` 只写 mode/dir/opts（1378–1380）；文本不写存储；`trackTool('string-escape', mode_dir)` 仅在 change / 模式 / 方向 / 选项 / Swap / Example 成功时发，按 `tracked[tag] !== r.output` 去重（1413–1432）；复制不发事件（1492–1498）；页面加载 GA4 与 AdSense 与 `disabled` 清单无关。
- 日文 / 韩文 Windows 的 ¥ / ₩：Microsoft Learn「Character Sets Used in File Names」（CP932 把 U+005C 与 U+00A5 映射到同一字符）；Wikipedia「Won sign」（CP949 0x5C 为 won sign，系统字体把反斜杠画成 ₩）。两处正文表述与来源一致。
- MySQL 8.4 手册 11.1.1 的转义表确为「Table 11.1」。

## 观察未改

- **qualified**：竞品段落（`escape.utils.com`、`lddgo.net`、`codertools.net`、`devlab.itlibra.com`、`Toolpods` 等）都是 2026-10-01 的桌面 Chromium 观察，本轮未复测；日期保留。
- **qualified**：组件 `note.htmlControl` 说控制字符「HTML does not allow them in text, raw or as references」。WHATWG 把裸控制字符与数字引用都定为 parse error，但除 C1 映射与 U+0000 外会照原样进入 DOM；这是合规层面的说法，本轮不改，避免把「不合规」误写成「会被删除」。
- **qualified**：ja:47 / en:82 的 JLS 链接指向 §3.10.5（String Literals 的行终止符规则）；Unicode 转义先于词法分析的规则在 §3.3，表内已同时链 §3.3。未改链接。
- **qualified**：ko:34「코드 페이지 949에서는 0x5C 자리가 원화 기호」按 Wikipedia 的表述；Unicode 映射表把 CP949 的 0x5C 映到 U+005C，₩ 是代码页 / 字体的显示约定。保留并在此注明。
- **未核实**：en:127「much larger inputs work but make the text boxes slow to redraw」本轮只跑了 36 万字符的测试断言，更大输入的绘制耗时未测。

## 来源（2026-10-27/28 抓取）

- OWASP CSV Injection：https://owasp.org/www-community/attacks/CSV_Injection
- OWASP SQL Injection Prevention Cheat Sheet：https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- RFC 4180：https://www.rfc-editor.org/rfc/rfc4180.html
- MySQL 8.4 Reference Manual 11.1.1：https://dev.mysql.com/doc/refman/8.4/en/string-literals.html
- WHATWG HTML §13.2.5.84：https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state
- Microsoft Learn, Character Sets Used in File Names：https://learn.microsoft.com/en-us/windows/win32/intl/character-sets-used-in-file-names
- Wikipedia, Won sign：https://en.wikipedia.org/wiki/Won_sign
- POSIX.1-2024 §2.2.4：https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html

## 测试

- `node scripts/test-string-escape.mjs`：修改前 317 passed / 0 failed / 1 skipped；修改后 317 passed / 0 failed / 1 skipped（bash 4.2+ 的 `$'\u'` 项 SKIP）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。
- 未跑 `npm run build`（按要求）。

## 交付物

- 本文件。
- `docs/2026-10-27-w6-b6-string-escape.json`：61 组陈述与 file:line。
