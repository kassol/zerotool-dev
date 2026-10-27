# W6 batch 2 — hmac-generator 事实核对（2026-10-27）

范围：`src/content/tools/hmac-generator/{en,zh,ja,ko}.mdx` 与 `src/components/tools/HmacGeneratorTool.astro` 可见文案。未改 `engine:start` / `engine:end`、逻辑、测试或其他工具。基线 HEAD `c5cd5bf3`。

## 修正（7 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:31 | “The tool tells you when either happens” → 只说明 key > block 与 key < output 两种提示。 | `keyNotes()` 1218–1225：32–64 字节密钥会补零但不提示；RFC 2104 §2 / §3。 |
| 2 | en.mdx:22 / zh:22 / ja:22 / ko:22 | 密钥读取：Stripe 用含 `whsec_` 的完整值作文本；Chatwork 解码令牌；Standard Webhooks 只解码 `whsec_` 之后。 | Stripe、Chatwork、Standard Webhooks 文档；`buildSigning()` 1129–1140。 |
| 3 | en.mdx:49；组件 tips.check（en/zh/ja/ko） | 密钥与消息对调只适用于 Custom HMAC。 | `diagnose()` 1346–1357；GitHub 模式只尝试密钥编码与算法。 |
| 4 | en.mdx:65 | Standard Webhooks 的密钥写作“Base64 after `whsec_`, decoded”。 | `stripWhsec()` 1098、`parseBase64()` 1129–1133；规范将 secret 序列化为 Base64 并加 whsec_ 前缀。 |
| 5 | en.mdx:79；组件 tips.msg（四语） | Shift_JIS / GBK / EUC-KR 文本可粘贴为 hex 或 Base64。 | `decodeField()` 1018–1026 接受 Base64；四语已同步。 |
| 6 | 组件 notes.stripe（en:156） | Stripe 官方库“默认”5 分钟窗口，可配置。 | Stripe 文档：库默认容差 5 分钟，允许参数修改。 |
| 7 | 组件 tips.ts 与 nTsOld / nTsFuture（四语） | 5 分钟 / 1 小时是本工具的检查范围；Standard Webhooks 未规定固定容差。 | Standard Webhooks 规范、Svix 文档；`PRESETS.svix.tolerance = 300`（825 行）。 |

## 已核对未改（要点）

- 11 个格式的签名串、头名、编码、时间单位与窗口与官方文档一致：GitHub、Stripe、Slack、Standard Webhooks、Shopify、Twilio、LINE、Chatwork、Feishu、DingTalk、NAVER Cloud。
- HMAC 构造、超块密钥先哈希、短密钥补零、L 字节下限、左截断（≥ 一半且 ≥ 80 位）与 RFC 2104 / RFC 4231 一致。
- 文档示例复算一致：GitHub `757107ea…`、Slack `a2114d57…`、LINE `GhRKmvmH…`、Feishu `l1N0gAc…`、DingTalk `sSFWELbV…`、NCP `J5srbJYp…`。
- 隐私：`persistence.ts` 为 `disabled`；`BaseLayout` 在 sensitive 页不加载 GA4 / AdSense；组件无存储与网络调用（`test-hmac-generator.mjs` 静态断言）。
- `HMAC-SHA1` 用于 Twilio 与 GitHub 旧头；`HMAC-MD5` 仅保留给旧系统与 RFC 2104 向量，RFC 6151 建议新设计不使用。

## 未核实

- en.mdx:73、ja.mdx:79、ko.mdx:76 的竞品操作是 2026-10-01 的观察，本轮未重跑，也无一手文档，保留原文。
- privacy 的“Reloading the page clears every field”已在 2026-10-27 用 ego-browser（Ego Lite 2.1.0，Chromium 内核）在本地构建上验证：填入密钥与消息后重载，两栏为空，localStorage 中没有本工具的键；`autocomplete="off"` 与无存储的代码依据保留。

## 来源（查阅 2026-10-27）

- RFC 2104：https://www.rfc-editor.org/rfc/rfc2104；RFC 4231：https://www.rfc-editor.org/rfc/rfc4231；RFC 6151：https://www.rfc-editor.org/rfc/rfc6151
- GitHub：https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries；Stripe：https://docs.stripe.com/webhooks；Slack：https://docs.slack.dev/authentication/verifying-requests-from-slack
- Standard Webhooks：https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md；Svix：https://docs.svix.com/receiving/verifying-payloads/how-manual；Shopify：https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- LINE：https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/；Chatwork：https://developer.chatwork.com/docs/webhook；Twilio：https://www.twilio.com/docs/usage/webhooks/webhooks-security
- Feishu：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot；DingTalk：https://help.dingtalk.io/zh/open/dingstart/customize-robot-security-settings；NAVER Cloud：https://api.ncloud-docs.com/docs/common-ncpapi
- MDN SubtleCrypto.digest：https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest

## 测试

- `node scripts/test-hmac-generator.mjs`：修改前 232 passed / 0 failed；修改后 232 passed / 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b2-hmac-generator.json`：155 条（supported 115 / corrected 29 / qualified 8 / unverified 3）。
- 本文件。未改测试、engine 块、其他工具；工作树中 bcrypt-generator、cookie-parser、json-schema-validator 等改动不属于本批。
