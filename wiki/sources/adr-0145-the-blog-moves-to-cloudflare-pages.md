---
title: ADR 0145 The Blog Moves to Cloudflare Pages
type: source
date: 2026-10-18
tags: []
source: docs/adr/0145-the-blog-moves-to-cloudflare-pages.md
source_path: docs/adr/0145-the-blog-moves-to-cloudflare-pages.md
source_hash: ac6cc58579ed2fa00df56812e931282080e94ed3b2b6d146be06d0ae58d26e28
ingested: 2026-10-18
---

# ADR 0145 The Blog Moves to Cloudflare Pages

# ADR 0145 The Blog Moves to Cloudflare Pages

Supersedes, in part, [[ADR 0089 The Blog Is A Static Astro Site On GitHub Pages]]: only the host changes. The blog stays a static Astro site outside the product, published on a merge to `main` rather than by a release, Vietnamese first.

**Why.** `muitneliss/undercroft` became private and GitHub serves Pages from a private repository only on a paid plan, so it switched the site off: every path on `blog.undercroft.lowbit.link` answered 404 and `blog.yml`'s deploy failed on 2026-10-13. The site carries the privacy policy and terms that Google's OAuth consent screen names for the Gmail and Drive connectors, so the 404 blocked verification.

**What.** The Cloudflare Pages project `undercroft-blog` serves the same hostname. `task cd:blog` is the one publish command: `task build:blog`, then `wrangler pages deploy` of `apps/blog/dist` to branch `main` (the blog package's `deploy` script). `blog.yml`'s deploy job runs the same task. The credential is a scoped `Pages Write` API token in `CLOUDFLARE_API_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID`, never the global key. DNS is a proxied CNAME to `undercroft-blog.pages.dev`, so Cloudflare now terminates TLS. `apps/blog/public/CNAME` is deleted.

**Consequences.** URLs are unchanged. PRs still get the build as their check. `wrangler` joins the blog's dev dependencies. The blog is pinned to TypeScript 6, because `astro check` refuses TypeScript 7 and the build had failed since #477.

**Rejected.** Making the repository public or paying for Pages (a product decision the blog should not force), serving from the Dokploy host (shared and memory-limited, as ADR 0089 said), and uploading with the global API key.
