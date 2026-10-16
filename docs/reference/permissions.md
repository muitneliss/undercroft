# Permissions

What a person may do in a customer is a set of **permissions**. A role is a named set of them,
and every customer has four built-in roles. The server decides each call against the caller's
permissions in that customer, and `tenants.get` answers with them (`permissions`, sorted), as
does each row of `tenants.list`. Why it is built this way is
[ADR 0139](../adr/0139-tenant-access-is-casbin-policy.md).

A procedure not listed below is open to every member of the customer, a viewer included, or is
not scoped to a customer at all.

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
`admin` in every customer that exists, with no membership.

## What each permission covers

| Permission         | Procedures                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reports:author`   | `bi.answer`, `bi.compile`, `bi.questions.save`, `bi.questions.delete`, `bi.dashboards.save`, `bi.dashboards.delete`; `bi.exports.create` and `bi.exports.get` for a definition or a model (exporting a saved question needs no permission) |
| `models:write`     | `models.save`, `models.delete`, `models.build`, `models.preview`, `macros.save`, `macros.delete`, `seeds.save`, `seeds.delete`                                                                                                             |
| `lake:read`        | `lake.records`, `lake.documents`, `lake.query`, `lake.search`, `lake.querySchema`, `dq.failures`                                                                                                                                           |
| `sources:manage`   | `connections.startOAuth`, `connections.browseScope`, `connections.setScope`, `connections.setToken`, `connections.setCadence`, `connections.setResync`, `connections.disconnect`, `runs.trigger`, and finishing a source's OAuth consent   |
| `keys:manage`      | `keys.list`, `keys.mint`, `keys.revoke`                                                                                                                                                                                                    |
| `catalogue:manage` | `documentKinds.add`, `documentKinds.update`, `documentKinds.remove`, `documentKinds.initialise`, `documentKinds.publish`                                                                                                                   |
| `people:manage`    | `people.members`, `people.invitations`, `people.invite`, `people.setRole`, `people.removeMember`, `people.revokeInvitation`                                                                                                                |
| `audit:read`       | `audit.tenant`                                                                                                                                                                                                                             |
| `tenant:manage`    | `tenants.rename`, `tenants.deactivate`, `tenants.reactivate`                                                                                                                                                                               |
| `roles:manage`     | none yet: reserved for managing a customer's own roles and grants                                                                                                                                                                          |

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

A caller who is not a member is told the customer does not exist (`NOT_FOUND`), whatever they
asked for, and a deactivated customer refuses every procedure but its own state
(`PRECONDITION_FAILED`, `TENANT_DEACTIVATED`) before any permission is asked.

The audit log records a permission refusal with the reason `PERMISSION_REQUIRED`.
