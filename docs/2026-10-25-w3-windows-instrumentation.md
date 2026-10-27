# Windows 试跑的计时补充（2026-10-25）

对应 `windows-initial-baseline-20261025`。原配置 JSON 摘要保持
`c667d6113c117dfe7968315aaec641e420f9085f314de3f92ec5b9152308cf58`。
本说明澄清计时与回归要求，不改变输入、负载控制值、三个工具/六种动作范围，
也不修改原 W3 判据。

## 已知阻塞与可证伪方向

1. 旧输出导致提前完成。JSON Formatter 的按钮调用 `run()`，等待
   `client.analyze().then()` 后才 `render()`；`render()` 会更新状态并重新
   写入 `#jf-output-code`。旧的成功状态与可复制结果不能作为新操作完成证据。
   预测：旧结果已存在但新动作未发生时，修正后的记录必须仍为 pending。
2. 时间区间或事件配对混淆。Event Timing 包含输入延迟；处理阶段后的双 rAF
   是另一个区间。预测：同一事件的原始字段可以分解总时长，或者证明记录
   匹配到了其他事件。不能以 9.4 ms 与 496 ms 不相等为唯一失败条件。
3. 控制面或观察逻辑造成额外工作。预测：无产品运算对照中也能观察到相应
   延迟，必要时 trace / LoAF 能指出脚本。未取得该证据前保留为未归因，
   不宣称那条 1004 ms 任务是产品或测量脚本造成。

## 完成识别

每次动作在原生输入前生成独立序号，保存浏览器 `performance.timeOrigin`、
arm 时间和旧 DOM 的观察计数，先断言尚未完成。捕获对应可信原生事件后，
必须再有属于本次动作的实际新结果证据与工具特定的结束条件。

JSON 可只读观察输出节点的 post-event 变更，结合新的成功状态和结果可用性；
不要只等状态文字/按钮属性满足旧值，也不要仅等固定时间。观察目标必须
排除代理自己的节点。测试必须覆盖“相同输入再次格式化”，不能为了方便测量
改变原工作负载或输出。

该页面支持增量展示，需区分结果就绪、首屏展示机会与展示构建完成，
不能把第一段高亮或旧输出当成全量展示终点。按源码与实际可观察条件
写明所采用的终点；不伪装成物理屏幕的精确呈现时间。清空操作单独验证。
DOM 内容校验与大结果提取放在计时结束后。

不得在 capture 监听器内仅凭一个 microtask 就宣称所有产品事件处理结束。
双 rAF 只记录为已获得后续绘制机会的标记；它不与 Event Timing 总时长
强行判等，也不自动覆盖异步 Worker / Web Crypto 结果完成。

## 事件字段与配对

事件、原始标记、Event Timing 和长任务使用同一页面的时间原点。
Node 控制命令往返时间单列，不能混入页面 `performance.now()`。
逐条保留事件类型、目标、可信性、时间戳、原生 Event Timing 的
`startTime` / `processingStart` / `processingEnd` / `duration` /
`interactionId`，并保存配对或未配对的原因。不能从旧 buffered 条目选一个
duration 归给当前点击。

对于确实匹配的条目，分开计算：

```text
inputDelay       = processingStart - startTime
eventProcessing  = processingEnd - processingStart
presentation     ≈ max(0, startTime + duration - processingEnd)
```

原始字段仍须保留，duration 的 8 ms 粒度不可消除。可用时以
`durationThreshold=16` 观察新 event 条目；更短的事件可能没有对应条目，
并非仪器失败。文件 change 等事件也不保证由 Event Timing 暴露。
普通 DOM Event 本身没有可直接拿来配对的原生 interactionId。
不把同一交互中的 pointerdown / pointerup / click 混为一条。

## 有效回归与恢复试跑

- 在真实页面上保留旧输出，原谓词应能暴露提前完成；修复后该场景必须通过。
- 无运算按钮、相同输入重复格式化、清空三种控制保留原始记录。
- 解释原 9.4 / 496 ms 对照时，内联原字段和拆分结果；如果无法配对，
  说明原因，不能只返回“绘制不一致”。
- 保留那条 1004 ms 长任务及相关时间窗口。动作归属与脚本原因分别判断。
- 仪器通过后继续原三个工具、六种动作、每种三个样本的独立 Windows
  试跑。采样前后负载窗口须新采，不能借用上轮已通过窗口。
- 复用 Node、依赖、构建与夹具；仅改本任务测量代理/脚本/报告，
  不改产品组件、引擎、算法、计时器行为或输出。

Event Timing 的字段定义与观察示例见编辑草案
<https://w3c.github.io/event-timing/>（工作草案，不作为已完成推荐标准）。
与实际 JSON 源码相符的异步终点另按本轮页面观察核实。
