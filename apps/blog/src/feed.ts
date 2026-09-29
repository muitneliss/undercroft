import rss from "@astrojs/rss";
import { pathOf, postsIn } from "./posts.ts";
import { type Lang, STRINGS } from "./site.ts";

/** One RSS feed per language, so a reader subscribes to the language they read. */
export async function feed(lang: Lang, site: URL | undefined): Promise<Response> {
  const s = STRINGS[lang];
  return rss({
    title: s.siteTitle,
    description: s.siteDescription,
    site: site ?? "https://blog.undercroft.lowbit.link",
    customData: `<language>${lang}</language>`,
    items: (await postsIn(lang)).map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: pathOf(post),
      categories: post.data.tags,
    })),
  });
}
