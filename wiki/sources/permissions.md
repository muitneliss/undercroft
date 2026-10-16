---
title: Permissions
type: source
date: 2026-10-16
tags: []
source: docs/reference/permissions.md
source_path: docs/reference/permissions.md
source_hash: 4f409ece50a022c2ffe1a8ebd719b4039b479ae751712cf39a9108b2d8a5c185
ingested: 2026-10-16
---

# Permissions

# Permissions

The reference for what a person may do in a customer (`docs/reference/permissions.md`), from [[ADR 0139 Tenant Access Is Casbin Policy]]. A role is a named set of permissions; every customer has four built-in roles, and `tenants.get` and each `tenants.list` row answer with the caller's `permissions`, sorted.

**Built-in roles.** `viewer` holds none; `member` holds `reports:author`; `builder` holds `reports:author`, `models:write` and `lake:read`; `admin` holds every permission, including any added later. A platform superadmin holds `admin` in every customer that exists.

**Coverage.** `reports:author`: `bi.answer`, `bi.compile`, saving and deleting questions and dashboards, and exporting a definition or a model (`bi.exports.create`/`get`; a saved question needs no permission). `models:write`: `models.save/delete/build/preview`, `macros.save/delete`, `seeds.save/delete`. `lake:read`: `lake.records/documents/query/search/querySchema`, `dq.failures`. `sources:manage`: every `connections.*` write and `browseScope`, `runs.trigger`, and finishing a source's OAuth consent. `keys:manage`: `keys.*`. `catalogue:manage`: the `documentKinds` writes. `people:manage`: `people.*`. `audit:read`: `audit.tenant`. `tenant:manage`: `tenants.rename/deactivate/reactivate`. `roles:manage`: reserved. Anything not listed is open to every member or not tenant-scoped. Each procedure's CLI and MCP description ends with the permission it needs.

**Refusal.** A member lacking the permission gets `FORBIDDEN`, worded with the permission's label and key, with details `reason: PERMISSION_REQUIRED`, `permission`, `tenantId`. A non-member still gets `NOT_FOUND`, and a deactivated customer refuses first with `PRECONDITION_FAILED` / `TENANT_DEACTIVATED`. The audit log records the refusal as `PERMISSION_REQUIRED`.
