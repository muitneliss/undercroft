---
title: ADR 0112 Every Action Is in the Audit Log and People Can Read It
type: source
date: 2026-10-06
tags: []
source: docs/adr/0112-every-action-is-in-the-audit-log-and-people-can-read-it.md
source_path: docs/adr/0112-every-action-is-in-the-audit-log-and-people-can-read-it.md
source_hash: 68279155531a080ec2b9bb61ccc898af7558455683fe51fe895685aaf2563006
ingested: 2026-10-06
---

# ADR 0112 Every Action Is in the Audit Log and People Can Read It

Every action a person takes is now in `ops.audit_log`, through any door, refusals included, and three readers can read it back: everyone their own actions, a tenant admin everything done in their tenant, a platform superadmin everything ([[ADR 0013 Superadmins Named in the Environment]]). The table existed and about thirty services wrote to it, but nothing read it, it recorded only successes, named the actor by email alone, and a mutation whose author forgot wrote nothing.

Completeness is by construction: `AUDITED` in `handlers/audited.ts` is total over the router's mutations, as `EFFECTS` is, so a new mutation is a `tsc` error until someone decides. Each is `service` (its service writes the row for a change that took effect, because only it knows what changed -- the previous role, the old name), `{ fields }` (the router writes the row, copying the named input fields, typed against the input: `people.revokeInvitation`, `connections.startOAuth`, `session.setLocale`, `session.signOut`), or `none` (a POST that changes nothing: `bi.answer`, `models.check`, `macros.check`, `bi.runQuestion`, `lake.query`). The router's root middleware, outside the grant guard, records every attempt that did not succeed as `refused` (4xx) or `failed` (5xx) with a `reason` (the refusal facts' reason, such as `WRITES_DISABLED`, else the tRPC code). An unauthenticated call writes nothing. A refused attempt is attributed to a tenant only if the caller holds authority there; a non-member's attempt keeps the tenant in `detail`, so the 404-not-403 boundary does not leak through the tenant's log.

Rows now carry `user_id`, `outcome`, `reason`, `channel` (`web`, `cli`, `mcp`, `assistant`) and `credential` (a bearer token's id). The channel is for reading, never authority: the CLI names itself with `x-undercroft-client: cli` ([[ADR 0044: An agent reaches Undercroft as a caller]]), a bearer is `mcp` ([[ADR 0060: An agent reaches Undercroft over MCP, with a credential a person holds]]), and the assistant marks its own caller ([[ADR 0029: The assistant is an interleaf, and it acts only through the router]]). Services take an `Actor` built by `actorOf(ctx)`. Events outside the router are written where they happen: `auth.signIn` (Better Auth's session hook), `auth.invitationRedeemed` (per tenant, in the redeeming transaction), `auth.refused`, `connections.connected` (the OAuth callback) and `bi.exports.download`.

`500_audit_log_read.sql` adds the columns, backfills `user_id` by exact email, renames legacy action names to procedure paths (`people.remove` -> `people.removeMember`, `connection.cadence_set` -> `connections.setCadence`, a pasted-token `connection.connected` -> `connections.setToken`), indexes by tenant and by user, and revokes UPDATE, DELETE and TRUNCATE from `undercroft_app`, making the log append-only in the database. Readers: `audit.mine` (any signed-in caller), `audit.tenant` (`requireRole("admin", tenantStatusProcedure)`, so a deactivated tenant's admin still reads who deactivated it -- [[ADR 0110 A Tenant Can Be Deactivated]]), `audit.all` (superadmin); each pages newest first with `cursor` and `nextCursor`. The UI shows them on the account page (a superadmin may switch to every customer) and as an Activity view in a tenant's People division, for its admin.

Rejected: moving every write into the middleware (it cannot see what a service found), adding the missing writes by hand (incomplete the day after), carrying service detail up through `AsyncLocalStorage` (state no signature shows), logging reads too, and one `audit.list` with a scope argument.
