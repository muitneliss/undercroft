import { glob } from "astro/loaders";
import { z } from "astro/zod";
import { defineCollection } from "astro:content";
import { INTEGRATIONS } from "./site.ts";

const KEBAB = /^[a-z0-9-]+$/u;

/**
 * A post is `src/content/posts/<lang>/<slug>.md`. The directory is the one owner of its
 * language and the filename of its slug, so neither is repeated in the frontmatter where the
 * two could disagree. The length bounds are the search-result limits: a title past ~65
 * characters and a description past ~160 are cut off by the engine, silently.
 */
const posts = defineCollection({
  loader: glob({ pattern: "{vi,en}/*.md", base: "./src/content/posts" }),
  schema: ({ image }) =>
    z.object({
      title: z.string().min(20).max(70),
      description: z.string().min(80).max(170),
      translationKey: z.string().regex(KEBAB),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      tags: z.array(z.string()).min(1).max(6),
      keywords: z.array(z.string()).min(3).max(12),
      hero: image(),
      heroAlt: z.string().min(10),
      // The source this post is the landing page for. At most one post per language may
      // claim a source, so "Xero integration" has exactly one page to rank rather than two
      // competing with each other.
      integration: z.enum(INTEGRATIONS).optional(),
    }),
});

/**
 * The hosted service's own pages, `src/content/service/<lang>/<page>.md`: what the app is, its
 * privacy policy and its terms. They live here because Google's OAuth verification needs all
 * three at a public address on the service's authorised domain, readable without signing in,
 * and the blog is the one public, static site on `lowbit.link`. `updated` is printed on the
 * page: a policy without the date it took effect cannot be held to.
 */
const service = defineCollection({
  loader: glob({ pattern: "{vi,en}/{app,privacy,terms}.md", base: "./src/content/service" }),
  schema: z.object({
    title: z.string().min(5).max(70),
    description: z.string().min(80).max(170),
    updated: z.coerce.date(),
  }),
});

export const collections = { posts, service };
