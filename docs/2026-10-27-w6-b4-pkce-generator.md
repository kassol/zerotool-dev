# W6 batch 4 — pkce-generator 事实核对（2026-10-27）

范围：`src/content/tools/pkce-generator/{en,zh,ja,ko}.mdx`、`src/components/tools/PkceGeneratorTool.astro` 的可见文案与 `tips`，以及 `src/data/persistence.ts`、`src/data/network.ts`。未改 `engine:start` / `engine:end`、逻辑、测试、FAQ id / 条数 / 顺序、steps、seoTitle、持久化与统计。基线 HEAD `def8eb66`。

## 覆盖与决定

共 65 条陈述：supported 50、qualified 9、corrected 1、unverified 5。四语同题同判；FAQ 每题一条索引，长段按主题合并，逐条依据在 `.json`。

| 语言 | 陈述 | supported | qualified | corrected | unverified |
|---|---:|---:|---:|---:|---:|
| en | 13 | 11 | 1 | 0 | 1 |
| zh | 16 | 11 | 2 | 1 | 2 |
| ja | 15 | 13 | 1 | 0 | 1 |
| ko | 13 | 9 | 3 | 0 | 1 |
| 组件 | 8 | 6 | 2 | 0 | 0 |

## 修正（1 处）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | zh.mdx:116 | 原文「飞书文档里的 Go 示例用的是 `golang.org/x/oauth2` 的 `GenerateVerifier` 与 `S256ChallengeOption`」改为对包本身的陈述：「Go 侧可以用 `golang.org/x/oauth2` 的 `GenerateVerifier`、`S256ChallengeOption`（认证请求）与 `VerifierOption`（token 请求），结果与上面相同。」 | 2026-10-27 抓取的飞书 v2 token 页面 Go 示例导入 `golang.org/x/oauth2`，但示例代码导入 `math/rand`、只出现 `oauth2.Endpoint` / `oauth2.Config`，看不到这两个 PKCE 调用，原句无法由该页支持。包 API 由 pkg.go.dev `golang.org/x/oauth2` v0.37.0 证实（`GenerateVerifier`、`S256ChallengeOption` 用于 `AuthCodeURL`，`VerifierOption` 用于 `Exchange`）。 |

en 的同位句本就写成包级陈述，未动；ja / ko 无此句。

## 已核对未改（要点）

- **派生与熵**：`code_challenge = BASE64URL(SHA256(ASCII(verifier)))`、无 `=`；`bytesForLength(43)=32`、`entropyBits(43)=256`；43–128 的字节数与位数与 `PkceGeneratorTool.astro:386-400` 一致；RFC 7636 §4.1 NOTE（32 octets → 43 字符）与 §7.1（最低 256 位）支持「43 字符 = 32 字节 = 256 位」。
- **示例**：附录 B 对（`dBjftJeZ…` → `E9Melhoa2…`）、LINE 对（`wJKN8qz5…` → `BSCQwo_m8…`）、飞书对（`TxYmzM4P…` → `O0nS63zi…`）均在本机以 base64url(SHA-256) 复算一致，且由 `test-pkce-generator.mjs` 断言；hex 摘要 `13d31e96…`、解码字节哈希 `38v3YOi6…` 同样复算一致。
- **授权 URL**：`buildAuthUrl` 用 `URLSearchParams`（空格 → `+`）、先删同名参数再追加、`code_challenge_method` 总是写出（RFC 7636 §4.3 缺省 plain）、非 http(s) 与含 `#` 报错（RFC 6749 §3.1）；en 示例逐字与引擎输出相同。
- **检查器**：`diagnoseChallenge` 的 match / padding / base64 / hex / plain / rawBytes / s256 与四语表格、`cmp*` 文案一一对应；`plain` 下贴 S256 值提示发送 method。
- **长度与字符集**：`validateVerifier` 先 `trim`，按码点报告首个非法字符与位置，`+ / =`、空白、非 ASCII 各有提示，越界写出实际字符数；43–128 与 §4.1 ABNF 一致。
- **提供方事实（2026-10-27 抓取）**：LINE「LINEログインをPKCE対応する」确认 `code_challenge` 任意（未指定即不做 PKCE）、`code_challenge_method` 仅 S256、Yahoo! JAPAN 应用自动登录、示例对与 Node 的 `createHash('sha256')` + `+ / =` 替换；LINE discovery 的 `code_challenge_methods_supported` 为 `["S256"]`。飞书授权码页确认 `code_challenge` 示例值即附录 B 值、`plain` 为默认；飞书 v2 token 页确认 v3 拒绝「授权未传 challenge 却传 verifier」而 v2 不拒绝，错误码 20049 = PKCE 校验失败。Naver / Kakao discovery 均返回 `code_challenge_methods_supported: ["S256"]`，支持 ko FAQ「네이버와 카카오 … S256만」。
- **S256 / plain 规范**：RFC 9700 §2.1.1 公开客户端 MUST、机密客户端 RECOMMENDED、「Currently, S256 is the only such method」、鼓励服务器检测并阻止固定值；OAuth 2.1 仍为 Active Internet-Draft（draft-ietf-oauth-v2-1-16，2026-09-03），§4.1.1 与 §7.5.2 明确移除并禁止 `plain`。四语「草案」措辞与「已去掉 plain」成立。
- **隐私与统计**：`persistence.ts:14` 为 `disabled`；`ToolLayout.astro:42` 判定敏感页，`BaseLayout.astro:140` 不加载 AdSense、`:185` 不加载 GA4，`trackTool` 只写本地 `dataLayer`；组件脚本无 `fetch` / `XMLHttpRequest` / `sendBeacon` / 存储 / `location` / `history`（测试静态断言）。`network.ts` 未列入本工具。四语隐私题与组件 `privacy` 句与实现一致。
- **策略性文案**：`plainWarn`「RFC 7636 §4.2 能用 S256 必须用；OAuth 2.1 不允许 plain」与两处规范一致。

## 限定（9 处，未改）

- `code-blocks`（en:61 / zh:63 / ja:65 / ko:60）：「tests run all three」——JavaScript 总跑，Python / Go 仅在装有解释器时执行，否则 SKIP（`test-pkce-generator.mjs:283-328`）。
- `verifier` 气泡（四语，组件:16）：`Ctrl/⌘+L` 只清 `textarea` 与 `input[type=text]`（`ToolLayout.astro:372`），Length（`type=number`）与 S256/plain 选择保留，清空后状态行显示「粘贴或生成」提示。
- zh 限制段（zh:134）与 ko 正文 / 限制（ko:40, 130）：「微信、Kakao 的 scope 用逗号分隔」由 `hasOpenid` 的 `[\s,]+`（`PkceGeneratorTool.astro:473-476`）支持，但上游文档本批未抓取。
- ko Naver 段（ko:38）：两个端点已由 discovery 证实，`code_challenge_method` 默认 S256 沿用 2026-10-01 开发指南核对，本批未重取。
- `copy`（组件:666-679）：无 Clipboard API 时静默返回、`writeText` 失败被吞掉，没有 `execCommand` 后备与失败提示；文档「Copying … puts it on your clipboard」在 HTTPS 下成立。

## 未核实（5 处）

- en / zh / ja / ko 的竞品段（en:118-123、zh:120-125、ja:122-126、ko:117-121）：均为 2026-10-01 桌面 Chromium 的观察，带日期，本批未重跑；en 的空输入值 `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU` 已本机复算为 base64url(SHA-256(""))。
- zh WeChat 段（zh:45）：授权参数与 AppSecret 换 token 的说法未经本批抓取，保留原文。

## 来源（查阅 2026-10-27）

- RFC 7636：https://www.rfc-editor.org/rfc/rfc7636.txt（§4.1、§4.2、§4.3、§7.1、附录 B）
- RFC 9700：https://www.rfc-editor.org/rfc/rfc9700.txt（§2.1.1）
- OAuth 2.1：https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1（draft-ietf-oauth-v2-1-16，2026-09-03，§4.1.1 / §7.5.2）
- LINE：https://developers.line.biz/ja/docs/line-login/integrate-pkce/；https://access.line.me/.well-known/openid-configuration
- 飞书：https://open.feishu.cn/document/authentication-management/access-token/obtain-oauth-code；https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token
- Naver discovery：https://nid.naver.com/.well-known/openid-configuration；Kakao discovery：https://kauth.kakao.com/.well-known/openid-configuration
- Go：https://pkg.go.dev/golang.org/x/oauth2（v0.37.0）

## 测试

- `node scripts/test-pkce-generator.mjs`：修改前 167 passed / 0 failed；修改后 167 passed / 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。

## 交付物

- `docs/2026-10-27-w6-b4-pkce-generator.json`：65 条（supported 50 / qualified 9 / corrected 1 / unverified 5）。
- 本文件。未改测试、engine 块、persistence / network、统计、steps 与 seoTitle；工作树中其他工具的改动不属于本批。
