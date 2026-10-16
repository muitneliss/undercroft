# 139. Tenant access is Casbin policy over our own tables

- Status: Accepted
- Date: 2026-10-16
- Supersedes, in part: [ADR 0119](0119-who-has-access-is-read-by-an-admin-alone.md), where a
  division is `adminOnly`: a division now `requires` a permission, and People requires
  `people:manage`. Who reads the roster is unchanged.
- Supersedes, in part: [ADR 0026](0026-full-text-search-over-the-raw-lake.md), where
  `lake.search` is admin-only: it needs `lake:read`, held by `builder` and `admin`.
- Supersedes, in part: [ADR 0132](0132-a-model-is-previewed-by-compiling-not-building.md), where
  `models.preview` is admin-only: it needs `models:write`, with `models.save` and `models.build`.
- Keeps: [ADR 0013](0013-superadmins-named-in-the-environment.md) (a superadmin holds `admin` in
  every customer that exists), [ADR 0110](0110-a-tenant-can-be-deactivated.md) (a deactivated
  customer refuses every tenant procedure but its state), the 404-not-403 boundary in
  `handlers/trpc.ts`, and the last-admin guard written into `repos/membership.ts`'s SQL.

## Context

Someone who only fixes dbt models had to be made `admin` (issue 481), because saving, building
and previewing models, macros and reference tables were `requireRole("admin")`, and so was
reading the raw lake they are written over. `admin` also invites and removes people, connects and
disconnects sources, mints ingest keys and deactivates the customer, none of which that person
should do.

Authority was a ladder: `ROLE_RANK = { viewer: 0, member: 1, admin: 2 }`, and every gate was
`requireRole(min)`, "at least this rung". A ladder can only grow by a rung, and a rung between
`member` and `admin` that holds the models would, by being below `admin`, hold nothing else an
admin holds -- which is right for issue 481 -- and by being above `member` hold everything a
member holds, which is right too. What it cannot say is the next request already on the plan:
a customer that defines its own roles, a grant on one model or one raw stream, a grant that
expires. Each of those is a set, not a rank.

## Decision

- **A permission catalogue, defined once in code.** `PERMISSIONS` in
  `packages/contracts/src/access.ts`, each `area:action`: `reports:author`, `models:write`,
  `lake:read`, `sources:manage`, `keys:manage`, `catalogue:manage`, `people:manage`,
  `audit:read`, `tenant:manage`, and `roles:manage`, reserved for the procedures PR 2 adds.
  `docs/reference/permissions.md` lists the procedures each covers.
- **Four built-in roles, each a flat set of permissions** (`BUILT_IN_GRANTS`, same file):
  `viewer` holds none; `member` holds `reports:author`; `builder` -- new, issue 481 -- holds
  `reports:author`, `models:write` and `lake:read`; `admin` holds the whole catalogue by
  construction, so a permission added later reaches the customer's admins at once. The table is
  below every layer so that the server's policy and the browser's test fixtures, which stand in
  for the server's answer, are one table; the browser's product code may not read it.
- **Casbin evaluates; our tables stay the owners.** `casbin` 5.51.1, in the control plane only,
  with RBAC with domains, the tenant being the domain (`ACCESS_MODEL` in `services/rbac.ts`):
  `g = _, _, _`, a matcher of `g(r.sub, p.sub, r.dom) && (p.dom == "*" || p.dom == r.dom) &&
keyMatch(r.obj, p.obj) && r.act == p.act`. Its policy is projected on every request from what
  the platform already holds -- the caller's `app.tenant_member` row (`g, user:<uuid>, <role>,
<tenant>`; a superadmin projects as `admin`) and the built-in grants (`p, <role>, *,
perm:<permission>, use`) -- through a load-only adapter whose every write refuses. The model
  is filled with `Model.addPolicy`, never with CSV lines, so a value is never text Casbin
  parses. The request carries `(subject, tenant, object, action)`, the shape an object grant
  (`model:orders`, `read`) will ask of the same model.
- **One gate.** `requirePermission(permission, on = tenantProcedure)` replaces
  `requireRole(min)`; `ROLE_RANK`, `outranks` and `requireRole` are gone. It answers FORBIDDEN,
  worded with the permission's label and key (`error.requiresPermission`) and carrying
  `{ reason: "PERMISSION_REQUIRED", permission }`. The context gains `permissions`, what Casbin
  decided, sorted, and `tenants.get` and each `tenants.list` row answer with it; `role` stays,
  for a person to read.
- **The manifest knows each procedure's permission**, read off the guard `requirePermission`
  built, and adds the sentence naming it to the procedure's description; the hand-written
  "Admins." suffixes are gone. A test fails on any tenant procedure that changes something and
  declares none.
- **Request cost does not grow.** Who holds what is still the one statement `accessFor` runs;
  building the enforcer and asking it every permission measured about 0.03 ms.
- **The role columns keep a CHECK, now naming four keys** (`590_tenant_roles.sql`), rather than
  validation in the service alone: the CLI's `invite` and any later writer reach the same columns,
  and a row holding a key no policy grants would be a member with nothing -- or, the day a policy
  line carried a typo'd key, one with something nobody meant. Fail-closed in the database. PR 2
  replaces it with a reference to the customer's own roles. The two inline CHECKs are dropped by
  their verified names, without `IF EXISTS`, so a wrong name fails the migration.
- **The browser derives every gate from `permissions`**, through `can()`; no screen compares a
  role to a name. `.ast-grep/rules/no-role-literal-gate.yml` fails the gate on such a comparison
  in the browser and the control plane, and on `BUILT_IN_GRANTS` in the browser outside a test.

## What follows

This is the first of four changes. The model above is the one all four use.

- **PR 2, a customer's own roles.** Roles in `app.tenant_role`, per-user and per-role grants in
  `app.access_grant` with an optional expiry, `roles.*` and `grants.*` procedures gated on
  `roles:manage`, and a subset rule: nobody grants a permission they do not hold. `accessFor`
  LEFT JOINs a custom role's permissions, still one statement.
- **PR 3, object grants** -- `model:<name>`, `raw:<source>.<entity>`, `report:question:<id>`,
  `report:dashboard:<id>` -- evaluated by the same matcher and enforced at the application and
  through per-scope database logins.
- **PR 4, row and column rules**, as row-level security and column grants on those scope logins.
  Logins and not a session setting, because a policy keyed on `set_config` is one any SQL author
  can `SET` past (`.claude/rules/privileges.md`).

## Consequences

- A builder saves, builds and previews models, macros and reference tables, and reads, searches
  and queries the raw lake and the rows a failed test stored, without managing people, sources,
  keys, the document-kind catalogue or the customer.
- The Lake console, its search and `models.preview` open to the same people, because every
  built-in role that may write a model may read the lake it is written over.
- A FORBIDDEN names the permission, so a person, the CLI and an agent can each say what is
  missing and that someone holding `people:manage` can give them a role with it.
- The audit log records a permission refusal as `PERMISSION_REQUIRED`, its facts' code, where it
  recorded the tRPC code `FORBIDDEN` before.
- The OAuth consent callback, the one door to a source's credential with no middleware, asks
  `sources:manage` through `authz.standingIn`; its refusal is `reason=not-permitted`, where it
  was `reason=not-admin`.
- Notes that a screen prints in place of an action ("only an admin…") that are still true of the
  four built-ins stay as they are; PR 2, which makes them untrue for a customer's own role,
  words them by permission.

## Options rejected

- **A `builder` rung in `ROLE_RANK`.** It closes issue 481 and nothing after it: a customer's own
  role, a grant on one model and an expiring grant are sets, and a ladder cannot hold a set. The
  abandoned first attempt took this path.
- **A gate per procedure** -- a list of roles beside each procedure. Sixty lists, each a place for
  a role to be forgotten, and no name for what the lists have in common; a permission is that
  name, and a role is a set of them.
- **A `casbin_rule` table, or a stock database adapter.** A stock adapter opens its own pool,
  outside the repos and outside `undercroft_app`'s grants, and its table is a second owner of
  membership beside `app.tenant_member` -- one the last-admin guard, written into the SQL that
  changes a role, would know nothing about. Casbin's management API is refused for the same
  reason.
- **An evaluator of our own.** The built-ins alone are a set lookup, but PR 2-4 need domains,
  role inheritance, wildcard objects and a matcher a reader can check, and Casbin is a small,
  pinned, widely read implementation of exactly that. Ours would be a second one to get right.
