# 110. A tenant can be deactivated

- Status: Accepted
- Date: 2026-10-05
- Follows: [ADR 0013](0013-superadmins-named-in-the-environment.md). Its `authorityIn` is now
  `accessIn`, which answers with the tenant's state as well as the caller's role. Applies to every door ADRs
  [0029](0029-the-assistant-is-an-interleaf.md), [0044](0044-an-agent-reaches-undercroft-as-a-caller.md)
  and [0060](0060-an-agent-reaches-undercroft-over-mcp.md) describe, because they all call the
  router.

## Context

A customer stops using the platform for a while: a contract lapses, a pilot pauses, a payment is
late. There was no way to say so. An operator could remove every member one by one and pause
every connection, and then had to remember what each was set to in order to put it back. The
scheduler kept ticking for the customer, and the alert tick kept emailing its admins.

Deleting the customer is not an option. The raw lake is the only durable layer (ADR 0001). A
customer that comes back must find its history where it left it.

## Decision

1. **The whole tenant is what is deactivated.** Not a person and not a membership. While it is
   deactivated, every member loses access to it and nothing is started for it. Reactivating
   restores exactly what was there, because deactivating removed nothing.
2. **One column holds the state.** `ops.tenant.deactivated_at` is a nullable `timestamptz`
   (`480_tenant_deactivation.sql`). It is `NULL` while the customer is in use and holds when it
   was deactivated otherwise. "Active" is derived from it and stored nowhere. Each transition is
   recorded in `ops.audit_log` as `tenants.deactivate` or `tenants.reactivate`, with the actor.
3. **A tenant admin can deactivate and reactivate it.** These are `tenants.deactivate` and
   `tenants.reactivate`, both `requireRole("admin")`. A superadmin can too, because `accessIn`
   resolves a superadmin to `admin` in every tenant that exists (ADR 0013).
4. **The router enforces it in one place.** `tenantProcedure` in `handlers/trpc.ts` is now
   `tenantStatusProcedure` (authority and state) plus a middleware that refuses a deactivated
   tenant. Every tenant-scoped procedure is built on it, so the refusal applies to the browser,
   the CLI, `/mcp` and the assistant. A procedure added later is refused because it is a tenant
   procedure, with no list to update.
5. **Two procedures opt out, by their builder.** `tenants.get` is built on
   `tenantStatusProcedure`, so a page, the CLI or an agent can learn the customer is deactivated.
   `tenants.reactivate` is `requireRole("admin", tenantStatusProcedure)`, because it is the way
   out. A test calls every tenant-scoped procedure in the manifest on a deactivated tenant and
   requires exactly these two to answer.
6. **The refusal is PRECONDITION_FAILED, worded, after the 404.** A non-member still gets
   NOT_FOUND first, so deactivation reveals nothing about who exists. A member is told the
   customer is deactivated. The refusal's facts carry `reason: "TENANT_DEACTIVATED"`, the
   tenant id and `deactivatedAt`. FORBIDDEN would be wrong: the caller lacks nothing, and an
   admin is refused the same way. PRECONDITION_FAILED is the router's code for "the platform's
   state refused it", which `BY_TRPC_CODE` presents as CONFLICT: ask, do not retry.
7. **A transition to the state the tenant is already in is refused, never a quiet success.**
   Deactivating a deactivated tenant is refused by the same middleware. Reactivating an active
   one is refused with `TENANT_ACTIVE`. Both are PRECONDITION_FAILED. The conditional `UPDATE`
   lets only one of two admins who press at once make the change, so the first moment is kept.
8. **The run ledger stops the work.** `openRun` and `claimExternalRun` insert only when the
   tenant is not deactivated. Every scheduled sync, extract, build, classification, manual
   trigger and pushed batch opens a row through one of those two statements. The worker turns
   the refusal into `TenantDeactivated`, which is HTTP 409 `tenant_deactivated`, through one
   helper, `openRunOrRefuse`. A pushed batch is refused before anything lands, whichever
   credential sent it.
9. **The scheduler names what it skipped.** The three due lists (`/v1/runs/due`, `extract-due`,
   `semantic-due`) put a deactivated tenant's pairs under `skipped`, each with
   `reason: "tenant_deactivated"`, and log `due_skipped`. The flows loop over `due` only, so
   nothing about them changes. The response body Kestra keeps with each execution says why a
   customer's syncs stopped.
10. **Notices about a deactivated tenant are withheld.** The alert tick still claims them, but
    sends them on no channel. It logs each as `alert_withheld` with the reason and counts them
    as `withheld` in its summary. Leaving them unclaimed would deliver a backlog of stale
    warnings the day the customer is reactivated.
11. **The doors outside the router ask too.** The OAuth callback refuses a consent that was
    started before the customer was deactivated, with `tenant-deactivated`, and seals nothing.
    The assistant's chat and history refuse with a worded 409, because they establish authority
    through `tenants.get`, which answers on a deactivated tenant.
12. **The UI shows the state where it applies.** The customer list marks a deactivated customer
    and does not drop it. Opening one shows a notice in place of the division. An admin sees
    Reactivate there; anyone else is told who can. Deactivate is a two-step fold at the foot of
    Sources, beside the display name. The book waits for `tenants.get` before rendering a
    division, so a division never sends requests that would all be refused.
13. **Deactivate is a `write`, not `destructive`.** `EFFECTS` already classifies an action by
    whether it can be undone. `tenants.reactivate` undoes this one and nothing is deleted. The
    CLI words `destructive` as "deletes data and cannot be undone", which would be false here.
    It still needs a write grant, and the browser asks for a second press.

## Consequences

- A deactivated customer's data, grants, schedules, models, keys and memberships are untouched.
  Reactivating is one statement.
- A run already in flight when the customer is deactivated finishes. Only new runs are refused.
  A chained transform after it is refused like any other run.
- A tenant's Postgres logins are not changed. They have no stored password. The worker mints
  one per session with a short expiry (ADR 0087), and only for runs and queries that the router
  and the ledger now refuse. A password minted just before deactivation lapses on its own
  schedule. No external BI tool holds a tenant login.
- An ingest key keeps its `last_used_at` up to date when it presents a batch that is then refused.
  The key authenticated; the customer's state is what refused.
- A notice withheld while the customer was deactivated is not sent after reactivation. A grant's
  expiry is still shown on its card.

## Options rejected

- **Deactivating a person or a membership.** This answers a different question: who may see a
  customer. Removing a member already exists. It would not stop the scheduler or the alerts for
  the customer.
- **Deleting the tenant.** The raw lake is the durable layer. A customer that comes back must
  find its history, and deletion would be the one irreversible act in the product.
- **Superadmin only.** Pausing is a decision inside one customer, like renaming it. The
  customer's own admin is who makes it. A superadmin can still do it as that customer's admin.
- **A stored `status` enum (`active` / `deactivated`).** It needs a second column to say when.
  Two columns can disagree, and a third state would start to grow. The nullable timestamp is
  both the state and when it began, and "active" cannot drift from it.
- **Enforcing it in each procedure, or with a list of allowed paths.** About a hundred
  procedures each repeating one check is how one of them forgets it. A path allow-list in the
  middleware stops working when a procedure is renamed. The opt-out is a choice of builder,
  visible where the procedure is defined.
- **NOT_FOUND for a deactivated tenant.** It would make a deactivated customer look deleted to
  its own members, and the UI could not say what happened or offer Reactivate.
- **Dropping deactivated pairs from the due lists without a word.** A tick that starts nothing
  would look the same as one that found nothing to do. CLAUDE.md rule 2 says to name what was
  set aside and why.
