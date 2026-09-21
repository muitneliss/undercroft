-- How far the SOURCE was read, per stream.
--
-- Sibling to `raw.load_cursor` in 030 and deliberately a second table rather than a second
-- column on it. `load_cursor` is how far the lake -> Postgres PROJECTION got, which is a
-- lake stamp this platform minted; `sync_cursor` is how far the PROVIDER was read, which is a
-- value the provider minted. Two meanings that advance at different moments and for different
-- reasons; overloading one would make "where are we" a question with two answers.
--
-- A cursor is written only when an entity's read completed without raising. Nothing here
-- enforces that -- it is control flow in `apps/worker/src/services/runPaths.ts`, where the
-- write sits after the loop and after the sink closed, so a read that died halfway simply
-- never reaches it. The next run then re-reads from the older watermark, which is idempotent
-- by content in the lake and an `unchanged` row in `raw.records`. That is the cheap direction
-- to be wrong in; the expensive one is a watermark that advanced past records a crash left
-- unread, which is a permanent gap in the one layer that cannot be recomputed.

CREATE TABLE IF NOT EXISTS raw.sync_cursor (
    source     text        NOT NULL,
    tenant_id  text        NOT NULL,
    entity     text        NOT NULL,
    -- TEXT, VERBATIM, as the source rendered it -- never `timestamptz`. The value is handed
    -- straight back to the provider in the provider's own dialect: Xero's `If-Modified-Since`
    -- is a datetime string, HubSpot's is epoch milliseconds. Round-tripping it through a
    -- timestamp type re-renders it, and sending a provider a string it never said is a guess
    -- dressed as a fact.
    watermark  text        NOT NULL,
    -- Which dialect the line above is in: iso8601 | epoch-millis | yyyy-mm-dd. Stored so a
    -- spec that CHANGES its format invalidates its own cursor -- the reader asks for the
    -- format it is about to use and is told nothing, which costs one honest full read.
    -- Without it, two incompatible renderings of an instant would be compared as if they
    -- were the same kind of thing, and the result would be silent.
    format     text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, tenant_id, entity)
);

-- Grants in the SAME file as the table (`privileges.md`). `040_grants.sql` names raw's tables
-- one by one -- `raw.records, raw.documents, raw.load_cursor` -- and the migration ledger
-- keys on filename, so it never runs again. A table added later therefore has NO grants at
-- all, and the symptom is "permission denied for table" at runtime with the whole suite still
-- green. `180_document_text.sql` carries its own grants for exactly this reason.
GRANT SELECT, INSERT, UPDATE ON raw.sync_cursor TO undercroft_worker;

-- NO ROW LEVEL SECURITY, and no tenant grant. This MIRRORS `raw.load_cursor`, and the
-- mirroring is deliberate rather than an omission -- record it here so the next reader
-- diffing this file against `raw.records` in `080_tenant_isolation.sql` does not "fix" it.
-- RLS filters the rows a role may see, and no tenant role holds any grant on this table, so
-- there is no role for a policy to constrain: it would be a policy that never runs, which
-- reads as protection and is none. Tenant scoping is in the primary key, which every
-- statement in `apps/worker/src/repos/syncCursor.ts` supplies in full.

-- Nothing for `undercroft_dbt` and nothing for `undercroft_bi`. A cursor is the worker's own
-- bookkeeping about what it has asked a provider for; it is not data a customer's model or a
-- dashboard has any question to put to it. `undercroft_bi` is revoked the whole `raw` schema
-- in 040 besides, and that revoke stays the outer boundary.
