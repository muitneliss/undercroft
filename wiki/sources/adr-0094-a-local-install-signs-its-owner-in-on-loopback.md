---
title: 'ADR 0094: A local install signs its owner in on loopback'
type: source
date: 2026-09-30
tags: []
source: docs/adr/0094-a-local-install-signs-its-owner-in-on-loopback.md
source_path: docs/adr/0094-a-local-install-signs-its-owner-in-on-loopback.md
source_hash: d7e47eb2b2560d1c33d9e09c633753630be2753e78965a94549f122768d84b6b
ingested: 2026-09-30
---

# ADR 0094: A local install signs its owner in on loopback

Accepted 2026-09-30. A one-click desktop install has one person in it, on the machine the server runs on, and usually no Google client or mail key to sign in with. The existing loopback-only Better Auth method, `UNDERCROFT_DEV_SIGN_IN_AS` (`POST /api/auth/sign-in/dev`, see [[Runbook Sign-In Setup]]), becomes a shipped mode for such an install rather than only a developer's tool.

Decisions: (1) the installer writes a loopback `UNDERCROFT_PUBLIC_URL` (`http://localhost:<port>`, published on `127.0.0.1` only) and one generated owner address as both `UNDERCROFT_DEV_SIGN_IN_AS` and `UNDERCROFT_SUPERADMINS`, so the owner is admissible uninvited and can create the first customer. (2) Safety rests on the refusal that already exists at construction -- `devSignIn` throws unless the public URL is loopback, and the server compose file never passes the variable -- plus a new one on the request: the endpoint refuses a request not addressed to the public URL's own host, because a web page can point its own name at `127.0.0.1` (DNS rebinding) and post as same-origin with no cookie, which Better Auth's origin check never inspects. The browser must be sent to exactly the public URL's origin. (3) The server tells the page its ways in through a public tRPC procedure, `config.signIn`, answering `{ methods }` from the list `createAuth` built -- the list the boot log prints -- naming methods and never an address. (4) The page signs the owner in by itself only when `dev` is the ONLY method offered, shows the server's refusal with a retry rather than looping, and a desktop install's root skips the public introduction; beside Google or mail the local method stays a button. (5) The first-party images are published for `linux/amd64` and `linux/arm64` as one manifest list per tag (QEMU on the amd64 runner, the SPA stage pinned to the build platform), reversing the amd64-only note in `build-images.yml`; every third-party image in the server compose file already publishes arm64.

Consequences: anything that reaches the loopback port under the public URL's host -- another program on the machine, a tab the owner opens there -- signs in as the owner, the trust a desktop install places in its own machine. The CLI still signs in by emailed code only; a desktop owner uses a personal access token.

Rejected: a "no auth" bypass around Better Auth (a second kind of caller every gate would have to know about); a second variable beside `UNDERCROFT_DEV_SIGN_IN_AS` (two switches for one door); keeping the click (friction with no safety -- the safety is the loopback refusal); deciding in the bundle (the same production image runs on a server and a laptop); native arm64 runners with a manifest merge (twice the workflow, left open if build time becomes the problem).
