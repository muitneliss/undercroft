---
title: ADR 0134 The CLI Signs In With a Personal Token When Nobody Is at Its Terminal
type: source
date: 2026-10-13
tags: []
source: docs/adr/0134-the-cli-signs-in-with-a-personal-token.md
source_path: docs/adr/0134-the-cli-signs-in-with-a-personal-token.md
source_hash: 301e982707c1c90e19cde9163ba2de1807ac2c795436d137841409df31c7bf4a
ingested: 2026-10-13
---

# ADR 0134 The CLI Signs In With a Personal Token When Nobody Is at Its Terminal

Issue #467. A CI job, a scheduled script or an agent with nobody at its terminal cannot read the emailed code the CLI signs in with ([[ADR 0044: An agent reaches Undercroft as a caller]]), and a session cookie copied into a CI secret is a browser session with no grant or expiry anyone chose. A personal access token ([[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]) is already the person's own credential with a `read`/`write` grant, an expiry of at most a year, and revocation at the next call -- but only `/mcp` read one. Supersedes in part ADR 0060's "`/trpc` stays cookie-only" and, for unattended runs, ADR 0044's "signs in with the email code and keeps the cookie".

**`/trpc` admits a personal token.** `apiContext` (`handlers/context.ts`) chooses the door by the request, the rule an export's download already used ([[ADR 0111 An Export Is a Link to a Streamed CSV]]): a request carrying `Authorization` is admitted by `bearerContext` and only by it, so a cookie never rescues a failed bearer; one without is the cookie door's. Same `resolveBearer`, same per-call read of the token row, same audit row for a refusal. A refused bearer is nobody, answered UNAUTHORIZED; nobody's grant is `write` at both doors so the grant guard never answers a dead credential as a forbidden write. The grant guard on the base procedure still refuses a `read` token anything not a read (`WRITES_DISABLED` with the grant in the facts), and `sessionProcedure` keeps `account.*` from any token. Only a personal token: an OAuth access token's audience is `/mcp`, so `/trpc` refuses one as `unknown` before verifying it (`Bearers` = `any | personal`). The audit channel is `cli` for any caller sending the CLI's header, and the row keeps the token id as `credential`.

**The CLI keeps the variable's name, never the token.** `undercroft auth login --token-env <VARIABLE>` reads the variable, proves the token with `session.me`, and stores `{ email, tokenEnv }` under the origin in `credentials.json`. Every request reads the variable again and sends `Authorization: Bearer` with no cookie, so the token is in no argv, file or envelope and rotation is changing the variable. An unset variable is `AUTHENTICATION_REQUIRED` naming it, before any request; a refused token is `AUTHENTICATION_REQUIRED` saying to mint a new one on `/account`; a grant refusal stays `PERMISSION_DENIED` with the server's facts plus `needs: "write"`. `allowWrites` is still decided first on the client, so a `write` token writes only through a profile a person allowed writes on. `auth logout` forgets the variable and does not revoke the token; `auth status` and `config show` report `signedInWith: "token"` and the variable's name.

**Not a service token**: it is a person's own, resolved to its owner on every call, reaching only what they reach and dying with their account.

**Rejected.** The token as a flag value (argv is visible to other processes and kept in history; a value that is not a variable name -- a token always holds a `.` -- is refused without being echoed); storing the token in `credentials.json`; a new token kind for the CLI; reading bearer and cookie side by side with either admitting (a cookie would rescue a revoked token); admitting OAuth access tokens at `/trpc`.
