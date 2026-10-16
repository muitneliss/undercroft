---
title: Permissions
type: source
date: 2026-10-16
tags: []
source: docs/reference/permissions.md
source_path: docs/reference/permissions.md
source_hash: fee68e63fe13cb056c397d7bc70c434f58d42c33cbf7b798a2f34035636e5dab
ingested: 2026-10-16
---

# Permissions

# Permissions

The reference for what a person may do in a customer (`docs/reference/permissions.md`), from [[ADR 0139 Tenant Access Is Casbin Policy]] and [[ADR 0141 Custom Roles and Grants Under the Subset Rule]]. A role is a named set of permissions; every customer has four built-in roles and may define its own, and a grant gives one permission to a role or a member, standing or until a moment. `tenants.get` and each `tenants.list` row answer with the caller's `permissions` -- their role's plus the grants in force -- sorted. The how-to is [[Runbook: Access control]].

**Built-in roles.** `viewer` holds none; `member` holds `reports:author`; `builder` holds `reports:author`, `models:write` and `lake:read`; `admin` holds every permission, including any added later. A platform superadmin holds `admin` in every customer that exists.

**Coverage.** `reports:author`: `bi.answer`, `bi.compile`, saving and deleting questions and dashboards, and exporting a definition or a model (`bi.exports.create`/`get`; a saved question needs no permission). `models:write`: `models.save/delete/build/preview`, `macros.save/delete`, `seeds.save/delete`. `lake:read`: `lake.records/documents/query/search/querySchema`, `dq.failures`. `sources:manage`: every `connections.*` write and `browseScope`, `runs.trigger`, and finishing a source's OAuth consent. `keys:manage`: `keys.*`. `catalogue:manage`: the `documentKinds` writes. `people:manage`: `people.*` and `grants.list`. `audit:read`: `audit.tenant`. `tenant:manage`: `tenants.rename/deactivate/reactivate`. `roles:manage`: `roles.save/delete`, `grants.save/delete`. `roles.list`/`get` are open to every member. Anything not listed is open to every member or not tenant-scoped. Each procedure's CLI and MCP description ends with the permission it needs.

**A customer's own roles and grants.** A role key is `^[a-z][a-z0-9_]*$`, at most 63 characters, never a built-in's, never changed; a label is 1-80 characters of the customer's own words; a description at most 500. Permissions are a catalogue subset, stored once each in catalogue order; one the catalogue later loses holds nothing. A grant is one `perm:<permission>` with `use`, to one role or one member, once per subject and permission, with an optional ISO 8601 `expiresAt`; an expired grant is kept, listed `expired: true`, and holds nothing by the database's clock. A person's grants go when they are removed, a role's when it is deleted. Built-ins cannot be saved or deleted.

**The subset rule.** A change that would give or take away a permission the caller lacks is `FORBIDDEN` with `reason: PERMISSION_NOT_HELD`, `permission` (first lacking) and `permissions` (all): inviting at or setting a role (what it confers, and for a change the old role's too), removing a member (all they hold), saving a role (what it will hold and held), deleting one (those and its grants), and saving or deleting a grant.

**Refusal.** A member lacking the permission gets `FORBIDDEN`, worded with the permission's label and key, with details `reason: PERMISSION_REQUIRED`, `permission`, `tenantId`. A non-member still gets `NOT_FOUND`, and a deactivated customer refuses first with `PRECONDITION_FAILED` / `TENANT_DEACTIVATED`. The audit log records the refusal as `PERMISSION_REQUIRED`.
