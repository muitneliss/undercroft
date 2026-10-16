---
title: Permissions
type: source
date: 2026-10-16
tags: []
source: docs/reference/permissions.md
source_path: docs/reference/permissions.md
source_hash: 5cd5fd468034f7d7b928fa6e213c527fd0b288b51308f5c81f4822975c5ca305
ingested: 2026-10-16
---

# Permissions

# Permissions

The reference for what a person may do and read in a customer (`docs/reference/permissions.md`), from [[ADR 0139 Tenant Access Is Casbin Policy]], [[ADR 0141 Custom Roles and Grants Under the Subset Rule]] and [[ADR 0142 Object Reach and Scope Logins]]. A role is a named set of permissions; every customer has four built-in roles and may define its own; a grant gives one permission, or reading one object, to a role or a member, standing or until a moment. `tenants.get` and each `tenants.list` row answer with the caller's `permissions`; `grants.reach` answers permissions and reach. The how-to is [[Runbook: Access control]].

**Built-in roles.** `viewer` holds none; `member` holds `reports:author`; `builder` holds `reports:author`, `models:write` and `lake:read`; `admin` holds every permission, including any added later. A platform superadmin holds `admin` in every customer that exists. Every built-in reaches the whole customer.

**Coverage.** `reports:author`: `bi.answer`, `bi.compile`, saving and deleting questions and dashboards, exporting a definition or a model. `models:write`: `models.save/delete/build/preview`, `macros.save/delete`, `seeds.save/delete`. `lake:read`: `lake.records/documents/query/search/querySchema`, `dq.failures`. `sources:manage`: `connections.*` writes, `browseScope`, `runs.trigger`, finishing OAuth consent. `keys:manage`: `keys.*`. `catalogue:manage`: `documentKinds` writes. `people:manage`: `people.*`, `grants.list`, `grants.reach` about others. `audit:read`: `audit.tenant`. `tenant:manage`: `tenants.rename/deactivate/reactivate`. `roles:manage`: `roles.save/delete`, `grants.save/delete`. Each procedure's description ends with what its gates need.

**Objects.** `model:<name>`/`model:*`, `raw:<source>/<entity>`/`raw:<source>/*`/`raw:*`, `report:question:<uuid>`/`report:dashboard:<uuid>`/`report:*`, each `read`; a `*` only where shown; one model or report must exist. A customer's own role reaches only what is granted. Outside reach: an empty page for a stream, `NOT_FOUND` for a model or report, a dashboard's `ungranted` tiles, and Postgres's "permission denied" for a question over an unreached model. The build login's procedures need `model:*` and `raw:*` (`WHOLE_REACH_REQUIRED`). A narrow reader's new report is granted to them.

**Own roles and grants.** Role key `^[a-z][a-z0-9_]*$` (at most 63, never a built-in's, never changed), label 1-80 characters, description at most 500; permissions a catalogue subset. A grant is one permission (`use`) or one object (`read`) to one role or one member, once per subject and object, optional ISO 8601 `expiresAt`; an expired grant is kept and holds nothing. Grants go with their person, role, or the model/report they name.

**The subset rule.** `PERMISSION_NOT_HELD` for a permission the caller lacks, `REACH_NOT_HELD` for an object they do not reach -- across invites, role changes, removals, role saves and deletes, and grants. **Refusals:** `PERMISSION_REQUIRED` (with `permission`), `OBJECT_SHAPE`, `OBJECT_NOT_FOUND`, `ONE_OBJECT`; a non-member gets `NOT_FOUND`, a deactivated customer `TENANT_DEACTIVATED` first.
