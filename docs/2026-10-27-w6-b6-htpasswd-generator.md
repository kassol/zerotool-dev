# W6 B6：htpasswd-generator 四语内容核对（2026-10-27）

基线 `f358d03c`。范围：`src/content/tools/htpasswd-generator/{en,zh,ja,ko}.mdx` 与 `src/components/tools/HtpasswdGeneratorTool.astro` 的可见文案。`src/data/persistence.ts`、`src/data/network.ts` 只读核对。

以工具页与组件的全部可见陈述为清单：6 条 FAQ × 4 语言、四语文正文的格式 / 服务器矩阵 / 示例 / 编辑 / 用户名 / 竞品 / 限制段、组件 12 条可见文案与统计行为。实现主张以组件与引擎 file:line 为准；外部事实用 2026-10-27 抓取的一手来源（Apache htpasswd 与 Password Formats、Nginx `auth_basic_user_file`、APR `crypto/apr_passwd.c`、OpenBSD `bcrypt.c`、Docker Distribution 配置参考），另用本机 macOS `htpasswd` 复现平台限制与第三字段行为。

共审查 52 条陈述：supported 25、corrected 15、qualified 12、unverified 0。逐条见 `2026-10-27-w6-b6-htpasswd-generator.json`。

| 项目 | 数量 |
|---|---:|
| FAQ 答案 | 24 |
| 组件文案 | 16 |
| 正文陈述 | 12 |
| 合计 | 52 |

## 修正要点

- **密码 255 字节不是 htpasswd 的限制**（en.mdx:95；组件 `issue_passTooLong` 四语，`HtpasswdGeneratorTool.astro:122,256,390,524`）。Apache 手册的 255 上限只针对 Windows，且是截断而非拒绝；本工具自己的 255 字节上限来自 `checkPassword`（`:1153`）。四语改为「本工具上限 255；Apache 的 255 字符上限只在 Windows 上生效」。
- **zh 示例的字数与字节数错一位**（zh.mdx:65、:69）。示例实为 29 个汉字、87 字节（Python 复核），原文写 30 / 90。改为 29 / 87；「前 24 个汉字之后不起作用」保持（72 字节）。
- **第三字段的读法写反了**（组件 `issue_extraField` 四语，`:134,268,402,536`）。Nginx 文档明确允许 `name:password:comment`；Apache 把第一个 `:` 之后的内容整体交给 `apr_password_validate`（APR `crypto/apr_passwd.c:108-141`），第三字段会进入哈希。本机 2026-10-27 用 `htpasswd -vb` 验证 `u:$apr1$…:comment` 返回 `Password verification failed`。四语改为「Nginx 当注释；Apache 算进哈希，登录失败」。
- **CRYPT 的单位**（组件 `compat_crypt` 四语，`:59,193,327,461`；ko.mdx:77）。引擎按 UTF-8 字节截断（`desCrypt`，`:988-993`），警告文案 `issue_des8` 也是字节；四语与 ko 正文由「8 字符 / 8 文字 / 8자」改为「8 字节」。
- **文件上限的单位**（组件 `fileTooBig` 四语，`:77,211,345,479`）。代码比较 1,048,576 字节（`:1505`），提示气泡也写 1 MiB；`1 MB` 改为 `1 MiB`。

未改：FAQ 条数、id、顺序，steps，seoTitle，`engine:start/end`，persistence / network，统计调用，脚本与测试。

## 已核实、无需改动的关键主张

- **APR 只自行处理 `$2a$`、`$2y$`、`$apr1$`、`{SHA}`**（`crypto/apr_passwd.c:116-141`）；`$2b$` 落到系统 `crypt()`；APR 自己写出的 bcrypt 前缀是 `$2y$`（`:217`）。en:34、:17 与四语 prefix FAQ 一致。
- **OpenBSD 接受 `$2a$` / `$2b$`、拒绝 `$2y$`**（`bcrypt.c:112-131` 的 minor switch；默认写出 `$2b$`，`:82`）。
- **Nginx 自处理 `$apr1$`、`{SHA}`、`{SSHA}`、`{PLAIN}`，其余交 `crypt()`**；文档原文把 PLAIN 称为「an example one, should not be used」（`ngx_http_auth_basic_module.html`），en:29 与四语 plain-text FAQ 引述准确。
- **`htpasswd -C` 默认 5、范围 4–17；`-r` 只配 `-2` / `-5`，默认 5,000 轮；`-p` 明文只在 Windows / NetWare 被 httpd 接受；用户名上限 255 字节且不能含 `:`，退出码 6**（htpasswd 手册）。
- **Docker Registry 的 htpasswd 认证只读 bcrypt，其他哈希被忽略**（Distribution 配置参考原文）。
- **本机 macOS 的 htpasswd 不支持 SHA-2 crypt**：`htpasswd -n5` 直接报 `SHA-2 crypt() algorithms are not supported on this platform`，en:64 / zh:63 / ja:55 / ko:70 的说法成立。
- **示例与校验**：四语 `htpw-check` 行由 `test-htpasswd-generator.mjs` 复算（含 Apache Password Formats 的 `myName` 示例、29 汉字 87 字节、さくら２０２６ 21 字节、비밀번호 17 字节）。
- **隐私与统计**：`persistence.ts:40` 为 `disabled`，页面不加载 GA4 / AdSense；组件只在生成与批量生成时调用 `trackTool`（`:1354`、`:1443`），无存储、无网络请求（脚本静态断言）。四语 privacy FAQ 与组件 privacy 行一致。

## 发现的问题

- **A 档（已在主会话修复）**：文件检查把第三个字段截掉再验证。`parseHtpasswd` 在第二个 `:` 处切开（`HtpasswdGeneratorTool.astro:1185-1190`），`Check password` 用截断后的 hash 比对；Apache 实际把整段 `hash:comment` 当哈希，登录失败（本机 `htpasswd -vb` 已复现）。因此对 `u:hash:comment` 这类行，工具会报「密码匹配」，而 Apache 拒绝。修法二选一：验证时把整段交给校验（与 Apache 一致，Nginx 仍匹配前缀），或在存在第三字段时明确写「Apache 无法登录」并拒绝给出匹配结论。本次采用第二种：`parseHtpasswd` 已有的 `extraField` 标记继续保留，`htpw-check` 在匹配成功且该行有第三字段时追加四语 `checkExtraField`（「Nginx 接受这一行；Apache 会把第三个字段算进哈希，登录会失败」），状态仍为 success 但不再暗示 Apache 也能登录；`test-htpasswd-generator.mjs` 新增 1 条回归。裁决依据：Apache 与 Nginx 对该行的读法不同，工具无法用一个「匹配」同时代表两者。
- **C 档**：四语步骤第 3 步写「结果旁会显示对应的 htpasswd 命令」，但 `$2a$` 的 `flag` 为 `null`（`:675`），该格式不显示命令（`cmdWrap.hidden`，`:1349-1350`）。
- **C 档**：`issue_userSpaceEdge` 四语称 Apache 会去掉用户名的首尾空格；2026-10-01 的实测覆盖的是行首空格，尾随空格未单独验证。zh 正文「首尾空格」也只解释了行首。
- 已核实的平台矩阵与竞品数字保持 2026-10-01 日期，未在本次重跑；JSON 中标为 qualified。

## 验证

- `node scripts/test-htpasswd-generator.mjs`：1,578 passed、0 failed、1 skipped（本机 htpasswd 无 SHA-2 crypt，既有 SKIP）。
- `node scripts/test-tool-content-parity.mjs`：7,753 passed、0 failed（141 个工具全部规则）。
- `node scripts/audit.mjs --quiet`：PASS 24、WARN 0、FAIL 0。
- `git diff --check`：无输出。未运行 `npm run build`（按任务要求）。

## 剩余

W6 的 B 组只做了本工具；四语正文的平台表、竞品段与耗时数字仍是 2026-10-01 的历史观察，若要与线上重测对齐，需要重新跑 Apache / Nginx 容器并更新四语表格与 FAQ 日期。
