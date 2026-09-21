# 34. The watermark is a table, not a MAX over what was landed

- Status: Accepted
- Date: 2026-09-22

## Decision

`entity.incremental` — declared in the spec schema and used by `specs/connectors/hubspot.yaml`
since the format was written, and never read by any code — is now wired, and the cursor it
needs lives in a table of its own: `raw.sync_cursor (source, tenant_id, entity) -> (watermark,
format)`, created by `packages/db/sql/220_sync_cursor.sql`.

Three parts to the decision.

**The watermark is stored and sent back VERBATIM, as `text`, beside the `format` it was
written under.** Not `timestamptz`. The value goes back to the provider in the provider's own
dialect: Xero's `If-Modified-Since` is a datetime string, HubSpot's is epoch milliseconds.
Round-tripping through a timestamp type re-renders it, and handing a provider a string it
never said is a guess wearing the shape of a fact. Storing `format` alongside means a spec
that changes format invalidates its own cursor — `readSyncCursor` asks for the format it is
about to use and is answered `null` — which costs one honest full read instead of comparing
two incompatible renderings of an instant and being silently wrong about which is later.

**A client filter SKIPS; it never STOPS.** `client-filter` pages the whole source and declines
to land what is older than the watermark. It saves no bandwidth, and that is the price of not
assuming the source orders its pages by the field being filtered on.

**The cursor advances only when an entity's read completed.** Nothing carries a flag saying
so: in `apps/worker/src/services/runPaths.ts` the write sits after the `for await` and after
the sink closed, so a throw anywhere in between skips it by control flow. The plan considered
widening `readEntity`'s `AsyncGenerator<T, boolean>` return to carry the watermark out and
rejected it — `for await` discards a generator's return value, so every caller would have to
become a manual `.next()` loop to retrieve one number.

`raw.sync_cursor` is deliberately a sibling of `raw.load_cursor` rather than a column on it:
`load_cursor` is how far the lake → Postgres **projection** got, in a stamp this platform
minted; `sync_cursor` is how far the **provider** was read, in a value the provider minted.
Two meanings that advance at different moments.

## Why

**A watermark derived from `MAX(source_updated_at)` over `raw.records` is cheaper and is
wrong.** Three independent reasons; the second settles it alone.

1. **An unordered source plus a crash silently skips records.** Xero's `/Invoices?page=N` is
   not ordered by `UpdatedDateUTC`. At a crash the projected set holds a record at `T_max` and
   is _missing_ records below `T_max` that were still on later pages. The next run asks for
   what is after `T_max`, and those records are gone permanently — from the one layer that
   cannot be recomputed. A stored cursor that only advances on clean completion cannot do
   this: it stays where it was, and the next run re-reads, which is `unchanged` twice over.

2. **`updatedAtPath` and `incremental.sourcePath` are different fields, and a shipped spec
   says so.** `hubspot.yaml` reads contacts with `updatedAtPath: updatedAt` and
   `incremental.sourcePath: properties.lastmodifieddate`, with a comment recording that
   HubSpot names it differently on contacts than everywhere else. `MAX(source_updated_at)`
   reads the first and sends it against the second. That is a fact in a tracked file, not a
   hypothesis about what a provider might do.

3. **`source_updated_at` is nullable, and absent is honest.** `MAX()` over all-NULL is NULL,
   which is indistinguishable from "this stream has never run" — a silent full re-read,
   forever, that looks exactly like the feature working.

**Why `failOnEmpty` is relaxed by a cursor rather than by a spec.** Both shipped specs set
`failOnEmpty`, and an incremental read that legitimately finds nothing new returns zero
records. The guard is skipped when a watermark was actually **sent**, never merely because the
entity declares `incremental`: a first run has no cursor and keeps the full guard, and that is
precisely where `.claude/rules/connectors.md`'s "failed after 0 is a credential problem"
matters most. `failOnExactCount` keeps applying unconditionally — truncation is truncation,
whatever was asked for — and `seen` counts what the source handed over, including what a
client filter then dropped, so filtering cannot talk a truncated page out of being reported.

**Why an unreadable value is never a skip and never an advance.** Both answers in
`packages/connector-runtime/src/incremental.ts` fail in the direction that cannot lose data. A
value the declared format cannot read is not older than the watermark, so the record lands;
and it never becomes the watermark, so a cursor never holds a string the next run would send
and the provider would reject. A spec naming the wrong `sourcePath`, or a source that changes
its rendering, therefore degrades to the full read the code did before this change. The
alternative failure is invisible: an incremental read that silently skipped everything looks
exactly like a source with nothing new.

**Why no run-checkpoint table, and why `closeAbandoned` stays as it is.** Resume is derived
from `raw.records`, `raw.load_cursor` and `raw.sync_cursor`, never from `ops.run` — the same
shape as `pendingDocuments` (ADR 0028), which derives a whole backlog by LEFT JOIN with no
cursor at all. A checkpoint written by the dying process is exactly what does not survive a
SIGKILL, which is how the 2026-09-21 run was lost in the first place.

## Options rejected

- **`MAX(source_updated_at)` over `raw.records`.** No migration, no table, no repo. Rejected
  for the three reasons above.
- **`timestamptz` for the watermark.** Sortable in SQL, comparable in the database, and it
  re-renders the value. Rejected: the value's only consumer is the provider that wrote it.
- **One cursor column added to `raw.load_cursor`.** Rejected: two meanings in one row, and the
  first reader to ask "how far have we got" gets two answers.
- **Carrying the watermark out as the generator's return value.** Rejected: `for await`
  discards it, so every caller becomes a manual `.next()` loop — complexity pushed to the
  callers, which are many, to save a few lines in the one implementation.
- **`client-filter` stopping at the first older record.** Rejected: it assumes an ordering no
  REST API promises, and the failure is permanent data loss rather than wasted requests.

## Cost

An incremental read over a `client-filter` source costs exactly what a full read costs — the
saving is in the lake, in `raw.records` and in the projection, not in bandwidth. Only
`query-param` and `header` make the source do the work.

A cursor that never advances, because the value at `sourcePath` cannot be read in the declared
format, is invisible in the run's counts: the run simply keeps doing what it did before this
change. `raw.sync_cursor` having no row for a stream that has run many times is the symptom,
and it is worth looking at before concluding a source has nothing new.
