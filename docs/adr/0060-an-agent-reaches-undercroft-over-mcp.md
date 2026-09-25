# 60. An agent reaches Undercroft over MCP, with a credential a person holds

- Status: Accepted
- Date: 2026-09-25
- Supersedes: two of [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md)'s rejected
  options, "An MCP server" and "Device flow or a bearer token". The rest of ADR 0044 stands,
  its rejection of a service token included.
- Relates to: [ADR 0029](0029-the-assistant-is-an-interleaf.md), whose rule that a caller acts
  only through the router's own procedures this extends to a third door;
  [ADR 0010](0010-invite-only-sign-in-with-better-auth.md), whose invite-only sign-in the
  follow-up's OAuth flow must keep.

## Context

A person wants Claude -- on claude.ai, in Claude Desktop, in Claude Code -- to do in Undercroft
what the web UI does. ADR 0044 answered that for an agent with a shell: the CLI, installed by a
skill. It rejected an MCP server and a bearer token on the way. Both reasons have moved:

- **"Another long-running process, holding a session, for clients that can already run a
  command."** claude.ai's connectors cannot run a command. They speak MCP over HTTP to a URL
  and nothing else. And the server need not be a process: it can be one more route on the
  control plane, holding nothing between requests.
- **"A new auth surface for a problem the email code already solves."** An MCP host does not
  run an emailed-code sign-in. It presents `Authorization: Bearer`: a token a person pasted into
  the host's configuration, or one it obtained through the MCP OAuth flow. There is no third
  way in.

Since #228 the router is also the source of truth for everything a caller outside the browser
needs: ADR 0044's "one hand-written table", `apps/cli/src/procedures.ts`, moved to
`apps/control-plane/src/handlers/surface.ts`, typed against the router, beside the per-procedure
sentences in `apps/control-plane/src/i18n/procedures.{vi,en}.ts`. A model-context door can
therefore be built from the same manifest the CLI bakes, with nothing hand-written per tool.

## Decision

### `/mcp` is one more door onto the router, on the control plane

`POST /mcp` (every method, in fact) is a route in `handlers/server.ts`, registered before the
SPA's catch-all. Every tool call goes through `appRouter.createCaller(ctx)`, the door the
assistant uses, so the role gates, the 404-not-403 boundary and the worded refusals are the
router's and cannot drift. It is served statelessly: each request gets a fresh low-level MCP
`Server` bound to that request's `Context`, and nothing outlives it. The credential is
therefore re-read on every request, and revoking one takes effect at the next call.

The SDK is `@modelcontextprotocol/server` 2.1.0, pinned: the low-level `Server` and
`createMcpHandler(factory, { legacy: "stateless" })`, a web-standard `fetch` handler that fits a
Hono route under Bun and answers both the 2026-07-28 protocol and 2025-era clients. The suite
drives it with `@modelcontextprotocol/client` 2.1.0 over real HTTP.

### The credential is a person's own token

`app.access_token` (`300_mcp_access.sql`) holds **personal access tokens**, `upat_<id>.<secret>`,
following `keys.ts`: the digest is stored, the token is shown once, minting and revoking are
audited. A person mints one on the new account page (`/account`, reached from their address in
the running head) with a label, a grant and an expiry of at most a year, which the table's CHECK
enforces as well as the form.

**This is not the service token ADR 0044 rejected, and that rejection stands.** A service token
is a credential with no person behind it. This one belongs to a person and reaches exactly what
they reach -- every tenant they are a member of, through the same role gates, never more. It
dies with them: `ON DELETE CASCADE` from `app.app_user`, and the door re-resolves the owner's
`app_user` on every request, so removing someone's access removes their tokens' at once.

`handlers/context.ts` reads identity in two ways and decides everything after in one place:

- `sessionIdentity` reads the cookie (`/trpc`, the assistant);
- `resolveBearer` reads `Authorization: Bearer` and never the cookie (`/mcp`);
- both yield an authenticated address, a credential id and a grant, and one shared tail
  (`appUserForEmail`, the superadmin list, the locale) turns that into the caller.

`/trpc` stays cookie-only. A bearer that is not a personal token admits nobody -- the one branch
the OAuth follow-up adds to.

### Every credential carries a grant, enforced at the one door

A person chooses `read` or `write` when minting a token. A browser session is always `write`: it
is the person, at their own screen.

- **The guard is on the base procedure** in `handlers/trpc.ts`. For a `read` grant it refuses any
  call whose effect (`effectOf`, from `EFFECTS`) is not `read`, an unclassified one included, so
  it fails closed. It is not in the MCP handler, because a check in one door binds one door.
- **`/mcp` lists only what the grant admits**, and re-checks on a call so that it can refuse with
  the code an agent already matches on, `WRITES_DISABLED`.
- **A credential cannot mint a credential.** The `account.tokens.*` procedures are built on a
  new `sessionProcedure`, which refuses a bearer. Otherwise a read token could mint itself a write
  one and the grant would bind nothing. `SESSION_ONLY` in `surface.ts` names them for a door that
  holds only bearers, and the router walk refuses a router where that list and the middleware
  disagree. The CLI keeps them: it signs in with the same session cookie a browser does.

The policy itself is one function, `grantAdmits(grant, effect)`, asked by both.

### What a model-context client is offered, and how it is told

- **Tools** are `procedureManifest()` less `MCP_EXCLUDED` (`session.signOut`, `health`,
  `config.google`, each with its reason) and less `SESSION_ONLY`. A tool is named by its path
  with `.` as `_`, and the walk refuses two paths that would share a name. Its input schema is the
  procedure's own JSON Schema, as an object. Its annotations come from the effect: `readOnlyHint`
  for a read, `destructiveHint` for a destructive write; idempotency is never claimed.
- **Descriptions follow the caller's locale**, Vietnamese by default. A host shows them to a
  person, and `.claude/rules/i18n.md` forbids text a person reads in one language only.
- **A result** is the whole answer in `structuredContent` (a list wrapped as `{ items }`) and a
  JSON text for the model, clipped to 50 items per list and 60 KB. Each cut is named in a worded
  note, never silent, because a list cut off without saying so reads as all there is.
- **A refusal** is `isError` with the surface's code (`BY_TRPC_CODE`, the CLI's vocabulary), the
  router's sentence, its facts, and the request's trace id (ADR 0058).
- **No live bearer** is a 401 whose `WWW-Authenticate: Bearer` names
  `<origin>/.well-known/oauth-protected-resource/mcp`, the RFC 9728 document an MCP client follows
  to learn how to get a token. Until the follow-up serves it, `/.well-known/*` is a 404 rather
  than the app shell.
- **One log line per call**, `mcp_call`, naming the tool, the credential's id and the outcome,
  never the arguments or the result.

### What follows: Google sign-in for connectors, and two widgets

This ADR records the whole decision; the second half lands in a follow-up change.

- **OAuth.** Better Auth's MCP plugin makes the control plane an authorization server. The
  authorize step signs the person in through the same page and the same invite-only gates
  (ADR 0010), and a consent page asks for `read` or `write`. `resolveBearer` verifies that access
  token beside the personal one and reads the consent on every request, so the same grant rules
  and the same revocation hold.
- **Widgets.** A result grid and a live run status, served as MCP resources. ADR 0029's rejection
  of widgets was about iframes inside Undercroft's own page, which is not this.

## Options rejected

- **A separate MCP process, or the CLI wrapped as a stdio server.** Either is a second place the
  platform's surface is rebuilt, and stdio needs a shell, which claude.ai's connectors do not
  have.
- **A tenant-scoped or service token.** It has no person behind it and cannot be tied to the
  invitation model; ADR 0044's reasoning still holds. A person's token scoped to one tenant was
  also considered: the person's own reach, in every tenant, through the same role gates, is the
  simpler rule and the one that mirrors the browser.
- **The grant as a filter in the MCP handler only.** It would bind that door and no other. The
  guard is at the router's root, where every door passes.
- **Per-procedure scopes.** The effect table already has the distinction that matters. What a
  destructive write needs beyond `write` is a person's confirmation, which the host gives on
  `destructiveHint`.
- **A token that does not expire.** Nobody remembers minting it. A year is the ceiling.
- **Stateful MCP sessions.** A session would keep a revoked token working until it ended.
- **English-only tool descriptions.** A host shows them to the person, who reads Vietnamese.
- **`@modelcontextprotocol/sdk`, the v1 package.** v2 is the stable line, and its
  `createMcpHandler` is a fetch handler that needs no Node adapter under Bun. Its zod 4 dependency
  installs beside the repo's zod 3 without conflict, as Better Auth's already does.

## Consequences

- A procedure added to the router is an MCP tool at the next boot, as it is a CLI command at the
  next build, with no hand-written list. `tsc` still requires its sentence in both languages and,
  for a mutation, its effect.
- A personal token can do exactly what its owner can in the browser, and no more; a read token
  can do nothing that is not classified a read.
- The account page is new, and it is the only place a token is minted or revoked.
- A read-only credential now exists, so an unclassified procedure is refused to it at the router.
  `EFFECTS` being total over mutations is what makes that refusal unreachable in practice.
- `docs/runbook/mcp-setup.md` covers connecting Claude Code and Claude Desktop with a token.
