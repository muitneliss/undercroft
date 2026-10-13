---
title: ADR 0131 A Build Publishes Only What Passed
type: source
date: 2026-10-13
tags: []
source: docs/adr/0131-a-build-publishes-only-what-passed.md
source_path: docs/adr/0131-a-build-publishes-only-what-passed.md
source_hash: f3838d21e190eaf6b11efe3f08677505c5be0f1dc712829c62785522eee5ecbe
ingested: 2026-10-13
---

# ADR 0131 A Build Publishes Only What Passed

Issue #459. Before this, `dbt build` replaced each table in place in `analytics_<slug>` and tested it afterwards, so a failing test left the refused rows in the table every Reports question reads; [[ADR 0129 A Failing Test Is Visible Wherever the Figure Is Read]] made that visible but did not stop the figure changing.

**Write into staging.** Each tenant gets a third schema, `staging_<slug>`, owned by its dbt login and created by the repeatable `ops.provision_tenant`; the BI login has no USAGE on it. dbt's profile targets it, `generate_schema_name` puts every model, seed and snapshot in the target whatever its config says (only a test's `dq_<slug>` is honoured), and the DDL tripwire allows it (migration 570).

**`ref()` reads the right version.** An overriding `ref` macro reads a parent the build selects (`selected_resources`) from staging, where its new rows are, and a parent it does not select from `analytics_<slug>`, its last passing version; so building one model reads its parents' published rows.

**Promote what passed.** After the build the worker promotes, in one transaction as the tenant's dbt login, each model or seed that built, none of whose attributed tests ended `fail`, `error` or `skipped` (`warn` does not block, [[ADR 0130 A Rule About a Model's Rows Is a Test of That Model, Not a Model of Its Own]]), and whose parents in the same build were promoted. A failing test that cannot be attributed holds everything it reads, and without a manifest everything. The standing version is dropped RESTRICT, dependents first, and the staging relation moved with `ALTER ... SET SCHEMA`; a promoted view follows its promoted table. A view outside the build that reads a version being replaced holds that node back, and its children with it, rather than CASCADE ([[ADR 0077 Deleting a Model Drops What It Built]]).

**Grants.** `SET SCHEMA` keeps a relation's own ACL, so provisioning gives BI a default SELECT in staging too: readable the moment it lands in analytics, unreachable in staging for want of USAGE. The `pg_default_acl` gate expects two rows per tenant; no grant is written at runtime.

**What readers are told.** `ops.run_step.promoted` records each model and seed step. A model's `lastTests` anchor on its newest published build (older steps with `success` count), with `unpublished` naming a newer held build. Reports qualifiers say "last passing version from run X; current build, run Y, failing", and a query over a model never published is refused as "no passing version yet". A build counts and previews only what it published; a held step is listed as a problem. Deleting a model or seed drops it in analytics and staging.

**Migration.** Staging appears on deploy for every tenant; nothing in analytics is dropped before its replacement passes. Rejected: promoting by copy, a candidate renamed inside analytics, a runtime GRANT per promotion, always reading parents from staging, dbt `--defer`, a schema per build, CASCADE, and flagging without holding.
