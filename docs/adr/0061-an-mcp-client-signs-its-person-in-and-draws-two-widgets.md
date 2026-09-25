# 61. An MCP client signs its person in, and draws two widgets

- Status: Accepted
- Date: 2026-09-25
- Implements: the follow-up [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md) described
  under "What follows". ADR 0060 stands in full; this records the decisions it left open and
  the places the implementation is more specific than its summary.
- Relates to: [ADR 0010](0010-invite-only-sign-in-with-better-auth.md), whose invite-only
  sign-in the authorization flow goes through unchanged;
  [ADR 0029](0029-the-assistant-is-an-interleaf.md), whose rejection of widgets is about a
  different page.

## Context

ADR 0060 put the router behind `/mcp` for a client holding a personal access token, and said
the second half -- a claude.ai connector that cannot be handed a token, and two widgets --
would follow: Better Auth's MCP plugin as the authorization server, sign-in through the same
page and gates, a consent page choosing `read` or `write`, the consent read on every request.
Building it settled a dozen questions that summary did not answer, and some of the answers are
not the obvious ones.

## Decision

### Better Auth is the authorization server; the issuer is the public origin

`@better-auth/mcp` 1.7.5 (over `@better-auth/oauth-provider` 1.7.5, pinned directly so its
caret cannot pull a 1.7.6 that wants a newer `better-auth`) and `jwt()` are added to the Better
Auth instance (`handlers/mcpAuth.ts`). The resource is `<UNDERCROFT_PUBLIC_URL>/mcp`.

**The issuer is the origin, not Better Auth's `/api/auth`.** With a path in the issuer, RFC 8414
puts the metadata at `/.well-known/oauth-authorization-server/api/auth`, OpenID at
`/api/auth/.well-known/openid-configuration`, and a client that probes the third spelling finds
nothing. At the origin every document is at the root, and `server.ts` hands `/.well-known/*` to
Better Auth's own handler: the provider and MCP plugins answer those paths in `onRequest`, which
Better Auth runs before its base-path check, and anything else is a plain 404. So there is no
discovery code of ours at all.

It runs only where MCP allows a resource: HTTPS, or HTTP on loopback. A deployment on plain HTTP
off loopback boots, signs people in, and offers personal tokens only.

### Registration is open, and everything else about clients is closed

Dynamic client registration (RFC 7591) is on and needs no session, because a connector registers
before any person is involved; a registered client can do nothing until a person signs in and
consents. It is the one path Better Auth's rate limiter covers, 5 a minute per address:
the limiter is otherwise off here (it follows `NODE_ENV`, which the deployment does not set), and
switching all of it on would also switch on sign-in limits keyed on a forwarded address nothing
here has verified behind the proxy.

The provider's own client and resource management endpoints are refused to everyone
(`clientPrivileges` and `resourcePrivileges` answer `false`): left unset, any signed-in session
could create clients or rewrite a resource's token policy. There is no `client_credentials`
grant -- a token with no person behind it is the service token ADR 0044 rejected -- and the jwt
plugin's session-token endpoint (`/token`) is disabled.

### A token is verified in process, and the consent decides

`resolveBearer` (`handlers/context.ts`) admits a bearer that is not `upat_…` through
`McpAuth.admit`, which:

- verifies the JWT with `jose` against the key set read through Better Auth's `getJwks` --
  signature, issuer (the origin), audience (the `/mcp` resource, never the base URL), `typ`
  `at+jwt`, expiry. Not an HTTP call to our own `/jwks`; not `verifyJWT`, which accepts only the
  base URL as audience;
- reads the consent row for (client, person) on **every** request, so revoking it stops the
  client at the next call, as a personal token does;
- requires the person to exist, and the shared tail then requires their `app_user` row
  (ADR 0010).

**The grant is the lesser of the token's scopes and the consent's**, with `undercroft:write`
implying `undercroft:read` (`services/connectedApps.ts`). A token minted under a write consent
stops writing the moment the person narrows it; a read token does not start writing because a
later consent widened.

A live token its person consented to that holds neither scope is answered **403
`insufficient_scope`** naming `undercroft:read`, so a client asks for the scope rather than for
the same token again; every other failure is ADR 0060's 401. Two kinds of token are refused
outright:

- a DPoP-bound token (a `cnf` claim): this door does not check DPoP proofs, and honouring it as a
  plain bearer would undo the binding;
- an opaque token, which the provider issues when the client names no `resource`. MCP clients
  are required to name it.

Access tokens live 15 minutes; `offline_access` gives a refresh token, which the MCP SDK asks
for by itself.

### Sign-in and consent are the SPA's own pages

The authorize step sends the person to `/sign-in` with the request signed into the URL; the
same page and the same three gates of ADR 0010 apply. `oauthProviderClient()` puts the signed
query on the Better Auth calls made from such a page (it reads `sig` off the URL and adds
nothing elsewhere), and the server then answers a sign-in with where the authorization continues.
For Google, Better Auth carries the request through the round trip itself, and `callbackURL` is
the unsigned authorize URL as a way back regardless.

`/consent` shows the client's self-asserted name beside the host it redirects to, offers read
(the default) and read-and-write only if the client asked for write, and can only refuse a
request for neither. `/account` gains **Connected apps**: `account.apps.list` and
`account.apps.revoke`, session-only like the tokens; revoking deletes the consent and stamps
`revoked` on the app's refresh tokens.

The provider's tables are `310_mcp_oauth.sql`, transcribed from the plugins' exported schema,
mapped in `handlers/authSchema.ts`, and held to the migrated schema by `authSchema.test.ts`,
because every other suite runs Better Auth on its in-memory adapter.

### Two widgets, built at boot, drawn by the host

`apps/mcp-widgets` holds a **grid** (the seven query-shaped reads) and a **run status**
(`runs.trigger`, `runs.get`), written against `@modelcontextprotocol/ext-apps` 2.0.0. Which
procedure each draws is `MCP_WIDGETS` in `surface.ts`, and each widget reads its data typed as
`ToolContentOf<P>` -- the procedure's output as the door wraps it -- so a router change breaks
the widget's compile, not a page in someone's chat.

- **Built once per process** by `widgets.ts` with `Bun.build`, and inlined into one HTML page
  each: the host's frame fetches nothing, so the page carries every byte, including the
  `app-with-deps` build of ext-apps (about 400 KB a page). A failed build is logged and answered
  with no widgets; `/mcp` then serves exactly what it served before.
- **Served as resources** `ui://undercroft/grid.html` and `ui://undercroft/run.html`, MIME
  `text/html;profile=mcp-app`, with no CSP domains; a drawn tool names its page in
  `_meta.ui.resourceUri` (and the older flat key), and its result carries
  `_meta["undercroft/call"]` -- the procedure and tenant -- so the widget knows what it holds.
  Every result still carries its text and structured content, which is what a host without the
  extension shows.
- **The grid prints a cell as the web UI's `ResultTable` does** -- a numeric string verbatim,
  MISSING for null, never a `Number()` -- at most 500 rows, saying how many it left out. The run
  widget asks `runs_get` and `runs_events` through the host every 2 s, and stops at a terminal
  status, after 30 minutes, or while the frame is hidden.
- They follow the host's theme, CSS variables, safe-area insets and language (`vi` unless the
  host names `en`).

ADR 0029 rejected widgets as iframes inside Undercroft's own page, where a frame is a second
security context in the product's origin. These are drawn by somebody else's host, in its
sandbox, and read only through `/mcp` with the credential the chat already holds.

## Options rejected

- **The issuer at `/api/auth`, with a discovery route of our own** for the spelling Better Auth
  does not serve. More code, one more place for two answers to diverge, and no gain.
- **`requireMcpAuth` / `createMcpProtectedRequestHandler` around `/mcp`.** They own the challenge
  and verify through an HTTP fetch of `/jwks`; the door already owns its challenge, and a second
  verifier beside `resolveBearer` would be two definitions of who the caller is.
- **Trusting the token's scopes alone.** A JWT cannot be withdrawn; the consent can. Reading it
  per request is one indexed query for a promise the account page makes.
- **Introspecting opaque tokens.** A second verification path for clients the MCP specification
  already requires to name the resource.
- **Client ID Metadata Documents instead of open registration.** The MCP specification's newer
  mechanism, and a follow-up: open registration is what today's connectors do, and a client that
  registers still reaches nothing without a person's consent.
- **Building the widgets into the image, or serving their scripts as files.** A second artefact
  to keep in step with its source, and a script the host's CSP would refuse to fetch.
- **React, or the plain `ext-apps` build, in the widgets.** The first is weight two small pages do
  not need; the second needs zod 4 and the MCP client resolved at bundle time beside the repo's
  zod 3, for a smaller page that is a follow-up to measure, not a reason to risk the build.

## Consequences

- A claude.ai, Claude Desktop or Claude Code connector can be added by URL alone; the person
  signs in with Google or an emailed code and picks read or write. `docs/runbook/mcp-setup.md`
  covers each.
- `app` has eight more tables written by Better Auth, granted to `undercroft_app` only.
- A client whose loopback redirect registers as a `web` application is refused by the provider
  (HTTP redirects are for `native` clients). The MCP SDK 2.x derives `native` from a loopback
  redirect; an older client may not.
- The Google leg of the flow cannot be proved offline; the gate proves the emailed-code leg end
  to end with the real MCP client.
- Better Auth logs one warning per process in the suites, where requests carry no client
  address for the registration limiter to key on.
