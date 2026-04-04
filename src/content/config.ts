import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    lang: z.enum(['en', 'zh']).default('en'),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    // SEO overrides
    canonicalUrl: z.string().url().optional(),
    ogImage: z.string().optional(),
    noindex: z.boolean().default(false),
  }),
});

export const collections = {
  blog: blogCollection,
};
