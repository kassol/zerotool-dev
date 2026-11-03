# Bing 元描述诊断与修复（2026-11-04）

## 触发

`xml格式化`、`图片转base64` 在 Bing 有曝光但 CTR 为 0.25% / 0%；`2fa验证器在线` 有 2.2% CTR。先看 SERP，再查 Bing Webmaster Tools 的建议。

## SERP 复核（cn.bing.com，2026-11-04）

- `xml格式化`：ZeroTool 不在前 10；前 3 是 toolhelper.cn、jyshare.com、quanxiaoha.com。
- `图片转base64`：ZeroTool 不在前 10；前 3 是 lddgo.net、base64.is、base64files.com。
- `2fa验证器在线`：ZeroTool 第 7；前 3 是 basetoolbox.com、2fa.cn、2fa.mo.cn。
- 三个词的前 10 都没有 AI 概览或广告；`www.bing.com` 在当前环境跳到 `cn.bing.com`，结果一致。
- 品牌词查询能看到 ZeroTool 的标题与摘要，标题本身包含查询词，摘要没有明显错误。

## BWT 的建议

`Recommendations` 两条：

1. **Meta descriptions on many of your pages are too short.** 中等严重度，373 个页面；建议长度 150–160 字符。列表里包含 `/zh/tools/xml-formatter/`、`/zh/tools/image-to-base64/`、`/zh/tools/totp-generator/`、`/zh/tools/zero-width-character-detector/`、`/zh/tools/markdown-to-word/`。
2. **没有足够来自高质量域的入站链接**，可能影响可见性。

## 修复

把以下页面中短于 150 字符的 `seoDescription` 扩到 150+ 字符（保持原有事实与隐私表述，不改标题、不改工具行为）：

| 页面 | 语言 | 修改前长度 |
|---|---|---:|
| xml-formatter | en / zh / ja / ko | 126 / 52 / 47 / 60 |
| image-to-base64 | zh / ja / ko | 93 / 102 / 111 |
| totp-generator | zh / ja / ko | 96 / 103 / 107 |
| zero-width-character-detector | zh / ja / ko | 93 / 118 / 139 |
| markdown-to-word | zh / ja / ko | 95 / 111 / 97 |

共 16 条。英文 160–183 字符，中日韩 157–250 字符；新增内容只描述页面已有能力（如 XML 的行列错误、图片按文件头识别格式、TOTP 不保存密钥、零宽支持的解码格式、Markdown 转 Word 的列表与字体选项）。

第二批（首页与目录，8 条，部署前 110 / 63 / 69 / 81 与 116 / 58 / 约 60 / 约 70）：

| 页面 | 修改后长度 |
|---|---:|
| `/`（en） | 189 |
| `/zh/` | 169 |
| `/ja/` | 180 |
| `/ko/` | 193 |
| `/tools/` | 201 |
| `/zh/tools/` | 155 |
| `/ja/tools/` | 169 |
| `/ko/tools/` | 166 |

第三批（按 BWT 曝光排序的 12 个页面）：

| 页面 | 曝光（2026-10-02–27） | 修改前 | 修改后 |
|---|---:|---:|---:|
| `/ja/blog/html-entity-guide/` | 1,093 | 109 | 162 |
| `/ja/blog/hmac-generator-guide/` | 639 | 110 | 161 |
| `/ja/tools/nato-phonetic-alphabet/` | 428 | 96 | 158 |
| `/zh/tools/keycode-explorer/` | 251 | 103 | 160 |
| `/ja/blog/ip-subnet-calculator-guide/` | 190 | 105 | 159 |
| `/zh/tools/html-to-markdown/` | 163 | 73 | 157 |
| `/zh/tools/text-to-ascii-art/` | 158 | 92 | 159 |
| `/zh/tools/sqlite-viewer/` | 153 | 74 | 161 |
| `/zh/tools/pkce-generator/` | 144 | 113 | 168 |
| `/zh/tools/ascii-converter/` | 144 | 45 | 153 |
| `/zh/tools/ai-token-counter/` | 81 | 117 | 161 |
| `/zh/tools/pixelate-image/` | 81 | 60 | 159 |

第三批新增内容同样只取自页面已有事实：html-to-markdown 没有表头的表格原样保留为 HTML、脚本与样式里的文字不会被删除；ascii-converter 支持 0x / 0o / 0b 前缀与 32–126 参考表；sqlite-viewer 上限 100 MB、每页 100 行、不保存改动；pixelate-image 支持格式与「动图只取第一帧」、密码请用纯色涂黑。

## 长度上限：150–160 字符，两头都算违规

BWT 的规则原文是「Aim for a length of 150-160 characters」，页面标题为「Meta Description 太长或太短」（too long or too short）。第一次修复只保证「≥150」，部分描述写到了 190–250 字符，属于另一头的违规。

证据：部署 v1.142.13 后用 BWT 的 URL 检查（实时 URL）逐页复核：

| 页面 | 当时长度 | BWT URL 检查结果 |
|---|---:|---|
| `/zh/tools/xml-formatter/` | 157 | 未找到 SEO/GEO 问题 |
| `/zh/tools/image-to-base64/` | 200 | 1 个问题：Meta Description 太长或太短 |

因此 157 字符的 zh 描述通过、200 字符的不通过。第四批把 33 条全部收进 150–160：

- 第一、二、三批里超过 160 的页面（含英文 172–201、日文 162–226、韩文 165–250）逐条删减，只保留能落在区间内的句子。
- 40 个页面（第一批 5 个工具 × 4 语 = 20，首页与目录 8，第三批 12）构建后逐页校验，长度 150–160，无一条越界。

## 结论与优先级

1. **可立即修复的是元描述长度**：BWT 把「太短」和「太长」算一类问题，落在 150–160 才算通过。
2. **排名问题不能靠摘要解决**：`xml格式化`、`图片转base64` 在 BWT 的 28 天平均位置是 7.4 / 9.5，但 2026-11-04 的 cn.bing 前 10 没有这两个页面；同一天的 `site:zerotool.dev` 查询返回了与本站无关的结果，说明当前会话的 cn.bing 结果不能直接当作排名证据。排名诊断应以 BWT 的 query 报表为准，SERP 抽查只作参考。
3. **URL 检查显示两页都已收录**：`/zh/tools/xml-formatter/` 与 `/zh/tools/image-to-base64/` 均为「已成功编制索引，该 URL 可以在必应上显示」，所以不是收录问题。
4. 剩下的杠杆是内容深度与站外链接。摘要修复只能提升已在第一页的查询的点击率（如 `2fa验证器在线` 第 7 位、2.2% CTR）。

## 未处理

- 其余约 350 个短描述页面：按流量与曝光分批处理，不一次改完。
- 高质量入站链接：5 篇 dev.to 已发布，更多渠道等账号决定。
- `xml格式化` / `图片转base64` 的排名：SERP 显示当前不在 cn.bing 前 10，属于排名问题，单靠摘要不能解决；本次先修可验证的摘要问题。

## 验证

- 构建后 `dist/zh/tools/xml-formatter/index.html`、`image-to-base64`、`totp-generator` 的 meta description 长度分别为 157 / 200 / 178 字符。
- audit 24 PASS、parity 7,753、llms 1,010。
- 部署后等 BWT 重新扫描，观察 `xml格式化` 的 CTR 与 `2fa验证器在线` 的点击变化；至少 2 周后再判断。
