---
title: ADR 0089 The Blog Is A Static Astro Site On GitHub Pages
type: source
date: 2026-09-29
tags: []
source: docs/adr/0089-the-blog-is-a-static-astro-site-on-github-pages.md
source_path: docs/adr/0089-the-blog-is-a-static-astro-site-on-github-pages.md
source_hash: 35b5605aa5477c5c47a24870521a0260f6bdddd59994fcf77cc70cb2216685f2
ingested: 2026-09-29
---

# ADR 0089 The Blog Is A Static Astro Site On GitHub Pages

# ADR 0089 The blog is a static Astro site on GitHub Pages, published on merge

Status: Accepted, 2026-09-29. Builds on [[ADR 0020: BI is first-party, Metabase leaves the stack]] (the control plane is the only public surface of the product) and [[ADR 0064 The Public Home Follows the Reader's Colour Scheme]] (the public home follows the reader's colour scheme).

## Context

People search for the problem, not the product: "Xero integration", "Gmail to database", "Google Drive OCR", "ETL vs ELT", in Vietnamese as well as English. The SPA is `noindex, nofollow` and must run JavaScript and sign in before it says anything; the README ranks only for the repository's name.

## Decision

* **A bilingual blog, `apps/blog`**, built by Astro into static files and served by **GitHub Pages at `blog.undercroft.lowbit.link`** through a DNS-only CNAME, so GitHub terminates TLS.
* **Static, not a control-plane route**: marketing pages stay off the one public surface that holds customer data, and a post does not wait for a release.
* **GitHub Pages, not Dokploy**: the shared, memory-limited host needs no container for static files.
* **Published on merge to `main`**, not on release: `blog.yml` builds every pull request that touches the blog and deploys only from `main`. A post changes no running code.
* **Vietnamese first, English second, every post in both**: Vietnamese is unprefixed and answers `x-default`; the pair is joined by `translationKey`, each with its own slug, and the build fails on an unpaired post. Technical terms stay in English in the Vietnamese text.
* **One brand**: the blog imports the UI's own font files and favicon by relative path and mirrors only the palette tokens it uses.
* **Posts must be true**: `apps/blog/WRITING.md` requires every claim to be checkable in the repository and sets the SEO rules — one search intent per post, one landing post per integration.

## Consequences

* `task build:blog` runs `astro check` and `astro build`; it is not in `task ci:verify`, because `blog.yml` is the blog's gate.
* A merged post is public within minutes; there is no second approval after review.
* The workspace lockfile gains `astro`, `@astrojs/*` and `sharp`.

## Rejected

* A docs framework (Starlight, VitePress): built for reference manuals, not dated articles with RSS and `BlogPosting` data.
* A separate repository: the brand would drift, and posts could not be reviewed against the code they describe.
* A path under `undercroft.lowbit.link/blog`: better as one site for ranking, but it needs the control plane or a proxy on the shared host to serve static files.
