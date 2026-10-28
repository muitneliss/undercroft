# Permissions

What a person may do in a customer is a set of **permissions**, and what they may read is their
**reach**: which models, raw streams and reports. A role is a named set of permissions; every
customer has four built-in roles and may define its own, and a grant gives one permission, or
reading one thing, to a role or to one member, standing or until a moment. The server decides each
call against the caller's permissions and reach in that customer -- their role's, and the grants
in force to that role and to them -- and `tenants.get` answers with the permissions
(`permissions`, sorted), as does each row of `tenants.list`; `grants.reach` answers both. Why it is
built this way is [ADR 0139](../adr/0139-tenant-access-is-casbin-policy.md), for a customer's own
roles and grants [ADR 0141](../adr/0141-custom-roles-and-grants-under-the-subset-rule.md), and for
reach [ADR 0142](../adr/0142-object-reach-and-scope-logins.md), and for row and column rules
[ADR 0143](../adr/0143-row-and-column-rules-on-model-grants.md), and for the read permissions
behind Sources, the Journal, the Lake and Models
[ADR 0147](../adr/0147-each-division-reads-under-its-own-permission.md). How to define a role or
grant a permission is [the access-control runbook](../runbook/access-control.md).

A procedure not listed below is open to every member of the customer, a viewer included, or is not
scoped to a customer at all. Those are the reads of Reports (`bi.runQuestion`,
`bi.questions.list`, `bi.questions.get`, `bi.questions.answer`, `bi.dashboards.list`,
`bi.dashboards.get`, `bi.schema`, and exporting a saved question), `roles.list` and `roles.get`,
`tenants.get`, and `grants.reach` and `scopes.preview` about oneself.

## The built-in roles

| Permission         | viewer | member | builder | admin |
| ------------------ | :----: | :----: | :-----: | :---: |
| `reports:author`   |        |   ✓    |    ✓    |   ✓   |
| `models:read`      |        |        |    ✓    |   ✓   |
| `models:write`     |        |        |    ✓    |   ✓   |
| `lake:read`        |        |        |    ✓    |   ✓   |
| `runs:read`        |        |        |    ✓    |   ✓   |
| `sources:read`     |        |        |    ✓    |   ✓   |
| `sources:manage`   |        |        |         |   ✓   |
| `keys:manage`      |        |        |         |   ✓   |
| `catalogue:manage` |        |        |         |   ✓   |
| `people:manage`    |        |        |         |   ✓   |
| `audit:read`       |        |        |         |   ✓   |
| `tenant:manage`    |        |        |         |   ✓   |
| `roles:manage`     |        |        |         |   ✓   |

`admin` holds every permission there is, including any added later. A platform superadmin holds
`admin` in every customer that exists, with no membership. The four built-ins cannot be saved or
deleted. **Every built-in role reaches the whole customer**: every model and reference table, the
whole raw lake, every report. A viewer and a member open Customers and Reports and no other
division of a customer's book: Sources needs `sources:read`, the Journal `runs:read`, the Lake
`lake:read`, Models `models:read`, and People `people:manage`.

## A customer's own roles and grants

| Thing       | Accepts                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role key    | `^[a-z][a-z0-9_]*$`, at most 63 characters, never `viewer`, `member`, `builder` or `admin`; never changed once created                                                                                                          |
| Role label  | 1 to 80 characters, the customer's own words, never translated                                                                                                                                                                  |
| Description | at most 500 characters                                                                                                                                                                                                          |
| Permissions | any subset of the catalogue above, stored once each in catalogue order; a permission the catalogue later loses is kept and holds nothing                                                                                        |
| Grant       | one permission (`perm:<permission>`, action `use`) or one object (below, action `read`) to one role of the customer or one member, at most once per subject and object; `expiresAt` an ISO 8601 instant with an offset, or none |

An expired grant is kept and listed with `expired: true`, and holds nothing from the moment it
expires, by the database's clock. A grant to a person goes when they are removed; a grant to a
role goes when the role is deleted; a grant on a model, a reference table, a question or a
dashboard goes when that is deleted.

## Objects: what a grant lets someone read

| Object                    | Reaches                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `model:<name>`            | one model or reference table, by name (`^[a-z][a-z0-9_]{0,62}$`); it must exist         |
| `model:*`                 | every model and reference table                                                         |
| `raw:<source>/<entity>`   | one raw stream; a source's document catalogue is the entity `documents`                 |
| `raw:<source>/*`          | every stream of one source; `gmail` and `gmail.3fa9c1d2e0ab` are two sources            |
| `raw:*`                   | the whole raw lake, a stream under a source no connector names included                 |
| `report:question:<uuid>`  | one saved question; it must exist                                                       |
| `report:dashboard:<uuid>` | one dashboard; it must exist. Its tiles' questions are reached only by their own grants |
| `report:*`                | every report                                                                            |

A `*` stands only where the table shows one; `model:fct_*` is refused. A source is a source
instance (`gmail`, `gmail.<12 hex>`); an entity is anything but `*` and a control character, at
most 128 characters. A raw stream need not have landed yet. A customer's own role reaches only
what is granted to it; a grant to a person adds to what their role reaches.

Reach and permissions compose. Paging a raw stream needs `lake:read` and the stream's reach; a
stream outside it answers as an empty page, a model or report outside it as `NOT_FOUND`, and a
dashboard lists the tiles a reader may not open in `ungranted`. A reader who reaches fewer than
every model reads reports through a login Postgres lets read only those tables, so a question over
another model is refused in Postgres's words -- `permission denied for table …`, `BAD_REQUEST` --
however its SQL names it. Opening a report does not widen what it reads.

`lake.query`, `lake.querySchema`, `models.preview`, `dq.failures`, `models.save`, `models.delete`,
`models.build`, `macros.save`, `macros.delete`, `seeds.save` and `seeds.delete` run SQL as the
customer's build login, which reads everything, or change what it runs: beside their permission
they need `model:*` and `raw:*`, refused `FORBIDDEN` with `reason: WHOLE_REACH_REQUIRED` and the
objects missing. Every built-in role that holds the permission reaches both.

A person who saves a question or a dashboard while reaching only some reports is granted that
report, by a grant to them listed like any other.

## Rules on a model grant: rows and columns

A grant on one model or reference table (`model:<name>`) may also carry, in `grants.save`:

| Field           | Accepts                                                                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rowRule`       | 1 to 10 conditions `{ column, op, values }`, all of which a row must meet. `op` is `eq` (exactly one value) or `in` (1 to 100). A value is a string of at most 200 characters, no control character |
| `hiddenColumns` | at most 200 column names the holder may not read                                                                                                                                                    |

A column is `^[A-Za-z_][A-Za-z0-9_]{0,62}$` and must be one the model's last build found, or one
the reference table declares (`COLUMN_NOT_FOUND`); a model never built has none. `model:*`, a
permission, a raw stream and a report carry no rule (`RULES_NEED_ONE_MODEL`). Saving the same grant
again replaces its rules, as it replaces its expiry; `grants.list` answers each grant's `rowRule`
and `hiddenColumns`, `null` for none.

What a person reads of a model is the union of every grant that reaches them on it: any grant with
no row rule, or `model:*`, is every row; otherwise a row is seen when it meets any one grant's
rule. A column is hidden only when every grant hides it. Every built-in role holds `model:*` and is
never narrowed.

- **A row rule** is enforced by Postgres, as row-level security on the reader's scope login. A
  value is compared as the column's own type -- `'7'` is the integer 7 -- and a NULL never matches.
  A total over a row-limited table is the total of the rows the reader may see: an answer names
  such tables in `rowsLimited`, and Reports says so above the figure.
- **A hidden column** is refused, never blanked: naming it, or `SELECT *`, is refused
  `BAD_REQUEST` with `reason: COLUMN_NOT_GRANTED` and the columns. It is left out of `bi.schema`,
  `models.list`, `models.get` and `seeds.get`. Hiding is a list of what to hide: **a column a later
  build adds is visible until it is hidden.**
- **A broken rule** -- one naming a column the table no longer has, or a value its column's type
  refuses -- shows that reader no row of the table, never every row. `scopes.preview` reports it as
  `broken` (`column-missing`, `value-type`, or `not-a-table` for a materialised view).
- `seeds.get` shows a reader with a row rule on a reference table its columns and no rows
  (`rowsWithheld: true`): they read the rows through Reports.

**`scopes.preview`** answers what a role, a member or the caller can see, resolved: `permissions`;
`models`, with `whole`, `total` and `reached` -- each reached model with `rows` (`null` for every
row), `hidden` and `broken`; `raw`; `reports`. About oneself it needs nothing; about a role or another
person, `people:manage`.

The subset rule weighs how much of a model a grant gives: a caller may give a rule only at least
as narrow as their own -- each condition of theirs implied by one of the grant's, on the same
column with values among theirs -- hiding at least every column hidden from them. Replacing or
taking away a grant weighs what it gave.

**The subset rule.** A change is refused `FORBIDDEN` with `reason: PERMISSION_NOT_HELD` when it
would give or take away a permission the caller does not hold: inviting at a role or setting a
role (every permission the role confers, and for a role change those of the role left too),
removing a member (everything they hold), saving a role (every permission it will hold and held),
deleting one (those and every permission granted to it), and giving or taking away a grant (its
permission). It is refused with `reason: REACH_NOT_HELD` when the caller holds every permission
involved but does not reach an object it would give or take away: the same changes, weighed by
what the role or the member reaches and by the object a grant names. `model:*` is reached only by
`model:*`, `raw:<source>/*` by that source or `raw:*`.

## What each permission covers

| Permission         | Procedures                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports:author`   | `bi.answer`, `bi.compile`, `bi.questions.save`, `bi.questions.delete`, `bi.dashboards.save`, `bi.dashboards.delete`; `bi.exports.create` and `bi.exports.get` for a definition or a model (exporting a saved question needs no permission)       |
| `models:read`      | `models.list`, `models.get`, `models.revision`, `models.check`, `models.lineage`, `models.reference`, `macros.list`, `macros.get`, `macros.check`, `seeds.list`, `seeds.get`                                                                     |
| `models:write`     | `models.save`, `models.delete`, `models.build`, `models.preview`, `macros.save`, `macros.delete`, `seeds.save`, `seeds.delete`                                                                                                                   |
| `lake:read`        | `lake.summary`, `lake.records`, `lake.documents`, `lake.query`, `lake.search`, `lake.querySchema`, `dq.failures`, `documentKinds.list`                                                                                                           |
| `runs:read`        | `runs.list`, `runs.get`, `runs.events`                                                                                                                                                                                                           |
| `sources:read`     | `connections.list`, `connections.get`                                                                                                                                                                                                            |
| `sources:manage`   | `connections.startOAuth`, `connections.browseScope`, `connections.setScope`, `connections.setToken`, `connections.setCadence`, `connections.setResync`, `connections.disconnect`, `runs.trigger`, and finishing a source's OAuth consent         |
| `keys:manage`      | `keys.list`, `keys.mint`, `keys.revoke`                                                                                                                                                                                                          |
| `catalogue:manage` | `documentKinds.add`, `documentKinds.update`, `documentKinds.remove`, `documentKinds.initialise`, `documentKinds.publish`                                                                                                                         |
| `people:manage`    | `people.members`, `people.invitations`, `people.invite`, `people.setRole`, `people.removeMember`, `people.revokeInvitation`, `grants.list`; `grants.reach` and `scopes.preview` about a role or another person (about oneself they need nothing) |
| `audit:read`       | `audit.tenant`                                                                                                                                                                                                                                   |
| `tenant:manage`    | `tenants.rename`, `tenants.deactivate`, `tenants.reactivate`                                                                                                                                                                                     |
| `roles:manage`     | `roles.save`, `roles.delete`, `grants.save`, `grants.delete`                                                                                                                                                                                     |

Every procedure's description, in the CLI's help and in an MCP client's tool list, ends with
the permission it needs, read off the server's own gate.

A few procedures belong to no permission and no customer: a platform superadmin's alone, whatever
role they hold. They are `tenants.create`, `audit.all`, and the agents' call log,
`audit.calls.list` and `audit.calls.get` (ADR 0151). Anybody else is refused `FORBIDDEN`.

## A refusal

A caller who is a member but lacks the permission is refused `FORBIDDEN`. The message names the
permission in words and by key, in the caller's language, and the refusal's details carry:

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| `reason`     | `PERMISSION_REQUIRED`                            |
| `permission` | the permission that was needed, e.g. `lake:read` |
| `tenantId`   | the customer                                     |

A change past the subset rule is refused `FORBIDDEN` too, with `reason: PERMISSION_NOT_HELD`,
`permission` the first permission the caller lacks and `permissions` every one, comma-separated --
or with `reason: REACH_NOT_HELD`, `object` the first object the caller does not reach and
`objects` every one. A procedure that needs the whole reach is refused with
`reason: WHOLE_REACH_REQUIRED` and `object`, `objects` the wildcards missing. A grant naming no
object the grammar admits is `BAD_REQUEST`, `OBJECT_SHAPE`; one naming a model or report the
customer lacks, `NOT_FOUND`, `OBJECT_NOT_FOUND`; neither or both of a permission and an object,
`BAD_REQUEST`, `ONE_OBJECT`.

A rule on anything but one model is `BAD_REQUEST`, `RULES_NEED_ONE_MODEL`; an `eq` with other than
one value, `RULE_SHAPE`; a column the model does not have, `COLUMN_NOT_FOUND` with `model` and
`columns`; a grant changed by someone else between being weighed and being written, `CONFLICT`,
`GRANT_CHANGED`. A query naming a hidden column is `BAD_REQUEST`, `COLUMN_NOT_GRANTED`, with
`model` and `columns`.

A caller who is not a member is told the customer does not exist (`NOT_FOUND`), whatever they
asked for, and a deactivated customer refuses every procedure but its own state
(`PRECONDITION_FAILED`, `TENANT_DEACTIVATED`) before any permission is asked.

The audit log records a permission refusal with the reason `PERMISSION_REQUIRED`.
