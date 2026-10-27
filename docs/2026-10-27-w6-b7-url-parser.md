# W6 batch 7 — url-parser 事实核对（2026-10-27/28）

范围：`src/content/tools/url-parser/{en,zh,ja,ko}.mdx` 与 `src/components/tools/UrlParserTool.astro` 的可见文案（`STRINGS` 与提示气泡）。未改 `engine:start` / `engine:end`、解析与编辑逻辑、`persistence.ts`、`network.ts`、统计、`steps`、`seoTitle`、FAQ 条数 / id / 顺序。基线 HEAD `d6b1e116`（工作区另有并行批次改动，不在本次范围）。

## 口径

- 实现主张以组件 file:line 为准；外部事实用今天抓取的一手来源（列表在文末）。旧仓库文档只当历史记录。
- 竞品段落与 Chrome 152 的浏览器观察是历史记录，保留日期，本轮标为 qualified，不改写成今日结论。
- 四语同题同改；只改事实，不扩展功能。

## 总量

共审查 75 组陈述：supported 44、corrected 23、qualified 8、unverified 0。

| 语言 | 陈述 | supported | corrected | qualified |
|---|---:|---:|---:|---:|
| en | 19 | 9 | 8 | 2 |
| zh | 19 | 12 | 5 | 2 |
| ja | 19 | 12 | 5 | 2 |
| ko | 18 | 11 | 5 | 2 |

## 修正（23 条，按语言计）

1. **WPT 数字过期**：`en:70` / `zh:74` / `ja:76` / `ko:72` 由「888 / 896」改为「883 / 891」，并写明 8 个失败全是 `xn--` / IDNA 边角。依据：今天抓取的 `web-platform-tests/wpt` `url/resources/urltestdata.json`，Node v24.14.0 实跑 891 条，8 条失败（`xn--pokxncvks` 变体、`file://xn--/p`、`https://xn--/`）。
2. **「浏览器只按 UTF-8 读百分号编码」**：`en:22` / `zh:22` / `ja:22` / `ko:22` 的 FAQ 与 `zh:42` / `ja:42` / `ko:42` 的正文。浏览器不会把查询串百分号编码解成文本再发送；按 UTF-8 解码并产生 U+FFFD 的是 `URLSearchParams` 与本工具，浏览器发送的仍是原字节，服务端可按旧编码读回。依据：WHATWG URL Standard §5.1（urlencoded parser 的 UTF-8 decode）、`URLSearchParams` 实测（`%C4%E3%BA%C3` → 3 个 U+FFFD，`%BA%CE%BB%EA` → `�λ�`，`%83%89%81%5B%83%81%83%93` → `���[����`）。
3. **「strips spaces」过宽 / 主机规则未限定特殊协议**：`en:34` 改为「trims leading and trailing spaces」，并把主机小写、Punycode、点分段与默认端口限定为 special schemes；`foo://EXAMPLE.com/` 这类非特殊协议保留 opaque host（Node 24 实测 `EXAMPLE.com` 原样、`例え.jp` 百分号编码）。依据：URL Standard basic URL parser 首两步、host parser 与 opaque host parser（fetch today）。
4. **查询串归因**：`en:40` 由「query strings follow application/x-www-form-urlencoded」改为「the tool reads the query with the parser URLSearchParams uses」。URL Standard 没有规定所有查询串都按 form-urlencoded 解析；这是 `URLSearchParams` 与本工具的读法。
5. **「URL 一定改变」过强**：`en:62` 的 `the URL changes even when you edit nothing` 改为 `can change`。`URLSearchParams.toString()` 只对非规范写法的对（`flag`、`%zz`、坏 UTF-8）产生差异；已规范的查询串往返不变。
6. **fragment 与 fetch 凭据**：`en:13` 补「fragment 不发给服务器；`fetch()` 拒绝带凭据的 URL」。依据：RFC 3986 §3.5、RFC 9110 §4.2.5；Fetch Standard Request constructor「If parsedURL includes credentials, then throw a TypeError」。
7. **RFC 3986 徽章过度承诺**：组件 `rfcValid`（`UrlParserTool.astro:67` / `182` / `297` / `412`）由「Valid RFC 3986 URI reference.」改为「No problem found by this RFC 3986 check.」。`rfcCheck` 的方括号检查只做字符类匹配，`http://[:::]`、`http://[1:2:3:4:5:6:7:8:9]` 都返回「无问题」，而 RFC 3986 §3.2.2 的 `IPv6address` ABNF 不允许。限制段已写明这是正则拆分加字符检查，徽章照此收窄。
8. **「浏览器忽略了值」**：组件 `editIgnored`（`48` / `163` / `278` / `393`）由「浏览器没有接受」改为「URL 没有改变」。`setComponent`（884–901）把「赋同一主机名但大小写不同」判成 `ignored`：`u.hostname = 'EXAMPLE.com'` 规范化后 `href` 不变，浏览器并未拒绝该值。改文案不触碰引擎。

## 已核对未改（要点）

- **FAQ parser / 端口**：默认端口表与 `SPECIAL`（587）一致：ftp 21、file 无、http 80、https 443、ws 80、wss 443；`:443` 被省略、请求仍到 443、端口栏占位符（`renderFields` 1200）与 `defaultPort`（1039）都对。RFC 3986 附录 B 的第二次拆分与主机差异警告在 657–672、1053–1059。
- **FAQ no-scheme / localhost**：`diagnoseFailure`（934–968）给出无协议、相对路径、`localhost:3000/api` 读成 scheme 的解释与 `https://…` 建议；`schemeLooksLikeHost`（1030–1032）确实带按钮。
- **FAQ + 与 `%2B`**：`parseQuery`（849–868）用 urlencoded 规则解码 `+`，`serializeQuery`（872–881）编码空格为 `+`；`%2B` 实测解成 `+`。
- **FAQ edit-params**：未改对保留 `raw`（876），只对 `edited` 对调用 `URLSearchParams`（878）；`flag`、`%zz`、坏 UTF-8 的逐字节保留由测试覆盖。
- **隐私 / 统计**：组件无 `localStorage` / `fetch` / `ztPersist`（测试静态断言）；`persistence.ts` 无 `url-parser` 条目，`network.ts` 也无；`trackTool` 只发 `tool_name` / `tool_action`（`BaseLayout.astro:207–212`）；`render(true)` 只在 change、字段 / 参数提交、示例 / 建议成功时调用（1383–1386、1206–1211、1373–1381、1421–1427），`lastTrackedResult` 去重（1367–1370），`standardHostProblem` 时不计（1367）。示例与建议按钮的路径也符合。
- **示例位置 63**：从仓库原文取 `up-check` 的输入计算，`%` 是第 63 个码点（不是 UTF-16 单元差异），文案正确；`up-check` 由测试复算（576 项全过）。
- **反斜杠 / IPv4 / IDN**：今天复跑 Python 3.12.2 `urlsplit` → `good.example`、curl 8.7.1 → `Host: good.example`、Go 1.27.3 → `invalid userinfo`；`0x7f.1` → `127.0.0.1`；`раураl.com` → `xn--l-7sba6dbr.com`、`日本語.jp` → `xn--wgv71a119e.jp`、`한국인터넷진흥원.한국` → `xn--3e0bx5e6xzftae3gxzpskhile.xn--3e0b707e`，与页面一致。
- **限制**：无 PSL（代码无表）、参数表 500（`MAX_PARAMS` 1083）、仿冒提示只覆盖混用文字与西里尔 / 希腊形似字母（788–818）、RFC 栏是正则加字符检查（677–732），均与文案一致。
- **可见文案**：五个气泡、`notStandard`、`portDefault` / `portNone`、`rfcParts`、`queryLimit`、`decodedHash`、`okBase` 与实现一致；`notStandard` 的 Node 拒绝由测试在全部 forbidden domain 字符上核对。

## 历史观察（qualified）

- **竞品**：`en:66`、`zh:70`、`ja:72`、`ko:68` 是 2026-10-01 的桌面 Chromium 观察（codeshack.io、Tooltada、Web ToolBox、易白工具），本轮未复测，日期保留。
- **Chrome 152 的空格主机**：`en:71`、`zh:75`、`ja:77`、`ko:73` 的 `http://exa mple.com/` → `exa%20mple.com` 是历史浏览器观察，本轮只用 Node 24 确认「Node 拒绝」，未重开浏览器；测试里是 Chrome-like 替身。

## 发现的问题（范围外，未改）

- **B 档**：`rfcCheck` 不校验 IPv6 语法（705–706），`[:::]` 与 9 段地址被当作无问题；徽章已收窄，引擎块按约束未动。若要真正校验，需要 ABNF 级 IPv6 解析并补测试。
- **C 档**：`setComponent`（884–901）对「只改大小写的主机名」仍返回 `ignored`；文案已改为中性，逻辑未动。
- **C 档**：`src/content/blog/url-parser-guide/en.mdx` 不在本次范围；它和工具页共享部分结论（Punycode、混合文字），若后续改 WPT 数字或 not-UTF-8 说法需同步检查（本轮未改）。

## 验证

`node scripts/test-url-parser.mjs` 576 passed / 0 failed；`node scripts/test-tool-content-parity.mjs` 7,753 passed / 0 failed；`node scripts/audit.mjs --quiet` 24 PASS / 0 WARN / 0 FAIL。未运行 `npm run build`（按任务要求）。

## 来源（2026-10-27 抓取）

- WHATWG URL Standard — <https://url.spec.whatwg.org/>（basic URL parser 首尾 C0 / 空格与 tab/newline、forbidden domain code point、IPv4 parser、default port 表、urlencoded parser 的 UTF-8 decode）
- WPT `url/resources/urltestdata.json` — <https://raw.githubusercontent.com/web-platform-tests/wpt/master/url/resources/urltestdata.json>（891 条，Node 24.14.0 实跑）
- RFC 3986 — <https://www.rfc-editor.org/rfc/rfc3986.txt>（§3.2.1 userinfo、附录 B、§3.2.2 IPv6address）
- RFC 9110 — <https://www.rfc-editor.org/rfc/rfc9110.txt>（§4.2.5 fragment）
- Fetch Standard — <https://fetch.spec.whatwg.org/>（Request constructor 的 credentials TypeError）
- Unicode UTS #39 — <https://www.unicode.org/reports/tr39/>（Highly Restrictive 的 Latin + Han + Hiragana + Katakana）
