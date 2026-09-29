-- raw.sync_cursor.whole_read_at: when the run that last read this stream WHOLE started. ADR 0080,
-- #314.
--
-- A watermark says how far a source's change filter was answered, and Xero documents edits its
-- filter never reports: a due date moved on a partially paid invoice, a contact's balances or its
-- customer and supplier flags. Those change nothing `If-Modified-Since` reads, so a stream read
-- only since its mark keeps the old value until the record changes for some other reason. An
-- entity whose spec declares `incremental.wholeReadAfterHours` is therefore read whole again, with
-- no watermark sent, once this is older than that.
--
-- THE RUN'S START, NOT THE MOMENT THE WRITE HAPPENED. The cadence's due rule measures the gap
-- between two runs' starts (`packages/contracts/src/cadence.ts`), so this is measured on the same
-- clock: a daily source whose read takes ten minutes would otherwise find its last whole read
-- ten minutes short of a day old on every run, and read whole every second day instead.
--
-- NULL, AND NO BACKFILL. A row written before this column has no whole read recorded, which is
-- the truth, and a stream that declares a bound reads whole on its next run -- the one read that
-- also repairs what has already gone stale. A stream that declares none never looks at it.

ALTER TABLE raw.sync_cursor
    ADD COLUMN IF NOT EXISTS whole_read_at timestamptz;

-- NO NEW GRANT. `undercroft_worker` holds SELECT, INSERT, UPDATE on the whole table (220), which
-- a column added later is covered by, and SELECT on `ops.run` (090), which the write reads the
-- run's start from.
