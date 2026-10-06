# 112. Every action is in the audit log, and people can read it

- Status: Accepted
- Date: 2026-10-06
- Follows: [ADR 0013](0013-superadmins-named-in-the-environment.md) (who a superadmin is),
  [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md) and
  [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md) (the doors an action arrives through),
  [ADR 0110](0110-a-tenant-can-be-deactivated.md) (`tenantStatusProcedure`).

## Context

`ops.audit_log` has existed since the first schema, and about thirty services write a row to it
when they change something. Nothing read it back. Three things made it a weak record:

1. **It was incomplete, and nothing said so.** A service wrote a row only if its author remembered
   to. Revoking an invitation, starting an OAuth consent, signing in, redeeming an invitation,
   changing one's language and downloading an export wrote nothing. A mutation added tomorrow
   would write nothing too, and no check would notice.
2. **It recorded only successes.** A viewer who tried to remove a member, or a read-only token
   that tried to write, left no trace. The attempts are what a security review looks for.
3. **It named the actor by email only, and not the door.** Since the CLI, `/mcp` and the assistant
   can act for a person, "who" without "through what" is half the answer.

People asked to see the log: everyone their own actions, a tenant admin the actions taken in their
tenant, a platform superadmin everything.

## Decision

1. **Every mutation is classified in `AUDITED` (`handlers/audited.ts`), total over the router's
   mutations, so a new mutation is a `tsc` error until someone decides.** It is the same mechanism
   `EFFECTS` uses (ADR 0060). Each mutation is one of:
   - `"service"`: its service writes the row for a change that took effect, because only the
     service knows what changed (the previous role, the old name, whether an upstream revoke
     happened). This is how the existing thirty writes stay where they are.
   - `{ fields }`: the router writes the row on success, copying the named fields of the input.
     The names are typed against the input, so a renamed field is a `tsc` error, and a field that
     is customer data or a secret is simply not named. For mutations no service records:
     `people.revokeInvitation`, `connections.startOAuth`, `session.setLocale`, `session.signOut`.
   - `"none"`: a POST that changes nothing (`bi.answer`, `models.check`, `lake.query` and the
     like). Plain reads are not actions here; logging every page's polling would bury the actions
     in reads.
2. **The router's root middleware records every attempt that did not succeed**, for every
   mutation not marked `"none"`, whichever door it came through. It sits outside the grant guard,
   so a read-only token refused a write is recorded too. A row has `outcome` `ok`, `refused` (a
   4xx refusal) or `failed` (a server error), and `reason`: the refusal's facts' `reason` when it
   has one (`WRITES_DISABLED`, `TENANT_DEACTIVATED`), otherwise the tRPC code. An unauthenticated
   call writes nothing: there is nobody to attribute it to, and sign-in refusals have their own row
   (`auth.refused`).

   The objection `services/people.ts` recorded, that a trail recording attempts as actions "would
   say a person lost access when they did not", is answered by `outcome`: a refused row says the
   attempt was refused.

3. **A refused attempt is attributed to a tenant only if the caller holds authority there.** A
   non-member's attempt on a tenant is recorded with `tenant_id` NULL and the tenant it named in
   `detail`. Otherwise a tenant's admin could read which outsiders tried their tenant id, and the
   404-not-403 boundary (`trpc.ts`) would leak through the log.
4. **A row names the actor by `user_id` as well as email, and the door.** `channel` is `web`,
   `cli`, `mcp` or `assistant`, and `credential` is the token's id for a bearer call (`upat_…` or
   `oauth:<client>`), NULL for a session. The channel is self-declared by the CLI
   (`x-undercroft-client: cli`) and set by the assistant on its own caller; it is for reading, like
   `via`, and never for authority. Services take an `Actor` value built from the context
   (`actorOf(ctx)`) instead of an email string, so a service row carries the same facts.
5. **Events outside the router are written where they happen**: `auth.signIn` (Better Auth's
   session hook), `auth.invitationRedeemed` (one row per tenant joined, in `resolveInvitedUser`),
   `auth.refused` (unchanged), `connections.connected` (the OAuth callback, unchanged) and
   `bi.exports.download` (the download route).
6. **Action names are procedure paths.** The legacy names (`bi.question.save`,
   `connection.cadence_set`, `people.remove`, …) are renamed in place by
   `500_audit_log_read.sql`, so one key labels a row in every language. A connection sealed with a
   pasted token was `connection.connected` with `method: token`; it becomes `connections.setToken`.
7. **Three procedures read it, one per audience, each on the gate that already means that
   audience**:
   - `audit.mine` (any signed-in caller): rows whose `user_id` is the caller's, in every tenant
     and in none. A person keeps seeing their own actions in a tenant they have left.
   - `audit.tenant` (`requireRole("admin", tenantStatusProcedure)`): rows attributed to the
     tenant, by anyone, superadmins included. On `tenantStatusProcedure` so the admin of a
     deactivated tenant can still read who deactivated it. A member's own rows with no tenant
     (minting a personal token) are not here: they belong to the person, not the tenant.
   - `audit.all` (`superadminProcedure`): every row, optionally filtered by tenant.

   Each pages newest first by id. The `user_id` backfill matches the email exactly, because an
   address names one `app_user` (`UNIQUE`); a row whose address matches nobody keeps a NULL
   `user_id` and is read only through `audit.all`.

8. **The log is append-only in the database, not only by convention.** The migration revokes
   `UPDATE`, `DELETE` and `TRUNCATE` on `ops.audit_log` from `undercroft_app`. Nothing in the
   product ever needed them, and an audit trail its own writer can edit is not evidence.

## Consequences

- A new mutation cannot ship unaudited by omission. It can ship with the wrong classification;
  review is what catches that, as with `EFFECTS`.
- A service marked `"service"` must actually write its row. Nothing checks that mechanically. The
  thirty that do are the ones already tested to.
- Writing a refused row costs one insert, plus one authority lookup when the call named a tenant.
  Mutations are rare beside queries.
- An audit insert that fails after a change succeeded fails the call, as it did before when the
  service wrote the row. The change has happened; the caller is told something failed.
- Retention is unbounded. The table is indexed by tenant, by user and by id; when it grows large
  enough to matter, a retention decision gets its own ADR.

## Options rejected

- **Move every write into the middleware and delete the service writes.** The middleware sees the
  input and the output, not what the service found: the role held before, the old name, whether
  the upstream revoke happened. It would also move a dozen tests that pin what a row must NOT
  contain (folder names, addresses) away from the code that decides it.
- **Keep the writes in the services and add the missing ones by hand.** Complete today, incomplete
  the day after, with nothing to notice.
- **Carry the service's detail up to the middleware through `AsyncLocalStorage`.** One row per
  call, but through state no signature shows. A reader of a service could not tell where its row
  went.
- **Log every call, reads included.** Every page polls; the actions would drown, and reading
  a customer's own data is not what this log is for.
- **One `audit.list` with a `scope` argument.** Three procedures put each audience on the gate that
  already means it, rather than re-deciding authority inside one procedure.
