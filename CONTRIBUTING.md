# Contributing to ZeroTool

> zerotool.dev — Free, browser-based developer tools. Astro + Cloudflare Pages.

## Tech Stack

- **Framework**: Astro 5 (SSG + SSR hybrid via `@astrojs/cloudflare`)
- **Language**: TypeScript
- **Styling**: Tailwind CSS (inline utility classes)
- **Content**: MDX blog posts via Astro Content Collections
- **Hosting**: Cloudflare Pages (tag-triggered deploy)
- **OG Images**: Generated at build time via `scripts/generate-og.mjs`

## Directory Structure

```
src/
├── components/         # Shared Astro components
│   └── tools/          # Per-tool interactive components
├── content/
│   ├── blog/           # MDX blog posts (en + zh)
│   ├── tools/          # Tool content collection (unused / legacy)
│   └── config.ts       # Content collection schemas
├── data/
│   ├── tools.ts        # Tool registry (slug, translations, category)
│   └── icons.ts        # Inline SVG icons per tool
├── layouts/            # BaseLayout, ToolLayout, ArticleLayout
├── pages/
│   ├── tools/          # EN tool pages (one .astro per tool)
│   ├── zh/tools/       # ZH tool pages
│   ├── ja/tools/       # JA tool pages
│   ├── ko/tools/       # KO tool pages
│   ├── blog/           # Blog routes
│   └── zh/             # ZH blog + index
├── styles/             # Global CSS
└── i18n/               # i18n utility + translations (en/zh/ja/ko JSON)
public/
└── og/                 # Generated OG images (PNG)
scripts/
└── generate-og.mjs     # OG image generator (run before build)
```

## Common Commands

```bash
npm run dev             # Local dev server
npm run build           # Full build (OG gen + Astro build)
npm run generate-og     # Regenerate OG images only
npm run preview         # Preview production build locally
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

- [ ] **Tool component**: `src/components/tools/{ToolName}Tool.tsx` or `.astro`
- [ ] **EN page**: `src/pages/tools/{slug}.astro`
- [ ] **ZH page**: `src/pages/zh/tools/{slug}.astro`
- [ ] **JA page**: `src/pages/ja/tools/{slug}.astro`
- [ ] **KO page**: `src/pages/ko/tools/{slug}.astro`
- [ ] **Registry entry**: Add to `src/data/tools.ts` — slug, translations (en + zh + ja + ko), category
- [ ] **Icon**: Add SVG to `src/data/icons.ts` — Lucide-style, 24x24, stroke-based
- [ ] **OG image**: Verify `npm run generate-og` produces `public/og/{slug}.png`

### Content

- [ ] **Blog post EN**: `src/content/blog/{slug}-guide.mdx`
- [ ] **Blog post ZH**: `src/content/blog/{slug}-guide-zh.mdx`

### Verification

- [ ] Design review passes against `DESIGN.md` on desktop/mobile and light/dark
- [ ] Build passes (`npm run build`)
- [ ] Tag + push to trigger CF Pages deploy
- [ ] README.md updated with new tool entry

## Code Conventions

- **i18n**: All user-facing strings in `tools.ts` translations object. Use `getToolName(tool, lang)` / `getToolDescription(tool, lang)`.
- **Design**: Follow `DESIGN.md` for tokens, tool layout, form styling, dark mode, dynamic DOM styling, and visual QA.
- **Icons**: Inline SVG in `icons.ts`. Must be Lucide-compatible: 24x24 viewBox, `stroke="currentColor"`, stroke-width 2.
- **Blog**: MDX with frontmatter: `title`, `description`, `pubDate`, `updatedDate`, `heroImage`, `lang`, `canonicalSlug`.
- **No external icon libraries** — all icons are inlined for zero network deps.

## i18n Architecture

Supported languages: **en** (default), **zh**, **ja**, **ko**.

- Translation strings: `src/i18n/{lang}.json`
- Locale registration: `src/i18n/utils.ts`
- Tool name/description: `src/data/tools.ts` per-lang `translations` object
- Tool content (SEO + FAQ + body): `src/content/tools/{slug}/{lang}.mdx`
- Routes: `src/pages/{lang}/index.astro` + `src/pages/{lang}/tools/[slug].astro`
- hreflang: `src/components/SEO.astro` (en/zh/ja/ko + x-default)
- Lang switcher: `src/layouts/BaseLayout.astro`
