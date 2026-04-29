# Contributing to ZeroTool

> zerotool.dev — Free, browser-based developer tools. Astro + Cloudflare Pages.

## Tech Stack

- **Framework**: Astro 5 static output (`output: 'static'`) with the `@astrojs/cloudflare` adapter
- **Language**: TypeScript
- **Styling**: Hand-rolled CSS in `src/styles/` plus per-component styles in each `.astro` file. CSS custom properties drive the theme tokens. No Tailwind, no design framework.
- **Content**: MDX via Astro Content Collections (`blog` + `tools`)
- **Hosting**: Cloudflare Pages (tag-triggered deploy)
- **OG Images**: Generated at build time via `scripts/generate-og.mjs`

## Directory Structure

```
src/
├── components/
│   ├── tools/                              # One {ToolName}Tool.astro per tool — interactive widget
│   └── *.astro                             # Shared UI (SEO, ShareButtons, AdUnit, etc.)
├── content/
│   ├── blog/{base-slug}/{lang}.mdx         # Blog posts, one directory per article × 4 langs
│   ├── tools/{slug}/{lang}.mdx             # Per-tool SEO + FAQ + body × 4 langs
│   └── config.ts                            # Content collection schemas
├── data/
│   ├── tools.ts                            # Tool registry (slug, 4-lang translations, category, relatedSlugs)
│   └── icons.ts                            # Inline Lucide-style SVG per slug
├── i18n/
│   ├── {en,zh,ja,ko}.json                   # UI translation strings
│   └── utils.ts                             # `t()` helper + locale registration
├── layouts/                                # BaseLayout, ToolLayout, ArticleLayout
├── pages/
│   ├── tools/[slug].astro                   # EN dynamic tool route
│   ├── {zh,ja,ko}/tools/[slug].astro        # Localized tool routes (same component map)
│   ├── blog/[slug].astro                    # EN blog post route (slug = base slug)
│   ├── {zh,ja,ko}/blog/[slug].astro         # Localized blog post routes
│   └── {about,privacy,terms,contact}.astro  # Static prose pages × 4 langs
└── styles/                                 # Global CSS (tool-common.css etc.)
public/
└── og/                                     # Generated OG images (PNG, one per tool slug)
scripts/
├── audit.mjs                               # Static consistency checks (run in CI)
├── check-icon-coverage.mjs                 # Pre-build: every slug has an icon
├── generate-og.mjs                         # Pre-build: render OG PNGs
├── generate-blog-redirects.mjs             # Post-build: legacy URL → new URL 301s
└── update-readme-tools.js                  # Sync README tool table from tools.ts
```

## Common Commands

```bash
npm run dev             # Local dev server
npm run build           # Full build (icon check + OG gen + Astro build + redirects)
npm run generate-og     # Regenerate OG images only
npm run preview         # Preview production build locally
node scripts/audit.mjs  # Static audit (also runs in CI)
```

## Deploy

Cloudflare Pages deploys are triggered by pushing a **git tag** to origin.

1. Ensure `master` is clean and all changes committed
2. Run `npm run build` — must succeed with zero errors
3. `git push origin master`
4. `git tag vX.Y.Z` (increment patch for fixes, minor for features)
5. `git push origin vX.Y.Z` — triggers CF Pages deploy

## New Tool Checklist

Every new tool requires ALL of the following:

### Code

- [ ] **Tool component**: `src/components/tools/{ToolName}Tool.astro` — single-file widget with inline `<script>` and scoped `<style>`. No client framework; avoid new npm runtime dependencies unless browser-native APIs are insufficient.
- [ ] **Registry entry**: Append to `src/data/tools.ts` — `slug`, full 4-language `translations` (`en`/`zh`/`ja`/`ko`), `category`, optional `relatedSlugs`.
- [ ] **Component map**: Add the import and `'{slug}': {ToolName}Tool` entry to `src/components/tools/registry.ts` — this single registry is consumed by all four `[slug].astro` routes, so you only edit it once.
- [ ] **Icon**: Add a Lucide-style inline SVG to `src/data/icons.ts` (24×24 viewBox, `stroke="currentColor"`, stroke-width 2).
- [ ] **OG image**: `npm run generate-og` produces `public/og/{slug}.png`.

### Content

- [ ] **Tool SEO**: 4 files at `src/content/tools/{slug}/{en,zh,ja,ko}.mdx` with `seoTitle`, `seoDescription`, optional `faqItems`, plus a body for long-tail content. Build will fail if any of the four is missing.
- [ ] **Blog post (recommended)**: `src/content/blog/{slug}-guide/{en,zh,ja,ko}.mdx` covering common use cases and pitfalls.

### Verification

- [ ] `node scripts/audit.mjs` passes
- [ ] `npm run build` passes (CI also runs it)
- [ ] Design review against `DESIGN.md` on desktop/mobile and light/dark
- [ ] README tool table auto-syncs via `update-readme.yml` on push to `master`
- [ ] Tag + push to trigger CF Pages deploy

## Code Conventions

- **i18n strings**: User-facing UI strings live in `src/i18n/{lang}.json` (looked up via `t(lang, key)`). Per-tool name and description live in `src/data/tools.ts` `translations` (read with `getToolName(tool, lang)` / `getToolDescription(tool, lang)`).
- **Design tokens**: Use the CSS custom properties defined in `BaseLayout.astro` global styles (`--color-primary`, `--radius-md`, etc.). Do not hardcode hex colors in component styles. See `DESIGN.md`.
- **Icons**: All icons are inline SVG in `src/data/icons.ts` — no external icon libraries, zero network dependencies.
- **Persistence**: Use the global `window.ztPersist` API (`save` / `load` / `clear`). Direct `localStorage.setItem` is forbidden — `audit.mjs` will FAIL the build. Per-slug policy lives in `src/data/persistence.ts`: `input` (default; Clear must sync), `preference` (Clear leaves it alone), or `disabled` (never persisted; historical values are wiped on every load).
- **Blog frontmatter**: `title`, `description`, `pubDate`, `updatedDate?`, `ogImage?`, `lang`, `tags?`, `draft?`, `canonicalUrl?`, `noindex?`. The URL slug is the directory name; there is no per-language slug field.

## i18n Architecture

Supported languages: **en** (default), **zh**, **ja**, **ko**.

- UI translation strings: `src/i18n/{lang}.json`
- Locale registration: `src/i18n/utils.ts`
- Tool name/description: `src/data/tools.ts` `translations` (4-lang object per tool)
- Tool body content (SEO + FAQ + body): `src/content/tools/{slug}/{lang}.mdx`
- Routes: `src/pages/{lang}/tools/[slug].astro` + `src/pages/{lang}/blog/[slug].astro`
- hreflang tags: emitted by `src/components/SEO.astro`, derived from URL + collection presence
- Language switcher: `src/layouts/BaseLayout.astro`
