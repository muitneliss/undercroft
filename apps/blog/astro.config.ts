import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { SITE_URL } from "./src/site.ts";

// Static output only: GitHub Pages serves files, so nothing here may need a server at request
// time. Vietnamese is the default locale and unprefixed, matching the product (i18n.md);
// English lives under /en/. A post's two languages are paired by `translationKey`, not by
// path, so each can carry the slug its own readers search for.
export default defineConfig({
  site: SITE_URL,
  trailingSlash: "always",
  build: { format: "directory" },
  i18n: {
    locales: ["vi", "en"],
    defaultLocale: "vi",
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap()],
  markdown: { shikiConfig: { theme: "github-light" } },
  // Never inline an asset as a data: URI. Search engines only show a favicon they can fetch
  // at a URL, and the same holds for the logo the JSON-LD names.
  vite: { build: { assetsInlineLimit: 0 } },
});
