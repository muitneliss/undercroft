# 141. A customer's own roles and grants, under the subset rule

- Status: Accepted
- Date: 2026-10-16
- Builds on: [ADR 0139](0139-tenant-access-is-casbin-policy.md), whose "What follows" named this
  change (PR 2 of 4). Its model, its matcher, the load-only adapter and the one statement per
  request are unchanged.
- Supersedes, in part: ADR 0139, where "the role columns keep a CHECK, now naming four keys"
  (`590_tenant_roles.sql`): both role columns now reference the customer's roles instead.
- Keeps: [ADR 0119](0119-who-has-access-is-read-by-an-admin-alone.md) (the roster is read by a
  holder of `people:manage`), [ADR 0013](0013-superadmins-named-in-the-environment.md) (a
  superadmin projects as `admin`), and the last-admin guard written into `repos/membership.ts`.

## Context

ADR 0139 made authority a permission catalogue evaluated by Casbin, with four built-in roles. A
customer could still not say "our accountants read reports and the raw lake, and nothing else",
nor "Lan may read the raw lake until the end of the month", without giving someone a built-in
that holds more. `roles:manage` was reserved for this.

Three things had to be decided that ADR 0139 left open: how a membership is kept from naming a
role the customer does not have, once role keys are the customer's own; how `roles:manage` is
kept from being every permission; and how a grant expires.

## Decision

- **`app.access_role` holds every role a customer has, the four built-ins included.** A built-in
  is a row with `builtin = true` and `permissions` NULL -- its grants stay code, `BUILT_IN_GRANTS`
  -- inserted for every customer by the migration's backfill and by an AFTER INSERT trigger on
  `ops.tenant`, so `tenants.create`, `bun run invite --create-tenant` and every test fixture that
  inserts a tenant directly get them unchanged. A customer's own role is a row with a key, a label
  in its words, a description and `permissions text[]`. CHECKs tie the two kinds apart: a
  built-in row is one of the four keys and carries neither permissions nor a label, and a custom
  row is never one of the four keys. The table is `access_role`, not `tenant_role`:
  `ops.tenant_role` already names a customer's database logins. A key is `^[a-z][a-z0-9_]*$`, at
  most 63 characters, never a colon (Casbin's subject for a person is `user:<uuid>`), and is
  defined once for every door as `ROLE_KEY` in `@undercroft/contracts/access`.
- **Role integrity is a foreign key.** `app.tenant_member (tenant_id, role)` and
  `app.invitation (tenant_id, role)` reference `app.access_role (tenant_id, key)`. The
  membership's is NO ACTION: the database refuses deleting a role somebody holds, atomically,
  whoever deletes -- NO ACTION rather than RESTRICT because RESTRICT is checked the moment the
  role row goes, and a customer's own deletion cascades to both tables in an order Postgres
  chooses; NO ACTION is checked after every cascade, so that deletion does not depend on it. The invitation's is ON DELETE CASCADE,
  because accepted and expired invitations are kept as history and a RESTRICT would pin every
  role anyone was ever invited at; the role's delete statement refuses while an OPEN invitation
  names it, and an invitation sent in the instant a role is deleted is removed with it, so its
  invitee is refused rather than admitted at a role that is gone. Both PR 1 CHECKs are dropped by
  name without `IF EXISTS`.
- **`app.access_grant` is one permission to one subject.** `subject_kind` is `role` or `user`,
  with exactly one of `role_key` and `user_id` set (a CHECK), and each with a foreign key: a role
  grant references the role and goes with it; a person grant references their MEMBERSHIP
  (`tenant_member (tenant_id, user_id)`), not their user, so a grant to a non-member cannot exist
  and removing a person removes what they were granted. `object` and `action` are the Casbin
  request's own; this change admits only `perm:<permission>` with `use`, in a named CHECK
  (`access_grant_permission_only`) whose pattern admits no `*`, which PR 3 replaces to admit object
  grants. `UNIQUE NULLS NOT DISTINCT (tenant_id, subject_kind, role_key, user_id, object, action)`
  stores a grant once; saving it again moves its expiry.
- **A grant expires by the database's clock.** `expires_at` NULL is standing. `accessFor` -- still
  one statement -- reads only grants with `expires_at IS NULL OR expires_at > now()`, so an
  expired grant projects nothing on the next request with nothing to sweep. It is kept, and
  `grants.list` marks it `expired`, decided in the same SQL. A form sends a calendar day as the
  last second of that day in the schedule zone (`endOfScheduleDay`), so the day picked is the day
  printed.
- **Projection.** `accessFor` returns the role, the custom role's stored permissions (a LEFT JOIN)
  and the grants in force to the role and to the person (a correlated subquery folded to JSON);
  `listForUser` reads the same columns through the same fragment, so `tenants.list` and
  `tenants.get` cannot disagree. `rbac.ts` writes custom-role lines in the customer's domain and
  grant lines on the role key or on `user:<uuid>`. **A permission or object the catalogue does not
  know writes no line** -- a stored `*` would otherwise reach `keyMatch` as a pattern for every
  permission -- and `permissionsOf` still asks Casbin about the catalogue alone.
- **The subset rule.** Nobody may give, grant or take away a permission they do not hold. Saving a
  role needs every permission it will hold and every one it held; deleting one needs those and
  every permission granted to it; giving or taking away a grant needs its permission; inviting at
  a role or setting a role needs everything the role confers (its permissions and the grants in
  force to it, asked of Casbin with the role as the subject); setting a role also needs what the
  person's old role conferred; removing a member needs everything they hold. "What it held" is
  guarded in the statement that writes, under the row's lock (`updateRole`, `deleteRole`,
  `deleteGrant`), with the permissions the caller LACKS as its parameter. The refusal is
  FORBIDDEN with `{ reason: "PERMISSION_NOT_HELD", permission, permissions }`: `permission` is
  the first lacking, so an agent that reads a `PERMISSION_REQUIRED` refusal reads this one too.
  `admin` holds the catalogue by construction, so an admin is never stopped by it.
- **Who may.** `roles.list` and `roles.get` are open to every member: which permissions a role
  holds is what a person needs to ask for the right one, and it names nobody. `roles.save`,
  `roles.delete`, `grants.save` and `grants.delete` need `roles:manage`. **`grants.list` needs
  `people:manage`**, not `roles:manage`: a grant to a person says who holds what, which is the
  roster's information (ADR 0119), and is read by whoever may read the roster.
- **Built-ins are code.** `roles.save` and `roles.delete` refuse a built-in's key before reading
  anything (`BUILT_IN_ROLE`), and the CHECKs refuse it in the database. A customer that wants
  something else defines its own role. A grant to a built-in role is allowed: it is how "every
  member here may read the raw lake" is said without editing `member`.
- **The last-admin guard is unchanged**, on the literal `'admin'`. A customer cannot define a
  role keyed `admin`, so the literal counts exactly the holders of the role that manages
  everything; a custom role holding every permission is not counted, and the last admin still
  cannot be moved to it.
- **`people.invite` and `people.setRole` take a role key**, validated by the service against the
  customer's roles (`ROLE_NOT_FOUND`) and the subset rule. `bun run invite` accepts any key of
  the right shape and holds every permission: whoever holds the DSN holds the database.
- **The browser** reads roles from `roles.list` and gates every editor on `can(permissions, …)`;
  it locks a box or omits an option for a permission the reader does not hold, as a courtesy.
  `tenants.get` and `tenants.list` answer with `roleLabel`, so a custom role is named by its label
  wherever the person's role is shown.

## Consequences

- A customer defines, edits and deletes its own roles in People's Roles view, through the CLI
  (`undercroft roles save …`) and over MCP (`roles_save`); grants likewise in the Grants view,
  `undercroft grants save …` and `grants_save`. `docs/runbook/access-control.md` is the how-to.
- `people:manage` no longer implies the power to hand out any role: a holder of it who lacks
  `keys:manage` cannot invite anyone at a role holding `keys:manage`, nor demote or remove an
  admin. For the four built-ins nothing changes, since `admin` was the only built-in holding
  `people:manage`.
- Deleting a customer's own role removes the closed invitations that named it; the audit log keeps
  their record (`people.invite`, `auth.invitationRedeemed`).
- A new built-in role is a code change AND a migration: the trigger, the backfill and the CHECK
  name the four keys. `repos/accessRoles.test.ts` fails when the rows a new customer gets differ
  from `BUILT_IN_ROLES`.
- Every write here is audited by its service with the role or grant as it was and as it became.

## Options rejected

- **Validation with locking instead of a foreign key** -- the assigning statement checks the role
  exists `FOR SHARE`, the delete is one guarded `FOR UPDATE` statement. It works, and binds only
  the statements written that way: `bun run invite`, a backfill or the next writer would have to
  remember it, and a membership naming a deleted role is a member holding nothing, or holding what
  a later role of the same key holds. The foreign key holds for every writer and costs a trigger.
- **Built-ins only in code, a foreign key from custom keys alone.** A column cannot reference "a
  row of this table, or one of four literals"; it would need a CHECK beside a partial reference,
  which Postgres has no syntax for, or a trigger doing what the foreign key does.
- **A free-text `subject` column on grants.** One column for a role key or a user id has no
  referential integrity to either; a grant would outlive its role or its person.
- **RESTRICT on the invitation's foreign key**, as first proposed: it pins every role anyone was
  ever invited at, since accepted invitations are kept.
- **A sweep that deletes expired grants.** A second clock, a job that can fall behind, and the
  record of what was held lost; comparing with `now()` in the reading statement has neither.
- **`grants.list` behind `roles:manage`.** It would let a holder of `roles:manage` alone read who
  holds what, which ADR 0119 keeps with the roster.
- **No subset rule, trusting `roles:manage`.** Then `roles:manage` is every permission: define a
  role holding `keys:manage` and assign it, or grant it to yourself.
