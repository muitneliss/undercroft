---
title: 'ADR 0061: An MCP client signs its person in, and draws two widgets'
type: source
date: 2026-09-25
tags: []
source: docs/adr/0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md
source_path: docs/adr/0061-an-mcp-client-signs-its-person-in-and-draws-two-widgets.md
source_hash: 67a26990dadfdd86d4901c48bc61d6d003ad3a844c67bcdc6b7eb1ea0098da36
ingested: 2026-09-25
---

# ADR 0061: An MCP client signs its person in, and draws two widgets

# ADR 0061: An MCP client signs its person in, and draws two widgets

Accepted 2026-09-25. Implements the follow-up [[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]] described; ADR 0060 stands in full. Keeps [[ADR 0010 Invite-Only Sign-In with Better Auth]]'s gates, and explains why [[ADR 0029: The assistant is an interleaf, and it acts only through the router]]'s rejection of widgets (iframes in Undercroft's own page) does not apply to widgets a host draws.

**Authorization server.** `@better-auth/mcp` 1.7.5 over `@better-auth/oauth-provider` 1.7.5 (pinned directly so its caret cannot pull 1.7.6) plus `jwt()`, configured in `handlers/mcpAuth.ts`. Resource `<UNDERCROFT_PUBLIC_URL>/mcp`. The issuer is the public ORIGIN, not `/api/auth`, so every discovery document (RFC 9728 protected resource, RFC 8414 AS metadata, OpenID configuration) is at the root; `server.ts` hands `/.well-known/*` to Better Auth's handler, whose plugins answer in `onRequest` before the base-path check. Only for HTTPS or loopback HTTP; a plain-HTTP LAN deployment gets personal tokens only.

**Clients.** Open dynamic client registration (RFC 7591), the one path Better Auth's rate limiter covers (5/min per address; the limiter is otherwise off because it follows NODE\_ENV). `clientPrivileges`/`resourcePrivileges` answer false, no `client_credentials` grant, the jwt `/token` endpoint disabled.

**Verification.** `resolveBearer` admits a non-`upat_` bearer via `McpAuth.admit`: jose verification against the key set from Better Auth's `getJwks` (issuer = origin, audience = the `/mcp` resource, `typ` at+jwt, expiry) -- not HTTP to `/jwks`, not `verifyJWT`; the consent row read on every request; the person must exist, then the shared tail requires the `app_user`. Grant = the LESSER of token scopes and consent scopes, `undercroft:write` implying `undercroft:read` (`services/connectedApps.ts`). A live token granting neither gets 403 `insufficient_scope` naming `undercroft:read`; DPoP-bound (`cnf`) and opaque tokens are refused. Access tokens live 15 minutes; `offline_access` brings a refresh token.

**Pages.** Sign-in happens on the SPA's `/sign-in` (the same gates) with the request signed into the URL; `oauthProviderClient()` forwards it only from such a page. Google is carried through by Better Auth, with `callbackURL` resuming the authorize URL as a fallback. `/consent` shows the client's self-asserted name and redirect host, read only by default, read-and-write only if asked, refusal only for a request of neither. `/account` gains Connected apps (`account.apps.list`/`revoke`, session-only); revoking deletes the consent and revokes the app's refresh tokens. Tables in `310_mcp_oauth.sql`, mapped in `handlers/authSchema.ts`, held to the migrated schema by `authSchema.test.ts`.

**Widgets.** `apps/mcp-widgets` (ext-apps 2.0.0): a grid for seven query-shaped reads, a run status for `runs.trigger`/`runs.get`; `MCP_WIDGETS` in `surface.ts` maps them and `ToolContentOf<P>` types their data from the router. Built once per process with `Bun.build` and inlined into one self-contained page each (app-with-deps, \~400 KB); a failed build means no widgets and unchanged `/mcp`. Resources `ui://undercroft/grid.html` and `run.html`, MIME `text/html;profile=mcp-app`, no CSP domains; tools carry `_meta.ui.resourceUri`, results `_meta["undercroft/call"]`. The grid prints cells like the web UI's ResultTable (numeric strings verbatim, MISSING for null), 500 rows max; the run widget polls every 2 s and stops at a terminal status, 30 minutes, or a hidden frame. Theme, CSS variables, safe-area insets and language follow the host.

**Rejected.** An issuer at `/api/auth` with our own discovery route; `requireMcpAuth`/`createMcpProtectedRequestHandler` (second verifier, HTTP JWKS); trusting token scopes alone; introspecting opaque tokens; CIMD instead of open registration (follow-up); building widgets into the image or serving scripts as files; React or the plain ext-apps build in the widgets.

**Consequences.** Connectors connect by URL alone; eight more Better Auth tables in `app`, granted to `undercroft_app` only; a client registering a loopback redirect as a web application is refused (MCP SDK 2.x registers native); the Google leg is unproven offline.
