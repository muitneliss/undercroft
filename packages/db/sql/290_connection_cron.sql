-- ops.connection.cron: a five-field cron expression, for the fifth cadence, `custom`.
--
-- 100_cadence.sql argued that a cron column would be a promise nobody keeps, because Kestra owns
-- the tick. That stays true, and it is now answered rather than avoided: the tick asks every
-- five minutes, the worker's due rule (`packages/contracts/src/cadence.ts`) decides whether a
-- cron has fired since the last run, and an expression that could fire more often than the tick
-- is refused before it is written. ADR 0059.
--
-- Additive. The four presets keep their meaning and every row written before this keeps its
-- cadence; `cron` is NULL for each of them, which is what a preset means.
--
-- THE INVARIANT IS IN THE TABLE: an expression exactly when the cadence is `custom`. A custom
-- cadence with no expression would be a schedule the due rule can only refuse to guess at, and
-- a preset with a stale expression beside it would be a second answer to "when does this run".
-- The application refuses both before it writes; this CHECK is what holds when something else
-- writes. Whether the text is a VALID expression is not checked here -- Postgres has no cron
-- parser, and a second one in SQL would disagree with the first. The due rule answers "no next
-- run" for one it cannot read.
--
-- The cadence CHECK was declared inline by 100_cadence.sql, so Postgres named it
-- `connection_cadence_check`. It is replaced by name, idempotently, as 270 replaced
-- `run_notice_check`.

ALTER TABLE ops.connection
    ADD COLUMN IF NOT EXISTS cron text;

ALTER TABLE ops.connection DROP CONSTRAINT IF EXISTS connection_cadence_check;
ALTER TABLE ops.connection
    ADD CONSTRAINT connection_cadence_check
        CHECK (cadence IN ('hourly', 'every_6h', 'daily', 'paused', 'custom'));

ALTER TABLE ops.connection DROP CONSTRAINT IF EXISTS connection_cron_iff_custom;
ALTER TABLE ops.connection
    ADD CONSTRAINT connection_cron_iff_custom
        CHECK ((cadence = 'custom') = (cron IS NOT NULL));

-- NO NEW GRANT. A table-level grant covers a column added later: the app holds UPDATE on
-- ops.connection and the worker SELECT (040_grants.sql). `undercroft_bi` also holds SELECT on
-- the table, and so reads this column; an expression like "30 7 * * 1-5" names when a source
-- is read and nothing about what is in it, exactly as `cadence` beside it does.
