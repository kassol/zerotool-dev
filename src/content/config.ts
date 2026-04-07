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
    // i18n: slug of the translated counterpart (e.g. en post → zh slug)
    translationSlug: z.string().optional(),
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
    faqItems: z.array(z.object({
      question: z.string(),
      answer: z.string(),
    })).default([]),
  }),
});

export const collections = {
  blog: blogCollection,
  tools: toolsCollection,
};
