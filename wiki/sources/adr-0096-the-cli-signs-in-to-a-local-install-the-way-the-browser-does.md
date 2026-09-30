---
title: 'ADR 0096: The CLI signs in to a local install the way the browser does'
type: source
date: 2026-09-30
tags: []
source: docs/adr/0096-the-cli-signs-in-to-a-local-install-the-way-the-browser-does.md
source_path: docs/adr/0096-the-cli-signs-in-to-a-local-install-the-way-the-browser-does.md
source_hash: 45a5b3a3585d447734cd34cd3550522e12181489ee3524ade16c60486531f672
ingested: 2026-09-30
---

# ADR 0096: The CLI signs in to a local install the way the browser does

Accepted 2026-09-30. Supersedes one consequence of [[ADR 0094: A local install signs its owner in on loopback]] -- that a desktop owner would use the CLI with a personal access token -- which was never true: the CLI keeps a session cookie per origin and has no bearer path. The rest of ADR 0094 stands, and the CLI stays a caller over HTTP with a person's own session ([[ADR 0044: An agent reaches Undercroft as a caller]]).

Decisions: (1) the CLI signs in with the page's own local method, `POST /api/auth/sign-in/dev` over `node:http`, and stores the session cookie under its origin in `credentials.json` exactly as an emailed-code session is stored; the address comes from the server's answer, never the request. (2) It is chosen as the page chooses it, from the server: `auth login` with neither `--email` nor `--code` asks `config.signIn`, and when the local method is the only one offered it signs in without asking; the home page does the same and goes straight to the contents. Offered beside the emailed code, `auth login --local` is the CLI's equivalent of the page's button. A server that cannot say (older) is not assumed to be a desktop install. (3) `--local` against a non-loopback URL is refused before any request with a localized INVALID\_ARGUMENT; the loopback host set moved to `@undercroft/core/loopback` so the CLI's check and the server's (`devSignIn.ts`, `mcpAuth.ts`) cannot disagree. (4) The request goes to the configured origin exactly, so the server's Host check applies; a `127.0.0.1` profile for a `localhost` install gets PERMISSION\_DENIED with the server's own sentence naming the address to use, now worded for any door rather than "open the page". (5) Signing in grants no writes: `allowWrites` remains a per-profile setting only a person at a terminal can turn on. (6) A desktop install's last installer lines print `undercroft config set-profile local --url <url>` and `undercroft auth login`.

Consequences: on a desktop install `auth login` (also with `--agent`, in one step) signs the owner in; anything on the machine that can run the CLI can do so, the trust ADR 0094 already places in the machine; `auth login` makes one extra `config.signIn` request when given no address.

Rejected: a service token or CLI-only loopback bypass (a second credential with no session, the backdoor `cli-no-backdoor` guards); reading the installer's `.env` to learn the address or mint a session (it holds `UNDERCROFT_SECRET_KEY`, which forges any session); a personal access token from `/account` (a second auth path, and the friction the local method removes); a profile field marking a profile local (a second switch that can disagree with the server); trying local first then email (chooses the method that proves nothing where one that does was configured).
