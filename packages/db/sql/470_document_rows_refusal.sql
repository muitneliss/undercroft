-- Why a workbook read before its rows existed has none, and the index the backfill needs.
-- ADR 0104 decision 9.
--
-- THE BACKFILL re-reads, from the lake, every workbook whose text was read before
-- `raw.document_rows` existed, and writes its rows. A re-read the reader now refuses writes no
-- rows and leaves the text it already had (decision 8). Without a record of that refusal the
-- same digest would be offered first to every pass for ever -- and a batch of them would starve
-- every workbook queued behind. So the refusal is kept here, with its reason and the rows
-- generation that gave it, and the backlog skips a digest refused under the current generation.
-- A bump of `CURRENT_ROWS_VERSION` re-offers them all, as a reader generation does for texts.
--
-- It is also the answer a model needs: a workbook with a text and no rows says why here,
-- rather than looking like one nobody has got to yet (CLAUDE.md rule 2).
--
-- KEYED BY THE BYTES, like the rows it stands in for (460).

CREATE TABLE IF NOT EXISTS raw.document_rows_refusal (
    tenant_id     text        NOT NULL,
    sha256        char(64)    NOT NULL,
    rows_version  integer     NOT NULL,
    -- The reader's own refusal, such as 'xlsx-unreadable'. An enumerated name, never content.
    reason        text        NOT NULL,
    refused_at    timestamptz NOT NULL,
    run_id        text        NOT NULL,
    PRIMARY KEY (tenant_id, sha256)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON raw.document_rows_refusal TO undercroft_worker;
GRANT SELECT ON raw.document_rows_refusal TO undercroft_dbt;
-- The control plane may count refusals by reason: a reason is a name the platform chose, not
-- text a person wrote.
GRANT SELECT ON raw.document_rows_refusal TO undercroft_app;
-- Nothing for `undercroft_bi` (040, ADR 0024).

ALTER TABLE raw.document_rows_refusal ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'document_rows_refusal'
                     AND policyname = 'platform_all') THEN
        CREATE POLICY platform_all ON raw.document_rows_refusal FOR ALL
            TO undercroft_worker, undercroft_app USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'document_rows_refusal'
                     AND policyname = 'tenant_own') THEN
        CREATE POLICY tenant_own ON raw.document_rows_refusal FOR SELECT
            USING (tenant_id = raw.tenant_of(current_user));
    END IF;
END
$$;

-- WHICH DIGESTS NO LIVE DOCUMENT HOLDS ANY MORE is asked per TENANT, across its sources, because
-- the rows are a digest's and not a source's: a ledger tombstoned in Gmail but still filed in
-- Drive keeps its rows. `documents_digest` (250) leads with `source` and cannot serve that
-- question without a scan of the tenant's whole catalogue per digest.
CREATE INDEX IF NOT EXISTS documents_tenant_digest
    ON raw.documents (tenant_id, sha256) WHERE deleted_at IS NULL;
