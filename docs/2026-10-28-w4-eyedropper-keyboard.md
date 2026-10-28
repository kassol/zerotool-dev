# eyedropper 键盘取样复测（2026-10-28）

## 结论

`eyedropper-color-picker` 的图片像素取样可以用键盘完成，批次 G 记的「画布 `tabIndex` −1，没有键盘光标」不成立。W4 改判为通过，未改代码。

## 实现依据

`src/components/tools/EyedropperColorPickerTool.astro`：

- 画布 `#ecp-canvas` 带 `tabindex="0"` 与四语 `aria-label`（约 300 行）。
- `keydown` 处理（约 1279–1295 行）：方向键移动 1 个图片像素，Shift+方向键 10 个，Enter / Space 取色，Escape 关闭放大镜。
- 首次按方向键把取样点放在图片中心，之后才按方向移动；只按一次方向键时看起来没动，这是批次 G 可能误判的原因。

## 实测

- 浏览器：ego-browser（Ego Lite 2.1.0，Chromium 内核），生产页 `https://zerotool.dev/tools/eyedropper-color-picker/`。
- 输入：2 × 2 PNG，像素为红 / 绿 / 蓝 / 白（98 字节）。
- 步骤与结果：
  1. 载入图片后，`#ecp-canvas` 存在、可见、`tabIndex` 为 0。
  2. `focus()` 后 `document.activeElement` 为 `ecp-canvas`，`aria-label` 说明方向键与 Enter。
  3. 第一次 ArrowLeft：取样点初始化到中心（白，75% / 75%），放大镜出现。
  4. 第二次 ArrowLeft：取样点移到 25% / 75%（蓝）。
  5. Enter：HEX 变为 `#0000ff`，RGB 为 `rgb(0, 0, 255)`，焦点仍在画布。
- 没有使用指针事件；文件通过 `setInputFiles` 进入页面，等价于键盘在文件对话框选择文件。

## 影响

- 矩阵 W4：通过 36 → 37，证据不足 4 → 3。
- 剩余 3 个为外部限制：`protobuf-to-json` 1 / 6、`color-palette-generator` 2 / 10、`qr-code-generator` 2 / 10（只认 PNG）。
- 未新增产品代码，不需要新功能发布；复测随本批文档提交。
