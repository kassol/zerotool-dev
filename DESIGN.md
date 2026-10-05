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
| Accent | `--color-accent` | `oklch(52% 0.09 78)` | `oklch(72% 0.08 90)` |
| Page background | `--color-bg` | `oklch(98.4% 0.009 78)` | `oklch(15% 0.012 65)` |
| Secondary background | `--color-bg-secondary` | `oklch(96.2% 0.011 78)` | `oklch(19% 0.014 65)` |
| Surface | `--color-surface` | `oklch(99.4% 0.006 78)` | token mix |
| Muted surface | `--color-surface-muted` | `oklch(97.1% 0.01 78)` | token mix |
| Body text | `--color-text` | `oklch(22% 0.018 70)` | `oklch(92% 0.011 78)` |
| Secondary text | `--color-text-secondary` | `oklch(43% 0.016 70)` | `oklch(76% 0.012 78)` |
| Muted text | `--color-text-muted` | `oklch(53% 0.014 70)` | `oklch(62% 0.012 78)` |

Raw hex values are reserved for true generated color previews, imported external content, and static brand assets such as `public/favicon.svg`.

Text color tokens must reach a contrast ratio of at least 4.5:1 (WCAG AA) against `--color-bg`, `--color-bg-secondary`, and `--color-surface`.

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

## HAR Waterfall Phase Color

`HarFileAnalyzerTool` paints request waterfalls in Chrome DevTools phases. Each phase has a dedicated token, defined for both light and dark in `BaseLayout.astro`. These tokens are reserved for HAR phase signaling; do not reuse them for category tinting or arbitrary surfaces.

| Phase | HAR 1.2 timings field(s) | Token | Light | Dark |
|---|---|---|---:|---:|
| Queued / Stalled | `blocked` | `--color-har-queued` | `oklch(63% 0.025 70)` | `oklch(70% 0.022 70)` |
| DNS Lookup | `dns` | `--color-har-dns` | `oklch(58% 0.105 190)` | `oklch(72% 0.10 190)` |
| Initial Connection (TCP) | `connect` minus `ssl` | `--color-har-connect` | `oklch(60% 0.13 40)` | `oklch(72% 0.12 40)` |
| TLS | `ssl` | `--color-har-connect`, drawn with diagonal stripes (no separate token) | — | — |
| Request Sent | `send` | `--color-har-send` | `oklch(56% 0.12 155)` | `oklch(74% 0.11 155)` |
| Waiting (TTFB) | `wait` | `--color-har-wait` | `oklch(54% 0.135 290)` | `oklch(72% 0.13 290)` |
| Content Download | `receive` | `--color-har-receive` | `oklch(56% 0.125 250)` | `oklch(72% 0.12 250)` |

Invariant per HAR 1.2 spec: `entry.time === blocked + dns + connect + send + wait + receive` summing only fields whose value is not `-1`. `ssl` is excluded from the sum because it is already counted inside `connect`, so the bar splits `connect` into TCP and TLS. When a field is `-1`, the segment is omitted and the tooltip notes N/A.

Firefox writes TCP time to `connect`, keeps `ssl` outside it and adds both to `entry.time` (`devtools/shared/network-observer/NetworkTimings.sys.mjs`). The engine picks the convention per entry: when only `blocked + dns + connect + ssl + send + wait + receive` equals `entry.time` (within 1.5 ms), `connect` is drawn as TCP and `ssl` as a separate TLS segment. The same rule covers non-compliant exporters that emit `ssl` with `connect === -1` and count it in `entry.time`. Do not "fix" this back to the strict spec sum; Firefox exports would show every HTTPS bar short and flagged.

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
- `.tool-guide-link`: card link to the tool's blog guide (`/blog/{slug}-guide/` in the page language), only when that guide exists
- `.related-tools`: compact related cards below the tool
- `.tool-content`: SEO and usage content with a reading width near 820px
- `.tool-faq`: compact accordion cards

Every tool UI fills the `.tool-widget` width. Use inner grids to create local structure, with `minmax(0, 1fr)` and `min-width: 0` on flexible children.

### Tool Pages v2

Since 2026-10-04, slugs listed in `src/data/tool-layouts.ts` render `.tool-page--v2`; the other tools keep the structure above until they are moved in batches. To move a tool: add its slug with a kind, size its component for that kind, put explanations in toggletips, move the MDX "How to use" facts into the tool and the `steps` frontmatter (the "Limits" section stays in the MDX, see "Reference content"), and run its tests, `test-llms-txt.mjs`, audit and build.

**Kinds** (pick by what the user mainly looks at):

| Kind | Layout | Shell max width | Sample |
|---|---|---:|---|
| `convert` | Input and output side by side, both as tall as the first screen allows; options in one row above them; notes under the output. Stacks below 860px with options after the panels. | 2400px | `JsonFormatterTool` |
| `generate` | A 270–320px control rail (inputs, options, code export) on the left; the generated preview fills the rest (palettes: six cards in two rows of three, monochromatic full width). Rail stacks on top below 860px. | 1840px | `ColorPaletteGeneratorTool` |
| `analyze` | The result uses the full width. Before input, the drop zone fills the first screen. From 1280px, details open beside the list; lists grow with the window height. | 2400px | `HarFileAnalyzerTool` |
| `compact` | Short inputs followed directly by short results. The tool card is centered, at most 960px wide, and uses its content height at every viewport. Controls and a reserved status row precede results. Long values scroll inside their result rows; worked steps may use a bounded area below. | 1120px | `NumberBaseTool` (B5 representative) |
| `compare` | Two bounded input editors above a full-width result that fills the remaining first screen and scrolls internally. Controls and a reserved status row come first; pagination stays outside the result. Users may collapse inputs after a result; clearing, invalidating or failing a comparison reopens them. | 2400px | `DiffCheckerTool` (B10 representative) |

**Shared classes** (`src/styles/tool-common.css`, loaded on every tool page)

| Class | Use |
|---|---|
| `.zt-io` | The two-column grid of a `convert` tool. Its parent is the tool root, a flex column, so the grid takes the height that is left. One column at 860px and below. |
| `.zt-io-pane` | One side of the grid: a flex column with the label row on top and the editor under it. |
| `.zt-io-fill` | The textarea, `<pre>` or list that fills its pane (`flex: 1 1 0`, at least 300px, no resize handle). The basis is 0 so that long output scrolls inside the pane and does not make the first screen taller; give a `<div>` or `<pre>` that holds results `overflow: auto`. At 860px and below it stops stretching, is at least 120px high and can be resized; the tool sets the height there. |
| `.zt-tip`, `.zt-tip-btn`, `.zt-tip-pop` | Toggletip button and panel. `Toggletip.astro` has no `<style>` of its own. |
| `.zt-empty-drop` | An `analyze` tool's empty drop zone: a centered flex column that fills the available height, with a 220px minimum. Keep the tool class for its border, colors, spacing and compact or mobile state. Used by HAR File Analyzer and QR Code Decoder. |
| `.zt-rail` | A `generate` tool's control rail: a flex column with a 0.9rem gap and zero minimum width and height. Keep the tool class for its panels, scrolling and mobile order. Used by Color Palette Generator and QR Code Generator. |
| `.zt-segmented` | The container of a segmented control: flex row, pill radius and an inset border. Keep padding, background, button or radio semantics, and selected-state styling in the tool. Used by Color Palette Generator and Sprite Sheet Generator. |
| `.zt-compare-inputs` | Two bounded editors above a comparison: equal columns with a 0.75rem gap, 180px textareas, and internal scrolling. At 860px they stack with 120px textareas. Used by Diff Checker and JSON Diff. |
| `.zt-compare-results` | A comparison result fills the remaining height with zero minimum width and height. At 860px it is 24rem high, at 640px 22rem; `data-empty="true"` hides it on stacked screens. Keep result headers, scrollers and disclosure controls in the tool. |

`convert` tools use `.zt-io`, `.zt-io-pane` and `.zt-io-fill` for the panels and keep their own class next to each for tool-specific rules (tab size, colors, phone heights). Rules that the first batch (2026-10-04, 12 tools; `TextToBinaryTool` is the reference) settled:

- The component's outermost element is the tool root (a flex column with `min-height: 0`); no wrapper `<div>` around it, because only direct children of the widget get the height.
- Order: buttons and options in one or two rows, then the status line, then the panels; notes go under the output. The status line keeps its height when it is empty, so a first result does not move the panels.
- The input is on the left and what the user reads (output, preview, result cards) on the right. Inputs that belong together (bytes and schema, message and key) share the left pane. A tool whose output is a list of cards may give the right pane more width from 861px (`UnicodeTextConverterTool`: 1fr 2fr).
- A result pane with nothing in it shows one sentence that says what will appear (in all four languages); at 860px and below the empty pane is hidden.
- The tool's own breakpoints are 860px (stack) and 640px (phone details).
- A button whose action already ran when the input changed is removed, with its strings. If that button was also the only way to retry after a load failure, the failure message gets a Retry button (`SvgOptimizerTool`).
- A consequence the user must see when choosing (an option that sends requests, a fixed IV) stays visible while the option is on; a toggletip holds the details only (`MarkdownToWordTool`). Generate control rails use `.zt-rail`. Analyze drop zones use `.zt-empty-drop`.

**Shell**

- Width `min(100% - 2 × clamp(0.5rem, 1.6vw, 1.75rem), max)`; the site nav widens to the same edge on these pages (`html:has(.tool-page--v2)` sets `--max-width`).
- Header: 40px icon well, display-serif H1 `clamp(1.55rem, 1.05rem + 1.25vw, 2.35rem)`, description at 0.93rem, trust items as small muted text at the top right (below the title under 900px). No kicker label.
- `.tool-first` (header + `.tool-widget--v2`) has `min-height: calc(100svh - var(--header-height))`; the widget is a flex column and the tool's root element gets `flex: 1`, so editors, previews and lists grow into the first screen. Below 760px the first screen does not fill; the tool stacks at its own height.
- `compact` uses a 1120px shell and a centered tool card up to 960px. Its first screen has no viewport minimum height; neither the card nor its root stretches. Results follow the inputs without an empty preview area. The shared page order and folded reference content stay the same.
- `compare` uses the 2400px shell. Input editors are 180px high on desktop and stack at 860px with 120px height. The first screen uses content height at 860px and below; empty output is hidden there and a populated result remains bounded. Keep input values when users collapse the input section; make the result start visible after comparison on phones.
- Page order: tool → share buttons / guide link → reference `<details id="reference">` (closed) → mid ad → related tools → bottom ad. Sensitive tools show no ads, as before.

**Explanations in the tool**

- Short hints sit next to the control they describe, as toggletips (`src/components/Toggletip.astro`): a 24px "?" button (28px on phones), or a text button (`text` prop) for a question the user may have before starting, such as "How to export a HAR". The panel is a native `popover="auto"`: click or tap opens it, a second click, a tap outside or Esc closes it, focus stays on the button. Panel colors are inverted (`--color-text` background, `--color-bg` text).
- The "?" button's accessible name is built in `Toggletip.astro`: pass `lang` and `about` (the control's visible name) and it reads the pattern `tool.tipAbout` from `src/i18n` ("About: {name}"). Pass `label` only for a name that does not fit the pattern; a text button needs neither.
- The text is in the HTML, in all four languages (component `STRINGS`), and states what the old MDX "How to use" section held (accepted input, what an option changes) plus the limits that belong to one control (the size limit next to the file button, what a check does not cover next to its option). Limits that are not tied to one control stay in the MDX "Limits" section. Write plain sentences; no lists or paragraphs inside (a toggletip may sit inside a `<p>`), no links.
- Errors still name the cause and the fix in the status line.

**Reference content**

- The MDX body and the FAQ sit in one closed `<details class="tool-reference" id="reference">` titled with `tool.reference` and `tool.referenceHint`. Heading levels stay; the FAQ renders as H3 questions with answers; the FAQPage JSON-LD is unchanged. A link to `#heading` inside it, or find-in-page, opens it.
- Keep in the MDX: worked examples (with their test annotations), comparisons with other tools, background, and the "Limits" section. Remove "How to use"; put the steps in the `steps` frontmatter (plain text, current button names, read by `toolSteps()` for llms-full.txt) and in toggletips. Write a limit that belongs to one control in that control's toggletip as well.
- The three samples (json-formatter, color-palette-generator, har-file-analyzer) were finished before this decision (2026-10-04). All their limits are in toggletips and their MDX has no "Limits" section; do not move them back.

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
- Touch targets on mobile (`max-width: 640px`) are at least 44px high: `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-copy`, `.btn-sm`, `.tool-input`, share buttons, and label rows that wrap a radio or checkbox. Desktop keeps the compact sizes: `.tool-input` 40px, `.btn-copy` 32px, `.btn-sm` 30px, share buttons 36px. Put mobile sizes in the shared `@media (max-width: 640px)` rules. Do not set a smaller `min-height` on these classes in a tool component.
- Dense controls inside a tool (tag chips, preset buttons, segment buttons, small number inputs, remove "×" buttons, reset buttons, `<summary>` toggles, standalone cross-links) are at least 24×24px on mobile (WCAG 2.2 AA, 2.5.8 Target Size Minimum). Put the rule in the tool component's own `@media (max-width: 640px)` block and keep desktop sizes. A control narrower than 24px is acceptable only when a 24px circle centered on it does not overlap another target or its circle (the 2.5.8 spacing exception). Exempt: links inside a sentence or rendered content, disabled controls, and visually hidden inputs whose visible label is the target.

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

### highlight.js Syntax Theme

The shared `.hljs` theme lives in `src/styles/tool-common.css` (not in any single tool component), since `ToolLayout` loads that stylesheet on every tool page and several tools render highlighted code: `MarkdownPreviewTool`, `CurlToCodeTool`, `JsonToJavaTool`, `JsonToMongooseTool`, `TypescriptToZodTool`.

- Base `.hljs` background and text use `--color-bg-secondary` and `--color-text` so code blocks match the surrounding panel in both themes automatically.
- Syntax colors are GitHub Light (light theme) and GitHub Dark (dark theme, unchanged from upstream). Light-theme colors that fell under 4.5:1 against `--color-bg-secondary` were darkened in place (hue and saturation preserved): keyword/type `#d73a49`→`#d02a3a`, built_in/symbol `#e36209`→`#b64e07`, comment `#666e78` (from `#6a737d`), name/tag/quote `#22863a`→`#207d36`, addition text `#22863a`→`#218339`. All light syntax colors now measure ≥4.6:1; all dark syntax colors measure ≥6:1.
- A component embedding highlighted code must not hardcode a background that duplicates `.hljs`'s own (light/dark) values — it will drift out of sync with the shared theme. Let `.hljs` or the surrounding token-based panel background show through instead.

## Dark Mode

Dark mode uses the same token names with warmer, lower-lightness values. Components should rely on tokens so both system dark mode and `[data-theme="dark"]` render correctly.

Checklist for dark mode:

- Page background, surface, muted surface, borders, and text come from tokens.
- The dark token blocks in `BaseLayout.astro` also set `color-scheme: dark`, so native scrollbars, select popups, and checkboxes render dark.
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
