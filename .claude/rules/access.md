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
one permission to a role or a person, standing or until a moment, beside it. What a person may
READ is their **reach** -- which models, raw streams and reports -- decided by the same model from
object grants (`model:<name>`, `raw:<source>/<entity>`, `report:<kind>:<uuid>`, and the wholes
`model:*`, `raw:*`, `report:*`). The catalogue and
the built-in roles are defined once, in `packages/contracts/src/access.ts`; the control plane
projects them, with the caller's `app.tenant_member` row, their role's row and their grants, into
Casbin on every request and Casbin decides (`apps/control-plane/src/services/rbac.ts`). Our
tables stay the owners. The reasoning, and the options rejected, are in
`docs/adr/0139-tenant-access-is-casbin-policy.md`, for a customer's own roles, grants and the
subset rule `docs/adr/0141-custom-roles-and-grants-under-the-subset-rule.md`, and for reach and
the scope logins that enforce it `docs/adr/0142-object-reach-and-scope-logins.md`, for row and
column rules on a model grant `docs/adr/0143-row-and-column-rules-on-model-grants.md`; which
procedures each permission covers, and the object grammar, are `docs/reference/permissions.md`.

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
  stored `*` would otherwise reach `keyMatch` as a pattern. An object grant projects only an
  object `parseReachObject` admits, with `read`; the grammar puts a `*` only where it means "the
  whole of", and `access_grant_object_shape` (`610_object_grants.sql`) says the same in the
  database.
- **NEVER read a model, a raw stream or a report without asking the caller's reach.** `ctx.reach`
  is Casbin's answer, beside `ctx.permissions`; a service that lists or reads one of them takes
  the reach and narrows or refuses (`reachesModel`, `reachesStream`, `reachesReport`). What is
  outside it answers as if it did not exist -- an empty page, `NOT_FOUND`, a dashboard's
  `ungranted` -- never FORBIDDEN, which would confirm it. A new reader of these goes through the
  same answer, or a narrowed role reads it whole.
- **NEVER narrow a read after its LIMIT.** A search, a page or a count is narrowed where its rows
  are chosen -- `lake.search` passes the reachable streams INTO the worker's candidate lookups --
  or the page, its count and its "cut" note describe rows the reader cannot see.
- **NEVER send a narrowed read to the worker on a route of old.** A reader of fewer than every
  model reads through a scope login; the request goes to `/v1/queries/scoped/…` (or
  `/raw/search/within`), never as a field on `/v1/queries/run`, which a worker older than the field
  strips before answering as the login that reads everything. `workerQueries.ts` is the one place
  that chooses the route.
- **NEVER let a narrower reach use the build login.** A procedure that runs SQL as the customer's
  dbt login, or changes what it runs, is built on `requireWholeReach`, not `requirePermission`:
  that login reads every model and the whole lake, so it needs `model:*` and `raw:*`.

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
- **Reach is decided once per request and read everywhere from it.** `holdingOf` (`rbac.ts`) asks
  Casbin each domain's whole, then each object the projected lines name; the browser and an agent
  read the answer from `grants.reach` and never derive one. A built-in reaches the whole customer
  (`BUILT_IN_POLICY`); a customer's own role reaches only what is granted to it.
- **The subset rule weighs reach as well as permissions** -- `beyond` and `within` in
  `services/authz.ts`, `REACH_NOT_HELD` -- for every change that gives or takes away a role, a
  grant or a member.
- **What the database enforces, the database enforces.** Which tables a reader's SQL may read is
  the scope login's grants (`.claude/rules/privileges.md`), never a filter here; which of a
  table's rows and columns, the scope login's row policies and column grants (ADR 0143), never a
  filter here and never a session setting.
- **A rule narrows its own grant, and grants add up** (ADR 0143). A model grant's `rowRule` and
  `hiddenColumns` are read with the grant; what a reader reads of a model is the union over their
  grants of it (`unionOf`, `limitsOf` in `rbac.ts`), carried on the reach as `limits` and on the
  scope the worker reads under. Ask it with `limitOf`, `rowsLimited` and `hiddenColumns`; never
  read the grants back. A new reader of a model's columns leaves the hidden ones out
  (`columnsShown.ts`); a new answer over the worker's relations says which were row-limited.
- **A scope with rules goes to `/v1/queries/limited/…`**, never to `/scoped/…`, which a worker older
  than rules answers as a login that reads every row. `scopedRoute` in `workerQueries.ts` chooses.
- **A broken rule is never read as no rule.** Its reader sees no row of the table; whether it is
  broken is `ops.scope_faults`'s answer, the same function the policy writer asks, never a second
  check written here.
