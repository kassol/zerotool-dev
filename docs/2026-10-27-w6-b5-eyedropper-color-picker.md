# W6 batch 5 — eyedropper-color-picker fact check (2026-10-27)

Scope: the four tool pages (`en` / `zh` / `ja` / `ko`), every visible string in `STRINGS` of `EyedropperColorPickerTool.astro`, `src/data/persistence.ts`, `src/data/network.ts` and the existing regression test. External facts were re-fetched on 2026-10-27 (MDN, MDN browser-compat-data, Microsoft, caniuse; CSS Color 4). Dated competitor observations (2026-10-01) were kept as dated history and not re-run.

A statement is one FAQ answer, one body paragraph / bullet / table row, or one shared visible component string. The same shared component string is counted once, with its four language variants in the JSON. 89 statements: 20 FAQ answers, 53 body claims, 16 component strings. 11 correction groups changed 42 strings (18 MDX strings + 24 component strings). FAQ count / ids / order, steps, seoTitle, `engine:start/end`, persistence, network, analytics and scripts are unchanged.

| Language | Statements | Supported | Corrected | Qualified | Unverified |
|---|---:|---:|---:|---:|---:|
| en | 19 | 14 | 2 | 2 | 1 |
| zh | 18 | 12 | 1 | 3 | 2 |
| ja | 18 | 12 | 1 | 3 | 2 |
| ko | 18 | 12 | 1 | 3 | 2 |
| component (shared, four languages) | 16 | 10 | 5 | 1 | 0 |
| **total** | **89** | **60** | **10** | **12** | **7** |

## Corrections (11 groups, 42 strings)

| # | Location | Before → after | Evidence |
|---|---|---|---|
| 1 | en.mdx:42 | "The OKLCH and Display P3 fields keep the real color." → "The OKLCH field keeps the real color. The Display P3 field is computed from the clipped sRGB value, so it describes `#2b7fff`, not the original chroma." | `formatColor()` uses `srgbToP3(exact)` where `exact` is the clipped 8-bit sRGB color (`EyedropperColorPickerTool.astro:667-676`). Engine run: `oklch(62.3% 0.214 259.815)` → P3 `color(display-p3 0.266 0.491 0.967)` → OKLCH 0.6186 0.2068 259.25, not the input 0.623 0.214 259.81. |
| 2 | component `outOfGamutTyped` (en:61, zh:119, ja:177, ko:235) | "OKLCH and Display P3 keep the real color" → "OKLCH keeps the real color" | Typed `oklch()` has no `color.p3`; the P3 field is derived from clipped sRGB (`:667-676`). `outOfGamutTyped` is the note used for typed colors (`:910`). The image note `outOfGamut` still says OKLCH + P3 because that path has a real P3 readout. |
| 3 | en.mdx:17 · zh.mdx:17 · ja.mdx:17 · ko.mdx:17 | Unconditional "a wide-gamut image is clipped, the tool warns and keeps OKLCH + Display P3" → warning and real P3 value require a Display P3 canvas (Chrome, Edge, Safari); Firefox reads only the clipped sRGB value and cannot warn | `p3ctx` is created only when `getContext('2d', {colorSpace:'display-p3'})` reports `display-p3` (`:1056-1063`); `pixelColor()` keeps the readout only when it is outside sRGB (`:681-688`), and the out-of-gamut note is added only when `color.p3` is set (`:910`). MDN BCD: `options.colorSpace` Chrome 92, Safari 15.2, Firefox false. |
| 4 | en.mdx:73 · zh.mdx:67 · ja.mdx:67 · ko.mdx:67 | "For CMYK, Lab or HSV, convert the HEX in the Color Converter." → "CMYK, Lab and HSV are not supported." | `ColorConverterTool.astro:102-128` has only HEX / RGB / HSL fields; `tools.ts:32` says HEX / RGB / HSL. The old cross-tool advice was false for all three formats. |
| 5 | component `imgScaled` (en:38, zh:96, ja:154, ko:212) | "browser canvas limit 16,777,216 pixels" → "the iOS canvas limit is 4,096 × 4,096, or 16,777,216 pixels" | MDN canvas page: iOS limits the canvas to 4,096 × 4,096; other environments exceed 10,000 × 10,000. `MAX_CANVAS_AREA = 16777216` (`:417`). 16.7 MP is the iOS area, not a universal browser limit. |
| 6 | component `fromImageAvg` (en:59, zh:117, ja:175, ko:233) | "{n}-pixel average around x y" → "average of up to {n} pixels around x y" | `sampleRegion()` clips the block at image edges (`:693-711`); `pick()` sets `at.n = size*size` even when fewer pixels were used (`:1199`). |
| 7 | component `outOfGamut` (en:60, zh:118, ja:176, ko:234) | "clipped to the nearest sRGB value" → "clipped per channel" | `to8()` clamps each channel independently (`:611-613`); per-channel clipping is not a nearest-color gamut map. |
| 8 | component `errFnArgs` (en:51, zh:109, ja:167, ko:225) | "only rgb() and hsl() also take commas" → "only rgb()/rgba() and hsl()/hsla() also take commas" | `splitArgs()` accepts the legacy comma form (`:549-556`) and `legacyOk` includes `rgba` and `hsla` (`:575-581`). |
| 9 | en.mdx:72 · zh.mdx:66 · ja.mdx:66 · ko.mdx:66 | "HEIC opens only in Safari." → "HEIC opens in Safari 17 and later, not in Chrome or Firefox." | caniuse HEIF (fetched 2026-10-27): Safari 17.0+ yes; Chrome 159, Edge 155 and Firefox 161 no; Safari 16.6 no. |
| 10 | en.mdx:66 | "This tool reads full-resolution pixels" → "This tool reads image pixels at native resolution up to its 16,777,216-pixel cap" | `fitImageSize(w, h, MAX_CANVAS_AREA)` (`:1055`) downscales images above the cap (`:712-720`); the old absolute claim contradicted the Limits bullet. |
| 11 | en.mdx:23 · zh.mdx:23 · ja.mdx:23 · ko.mdx:23 and component `recentNote` (en:65, zh:123, ja:181, ko:239) | "last 16 picked HEX values" / "last 16 picks" → "last 16 distinct picked HEX values" / "last 16 distinct picks" | `pushRecent()` deduplicates by hex string (`:699-708`); `ztPersist.save` stores only `recent` and `sample` (`:848-880`). |

## Verified against code (file:line)

- EyeDropper is used only through `new window.EyeDropper()`; the button is hidden and `Open image` becomes primary when `typeof window.EyeDropper !== 'function'` (`EyedropperColorPickerTool.astro:928-1000`). The FAQ's Chrome / Edge 95+, Opera 81+ and Linux Wayland note matches MDN BCD `api/EyeDropper.json` (Chrome 95; Opera mirrors Chrome; not on Linux Wayland; ChromeOS before 120 unavailable).
- `open()` is called after a click; `NotAllowedError`, `InvalidStateError`, `AbortError` and `OperationError` map to the four messages (`:540-546`, `:1007`). MDN `EyeDropper.open()` confirms transient user activation, one `sRGBHex` per call, and those four rejection names.
- The image is drawn into an sRGB canvas and, when available, a second `display-p3` canvas (`:1046-1062`); `pixelColor()` keeps the P3 readout only when it is outside sRGB (`:681-688`). The P3 support versions are MDN BCD: Chrome 92, Safari 15.2, Firefox false.
- Sampling: the loupe is 11 × 11 (`:1170-1210`); `sampleRegion()` clips the block at image edges (`:693-711`), weights RGB by alpha, and returns `[0,0,0,0]` when the block is fully transparent. The `3 × 3` stripe result `rgb(85, 0, 170)` is a hand-built fixture (`scripts/test-eyedropper-color-picker.mjs:322`).
- Storage: `persistence.ts:25` is `preference`; `savePrefs()` writes only `{ recent, sample }` (`:848-880`); `recentClear` writes `recent: []` (`:1310`); Ctrl/⌘+L calls `clearAll()` but does not touch prefs (`:1317-1323`), and `ToolLayout.astro:239-247` makes `ztPersist.clear` a no-op for `preference`. The privacy answer and `recentNote` match.
- Analytics: `track()` calls `trackTool('eyedropper_color_picker', action)` (`:827`); actions are `screen_pick`, `image_pick`, `image_open`, `native_pick`, `recent_apply`, `copy_hex` / `copy_rgb` / `copy_hsl` / `copy_oklch` / `copy_p3` (`:885`, `:1007`, `:1033`, `:1088`, `:1201`, `:1321`). No color or image is sent. The page is not in `network.ts`; GA4 / AdSense load because it is not a `disabled` tool.
- Formatting: `formatColor()` writes HEX / RGB / HSL / OKLCH / P3; `shortest()` chooses the fewest decimals that read back to the same 8-bit color (`:615-633`); the tests read back 636,056 grid colors with the tool parser and 30,000 random colors with culori (`test:239-263`). The tool's `#1a73e8` HSL `hsl(214.1, 81.7%, 50.6%)` and rounded `hsl(214, 82%, 51%)` → `#1c74e9` match `test:231-236`.
- Canvas size: MDN says iOS limits to 4,096 × 4,096; `MAX_CANVAS_AREA` is 16,777,216 (`:417`), but the cap is applied to total area only (`:712-720`). See “Found problems”.
- CSS Color 4: §3.4 is “Color Space of Tagged Images” and §3.5 is “Color Spaces of Untagged Colors”; §3.5 says untagged images must be treated as sRGB. The section numbers are correct.
- Privacy: the component has no `fetch` / XHR / storage direct calls; the test asserts no network, no `localStorage` / cookie, and no HTML writes (`test:365-369`). `network.ts` has no entry for the slug.

## Sources fetched (2026-10-27)

- MDN `EyeDropper.open()` — sRGBHex is `#aabbcc` in sRGB; transient user activation; NotAllowed / InvalidState / Abort / Operation rejections.
- MDN `EyeDropper_API` — user-intent and privacy measures; no pixel without a click.
- MDN BCD `api/EyeDropper.json` — Chrome 95; Opera mirrors Chrome; Firefox / Safari false; ChromeOS before 120; Linux X11 only, not Wayland.
- MDN BCD `api/HTMLCanvasElement.json` — `options.colorSpace`: Chrome 92, Safari 15.2, Firefox false.
- MDN HTML canvas element — iOS 4,096 × 4,096; other environments over 10,000 × 10,000.
- Microsoft “Use Snipping Tool to capture screenshots” — PrtSc places an entire-screen snapshot on the clipboard; Windows logo key + Shift + S opens Snipping Tool.
- caniuse `heif.json` — Safari 17.0+ only; Chrome / Edge / Firefox no.
- CSS Color 4 (drafts.csswg.org) — §3.4 tagged images, §3.5 untagged images must be sRGB.

## Unverified (unchanged, marked in JSON)

- zh WeUI 2.6.26 `--weui-BRAND: #07c160`; WeChat `app.json` `navigationBarBackgroundColor` is HexColor with `#ff00ff` example — package / documentation not re-fetched today.
- ja DADS `@digital-go-jp/design-tokens` 2.0.1 Blue-900 `#0017c1`, Yellow-300 `#ffd43d`, focus ring Yellow-300 + black — docs / package not re-fetched today.
- ko KRDS `krds-uiux` 1.1.0 `primary-50 #256ef4`, `primary-60 #0b50d0` — docs / package not re-fetched today.
- macOS Chromium `skia_utils_mac.mm` / `CGColorRefToSkColor` conversion to sRGB and 8 bits — linked source not re-fetched today; MDN confirms only that `sRGBHex` is sRGB.
- PowerToys Color Picker Win+Shift+C copies HEX by default; Apple screenshot shortcut / Digital Color Meter pages — not re-fetched today (the Microsoft PrtSc sentence was).
- MDN BCD 8.1.3 dated 2026-09-24 — the current BCD main was used; the exact package version / date was not checked.

## Found problems (out of scope; not changed)

- **A — iOS canvas cap is area-only.** `MAX_CANVAS_AREA = 16777216` (`EyedropperColorPickerTool.astro:417`) is checked against `w * h` only (`:712-720`). A 5000 × 3000 image (15,000,000 px) is not scaled but exceeds the 4,096 px side limit MDN gives for iOS; an extreme image above the area cap can also scale to a side above 4,096 (20,000 × 1,000 → about 18,260 × 913). On iOS the canvas may be unusable, which contradicts the Limits rationale. Not reproduced on iOS hardware; derived from MDN and the code path. Suggested fix: also scale until `w <= 4096` and `h <= 4096`, with a regression on `fitImageSize(5000, 3000, MAX_CANVAS_AREA)`.
- **C — ChromeOS is omitted.** MDN BCD says EyeDropper is unavailable on ChromeOS before Chrome 120; the browser table's “Chrome, Edge (desktop) 95+” has no ChromeOS row, and `screenNone` / the FAQ say desktop Chrome only. The copy is not false for Chrome/Edge on desktop, but the coverage is incomplete. Add a ChromeOS note in a later edit.

## Tests

- `node scripts/test-eyedropper-color-picker.mjs` — 4,312 passed, 0 failed.
- `node scripts/test-tool-content-parity.mjs` — 141 tools, 7,753 passed, 0 failed.
- `node scripts/audit.mjs --quiet` — 24 PASS, 0 WARN, 0 FAIL.

No `npm run build` was run. `seoTitle` was reviewed and not changed; the four are within the local length limit and contain no contradicted factual claim.
