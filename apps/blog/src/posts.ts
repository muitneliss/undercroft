import { type CollectionEntry, getCollection } from "astro:content";
import { INTEGRATIONS, type Integration, LANGS, type Lang, langPrefix } from "./site.ts";

export type Post = CollectionEntry<"posts">;

const WHITESPACE = /\s+/u;
const LANG_SET: ReadonlySet<string> = new Set(LANGS);

function isLang(value: string): value is Lang {
  return LANG_SET.has(value);
}

/** A post's language, read from the directory it sits in (`vi/…`, `en/…`). */
export function langOf(post: Post): Lang {
  const [dir] = post.id.split("/");
  if (dir === undefined || !isLang(dir)) {
    throw new Error(`post ${post.id} is not under a language directory`);
  }
  return dir;
}

export function slugOf(post: Post): string {
  const slug = post.id.split("/").at(-1);
  if (slug === undefined || slug === "") {
    throw new Error(`post ${post.id} has no slug`);
  }
  return slug;
}

export function pathOf(post: Post): string {
  return `${langPrefix(langOf(post))}/${slugOf(post)}/`;
}

/** Newest first, one language. */
export async function postsIn(lang: Lang): Promise<Post[]> {
  const all = await getCollection("posts", (post) => langOf(post) === lang);
  return all.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

/**
 * The same article in the other language. Every post is published in both, and a missing
 * pair fails the build rather than shipping a page whose language switch leads nowhere and
 * whose hreflang set is incomplete.
 */
export async function translationOf(post: Post): Promise<Post> {
  const lang = langOf(post);
  const [match, ...extra] = await getCollection(
    "posts",
    (other) => other.data.translationKey === post.data.translationKey && langOf(other) !== lang,
  );
  if (match === undefined || extra.length > 0) {
    throw new Error(
      `post ${post.id} needs exactly one translation with translationKey "${post.data.translationKey}"`,
    );
  }
  return match;
}

/**
 * The landing post of each integration, in one language. Two posts claiming the same source
 * would compete for the same query, so a second claim fails the build.
 */
export async function integrationLandings(lang: Lang): Promise<[Integration, Post][]> {
  const found = new Map<Integration, Post>();
  for (const post of await postsIn(lang)) {
    const source = post.data.integration;
    if (source === undefined) {
      continue;
    }
    const claimed = found.get(source);
    if (claimed !== undefined) {
      throw new Error(`posts ${claimed.id} and ${post.id} both claim integration "${source}"`);
    }
    found.set(source, post);
  }
  const landings: [Integration, Post][] = [];
  for (const source of INTEGRATIONS) {
    const post = found.get(source);
    if (post !== undefined) {
      landings.push([source, post]);
    }
  }
  return landings;
}

/** Posts in the same language that share the most tags, for internal links. */
export async function relatedTo(post: Post, count: number): Promise<Post[]> {
  const others = (await postsIn(langOf(post))).filter((other) => other.id !== post.id);
  return others
    .map((other) => ({
      other,
      score: other.data.tags.filter((tag) => post.data.tags.includes(tag)).length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ other }) => other);
}

/** Whole minutes at a relaxed reading pace; a Vietnamese word is one syllable, hence faster. */
export function readingMinutes(post: Post): number {
  const words = (post.body ?? "").split(WHITESPACE).filter(Boolean).length;
  const perMinute = langOf(post) === "vi" ? 260 : 220;
  return Math.max(1, Math.round(words / perMinute));
}
