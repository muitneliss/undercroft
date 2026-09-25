---
title: >-
  ADR 0062: A refused bearer is logged with its reason, and an access token
  lives eight hours
type: source
date: 2026-09-25
tags: []
source: >-
  docs/adr/0062-a-refused-bearer-is-logged-and-an-access-token-lives-eight-hours.md
source_path: >-
  docs/adr/0062-a-refused-bearer-is-logged-and-an-access-token-lives-eight-hours.md
source_hash: 44509eb49cf4eac4f9c7ff3137348a75e1d6f3951998873982f937ad6d0a7c73
ingested: 2026-09-25
---

# ADR 0062: A refused bearer is logged with its reason, and an access token lives eight hours

# ADR 0062: A refused bearer is logged with its reason, and an access token lives eight hours

Accepted 2026-09-25. Supersedes one sentence of [[ADR 0061: An MCP client signs its person in, and draws two widgets]], "Access tokens live 15 minutes"; the rest of ADR 0061 stands, the refresh token included. Extends [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]'s one log line per call to the requests that never become a call, and [[ADR 0058: Every request is traced, into the host's shared otel-lgtm stack]]'s trace search to a status that is not an error.

**Context.** A Kanna MCP client connected over OAuth, worked for about ten minutes, then failed, and nothing could be found: `/mcp` logged nothing when it refused a bearer (only authenticated requests reach `mcp_call`), a 401 is not an error span so `task obs:search FOR=errors` missed it, and the client never showed the `x-trace-id`. The bearer chain also collapsed every cause into `null`/`invalid_token`. Likeliest cause: the 15-minute access token, with Kanna reusing the bearer it read at session spawn (fixed separately).

**Refusals are logged with a reason.** The chain carries `{ reason, credentialId? }` up to the door instead of collapsing it. Reasons: `missing` (no bearer; also every OAuth client's first contact) and `insufficient_scope` in `resolveBearer`; `malformed`, `unknown`, `expired` from `verifyAccessToken` (`handlers/mcpAccessToken.ts`, the only module calling jose) and `accessTokens.admit` (`unknown`, `revoked`, `expired` for a personal token); `revoked` and `no_person` from `McpAuth.admit` (consent gone, Better Auth user gone); `no_person` again from `bearerContext` when the shared tail finds no `app_user`; `unknown` when no authorization server runs. `/mcp` writes one `mcp_refused` line: `status`, `refusal` (the RFC 6750 code), `reason`, `credential` when proven, and the `traceId` of the 401. `credential` is the `upat_…` id of a token whose row was found, or `oauth:<clientId>` from a JWT whose signature verified; never the token or its secret, never an unproven prefix. An expired JWT still names its client because jose 6.2.12 checks the signature before any claim and checks typ, issuer and audience before `exp`. Level `warn`, except `missing` at `info`.

**The client sees nothing new.** `challengeError` in `handlers/mcp.ts` is the one place a reason becomes RFC 6750's code: `insufficient_scope` is the 403 naming the scope, every other reason the same 401 with the same challenge and body. `mcp.test.ts` pins a revoked token's response as identical to no token's.

**Findable.** `task obs:search FOR=status=<code>` searches server spans by `span.http.response.status_code`, scoped to Undercroft services; `FOR=status=401` lists refused requests and `task obs:logs FOR=mcp_refused` gives the reasons. The `debug-trace` skill and [[Runbook: Connecting an agent over MCP]] say so.

**Access tokens live eight hours.** `ACCESS_TOKEN_SECONDS = 8 * 60 * 60`. Revocation does not depend on expiry: the consent and the person are read on every request, so revoking on `/account` stops the app at its next call. Fifteen minutes only broke clients that do not refresh mid-session; eight hours is what Anthropic's own MCP authorization server issues. Cost: a copied token works up to eight hours for as long as its consent and person stand. Applies to tokens issued after the deploy.

**Rejected.** Logging at each place a reason is decided (five places, none knows the status); carrying the RFC 6750 code beside the reason (derivable, could disagree); telling the client the reason (an oracle for guessed tokens); marking a 401 an error span (buries the 5xx); keeping 15 minutes and relying on clients to refresh.

**Consequences.** "It stopped working" becomes `expired`, `revoked` or `no_person`. A personal token whose person was deleted reads `unknown` (its row cascades away). Each OAuth client's first contact writes one `info` line.
