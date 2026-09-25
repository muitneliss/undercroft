-- raw.sync_cursor.request_key: which request a watermark was read with.
--
-- 220 made a watermark meaningful only under the `format` it was written in. A request that has
-- changed since is the same hazard one step over. A HubSpot scope may now add properties to what
-- an object read asks for (ADR 0052), and HubSpot's objects are read with a client-side filter
-- against the stored mark: kept across a widened request, that mark filters out every record
-- that has not changed since -- so a property chosen today would reach only the records that
-- happen to change, and the lake would never say which. The worker therefore reads a cursor
-- only for the request it is about to send, and a changed request starts from no mark, which
-- costs one full read.
--
-- '' is "read exactly as the spec declares it". DEFAULT '' and NOT NULL, so every row written
-- before this column existed means precisely that -- which it does -- and every stream no scope
-- touches keeps its mark across the deploy that brings this in. Anything else is a digest the
-- worker computes (`requestKeyOf` in `apps/worker/src/services/specRun.ts`); nothing here
-- interprets it.

ALTER TABLE raw.sync_cursor
    ADD COLUMN IF NOT EXISTS request_key text NOT NULL DEFAULT '';

-- NO NEW GRANT. `undercroft_worker` holds SELECT, INSERT, UPDATE on the whole table (220), which
-- a column added later is covered by; nobody else holds anything on it, and that stays so.
