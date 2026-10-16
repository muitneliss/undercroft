---
title: ADR 0141 Custom Roles and Grants Under the Subset Rule
type: source
date: 2026-10-16
tags: []
source: docs/adr/0141-custom-roles-and-grants-under-the-subset-rule.md
source_path: docs/adr/0141-custom-roles-and-grants-under-the-subset-rule.md
source_hash: 27da25ccbdc5b8262de23f27d955a92c2fc9fede67bfd23941a847b3bb8f5824
ingested: 2026-10-16
---

# ADR 0141 Custom Roles and Grants Under the Subset Rule

# ADR 0141 Custom Roles and Grants Under the Subset Rule

PR 2 of the four changes [[ADR 0139 Tenant Access Is Casbin Policy]] planned: a customer defines roles of its own and grants one permission to a role or a person, standing or until a moment. ADR 0139's model, matcher, load-only adapter and one statement per request are unchanged; its four-key role CHECK (`590_tenant_roles.sql`) is superseded by a foreign key.

**Roles.** `app.access_role` (named so because `ops.tenant_role` is a customer's database logins) holds every role a customer has, the four built-ins included: a built-in is a row with `builtin = true` and `permissions` NULL (its grants stay code, `BUILT_IN_GRANTS`), backfilled and inserted by an AFTER INSERT trigger on `ops.tenant`, so every fixture and door that creates a tenant gets them. A custom row has a key (`^[a-z][a-z0-9_]*$`, at most 63, never a colon, never a built-in's; `ROLE_KEY` in `@undercroft/contracts/access`), a label, a description and `permissions text[]`. CHECKs tie built-in rows to the four keys and to NULL permissions.

**Role integrity is a foreign key.** `tenant_member (tenant_id, role)` and `invitation (tenant_id, role)` reference `access_role (tenant_id, key)`. The membership's is NO ACTION (a held role cannot be deleted by any writer; NO ACTION rather than RESTRICT so a customer's own deletion does not depend on cascade order); the invitation's is ON DELETE CASCADE, because accepted invitations are kept as history and RESTRICT would pin every role ever invited at -- the delete statement refuses while an open invitation names the role. Rejected: validation with `FOR SHARE`/`FOR UPDATE` locking in the service, which binds only the code written that way.

**Grants.** `app.access_grant`: `subject_kind` role or user, exactly one of `role_key` (foreign key to the role, cascades) and `user_id` (foreign key to the MEMBERSHIP, so removing a person removes their grants); `object`/`action` are Casbin's own, limited to `perm:<permission>` + `use` by a named CHECK admitting no `*`, which PR 3 replaces; `UNIQUE NULLS NOT DISTINCT` stores a grant once and saving it again moves its expiry. **Expiry** is `expires_at` compared with `now()` in the statement that reads it: an expired grant projects nothing on the next request, is kept, and is listed `expired`. No sweep.

**Projection.** `accessFor` (and `listForUser`, through the same fragment) LEFT JOINs the custom role's permissions and folds the grants in force into a JSON subquery -- still one statement. `rbac.ts` writes custom-role lines in the customer's domain and grant lines on the role key or `user:<uuid>`; a permission or object the catalogue does not know writes no line, so a stored `*` can never reach `keyMatch` as a pattern. A superadmin still projects as `admin`.

**The subset rule.** Nobody gives, grants or takes away a permission they do not hold: saving a role (what it will hold and held), deleting one (those and its grants), saving or deleting a grant, inviting at or setting a role (what it confers -- asked of Casbin with the role as subject -- and the old role's), removing a member (all they hold). What a row holds is guarded in the writing statement under its lock, with the caller's lacking permissions as a parameter. Refusal: `FORBIDDEN`, `reason: PERMISSION_NOT_HELD`, `permission` (first) and `permissions` (all). `admin` is never stopped by it.

**Who may.** `roles.list`/`get`: every member. `roles.save`/`delete`, `grants.save`/`delete`: `roles:manage`. `grants.list`: `people:manage`, because grants say who holds what (the roster's information, [[ADR 0119 Who Has Access to a Customer Is Read by Its Admin Alone]]). Built-ins cannot be saved or deleted (`BUILT_IN_ROLE`); a grant to a built-in role is allowed. The last-admin guard is unchanged on the literal `'admin'`, which no custom role can take, so a custom role holding everything is not an admin. `people.invite`/`setRole` take a role key validated by the service; `bun run invite` holds every permission. The browser reads `roles.list`, gates editors on `can()`, and `tenants.get`/`list` answer `roleLabel`.

**Consequences.** People's Roles and Grants views, `undercroft roles|grants …`, and `roles_*`/`grants_*` over MCP; `people:manage` alone no longer hands out any role; deleting a role removes its closed invitations; a new built-in role is a code change and a migration. How-to: the access-control runbook (`docs/runbook/access-control.md`).
