import type { APIContext } from "astro";

export function GET({ site }: APIContext): Response {
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap-index.xml", site).href}\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}
