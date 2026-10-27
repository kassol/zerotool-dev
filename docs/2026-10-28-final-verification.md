# 收尾验证（2026-10-28）

基线：`v1.142.6`（`6d576de1`），矩阵与最后一轮文档提交 `24bc7603`。本轮覆盖 backlog #29 的两条 CSS 事项、W6 全部 40 个工具、W4 的 ZeroTool 任务与移动视口、W3 的负载门尝试，以及作品级矩阵更新。

## 静态与构建

| 检查 | 结果 |
|---|---|
| `node scripts/audit.mjs` | 24 PASS / 0 WARN / 0 FAIL |
| `npm run build` | 通过；564 个工具页 CSS 顺序检查通过；845 个 HTML；9 个 CSS chunk 重命名为 site / article / adunit / tool-shared / not-found |
| `git diff --check` | 无输出 |

## 全部测试脚本

- 170 个 `scripts/test-*.mjs`。
- 第 1 次全量运行：169 通过；`test-tool-categories.mjs` 因全站 `:root` 从 `BaseLayout.astro` 移到 `src/styles/site.css` 读取失败。测试改为读 `site.css` 后 232 项通过。
- 第 2 次全量运行：169 通过；`test-jwt-decoder.mjs` 以退出码 139（SIGSEGV）中止，单独重跑 1,914 项通过、退出码 0。按一次瞬时进程崩溃记录，不当作产品失败。
- 两次运行都没有断言失败（FAIL）或超时；`SKIP` 仍为工具链缺失或版本不匹配的既有项。

## 本轮产品改动

1. **CSS 顺序与命名（backlog #29）**：全站样式移入 `src/styles/site.css`，工具页顺序固定为 site → 共享工具 → 本工具；`check-tool-css-order.mjs` 检查全站样式位置与命名；`rename-css-chunks.mjs` 在构建后按引用页面重命名 chunk；新增/更新测试 33 + 27 项。
2. **W6 内容核对 40 / 40**：八批共 4,503 条陈述，supported 3,064、corrected 773、qualified 428、unverified 238。逐工具证据见 `docs/2026-10-27-w6-batch-{3..8}.md` 与 `docs/2026-10-25-w6-statements.json`（第 1 批）。
3. **htpasswd 文件检查**：第三字段存在且密码匹配时追加四语 Apache 无法登录说明，回归 1,578 项通过。
4. **zero-width 工具卡描述**：去掉「emoji 不会被拆坏」的绝对说法。

## 覆盖缺口

- **W4**：40 个 ZeroTool 真实任务与 390 × 844 移动布局检查完成；5 个工具完成前三竞品点击对照，8 个部分完成，27 个未做竞品对照；4 个有键盘路径记录，同时具备两项的只有 text-to-binary 与 url-parser。W4 总体仍为证据不足。
- **W3**：本机 load average 19.89 / 22.42 / 17.11，均高于 10，未接纳任何样本；Windows 远程大文件的文件选择授权仍等 Sir，试跑 0/18。见 `2026-10-27-w3-local-load-gate.md`。
- **CrUX / INP**：现场数据仍为 No Data；TBT 不能替代 INP。
- **Sir 走查**：未进行。

## 发布

- `v1.142.2`：CSS 顺序与 chunk 命名。
- `v1.142.3`：W6 第三批 + zero-width 工具卡描述。
- `v1.142.4`：W6 第四批。
- `v1.142.5`：W6 第五、六批 + htpasswd 第三字段说明。
- `v1.142.6`：W6 第七、八批。
- 矩阵与最终文档为 `24bc7603`，不另打 tag。

未提交 AdSense 重提，也未宣告作品级全项通过。

## 2026-10-28 补充（W4 批次 C 与 W3 复测）

- W4：38 个工具重测键盘路径与主流程，新增 5 个同时具备 3 / 3 竞品对照与键盘证据的工具（json-formatter、number-base、string-escape、text-to-ascii-art、pkce-generator），W4 通过 7 / 40。`dns-lookup` 因前批把访客 IP 当成 A 记录，降为部分完成；`svg-optimizer` 竞品 3 / 3 但无键盘记录。证据见 `2026-10-28-w4-batch-c.md`。
- W3：采样窗口 load average 11.40 / 11.47 / 10.09，10 个样本全部排除、30 个工具未跑；四个大文件 fixture 不在归档中。W3 仍为 40 个证据不足。见 `2026-10-28-w3-retest.md`。
- audit 24 PASS、build 通过、170 个 `test-*.mjs` 全部退出 0。本轮无用户可见交互改动，未打 tag。
