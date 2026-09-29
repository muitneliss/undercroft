import type { APIContext } from "astro";
import { feed } from "../../feed.ts";

export function GET({ site }: APIContext): Promise<Response> {
  return feed("en", site);
}
