# 77. Deleting a model drops what it built, or deletes nothing

- Status: Accepted
- Date: 2026-09-28

## Context

`models.delete` removed the model's row from `app.model` and wrote an audit entry. It did not
touch what the model's builds had made. The relation dbt built stayed in the tenant's
`analytics_<slug>`, where the BI login reads it: `bi.schema` still listed it and `bi.answer`
still read it. The failing rows its tests had stored stayed in `dq_<slug>`. Nothing else ever
removes a relation, because dbt replaces what it builds and never drops what it no longer
builds. The editor even said so: "the built table stays until the next build", which was false.
The next build left it as well.

A person who pressed Delete believed the data was gone. In production, one tenant (CASE-0042)
held eight such tables after their models were deleted. One of them held excerpts with names,
email addresses and phone numbers. No door (web UI, CLI, MCP) can drop a table, and an operator
has no write path into the database except the platform, since SSH is read-only by design. So
the only way to remove that data was a deploy.

## Decision

**The model's delete drops what the model built, and the row goes only after the drop has
happened.** If the drop does not happen, nothing is deleted and the person is told that the
model is still there.

**The worker drops, as the tenant's dbt login.** Only a relation's owner may drop it, and the
owner is the login that built it, `undercroft_dbt_<slug>`. Only the worker can mint that login's
password (ADR 0016). No grant is added: the login drops what it made, in the two schemas it
owns. `POST /v1/models/drop` (`apps/worker/src/services/modelDrop.ts`) answers with what it
dropped, and `WorkerClient.dropModel` is how the control plane calls it.

**Order: drop, then delete the row** (`services/models.ts` `remove`).

- If the worker is down, not configured, or the drop fails part-way, the row stays and the
  answer is `PRECONDITION_FAILED`, worded as "not deleted, the model is still here".
- All the drops are one transaction on the tenant's session, so a failure part-way leaves
  every relation as it was.
- If the row is already gone when the drop has succeeded, the answer is `NOT_FOUND`. Another
  person deleted it first, and the data is gone either way.

**What is dropped is read from the catalogue by name, never from the ledger.** A model's
relations are:

- In `analytics_<slug>`: the model's own name, and the two working copies dbt-postgres 1.9
  swaps through when it replaces a relation (`<name>__dbt_tmp` and `<name>__dbt_backup`, cut to
  fit 63 characters). The swap commits before the backup is dropped, so a build killed between
  the two leaves the previous rows in `__dbt_backup`.
- In `dq_<slug>`: the failing-rows table of each test the model declares, named as dbt 1.9
  names it. That is `<kind>_<model>_<column>`, or, at 64 characters and more, the first 30
  characters of `<kind>_<model>` followed by the md5 of the full name. These tables go too.
  `store_failures` output is source rows copied verbatim, which is exactly the data a person
  deleting the model wants gone. Keeping it would leave the defect in `dq`.
- Also in `dq_<slug>`: a table not written by any declared test is read by its name.
  `<kind>_<model>_…` belongs to the model with the longest name it starts with.
  `not_null_stg_deals_id` could be `stg_deals`'s test of `id` or `stg`'s test of `deals_id`,
  and only the longer reading can belong to a model the shorter one is not. This rule reaches
  the tables of tests an author has since removed.

`relationsOfModel` in `packages/db/src/services/dbtProject.ts` names these, beside the
rendering whose output they are. `relationsToDrop` decides which of the relations that exist
belong to this model and to no other. A name another model owns is never taken: a relation
that is another model's name, or a table that another model's declared test writes.

Because the catalogue is the authority, the orphans already in production are reachable.
Re-creating a model with the same name and deleting it drops the leftover table, whether or not
a build was ever recorded under the new row.

**A build running refuses the delete, twice.**

- The worker refuses to drop while a transform of the tenant is running (409
  `run_in_progress`). The build read every model when it started, so it would build this one
  again after the drop. Dropping a relation under a running build could also fail that build.
- The row's `DELETE` is conditional on no running transform, in the same statement
  (`deleteModelUnlessBuilding`). That closes the gap between the drop and the delete: a build
  that opened in between keeps the row, the model stays consistent with the table the build
  makes, and the person is asked to wait, in the words `models.build` already uses.

**Another model reading from it refuses the delete.** The drop is `RESTRICT`, never `CASCADE`.
Before dropping, the worker lists the views and materialized views that read from what it would
drop (`pg_depend` through `pg_rewrite`). If any of them is not itself being dropped, it drops
nothing and answers 409 `relation_depended_on` with their names. The control plane words that as
a `CONFLICT` naming them. A person deleting one model has not decided to delete another.

A table that another model built from this one (a `ref()` materialized as a table) does not
depend on it in the catalogue. It holds its own copy, which belongs to that model. The delete
goes ahead, and that model's next build fails and says why. That is how a `ref()` to a missing
model already behaved.

**Materializations.** Each relation is dropped with the statement its `relkind` needs: `DROP
TABLE` for a table or partitioned table (which covers incremental), `DROP VIEW`, or `DROP
MATERIALIZED VIEW`. An ephemeral model has no relation, and a model never built has none either.
Both drop nothing and are deleted. A tenant that was never provisioned has no login, so it has
no relation and answers the same.

**Identifiers** are validated at the contract (`^[a-z][a-z0-9_]*$`, at most 63 characters). They
are still spliced only through `quoteIdent`, and the catalogue is matched by bound parameter.

## Consequences

- A delete says "deleted" only when neither the analytics relation nor its `dq` tables can
  still be read. Every other outcome keeps the row and says why.
- Deleting a model now needs the worker. A control plane with no worker configured refuses the
  delete rather than guessing that nothing was built (CLAUDE.md rule 2).
- The audit entry names the relations that were dropped, never what they held.
- The procedure's sentence, the assistant tool's description, the editor's lead and the
  model-builder skill now say that the table goes with the model.

## What this does not reach

- **A table whose name no rule can tie to the model.** This covers a model built under a dbt
  `alias` (the relation is named for the alias, not the model), and a hashed failing-rows table
  of a test the model no longer declares. Both are left in place. The first is readable by BI;
  the second only by the tenant's dbt login, through `dq.failures`.
- **The orphans already in production are not swept.** Each needs a model of the same name
  created and deleted again, as above, or a one-off sweep. A sweep that drops every relation
  no current model claims is a separate, destructive decision. It would take tables a person
  may still be reading, so it is not made here.
- **Proven against PGlite, not a real login.** The drop runs through `sessionsBySetRole` in the
  offline gate, where `SET ROLE` makes the tenant's dbt role `current_user`, and ownership, which
  is all a `DROP` checks, is decided on `current_user`. The real login and its rotated password
  are the same seam every other tenant session uses, proven in the Docker tier by
  `isolation.integration.test.ts`. No new integration test was added.

## Options rejected

- **Delete the row first, then drop.** This was the defect's order. If the drop fails, the
  person has been told "deleted" while the data is readable, and there is no row left to try
  again with.
- **Delete the row, and let a sweep drop what no model claims.** Deleting a model would still
  answer before the data is gone, and a background sweep that drops tables is harder to reason
  about than the one delete a person asked for.
- **The worker deletes the row too.** This would need `DELETE` on `app.model` for the worker, a
  second writer of a table the control plane owns, only to move a guard the conditional
  `DELETE` already makes atomic.
- **Open a transform run to hold the ledger's lock across the drop.** It would close the same
  window, but it would put a "build" in the journal that built nothing, for every delete.
- **`DROP … CASCADE`.** It would silently take another model's view with this one.
- **Drop what the ledger recorded a build making (`ops.run_step.relation`).** It misses every
  relation left by a model deleted before this change and every build whose run was pruned,
  which are exactly the orphans this ADR is for.
- **Leave `dq` alone, since BI cannot read it.** The failing rows are source data. The tenant's
  dbt login, and so an admin through `dq.failures`, can still read them, and the person deleting
  the model asked for that data to go.
