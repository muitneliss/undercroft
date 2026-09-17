-- The generic raw layer. One table replaces every hand-written curated schema.
--
-- The platform never learns a source's shape. dbt models select from raw.records and
-- filter by source and entity; everything above this is user-authored SQL.

CREATE SCHEMA IF NOT EXISTS raw AUTHORIZATION undercroft_owner;

-- -- raw.records --------------------------------------------------------------
--
-- One row per (source, tenant, entity, upstream id): the CURRENT projection of the
-- newest observation in the lake. History is NOT here -- the lake holds every version,
-- addressed by content. This table is a rebuildable index over the newest one.
--
-- `payload` is written from the lake's JSON *bytes* via `$n::jsonb`, never by
-- re-serialising a JavaScript object, because JSON.parse turns every number into a float
-- and Postgres's own parser does not. Consequence: `content_sha256` is the digest of the
-- LAKE object, not of this column (jsonb normalises key order and whitespace). Never
-- verify from here; verify from the lake.
--
-- PARTITION BY LIST (source) from the first migration, deliberately: converting a
-- populated table to partitioned later is a full rewrite under ACCESS EXCLUSIVE. A new
-- connector needs no migration -- its partition is created at admin time, and until then
-- rows land in the default partition rather than being lost.
CREATE TABLE IF NOT EXISTS raw.records (
    source            text        NOT NULL,
    tenant_id         text        NOT NULL,
    entity            text        NOT NULL,
    source_record_id  text        NOT NULL,

    payload           jsonb       NOT NULL,
    content_sha256    char(64)    NOT NULL,

    source_updated_at timestamptz,              -- when THEY changed it; NULL is honest
    observed_at       timestamptz NOT NULL,     -- when the lake observed it
    loaded_at         timestamptz NOT NULL DEFAULT now(),

    lake_key          text        NOT NULL,
    lake_stamp        text        NOT NULL,     -- which observation this row projects
    run_id            text        NOT NULL,

    -- Upstream deletion is a tombstone, not a DELETE. A row that silently vanishes is
    -- indistinguishable from a sync that failed to see it.
    deleted_at        timestamptz,

    PRIMARY KEY (source, tenant_id, entity, source_record_id),
    CONSTRAINT records_ids_nonempty
        CHECK (source <> '' AND tenant_id <> '' AND entity <> '' AND source_record_id <> '')
) PARTITION BY LIST (source);

CREATE TABLE IF NOT EXISTS raw.records_default PARTITION OF raw.records DEFAULT;

CREATE INDEX IF NOT EXISTS records_loaded_at_idx ON raw.records (loaded_at);
CREATE INDEX IF NOT EXISTS records_tenant_entity_idx
    ON raw.records (tenant_id, entity, source_updated_at DESC);

-- -- raw.documents ------------------------------------------------------------
-- The byte-oriented half (PDFs, mail attachments). The bytes stay in the lake; this is
-- the catalogue, so SQL and the UI can see a document exists without being able to read
-- it from Postgres. `metadata` never holds the bytes, and never a filename or mailbox in
-- a way that leaks PII into a BI-visible place -- those stay in the access-controlled
-- lake manifest.
CREATE TABLE IF NOT EXISTS raw.documents (
    source       text        NOT NULL,
    tenant_id    text        NOT NULL,
    document_id  text        NOT NULL,
    lake_key     text        NOT NULL,
    sha256       char(64)    NOT NULL,
    byte_length  bigint      NOT NULL,
    content_type text        NOT NULL DEFAULT 'application/octet-stream',
    metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    observed_at  timestamptz NOT NULL,
    run_id       text        NOT NULL,
    deleted_at   timestamptz,
    PRIMARY KEY (source, tenant_id, document_id)
);

-- Where the loader has got to, per stream. See the raw loader in apps/worker.
CREATE TABLE IF NOT EXISTS raw.load_cursor (
    source     text        NOT NULL,
    tenant_id  text        NOT NULL,
    entity     text        NOT NULL,
    last_stamp text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, tenant_id, entity)
);
