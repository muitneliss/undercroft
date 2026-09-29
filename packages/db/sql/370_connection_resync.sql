-- ops.connection.resync_cadence / resync_cron: how often a connection's lists are read WHOLE
-- again, and raw.sync_cursor.whole_read_requests: what the last whole read of a list cost.
-- ADR 0081, superseding the hardcoded bound of ADR 0080 (#314).
--
-- A watermark vouches only for what a source's change filter can see, and Xero documents edits
-- its filter never returns. A re-sync reads each such list whole on a schedule so those edits
-- land. That schedule was 24 hours written into `xero.yaml`; it is now a choice an administrator
-- makes per connection, beside the sync cadence and in the same words, so the pair mirrors
-- `cadence` / `cron` exactly: one of the presets or `custom` with an expression, and the same two
-- invariants, checked here under their own names.
--
-- `paused` BY DEFAULT: a re-sync is opted into. It spends up to four fifths of a day's Xero
-- requests on a large organisation, and that is the administrator's to choose. A connection made
-- before this column therefore re-reads nothing on a schedule until someone turns it on; the
-- Xero runbook says so. The one whole read the new page size forces (a changed request, ADR
-- 0072) still happens.

ALTER TABLE ops.connection
    ADD COLUMN IF NOT EXISTS resync_cadence text NOT NULL DEFAULT 'paused',
    ADD COLUMN IF NOT EXISTS resync_cron text;

ALTER TABLE ops.connection DROP CONSTRAINT IF EXISTS connection_resync_cadence_check;
ALTER TABLE ops.connection
    ADD CONSTRAINT connection_resync_cadence_check
        CHECK (resync_cadence IN ('hourly', 'every_6h', 'daily', 'paused', 'custom'));

ALTER TABLE ops.connection DROP CONSTRAINT IF EXISTS connection_resync_cron_iff_custom;
ALTER TABLE ops.connection
    ADD CONSTRAINT connection_resync_cron_iff_custom
        CHECK ((resync_cadence = 'custom') = (resync_cron IS NOT NULL));

-- How many requests the last COMPLETED whole read of this list made. NULL until one has: a list
-- whose whole read was cut by the day's budget has not finished, and a partial count would
-- under-state what the next one costs. The card sums these into "a re-sync takes about N days".
ALTER TABLE raw.sync_cursor
    ADD COLUMN IF NOT EXISTS whole_read_requests integer;

-- NO NEW GRANT ON ops.connection: the app holds UPDATE and the worker SELECT at table level
-- (040_grants.sql), which covers columns added later. `undercroft_bi` reads the table too, and so
-- these two columns; like `cadence`, they name when a source is read and nothing in it.
--
-- THE APP MAY NOW READ FIVE COLUMNS OF raw.sync_cursor, and no more. The card says when a
-- connection's lists were last read whole and what a re-sync costs, and those facts live here.
-- Column-scoped, so the watermark itself -- the provider's own rendering of a time, which the
-- card has no use for -- stays the worker's. The table has no row-level security by design (220),
-- so every statement the app runs against it names `tenant_id` in full, as the worker's do.
GRANT SELECT (source, tenant_id, entity, whole_read_at, whole_read_requests)
    ON raw.sync_cursor TO undercroft_app;
