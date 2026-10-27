# W6 B4：ai-token-counter 四语内容核对（2026-10-27）

基线 `def8eb66`。范围：`src/content/tools/ai-token-counter/{en,zh,ja,ko}.mdx`、`src/components/tools/AiTokenCounterTool.astro`（可见文案与行为）、`src/components/tools/ai-token-counter-engine.js`、`src/data/persistence.ts`、`src/data/network.ts`。未改 FAQ 条数 / id / 顺序、steps、seoTitle、`engine:start/end`、持久化策略、联网声明、统计动作与脚本。

## 口径与总量

以组件与引擎行为为准（file:line），外部事实用 2026-10-27 抓取的一手来源：tiktoken `model.py`、DeepSeek 英文 / 中文价格页与 Token 用量页、Anthropic Token counting 页与价格页、Google Gemini Token 页与价格页、OpenAI 价格页。OpenAI 帮助页的「4 字符 / 75 词」返回 403，未复核。

共 122 条陈述：supported 69、corrected 21、qualified 28、unverified 4。FAQ 24 条（6 × 4）、正文 66 条、组件可见文案 32 条；四语同题同改，逐条记录见 `2026-10-27-w6-b4-ai-token-counter.json`。

| 语言 | 陈述 | supported | corrected | qualified | unverified |
|---|---:|---:|---:|---:|---:|
| en | 31 | 19 | 4 | 7 | 1 |
| zh | 31 | 17 | 6 | 7 | 1 |
| ja | 30 | 17 | 5 | 7 | 1 |
| ko | 30 | 16 | 6 | 7 | 1 |

## 修正要点

- **「四种语言」与实际两行不符**（`en.mdx:51`）：该段只给英语与中文两行，下一张表也只有两行；改为「in English and Chinese」。
- **本地存储上限的单位**（四语 `privacy` 题，`en.mdx:19`、`zh.mdx:19`、`ja.mdx:19`、`ko.mdx:19`）：代码用 `input.value.length > 50 * 1024` 与 ztPersist 的 `MAX_ENTRY = 50 * 1024`（`AiTokenCounterTool.astro:474`、`ToolLayout.astro:128,228`），按 UTF-16 编码单元计，不是码点。四语改为「约 5 万个 UTF-16 编码单元」。
- **中文 DeepSeek FAQ 与正文矛盾**（`zh.mdx:25`）：正文 `zh.mdx:37` 写「按 0.6 估算约 11 个，实际 15 个」，FAQ 原文却说「实际数量常常低于按字数估算的值」。改为「可能高于也可能低于……本页示例就高于估算」；DeepSeek 文档确有两项经验值与「以接口返回为准」（Token 用量页）。
- **把单例结论写成一般规律**：`zh.mdx:50` 的「中文文本」改为「这段中文」；`ja.mdx:43` 的「日本語は」加「この例では」；`ko.mdx:43` 的「한국어는」加「이 예에서는」。对应数据 172 / 111（+55%）、38 / 28（+36%）、35 / 24（+46%）均由页面标注复算。
- **韩语比较句方向**（`ko.mdx:47`）：中国语例里 DeepSeek 最低，但该韩语例里 DeepSeek 176 > o200k_base 164。原文「중국어에서는…한국어에서는…흔합니다」把个例写成趋势，改为分别陈述两个示例。
- **DeepSeek 高峰时段漏掉中国法定节假日**（`ja.mdx:73`、`ko.mdx:70`）：DeepSeek 价格页脚注 2 写明高峰为 UTC 周一至周五 01:00–04:00、06:00–10:00，**不含中国法定节假日**；ja / ko 只写「平日」，已补。zh 原文已写「不含法定节假日」。
- **zh 价格排除项与其他三语不一致**（`zh.mdx:96`）：en / ja / ko 均写「税费、地区加价、协议折扣」，zh 缺「地区加价」；OpenAI 价格页写明地区处理端点加价 10%，Anthropic 数据驻留为 1.1×。已补。
- **组件 o200k 模型清单漏 o1**（`AiTokenCounterTool.astro:46,110,174,238`）：四语 MDX 的 o200k 行都列出 o1，tiktoken `model.py` 的 `MODEL_TO_ENCODING` 也把 `o1`、`o3`、`o4-mini` 映射到 o200k_base；卡片清单补 `o1`。
- **token 视图提示的「下一个 token」不成立**（`AiTokenCounterTool.astro:69,133,197,261`）：一个 4 字节字符在 cl100k 中可拆成多个字节 token（`test-ai-token-counter.mjs` 用 🦜 断言 partial token），不存在「下一个 token 补齐」。四语改为「后面的 token 一起补齐 / the following tokens」。

## 限定

- **20 MB 实际是 20 MiB**：`MAX_FILE = 20 * 1024 * 1024`（`AiTokenCounterTool.astro:443`），文件大小显示按 1048576 折算（`:745`）。FAQ 与组件文案沿用界面用语「20 MB」；未改，因为 `test-ai-token-counter.mjs:544` 断言状态行包含 `20 MB`。
- **「Claude、Gemini、GPT-6 没有本地分词器」**：Anthropic 文档确认无本地分词器；tiktoken 无 GPT-6 条目；Google 的 `google-genai` 在此前记录中带有 `LocalTokenizer`（覆盖部分 Gemini 模型，依赖 Gemma 分词器），今天未重取该页。此处按「没有可直接复现本页计数的分词器」理解，措辞未改。
- **组件 `otherBody` 的「免费计数接口」**：Anthropic 明确免费；Google `count_tokens` 未标价；OpenAI 是否有免费计数接口今天未取到页面。作为产品文案保留。
- **竞品数字**：benchlm.ai / tokencost.app / token-counter.dev / MiniWebtool / tokencounter.org / tokencalculator.app 均为 2026-10-01 的观察，未复测；四语都已写日期，按历史观察处理。

## 未核实

- OpenAI 帮助页的「1 token ≈ 4 字符、100 token ≈ 75 词」：`help.openai.com/en/articles/4936856` 今日返回 403。Google 的「约 4 字符」已由 Token 页确认。
- OpenAI 的输入 token 计数接口「包含格式 token」：未取到 OpenAI 一手页面；本地分词器只数纯文本这一点成立。
- GPT-6 没有任何本地分词器：只能确认 tiktoken `model.py` 无 `gpt-6` 条目。
- 价格表中的上下文上限（gpt-6 922,000、gpt-5.5 1,050,000）：只核对了代码值（`engine:359-372`），未逐个打开模型页。

## 验证

- `node scripts/test-ai-token-counter.mjs`：5,338 passed，0 failed。
- `node scripts/test-tool-content-parity.mjs`：7,753 passed，0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS，0 WARN，0 FAIL。
- 未跑 `npm run build`（按任务要求）。

## 发现的问题

- **B 档（价格将变）**：Google 价格页今日写明 `gemini-3.8-flash` 输入 $0.75 / 输出 $3.75 仅到 2026-12-31，2027-01-01 起为 $1.50 / $7.50；引擎仍用 0.75 / 3.75（`ai-token-counter-engine.js:369`），页面日期为 2026-10-01。今天仍正确，建议下一次价格核对时更新，或在价格段加一句到期日。
- **B 档（Gemini 本地分词器）**：`google-genai` 的 `LocalTokenizer` 在此前记录中覆盖部分 Gemini 模型；页面四语均写「没有公开本地分词器」（`en.mdx:38,42`、`zh.mdx:73`、`ja.mdx:64`、`ko.mdx:65`）。若该 SDK 仍覆盖 `gemini-3.1-pro-preview`，价格表的 ≈ 会低估可得的精确度。今天未重取 SDK 文档。
- **C 档**：`done` 状态固定写「o200k_base」（`AiTokenCounterTool.astro:45,109,173,237`，`:657`），o200k 加载失败时显示「— tokens (o200k_base)」。
- **C 档**：DeepSeek 缓存命中价（$0.006 / $0.044 每百万输入）未建模；页面已写「缓存未命中 / uncached」，不算错误。
- **C 档**：`PRICES_CHECKED = 2026-10-01`（`engine:351`）距今天 26 天；FAQ 已要求读者打开原页复核。
