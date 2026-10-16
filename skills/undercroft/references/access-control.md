# Who may do what

What a person may do in a customer is a set of **permissions**. A role is a named set of them,
and a grant gives one more permission to a role or to one person. The server decides every call
against the permissions the person holds in that customer, and you act as that person, never as
more. Read this page before you plan a write, and when a call
is refused with `PERMISSION_DENIED`.

## The permissions

| Permission         | What it covers                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports:author`   | Running a definition against the built models (`bi.answer`, `bi.compile`), saving and deleting questions and dashboards, and exporting a definition or a model.                                              |
| `models:write`     | Saving, deleting, building and previewing models (`models.save`, `models.build`, `models.preview`), and saving and deleting macros and seeds (reference tables).                                             |
| `lake:read`        | Reading the raw lake: `lake.records`, `lake.documents`, `lake.query`, `lake.search`, `lake.querySchema`, and the rows a failed test stored (`dq.failures`).                                                  |
| `sources:manage`   | Connecting, scoping, scheduling and disconnecting sources (`connections.startOAuth`, `connections.setScope`, ...), and starting a source's read (`runs.trigger`).                                            |
| `keys:manage`      | Listing, minting and revoking ingest keys (`keys.list`, `keys.mint`, `keys.revoke`).                                                                                                                         |
| `catalogue:manage` | Editing, initialising and publishing the catalogue of document kinds (`documentKinds.add`, `documentKinds.publish`, ...).                                                                                    |
| `people:manage`    | Reading who has access and managing it: `people.members`, `people.invitations`, `people.invite`, `people.setRole`, `people.removeMember`, `people.revokeInvitation`, and reading the grants (`grants.list`). |
| `audit:read`       | Reading the whole customer's activity (`audit.tenant`).                                                                                                                                                      |
| `tenant:manage`    | Renaming, deactivating and reactivating the customer (`tenants.rename`, `tenants.deactivate`, `tenants.reactivate`).                                                                                         |
| `roles:manage`     | Defining, changing and deleting the customer's own roles (`roles.save`, `roles.delete`), and giving and taking away grants (`grants.save`, `grants.delete`).                                                 |

An operation not covered above is open to every member of the customer, a viewer included:
listing and reading models, macros, seeds, questions and dashboards, `models.check`,
`lake.summary`, `runs.list`, answering a saved question and exporting it, and reading the roles
(`roles.list`, `roles.get`).

Every operation's description, in `undercroft describe` and in your MCP tool list, ends with
the permission it needs ("Needs models:write.", in Vietnamese "Cần quyền models:write."),
read off the server's own gate. Trust that sentence over this page when they differ.

## The built-in roles

Every customer has four.

| Permission         | viewer | member | builder | admin |
| ------------------ | :----: | :----: | :-----: | :---: |
| `reports:author`   |        |   ✓    |    ✓    |   ✓   |
| `models:write`     |        |        |    ✓    |   ✓   |
| `lake:read`        |        |        |    ✓    |   ✓   |
| `sources:manage`   |        |        |         |   ✓   |
| `keys:manage`      |        |        |         |   ✓   |
| `catalogue:manage` |        |        |         |   ✓   |
| `people:manage`    |        |        |         |   ✓   |
| `audit:read`       |        |        |         |   ✓   |
| `tenant:manage`    |        |        |         |   ✓   |
| `roles:manage`     |        |        |         |   ✓   |

- **viewer** reads reports and what the customer has built, and changes nothing.
- **member** also writes and saves reports.
- **builder** also writes, previews and builds models, macros and seeds, and reads the raw lake
  they are written over. A builder does not manage people, sources, keys, the document-kind
  catalogue or the customer.
- **admin** holds every permission, including any added later. A platform administrator holds
  admin in every customer.

The four built-ins are the platform's: they cannot be changed or deleted, and every customer has
them.

## A customer's own roles

A customer may define more roles: a key (a lowercase identifier such as `ke_toan`, never one of
the four built-ins), a label in its own words ("Kế toán"), a description, and a flat set of
permissions from the catalogue. `roles.list` shows every role the customer has -- built-ins
first -- with what each holds, how many people hold it (`members`) and how many open invitations
name it (`invitations`); any member may read it. A person is given one with `people.setRole` or
invited at one with `people.invite`, by its key, exactly as a built-in is.

- `roles.save` with `create: true` defines a role and is refused (`CONFLICT`, `ROLE_TAKEN`) if
  the key is in use; without `create` it defines or replaces the role. The same content again
  answers `unchanged: true`. The permissions are the whole set, not a change to it.
- `roles.delete` deletes a role and every grant to it. It is refused (`CONFLICT`, `ROLE_IN_USE`)
  while anyone holds the role or an open invitation names it.
- A built-in's key is refused by both (`VALIDATION_FAILED`, `BUILT_IN_ROLE`).

A role's name says nothing about what it holds. Read its `permissions`; never infer them from the
key or the label.

## Grants

A grant gives **one permission** to a role (every holder of it in this customer) or to one
member, by address. It holds from the next request, and either stands or lasts until
`expiresAt`, an ISO 8601 instant with its offset (`2026-10-31T23:59:59+08:00`). An expired grant
holds nothing; `grants.list` still lists it, with `expired: true`, as the record of what was
held. Saving the same grant again moves its expiry; the same expiry again is `unchanged: true`.

- `grants.list` lists every grant, or those to one `role` or one `email`. It needs
  `people:manage`, because it says who holds what.
- `grants.save` takes exactly one of `role` and `email`, a `permission`, and an optional
  `expiresAt`. A grant to a person needs them to be a member; removing them removes it.
- `grants.delete` takes a grant away by its `id`.

What a person holds is their role's permissions, plus the grants in force to that role and to
them. `tenants.get` answers with all of it already decided.

## The subset rule

Nobody may give, grant or take away a permission they do not hold themselves. With
`roles:manage` alone you can define a role holding only `roles:manage`; with `people:manage`
alone you can invite people at `viewer`.

- Inviting someone at a role, or setting someone's role, needs every permission the role confers
  (its own and the grants to it); setting a role also needs every permission of the role the
  person leaves.
- Removing a person needs every permission they hold.
- Saving a role needs every permission it will hold and every one it held before; deleting one
  needs those and every permission granted to it.
- Giving or taking away a grant needs its permission.

`admin` holds every permission, so an admin is never stopped by this rule. The last admin of a
customer still cannot be demoted or removed, and a role of the customer's own never counts as
`admin`, whatever it holds.

## Not possible yet

Grants on a single model, raw stream or entity, or report or dashboard, and rules on rows and
columns, are planned for later releases. A permission covers the whole customer until then.

## Check your own rights first

Before you plan a write, read what the person holds: `tenants.get` answers with `role` and
`permissions`, a sorted list of permission keys, and each row of `tenants.list` carries the
same two fields. With the CLI that is
`undercroft tenants get --tenant-id CASE-0042 --agent`; over MCP it is `tenants_get`. A
builder's answer:

```json
{
  "id": "CASE-0042",
  "displayName": "Acme",
  "deactivatedAt": null,
  "role": "builder",
  "permissions": ["lake:read", "models:write", "reports:author"]
}
```

Decide from `permissions`, never from `role`: the permission is what the server asks for. When
the plan needs a permission the list lacks, say so at the start, before any interview or
draft, and say which permission.

## A refusal for a missing permission

A member who lacks the permission is refused with the code `PERMISSION_DENIED` (tRPC's
`FORBIDDEN`). Its `details` -- `error.details` in the CLI's envelope, `details` in an MCP
refusal -- carry:

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| `reason`     | `PERMISSION_REQUIRED`                            |
| `permission` | the permission that was needed, e.g. `lake:read` |
| `tenantId`   | the customer                                     |

The `message` names the permission in words and by key, in the person's language. Give it to
them as it is, and tell them what to do: **ask someone in this customer who holds
`people:manage` for a role that has the permission, or someone who holds `roles:manage` and the
permission for a grant of it.** Name the permission, not a role: more than one role holds it,
and asking to be made admin asks for far more than the task needs.

A refusal whose `reason` is `PERMISSION_NOT_HELD` is the subset rule: the person may make this
kind of change but not with these permissions. `permission` is the first one they lack and
`permissions` every one, comma-separated. Tell them only someone holding those can make the
change.

Never retry it, and never work around it -- by another operation that reaches the same data, or
by asking the person for someone else's credential. A `PERMISSION_DENIED` whose `reason` is
`WRITES_DISABLED` is a different refusal: the connection or token only reads, and
`references/mcp.md` and `references/cli.md` say what to tell the person.

Two refusals come before any permission is asked:

- **`NOT_FOUND`**: the person is not a member of that customer, or it does not exist. The
  platform deliberately does not say which.
- **`CONFLICT` with `TENANT_DEACTIVATED`**: the customer is deactivated, and refuses every
  operation but reading its own state until someone holding `tenant:manage` reactivates it.
