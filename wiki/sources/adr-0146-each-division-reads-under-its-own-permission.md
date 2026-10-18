---
title: ADR 0146 Each Division Reads Under Its Own Permission
type: source
date: 2026-10-18
tags: []
source: docs/adr/0146-each-division-reads-under-its-own-permission.md
source_path: docs/adr/0146-each-division-reads-under-its-own-permission.md
source_hash: fe3422f48e12f4987c219829684a8a6527032117aac517aab7f0d345b699325d
ingested: 2026-10-18
---

# ADR 0146 Each Division Reads Under Its Own Permission

Extends [[ADR 0139 Tenant Access Is Casbin Policy]], whose `requires` on a division only People used, and applies [[ADR 0119 Who Has Access to a Customer Is Read by Its Admin Alone]] to four more divisions: hiding a tab closes nothing, because the CLI, `/mcp` and the assistant call the router, so the gate is on the procedure and the tab only says so. Supersedes in part [[ADR 0086 A Tenant Writes Its Own Macros]] (`macros.list/get/check`), [[ADR 0092 Lineage Draws Only Declared Relations]] (`models.lineage`), [[ADR 0128 A Tenant Keeps Its Own Reference Tables, Typed by Its Author and Loaded by the Build That Reads Them]] (`seeds.list/get`) and [[ADR 0085 A Document Is Classified Into Its Tenants Own Catalogue Of Kinds]] (`documentKinds.list`), all of which were open to any member. Reports, reach ([[ADR 0142 Object Reach and Scope Logins]]) and row and column rules ([[ADR 0143 Row and Column Rules on Model Grants]]) are unchanged.

**Why.** Issue 487: Sources, the Journal, the Lake and Models opened for every member, a viewer included, and their procedures asked for nothing -- a model's SQL, macros, reference tables, lineage, run history with refusals and scope, every connection's schedule and chosen scope, how much of each stream landed. Since a customer defines its own roles, a viewer is typically someone who reads reports and nothing else, and no role could read Reports without reading how every number was built and from which accounts.

**Decision.** Three read permissions join the catalogue: `models:read` (`models.list/get/revision/check/lineage/reference`, `macros.list/get/check`, `seeds.list/get`), `runs:read` (`runs.list/get/events`) and `sources:read` (`connections.list/get`). The Lake keeps `lake:read`, which now also gates `lake.summary` and `documentKinds.list` (the catalogue is a page of the Lake). Each is a `requirePermission` on the procedure, so every door closes on one line. `models.revision` counts as a read of the project (its one reader is the model-builder workflow); `models.check` needs `models:read` because its findings name the project, but not `models:write`. Built-ins: `viewer` and `member` hold none and open Customers and Reports alone; `builder` holds all three beside `models:write` and `lake:read`; `admin` holds them by construction. Each division `requires` its permission in `apps/ui/src/lib/divisions.ts`; "Open" on the customer list opens the first division open to the reader (`bookPath`). A read crossing divisions degrades rather than refuses: pages outside Sources read connections through `useAccounts`, which asks nothing without `sources:read`; the grant form lists models only for `models:read` and streams only for `lake:read`. No migration: the deployed instance held no customer-defined role or permission grant on 2026-10-18.

**Consequences.** A viewer's and member's CLI, MCP client and assistant are refused these reads by name (`PERMISSION_REQUIRED`); their tab rail shows the four divisions face-down. A customer's own role holding `tenant:manage` or `keys:manage` without `sources:read` cannot open Sources, where those forms live; a run's links to Sources or Models open on the closed division's notice.

**Rejected.** Reusing the write permissions (builder would lose Sources and the Journal, and reading would need writing); one read permission for all four (too coarse for a customer's own roles); gating only the tabs (what ADR 0119 rejected); leaving `lake.summary` open as "only counts" (which systems a customer uses and how large it is).
