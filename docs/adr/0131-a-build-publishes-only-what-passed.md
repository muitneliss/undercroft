# 131. A build publishes only what passed: write, audit, publish

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0018](0018-per-tenant-roles-and-row-level-security.md) (a tenant's roles and
  schemas), [ADR 0077](0077-deleting-a-model-drops-what-it-built.md) (deleting a model drops what
  it built), [ADR 0128](0128-a-tenant-keeps-its-own-reference-tables.md) (seeds),
  [ADR 0129](0129-a-failing-test-is-visible-wherever-the-figure-is-read.md) (a failing test is
  visible wherever the figure is read)

## Context

Every model is `+materialized: table`, and `dbt build` builds a model in place in
`analytics_<slug>` and tests it afterwards. dbt-postgres swaps through `__dbt_tmp` and
`__dbt_backup` and commits before the test runs, so a failing test leaves the failing rows in the
table every Reports question reads. ADR 0129 made that visible: the run's verdict says
`tests-failing`, `lastTests` says `failing`, and a Reports answer is qualified. It did not stop
the figure from changing. Issue 459: a customer protected an important figure by keeping a
tested draft model and a published model per figure, which doubled the model count, left the
draft readable by BI (the grant covers all of `analytics_<slug>`), and was bypassed by a
single-model build of the published one.

## Decision

**A build writes into a staging schema, and only what passed is promoted into analytics.**

1. **`staging_<slug>`**, a third schema per tenant, owned by the tenant's dbt login, created by
   `ops.provision_tenant` (`repeatable/010_provision_tenant.sql`). The BI login has no USAGE on
   it, and the refusal is stated beside the other two. dbt's profile targets it. The DDL
   tripwire allows it (`570_write_audit_publish.sql`).
2. **A model never chooses its schema.** `generate_schema_name` puts every model, seed and
   snapshot in the target, whatever its config names; only a test's custom schema (`dq_<slug>`)
   is honoured. Otherwise `config(schema='analytics_x')` would publish past its own tests.
3. **`ref()` reads each parent where the right version is.** A macro named `ref` overrides dbt's:
   a parent the build selects (`selected_resources`) is read from staging, where its new rows
   are, built and tested before its children; one the build does not select is read from
   `analytics_<slug>`, its last passing version. So `models.build` of `fct` alone reads `stg`'s
   published rows, never a version of `stg` that failed. The parse is untouched: the swap only
   happens when `execute` is true.
4. **Promotion** (`promotable` in `packages/db/src/services/promotion.ts`, pure; `promote.ts` in
   the worker) runs after `dbt build`, in one transaction as the tenant's dbt login. A model or
   seed is promoted when it built (`success`), no test attributed to it ended `fail`, `error` or
   `skipped` (`warn` does not block; ADR 0130), and every parent of it that this build also built
   was promoted. A failing test the manifest cannot attribute holds every node it reads, and with
   no manifest at all it holds every node of the build. A node whose parents the manifest does
   not list is promoted only when every node of the build stands on its own. For each node
   promoted, the version standing in analytics is dropped, `RESTRICT`, together with scratch in
   staging that reads it, dependents first, and the staging relation is moved with `ALTER ...
SET SCHEMA`. A view promoted with the table it reads follows it, because a view refers to
   what it reads by identity.
5. **A view outside the build that reads a version being replaced holds that node back**, and
   the decision is asked again without it, so its children in the build are held too. Dropping
   the old version would need `CASCADE`, which ADR 0077 refuses for the same reason here:
   publishing one model has not decided to delete another. A full build, which rebuilds the
   view, promotes both.
6. **Grants.** `SET SCHEMA` keeps a relation's own ACL and applies no default of the schema it
   arrives in. So `provision_tenant` gives the BI login a default SELECT in staging as well as in
   analytics: a promoted relation is readable the moment it lands, and in staging the grant is
   unreachable because BI has no USAGE there. The privileges test proves both sides, and the
   `pg_default_acl` gate now expects two rows per tenant. No grant is written at runtime.
7. **The ledger** records per model and seed step whether it was promoted
   (`ops.run_step.promoted`: true, false, or NULL for a test and for every step before this). A
   build whose promotion fails rolls back whole, marks every node held, and is not `ok`.
8. **What readers are told.** `latestTestsPerModel` anchors a model's tests on the newest
   PUBLISHED build (a NULL `promoted` with `success` counts, so history before the deploy reads
   as it did), and reports the newest held build since as `unpublished`. `lastTests` carries it,
   a Reports qualifier is emitted for a table whose served version is older than a held build
   ("last passing version from run X; the current build, run Y, is failing"), and a query that
   fails because a model it reads was built but never published is refused as "no passing
   version yet" naming the model and the run, rather than Postgres's "relation does not exist".
   The model editor says the same. Vietnamese first.
9. **A build's answer** counts and previews only the named models it published, as the BI login.
   A held model has `rows: null` and no preview: the table a dashboard reads is an earlier
   build's, and the held rows are in staging, which no dashboard reads. What its tests refused is
   readable through `dq.failures`, as before. A held model step is listed as a problem in a
   run's step report, since `success` alone no longer means Reports reads it.
10. **Delete** (`modelDrop.ts`) drops a model's relations, and a seed's table, in analytics AND
    staging: a held build is the model's data too.

**Migration.** The repeatable provision creates staging for every existing tenant on deploy.
Nothing in analytics moves or is dropped then. The first build after the deploy builds into the
empty staging schema and promotes as normal, and nothing in analytics is dropped before its
replacement has passed. Seeds load into staging and are promoted the same way; a seed that loads
has no test of ours and is promoted with the build.

## Consequences

- `analytics_<slug>` holds only versions that passed (plus whatever stood there before this
  deploy, until its model next passes). The parent guard of ADR 0129 still runs, and now only a
  table published before this deploy can make it refuse.
- A build that held a model reads `ok` with verdict `tests-failing`, as ADR 0129 has it; the
  figure in Reports does not move, and every reader says why.
- A promoted copy is still a projection (CLAUDE.md rule 1), not a recovery source: staging and
  analytics can both be dropped and rebuilt from raw.
- A worker crash between the promotion's commit and the ledger's write leaves analytics newer
  than the ledger says; the next build repairs the record. The window is one statement wide.
- A model held by a view outside the build stays held until a build that includes the view.
  This is visible in the run's step report and in the journal's `held` count.
- Each build costs one more transaction and a catalogue read per promoted node. Nothing is copied.
- **Proven against PGlite, with the fake dbt.** The `ref()` override and `generate_schema_name`
  are pinned as rendered text; that real dbt 1.9 resolves them as described is the Docker tier's
  and production's to confirm.

## Options rejected

- **Promote by copying (`CREATE TABLE analytics.x AS SELECT * FROM staging.x`).** Applies the
  analytics default ACL with no staging default needed, but doubles every build's IO, loses
  indexes a model configured, cannot move a view, and leaves a window where the old table is gone
  and the new one half-written unless done in one transaction anyway.
- **Rename in place in analytics (`x__candidate`, test, then swap).** BI can read every relation
  in analytics, so the candidate is readable before its tests run; the defect, renamed.
- **Grant BI SELECT on each relation as it is promoted.** A grant written at runtime is a second
  place a tenant's reach is stated (ADR 0036, `privileges.md`). The staging default keeps the
  whole policy in `010_provision_tenant.sql` and is pinned by the gate.
- **Point `ref()` at staging always, and build parents into every selection.** A single-model
  build would rebuild and retest the whole upstream every time, and a parent whose tests fail
  would block children reading its last passing version for no reason.
- **dbt's `--defer --state`.** Needs a stored manifest per tenant from the last published build,
  a second source of truth beside the ledger, and still writes in place.
- **A separate database or `CLONE` per build.** Postgres has no zero-copy clone; a schema per
  build multiplies roles, grants and default privileges with every run.
- **`DROP ... CASCADE` when a view pins the old version.** Silently deletes another model's
  view, which ADR 0077 refuses.
- **Promote everything that built and only flag the failures (ADR 0129 as it was).** The figure
  still changes to the refused rows; the issue is that it must not.
