---
description: A procedure declares the permission it needs; the browser reads permissions, never a role
paths:
  [
    "apps/control-plane/src/**/*.ts",
    "apps/ui/src/**/*.ts",
    "apps/ui/src/**/*.tsx",
    "apps/worker/src/**/*.ts",
  ]
---

# Access is a permission, decided by Casbin over our own tables

What a person may do in a customer is a **permission** (`models:write`, `people:manage`, …), and
a role is only a named set of them -- a built-in, or one the customer defined -- with grants of
one permission to a role or a person, standing or until a moment, beside it. The catalogue and
the built-in roles are defined once, in `packages/contracts/src/access.ts`; the control plane
projects them, with the caller's `app.tenant_member` row, their role's row and their grants, into
Casbin on every request and Casbin decides (`apps/control-plane/src/services/rbac.ts`). Our
tables stay the owners. The reasoning, and the options rejected, are in
`docs/adr/0139-tenant-access-is-casbin-policy.md` and, for a customer's own roles, grants and the
subset rule, `docs/adr/0141-custom-roles-and-grants-under-the-subset-rule.md`; which procedures
each permission covers is `docs/reference/permissions.md`.

## NEVER

- **NEVER ship a tenant procedure that changes something without `requirePermission`.** A
  write on bare `tenantProcedure` is open to every viewer. `authz.test.ts` reads the manifest
  and fails on any tenant procedure whose effect is not `read` and that declares no permission.
  A procedure declares exactly one; one whose need depends on its input (`bi.exports.create`)
  checks inside with `holds` and `permissionRefusal`, and says so in its sentence.
- **NEVER decide on a role's name.** Not `ctx.role === "admin"` on the server, not
  `tenant.data.role !== "viewer"` in a screen. A role a customer defines (ADR 0141) has a name no
  code knows, and the check renders perfectly while being wrong. Enforced:
  `.ast-grep/rules/no-role-literal-gate.yml` fails `task ci:lint-rules`. The one thing that
  names a role is the last-admin guard, because a customer must keep someone holding the role
  that manages everything; it says `ADMIN_ROLE`, or the literal inside its SQL.
- **NEVER compute permissions in the browser.** It reads `permissions` off `tenants.get` (or a
  `tenants.list` row) and asks `can(permissions, "…")` from `@/lib/permissions.ts`. It keeps no
  rank and no table: `BUILT_IN_GRANTS` under `apps/ui/src` outside a test fails the same gate.
  The gate in a screen is courtesy; the server's is the control.
- **NEVER give Casbin a policy store of its own.** No `casbin_rule` table, no stock adapter, no
  `addPolicy`/`savePolicy`: a stock adapter opens its own pool outside the repos and
  `undercroft_app`, and a second store of membership is one the last-admin guard cannot see.
  Policy is projected per request through the load-only adapter in `rbac.ts`; a customer's own
  roles and grants live in `app.access_role` and `app.access_grant`, written through their repos.
- **NEVER let request cost grow with access.** Who holds what is one statement per request
  (`accessFor`); a customer's own roles join onto it, and the grants in force are a subquery in
  it, not a second query beside it. `listForUser` reads the same columns through the same
  fragment, so `tenants.list` and `tenants.get` cannot disagree.
- **NEVER let anyone give, grant or take away a permission they do not hold** -- the subset rule
  (ADR 0141). Saving a role, deleting one, saving or deleting a grant, inviting at a role,
  setting a role and removing a member each weigh every permission involved -- given AND taken
  away -- against the caller's own `permissions`, through `lacking` and `conferredBy` in
  `services/authz.ts`. What a row holds at the moment of writing is guarded in the writing
  statement under its lock, with the permissions the caller lacks as a parameter, never read
  first and checked after. The refusal is `notHeldRefusal` (`PERMISSION_NOT_HELD`). A new
  procedure that changes who holds what goes through the same rule, or `roles:manage` and
  `people:manage` become every permission.
- **NEVER let a role name a key its customer lacks, or the catalogue's unknowns hold anything.**
  Role integrity is a foreign key, not a CHECK and not a service check: `tenant_member` and
  `invitation` reference `app.access_role (tenant_id, key)`, which holds the four built-ins as
  rows (`builtin`, `permissions` NULL; their grants stay code) and the customer's own
  (`600_custom_roles.sql`). A built-in role is a code change AND a migration. A stored permission
  or grant object the catalogue does not know projects no Casbin line (`rbac.ts`), because a
  stored `*` would otherwise reach `keyMatch` as a pattern.

## Follow

- **A new permission is one change in five places, in the same commit:** `PERMISSIONS` in
  `packages/contracts/src/access.ts`, its words in both control-plane catalogues
  (`apps/control-plane/src/i18n/{vi,en}.ts`, `permission.*`) and both UI catalogues
  (`apps/ui/src/i18n/{vi,en}.ts`, `permission.*`), `docs/reference/permissions.md`, and
  `skills/undercroft/references/access-control.md`. The label maps are typed
  `Record<Permission, …>`, so the compiler finds the catalogues for you; it cannot find the two
  documents. `admin` holds every permission by construction, so a new one needs no grant there.
- **A refusal names what is missing.** `requirePermission` answers FORBIDDEN with the permission
  in words and by key, and `{ reason: "PERMISSION_REQUIRED", permission }` as its facts. The
  404-not-403 boundary and the deactivated-tenant refusal come first and are unchanged.
- **Describe a procedure's work, not its gate.** `procedureManifest` reads the permission off
  the guard and adds "Needs …" to the procedure's sentence; the assistant's tool descriptions get
  the same from `permissionFor`. Writing it by hand is a second statement of one fact.
- **Data reads will go through the scope.** PR 3 adds object grants (`model:<name>`,
  `raw:<source>.<entity>`, …) evaluated by the same model and enforced through per-scope
  database logins; until then a read is either open to every member or gated by a permission.
  A row or column rule is never keyed on a session setting (`.claude/rules/privileges.md`).
