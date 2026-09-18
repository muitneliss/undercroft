# 13. Platform superadmins are named in the environment, not in the database

- Status: Accepted
- Date: 2026-09-18
- Supersedes, in part: the "a tenant is not created by a request" invariant recorded in
  `apps/control-plane/src/repos/tenant.ts` and in ADR 0010's reading of the router surface.

## Context

Undercroft's authority model is entirely tenant-scoped. `app.tenant_member` says who may see
a customer and with what rank (`viewer` < `member` < `admin`), and `handlers/trpc.ts`
resolves every request against it. That model answers every question except the first one a
deployment asks: **who may do anything at all, before there is anybody to grant it?**

Until now the answer was `bun run invite -- you@example.test --tenant CASE-0001 --role admin
--create-tenant`, run on a shell with `UNDERCROFT_POSTGRES_DSN` in the environment. That
works, and it has two costs that only show up in production:

1. **It needs shell access to the host.** Adding the first administrator, and getting back in
   after losing the last one, both require reaching past the product to the database. The
   deployment rule says SSH is read-only and the Dokploy API is the only channel for a
   change; the bootstrap step quietly contradicted it.
2. **There is no recovery path that does not involve SQL.** If the last `admin` of every
   tenant leaves, or `app.tenant_member` is damaged, nothing in the product can repair it.

The obvious fix — a `superadmin` boolean on `app.app_user` — buys an audit trail for changes
and costs a second source of truth for the most privileged thing in the system. A row saying
someone is a platform administrator survives a database restore, survives being removed from
a config, and is invisible from the deployment panel where the rest of this install is
configured.

## Decision

**`UNDERCROFT_SUPERADMINS` is a comma-separated list of email addresses, and it is the
authority — not a seed.**

- It is read at boot and consulted on **every request**. Removing an address and redeploying
  withdraws platform authority at the next request; adding one grants it. No row anywhere
  records who is a superadmin, so there is nothing for the variable to drift away from.
- A superadmin is **admissible with no invitation** (`services/invite.ts`), which is what
  makes a fresh deployment usable. They still authenticate normally: Google or a one-time
  code. The list grants authority, never identity.
- A superadmin holds **`admin` in every tenant that exists** (`services/authz.ts`,
  `authorityIn`), and `null` in one that does not — so `tenantProcedure` still answers
  NOT_FOUND for a customer that is not there, on both paths.
- First sign-in provisions an `app.app_user` row and **no memberships**. The uuid exists
  because audit rows and memberships are keyed by it; the absence of membership rows is the
  point, since writing them would be a copy of the environment inside the database.
- **`tenants.create` exists and is superadmin-only.** This reverses "a tenant is not created
  by a request". Without it a superadmin signing into a fresh deployment sees an empty screen
  and still needs the shell, which defeats the purpose. It is deliberately _not_
  `requireRole("admin")`: a tenant admin is senior inside one customer, and no amount of that
  implies the right to bring another customer into existence. Platform authority is beside
  the role ladder, not on top of it.

## Consequences

**What this costs, stated plainly.** An address deleted from the variable by accident loses
platform authority at the next process restart, with no audit row recording the change. That
is the same exposure every other production environment variable here carries —
`UNDERCROFT_SESSION_SECRET` ends every live session the moment it changes — and it is the
price of having exactly one place that says who may act on every customer.

**What is still audited.** Actions, not membership. `tenants.create` writes an
`ops.audit_log` row naming the address, as does `people.invite`. What is not recorded is the
moment somebody became a superadmin, because that moment happens in Dokploy.

**A typo is reported, not absorbed.** `parseSuperadmins` returns rejected entries and
`main.ts` logs them, because `a@x.test;b@x.test` — a semicolon where a comma belongs —
would otherwise be one unmatchable address and no administrators, looking exactly like a
correct configuration. An install that names none logs `superadmins_none` at `warn` for the
same reason: zero is legitimate, and is also what a variable set on the wrong service looks
like.

**Addresses are never logged, only counted.** A log line is the artefact that most reliably
leaves the host, and a list of the platform's most privileged accounts does not belong in
one. Rejected entries are the exception: an entry that matches nobody is a typo, not an
administrator's address, and printing it back is how the person who wrote it finds out.

**`bun run invite` still works and is still the documented path for an ordinary invitation.**
What it is no longer needed for is the first one.

## Options rejected

- **A `superadmin` column on `app.app_user`.** Two sources of truth for platform authority,
  the second of which survives a restore and is invisible from the deployment panel.
  Rejected above.
- **Seed the addresses into `app.tenant_member` at boot.** Makes the environment a seed
  rather than an authority: later edits do nothing, revocation becomes a database change, and
  a superadmin removed from the variable keeps working forever. It also has to guess which
  tenants to write rows for, and any new tenant would need seeding again.
- **Reuse `requireRole("admin")` for tenant creation.** Conflates two different axes of
  authority; see above.
- **A dedicated bootstrap tenant.** Provisioning superadmins into one named tenant is a
  smaller change, but it leaves them blind to every customer created afterwards — the exact
  problem the platform role exists to solve.
