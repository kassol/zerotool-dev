# W6 batch 7 — svg-optimizer fact-check (2026-10-27)

Scope: 177 claim units — 5 FAQ answers, 6 steps, 25 / 22 / 21 / 21 body claims (en / zh / ja / ko), and 11 visible component statements per language (6 toggletips, 5 fact-bearing notes). Files: `src/content/tools/svg-optimizer/{en,zh,ja,ko}.mdx`, `src/components/tools/SvgOptimizerTool.astro`, `src/data/persistence.ts`, `src/data/network.ts`. No FAQ count, id or order, step, `seoTitle`, `seoDescription`, engine block, persistence/network entry, analytics call or script changed.

## Counts

| Result | Statements |
|---|---:|
| Supported | 127 |
| Corrected | 34 |
| Qualified (text kept) | 12 |
| Unverified (text kept) | 4 |
| **Total** | **177** |

| Language | Units | Corrected | Qualified | Unverified | Supported |
|---|---:|---:|---:|---:|---:|
| en | 47 | 10 | 3 | 1 | 33 |
| zh | 44 | 7 | 3 | 0 | 34 |
| ja | 43 | 8 | 3 | 0 | 32 |
| ko | 43 | 9 | 3 | 3 | 28 |

One FAQ answer counts as one unit; the sentences inside it were checked individually. Body units are paragraphs, list items and table rows. The 11 visible units are the six toggletips plus `fixXmlns`, `idsGone`, `classesGone`, `scriptsKept` and `larger`.

## Corrections (34 units)

| # | Claim | file:line (en / zh / ja / ko) | Before → after |
|---|---|---|---|
| 1 | Cause of the Korean flag growing | en 23, 69; zh 23; ja 23, 75; ko 23 | `convertTransform` → `convertPathData`, and "writes the rotate() into the path coordinates" → "applies the rotate() to the path coordinates"; the docs link changed to `convertPathData`. Measured with the bundled 4.1.0: default 816 bytes, `convertTransform: false` 816 bytes, `convertPathData: false` 581 bytes with `rotate(...)` left in place, so the growth comes from `convertPathData`'s `applyTransforms` (`node_modules/svgo/plugins/convertPathData.js:75-76`), not from `convertTransform`. |
| 2 | Dropping a whole folder | en 93; zh 81; ja 97; ko 68 | "a folder's worth" / "一整个图标文件夹" / "アイコンのフォルダ" / "아이콘 폴더를 통째로" → many files at once. The drop handler reads `e.dataTransfer.files` only (`SvgOptimizerTool.astro:2307`), and the file input has `multiple` but no `webkitdirectory` (`:523`); a dropped directory is a non-SVG File and is skipped. |
| 3 | "you can leave such files out of the ZIP" | en 69 | Removed. `#svgo-zip` packs every item with `data != null` (`SvgOptimizerTool.astro:2254`); there is no per-file exclusion, so the sentence now says the ZIP includes every result and the original should be kept where the larger result matters. |
| 4 | 10 MB comparison limit | en 116, component 51 / 33; zh 91, 161 / 144; ja 107, 271 / 254; ko 78, 381 / 364 | "Files over 10 MB are not compared" → "files or results over 10 MB". `renderCheck()` skips when either `item.before` or `item.after` exceeds `CHECK_MAX_BYTES` (`SvgOptimizerTool.astro:2060`), and `item.after` is the optimized output (`:1979`). |
| 5 | viewBox and CSS size (ko) | ko 20 | "CSS로 크기를 바꿀 수 없고" (cannot change the size with CSS) → "CSS로 크기를 바꿔도 내용이 함께 확대·축소되지 않고" (the content does not scale). Without a viewBox the element box can still be resized, but the drawing does not scale; the other three languages already said "scale". |
| 6 | Low precision is always visible in the comparison | zh 71; ja 86; ko 58 | "the comparison will mark it" → "may mark it". The `lowPrecision` note is always added at 0–1 decimal places (`SvgOptimizerTool.astro:1533`), while the pixel verdict only differs when pixels actually move (`:1560-1578`). |
| 7 | minifyStyles moves one-off classes | en 77; ko 54 | Split into `inlineStyles` (moves a one-off class rule into a `style` attribute, so the class attribute disappears) and `minifyStyles` (minifies `<style>` and can remove CSS rules the file does not use). `minifyStyles` never moves class rules into attributes (`node_modules/svgo/plugins/minifyStyles.js:36-42`; `inlineStyles.js`). |
| 8 | removeScripts and `<foreignObject>` | en 88; zh 76; ja 92; ko 63 | "HTML inside `<foreignObject>`" → event-handler attributes, `srcdoc` and executable URLs inside it. The 4.1.0 release notes list exactly those three groups, keeping non-executable HTML; the old wording implied that all HTML is removed. |
| 9 | ZIP names (en) | en 93 | Added that a `.svgz` is saved as `.svg`, matching `outputName()` (`SvgOptimizerTool.astro:1610-1612`) and the other three languages. |

## Primary sources (retrieved 2026-10-27)

- SVGO migration v3 → v4 — `removeViewBox` and `removeTitle` are no longer in `preset-default`: <https://svgo.dev/docs/migrations/migration-from-v3-to-v4/>
- SVGO v4.1.0 release notes — `removeScripts` hardening: executable `data:` / `vbscript:` URLs filtered, `<foreignObject>` event handlers / `srcdoc` / `action|data|formaction|href|src` sanitized, namespaced `<a>` recognised and ASCII tabs/newlines removed before the scheme check (`java&#9;script:`): <https://github.com/svg/svgo/releases/tag/v4.1.0>
- Bundled first-party code: `node_modules/svgo/plugins/preset-default.js` (34 plugin entries), `lib/svgo.js:88` (`multipass` = 10 passes), `plugins/removeScripts.js`, `plugins/removeViewBox.js`, `plugins/removeDimensions.js`, `plugins/minifyStyles.js`, `package.json:36` (`^4.1.0`, installed 4.1.0).

## Implementation checks (file:line)

- 34 `preset-default` plugins and 13 optional built-ins: `SvgOptimizerTool.astro:1300-1316`; the panel prints `PRESET_PLUGINS.length` (`:602`), so the "34 plugins" copy in the steps and the toggletip is live data.
- 50 MiB per file and 10 MiB comparison ceiling: `SvgOptimizerTool.astro:1324-1332`; the rendered check skip is at `:2060`.
- Multipass default and 3 decimals: `:1340`, `:1323`; SVGO caps multipass at 10 passes (`node_modules/svgo/lib/svgo.js:88`).
- Settings persistence: `ztPersist` with policy `preference` (`src/data/persistence.ts:23`); save/load at `SvgOptimizerTool.astro:1796`, `:1809`; no input is saved, no fetch/XHR/storage call in the script (test `:809-811`).
- Analytics: one `optimize` per committed run with a result (`:1895`), `download` (`:2243`), `copy` only after a successful copy (`:2250`), `zip` (`:2259`). `BaseLayout.trackTool` sends tool name and action only.
- Drop/paste/file loading: `:2298-2321`; `.svgz` gunzip at `:1912-1915`; `skipped` note for non-SVG files at `:1930`, `:2018`.
- Rendering comparison: 400 px long side (`:1326`, `:1551-1555`), threshold 24/255 on premultiplied channels and alpha (`:1559-1573`), 0.1% same / 1% minor (`:1331-1332`, `:1575-1579`), skip above 10 MiB (`:2060`), previews are `<img>` blob URLs (`:2047-2056`).
- Notes: `inspect()` at `:1508-1537`; ID/class disappearance, viewBox/size/title, scripts, external references and raster size are all read from before/after markup (`collectInfo`, `:1451-1498`).
- Config export and CLI equivalence: `configSource()` `:1386-1415`; the test writes ten generated configs and runs `node_modules/svgo/bin/svgo.js` (`scripts/test-svg-optimizer.mjs:234-259`).
- JSX refusal path: `tryFormatOutput()` `:1636-1641`; refusal disables Copy for that item only (`:2246-2249`), downloads and ZIP use `item.data`.

## Tests

| Command | Result |
|---|---|
| `node scripts/test-svg-optimizer.mjs` | 502 passed, 0 failed, 1 skipped (React reference not installed); exit 0 |
| `node scripts/test-tool-content-parity.mjs` | 7,753 passed, 0 failed (141 tools); exit 0 |
| `node scripts/audit.mjs --quiet` | PASS 24, WARN 0, FAIL 0; exit 0 |

`node scripts/test-svg-optimizer.mjs` recomputes all `svgo-check` examples: Figma 512 → 254 B (gzip 314 → 196), ECharts 3,553 → 2,452 B (gzip 852 → 690), Illustrator 373 → 209 B, Korean flag 589 → 816 B (and 603 B at 1 decimal), KRDS calendar 1,150 → 513 B (gzip 505 → 290), KRDS file 1,167 → 477 B and 670 B at 4 decimals, and the limits example `<svg><rect></svg>` at line 1, column 17.

## Qualified (text kept)

- Privacy FAQ (all four): "SVGO runs in a Web Worker" — the page uses a Web Worker and falls back to the main thread if the worker cannot be created (`scripts/test-svg-optimizer.mjs:561-574`); both paths stay in the tab and upload nothing. "Only the settings are saved" matches `persistence.ts:23` and the absence of `ztPersist` calls for input. The analytics list omits that the row download buttons do not call `trackTool`; only the main Download, Copy and ZIP buttons do.
- Competitor paragraphs (all four): the 2 October 2026 observations (SVGOMG 4.0.0, one file, no xmlns fix, 128.66% gzipped Korean flag; Vecta Nano 10 files × 5 MB; svgoptimizer.com, iLoveIMG, MiniWebtool) were not re-run. They stay dated.
- Rendering threshold (all four): "a color channel or the opacity differs by more than 24 of 255" is a readable simplification. The code compares premultiplied channels and alpha, so two fully transparent pixels with different hidden RGB values count as equal (`SvgOptimizerTool.astro:1557-1573`).
- 50 MB / 10 MB are binary limits in code (50 × 1024 × 1024 and 10 × 1024 × 1024 bytes) and are written as MB in the UI, the error strings and the pages; kept consistent rather than changing only the MDX.

## Unverified (text kept, measurement dated)

- ko 42: 91 KRDS icons, 121,742 → 64,530 bytes (−47.0%), no file larger. The aggregate was not recomputed because `krds-uiux` is not installed; the individual calendar and file fixtures are recomputed by the test.
- ko 48: 0.57% changed pixels for `ico_file.svg` at 400 px, measured with sharp/librsvg, and 4 of 91 icons with small differences. The fixture's `minor` verdict is recomputed; the exact percentage and the count of four are the dated 2026-10-02 measurements.
- en 111: Vecta Nano "up to 10 files of 5 MB" is a dated observation and was not re-tested today.

## Left unchanged (open items)

- `SvgOptimizerTool.astro:33` previously said only "Larger than 10 MB"; it now says "file or result", matching `:2060`. No other UI string names a limit.
- The `sizeGone` note says an inline `<svg>` without width/height "fills the available width" (`:109`). This matches Chromium's default sizing but was not re-measured in this audit.
- The `classesGone` note tells the reader to untick `inlineStyles` and `minifyStyles` (`:107`). That keeps all class rules, but only `inlineStyles` moves a one-off rule into a `style` attribute; the table and the ko list now distinguish the two plugins.
- The page still says "SVGO 4 took removeTitle and removeViewBox out of the default preset"; the migration guide confirms both were removed in v4.0.0.
- The XML error example is built on sax 1.6.1 (`Invalid character entity` for `&#1;` etc. since SVGO 4.1.0); the page does not claim anything about numeric character references. Not extended in this batch.
