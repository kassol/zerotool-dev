# W6 batch 4 — color-palette-generator fact check (2026-10-27)

Scope: `color-palette-generator` en / zh / ja / ko tool pages and the visible strings of `ColorPaletteGeneratorTool.astro`. Read-only evidence: the `engine:start/end` block, `src/data/persistence.ts`, `src/data/network.ts`, `scripts/test-color-palette-generator.mjs`. FAQ count, ids and order, `steps`, `seoTitle`, the engine block, persistence / network policy, analytics and scripts were not changed.

## Counts

76 statements: 20 FAQ answers, 20 steps, 28 body claims, 8 visible component string groups.

| Result | Statements |
|---|---:|
| Supported | 56 |
| Corrected | 18 |
| Qualified (text unchanged) | 0 |
| Unverified (text unchanged) | 2 |
| **Total** | **76** |

## Corrections

| # | Claim | file:line (en / zh / ja / ko) | Before → after | Evidence |
|---|---|---|---|---|
| 1 | Clearing saved settings | en:24 · zh:24 · ja:24 · ko:24 | The privacy answer said the tool saves three settings but not how to remove them → "clear this site's data; Ctrl/⌘+L empties the color field but keeps the settings" | `ColorPaletteGeneratorTool.astro` writes wheel / value format / code format through `ztPersist`; the shared shortcut clears text fields only (`ToolLayout.astro`). |
| 2 | Base color outside sRGB | en:53 · zh:53 · ja:53 · ko:53 | An out-of-sRGB `oklch()` base was not described → the base is gamut-mapped like the rotated colors, the Base swatch shows the nearest displayable color, and the status line says so | `parseColor` returns `note: 'gamut'`; `update()` prints `noteGamut`; the palette is generated from the mapped 8-bit RGB. |
| 3 | Status line for non-hex input | en:56 | "For anything other than plain hex" → "For a valid input that is not a 6-digit hex value (with or without #)". A 3- or 4-digit hex is plain hex and gets no read-as note | `parseColor` accepts 3 / 4 / 6 / 8-digit hex; `readAs` is emitted only when the original is not 6-digit hex. |
| 4 | OKLCH-wheel wording | en:70 | "With OKLCH values and Tailwind v4 selected" → "On the OKLCH wheel, with OKLCH values and Tailwind v4 selected". The example values are produced only on the OKLCH wheel | Example block in en.mdx; `wheel` setting is persisted separately. |
| 5 | Coolors export claim | en:85 | "the test suite parses each format with css-tree, Dart Sass, Tailwind v4 and JSON.parse" → names what always runs (css-tree, CommonJS v3 config, JSON.parse) and what runs only when the optional toolchain is installed | `test-color-palette-generator.mjs`: Dart Sass / Tailwind cases are SKIP without `PALETTE_TOOLCHAIN_DIR`. |
| 6 | Test description | zh:test paragraph · ja:76 · ko:78 | Same overstatement: tests always compile with Dart Sass and Tailwind v4 → always parse CSS / `@theme` / v3 config / JSON; Sass and Tailwind compile only when installed | Same test conditions. |
| 7 | Material HCT contrast | en:87 | "a tone difference of 50 guarantees 4.5:1" → 4.48:1 at the light end (tones 100 and 50) and 4.68:1 at the dark end (50 and 0) | `material-color-utilities` `hct.ts`: tone is CIE L*; WCAG contrast at L* 100/50 and 50/0. |

## Primary sources (retrieved 2026-10-27)

- CSS Color 4 §14.1.3 / §14.2.2 (gamut mapping, local MINDE, JND 0.02): <https://www.w3.org/TR/css-color-4/>
- WCAG 2.2 contrast minimum: <https://www.w3.org/TR/WCAG22/#contrast-minimum>
- material-color-utilities `hct.ts`: <https://github.com/material-foundation/material-color-utilities/blob/main/typescript/hct/hct.ts>
- Tailwind CSS theme variables: <https://tailwindcss.com/docs/theme>
- Radix Colors scale: <https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale>

## Implementation checks (file:line)

- Seven harmonies and rotations: `ColorPaletteGeneratorTool.astro` `engine:start/end` (schemes table and `generatePalette`).
- Input parsing and notes: `parseColor` / `readAs` / `noteGamut` / `noteAlpha` in the engine block.
- Storage: `ztPersist` keys for wheel, value format and code format; base color never saved.
- Privacy: `persistence.ts` `'color-palette-generator': 'preference'`; no base color in storage; analytics `generate` on change only.

## Unverified

- The 2026-10-01 competitor observations (Coolors, color5.com, colortool.blog, teck-tani.com) were not re-run.
- The Ant Design / Tailwind token values quoted in the body were not re-fetched today; they match the versions named in the page.

## Tests

- `node scripts/test-color-palette-generator.mjs`: 753 passed, 2 skipped (Dart Sass / Tailwind toolchain not set).
- `node scripts/test-tool-content-parity.mjs`: 7753 passed, 0 failed.
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL.
