# 145. The blog moves to Cloudflare Pages

- Status: Accepted
- Date: 2026-10-18
- Supersedes, in part: [ADR 0089](0089-the-blog-is-a-static-astro-site-on-github-pages.md), where
  GitHub Pages serves the blog and GitHub terminates its TLS. Everything else in ADR 0089 stands:
  a static Astro site, outside the product, published on a merge to `main` rather than by a
  release, Vietnamese first.
- Keeps: [ADR 0136](0136-temporary-deploy-on-push-during-actions-outage.md) (no workflow runs until the Actions minutes
  reset), which is why the first publish was made by hand with `task cd:blog`.

## Context

`muitneliss/undercroft` became a private repository. GitHub serves Pages from a private repository
only on a paid plan, so it switched the site off: `blog.undercroft.lowbit.link` answered 404 on
every path, and `blog.yml`'s deploy job failed on 2026-10-13 with
`Failed to create deployment (status: 404) ... Ensure GitHub Pages has been enabled`.

The site is not only marketing. Google's OAuth consent screen, which the Gmail and Drive
connectors need (`docs/runbook/google-ingestion-setup.md`), names its home page, privacy policy
and terms of service, and the reviewer has to be able to read all three. A 404 on those URLs
blocks the verification.

## Decision

**The blog is served by the Cloudflare Pages project `undercroft-blog`, on the same
`blog.undercroft.lowbit.link`.**

- **`task cd:blog` is the one publish command.** It runs `task build:blog`, then `wrangler pages
deploy` of `apps/blog/dist` to the project's `main` branch (the `deploy` script in
  `apps/blog/package.json`). `blog.yml`'s deploy job calls the same task, so a merge and a manual
  publish upload the same thing the same way (`.claude/rules/tooling.md`).
- **The credential is a scoped API token**, `Pages Write` on the one account, read from
  `CLOUDFLARE_API_TOKEN`, with `CLOUDFLARE_ACCOUNT_ID` beside it. Never the account's global key:
  that can change every zone and DNS record the account holds.
- **The DNS record is a proxied CNAME to `undercroft-blog.pages.dev`**, so Cloudflare now
  terminates TLS, where under ADR 0089 it was DNS-only and GitHub did. The zone was already on
  Cloudflare, so nothing moves registrar or nameserver.
- **`apps/blog/public/CNAME` is gone.** It told GitHub Pages which domain it served; Cloudflare
  takes the custom domain from the project instead, and a stale file would only mislead.

## Consequences

- The URLs do not change. Every link in the consent screen, the runbooks and the posts keeps
  working.
- Pull requests still get the build as their check. Only `main` deploys, as before.
- `wrangler` joins the blog's dev dependencies, pinned like everything else.
- Pinning the blog to TypeScript 6 is part of this change, not a separate one: `astro check`
  refuses TypeScript 7, so the build had been failing since the dependency bump in #477, and a
  site that cannot build cannot be published anywhere.

## Rejected

- **Make the repository public again, or pay for a plan with Pages on private repositories.**
  Both are possible, but neither choice belongs to the blog. Whether the source is public is a
  product decision, and the blog should not force it either way.
- **Serve the blog from the Dokploy host.** ADR 0089 rejected this and the reason holds: the host
  is shared and memory-limited, and a static site needs no container there.
- **Upload with the account's global API key.** It is all of the account's authority, given to a
  job that only uploads files.
