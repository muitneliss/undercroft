# 91. A run keeps the scope it read with, and its counts open the rows it wrote

- Status: Accepted
- Date: 2026-09-30
- Builds on: [ADR 0039](0039-a-count-has-a-route-to-its-constituents.md) (a count has a route to
  its constituents), [ADR 0043](0043-a-second-mailbox-is-a-second-source.md) (each account is its
  own source), [ADR 0071](0071-a-record-a-complete-listing-no-longer-names-is-removed-at-source.md)
  and [ADR 0078](0078-a-drive-walk-lands-the-folders-it-lists-and-a-moved-file-without-its-bytes.md)
  (what a complete Drive read marks removed at source).
- Refs: #346, `docs/design/operator-and-reader-paths.md` ("Journal and runs", "Scope").

## Context

An admin checking one account's data walks Sources, Journal, Raw lake. Three things broke the
walk:

- **The scope a run read with was not kept.** An admin's choice of what a connection reads lives in
  `app.connection_detail.selection`, and a save overwrites it. A run's leaf could only have shown
  the choice as it stands today, beside a run that read with an earlier one.
- **A run's counts led nowhere.** The leaf printed created and changed per entity, and the rows
  behind them could only be found by writing a console query on the run id.
- **The Journal could not be narrowed to one account**, so a source card had nowhere to send a
  reader but the whole ledger.

A row in `raw.records` or `raw.documents` names only the run that last wrote it: the upsert
rewrites `run_id` when the content changed, and leaves it when the content is the same. So "the
rows with this run id" is what the run wrote and no later run has written again. That is not the
same as the run's count.

## Decision

**A run records its scope as it reads it, in `app.run_scope`, and reads with the recording.**

- The collectors (`google/collect.ts`, `specRun.ts`) ask `scopeForRun`. The first ask copies the
  connection's selection into the run's row, and every later ask in that run gets the row back. So
  the scope on the leaf is the scope the run used, not a copy taken beside the read that a save in
  between could make disagree with it.
- The table is in `app`, not a column on `ops.run`. BI holds `SELECT ON ops.run`, a table-level
  grant covers a column added later, and the selection carries names a person wrote (a label, a
  folder, an organisation). This is the same reason `070_google_ingestion.sql` put the selection
  itself in `app`.
- The worker may insert and read, never update. A run's scope is never rewritten.
- `runs.get` answers `scope`: the recording, summarised the way the card summarises a
  connection's scope, or `null`. `null` is every run from before this, and every run that reads no
  scope. The leaf prints an em dash for it, never the connection's scope today.

**A run's rows are reached by its id, and the ones a later run rewrote are counted.**

- `lake.records` and `lake.documents` take an optional `runId`. The admin gate is unchanged: the
  same rows, fewer of them.
- Beside a page narrowed to a run they answer `ofRun`: `wrote` is the run's own created + changed
  for the stream (`ops.run_entity`), `current` is the rows that still name the run, and
  `rewritten` is the difference. It is `null` whenever the two cannot honestly be subtracted: the
  run is of another source, it is still running, the ledger holds no count for the stream, or more
  rows name the run than it counted.
- For an admin, a run's created and changed counts link to that page. A member or viewer sees
  the same figures with no link.

**`runs.list` takes an optional `source`**, matched as one account. A source card opens the
Journal filtered to its source, and the filter lives in the address.

**Saving a scope says what the next read does to held records, for the kinds where that is
confirmed**: Drive marks what the choice no longer reaches as deleted at source on its next
complete read; Gmail leaves held messages live. Neither statement implies that anything leaves
the lake.

## Consequences

- One row per ingest run in `app.run_scope`, with the selection's size. A run whose connection had
  no scope chosen records a row with a NULL selection, which is a different fact from a run that
  recorded nothing.
- A run whose source must be scoped but recorded nothing usable shows an em dash rather than the
  card's reading of an empty scope ("the whole mailbox"). Such a run read nothing.
- `rewritten` is exact when the run counted each record it wrote once, which is how the ledger
  counts (`docs/reference/run-counts.md`). The ledger holds no finer fact to check it against, so
  the one test it can make is made: where `current` exceeds `wrote` the figure is withheld rather
  than shown wrong.
- Reading a run's rows filters a stream by `run_id`, which no index serves. It is one admin's
  page at a time, over one stream, the cost `lake.records` already pays to sort a stream by
  `observed_at`; an index on the raw tables is left until a stream is large enough to need one.
- The CLI and MCP get `--source`, `--run-id` and the new fields through the router, with no gate
  of their own.

## Rejected

- **A `scope` column on `ops.run`**, as the design contract first proposed. It would put a
  customer's label and folder names within reach of every BI login.
- **Snapshotting the scope where the run opens (`openRun`)**, separately from where it reads it.
  A run waits for its turn (ADR 0088) between the two, and a save in that wait would leave the leaf
  naming a scope the run did not read with.
- **Estimating the rewritten count from later runs' changed counts.** A later run's `changed`
  counts every record it changed, not only this run's. The count is the run's own figure less the
  rows that still name it, or nothing.
- **Returning NOT_FOUND for a run id that is not this tenant's** on `lake.records`. The page is
  scoped to the tenant, so an unknown run answers an empty page with no `ofRun`, the same as a run
  that wrote nothing there. That confirms nothing about another customer's run, and spares every
  caller a null result.
