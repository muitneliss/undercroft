---
title: >-
  ADR 0059: An agent reaches Undercroft over MCP, with a credential a person
  holds
type: source
date: 2026-09-25
tags: []
source: docs/adr/0059-an-agent-reaches-undercroft-over-mcp.md
source_path: docs/adr/0059-an-agent-reaches-undercroft-over-mcp.md
source_hash: 57764f25163381967afb9c81b214c93d6d29c1fa8ba673e2e9997a18c33dfbeb
ingested: 2026-09-25
---

# ADR 0059: An agent reaches Undercroft over MCP, with a credential a person holds

# ADR 0059: An agent reaches Undercroft over MCP, with a credential a person holds

Accepted 2026-09-25. Supersedes two of [[ADR 0044: An agent reaches Undercroft as a caller]]'s rejected options -- "An MCP server" and "Device flow or a bearer token" -- and nothing else of it: its rejection of a service token stands. Extends [[ADR 0029: The assistant is an interleaf, and it acts only through the router]]'s rule that a caller acts only through the router's own procedures to a third door; the OAuth follow-up must keep [[ADR 0010 Invite-Only Sign-In with Better Auth]].

**Context.** A person wants Claude (claude.ai, Desktop, Code) to do what the web UI does. ADR 0044's two reasons no longer hold: claude.ai's connectors cannot run a command, only speak MCP over HTTP, and the server need not be a process -- it can be a stateless route on the control plane; and an MCP host cannot run the emailed-code sign-in, it presents `Authorization: Bearer` (a pasted token, or one from the MCP OAuth flow). Since #228, ADR 0044's one hand-written table (`apps/cli/src/procedures.ts`) lives in `apps/control-plane/src/handlers/surface.ts`, typed against the router, beside the per-procedure sentences, so a model-context door can be built from the manifest the CLI bakes.

**Decision.** `/mcp` is a route in `handlers/server.ts`, before the SPA catch-all; every call goes through `appRouter.createCaller(ctx)`, and each request gets a fresh low-level MCP `Server` bound to its `Context`, served statelessly, so a revoked credential stops at the next call. SDK: `@modelcontextprotocol/server` 2.1.0 (low-level `Server` + `createMcpHandler(factory, { legacy: "stateless" })`, a fetch handler serving both the 2026-07-28 and 2025-era protocols), tested with `@modelcontextprotocol/client` 2.1.0 over real HTTP.

The credential is a **personal access token** in `app.access_token` (`290_mcp_access.sql`): `upat_<id>.<secret>`, digest stored, shown once, minting and revoking audited, minted on the new `/account` page with a label, a grant and an expiry of at most a year (a table CHECK as well as the form). It belongs to a person and reaches what they reach in every tenant through the same role gates; it cascades from `app.app_user` and the owner is re-resolved per request. `handlers/context.ts` has two identity steps -- `sessionIdentity` (cookie, for `/trpc` and the assistant) and `resolveBearer` (`Authorization: Bearer` only, never the cookie, for `/mcp`) -- feeding one shared tail (`appUserForEmail`, superadmin, locale). `/trpc` stays cookie-only; a non-`upat_` bearer admits nobody until the OAuth follow-up.

Every credential carries a **grant**, `read` or `write`; a browser session is always `write`. The guard is on the router's base procedure in `handlers/trpc.ts`: a `read` grant is refused any call whose `effectOf` is not `read`, unclassified included (fails closed). `/mcp` lists only admitted tools and re-checks on call to answer `WRITES_DISABLED`. The policy is one function, `grantAdmits`. `account.tokens.*` are built on `sessionProcedure`, which refuses a bearer, so no credential can mint a credential; `SESSION_ONLY` names them and the router walk refuses a router where list and middleware disagree.

Tools are `procedureManifest()` less `MCP_EXCLUDED` (`session.signOut`, `health`, `config.google`) and `SESSION_ONLY`, named path with `.` as `_` (the walk refuses a collision), input = the procedure's JSON Schema as an object, annotations from the effect (`readOnlyHint`, `destructiveHint`; idempotency never claimed), descriptions in the caller's locale, Vietnamese by default. A result is whole in `structuredContent` (a list as `{ items }`) plus JSON text clipped to 50 items per list and 60 KB with a worded note per cut. A refusal is `isError` with the `BY_TRPC_CODE` code, the router's sentence, its facts and the trace id ([[ADR 0058: Every request is traced, into the host's shared otel-lgtm stack]]). No live bearer is a 401 naming `<origin>/.well-known/oauth-protected-resource/mcp`; `/.well-known/*` is a 404 until the follow-up serves it. One `mcp_call` log line per call, never arguments or results.

**Follow-up in the same decision.** Better Auth's MCP plugin as authorization server with Google sign-in through the same invite-only gates and a consent page choosing `read`/`write`, verified in `resolveBearer` with the consent re-read per request; and two widgets (a result grid, a live run status) as MCP resources -- ADR 0029's rejection of widgets was about iframes in Undercroft's own page.

**Rejected.** A separate MCP process or the CLI wrapped as a stdio server (a second rebuild of the surface; stdio needs a shell); a tenant-scoped or service token (no person behind it), and a person's token scoped to one tenant (the person's own reach is simpler and mirrors the browser); the grant as an MCP-only filter (binds one door); per-procedure scopes (the effect table already draws the line, and destructive writes get the host's confirmation via `destructiveHint`); non-expiring tokens; stateful MCP sessions (a revoked token would outlive its revocation); English-only descriptions; the v1 `@modelcontextprotocol/sdk` (v2 is the stable line; its zod 4 dependency installs beside the repo's zod 3 as Better Auth's does).

**Consequences.** A procedure added to the router is an MCP tool at the next boot with no hand-written list, `tsc` still requiring its sentences and, for a mutation, its effect. A token does exactly what its owner can and a read token only reads. `/account` is the only place tokens are minted or revoked. A read credential makes an unclassified procedure a refusal at the router, which `EFFECTS` being total over mutations keeps unreachable. Setup is in `docs/runbook/mcp-setup.md`.
