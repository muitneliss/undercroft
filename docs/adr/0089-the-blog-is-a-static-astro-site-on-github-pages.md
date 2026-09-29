# 89. The blog is a static Astro site on GitHub Pages, published on merge

- Status: Accepted
- Date: 2026-09-29
- Builds on: [ADR 0020](0020-bi-is-first-party-metabase-leaves-the-stack.md) (the control
  plane is the only public surface of the product), [ADR 0064](0064-the-public-home-follows-the-readers-colour-scheme.md)
  (the public home follows the reader's colour scheme).

## Context

People who need Undercroft search for the problem, not the product: "Xero integration",
"Gmail to database", "Google Drive OCR", "ETL vs ELT", and the same questions in Vietnamese.
The product cannot answer them. The SPA sets `noindex, nofollow`, and a page that must run
JavaScript and sign in before it says anything is not one a search engine reads. The README is
a single page on GitHub, and it ranks for the repository's name only.

## Decision

**A bilingual blog, `apps/blog`, built by Astro into static files and served by GitHub Pages
at `blog.undercroft.lowbit.link`.**

- **Static, not a route in the control plane.** A post is a document that changes when someone
  edits it, not when a request arrives. Serving it from the control plane would put marketing
  pages on the one public surface that holds customer data, and would ship a post only with a
  release.
- **GitHub Pages, not Dokploy.** The host is shared and memory-limited
  (`.claude/rules/deployment.md`); a static site needs no container there. Pages is free,
  serves over HTTPS with its own certificate, and is driven from the repository the posts live
  in. The DNS record is a DNS-only CNAME, so GitHub, not Cloudflare, terminates TLS.
- **Published on merge to `main`, not on release.** `release.yml` ships nothing on a plain push
  because a push changes running code. A post changes no code, and waiting for a release would
  hold an article hostage to an unrelated version bump. `blog.yml` builds on every pull
  request that touches the blog and deploys only from `main`.
- **Vietnamese first, English second, every post in both.** Vietnamese is unprefixed and
  answers `x-default`, matching the product (`.claude/rules/i18n.md`). The pair is joined by
  `translationKey`, each with its own slug, and the build fails on an unpaired post. Technical
  terms stay in English in the Vietnamese text, because that is what readers search for.
- **One brand, one set of fonts.** The blog imports the UI's own font files and favicon by
  relative path, and mirrors only the handful of palette tokens it uses.
- **Posts must be true.** `apps/blog/WRITING.md` requires every claim to be checkable in this
  repository, and gives the SEO rules: one search intent per post, one landing post per
  integration.

## Consequences

- `task build:blog` runs `astro check` and `astro build`. It is not in `task ci:verify`: the
  blog's gate is `blog.yml`, which runs only when the blog changes, so a product change pays
  nothing for it.
- A merged post is public within minutes, and there is no second approval after review.
- The blog adds `astro`, `@astrojs/*` and `sharp` to the workspace lockfile.

## Rejected

- **A docs framework (Starlight, VitePress).** Those are built for reference manuals. What this
  needed was articles with a hero image, dates, RSS and `BlogPosting` structured data.
- **A separate repository.** The brand tokens and fonts would be a copy that drifts, and posts
  could not be checked against the code they describe in the same review.
- **A path under `undercroft.lowbit.link/blog`.** It would rank slightly better as one site,
  but it needs the control plane or a proxy on the shared host to serve static files. That is
  the coupling rejected above.
