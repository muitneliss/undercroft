---
title: ADR 0034 The Watermark Is a Table Not a Max
type: source
date: 2026-09-21
tags: []
source: docs/adr/0034-the-watermark-is-a-table-not-a-max.md
source_path: docs/adr/0034-the-watermark-is-a-table-not-a-max.md
source_hash: e5a21e2c6b10f921bced3e19b2e093a09ced4b6e5e25c05d3120a5e1d78ceccd
ingested: 2026-09-21
---

# ADR 0034 The Watermark Is a Table Not a Max

# ADR 0034 The Watermark Is a Table, Not a MAX

## Decision

`entity.incremental` — declared in the spec schema and used by `specs/connectors/hubspot.yaml`
since the format was written, and never read by any code — is now wired, and the cursor it needs
lives in its own table: `raw.sync_cursor (source, tenant_id, entity) -> (watermark, format)`,
created by `packages/db/sql/220_sync_cursor.sql` with its own grant to `undercroft_worker` and
nothing for `undercroft_dbt` or `undercroft_bi`.

Three parts.

**The watermark is stored and sent back verbatim, as `text`, beside the `format` it was written
under** — not `timestamptz`. The value goes back to the provider in the provider's own dialect:
Xero's `If-Modified-Since` is a datetime string, HubSpot's is epoch milliseconds. Round-tripping
through a timestamp type re-renders it, and handing a provider a string it never said is a guess.
Storing `format` means a spec that changes format invalidates its own cursor — `readSyncCursor`
asks for the format it is about to use and is answered `null` — costing one honest full read
rather than comparing two incompatible renderings of an instant.

**A client filter SKIPS; it never STOPS.** `client-filter` pages the whole source and declines to
land what is older than the watermark. It saves no bandwidth, and that is the price of not
assuming the source orders its pages by the field being filtered on.

**The cursor advances only when an entity's read completed.** No flag says so: in
`apps/worker/src/services/runPaths.ts` the write sits after the `for await` and after the record
sink closed, so a throw in between skips it by control flow. Widening `readEntity`'s
`AsyncGenerator<T, boolean>` return to carry the watermark out was rejected — `for await` discards
a generator's return value, so every caller would become a manual `.next()` loop.

`raw.sync_cursor` is a sibling of `raw.load_cursor`, not a column on it: `load_cursor` is how far
the lake to Postgres projection got, in a stamp this platform minted; `sync_cursor` is how far the
provider was read, in a value the provider minted.

## Why

A watermark derived from `MAX(source_updated_at)` over `raw.records` is cheaper and is wrong, for
three independent reasons; the second settles it alone.

1. **An unordered source plus a crash silently skips records.** Xero's `/Invoices?page=N` is not
   ordered by `UpdatedDateUTC`. At a crash the projected set holds a record at `T_max` and is
   missing records below `T_max` still on later pages. The next run asks for what is after `T_max`
   and those are gone permanently, from the one layer that cannot be recomputed.
2. **`updatedAtPath` and `incremental.sourcePath` are different fields, and a shipped spec says
   so.** `hubspot.yaml` reads contacts with `updatedAtPath: updatedAt` and
   `incremental.sourcePath: properties.lastmodifieddate`. `MAX(source_updated_at)` reads the first
   and sends it against the second.
3. **`source_updated_at` is nullable and absent is honest.** `MAX()` over all-NULL is NULL, which
   is indistinguishable from "never ran" — a silent full re-read forever that looks exactly like
   the feature working.

**`failOnEmpty` is relaxed by a cursor, never by a spec.** The guard is skipped only when a
watermark was actually sent. A first run has no cursor and keeps the full guard, which is precisely
where "failed after 0 is a credential problem" matters most. `failOnExactCount` keeps applying
unconditionally, and `seen` counts what the source handed over including what a client filter
dropped, so filtering cannot talk a truncated page out of being reported.

**An unreadable value is never a skip and never an advance.** Both answers in
`packages/connector-runtime/src/incremental.ts` fail in the direction that cannot lose data, so a
spec naming the wrong `sourcePath` degrades to the full read the code did before this change.

**No run-checkpoint table.** Resume is derived from `raw.records`, `raw.load_cursor` and
`raw.sync_cursor`, never from `ops.run` — the same shape as `pendingDocuments` (ADR 0028). A
checkpoint written by the dying process is exactly what does not survive a SIGKILL.

## Options rejected

* **`MAX(source_updated_at)` over `raw.records`.** No migration, no table, no repo. Rejected for
  the three reasons above.
* **`timestamptz` for the watermark.** Sortable in SQL, and it re-renders the value whose only
  consumer is the provider that wrote it.
* **One cursor column added to `raw.load_cursor`.** Two meanings in one row.
* **Carrying the watermark out as the generator's return value.** `for await` discards it.
* **`client-filter` stopping at the first older record.** Assumes an ordering no REST API promises,
  and the failure is permanent data loss rather than wasted requests.

## Consequences

An incremental read over a `client-filter` source costs exactly what a full read costs — the saving
is in the lake, in `raw.records` and in the projection, not in bandwidth. Only `query-param` and
`header` make the source do the work.

A cursor that never advances, because the value at `sourcePath` cannot be read in the declared
format, is invisible in a run's counts: the run keeps doing what it did before. `raw.sync_cursor`
having no row for a stream that has run many times is the symptom.
