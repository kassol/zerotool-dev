# W6 batch 6 — css-clip-path-generator fact-check (2026-10-27)

Scope: 104 claim units — all 5 FAQ answers and 5 steps per language, the body claims about basic shapes, `path()` / `shape()` / `rect()` / `xywh()`, geometry, units, hit testing, browser support, storage, privacy, analytics and limits, the dated 2026-10-03 competitor numbers, and the 8 visible component tips. Files: `src/content/tools/css-clip-path-generator/{en,zh,ja,ko}.mdx`, `src/components/tools/CssClipPathGeneratorTool.astro`, `src/data/persistence.ts`, `src/data/network.ts`. No FAQ count, id or order, step, `seoTitle`, `seoDescription`, engine block, persistence/network entry, analytics call or script changed.

## Counts

| Result | Statements |
|---|---:|
| Supported | 70 |
| Corrected | 16 |
| Qualified (text unchanged) | 18 |
| Unverified (text unchanged) | 0 |
| **Total** | **104** |

## Corrections (4 groups × 4 languages = 16)

| # | Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|---|
| 1 | Slider ranges in the geometry tip | component 169 / 181 / 193 / 205 | "radii use 5–100%, inset edges use 0–49%" → "radii use 0–100%, inset edges use 0–100%". The init block rewrites `min="5"` to `0` and `max="49"` to `100` (`CssClipPathGeneratorTool.astro:1074-1078`), so the copy described the markup, not the sliders the reader gets. Centers 0–100% and corner radius 0–50% were already right. |
| 2 | Animation condition | en/zh/ja/ko 17-19 (answer) | "both values use the same shape function" → add "and the same reference box". CSS Shapes 1 §3.4 requires "Both shapes must use the same reference box" before any interpolation; the answer could promise a morph for two identical polygons that differ only in `border-box` / `content-box`. |
| 3 | MDN BCD version in the `-webkit-clip-path` answer | 22 / 22 / 22 / 22 | "MDN browser compatibility data 8.1.4" → 8.1.7. The current BCD release is 8.1.7, and the three versions (Chrome 55, Firefox 3.5, Safari 9.1) are unchanged in it. |
| 4 | MDN BCD version in Limits | 74 / 84 / 90 / 88 | 8.1.4 → 8.1.7. `shape()` 135 / 148 / 18.4 and `rect()` / `xywh()` 119 / 122 / 17.2 were re-read in 8.1.7 and are unchanged. `inset()` reduction (70% + 50% → 58.33% / 41.67% / 0px) matches the spec example `inset(75% 0 50% 0)` → `inset(60% 0 40% 0)`. |

## Primary sources (retrieved 2026-10-27)

- MDN BCD 8.1.7, `clip-path` (`chrome 55 / firefox 3.5 / safari 9.1`): <https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/clip-path.json>
- MDN BCD 8.1.7, `basic-shape` (`shape` 135 / 148 / 18.4; `rect` and `xywh` 119 / 122 / 17.2; reference boxes 119 / 54 / 13): <https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/types/basic-shape.json>
- CSS Shapes Level 1 — direction-agnostic size = diagonal ÷ √2 (§3.1), `inset()` proportional reduction (§3.1), `path()` implicitly px-only and `shape()` units/math (§3.1.1), interpolation needs the same reference box, function, vertex count and fill rule (§3.4): <https://drafts.csswg.org/css-shapes-1/>
- CSS Masking Level 1 — border-box is the default reference box; `clip-path` affects hit testing and no pointer events are dispatched outside the clipping region; the clipped paint list includes outline (§5): <https://drafts.csswg.org/css-masking-1/>

## Implementation checks (file:line)

- Five tabs and five presets: `CssClipPathGeneratorTool.astro:228-232`, `452-458`.
- Circle radius uses the direction-agnostic size: `745-751` (`hypot(w, h) / SQRT2`).
- Inset reduction per axis: `759-781`; `buildClipPath()` output: `704-734`.
- Raw-value gate (only shapes / boxes / `none`; rejects `url()`, `var()`, `env()`, comments, escapes, `;`, `{}`; unclosed bracket or quote): `824-844`; diagnostics and character positions: `846-1011`.
- Analytics: the wrap `change` listener fires `generate` only when `update()` succeeded (`1013-1015`); `trackTool` sends `tool_name` + `tool_action` only (`BaseLayout.astro:207-212`); drag and arrow keys never fire `change` (`623-652`).
- Storage: the slug is absent from `src/data/persistence.ts`, and the component contains no `ztPersist`, `localStorage`, `fetch` or XHR call, so the privacy answer's "not uploaded or saved" holds even though the default policy is `input`.
- Ctrl/⌘+L path: `ToolLayout.astro:362-374` clears the textarea; the component re-runs `update()` at `1041-1045`, which empties the code block and disables Copy.
- Visible reference boxes: `.cpg-framed` 12px border + 16px padding and the three dashed guides at `1190-1200`.

## Tests

| Command | Result |
|---|---|
| `node scripts/test-css-clip-path-generator.mjs` | 302 page checks passed, 0 failed; 22 recomputed page examples, 145 Chrome-accepted values, 49,718 hit-test points, 29 raw values; exit 0 |
| `node scripts/test-tool-content-parity.mjs` | 7,753 passed, 0 failed (141 tools); exit 0 |
| `node scripts/audit.mjs --quiet` | PASS 24, WARN 0, FAIL 0; exit 0 |

## Qualified (text kept) and open items

- Competitor comparison: kept as the dated 2026-10-03 observation (whole-percent rounding, `div` handles without a tab stop, no `path()` / `shape()` / `rect()` / `xywh()` / reference box, 27 / 18 / 14 / 16 presets against 5 here). Not re-tested today.
- The Chrome `CSS.supports('clip-path', 'polygon(50% 0%, 100% 100%')` → true observation is the recorded Chrome 152 fixture (`scripts/test-css-clip-path-generator.fixtures.json`), not a new browser run; the stylesheet half (`sheetKeeps: false`, next rule broken) is in the same fixture.
- The zh/ja/ko `document.elementFromPoint()` 155px / 162px numbers were not re-measured; they agree with the 158.11px radius and CSS Masking §5 hit testing.
- Limits still list only `shape()` / `rect()` / `xywh()` support. BCD also dates reference-box keywords (border-box, padding-box, content-box, margin-box) to Chrome 119, Firefox 54 and Safari 13, so a Chrome 118 reader sees the `inset(10% round 16px) content-box` example refused with no support note. Not added in this batch.
- The `-webkit-clip-path` answer cites the `clip-path` row (Firefox 3.5), the property's lower bound; BCD `basic_shape` lists Firefox 54, so SVG property support and HTML basic shapes are not distinguished. Not changed.
- `box-shadow` clipping is browser behaviour: CSS Masking §5 lists outline but not shadow, and no browser run was made today.
