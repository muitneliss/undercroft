---
title: ADR 0139 Tenant Access Is Casbin Policy
type: source
date: 2026-10-16
tags: []
source: docs/adr/0139-tenant-access-is-casbin-policy.md
source_path: docs/adr/0139-tenant-access-is-casbin-policy.md
source_hash: 24a7b6c2472ee9c366e9f994517d685599479a139618c4ad9deeae47f6694589
ingested: 2026-10-16
---

# ADR 0139 Tenant Access Is Casbin Policy

# ADR 0139 Tenant Access Is Casbin Policy

Accepted 2026-10-16. Supersedes in part [[ADR 0119 Who Has Access to a Customer Is Read by Its Admin Alone]] (a division `requires` a permission instead of being `adminOnly`; People requires `people:manage`), [[ADR 0026: Full-text search over the raw lake]] (`lake.search` needs `lake:read`, not admin) and [[ADR 0132 A Model Is Previewed by Compiling It, Not by Building It]] (`models.preview` needs `models:write`). Keeps ADR 0013 (a superadmin holds `admin` in every existing customer), ADR 0110 (a deactivated customer refuses every tenant procedure but its state), the 404-not-403 boundary and the last-admin guard in `repos/membership.ts`'s SQL.

**Context.** Issue 481: someone who only fixes dbt models had to be made `admin`, because saving, building and previewing models, macros and reference tables, and reading the raw lake, were `requireRole("admin")` -- which also let them invite people, connect sources, mint keys and deactivate the customer. Authority was a ladder (`ROLE_RANK`, viewer 0, member 1, admin 2) and every gate was "at least this rung". A rung could close the issue but not what is planned next -- a customer's own roles, a grant on one model, an expiring grant -- which are sets, not ranks.

**Decision.** A permission catalogue defined once (`PERMISSIONS` in `packages/contracts/src/access.ts`): `reports:author`, `models:write`, `lake:read`, `sources:manage`, `keys:manage`, `catalogue:manage`, `people:manage`, `audit:read`, `tenant:manage`, and `roles:manage` reserved for PR 2. Four built-in roles as flat sets (`BUILT_IN_GRANTS`, same file): `viewer` none, `member` `reports:author`, new `builder` `reports:author` + `models:write` + `lake:read`, `admin` the whole catalogue by construction. Casbin 5.51.1 evaluates, in the control plane only, with RBAC with domains (the tenant is the domain; `ACCESS_MODEL` in `services/rbac.ts`); its policy is projected per request from the caller's `app.tenant_member` row (`g, user:<uuid>, <role>, <tenant>`, a superadmin as `admin`) and the built-in grants (`p, <role>, *, perm:<permission>, use`) through a load-only adapter whose writes refuse, filled with `Model.addPolicy` rather than CSV. `requirePermission(permission, on = tenantProcedure)` in `handlers/permissionGate.ts` replaces `requireRole`; `ROLE_RANK`, `outranks` and `requireRole` are gone. FORBIDDEN names the permission in words and by key with facts `{ reason: "PERMISSION_REQUIRED", permission }`. The context gains `permissions`; `tenants.get` and every `tenants.list` row answer with them. The manifest reads each procedure's permission off its guard and appends "Needs ..." to its description, and a test fails on a tenant write that declares none. Still one SQL statement per request (`accessFor`); building the enforcer costs about 0.03 ms. The role columns keep a fail-closed CHECK naming the four keys (`590_tenant_roles.sql`, the inline CHECKs dropped by verified name without `IF EXISTS`). The browser derives every gate from `permissions` through `can()`; `no-role-literal-gate` fails the gate on a comparison of a role to a role's name, and on `BUILT_IN_GRANTS` in the browser outside a test.

**What follows.** PR 2: a customer's own roles (`app.tenant_role`), per-user and per-role grants with expiry (`app.access_grant`), procedures gated on `roles:manage`, and a subset rule against escalation. PR 3: object grants (`model:<name>`, `raw:<source>.<entity>`, `report:question:<id>`, `report:dashboard:<id>`) enforced in the application and through per-scope database logins. PR 4: row and column rules as RLS and column grants on those logins -- logins rather than a session setting, because a policy keyed on `set_config` can be `SET` past.

**Consequences.** A builder saves, builds and previews models, macros and seeds and reads the raw lake without managing people, sources, keys, the catalogue or the customer. A refusal names the permission. The audit log records a permission refusal as `PERMISSION_REQUIRED`. The OAuth consent callback asks `sources:manage` through `authz.standingIn` and refuses with `reason=not-permitted`. Notes still true of the four built-ins keep their wording until PR 2.

**Rejected.** A `builder` rung in `ROLE_RANK` (closes the issue and nothing after it); a list of roles per procedure (sixty places to forget a role, and no name for what they share); a `casbin_rule` table or stock adapter (its own pool outside the repos and `undercroft_app`, and a second owner of membership the last-admin guard cannot see); an evaluator of our own (PR 2-4 need domains, inheritance, wildcards and a checkable matcher).
