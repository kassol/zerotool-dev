# W6 一手来源核对（2026-10-25）

范围：`dns-lookup`、`markdown-to-word`、`qr-code-decoder`、`aes-encrypt-decrypt`、`totp-generator` 的 en / zh / ja / ko 共 20 份工具 MDX 中的官方引用，以及解释引用所需的少量组件代码。依照 `docs/AGENTS.md`，本侧只写此文件，不改产品、不运行交互浏览器、不再委派。

查阅日期统一为 **2026-10-25**。本地 HEAD 为 `b40065ec`，工作树与主线审查并行变化；下列“初读问题”不代表主线补丁后仍然存在。标准发布时间、网页最后编辑时间与本次查阅时间分别记录；动态文档及 `main` 分支不作为某个已发布浏览器、App 或依赖版本的行为证明。

证据分类：**标准/官方文档**说明外部规则；**实现读源**只说明当前仓库；**历史实测**指 MDX 记载的 2026-09-29 / 30 测试，本侧没有重放；**未核实**表示无法取得足够的一手正文。外部标准不能证明本页不上传、不存储或线上 GA 收到了事件。

## 需主线收口的重点

| 项目 | 一手依据与正确边界 | 本侧观察 / 主线处理 |
|---|---|---|
| DNS 的 hosts 归因 | BIND 的 dig / nslookup 向 DNS 服务器查询；目标名称不会因命令自身读取 hosts 而得到覆盖结果。不过，若查询本地 DNS stub，stub 可以把 hosts 记录合成为 DNS 应答。 | 主线已修 FAQ。收口时仍应检查初读 `zh.mdx:52` 的“与 dig 不同多半是 hosts”和 `ko.mdx:52` 正文，避免只修 FAQ。见 D1、D2。 |
| TOTP 不同码即密钥错 | 必须先对齐算法、位数、周期、T0 和两端时钟，并比较同一时间步。即便码相同，也不能单独证明服务端绑定有效。 | 主线已补比较前提；原文“错误密钥永远不能通过”也宜用“通常不匹配”，有限位数存在碰撞。见 T1、T2。 |
| QR 的 Safari 固定上限 | 16,777,216 是本工具 `MAX_PIXELS`；WebKit `main` 的平台分支已经足以反驳其为永恒通用 Safari 上限的说法，不能反过来把 `main` 常量当成所有已发布 Safari 的上限。 | 主线已改成工具处理上限，并限定测试日期、设备和压缩大小。见 Q4。 |
| GA4 “只含工具名和动作” | 自定义参数与整个 GA 请求不是同一范围。GA 默认参数包含页面信息、语言和屏幕分辨率；另有设备、会话等默认采集。 | DNS / Markdown / QR FAQ 应明确说“工具自定义事件参数”，不能承诺整个 HTTP 载荷只有两个字段。见 G1、G2。 |
| 引用能够支持到哪里 | Google JSON 文档不支持“Google TXT 永远不带引号”；2018 年 Google Authenticator wiki 也不是 2026 年各版本 App 的兼容性实测。 | 前者限定为当日应答观察；后者标明旧文档日期并请用户核对所用 App。见 D3、T3。 |

## DNS：JSON DoH、AD、EDE

- **标准/文档**：Cloudflare 明说 JSON DoH 没有正式 RFC，并沿用 Google 的 JSON schema；RFC 8484 规定的是 `application/dns-message` 的 DNS wire format。可以说“两家兼容的 JSON API”，不能说“RFC 8484 标准 JSON”，也不能保证所有字段和 TXT 展示完全相同。D3、D4、D5。
- **标准**：RFC 6840 §5.8 的 SHOULD 是：请求带 DO 或 AD 时，解析器才应考虑设置 AD；不是“带 `do=1` 就一定验证成功”。AD 是递归解析器对相关应答数据的认证断言，本页不是独立 DNSSEC 验证器。`AD=false` 不能单独推出域名未签名；应答、否定应答和 CNAME 链都要结合解析器结果理解。D6。
- **标准**：EDE 是可选的诊断补充，不改变 RCODE 语义；RFC 8914 的 1、2、5–12 包括不支持算法、DNSSEC indeterminate、bogus、签名/密钥缺失等。`SERVFAIL + 此类 EDE` 可以提示“DNSSEC 相关解析失败”，不能一律归因为域所有者配置坏了。缺少 EDE 的 SERVFAIL 不能排除 DNSSEC 原因。D7。
- **实现读源 / 历史实测**：`DnsLookupTool.astro` 的 `DNSSEC_EDE_CODES`、`dnssecStatus()` 与注释描述了本页的分类；Google `extended_dns_errors` 的具体字段，以及 Cloudflare `Comment` 中 `EDE(n)` 的具体文本，不是 RFC 对 JSON 的要求。MDX 的固定 IP、AD 次数和错误句子只属于所注明日期的观察。
- **明确的引用冲突**：Google JSON 文档的 TXT 示例含引号，且展示分段字符串；因此四语 FAQ 的“Google 拼成整段且不加引号”不能作为 API 保证。RFC 1035 §3.3 的 255 是每个 `<character-string>` 的**字节数**，不是任意 Unicode 文本的字符数。D3、D8。
- **边界**：Google ECS 的发送取决于权威端支持/检测等条件，应用“可能发送截断子网”；Cloudflare FAQ 的一般政策是不发 ECS，并列有自身权威服务特例，因此绝对“不发给任何权威服务”过宽。D9、D10。
- **其他引用**：DMARC 的 `_dmarc` 名称与 `p=none` 的“不请求特殊处置”可由所引 RFC 支持；`p=none` 并不保证收件方接受邮件，也不自动保证收到报告。198.18.0.0/15 的 benchmarking 用途和 mihomo 默认 fake-IP 地址池有官方依据；是否拦截了某台测试机的端口 53 则仍是本地实测。D11–D14。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| D1 | BIND 9.20.16 手册，dig / nslookup：<https://bind9.readthedocs.io/en/v9.20.16/manpages.html#dig-dns-lookup-utility>；<https://bind9.readthedocs.io/en/v9.20.16/manpages.html#nslookup-query-internet-name-servers-interactively>。这是指定版本手册，不声称为最新版本。 |
| D2 | systemd-resolved 官方手册：<https://www.freedesktop.org/software/systemd/man/latest/systemd-resolved.service.html>，`/etc/hosts`、本地合成记录及 stub 的行为；此处 `latest` 为文档 URL，本报告不据此绑定本机版本。 |
| D3 | Google JSON API，页脚最后更新 **2024-09-03 UTC**：<https://developers.google.com/speed/public-dns/docs/doh/json>。核对参数、AD 与 TXT 示例；网页未给上述具体 TXT 观察以长期保证。 |
| D4 | Cloudflare JSON API：<https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/>。 |
| D5 | RFC 8484，2018-10：<https://www.rfc-editor.org/rfc/rfc8484#section-6>。 |
| D6 | RFC 6840，2013-02：<https://www.rfc-editor.org/rfc/rfc6840#section-5.8>；AD 的 RRset 条件另见 RFC 4035 §3.2.3：<https://www.rfc-editor.org/rfc/rfc4035#section-3.2.3>。 |
| D7 | RFC 8914，2020-10：<https://www.rfc-editor.org/rfc/rfc8914#section-3>；<https://www.rfc-editor.org/rfc/rfc8914#section-4.10>（code 9，DNSKEY Missing）。 |
| D8 | RFC 1035，1987-11：<https://www.rfc-editor.org/rfc/rfc1035#section-3.3>；<https://www.rfc-editor.org/rfc/rfc1035#section-3.3.14>。 |
| D9 | Google ECS 文档：<https://developers.google.com/speed/public-dns/docs/ecs>。 |
| D10 | Cloudflare FAQ：<https://developers.cloudflare.com/1.1.1.1/faq/>，EDNS Client Subnet 问答。 |
| D11 | MDX 所引 RFC 7489，2015-03：<https://www.rfc-editor.org/rfc/rfc7489#section-6.1>；<https://www.rfc-editor.org/rfc/rfc7489#section-6.3>。此处核对原引用的内容，不称其为最新 DMARC 标准。 |
| D12 | RFC 6890，2013-04：<https://www.rfc-editor.org/rfc/rfc6890#section-2.2.2>；用途定位更直接的 IANA 表：<https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml>。 |
| D13 | mihomo 官方配置文档：<https://wiki.metacubex.one/config/dns/>；<https://wiki.metacubex.one/en/config/dns/>。默认地址池不证明本机启用了它。 |
| D14 | Gmail 官方发送者要求：<https://support.google.com/a/answer/81126?hl=ja>。2024-02 起的批量发送者要求有依据；应保留“发往个人 Gmail”等适用范围，不扩大为所有邮件系统。 |

## Markdown → DOCX：语法与导出策略分开说明

- **标准/文档**：CommonMark 0.31.2 的 flanking delimiter 规则支持所举 CJK 标点导致强调不闭合的解释。`markdown-cjk-friendly` 则是作者维护的额外扩展，不是 CommonMark 要求；可说“基于 CommonMark，并加入 CJK 强调扩展”。M1、M3。
- **引用层级**：正式 GFM 0.29-gfm 规范不含脚注；GitHub 的产品支持、micromark 的脚注扩展与该正式规范不能混称。主线已将脚注另列。M2、M4。
- **实现读源**：`MarkdownToWordTool.astro` 导入 `docx` 和 mdast / micromark。标题转 Word 样式、任务项转内容控件、脚注写入 OOXML、过滤 HTML 都是该组件的转换策略，不能从 CommonMark 或 GFM 推出。CommonMark 本身容许 raw HTML；组件 `htmlToText()` 丢弃 script/style/注释并处理 `<br>`，不等于完整 HTML/CSS 排版或通用 HTML 安全保证。
- **CORS 边界**：跨源 `fetch` 读取图片字节需要服务器通过 CORS 授权；“能在网页中显示图片”不等于脚本能读取其字节。CORS 拒绝通常不表示请求未到达图床。`credentials: 'omit'` 和 `referrerPolicy: 'no-referrer'` 是本地实现选项，而非 CORS 自动保证。M5。
- **实现读源**：远程图片仅在 `embedRemote` 为真时进入下载分支；`data:` 图片走独立分支。能否嵌入还受数据 URI 有效性、格式识别/转换等约束，应写“支持的有效 data URI”，不保证所有 `data:` 内容均成功。超时、失败后的链接/纯文本回退需由主线测试证明。
- **其他官方说明**：pandoc 的 `--reference-doc` 支持自定义 DOCX 参考样式；数学到 Word 的能力是 pandoc 能力，不是本工具能力。`east_asian_line_breaks` 是 pandoc 扩展，不证明本组件与其所有字符规则完全一致。Microsoft 的目录步骤依赖 Word 标题样式，足以支持“可在 Word 插目录”，不证明任意 Word/WPS/移动端都完整保留本页生成的控件。M6、M7。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| M1 | CommonMark **0.31.2**，2024-01-28：<https://spec.commonmark.org/0.31.2/>；<https://spec.commonmark.org/0.31.2/#right-flanking-delimiter-run>。 |
| M2 | GFM **0.29-gfm**，2019-04-06：<https://github.github.com/gfm/>。 |
| M3 | CJK 扩展作者源码/说明：<https://github.com/tats-u/markdown-cjk-friendly>。当前仓库锁文件为 `micromark-extension-cjk-friendly` 2.0.1；不声称上游最新。 |
| M4 | 脚注扩展作者说明：<https://github.com/micromark/micromark-extension-gfm-footnote>。 |
| M5 | 原引 Mozilla CORS 文档：<https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS>；规范层另见 WHATWG Fetch：<https://fetch.spec.whatwg.org/#cors-protocol>。 |
| M6 | pandoc 官方手册：<https://pandoc.org/MANUAL.html#option--reference-doc>；<https://pandoc.org/MANUAL.html#extension-east_asian_line_breaks>。 |
| M7 | Microsoft 目录操作：<https://support.microsoft.com/en-us/office/insert-a-table-of-contents-882e8564-0edb-435e-84b5-1d8552ccf0c0>；四语文件另引 zh / ja / ko 的同一文章 ID。 |
| M8 | 飞书原引：<https://www.feishu.cn/hc/zh-CN/articles/360033241654>。本次未取得足够正文，不能复核“导入 .md → 下载 Word”的完整当前流程、登录和存储细节；应保留为待核实，勿拿它证明本工具行为。 |

## QR：读取格式、文本猜测与浏览器边界

- **上游文档 / 实现读源**：zxing-wasm 是 ZXing C++ 的 WebAssembly 包装；上游 QR / Micro QR / rMQR 能力与组件传入的三个 `formats` 名称相符。上游还能读其他条码，不代表本页启用它们；最多 16 个、相机参数及结果排序都是本页选择。Q1、Q2。
- **引用边界**：Java ZXing `StringUtils.java` 可支持所移植的字符集启发式来源，却不是 C++/WASM 当前实现的版本凭证。ECI 声明与无 ECI 的启发式应分开；“大多数生成器都用 UTF-8”没有这里这些源码能证明的普遍统计依据。语言页优先尝试 GB18030 / Shift_JIS / EUC-KR 是本地策略，不能宣传为所有相应编码必然不乱码。Q2、Q3。
- **像素与体积**：`MAX_PIXELS = 16777216` 是本地处理上限。WebKit `CanvasBase.cpp` 的 `main` 平台条件不能当成已发布 Safari 的兼容性保证。当前文件实测：JS **36,713 B**，WASM **953,527 B**，合计 **990,240 B（约 967 KiB）**；本地 gzip level 9 估算合计 **422,596 B**，故“gzip 后约 420 KB”可作为当前文件约数，不能说 WASM 原始文件只有 420 KB，也不能保证服务器实际传输量。Q4。
- **内容格式**：ZXing 的 Barcode Contents 文档支持 `WIFI:`、MECARD 等约定；它们与 RFC 6068 的 `mailto:`、RFC 3966 的 `tel:`、RFC 5724 的 `sms:`、RFC 5870 的 `geo:` 各有范围。解析几个字段不等于实现这些 RFC 的所有语法，也不等于验证支付或网址安全。Q5、Q6。
- **其他原引**：DENSO 官方历史支持 1994 年及日文字符的设计背景；FTC 2023-12-06 与韩国金融委员会 2025-01-20 材料支持 QR 钓鱼风险背景。都不能证明解码器能够检测所有恶意二维码。BarcodeDetector 的可用性应引用日期化兼容数据或只说“可用性受限，本页采用 WASM”，不把某一时点的 OS/浏览器名单写成长期保证。Q7–Q10。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| Q1 | 包装库作者文档：<https://github.com/Sec-ant/zxing-wasm>。本地 vendor 头注释写 **3.1.4**；本报告没有将上游 `main` 称作该版本或“最新版本”。 |
| Q2 | ZXing C++：<https://github.com/zxing-cpp/zxing-cpp>。 |
| Q3 | MDX 所引 Java 字符集源码：<https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/common/StringUtils.java>。 |
| Q4 | WebKit 官方源码：<https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp>；原始正文：<https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/html/CanvasBase.cpp>。查阅时 `maxCanvasArea()` 的 `PLATFORM(IOS_FAMILY)` 分支是 `8192 * 8192`，另一分支为 `16384 * 16384`；这是开发分支代码，不是 Safari 发版承诺。 |
| Q5 | ZXing 作者维护的内容约定：<https://github.com/zxing/zxing/wiki/Barcode-Contents>。日文原引 Docomo 的历史地址见后文“未核实”。 |
| Q6 | RFC 6068，2010-10：<https://www.rfc-editor.org/rfc/rfc6068>；RFC 3966，2004-12：<https://www.rfc-editor.org/rfc/rfc3966>；RFC 5724，2010-01：<https://www.rfc-editor.org/rfc/rfc5724>；RFC 5870，2010-06：<https://www.rfc-editor.org/rfc/rfc5870>。 |
| Q7 | DENSO：<https://www.qrcode.com/history/>。 |
| Q8 | FTC，2023-12-06：<https://consumer.ftc.gov/consumer-alerts/2023/12/scammers-hide-harmful-links-qr-codes-steal-your-information>。 |
| Q9 | 韩国金融委员会，2025-01-20：<https://www.fsc.go.kr/no010101/83889>。 |
| Q10 | Mozilla 原引：<https://developer.mozilla.org/docs/Web/API/BarcodeDetector>；维护者兼容数据：<https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json>。 |

## AES：算法、封装与互操作边界

- **标准**：NIST SP 800-38D（2007-11）支持 GCM 的认证加密、同一密钥下 IV 唯一性及 96-bit IV 的推荐；§8.3 的随机 IV 调用次数限制应按同一密钥、跨实例的总量理解，不能当成浏览器自动计数或强制的限制。新 salt 使本页每次重新派生密钥，不等于数学上保证绝不碰撞。A1。
- **标准 / 实现读源**：Web Crypto AES-GCM 的返回是 ciphertext 后接 tag，AAD 参与认证但不加密。16 / 24 / 32 字节原始 AES 密钥均有效；密码模式派生 256-bit 密钥，不能把所有 raw-key 操作都笼统称作 AES-256。12 字节 IV、16 字节 tag、PBKDF2-HMAC-SHA256、600,000 次、`v2:` 和 salt|IV|ciphertext|tag 的布局是当前工具选择；Web Crypto 没有规定该 `v2:` 信封。A2。
- **引用边界**：OWASP Password Storage Cheat Sheet 的 PBKDF2-HMAC-SHA256 600,000 次是密码存储工作因子的建议，可作为参数选择背景，不能升级为浏览器文件加密的通用认证或弱密码安全保证。它没有规定本工具信封。A3。
- **互操作**：Python AESGCM 的 ciphertext 带 16 字节 tag；加上相同 nonce/AAD/KDF 和字节布局才能互通。页面示例代码的 Base64、无前缀回退等支持面小于组件本身，应称“该示例格式”，不承诺读取任意“同为 AES-GCM”的输出。A4。
- **OpenSSL**：所引 `openssl enc` 手册明确不支持 GCM/CCM；这是 **enc 子命令**限制，不能扩展为“OpenSSL 不支持 AES-GCM”。`Salted__` 只能提示一种有盐封装，不能独自证明 CBC 算法、迭代次数或摘要；解密命令必须与生成端参数匹配。A5。
- **地域引用**：微信 APIv3 资料可支持使用 APIv3 密钥、nonce、associated_data 和带 tag 的 ciphertext 的映射，不是本页自定义密码信封；CRYPTREC 的算法清单不能推出本页取得模块认证；日本个保委资料也不能推出自动满足所有适用法律要求。KISA 原引本次未取得足够正文，不能据此确认页面声称的完整算法清单。A6–A9。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| A1 | NIST SP 800-38D，2007-11：<https://csrc.nist.gov/pubs/sp/800/38/d/final>；<https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf>，§8、§8.3。修订动态不改变本报告核对的是这份原文。 |
| A2 | W3C Web Cryptography API Recommendation，2017-01-26：<https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#aes-gcm>；<https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#pbkdf2>。规定算法接口，不保证所有浏览器上下文均可用。 |
| A3 | OWASP 官方 cheat sheet：<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2>。 |
| A4 | cryptography 作者 AESGCM 文档：<https://cryptography.io/en/45.0.0/hazmat/primitives/aead/#cryptography.hazmat.primitives.ciphers.aead.AESGCM>。45 对应页面示例限定，不称最新。 |
| A5 | 指定 OpenSSL **3.6** 手册：<https://docs.openssl.org/3.6/man1/openssl-enc/>。页面中“3.6.1 实际输出”仍是历史实测，不由手册证明。 |
| A6 | 原引微信：<https://pay.weixin.qq.com/doc/v3/merchant/4012071382>；同 ID 官方正文入口：<https://pay.wechatpay.cn/doc/v3/merchant/4012071382>。MDX 写的 2024-11-29 为其引用更新时间，不据此称当前最新。 |
| A7 | CRYPTREC 清单：<https://www.cryptrec.go.jp/list.html>。引用标识为 LS-0001-2022R2、2026-03-30；算法和 IV 建议与页面是否通过模块验证是不同命题。 |
| A8 | 日本个人信息保护委员会 Q6-19：<https://www.ppc.go.jp/all_faq_index/faq1-q6-19_/>。保留适用场景与密钥管理前提；不能从算法名推出本工具的合规结论。 |
| A9 | KISA 原引：<https://seed.kisa.or.kr/kisa/kcmvp/EgovVerification.do>。本次未取得足够正文，见“未核实”。 |

## TOTP：RFC 与 otpauth 的地位

- **标准**：RFC 6238 的一般式为 `T = floor((UnixTime − T0) / X)`；页面的 `floor(UnixTime / period)` 只在 T0=0 时成立。SHA-256 / SHA-512 可用于 TOTP；30 秒是推荐默认，窗口是验证端策略。§5.2 的最大一步网络延迟建议与 §6 的时钟漂移窗口不能混为固定“允许 ±30 秒”。T1。
- **标准**：RFC 4226 要求共享密钥至少 128 bit、推荐 160 bit；RFC 6238 §5.1 推荐密钥长度与 HMAC 输出相当。随机生成 20 / 32 / 64 字节的说法需要本地代码证明，不能只引 RFC。Base32 的 A–Z、2–7 字母表来自 RFC 4648；全角折叠、去空格/连字符是本工具输入便利功能。T1、T2、T4。
- **测试向量**：RFC 6238 附录 B 的 SHA-1 / SHA-256 / SHA-512 值及附录 A 的 20 / 32 / 64 字节测试 seed 支持页面解释。前后时间步的值、6 位截取、其他周期、pyotp 示例仍需本地复算；不能称所有这些值都逐行列在 RFC 表内。T1。
- **otpauth 文档**：Google Key Uri Format 说明 `totp` / `hotp`、Base32 secret、issuer、algorithm、digits、period 和 URI 编码。它是 Google 的事实格式文档，**不是 RFC 6238 定义的 URI 标准**；本页只接受 TOTP、6/8 位、1–86400 秒和 T0=0 是实现范围。T3。
- **时效性不一致**：该 wiki 显示最后编辑于 **2018-11-26**，确实写过 Google Authenticator 忽略 algorithm / period、Android 和 BlackBerry 实现忽略 digits。这支持“旧文档如此记载”，不足以无版本地断言 2026 年所有 Google Authenticator 均如此。组件 `gaNote` 也应遵守同一边界。
- **场景引用**：阿里云绑定说明和 FAQ 支持手动密钥、手机时间错误、绑定页面密钥过期等诊断因素；它们不支持“码不同一定是 App 密钥错误”。GMO、Google 韩语帮助和 KNSU 的材料只是各自场景依据；KNSU 2025-07 指南关于二维码再次注册的限制应归给该门户，不推广为 TOTP 协议的一次性扫描限制。T5–T8。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| T1 | RFC 6238，2011-05：<https://www.rfc-editor.org/rfc/rfc6238#section-4>；<https://www.rfc-editor.org/rfc/rfc6238#section-5.1>；<https://www.rfc-editor.org/rfc/rfc6238#section-5.2>；<https://www.rfc-editor.org/rfc/rfc6238#section-6>；<https://www.rfc-editor.org/rfc/rfc6238#appendix-A>；<https://www.rfc-editor.org/rfc/rfc6238#appendix-B>。 |
| T2 | RFC 4226，2005-12：<https://www.rfc-editor.org/rfc/rfc4226#section-4>；<https://www.rfc-editor.org/rfc/rfc4226#section-5.3>；<https://www.rfc-editor.org/rfc/rfc4226#appendix-D>。 |
| T3 | Google Key Uri Format，最后编辑 **2018-11-26**，所在仓库于 **2021-04-06** 归档：<https://github.com/google/google-authenticator/wiki/Key-Uri-Format>。 |
| T4 | RFC 4648，2006-10：<https://www.rfc-editor.org/rfc/rfc4648#section-6>。原引 Web Crypto HMAC API：<https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign>；接口说明不证明本页隐私行为。 |
| T5 | 阿里云：<https://help.aliyun.com/zh/ram/user-guide/ram-users-bind-mfa-devices-by-themselves>；<https://help.aliyun.com/zh/ram/support/faq-about-mfa>。 |
| T6 | GMO Coin：<https://support.coin.z.com/hc/ja/articles/115010203187>。 |
| T7 | Google 韩语帮助：<https://support.google.com/accounts/answer/1066447?hl=ko>。 |
| T8 | KNSU 官方指南，文内日期 **2025-07**：<https://portal.knsu.ac.kr/knsu/otp/knsuOtpGuide.pdf>。 |

## GA4：自定义参数不等于完整采集载荷

**Google 官方直接支持这次措辞修正**：

- G1 明确说，即使是 custom events，Web stream 也默认附带 `language`、`page_location`、`page_referrer`、`page_title`、`screen_resolution` 等参数。其 `session_start` 说明还说，每个会话自动生成会话 ID / 序号并与会话中的事件关联。
- G2 的默认采集范围含会话统计、浏览器/设备资料、粗略地理位置；一般通过 `_ga` 中的 client ID 区分用户/会话，并注明 Consent Mode 的存储条件。因此不能由“代码只传 tool_name/action”推出“GA 不收页面/设备/会话信息”或“整个请求只有这两个字段”。
- 可用措辞：“本工具为 `tool_use` 自定义添加的参数仅包含工具名与动作，不添加查询域名、Markdown、二维码解码内容等输入；GA4 还会按其配置收集页面、设备及会话等常规统计信息。”其中“没有添加输入”须由主线读源及生产网络检查证明，Google 文档本身不能替本站作此保证。
- 自动采集、增强型衡量、Consent Mode 和浏览器拦截会改变实际请求。以上资料不能证明某次事件已经到达 GA，也不能证明其他自动事件绝不携带链接 URL 等字段；生产接收情况由主线另验。

| 编号 | 一手 URL、日期 / 版本 |
|---|---|
| G1 | Google Analytics Help，Automatically collected events：<https://support.google.com/analytics/answer/9234069?hl=en>。本次正文定位：默认参数段与 `session_start` 行；查阅 2026-10-25，页面未显示稳定修订日期。 |
| G2 | Google Analytics Help，Data collection：<https://support.google.com/analytics/answer/11593727?hl=en>。本次正文定位：default implementation 与 Identifiers for websites；查阅 2026-10-25，页面未显示稳定修订日期。 |

## 未核实与保留事项

以下是证据缺口，不是据此认定原文错误：

- **支付码时效**：微信 Native 原引 <https://pay.weixin.qq.com/doc/v3/merchant/4012791877> 和 <https://pay.weixin.qq.com/doc/v3/merchant/4012791891>，以及对应 `pay.wechatpay.cn` 官方入口；支付宝原引 <https://opendocs.alipay.com/open/02np92>。本次未取得足够稳定正文，不能同时确认“四语场景中的这两种码都在两小时后失效”和“相册/长按限制”的完整适用条件。尤其不要将预下单示例推广到所有支付宝二维码；建议主线补具体接口字段和有效期条件的一手依据。
- **历史 MECARD 来源**：<https://web.archive.org/web/20130712164414/http://www.nttdocomo.co.jp:80/english/service/developer/make/content/barcode/function/application/addressbook/> 未取得足够正文；ZXing 自身的 Q5 可支持它实际采用的 MECARD 约定，但不补证 Docomo 历史页面的所有细节。
- **KISA / 飞书**：A9、M8 的正文获取不足，不能标成“本次已逐项确认”。
- **竞争站、性能、固定 DNS 应答**：页面中标日期的竞品操作、请求载荷、查到的 IP、4000×3000 图片耗时及 AES 文件耗时都保留为历史观察，本侧未登录、未操作浏览器、未重新测量。不能用外部标准把这些观察升级为当前保证。
- 本报告只核对引用与事实边界，不证明本页的全部实现、输入清除、无存储/无第三方脚本或线上事件接收；主线的代码、四语与生产检查为独立证据。
