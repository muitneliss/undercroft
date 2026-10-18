---
title: Permissions
type: source
date: 2026-10-18
tags: []
source: docs/reference/permissions.md
source_path: docs/reference/permissions.md
source_hash: 06de550b2fa0c4bf757ba391642f0ea70e52f191ca6e48501458d09810508db0
ingested: 2026-10-18
---

# Permissions

The reference for what a person may do and read in a customer (`docs/reference/permissions.md`), from [[ADR 0139 Tenant Access Is Casbin Policy]], [[ADR 0141 Custom Roles and Grants Under the Subset Rule]], [[ADR 0142 Object Reach and Scope Logins]] [[ADR 0143 Row and Column Rules on Model Grants]] and [[ADR 0146 Each Division Reads Under Its Own Permission]]. A role is a named set of permissions; every customer has four built-in roles and may define its own; a grant gives one permission, or reading one object, to a role or a member, standing or until a moment. `tenants.get` and each `tenants.list` row answer with the caller's `permissions`; `grants.reach` answers permissions and reach; `scopes.preview` answers what that comes to, model by model. The how-to is [[Runbook: Access control]].

**Built-in roles.** `viewer` holds none; `member` holds `reports:author`; `builder` holds `reports:author`, `models:read`, `models:write`, `lake:read`, `runs:read` and `sources:read`; `admin` holds every permission, including any added later. A platform superadmin holds `admin` in every customer that exists. Every built-in reaches the whole customer, and is never narrowed by a rule. A viewer and a member open Customers and Reports and no other division: Sources needs `sources:read`, the Journal `runs:read`, the Lake `lake:read`, Models `models:read`, People `people:manage`. Open to every member: the reads of Reports (`bi.runQuestion`, `bi.questions.list/get/answer`, `bi.dashboards.list/get`, `bi.schema`, exporting a saved question), `roles.list/get`, `tenants.get`, and `grants.reach` and `scopes.preview` about oneself.

**Coverage.** `reports:author`: `bi.answer`, `bi.compile`, saving and deleting questions and dashboards, exporting a definition or a model. `models:read`: `models.list/get/revision/check/lineage/reference`, `macros.list/get/check`, `seeds.list/get`. `models:write`: `models.save/delete/build/preview`, `macros.save/delete`, `seeds.save/delete`. `lake:read`: `lake.summary/records/documents/query/search/querySchema`, `dq.failures`, `documentKinds.list`. `runs:read`: `runs.list/get/events`. `sources:read`: `connections.list/get`. `sources:manage`: `connections.*` writes, `browseScope`, `runs.trigger`, finishing OAuth consent. `keys:manage`: `keys.*`. `catalogue:manage`: `documentKinds` writes. `people:manage`: `people.*`, `grants.list`, `grants.reach` and `scopes.preview` about others. `audit:read`: `audit.tenant`. `tenant:manage`: `tenants.rename/deactivate/reactivate`. `roles:manage`: `roles.save/delete`, `grants.save/delete`. Each procedure's description ends with what its gates need.

**Objects.** `model:<name>`/`model:*`, `raw:<source>/<entity>`/`raw:<source>/*`/`raw:*`, `report:question:<uuid>`/`report:dashboard:<uuid>`/`report:*`, each `read`; a `*` only where shown; one model or report must exist. A customer's own role reaches only what is granted. Outside reach: an empty page for a stream, `NOT_FOUND` for a model or report, a dashboard's `ungranted` tiles, and Postgres's "permission denied" for a question over an unreached model. The build login's procedures need `model:*` and `raw:*` (`WHOLE_REACH_REQUIRED`). A narrow reader's new report is granted to them.

**Rows and columns.** A grant on one model may carry `rowRule` (1-10 conditions, `eq` one value or `in` 1-100, values at most 200 characters) and `hiddenColumns` (at most 200), naming columns the last build found. Effective access is the union of grants. A row rule is RLS on the scope login, typed, NULL never matching; answers name row-limited tables in `rowsLimited`. A hidden column is refused (`COLUMN_NOT_GRANTED`), left out of `bi.schema`, `models.list/get`, `seeds.get`; a column a later build adds is visible until hidden. A broken rule shows no row and is `broken` in `scopes.preview`. `seeds.get` withholds rows from a row-limited reader (`rowsWithheld`).

**Own roles and grants.** Role key `^[a-z][a-z0-9_]*$` (at most 63, never a built-in's, never changed), label 1-80 characters, description at most 500; permissions a catalogue subset. A grant is one permission (`use`) or one object (`read`) to one role or one member, once per subject and object, optional ISO 8601 `expiresAt`; an expired grant is kept and holds nothing. Grants go with their person, role, or the model/report they name.

**The subset rule.** `PERMISSION_NOT_HELD` for a permission the caller lacks, `REACH_NOT_HELD` for an object -- or more of a model's rows or columns -- they do not reach, across invites, role changes, removals, role saves and deletes, and grants. **Refusals:** `PERMISSION_REQUIRED` (with `permission`), `OBJECT_SHAPE`, `OBJECT_NOT_FOUND`, `ONE_OBJECT`, `RULES_NEED_ONE_MODEL`, `RULE_SHAPE`, `COLUMN_NOT_FOUND`, `GRANT_CHANGED`, `COLUMN_NOT_GRANTED`; a non-member gets `NOT_FOUND`, a deactivated customer `TENANT_DEACTIVATED` first.
