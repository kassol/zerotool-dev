# ZeroTool Design System

Last updated: 2026-04-27

This document captures the visual system introduced in the 2026-04-27 redesign. It applies to the home page, tool directory, individual tool pages, shared tool widgets, article typography, and favicon.

## Visual Thesis

ZeroTool is a warm paper workbench for browser-based developer tools. The interface uses low-contrast cream surfaces, clay-brown accents, editorial serif headings, compact controls, and soft depth.

The memorable signals are:

- Warm paper background
- Oversized editorial serif titles
- Soft raised workbench panels
- Category-tinted line icons
- Compact pill controls

## Token Sources

Global tokens live in `src/layouts/BaseLayout.astro`. Shared tool controls live in `src/styles/tool-common.css`. Page-level structure lives in `src/layouts/ToolLayout.astro`, `src/components/ToolDirectory.astro`, and `src/layouts/ArticleLayout.astro`.

New visual work should consume these tokens first:

| Role | Token | Light | Dark |
|---|---|---:|---:|
| Primary action | `--color-primary` | `oklch(49% 0.095 48)` | `oklch(70% 0.105 58)` |
| Primary hover | `--color-primary-hover` | `oklch(43% 0.105 48)` | `oklch(76% 0.11 58)` |
| Accent | `--color-accent` | `oklch(57% 0.09 78)` | `oklch(72% 0.08 90)` |
| Page background | `--color-bg` | `oklch(98.4% 0.009 78)` | `oklch(15% 0.012 65)` |
| Secondary background | `--color-bg-secondary` | `oklch(96.2% 0.011 78)` | `oklch(19% 0.014 65)` |
| Surface | `--color-surface` | `oklch(99.4% 0.006 78)` | token mix |
| Muted surface | `--color-surface-muted` | `oklch(97.1% 0.01 78)` | token mix |
| Body text | `--color-text` | `oklch(22% 0.018 70)` | `oklch(92% 0.011 78)` |
| Secondary text | `--color-text-secondary` | `oklch(43% 0.016 70)` | `oklch(76% 0.012 78)` |
| Muted text | `--color-text-muted` | `oklch(58% 0.014 70)` | `oklch(62% 0.012 78)` |

Raw hex values are reserved for true generated color previews, imported external content, and static brand assets such as `public/favicon.svg`.

## Category Color

Tool cards, related cards, and directory panel items use category tinting through `--category-color`.

| Category | Token |
|---|---|
| Data | `--color-cat-data` |
| Color | `--color-cat-color` |
| Encoding | `--color-cat-encoding` |
| Text | `--color-cat-text` |
| Security | `--color-cat-security` |
| Dev | `--color-cat-dev` |
| API | `--color-cat-api` |
| Image | `--color-cat-image` |

The tint appears in icon wells, hover background mixes, and small category tags. Keep the page chrome warm and neutral while category color helps scanning.

## Typography

Use the three global font roles:

| Role | Token | Usage |
|---|---|---|
| Sans | `--font-sans` | Navigation, controls, labels, body UI |
| Display serif | `--font-display` | Page titles, section headings, editorial leads |
| Mono | `--font-mono` | Inputs, generated code, result values |

Headings use the display serif with strong line-height and balanced wrapping. Controls use sans with 650 to 800 weight. Tool textareas, code blocks, generated values, and technical inputs use mono.

## Radius And Depth

Radius tokens:

| Token | Value | Usage |
|---|---:|---|
| `--radius-sm` | `6px` | Icon buttons, icon wells |
| `--radius-md` | `10px` | Inputs, cards, related rows |
| `--radius-lg` | `14px` | Tool widgets, page panels |
| `--radius-pill` | `999px` | Pills, trust items, primary buttons |

Depth tokens:

| Token | Usage |
|---|---|
| `--shadow-subtle` | Small controls and icon wells |
| `--shadow-card` | Repeated cards |
| `--shadow-card-hover` | Hover lift on clickable cards |
| `--shadow-panel` | Main workbench panels |

Surfaces use a background step, a soft shadow, and `outline: 1px solid var(--color-border-soft)` with `outline-offset: -1px`.

## Page Structure

### Home And Tool Directory

`src/components/ToolDirectory.astro` owns the home and tools index experience.

Required structure:

- Editorial hero with a strong ZeroTool first-viewport signal
- Single primary search and filter work area
- Recent or highlighted tools panel as a compact workbench preview
- Tool cards in `repeat(auto-fit, minmax(min(100%, 280px), 1fr))`
- Category-tinted icon wells and hover background mixes

### Tool Pages

`src/layouts/ToolLayout.astro` owns the shared tool page shell.

Required structure:

- `.tool-page`: `width: min(100% - 2rem, 1120px)`
- `.tool-header`: icon, `ZeroTool Workbench` kicker, title, description, trust bar
- `.tool-widget`: full-width workbench panel for the actual tool
- `.related-tools`: compact related cards below the tool
- `.tool-content`: SEO and usage content with a reading width near 820px
- `.tool-faq`: compact accordion cards

Every tool UI fills the `.tool-widget` width. Use inner grids to create local structure, with `minmax(0, 1fr)` and `min-width: 0` on flexible children.

### Article Pages

`src/layouts/ArticleLayout.astro` owns blog reading pages.

Required structure:

- Reading container near 760px
- Display serif H1 and section headings
- Code blocks with padding, muted background, and transparent nested code spans
- Inline code with muted surface background and wrapping
- Tables with horizontal overflow support

## Shared Components

Use shared button classes from `src/styles/tool-common.css`:

| Class | Usage |
|---|---|
| `.btn-primary` | Main conversion or generation action |
| `.btn-secondary` | Secondary actions |
| `.btn-ghost` | Low-emphasis actions |
| `.btn-copy` | Copy interactions and copied state |
| `.btn-icon` | Symbol-only actions |

Interaction baseline:

- Buttons keep a stable layout footprint.
- Active state uses `transform: scale(0.96)`.
- Hover state changes background or color through tokens.
- Focus state uses `:focus-visible` or token focus rings.

Use shared form classes:

| Class | Usage |
|---|---|
| `.tool-label` | Field labels |
| `.tool-input` | Single-line technical inputs |
| `.tool-textarea` | Multi-line technical inputs |
| `.tool-status` | Success, error, info, and neutral feedback |
| `.tool-result-row` | Generated row output |
| `.tool-result-label` | Row label |
| `.tool-result-value` | Row value |

Native controls inside `.tool-widget` inherit the global form baseline. Range inputs use tokenized tracks, thumbs, and focus states.

## Tool Component Rules

Each tool component stays self-contained in `src/components/tools/{ToolName}Tool.astro` with inline script logic.

Class naming:

- Use a unique slug-derived prefix, such as `csg-` for Color Shades Generator.
- Shared utilities use `tool-*` and `btn-*`.
- Dynamic DOM nodes created by inline scripts need CSS reachability.

Astro scoped CSS handling:

- Use `<style is:global>` when every selector has a unique component prefix.
- Use `:global(.prefix-dynamic-class)` for script-generated nodes when the file contains shared or collision-prone prefixes.

Layout:

- Start with one compact control panel.
- Put generated previews or results in a stable grid.
- Use fixed or responsive grid tracks for repeated items.
- Keep controls and generated output within the `.tool-widget` bounds at 390px mobile width.

Copy behavior:

- Copy buttons use `.btn-copy`.
- Clickable swatches and result cards expose `aria-label`.
- Status labels use `aria-live` when feedback changes after user action.

## Color Tool Pattern

Color tools use the warm workbench shell with stronger visual output areas.

Recommended structure:

- Top control panel with color input, text input, and short hint
- Preview ramp or live preview surface
- Results grid with swatches or cards
- Copy action in each result and a grouped copy action where useful

Contrast:

- Color labels over generated swatches compute foreground color from luminance.
- Labels on bright swatches use translucent light backing.
- Labels on dark swatches use translucent dark backing.

Reference implementations:

- `src/components/tools/ColorPaletteGeneratorTool.astro`
- `src/components/tools/ColorShadesGeneratorTool.astro`
- `src/components/tools/CssClipPathGeneratorTool.astro`

## Code And Content Rendering

Code blocks in `ToolLayout` and `ArticleLayout` use:

- `padding: 1rem 1.1rem`
- `border-radius: var(--radius-md)`
- `background: var(--color-bg-secondary)`
- `box-shadow: inset 0 0 0 1px var(--color-border-soft)`

`pre code` uses transparent background and inherited foreground. Syntax highlight spans inside code blocks also use transparent background and inherited foreground. Inline code wraps with `overflow-wrap: anywhere` to protect mobile layouts.

## Dark Mode

Dark mode uses the same token names with warmer, lower-lightness values. Components should rely on tokens so both system dark mode and `[data-theme="dark"]` render correctly.

Checklist for dark mode:

- Page background, surface, muted surface, borders, and text come from tokens.
- Focus rings remain visible on dark surfaces.
- Generated preview colors remain literal user output.
- Copy states, success states, and danger states use semantic tokens.
- Favicon supports `prefers-color-scheme: dark`.

## Routing And Language UX

The site uses trailing slashes. Internal links should include the final slash for language roots and tool pages.

Examples:

- `/zh/`
- `/zh/tools/`
- `/zh/tools/color-shades-generator/`

Language switcher links should preserve the current slug when a localized page exists and fall back to the localized root when needed.

## Favicon

`public/favicon.svg` is part of the design system.

Current favicon requirements:

- Warm paper light-mode background
- Dark warm background via `prefers-color-scheme: dark`
- Clay-brown ZeroTool mark
- Small accent dot in the warm amber range
- Rounded square shape matching the surface radius language

## Visual QA

Run visual checks across:

- Desktop light
- Mobile light
- Desktop dark
- Mobile dark

Baseline viewport sizes:

- Desktop: `1366x900`
- Mobile: `390x844`

Acceptance targets:

- Horizontal overflow delta equals `0`.
- `.tool-widget` fills its available page width.
- Buttons and inputs use tokenized backgrounds.
- Code blocks have visible padding.
- Nested syntax highlight spans inside code blocks have transparent backgrounds.
- Console and page errors count equals `0`.
- Mobile text wraps inside its parent container.
- Dynamic DOM elements created by inline scripts receive component styling.

Representative regression paths:

- `/zh/tools/color-palette-generator/`
- `/zh/tools/color-shades-generator/`
- `/zh/tools/text-case/`
- `/zh/tools/xml-formatter/`
- `/zh/tools/markdown-table-generator/`
- `/zh/tools/robots-txt-generator/`
- `/zh/tools/css-variables-generator/`
- `/zh/tools/css-clip-path-generator/`
- `/zh/tools/cron-job-generator/`
- `/zh/tools/svg-to-jsx/`
- `/zh/tools/glassmorphism-generator/`

The 2026-04-27 refresh baseline covered 99 tools across 4 viewport and theme groups, for 396 page loads with `flaggedCount: 0`.

## Release Checks

Before shipping visual changes:

```bash
node scripts/audit.mjs --quiet
npm run build
```

Expected audit baseline:

```text
PASS: 16 WARN: 0 FAIL: 0
```

