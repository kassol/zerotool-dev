# Windows 初始性能基线（2026-10-25）

本轮用于继续用户要求的异机性能测量，建立 Windows 上可复查的初始数据。
它单独记录硬件、原生负载指标和操作计时，不改写旧 W3 的 Unix load <10
接纳条件，不将跨机器耗时作两倍比较，也不代替真实用户 INP。
旧 W3 目前仍为 0/40、证据不足。实验配置见同名 JSON。

## 已完成准备的复核

远端 Node 22.23.3、依赖安装、构建、564 页 CSS 顺序、71/71 包内清单、
64/64 输入夹具已完成；小输入 JSON 的格式化、清空、焦点和观察 API 已验证。
具体收到的结果与边界见 `2026-10-25-w3-windows-review.json`。

父机已用 Node 官网校验表核对远端报告的 win-x64 ZIP 摘要，完全一致。
这证明官网摘要与报告一致，不扩展为父机重新读取过远端 ZIP 或证据包。
此前 107 / 947 / 65 / 1001 ms 是页面周期记录，尚未映射到明确操作，
不能当作大输入实测。约 62 秒的十二个宿主诊断点也不追认成采样资格。

## 三工具试跑

复用已经验证的工作区、依赖、构建和夹具。先串行测 JSON Formatter 的
文件打开/再次格式化、JSON Schema 的文件打开/Validate、AES 的文件选择/
加密，共六种动作；每种争取三个符合本 Windows 实验控制条件的样本。
先以空闲、小输入校准计时和代理观察开销，再执行原 manifest 的大输入。
此次先完成试跑，尚不启动其余三十七工具。

## Windows 空闲控制

Node 的 Windows loadavg 固定为零，无法据此换算原门槛。使用 Windows
原生总 CPU 和处理器队列，每秒采集并保存实际时间戳。以下数值是本轮的
保守实验选择，**不是微软的浏览器测试标准，也不是 Unix load 的等价值**：

- 每个工具的串行试验块前后分别观察至少 60 秒，至少 55 个有效点，
  相邻间隔不能超过 2.5 秒。
- CPU 时间加权均值 ≤15%、CPU P95 ≤25%、全机处理器队列 P95 ≤1。
  P95 使用 nearest-rank；保存实际原值和计算方法。
- 每个空闲窗口最多等待三轮。不满足则保留排除原因和已有数据。
- 操作期间继续采集。真实计算引起的 CPU 上升正常保留；不能因工具本身
  工作繁重就丢弃慢样本。外部竞争与无法解释的干扰另外标注。

构建、安装、夹具生成和文件校验在这些窗口之前完成。记录电源/浏览器/
缓存与第三方加载条件；不改变用户系统配置。前台要求逐动作确认
`visibilityState=visible`、`hasFocus=true` 并记录变化。

## 计时与长任务

记录原生事件时间、事件处理开始、真实结果完成并获得绘制机会的时间。
实际动作的起止与完成条件先通过小输入验证；复制大文本、输出哈希与
截图放在结束计时之后，减少观察成本。

保留所有与动作区间重叠的长任务的完整持续时间，不把跨边界任务截短。
首屏加载、空闲期和动作期分别列出。Long Tasks 只有粗粒度容器归因；
可用时另采 Long Animation Frames 的脚本信息或受支持的 trace。
LoAF 的帧时长和 task 时长仍分别保存，不互相替换；没有源信息时如实保留。
不得仅因看到旧的 947 / 1001 ms 就认定是工具运算，也不得删除不明慢任务
后报告通过。先证明观察代理、读取操作没有把控制成本算入运算。

如 API、动作标记或归因不足，返回仪器缺口，不批量累积不可靠时间。
没有观察到 ≥50 ms 长任务时按此原文记录，不写成实测 0 ms。
输出逐样本时间、结果正确性、进度、取消、迟到结果、负载原值、脚本哈希、
排除原因和证据包。Windows 初始基线与旧 W3 状态同时列明。

## 官方资料

- Node loadavg 的平台语义：
  <https://nodejs.org/api/os.html#osloadavg>。
- Node 22.23.3 官方下载与校验：
  <https://nodejs.org/en/blog/release/v22.23.3>、
  <https://nodejs.org/dist/v22.23.3/SHASUMS256.txt>。
- 微软原生性能采集命令：
  <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/typeperf>。
- 微软关于 CPU 与排队计数器的定义：
  <https://learn.microsoft.com/en-us/biztalk/technical-guides/system-level-bottlenecks>。
  这里仅采用指标语义，不套用 BizTalk 的服务器瓶颈阈值。
- Chrome 关于 Long Tasks 的归因限制及 LoAF：
  <https://developer.chrome.com/docs/web-platform/long-animation-frames>。
