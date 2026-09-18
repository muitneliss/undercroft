---
title: ADR 0013 Superadmins Named in the Environment
type: source
date: 2026-09-18
tags: []
source: docs/adr/0013-superadmins-named-in-the-environment.md
source_path: docs/adr/0013-superadmins-named-in-the-environment.md
source_hash: b1118d6bd6411c2e7ea536b6134fccc6a30e676ca91029f4fb03878a8410d710
ingested: 2026-09-18
---

# ADR 0013 Superadmins Named in the Environment

Undercroft's authority model is tenant-scoped: `app.tenant_member` says who may see a
customer and with what rank (`viewer` < `member` < `admin`). That model cannot answer the
first question a deployment asks — **who may do anything at all, before there is anybody to
grant it?**

## The decision

`UNDERCROFT_SUPERADMINS` is a comma-separated list of email addresses, and **it is the
authority, not a seed**.

* Read at boot, consulted on **every request**. Removing an address and redeploying
  withdraws platform authority at the next request; adding one grants it. No row anywhere
  records who is a superadmin, so there is nothing for the variable to drift away from.
* A superadmin is **admissible with no invitation**, which is what makes a fresh deployment
  usable. They still authenticate normally, through Google or a one-time code: the list
  grants authority, never identity.
* A superadmin holds **`admin` in every tenant that exists**, and `null` in one that does
  not — so `tenantProcedure` still answers NOT\_FOUND for a customer that is not there, on
  both paths. See [[ADR 0011 Layers Are Directories, Handler to Service to Repo]] for where
  that decision lives.
* First sign-in provisions an `app.app_user` row and **no memberships**. The uuid exists
  because audit rows and memberships are keyed by it; the absence of membership rows is the
  point, since writing them would be a copy of the environment inside the database.
* **`tenants.create` exists and is superadmin-only.** This reverses the previous
  "a tenant is not created by a request" invariant. It is deliberately not
  `requireRole("admin")`: a tenant admin is senior inside one customer, and no amount of
  that implies the right to bring another customer into existence.

## Consequences

The cost, stated plainly: an address deleted from the variable by accident loses platform
authority at the next restart, with **no audit row recording the change**. That is the same
exposure every other production environment variable carries — `UNDERCROFT_SESSION_SECRET`
ends every live session the moment it changes — and it is the price of having exactly one
place that says who may act on every customer.

What is still audited is **actions, not membership**: `tenants.create` and `people.invite`
both write `ops.audit_log` rows naming the address.

A malformed entry is **reported, not absorbed**. `a@x.test;b@x.test` — a semicolon where a
comma belongs — would otherwise be one unmatchable address and no administrators, looking
exactly like a correct configuration. Addresses are counted in the boot log, never printed;
rejected entries are printed, because those are typos.

## Options rejected

* **A `superadmin` column on `app.app_user`** — two sources of truth for the most
  privileged thing in the system; the row survives a restore and is invisible from the
  deployment panel.
* **Seeding addresses into `app.tenant_member` at boot** — makes the environment a seed:
  later edits do nothing, revocation becomes a database change, and a removed superadmin
  keeps working forever.
* **Reusing `requireRole("admin")` for tenant creation** — conflates two different axes of
  authority.
* **A dedicated bootstrap tenant** — smaller, but leaves superadmins blind to every
  customer created afterwards.

Related: [[ADR 0010 Invite-Only Sign-In with Better Auth]], [[Runbook Deployment]],
[[Runbook Sign-In Setup]].
