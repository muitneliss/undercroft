# 32. A progress line is a gauge, not an entry

- Status: Accepted
- Date: 2026-09-21

## Decision

`ops.run_event` holds two kinds of line, and they are bounded differently because they are
different things.

A **milestone** — `run_opened`, `entity_started`, `work_listed`, `entity_done`, `run_closed` —
is a thing that happened, at an instant. It is appended, it is never rewritten, and a run is
capped at 200 of them, exactly as `160_run_events.sql` has always said.

A **progress line** — `records_read`, `documents_read`, everything written through
`RunJournal.progress` — is a reading of a dial. The next reading does not add to it; it
replaces it. So it keeps **one row per `(run_id, event, entity)`**, carried by a `live` column
and a partial unique index, and a new reading is an `INSERT … ON CONFLICT DO UPDATE` that
rewrites `at` and `detail` in place. The worker is granted `UPDATE (at, detail)` and nothing
else, so what an event _is_ — its level, its name, the entity it concerns — stays unwritable
once recorded.

Because such a line cannot accumulate, it is **exempt from the cap**. It is also not rendered
as a line: the browser reads `live` and draws the reading as a gauge above the ledger rather
than as one more entry inside it (`apps/ui/src/lib/runFeed.ts`, `RunProgress.tsx`).

No backfill. Every row already in the table stays `live = false` and reads exactly as it was
recorded.

## Why

A Gmail ingest over 7,786 messages runs for hours and writes a progress line every couple of
seconds. The cap counted those lines. Roughly seven minutes in, the run wrote one
`events_truncated` warning and refused every reading after it — so for the remaining three
hours the Journal showed a frozen counter, a frozen flow diagram (both derive from those
events, `runFlowEntities.ts`), and a feed whose last line was already stale. The one screen
that answers "is this customer's data flowing?" answered it for the first four per cent of the
run and then stopped.

The second defect had the same cause from the other end. Every admitted reading was its own row
in the DIỄN BIẾN table, so the leaf carried roughly 180 printings of one sentence — pushing the
counts, the refusals and the dbt steps off the bottom of the page, and announcing a new line to
a screen reader every two seconds through the table's `aria-live`.

Both are the same mistake: filing a reading as if it were an occurrence. Fixing that fixes both
ends at once, and it makes the coalescing interval a free choice rather than a trade against
the size of the table — it drops from 2s to 1s in the same change, because a reading now costs
one `UPDATE` of one row instead of a row.

The argument is not new here. `runJournal.progress` has always dropped a reading whose
predecessor was less than an interval old, and its docstring already said why that is not
pruning: "the line it replaces said the same thing about the same entity a moment ago, and the
next one will say it again." This carries the same sentence from _drop the one that came too
soon_ to _there is only ever one_.

## Options rejected

**Raise the cap and keep appending.** The smallest change, and it makes the table into the
thing it describes: a three-hour run would write thousands of rows per entity. Worse, it is
self-defeating — `eventsFor` returns the newest 300 rows, so a run's own progress would evict
its opening milestones and the feed would lose `run_opened` to make room for the four-thousandth
reading of the same dial.

**Prune old progress rows on a schedule or a trigger.** Bounded, but it deletes rows that were
recorded, which is the shape `.claude/rules/raw-lake.md` refuses on the durable layer and which
would need to be reported to be honest. Superseding never creates the row it would later have to
remove.

**Fold in the browser only.** This fixes the long leaf and not the freeze, because the worker
still stops writing. It is also _part_ of what shipped: the browser folds a historical run's
consecutive progress rows into one gauge, so a run recorded before this ADR reads correctly
without its rows being touched.

## Consequences

- `ops.run_event` is no longer strictly append-only, and the sentence in `160_run_events.sql`
  that says it is now carries a pointer to the one exception. The exception is narrow by
  construction: one column set by one call path, and a column-scoped grant.
- A gauge row keeps its `id`, so it holds the place in the feed where it first appeared rather
  than jumping to the end every second. Its `at`, however, moves — which is precisely why the
  browser must not print it as a chronological line, and does not.
- `recordEvents` de-duplicates live lines within a flush before writing: `ON CONFLICT DO UPDATE`
  refuses a source that offers the same key twice, and a flush spanning two intervals offers
  exactly that.
- A run recorded before this change still shows its truncation warning, truthfully. The warning
  should become rare rather than routine; if it is still common on ingests after this, the
  remaining cause is milestones, and the cap is the thing to argue about then.
