# W6 batch 6 — number-base 事实核对（2026-10-27）

范围：`src/content/tools/number-base/{en,zh,ja,ko}.mdx` 的正文与 FAQ，`src/components/tools/NumberBaseTool.astro` 的可见文案；`src/data/persistence.ts`（第 57 行 `'number-base': 'preference'`）与 `src/data/network.ts`（无本工具）只读核对。未改 `engine:start` / `engine:end`、脚本逻辑、FAQ 数量 / id / 顺序、steps、seoTitle、持久化策略与统计口径。基线 HEAD `f358d03c`。

## 修正（6 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:18、zh.mdx:18、zh.mdx:63、ko.mdx:18 | 终止小数的条件补「最简分数 / 기약분수」：原文 `A fraction ends in base 2 only if its denominator is a power of 2`、`二进制只能精确表示分母是 2 的幂的分数`、`2진수로 끝나는 소수는 분모가 2의 거듭제곱인 분수뿐`、`分母能整除新进制某次幂的小数才会结束` 对非最简分数不成立（3/6 的二进制 0.1 终止，分母 6 不是 2 的幂）。 | 有理数 p/q 在基 b 下有限 ⟺ 约分后 q 的质因数全整除 b（初等数论）；引擎 `parseNumber` 先 `gcd` 约分（组件 474–483 行），所以工具本身只按最简分数判断。 |
| 2 | en.mdx:15、zh.mdx:15、ja.mdx:15、ko.mdx:15 | 「显示计算过程会看到反方向的除基取余」改为附条件：目标进制须同时不等于 10 与输入进制。原文把展开与除法写成总是同时可见，二进制输入 + 默认目标 2 时只有展开。 | `renderSteps()` 只在 `target !== 10 && target !== r.readBase` 时输出除法（组件 708 行）；展开仅对非十进制输入（696–703 行）。 |
| 3 | en.mdx:35、en.mdx:47 | Discord 例子：原文称 `175928847299117063` 是「documentation's sample ID」、`41944705796`「与文档图相同」。2026-10-27 抓取的 API reference 的 Snowflakes 节已无该样例 ID 与数值图，只保留 42 位时间戳字段与 epoch 定义，因此改为引用原文措辞与字段表，并把结果写明为 2016-04-30。 | https://discord.com/developers/docs/reference#snowflakes（2026-10-27）：`always returned as strings in the HTTP API to prevent integer overflows in some languages`；字段表 Timestamp 63–22、42 bits、1420070400000；`1420070400000 + 41944705796` = 2016-04-30T11:18:25.796Z（Python datetime 复算）。数值本身未变，页面 `nb` 标注仍通过。 |
| 4 | en.mdx:108 | `Excel-style 10-bit or 40-bit patterns appear as the low bits of the 16-bit or 64-bit row` 改为：同一负值的 10 / 40 位模式是该值 16 / 64 位行的低位；把短模式粘进更宽位宽会按正数读。原句容易被读成「可原样粘贴读取」。 | `twosComplement()` 对正数只按位长判断（组件 486–499、557–563 行）：`1111110110` 选 16 位有符号读作 1014，不是 -10。Excel DEC2BIN 负数固定 10 位、DEC2HEX 固定 40 位（Microsoft DEC2BIN 文档，2026-10-27）。 |
| 5 | en.mdx:90 | 引用错误消息时把直引号 `"2"` 改为页面实际输出的弯引号 `“2”`。 | `STRINGS.en.err.invalidDigit` 模板使用 `\u201c` / `\u201d`（组件 42 行）。 |
| 6 | NumberBaseTool.astro:23、70、117、164 | `stepsTooLong` 改为写明两个条件：「输入不超过 64 位，且十进制值不超过 64 位」。原文只说「64 位以内的整数」，但 64 位十六进制（十进制 77 位）时除基取余返回 null，面板只显示这句。 | `stepsToDecimal()` 在输入位数 > 64 时返回 null（575 行）；`stepsFromDecimal()` 在十进制位数 > 64 时返回 null（592 行）；`renderSteps()` 任一为 null 都显示 `stepsTooLong`（698、707 行）。 |

## 已核对未改（要点）

- 数值全部复算一致：Discord `175928847299117063` → `271065AC1020007`、64 位二进制、42 位 = `41944705796`、`parseInt` → `175928847299117060`；`-10` → `-1010` / `11110110` / `FFFFFFF6`；`FFFFFFF6` 有符号 32 位 → `-10`；`FFFFFFFFFFFFFFFF` → `18446744073709551615`；`1234567890123456789` → `112210F47DE98115`、`JSON.parse` → `1234567890123456800`；`FF38` 有符号 16 位 → `-200`（不勾选 65336）；`-10` 16 位 → `1111111111110110`（低 10 位 `1111110110` 与 Excel 一致）；`0.1` → `0.0(0011)` / `0.1(9)`；`0.625` → `0.101` / `0.A`；`0.75` → `0.11` / `0.C`；八进制 `755` → `111101101`。
- 输入规则与代码一致：下划线 / 空格 / 撇号只在数字之间（319、436–447 行；前缀后允许 `_`，440 行）；逗号只在十进制整数部分且首组 1–3 位、其余 3 位（436–438、463–471 行）；`0b/0o/0x` 与输入进制一致时去掉、十进制下按前缀判定（403–416 行）；`#FF5733` 只在 16 进制且首位（417–420 行）；全角 U+FF01–FF5E、U+3000 等宽空格与 U+2212 系列减号（320–338 行）；符号只能最前（399、454 行）；`10102` 第 5 位、`1012` 第 4 位、`1F` 第 2 位与附带提示（42–44、456 行）。
- 补码范围与提示：接受 `-2^(N-1)` 到 `2^N-1`，超出报 `min..max`（557–563、760 行）；`-129` / `256` 在 8 位下报错、`129` 读作 `-127`；小数输入拒绝（559 行）；位宽只有 8/16/32/64/128（205 行）。
- 分数：先查循环节再判截断，最多 64 位加 `…`（529–548 行）；括号不能回填（457–458 行）；不显示 IEEE 754 布局（引擎无浮点输出）。
- 限制：`MAX_DIGITS = 20000`、按整数 + 小数合计计数（316、462 行）；Python `int()` 默认 4,300 位（本机 Python 3.12 `sys.int_info.default_max_str_digits = 4300`，Python 文档同）；基 2–36 与 Python `int(s, base)`、`Number#toString(radix)` 一致。
- 隐私与统计：`persistence.ts` 为 `preference`，页面加载 GA4 与 AdSense（`BaseLayout.astro` 只在 `sensitive` 时跳过，140、185 行）；`saveState()` 只写 8 个设置键（659–662 行），`save` 走 `zt-input-number-base`（ToolLayout 222–232 行），输入不落盘；`Ctrl/⌘+L` 对 `preference` 不删设置（ToolLayout 236–239、368–374 行）；`trackTool('number_base','convert')` 只在 `change` / 选项变更且结果文本变化后发送（717–725、779、782–788 行），`copy` 只在剪贴板成功后发送（831–837 行），事件只含 `tool_name` / `tool_action`（BaseLayout 206–213 行）。FAQ 列出的 8 个设置项与代码逐项对应。
- 组件文案：`tips.base` / `number` / `format` / `width` / `signed` / `other` / `steps` 与实现一致（含 64 位展开 / 十进制除法的两个上限、补码并集范围、第五行默认 36、复制含分组与前缀）；`twosInfo` 与 `err.*` 模板与输出一致。
- 竞品段落四语均保留 2026-10-01 日期与「当天输入」的措辞；本轮未改数字。

## 未核实

- 竞品行为 4 组（RapidTables、tool.lu、hogehoge.tk、calculkorea）是 2026-10-01 的观察，本轮未重跑，JSON 中标 `unverified`。
- 「许多转换器把值存成 JavaScript Number」是概括，未逐一取证；本轮只复算了 Number 侧的结果（`(9007199254740993).toString(16)` = `20000000000000`）。
- Discord 旧版文档是否曾列出该 sample ID：本轮只按 2026-10-27 抓取的当前页面改写，不再声称；历史页面未取证。

## 发现的问题（未改）

- **B1** `renderSteps()` 在除基取余因十进制超过 64 位返回 null 时，丢弃已经算出的按权展开，只显示 `stepsTooLong`（组件 698、706–707 行）。输入 64 位十六进制（十进制 77 位）时看不到展开；`tips.steps` 仍写「展开最多 64 个输入数位」。建议先写展开再判断 `div`。
- **B2** `copy` 事件在 `isCurrent()` 判断之外发送（组件 831–837 行）：结果已过期但剪贴板写入成功时仍记 `copy`，与 `convert` 的去重口径不一致。FAQ 只承诺「写入成功后记 copy」，文字无需改。
- **B3** 全站 `Ctrl/⌘+L` 只在焦点位于 `.tool-widget` 内时清空（`ToolLayout.astro` 361–375 行），四语 FAQ 的「清空当前输入」未限定焦点。同类工具页均如此写，本轮未改文案。
- **C1** `highlight()` 在输入进制为非固定行（如 36）且第五行选了别的进制时不选中任何行（组件 683–689 行），仅影响高亮。
- **C2** `parseNumber` 接受 `.5` 与 `0.`（448–453 行），正文表格未列出这两种写法；未见相反声明。

## 来源（2026-10-27 查阅）

- Discord API reference：https://discord.com/developers/docs/reference#snowflakes
- Python Built-in Types「Integer string conversion length limitation」：https://docs.python.org/3/library/stdtypes.html#int-max-str-digits；本机 `sys.int_info.default_max_str_digits` = 4300（Python 3.12.2）
- Microsoft DEC2BIN 関数：https://support.microsoft.com/ja-jp/office/dec2bin-%E9%96%A2%E6%95%B0-0f63dd0e-5d1a-42d8-b511-5bf5c6d43838
- Microsoft BASE 関数：https://support.microsoft.com/ja-jp/office/base-%E9%96%A2%E6%95%B0-2ef61411-aee9-4f29-a811-1c42456c6342
- 运行核对：Node 24.14.0（`Number.MAX_SAFE_INTEGER`、`parseInt`、`toString(2/16)`、`0.1+0.2`）、OpenJDK 21.0.1（`Integer.toBinaryString(-10)`）、Python 3.12.2（`datetime`、`int_info`）

## 测试

- `node scripts/test-number-base.mjs`：修改前 514 passed / 0 failed；修改后 514 passed / 0 failed（页面 `nb` 标注、STRINGS 键与占位符、整页事件都通过）。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b6-number-base.json`：278 条（supported 234 / corrected 13 / qualified 8 / unverified 23），按语言 en 74、zh 67、ja 72、ko 65。
- 本文件。未改测试、engine 块、其他工具；工作树中其他文件的改动不属于本批。
