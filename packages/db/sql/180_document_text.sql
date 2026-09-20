-- raw.document_text: what a landed document SAYS, and how we came to read it.
--
-- `raw.documents` (030) is the catalogue: a document exists, here are its bytes' sha256 and
-- its lake key, and SQL cannot read it. That was the whole of ADR 0015 -- bytes live in the
-- access-controlled store, opaque facts live here. It left every landed document unqueryable,
-- which for a customer asking "which contract mentions this clause" is the same as not having
-- it. ADR 0024 permits this one table to hold the content, and `pii.md` names it as the
-- single exception to "no name a human wrote reaches Postgres": a document's text necessarily
-- holds every name in it, and forbidding that forbids the table's whole purpose.
--
-- What did NOT change: `raw.documents.metadata` is still opaque, and a filename still never
-- reaches Postgres. This is one table, not a loosening of the columns beside it.
--
-- A PROJECTION, NOT A DURABLE LAYER. The bytes in the lake are the only thing that cannot be
-- recomputed; every row here can be dropped and rebuilt by re-running the extract verb, which
-- is why it lives under `raw` rather than in a schema of its own (`raw-lake.md`).
--
-- `source_sha256` IS THE POINT OF THE KEY. It is the sha256 of the bytes this text was read
-- FROM, copied off `raw.documents.sha256` at extraction time. A document whose bytes changed
-- gets a new sha, so the mismatch is what tells the next run to read it again -- and a match
-- is what stops it re-OCRing 252 MB of PDFs that have not moved. Without it the only choices
-- are re-extracting everything every run, or never noticing an updated file.
CREATE TABLE IF NOT EXISTS raw.document_text (
    source        text        NOT NULL,
    tenant_id     text        NOT NULL,
    document_id   text        NOT NULL,
    -- The bytes this text was read from. See the note above.
    source_sha256 char(64)    NOT NULL,
    -- HOW it was read: 'pdf_text', 'pdf_ocr', 'docx', 'xlsx', 'image_ocr', 'txt'. NULL only
    -- when nothing could be read, in which case `reason` says why. Deliberately not an enum:
    -- a new extractor is a new method, and a CHECK here would make adding one a migration.
    method        text,
    -- WHY it could not be read: 'legacy-doc-unsupported', 'extractor-missing:pdftotext', and
    -- so on. NULL when `method` succeeded.
    reason        text,
    text          text        NOT NULL DEFAULT '',
    chars         integer     NOT NULL DEFAULT 0,
    -- The text hit the extractor's ceiling and is a cut document. Recorded rather than
    -- trimmed in silence: a truncated contract that does not say it is truncated reads as a
    -- complete one that simply lacks the clause you were looking for.
    truncated     boolean     NOT NULL DEFAULT false,
    extracted_at  timestamptz NOT NULL,
    run_id        text        NOT NULL,
    PRIMARY KEY (source, tenant_id, document_id),
    -- One of the two always answers. "No text, no reason" is the silent zero this whole
    -- codebase refuses: it cannot be told from a document that genuinely says nothing.
    CONSTRAINT document_text_said_why CHECK (method IS NOT NULL OR reason IS NOT NULL)
);

-- The extract verb's working set: rows it has not read yet, or read from bytes that have
-- since changed. Without this the verb scans the tenant's whole catalogue every run.
CREATE INDEX IF NOT EXISTS document_text_stale
    ON raw.document_text (source, tenant_id, source_sha256);

-- Grants in the SAME file as the table (`privileges.md`): `040_grants.sql` said
-- `ON ALL TABLES IN SCHEMA raw`, which Postgres expanded to the tables that existed when it
-- ran, and the migration ledger means it never runs again. A table added later has no grants
-- at all, and the symptom is "permission denied" at runtime with the suite still green.
GRANT SELECT, INSERT, UPDATE, DELETE ON raw.document_text TO undercroft_worker;

-- The reason this table exists: a customer's dbt models can read it, as their own role, in
-- their own schema. ADR 0024.
GRANT SELECT ON raw.document_text TO undercroft_dbt;

-- The control plane counts how many of a source's documents could be read, so the Lake
-- division can print "122 documents, 55 readable" instead of leaving a reader to guess
-- whether anything came of the extract run. COLUMN-SCOPED on purpose: it may count and it
-- may name the method, and it may NOT read `text`. The UI has no screen for the content and
-- a request log is a far less controlled surface than this table (`privileges.md` grants the
-- worker column-scoped writes for the same reason).
GRANT SELECT (source, tenant_id, document_id, method, reason, chars, truncated, extracted_at)
    ON raw.document_text TO undercroft_app;

-- Nothing for `undercroft_bi`. The BI role is revoked the
-- whole `raw` schema in 040, and that revoke is now the only thing between a scanned contract
-- and a chart: text reaches a dashboard only through a model the customer wrote. ADR 0024
-- says it plainly -- do not grant the BI role anything in `raw` later.

-- -- row-level security ---------------------------------------------------------------
-- WITHOUT THIS EVERY TENANT'S dbt LOGIN READS EVERY OTHER TENANT'S DOCUMENT TEXT. The grant
-- above says which ROLES may read the table; only the policy says which ROWS, and this is the
-- table where that distinction carries the full text of other customers' contracts.
--
-- It is easy to miss because `raw.documents` is created in 030 and made row-secure in 080 --
-- two files apart -- so a new table in `raw` looks finished before it is. Same shape as both
-- tables there: the platform roles see everything, a tenant's login sees its own rows, and
-- the policy's one input is `raw.tenant_of(current_user)`, which is the login the session
-- actually holds and the one thing a SQL author cannot change (`privileges.md`).
ALTER TABLE raw.document_text ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'document_text'
                     AND policyname = 'platform_all') THEN
        -- The worker writes every tenant's rows. `undercroft_app` is named for symmetry with
        -- the other two tables; it holds no grant here, so the policy shows it nothing.
        CREATE POLICY platform_all ON raw.document_text FOR ALL
            TO undercroft_worker, undercroft_app USING (true) WITH CHECK (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'raw' AND tablename = 'document_text'
                     AND policyname = 'tenant_own') THEN
        CREATE POLICY tenant_own ON raw.document_text FOR SELECT
            USING (tenant_id = raw.tenant_of(current_user));
    END IF;
END
$$;

-- -- the per-tenant grant ---------------------------------------------------------------
-- `ops.provision_tenant` grants raw by TABLE NAME, so a table added later is invisible to
-- every tenant's own dbt role however many `GRANT ... TO undercroft_dbt` lines it carries --
-- that legacy role matches no tenant and reads zero rows through the policy above. Replacing
-- the function body is the supported way to extend it (080 does the same to `ops.guard_ddl`),
-- and the loop below re-runs it for tenants that already exist, exactly as 080 ends.
-- Two statements rather than a replaced function body. Copying 080's eighty lines here to
-- change one GRANT would leave two copies of the provisioning rules to drift apart, and the
-- copy in the later file would silently win -- which is a worse failure than the one being
-- fixed, in a function that creates logins.
--
-- So: 080's own line is edited in place (it grants the table list, and the list is now three
-- tables), which covers a fresh database and every tenant provisioned from here on. The loop
-- below covers the databases where 080 has already run and will never run again -- the
-- ledger keys on the file's NAME and stores no checksum, so an edit reaches new databases
-- only. `ops.tenant_role` is the authority for which login belongs to which customer
-- (`privileges.md`), so it is what the catch-up reads rather than the role list.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT role_name FROM ops.tenant_role WHERE kind = 'dbt' ORDER BY role_name LOOP
        EXECUTE format('GRANT SELECT ON raw.document_text TO %I', r.role_name);
    END LOOP;
END
$$;

