# W4 剩余工具交互对照（批次 A，2026-10-27）

范围：`text-to-binary`、`string-escape`、`number-base`、`url-parser`。实际操作 ZeroTool 生产站（`https://zerotool.dev`）与本次 Bing 自然结果前三。搜索实际跳转到 `cn.bing.com`，界面为英文；这是本次会话排序，不是美国或全球排名结论。视口 1366 × 900 CSS px，缩放 1。

## 计数口径

页面点击指用户为完成任务在页面内的点击（输入框聚焦与按钮），不计导航、搜索与证据读取。输入次数按实际粘贴 / 键入次数另记。键盘路径从页面 `h1` 起按 Tab，记录到达主输入框的按键次数；不代表整页只有这些可聚焦元素。未发送显式滚轮；记录结束时页面 `scrollY`，网站自行滚动另注。文件对话框与下载不进入本批四个文本任务。

## 结果

| 工具 | 站点 | 本次排名 | 页面点击 | 结果 | 结果 scrollY | 备注 |
|---|---|---:|---:|---|---:|---|
| text-to-binary | ZeroTool | — | 0 | 正确（13 字节 UTF-8） | 0 | 键盘 10 次 Tab 从 h1 到文本框；Clear 后 3 次 Tab |
| text-to-binary | RapidTables | 1 | 1 | 正确 | 0 | 需点 `Convert` |
| text-to-binary | ConvertBinary | 2 | 1 | 正确 | 0 | 需点 `Convert to Binary` |
| text-to-binary | Coddy | 3 | 0 | 正确 | 0 | 输入即转换 |
| string-escape | ZeroTool | — | 0 | 正确 JSON 转义 | 0 | 键盘 12 次 Tab 从 h1 到文本框 |
| string-escape | escape.utils.com | 1 | 1 | 错误 | 89 | 输出 `\bsay\b \"\bhi\b\"\\bnC\b:\\\btemp\b`：插入字面 `\b`，换行未正确转义 |
| string-escape | Doli Tools | 2 | 1 | 未完成 | 0 | 点击 Escape 后 `#result` 仍为空，未取得输出 |
| string-escape | lddgo | 3 | 1 | 正确 | 0 | 结果在 `#transformResult` |
| number-base | ZeroTool | — | 0 | 正确（255 → 11111111 / 377） | 0 | 键盘 13 次 Tab 从 h1 到输入框 |
| number-base | RapidTables | 1 | 1 | 正确 | 0 | 页面显示 `(255)10 = (11111111)2` |
| number-base | UnitConverters | 2 | 1 | 未完成 | 0 | 填 255 并点 Convert 后 `#ucto` 仍为空 |
| number-base | BinaryHexConverter | 3 | 1 | 正确 | 0 | 结果在 `#resulttxt` |
| url-parser | ZeroTool | — | 0 | 正确（host / path / query / fragment） | 0 | — |
| url-parser | codeshack.io | 1 | 0 | 正确 | 0 | 输入即解析 |
| url-parser | url-decode.com | 2 | 1 | 正确 | 0 | 需点 `Parse URL` |
| url-parser | freecodeformat.com | 3 | 0 | 正确 | 0 | 默认勾选 Auto-parse |

四个 ZeroTool 任务都没有出现比已完成竞品更多的页面点击，也没有必须滚动才能读到结果的情况。两个竞品未完成任务按缺口记录，不改写成成功。

## 键盘与后续

ZeroTool 四个任务均可只用 Tab 与键入完成主流程；竞品键盘路径本批没有逐站记录，不能据此声称本站键盘可达性更好。

本批只覆盖四十个精品工具中的四个；W4 总体仍为部分覆盖，原复评矩阵未改写。本记录不含 W3 计时，也不构成真实用户 INP 证据。

## 复现输入

- text-to-binary：`OpenCode 2026` → `01001111 01110000 01100101 01101110 01000011 01101111 01100100 01100101 00100000 00110010 00110000 00110010 00110110`
- string-escape（JSON）：`say "hi"` + 换行 + `C:\temp` → `say \"hi\"\nC:\\temp`
- number-base：十进制 `255` → 二进制 `11111111`、八进制 `377`
- url-parser：`https://example.com/path?a=1&b=two#frag`
