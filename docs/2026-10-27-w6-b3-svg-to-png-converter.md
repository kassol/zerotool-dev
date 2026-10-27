# W6 batch 3 — svg-to-png-converter fact-check (2026-10-27)

Scope: 106 statements — 34 en, 32 zh, 17 ja, 17 ko MDX claims and 6 shared component-copy claims. Files: `src/content/tools/svg-to-png-converter/{en,zh,ja,ko}.mdx`, visible copy in `src/components/tools/SvgToPngConverterTool.astro`, `src/data/persistence.ts` and `src/data/network.ts`. No engine block, persistence/network policy, analytics call or test was changed.

## Corrections (8 statements, 11 strings)

| Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|
| External-reference list size | en.mdx:20 · zh.mdx:20 · ja.mdx:20 · ko.mdx:20 | “lists every such reference” / “逐条列出” / “一覧表示” / “목록으로” → the list shows up to 3 URLs of each kind plus a count for the rest (`listUrls`, component:943-946) |
| Chrome natural-size exception | en.mdx:30 | “except the viewBox-only row” → “except the two rows without an absolute width and height (viewBox only, and `width="100%"`)”; SVG 2 §8.12 forbids percentages for intrinsic sizing, and the component/test record has Chrome 300 × 150 for both |
| Empty-output check | en.mdx:63 | “A fully transparent result is flagged” → “A fully transparent result of up to 4,194,304 pixels is flagged”; `isBlank` runs only when no background and `w*h <= 4194304` (component:1155) |
| Chinese meta description | zh.mdx:3 | “外部图片与字体问题逐条提示” → “外部图片与字体问题会提示” (same 3-URL cap) |
| Chinese FAQ list wording | zh.mdx:20 | “逐条列出这些引用” → “列出这些引用（每类最多 3 个网址，其余给出数量）” |
| Japanese FAQ list wording | ja.mdx:20 | “一覧表示します” → “一覧表示します（種類ごとに URL は 3 件まで、残りは件数のみ）” |
| Korean FAQ list wording | ko.mdx:20 | “목록으로 보여 줍니다” → “목록으로 보여 줍니다(종류별로 URL 3개까지, 나머지는 개수만)” |
| Letterbox note | component:86 / 167 / 248 / 329 | “centered as its preserveAspectRatio says” and the zh/ja/ko equivalents → “placed as its preserveAspectRatio says (centered by default)”; SVG 2 §8.7 makes `xMidYMid` only the default, while `none` / `xMaxYMin` / `xMaxYMax` are not centered |

## Primary sources (all retrieved 2026-10-27)

- HTML Standard (last updated 2026-10-26), canvas §4.12.5.5: unsupported `type` → PNG; image types without alpha are composited onto an opaque black background; §4.12.5.1.9: canvas uses the default image of an animated image, or its first frame when there is no default image: <https://html.spec.whatwg.org/multipage/canvas.html>
- MDN `<canvas>` (last modified 2026-04-24), “Maximum canvas size”: iOS devices cap at 4,096 × 4,096: <https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas>
- Chromium `third_party/blink/renderer/core/html/canvas/canvas_rendering_context_host.cc` lines 138-145: `kMaxCanvasArea = 32768 * 8192` (268,435,456) and a 65,535 px side cap: <https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/html/canvas/canvas_rendering_context_host.cc>
- CSS Values and Units Level 4 §6.2: 1in = 96px, 1cm = 96px/2.54, 1mm = 1/10 cm: <https://www.w3.org/TR/css-values-4/#absolute-lengths>
- SVG Integration §3.4 (secure animated mode): script execution no, external references no, declarative animation yes; the animated image document mode applies to `<img>`: <https://www.w3.org/TR/svg-integration/#secure-animated-mode>
- SVG 2 §8.7 `preserveAspectRatio` (default `xMidYMid`; `none` scales independently) and §8.12 (percentages must not determine intrinsic width/height): <https://www.w3.org/TR/SVG2/coords.html>
- GitHub Docs, social media preview: PNG/JPG/GIF under 1 MB, at least 640 × 320, 1280 × 640 for best display: <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview>
- WeChat Open Docs, “上传发表内容中的图片” (last edited 2026-03-10): jpg/png only, under 1 MB: <https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage.html>
- LINE Creators Market sticker guidelines: PNG, sticker max 370 × 320, main 240 × 240, tab 96 × 74, even sizes, transparent background, 1 MB each: <https://creator.line.me/ja/guideline/sticker/>
- Naver Help, “사진 첨부 방법”: JPG/GIF/PNG/BMP/WEBP, 20 MB per photo, English/number filenames recommended: <https://help.naver.com/service/5593/contents/15468>

## Implementation checks (file:line)

- Size and limits: `SvgToPngConverterTool.astro:478-547` (`intrinsicSize`), `558-576` (`planOutput`), `470` (`MAX_SIDE = 65535`), `549-554` (`wholeNumber`), `574` (`tooLarge`), `1099-1107` (`canvasUsable`).
- SVG preparation: `688-727` (`analyzeSvg`: xmlns/xlink, external refs, foreignObject), `735-769` (`buildSvg`: width/height, viewBox, external image href removal), `959-1024` (XML reason mapping).
- Export: `771-775` (`backgroundFor`, JPEG white), `1155` (blank check only when no background and `w*h <= 4194304`), `1156-1160` (`toBlob` and `formatFallback`), `781-787` (`outputName`), `1295-1304` + `834-904` (ZIP as `svg-to-png.zip`).
- Analytics: `1067-1084` (track flags: `input` events false, `change`/chips/mode true), `1307-1326` (`load` → `run(true)` for files, paste and Convert), `1203-1207` (`trackTool` only when `track`, at least one success and a new result key); `BaseLayout.astro:207` sends only `tool_name` and `tool_action`.
- Privacy: the component has no `ztPersist` / localStorage / fetch / XHR / beacon; `persistence.ts:10` does not list this slug (default `input`, but no calls), `network.ts:5` does not list it, `ToolLayout.astro:42` computes `sensitive = false`, so `BaseLayout.astro:140/185` load AdSense/GA4.
- Sharp section: local run 2026-10-27 with sharp 0.34.5 / librsvg 2.61.2 / vips 8.17.3: default 24 × 24, `density: 288` → 96 × 96, `resize(512, 512)` → 512 × 512.

## Unverified (unchanged)

- Competitor comparisons: en.mdx:68-77, zh.mdx:51-60, ja.mdx:61-70, ko.mdx:64-73. Dated 2026-09-30 observations; no browser re-run.
- Example byte counts and the 2026-09-30 Chrome 152 dates: en.mdx:46-55, zh.mdx:34-43, ja.mdx:30-39, ko.mdx:30-38. Dimensions and format arithmetic match the engine; byte counts were not recomputed.
- Chrome 152 / Edge `foreignObject` behaviour: en.mdx:83, zh.mdx:66, ja.mdx:76, ko.mdx:79. The tool maps a `SecurityError` to `taintedForeign`; the browser behaviour was not re-tested.
- Component skip note (`en:90`, `zh:171`, `ja:252`, `ko:333`) labels any skipped `.svgz` as “not SVG”; the docs separately state `.svgz` is unsupported. Text left unchanged.

## Tests

- `node scripts/test-svg-to-png-converter.mjs` before edits: 776 passed, 0 failed, exit 0.
- After edits: 776 passed, 0 failed, exit 0. No test asserted the old wording, so no test was modified.
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed, exit 0.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL, exit 0.

Working-tree note: the repository already contained unrelated modified files (BaseLayout, astro.config, package.json and other tools) before this audit; they are not part of this batch.
