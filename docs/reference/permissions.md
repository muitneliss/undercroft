# Permissions

What a person may do in a customer is a set of **permissions**. A role is a named set of them;
every customer has four built-in roles and may define its own, and a grant gives one permission
to a role or to one member, standing or until a moment. The server decides each call against the
caller's permissions in that customer -- their role's, and the grants in force to that role and
to them -- and `tenants.get` answers with them (`permissions`, sorted), as does each row of
`tenants.list`. Why it is built this way is
[ADR 0139](../adr/0139-tenant-access-is-casbin-policy.md), and for a customer's own roles and
grants [ADR 0141](../adr/0141-custom-roles-and-grants-under-the-subset-rule.md). How to define a
role or grant a permission is [the access-control runbook](../runbook/access-control.md).

A procedure not listed below is open to every member of the customer, a viewer included --
`roles.list` and `roles.get` among them -- or is not scoped to a customer at all.

## The built-in roles

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

`admin` holds every permission there is, including any added later. A platform superadmin holds
`admin` in every customer that exists, with no membership. The four built-ins cannot be saved or
deleted.

## A customer's own roles and grants

| Thing       | Accepts                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role key    | `^[a-z][a-z0-9_]*$`, at most 63 characters, never `viewer`, `member`, `builder` or `admin`; never changed once created                                                                         |
| Role label  | 1 to 80 characters, the customer's own words, never translated                                                                                                                                 |
| Description | at most 500 characters                                                                                                                                                                         |
| Permissions | any subset of the catalogue above, stored once each in catalogue order; a permission the catalogue later loses is kept and holds nothing                                                       |
| Grant       | one permission (`perm:<permission>`, action `use`) to one role of the customer or one member, at most once per subject and permission; `expiresAt` an ISO 8601 instant with an offset, or none |

An expired grant is kept and listed with `expired: true`, and holds nothing from the moment it
expires, by the database's clock. A grant to a person goes when they are removed; a grant to a
role goes when the role is deleted.

**The subset rule.** A change is refused `FORBIDDEN` with `reason: PERMISSION_NOT_HELD` when it
would give or take away a permission the caller does not hold: inviting at a role or setting a
role (every permission the role confers, and for a role change those of the role left too),
removing a member (everything they hold), saving a role (every permission it will hold and held),
deleting one (those and every permission granted to it), and giving or taking away a grant (its
permission).

## What each permission covers

| Permission         | Procedures                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports:author`   | `bi.answer`, `bi.compile`, `bi.questions.save`, `bi.questions.delete`, `bi.dashboards.save`, `bi.dashboards.delete`; `bi.exports.create` and `bi.exports.get` for a definition or a model (exporting a saved question needs no permission) |
| `models:write`     | `models.save`, `models.delete`, `models.build`, `models.preview`, `macros.save`, `macros.delete`, `seeds.save`, `seeds.delete`                                                                                                             |
| `lake:read`        | `lake.records`, `lake.documents`, `lake.query`, `lake.search`, `lake.querySchema`, `dq.failures`                                                                                                                                           |
| `sources:manage`   | `connections.startOAuth`, `connections.browseScope`, `connections.setScope`, `connections.setToken`, `connections.setCadence`, `connections.setResync`, `connections.disconnect`, `runs.trigger`, and finishing a source's OAuth consent   |
| `keys:manage`      | `keys.list`, `keys.mint`, `keys.revoke`                                                                                                                                                                                                    |
| `catalogue:manage` | `documentKinds.add`, `documentKinds.update`, `documentKinds.remove`, `documentKinds.initialise`, `documentKinds.publish`                                                                                                                   |
| `people:manage`    | `people.members`, `people.invitations`, `people.invite`, `people.setRole`, `people.removeMember`, `people.revokeInvitation`, `grants.list`                                                                                                 |
| `audit:read`       | `audit.tenant`                                                                                                                                                                                                                             |
| `tenant:manage`    | `tenants.rename`, `tenants.deactivate`, `tenants.reactivate`                                                                                                                                                                               |
| `roles:manage`     | `roles.save`, `roles.delete`, `grants.save`, `grants.delete`                                                                                                                                                                               |

Every procedure's description, in the CLI's help and in an MCP client's tool list, ends with
the permission it needs, read off the server's own gate.

## A refusal

A caller who is a member but lacks the permission is refused `FORBIDDEN`. The message names the
permission in words and by key, in the caller's language, and the refusal's details carry:

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| `reason`     | `PERMISSION_REQUIRED`                            |
| `permission` | the permission that was needed, e.g. `lake:read` |
| `tenantId`   | the customer                                     |

A change past the subset rule is refused `FORBIDDEN` too, with `reason: PERMISSION_NOT_HELD`,
`permission` the first permission the caller lacks and `permissions` every one, comma-separated.

A caller who is not a member is told the customer does not exist (`NOT_FOUND`), whatever they
asked for, and a deactivated customer refuses every procedure but its own state
(`PRECONDITION_FAILED`, `TENANT_DEACTIVATED`) before any permission is asked.

The audit log records a permission refusal with the reason `PERMISSION_REQUIRED`.
