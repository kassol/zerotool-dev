# W4 剩余工具交互对照（批次 B，2026-10-27）

范围：`image-to-base64`、`pkce-generator`、`ai-token-counter`、`color-palette-generator`、`color-shades-generator`、`wifi-qr-code-generator`。ZeroTool 生产站与本次 Bing 自然结果前三；搜索实际跳转 `cn.bing.com`，英文界面，仅代表本会话排序。视口 1366 × 900。

## 结果

| 工具 | 站点 | 排名 | 页面点击 | 结果 | scrollY | 备注 |
|---|---|---:|---:|---|---:|---|
| image-to-base64 | ZeroTool | — | 0 | 正确：1 × 1 PNG → 96 字符 Data URI | 0 | 文件选择另记 |
| image-to-base64 | formatter.org | 2 | 0 | 正确 | 0 | 选文件即转换 |
| image-to-base64 | base64.dev | 3 | 0 | 正确 | 0 | 选文件即转换 |
| image-to-base64 | base64.guru | 1 | 1 | 未完成 | 0 | 上传后仍显示 64 × 64 示例图，未取得本文件输出 |
| pkce-generator | ZeroTool | — | 0 | 正确：verifier + challenge | 0 | 载入即生成 |
| pkce-generator | tonyxu-io | 1 | 未判定 | 未取得 | 0 | 页面输出未在本次读取中捕获 |
| pkce-generator | AuthAction | 2 | 1 | 正确：43 字符 verifier | 0 | 需点 Generate PKCE Pair |
| pkce-generator | Ping Identity | 3 | 1 | 正确：128 / 43 字符 | 0 | 需点 GENERATE NEW |
| ai-token-counter | ZeroTool | — | 0 | 正确：44 字符 → o200k_base 10 tokens | 0 | 输入即计数 |
| ai-token-counter | benchlm.ai | 1 | 0 | 未完成 | 0 | 输入后页面变化，未取得可信 token 数 |
| ai-token-counter | MiniWebtool | 2 | 0 | 未完成 | 0 | 同上 |
| ai-token-counter | toolsnak | 3 | 1 | 未完成 | 0 | 页面显示价格，未取得可信 token 数 |
| color-palette-generator | ZeroTool | — | 0 | 正确：7 组配色 | 0 | 载入即生成 |
| color-palette-generator | Elementor | 1 | 1 | 未完成 | 0 | 出现 21 个十六进制值，未见输入色 |
| color-palette-generator | encodedna | 3 | 1 | 包含 #3B82F6 的一组配色 | 486 | 需滚动才能看全 |
| color-palette-generator | readdy.ai | 2 | 未判定 | 未取得 | 0 | 页面未在本次读取中给出可信配色 |
| color-shades-generator | ZeroTool | — | 0 | 正确：50–950 共 11 级 | 0 | 输入即生成 |
| color-shades-generator | uicolors.app | 1 | 0 | 正确：11 个十六进制值 | 0 | 换色即更新 |
| color-shades-generator | tailwindcolor.tools | 2 | 0 | 正确：11 个十六进制值 | 0 | 换色即更新 |
| color-shades-generator | freecolortool | 3 | 未完成 | 未接受本次输入 | 0 | 无文本输入框，显示自带配色 |
| wifi-qr-code-generator | ZeroTool | — | 0 | 正确：可下载 PNG / SVG | 0 | 输入即生成 |
| wifi-qr-code-generator | qrgenerator.org | 2 | 0 | 正确：生成 QR 图 | 0 | 两个文本框，自动更新 |
| wifi-qr-code-generator | wiqrcode.com | 3 | 1 | 正确：生成 QR 图 | 0 | 需点 Generate WiFi QR Code |
| wifi-qr-code-generator | qr-code-generator.com | 1 | 未完成 | 无内嵌表单 | 0 | 落地页导向产品流程，未继续 |

## 结论

已完成的三家竞品中，没有出现 ZeroTool 需要更多页面点击才能得到同一结果的情况；`encodedna` 需要 486 px 滚动才看到完整配色，ZeroTool 在首屏内显示。未完成的竞品按缺口记录，不改写成成功，也不据此判定其产品失败。

本批未记录竞品键盘路径，不能据此声称本站键盘可达性更好。所有观察不含 W3 计时或真实用户 INP。

## 复现输入

- image-to-base64：`w4-pixel.png`（1 × 1 RGBA，70 字节，SHA-256 `c414cd0e…ce77`）
- pkce：默认 43 字符 verifier
- ai-token-counter：`The quick brown fox jumps over the lazy dog.`
- color-palette / color-shades：`#3b82f6`
- wifi：SSID `Guest-WiFi`，WPA2 密码 `w4-demo-pass`
