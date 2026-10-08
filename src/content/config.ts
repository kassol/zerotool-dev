import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang: z.enum(['en', 'zh', 'ja', 'ko']).default('en'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // SEO overrides
    canonicalUrl: z.string().url().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().default(false),
  }),
});

const toolsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    seoTitle: z.string(),
    seoDescription: z.string(),
    // Every tool page provides plain-text usage steps for llms-full.txt.
    // See src/content/AGENTS.md for the 8/280/1200 limits checked by test-llms-txt.mjs.
    steps: z.array(z.string()).nonempty(),
    faqItems: z.array(z.object({
      // Optional match key across the four languages (src/content/AGENTS.md). Pages and
      // FAQPage data do not use it; scripts/test-tool-content-parity.mjs reads it.
      id: z.string().regex(/^(?:local-)?[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).optional(),
      question: z.string(),
      answer: z.string(),
    })).default([]),
  }),
});

export const collections = {
  blog: blogCollection,
  tools: toolsCollection,
};
