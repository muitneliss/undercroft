-- A workbook's sheets and rows, as a dbt model selects them. ADR 0104.
--
-- `raw.document_text` gives a model a workbook as one cell of tab-separated text, capped at a
-- million characters. These two tables give it the same workbook as rows: Excel's own row
-- number, each cell under its column letter, and the facts Excel stores about a cell -- its
-- number format, an error it holds -- recorded and never interpreted. No header is chosen and
-- no type is inferred here; that is the tenant's model, with `parse_amount` (CLAUDE.md, "ships
-- no business schema").
--
-- A PROJECTION, NOT A DURABLE LAYER, exactly as `document_text` is (180): the bytes in the lake
-- are the only thing that cannot be recomputed, and every row here is rebuilt by the extract
-- verb. So it lives in `raw` beside the text it was read with.
--
-- KEYED BY THE BYTES (`tenant_id`, `sha256`), not by document, as `raw.document_kind` is (400):
-- one ledger quoted in ten messages and filed in Drive is one set of rows. A model reaches a
-- document's rows through `raw.documents.sha256`. `sha256` here is the digest the rows were
-- read FROM; a document whose bytes change has a new digest and is read again.
--
-- CONTENT A PERSON WROTE, under `pii.md`'s one exception: ADR 0024 lets `raw.document_text`
-- hold a document's text, and ADR 0104 extends that to these two tables on the same terms --
-- a tenant's own dbt login reads its own rows, the control plane never reads content, and the
-- BI role reads nothing in `raw`.

CREATE TABLE IF NOT EXISTS raw.document_sheets (
    tenant_id         text        NOT NULL,
    sha256            char(64)    NOT NULL,
    -- 1-based, in the order the workbook lists its sheets: its tab order.
    sheet_index       integer     NOT NULL CHECK (sheet_index >= 1),
    -- The sheet's name as the workbook states it, or NULL with `sheet_name_reason` when the
    -- package has no relationships to bind a name to its part. Never inferred from order.
    sheet_name        text,
    sheet_name_reason text,
    -- worksheet, chartsheet, dialogsheet or macrosheet; NULL when the sheet's relationship
    -- names a part type the reader does not know.
    sheet_kind        text,
    -- Excel's own word: visible, hidden or veryHidden. Recorded, never acted on.
    sheet_state       text        NOT NULL,
    -- Which container the workbook came from: ooxml, ooxml-strict (and, later, biff8).
    container         text        NOT NULL,
    -- The workbook's date epoch. NULL only when the package holds no workbook part to say.
    date1904          boolean,
    -- The used range the sheet declares, such as 'A1:K5012'.
    dimension         text,
    -- Merged ranges as declared, such as {'A1:F1'}. Never filled.
    merges            text[]      NOT NULL DEFAULT '{}',
    row_count         integer     NOT NULL CHECK (row_count >= 0),
    -- FALSE when the read stopped short: `reason` says why, and the rows before it are held.
    -- The tabular counterpart of `document_text.truncated`, and for #385 the ONLY flag that
    -- says whether a model holds the whole sheet (ADR 0104 decision 10).
    complete          boolean     NOT NULL,
    reason            text,
    -- The generation of the reader that wrote these rows (ADR 0104 decision 9).
    rows_version      integer     NOT NULL,
    extracted_at      timestamptz NOT NULL,
    run_id            text        NOT NULL,
    PRIMARY KEY (tenant_id, sha256, sheet_index),
    -- A sheet that stopped short says why, and one that did not says nothing.
    CONSTRAINT document_sheets_said_why CHECK (complete = (reason IS NULL)),
    -- A name, or why there is none: a NULL name with no reason is the silent answer.
    CONSTRAINT document_sheets_named CHECK (sheet_name IS NOT NULL OR sheet_name_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS raw.document_rows (
    tenant_id    text     NOT NULL,
    sha256       char(64) NOT NULL,
    sheet_index  integer  NOT NULL,
    -- Excel's own row number. The gaps between two rows are real: an empty row is not stored.
    row_number   integer  NOT NULL CHECK (row_number >= 1),
    hidden       boolean  NOT NULL DEFAULT false,
    -- Column letter -> the string the file stores: {"A": "Date", "F": "1234.10"}. Sparse. An
    -- amount is never a JSON number here, which would be a float (`money.md`).
    cells        jsonb    NOT NULL,
    -- Column letter -> number-format code, for a cell whose format is not General. NULL if none.
    formats      jsonb,
    -- Column letter -> what stands where a value would: {"D": "#REF!"}. NULL if none.
    faults       jsonb,
    PRIMARY KEY (tenant_id, sha256, sheet_index, row_number),
    FOREIGN KEY (tenant_id, sha256, sheet_index)
        REFERENCES raw.document_sheets (tenant_id, sha256, sheet_index) ON DELETE CASCADE
);

-- Grants in the SAME file as the tables (`privileges.md`; see 180 for the defect that rule
-- closes).
GRANT SELECT, INSERT, UPDATE, DELETE ON raw.document_sheets, raw.document_rows TO undercroft_worker;

-- The reason these tables exist: a customer's dbt models read them, as the tenant's own login.
-- The per-tenant grant is the one list in `repeatable/010_provision_tenant.sql`.
GRANT SELECT ON raw.document_sheets, raw.document_rows TO undercroft_dbt;

-- The control plane may count a workbook's sheets and see which stopped short. COLUMN-SCOPED on
-- purpose: a sheet's NAME is text a person wrote, so it is left out, and nothing in
-- `document_rows` is granted at all -- `pii.md`'s line is that `undercroft_app` never reads
-- content.
GRANT SELECT (tenant_id, sha256, sheet_index, sheet_kind, sheet_state, container, row_count,
              complete, reason, rows_version, extracted_at)
    ON raw.document_sheets TO undercroft_app;

-- Nothing for `undercroft_bi`: revoked the whole of `raw` in 040, and ADR 0024 says not to
-- grant it anything here later.

-- -- row-level security, as on `raw.document_text` (180) --------------------------------------
-- Without it every tenant's dbt login reads every other tenant's workbooks.
ALTER TABLE raw.document_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.document_rows ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['document_sheets', 'document_rows'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'raw' AND tablename = t
                         AND policyname = 'platform_all') THEN
            EXECUTE format(
                'CREATE POLICY platform_all ON raw.%I FOR ALL
                     TO undercroft_worker, undercroft_app USING (true) WITH CHECK (true)', t);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'raw' AND tablename = t
                         AND policyname = 'tenant_own') THEN
            EXECUTE format(
                'CREATE POLICY tenant_own ON raw.%I FOR SELECT
                     USING (tenant_id = raw.tenant_of(current_user))', t);
        END IF;
    END LOOP;
END
$$;
