-- Curated core: customers, deals, and the run/quality scaffolding around them.
--
-- Everything here is a PROJECTION. It may be dropped and rebuilt from the raw
-- lake at any time, and doing so must produce identical rows. That property is
-- what keeps a future migration (Iceberg, a schema change, a bug fix in a
-- transform) a backfill rather than a data rescue -- so nothing may live here
-- that does not also exist in raw.
--
-- Money is NUMERIC(18,4), never float or double precision. Four places, not two:
-- FX conversion and unit pricing produce sub-cent intermediates, and rounding
-- those before aggregation is how a ledger drifts by a few cents a month with
-- nobody able to say where it went.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curated;
CREATE SCHEMA IF NOT EXISTS dq;
CREATE SCHEMA IF NOT EXISTS ops;

-- ---------------------------------------------------------------------------
-- ops.run_ledger -- one row per pipeline stage.
--
-- `unaccounted` is the field that matters: rows_in - rows_out - rows_excluded.
-- Non-zero means rows vanished without anyone deciding they should.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.run_ledger (
    run_id              text        NOT NULL,
    stage               text        NOT NULL,
    status              text        NOT NULL CHECK (status IN ('ok', 'error')),
    duration_ms         integer     NOT NULL,
    rows_in             integer     NOT NULL DEFAULT 0,
    rows_out            integer     NOT NULL DEFAULT 0,
    rows_excluded       integer     NOT NULL DEFAULT 0,
    excluded_by_reason  jsonb       NOT NULL DEFAULT '{}'::jsonb,
    unaccounted         integer     NOT NULL DEFAULT 0,
    error_type          text,
    recorded_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, stage)
);

-- ---------------------------------------------------------------------------
-- ops.generation -- which run is currently serving.
--
-- Publishing is atomic: a generation becomes visible only once its quality
-- checks pass. A failed run leaves the previous generation serving, with its
-- freshness visible, rather than half-replacing it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.generation (
    id            bigserial   PRIMARY KEY,
    run_id        text        NOT NULL,
    status        text        NOT NULL CHECK (status IN ('building', 'published', 'failed')),
    started_at    timestamptz NOT NULL DEFAULT now(),
    published_at  timestamptz,
    notes         text
);

-- ---------------------------------------------------------------------------
-- dq.quarantine -- rejected rows, kept with their reason and payload.
--
-- A real table, not a log line. A rejected row that exists only in a log cannot
-- be re-examined, re-processed, or counted. The payload is retained because the
-- question asked later is always "what exactly did they send us".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dq.quarantine (
    id                bigserial   PRIMARY KEY,
    run_id            text        NOT NULL,
    source            text        NOT NULL,
    entity            text        NOT NULL,
    source_record_id  text,
    reason_code       text        NOT NULL,
    detail            text,
    payload           jsonb,
    lake_key          text,
    quarantined_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quarantine_run_idx    ON dq.quarantine (run_id);
CREATE INDEX IF NOT EXISTS quarantine_reason_idx ON dq.quarantine (reason_code);

-- ---------------------------------------------------------------------------
-- curated.customers
--
-- GRAIN:        one row per (source, tenant_id, source_record_id)
-- NATURAL KEY:  (source, tenant_id, source_record_id)
--
-- Declared by hand and pinned by a test. The legacy registry auto-inferred grain
-- and got it wrong -- it recorded both xero_invoices and xero_payments as
-- "1 row per contact_id" -- and an auto-inferred grain is worse than none,
-- because it is trusted.
--
-- Note the grain is per SOURCE record, not per real-world company. One company
-- may appear here once from HubSpot and once from Xero. Uniting them is the
-- crosswalk's job (entity_id), and it is deliberately a separate decision with
-- its own evidence, not an assumption baked into this key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curated.customers (
    source             text        NOT NULL,
    tenant_id          text        NOT NULL,
    source_record_id   text        NOT NULL,

    entity_id          text,               -- resolved identity; NULL is valid and common
    display_name       text,
    normalised_name    text,               -- vcdo.core.names.norm_name, for matching only
    domain             text,
    email              text,
    lifecycle_stage    text,
    industry           text,
    customer_kind      text        NOT NULL CHECK (customer_kind IN ('company', 'person')),

    source_created_at  timestamptz,
    source_updated_at  timestamptz,

    -- Lineage on every row: which run wrote it, and which exact lake object it
    -- came from. Without the lake key, "where did this number come from" has no
    -- answer that survives a rebuild.
    run_id             text        NOT NULL,
    lake_key           text        NOT NULL,
    built_at           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source, tenant_id, source_record_id)
);

CREATE INDEX IF NOT EXISTS customers_entity_idx     ON curated.customers (entity_id);
CREATE INDEX IF NOT EXISTS customers_normalised_idx ON curated.customers (normalised_name);

-- ---------------------------------------------------------------------------
-- curated.deals
--
-- GRAIN:        one row per (source, tenant_id, source_record_id)
-- NATURAL KEY:  (source, tenant_id, source_record_id)
--
-- `amount` is NULL when the source had no readable amount. It is never 0.
-- A zero is indistinguishable from a real zero downstream, so a parse failure
-- that returns zero is data loss wearing the costume of a fact.
--
-- `currency` is NOT NULL wherever `amount` is present, enforced below. An amount
-- without a currency cannot be summed, compared, or converted, and permitting it
-- guarantees someone eventually sums mixed currencies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curated.deals (
    source             text        NOT NULL,
    tenant_id          text        NOT NULL,
    source_record_id   text        NOT NULL,

    entity_id          text,
    deal_name          text,
    stage              text,
    pipeline           text,
    is_won             boolean,
    is_closed          boolean,

    amount             numeric(18, 4),
    currency           char(3),

    closed_on          date,
    source_created_at  timestamptz,
    source_updated_at  timestamptz,

    run_id             text        NOT NULL,
    lake_key           text        NOT NULL,
    built_at           timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (source, tenant_id, source_record_id),

    CONSTRAINT deals_amount_needs_currency
        CHECK (amount IS NULL OR currency IS NOT NULL),
    CONSTRAINT deals_currency_is_iso
        CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS deals_entity_idx ON curated.deals (entity_id);
CREATE INDEX IF NOT EXISTS deals_closed_idx ON curated.deals (closed_on);

-- ---------------------------------------------------------------------------
-- curated.freshness -- what a dashboard reader needs to judge a number.
--
-- Exposed to Metabase deliberately. A figure with no visible age invites someone
-- to act on a stale one, and the failure is silent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW curated.freshness AS
SELECT
    'customers' AS table_name,
    count(*)                  AS row_count,
    max(source_updated_at)    AS newest_source_change,
    max(built_at)             AS last_built_at,
    count(DISTINCT run_id)    AS distinct_runs
FROM curated.customers
UNION ALL
SELECT
    'deals',
    count(*),
    max(source_updated_at),
    max(built_at),
    count(DISTINCT run_id)
FROM curated.deals;

COMMIT;
