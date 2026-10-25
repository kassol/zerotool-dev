# AI 助手资料与页脚入口

日期：2026-10-25。

参考 OpenFree 的 Agents 区：公开的 Markdown 资料入口，以及带固定站点问题的 AI 服务链接。ZeroTool 沿用暖纸色、衬线标题与现有亮暗主题，把这一结构放在全站页脚的常规链接之前。

## 范围

- 页脚列出当前语言的 `llms.txt`、`index.md`、`categories.md`、`about.md`，以及现有英文 `llms-full.txt`。文件名旁的可访问说明使用页面语言。
- `index.md` 介绍站点并连接资料与公开页面；`categories.md` 按现有 11 类列出全部工具、说明和联网条件；`about.md` 解释处理、联网、保存、统计、广告及源代码。内容由 `tools.ts`、联网与持久化策略、i18n 以及现有 llms 生成规则构建，工具数量随注册表变化。
- 新增端点放在现有 `src/pages/` 与四语目录内，按固定文档名生成静态文件。根目录的三条 Markdown 路径明确排除 Pages Functions；以 `text/markdown; charset=utf-8` 提供。资料相互链接，也从 llms 的 Optional 节发现。HTML sitemap 维持页面 URL。
- 五个入口为 ChatGPT、Claude、Perplexity、Google AI Mode、Grok。参考站的 Gemini 图标实际链接到 Google Search 的 `udm=50`，本站按实际目的地命名。
- 固定问题请助手说明本站工具、用途和限制，引用当前语言资料，并区分已核实信息与未知项。URL 在构建期生成，不读取工具输入、当前地址或浏览器存储。服务可能需要登录，是否接受预填问题由对方决定；不在验收中提交问题。
- 图标内联，样式加入已有 BaseLayout CSS；触控目标至少 44px，支持键盘与窄屏换行。AI 链接在新标签打开，禁止传递 Referrer；页面加载或悬停均不预取外部服务。

不增加本站尚不存在的 tags、collections、submit 或 advertise 文档。此功能提供可发现的资料与问答入口，不承诺 AI 收录、引用或推荐结果。

## 依据

2026-10-25 在参考站页脚 DOM 核对五个实际 href；浏览器同源读取 `index.md`、`categories.md`、`about.md` 均为 HTTP 200、`text/markdown`。其资料用于介绍真实页面与使用边界。

- OpenFree：https://openfree.tools/
- Google AI Mode 说明：https://support.google.com/websearch/answer/16011537
- 五个平台的 URL 参数参考已观察的入口，属于外部网站行为，可能变化；不将未执行的预填行为记为验收通过。

## 验收

1. 生成器检查四语、固定文档名、分类与工具覆盖、联网/敏感策略、所有站内目标及提示词的公共信息边界。
2. 构建产物检查所有资料文件、页脚链接和可访问名称、静态路由排除、Content-Type 与 sitemap。
3. audit、完整生产构建和全部 `test-*.mjs` 通过。
4. 在一个自有浏览器空间批量检查四语、桌面/手机、亮暗主题与键盘焦点；核对零横向溢出和新增自动外部请求为零。最多两轮视觉验收。

## 实际结果

- Node 22.23.3，按 lockfile 完成 `npm ci`；audit 24 PASS、0 WARN、0 FAIL；完整生产构建成功，564 个工具页 CSS 顺序与隔离通过。
- 全部 169 个 `test-*.mjs` 通过：166 个在沙箱内直接通过；chmod 的系统权限位核对、CSP 示例的本地服务、curl 对照的环回 HTTP 服务受沙箱限制，三个脚本按原样在获准环境重跑均退出 0。新增 `test-agent-footer.mjs` 1,895 项通过，llms 回归 1,010 项通过。
- 真实 Pages 预览核对 12 个 Markdown 资料：全部 HTTP 200、`Content-Type: text/markdown; charset=utf-8`；构建路由跳过 Functions，所有站内链接指向实际页面或固定资料文件，HTML sitemap 没有混入资料端点。
- 四语 × 1366 / 390px × 亮暗共 16 组，完成两轮有界验收。横向溢出 0、AI 按钮均至少 44×44px、键盘焦点可见、新增 AI 服务自动请求 0、捕获的页面异常 0。稳定主题下正文最低对比度 7.69:1、图标最低 7.99:1。第一轮有一次采样落在图标主题过渡中，第二轮等真实 CSS transition 完成后全部通过，未据此改动 UI。
- 另测 320px 中文 AES 敏感页：横向溢出 0，页面查询参数和输入框中的测试哨兵均未进入 AI href，GA / AdSense 脚本与 AI 服务自动请求均为 0。
- AI 外链只核对固定目的地、问题的 URL 编码、语言、可访问名称和导航隔离；未向外部 AI 服务发送问题，未把回答、预填成功或 GEO 效果记为已验证。
- 浏览器自有 TaskSpace 23 已关闭。原始本地证据在 `/private/tmp/zerotool-geo-20261025-CcFTjA/`，包括两轮截图/几何/对比度记录、构建与全部脚本日志。
