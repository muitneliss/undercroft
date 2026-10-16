# Who may do what

What a person may do in a customer is a set of **permissions**. A role is a named set of them.
The server decides every call against the permissions the person holds in that customer, and
you act as that person, never as more. Read this page before you plan a write, and when a call
is refused with `PERMISSION_DENIED`.

## The permissions

| Permission         | What it covers                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reports:author`   | Running a definition against the built models (`bi.answer`, `bi.compile`), saving and deleting questions and dashboards, and exporting a definition or a model.      |
| `models:write`     | Saving, deleting, building and previewing models (`models.save`, `models.build`, `models.preview`), and saving and deleting macros and seeds (reference tables).     |
| `lake:read`        | Reading the raw lake: `lake.records`, `lake.documents`, `lake.query`, `lake.search`, `lake.querySchema`, and the rows a failed test stored (`dq.failures`).          |
| `sources:manage`   | Connecting, scoping, scheduling and disconnecting sources (`connections.startOAuth`, `connections.setScope`, ...), and starting a source's read (`runs.trigger`).    |
| `keys:manage`      | Listing, minting and revoking ingest keys (`keys.list`, `keys.mint`, `keys.revoke`).                                                                                 |
| `catalogue:manage` | Editing, initialising and publishing the catalogue of document kinds (`documentKinds.add`, `documentKinds.publish`, ...).                                            |
| `people:manage`    | Reading who has access and managing it: `people.members`, `people.invitations`, `people.invite`, `people.setRole`, `people.removeMember`, `people.revokeInvitation`. |
| `audit:read`       | Reading the whole customer's activity (`audit.tenant`).                                                                                                              |
| `tenant:manage`    | Renaming, deactivating and reactivating the customer (`tenants.rename`, `tenants.deactivate`, `tenants.reactivate`).                                                 |
| `roles:manage`     | Reserved for managing a customer's own roles. No operation needs it yet.                                                                                             |

An operation not covered above is open to every member of the customer, a viewer included:
listing and reading models, macros, seeds, questions and dashboards, `models.check`,
`lake.summary`, `runs.list`, answering a saved question and exporting it.

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

Roles a customer defines for itself, grants to one person that expire, grants on a single
model, raw stream or report, and rules on rows and columns are coming in later releases. Until
then, the four roles above are all there is.

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
`people:manage` for a role that has the permission.** Name the permission, not a role: more
than one role holds it, and asking to be made admin asks for far more than the task needs.

Never retry it, and never work around it -- by another operation that reaches the same data, or
by asking the person for someone else's credential. A `PERMISSION_DENIED` whose `reason` is
`WRITES_DISABLED` is a different refusal: the connection or token only reads, and
`references/mcp.md` and `references/cli.md` say what to tell the person.

Two refusals come before any permission is asked:

- **`NOT_FOUND`**: the person is not a member of that customer, or it does not exist. The
  platform deliberately does not say which.
- **`CONFLICT` with `TENANT_DEACTIVATED`**: the customer is deactivated, and refuses every
  operation but reading its own state until someone holding `tenant:manage` reactivates it.
