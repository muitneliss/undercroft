---
title: ADR 0142 Object Reach and Scope Logins
type: source
date: 2026-10-16
tags: []
source: docs/adr/0142-object-reach-and-scope-logins.md
source_path: docs/adr/0142-object-reach-and-scope-logins.md
source_hash: 0748acb6302b05ceec4d4f16deeb7ffa0120339ee9c0c339d8fa68ef9b751148
ingested: 2026-10-16
---

# ADR 0142 Object Reach and Scope Logins

# ADR 0142 Object Reach and Scope Logins

PR 3 of the four changes [[ADR 0139 Tenant Access Is Casbin Policy]] planned: a role or a person is granted to READ specific models, raw streams and reports, beside the permissions of [[ADR 0141 Custom Roles and Grants Under the Subset Rule]]. Enforced in the control plane where it reads data itself, and in Postgres -- through per-scope logins -- wherever a reader's own SQL runs.

**Objects.** `model:<name>` (a model or reference table) and `model:*`; `raw:<source>/<entity>`, `raw:<source>/*`, `raw:*` (a source's document catalogue is the entity `documents`); `report:question:<uuid>`, `report:dashboard:<uuid>`, `report:*` -- each with `read`, in one grammar (`parseReachObject`, `access_grant_object_shape` in `610_object_grants.sql`). A `*` stands only for a whole, never inside a name, because `keyMatch` reads it as a prefix pattern. The raw separator is `/`, not `.`, because a second mailbox is the source `gmail.<12 hex>` (ADR 0043) and `raw:gmail.*` would have reached every mailbox.

**Default reach.** The four built-ins reach the whole customer (`model:*`, `raw:*`, `report:*` in code beside their permissions); a customer's own role reaches only what is granted; a person's grant adds. Existing custom roles were given the three wholes by the migration, so nothing narrowed at the deploy. Reach is decided by Casbin per request -- each domain's whole asked first, then every object the projected lines name -- into a `Reach` on the context beside `permissions`; `grants.reach` answers it (about oneself any member; about a role or person, `people:manage`).

**Subset rule extended.** Giving or taking away an object needs it covered by the caller's reach (`model:*` only by `model:*`); inviting, setting a role, removing a member and deleting a role weigh reach too. Refusal: `FORBIDDEN`, `REACH_NOT_HELD`, `object`/`objects`.

**Integrity.** A grant on a model, seed, question or dashboard is deleted with it (AFTER DELETE triggers) -- names are reused; a dangling one projects nothing (the membership statement's `GRANT_NAMES_SOMETHING`). A grant on one thing must name an existing thing (`OBJECT_NOT_FOUND`); raw grants need not and are never cascaded. A report a narrow reader makes is granted to them.

**App-level.** `lake.summary/records/documents` narrowed to reachable streams (outside: an empty page); `models.list/get/lineage`, `seeds.list/get` to reachable models; questions, dashboards, answers and exports per `report:`; a dashboard's `ungranted` names tiles the reader may not open, drawn "not granted". `lake.search` is narrowed inside the worker's candidate lookups, before ranking and the cap. The build login's procedures (`lake.query`, `lake.querySchema`, `models.preview`, `dq.failures`, model/macro/seed writes, `models.build`) need `model:*` and `raw:*` too (`requireWholeReach`, `WHOLE_REACH_REQUIRED`), because that login reads everything; a build's row counts and preview therefore stay unscoped.

**Scope logins.** A reader of fewer than every model reads reports as `undercroft_bi_<slug>__<hash7>` -- SELECT on exactly their models' tables (never a view, never by default privileges, nothing in raw/app/ops/dq/staging) -- shared by everyone with the same reach. Two underscores because no slug holds two; 7 hex so the name fits 63 bytes. Canonical form `undercroft.scope/1;models=<sorted>`, hashed in `ops.provision_scope` alone, versioned for PR 4's rules. Provisioned lazily at the first session (the worker calls it before leasing the password, and it restates a missing grant); rejected: a `scopes/apply` verb on every change. A promotion grants the STAGED tables to the scopes that reach them inside its transaction, before moving them (`raw.grant_staged_to_scopes`), so a republish has no window. `ops.lock_scopes` serialises the writers. Passwords leased like tenant logins (`rotate/extend_tenant_password` with kind `scope`); `ops.pgbouncer_auth` admits them; `ops.drop_stale_scopes` drops one unused a week with no live password and no backend, inside `provision_tenant`. Scoped reads go to their own worker routes (`/v1/queries/scoped/*`, `raw/search/within`) so an older worker answers 404 rather than stripping the field. Exports store the asker's models and run under the narrower of then and now.

**Rejected:** session-setting RLS (`set_config` from a SELECT), `SET ROLE` (`RESET ROLE` escapes), per-scope views (they hold back publishing), query rewriting (raw SQL and `bindParams`), one login per person, provisioning on change, a field on the old routes, filtering the search page after its LIMIT. How-to: [[Runbook: Access control]]; syntax: [[Permissions]].
