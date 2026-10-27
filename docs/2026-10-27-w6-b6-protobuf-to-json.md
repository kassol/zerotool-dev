# W6 batch 6 — protobuf-to-json 事实核对（2026-10-27）

范围：`src/content/tools/protobuf-to-json/{en,zh,ja,ko}.mdx`、`src/components/tools/ProtobufToJsonTool.astro` 可见文案（STRINGS 与控件气泡）、`src/data/persistence.ts`、`src/data/network.ts`。未改 `engine:start` / `engine:end`、steps、FAQ 条数 / id / 顺序、seoTitle、脚本、持久化与统计策略。基线 HEAD `f358d03c`。

## 修正（8 组）

| # | 位置 | 修正 | 依据 |
|---|---|---|---|
| 1 | en.mdx:22（FAQ `grpc`） | “grpc-web-text bodies are Base64 and can be pasted directly” 改为「整段是一个 Base64 流时可直接读；按消息分块补 `=` 的响应会在中间填充处报 Base64 错误」。 | PROTOCOL-WEB「Text-encoded (response) streams」允许流内分块填充，整段不必是合法 Base64 实体；`fromBase64()` 946–972 拒绝数据中的 `=`；探针用两帧各自填充的正文复现 `b64Pad`。 |
| 2 | en.mdx:78；组件 `tips.rawview`（en:74 / zh:247 / ja:420 / ko:593） | 「其他解读」原来写成每个数字都列 sint64、sfixed64、float、double；改为按线路类型：varint 列 uint64 / sint64 / int64，4 字节列 fixed32 / sfixed32 / float，8 字节列 fixed64 / sfixed64 / double。 | `rawReadings()` 1957–1969：wire type 0 只给 uint64、sint64（负数时另给 int64）；1 给 hex、fixed64、sfixed64、double；5 给 hex、fixed32、sfixed32、float。 |
| 3 | en.mdx:138（输出表 enum 行） | “未定义的数值仍是数字”限定为开放枚举；封闭枚举按 proto2 规则留在未知字段里。 | `valJson()` 1820–1826 对开放枚举返回数字；`readField()` 1590–1605 把封闭枚举的未知值放进 `msg.unknown`，配合 `note.closedEnum`（173）。测试夹具含 proto2 与 edition 2023 的 closed enum。 |
| 4 | en.mdx:139（输出表 Duration） | `"1.5s"` 改为 `"1.500s"`。 | ProtoJSON 生成的 Duration 只用 0、3、6、9 位小数（protobuf.dev JSON 表）；`fracText()` 1699–1707 对 500000000 ns 输出 `.500`；引擎探针得 `1.500s`。 |
| 5 | en.mdx:141（输出表 Any） | 补上「Schema 里没有的类型写作 `"@type"` + `"value"` Base64」。 | `anyJson()` 1769–1786：找不到类型时返回 `@type` 与 `value: toBase64(...)`，并加 `note.anyUnknown`。 |
| 6 | en.mdx:154、zh.mdx:129、ja.mdx:118、ko.mdx:102（限制段新增） | 新增「grpc-web-text 按单个 Base64 流读取；分块填充会在中间报错，先解成二进制」。 | 同第 1 条。四种语言同步。 |
| 7 | en.mdx:155、zh.mdx:130、ja.mdx:119、ko.mdx:103（限制段 proto2 / editions） | 原句把「组、required」列在 proto2 与 editions 之下。改为：proto2 的组、required、封闭枚举、扩展按 proto2 读；editions 从 `features` 读取字段存在性（含 `LEGACY_REQUIRED`）、封闭枚举、packed / expanded、delimited，扩展与 proto2 相同。 | protobuf.dev「Feature Settings for Editions」：editions 没有 group 语法与 `required` / `optional` 标签（Caveats 要求把 group 展开并用 `message_encoding = DELIMITED`，required 用 `field_presence = LEGACY_REQUIRED`）；代码 `fileSyntax` / `EDITION_DEFAULTS` 1153–1165、`featureOf` 1261–1268、`finfo` 1325–1326。edition 2024 探针解码成功；2023 由夹具覆盖。 |
| 8 | ja.mdx:45 | 「`protoc --encode` で作った 54 バイト」改为 52 バイト。 | 该 hex 为 52 字节；用 `protoc 36.2 --encode=shop.v1.Store` 重新生成，输出逐字节相同（`0a0ce6b8…e3828a`，52 字节）。 |

ko 限制段在改写第 7 条时补上原本缺失的 UTF-8 条目（proto3 的 `string` 非法 UTF-8 报错并给字节位置），与 en / zh / ja 对齐；ko 正文已有该行为示例。

## 已核对未改（要点）

- ProtoJSON 规则与 `protobuf.dev/programming-guides/json/` 一致：64 位整数为十进制字符串；`int64` 用字符串的理由是 JS double 与 2^53；无 presence 的 proto3 默认值省略；enum 名；bytes 标准 Base64；Timestamp / Duration 0、3、6、9 位小数且 Z 归一；FieldMask lowerCamelCase；Struct / Value / ListValue / wrappers / Any 的特殊表示；`null` 不输出。
- 代码与文案的四条隐私承诺一致：仅选项进 localStorage（`prefs` 2648–2652）；Ctrl/⌘+L 只在焦点位于工具内时清空输入与载入的 `.proto`（3124–3131），设置在 `preference` 策略下保留（`persistence.ts:28`）；页面加载 GA4 与 AdSense（`ToolLayout.astro:304,323`）；统计只记 `protobuf_to_json` 与 `decode` / `encode` / `sample`，按类型与输出文本去重（`trackResult` 2725–2732），键入、初始示例、错误、过期异步结果与复制都不发事件。
- gRPC：5 字节头（1 字节 flag + 4 字节大端长度）、Auto 的触发条件、trailers 的 flag 最高位、gzip 解压，与 PROTOCOL-HTTP2 / PROTOCOL-WEB 及 `splitFrames` / `unframe` 1088–1120 一致。
- 无 Schema 的三种视图：JSON、其他解读、`protoc --decode_raw`；`rawText` 与 libprotoc 36.2 的 260 个输入逐字节一致（fixtures）。
- 内置 import 恰为 `any`、`duration`、`empty`、`field_mask`、`struct`、`timestamp`、`wrappers`（`node_modules/protobufjs/src/common.js` 只导出这 7 个）；`descriptor.proto` 的自定义选项被丢弃（1201–1215）。
- 140 条随机消息（含 proto2 group / 扩展、edition 2023 features）与 protoc 36.2、Python protobuf 7.36.2 `json_format` 对照：139 条一致，1 条两边都拒绝（Timestamp 超范围）；夹具头记录 `libprotoc 36.2`、`7.36.2`、140 条、1 条错误。
- 竞品段落保留 2026-10-02 的日期与观察（en / zh / ja / ko 各自列出的工具不同），本轮未重跑。

## 发现但未改（超出本轮范围）

- **FieldMask `_x` 静默写成 `"X"`**：`fieldMaskJson()` 1710–1715 只拒绝含 `_` 后非小写字母的路径，`_x` 通过并转成 `X`，无法反解；`x_0`、`foo__bar` 会被拒绝。Go `protojson` 对不可往返的路径报错。探针：`_x → "X"`、`x_0 → fieldMaskPath`。属引擎块，未改。
- **edition 2026**：`EDITION_DEFAULTS` 无 2026，`protobuf.js 8.6.6` 先报 `illegal edition '2026'`（页面语言的行 1 错误），不是崩溃；文档只声明 2023 / 2024，未加说明。
- ko 的 UTF-8 示例消息「7바이트」是 0 基偏移（payload 首字节），zh / ja 页没有同类示例，未改组件文案。

## 未核实

- en.mdx:146、zh.mdx:121、ja.mdx:110、ko.mdx:94 的竞品行为是 2026-10-02 的实测观察，本轮未重跑，保留原文与日期。
- ko.mdx:65 「protoc(C++)와 Python protobuf 7.36.2도 … 거부합니다(2026-10-02 실측)」为当日实测，本轮未重跑；引擎对 proto3 非法 UTF-8 的拒绝已由代码与示例复算确认。

## 来源（查阅 2026-10-27）

- ProtoJSON：https://protobuf.dev/programming-guides/json/
- Editions features：https://protobuf.dev/editions/features/
- protojson `MarshalOptions`（EmitUnpopulated / EmitDefaultValues）：https://pkg.go.dev/google.golang.org/protobuf/encoding/protojson
- Kratos v2.8.4 `encoding/json/json.go`：https://github.com/go-kratos/kratos/blob/v2.8.4/encoding/json/json.go
- gRPC over HTTP/2：https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
- gRPC-Web：https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md

## 测试

- `node scripts/test-protobuf-to-json.mjs`：改动前后均 401 passed / 0 failed。
- `node scripts/test-tool-content-parity.mjs`：7753 passed / 0 failed。
- `node scripts/audit.mjs --quiet`：24 PASS / 0 WARN / 0 FAIL。
- 未运行 `npm run build`（按要求）。

## 交付物

- `docs/2026-10-27-w6-b6-protobuf-to-json.json`：151 条（supported 130 / corrected 12 / qualified 4 / unverified 5）。
- 本文件。未改测试、engine 块、steps、FAQ 条数与 id、seoTitle、持久化 / 联网策略；工作树中其他工具的改动不属于本批。
