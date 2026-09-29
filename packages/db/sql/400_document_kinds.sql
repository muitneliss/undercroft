-- A tenant's catalogue of document kinds, its published versions, and what each text was
-- classified as. ADR 0085.
--
-- FOUR TABLES AND A VIEW, IN TWO SCHEMAS, FOR ONE REASON EACH.
--
-- `app.document_kind` is the tenant's catalogue as its admin is editing it: a kind, the
-- description the classifier reads, where it came from. `app`, because a description is text a
-- person may write and the BI role has no USAGE on `app` -- the reason `app.model` sits there.
--
-- `app.document_kind_version` is a PUBLISHED catalogue: an immutable snapshot with the hash of
-- its canonical definition. Publishing is what re-classifies, so drafting ten edits and
-- publishing once pays for one re-classification. The control plane writes both; the worker
-- reads them, and inserts the FIRST catalogue when it initialises one from a sample.
--
-- `raw.document_kind` is what a text was classified as, keyed by the BYTES (tenant and
-- `source_sha256`), because a forwarded attachment is many documents over one digest and one
-- answer serves them all. A rebuildable projection of `raw.document_text`, so it sits beside it
-- in `raw`: the worker writes it, a tenant's own dbt login reads its own rows, BI reads nothing.
--
-- `raw.document_kind_definition` is which version is current, per tenant, as the WORKER last
-- read it from `app`. It exists because a tenant's dbt login may not read `app` at all
-- (`privileges.md`), and the view below has to tell a current answer from one given under a
-- catalogue since replaced. It holds a hash and a number, never a description.

-- -- the catalogue --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.document_kind (
    tenant_id    text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    -- The stored value. Lowercase with underscores, like a dbt identifier, because a model
    -- will filter and group on it.
    kind         text        NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]*$' AND length(kind) <= 63),
    description  text        NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
    -- `initialised`: kept from a sample; `generic`: added from the platform's catalogue by an
    -- admin; `admin`: written by an admin.
    origin       text        NOT NULL CHECK (origin IN ('initialised', 'generic', 'admin')),
    -- The share of the initialising sample classified as this kind, as a decimal string's
    -- column. NULL for a kind nobody measured.
    sample_share numeric(5, 4),
    updated_by   text        NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.document_kind TO undercroft_app;
-- INSERT so an initialising run can write the first catalogue; it never edits one.
GRANT SELECT, INSERT ON app.document_kind TO undercroft_worker;

CREATE TABLE IF NOT EXISTS app.document_kind_version (
    tenant_id       text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    version         integer     NOT NULL CHECK (version > 0),
    definition_hash char(64)    NOT NULL,
    -- The canonical definition the hash is over: instruction, model and every kind with its
    -- description. What the worker asks the classifier, exactly.
    definition      jsonb       NOT NULL,
    published_by    text        NOT NULL DEFAULT '',
    published_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.document_kind_version TO undercroft_app;
GRANT SELECT ON app.document_kind_version TO undercroft_worker;

-- -- the results ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw.document_kind (
    tenant_id       text        NOT NULL,
    source_sha256   char(64)    NOT NULL,
    definition_hash char(64)    NOT NULL,
    version         integer     NOT NULL,
    -- `classified`: an answer the catalogue offered. `too-short`: a text under the floor, never
    -- sent. `invalid-response`: an answer the catalogue never offered. `provider-error`: the
    -- classifier could not answer; tried again by a later run.
    status          text        NOT NULL
        CHECK (status IN ('classified', 'too-short', 'invalid-response', 'provider-error')),
    kind            text,
    -- Four places, as the classifier reports them. A probability, never money.
    confidence      numeric(5, 4),
    -- Every kind's probability, so a threshold or a runner-up can be read without asking again.
    probabilities   jsonb,
    model           text        NOT NULL,
    reason          text,
    classified_at   timestamptz NOT NULL,
    run_id          text        NOT NULL,
    PRIMARY KEY (tenant_id, source_sha256),
    -- A kind exactly when the text was classified. A row that says neither what nor why is the
    -- silent answer this codebase refuses.
    CONSTRAINT document_kind_said_what CHECK ((status = 'classified') = (kind IS NOT NULL)),
    CONSTRAINT document_kind_said_why CHECK (status = 'classified' OR reason IS NOT NULL)
);

-- The due question: a tenant's digests answered under another definition, or not at all.
CREATE INDEX IF NOT EXISTS document_kind_due
    ON raw.document_kind (tenant_id, definition_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON raw.document_kind TO undercroft_worker;
-- The control plane counts results per kind. Nothing here is text.
GRANT SELECT ON raw.document_kind TO undercroft_app;
GRANT SELECT ON raw.document_kind TO undercroft_dbt;

CREATE TABLE IF NOT EXISTS raw.document_kind_definition (
    tenant_id       text        PRIMARY KEY,
    version         integer     NOT NULL,
    definition_hash char(64)    NOT NULL,
    published_at    timestamptz NOT NULL,
    synced_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON raw.document_kind_definition TO undercroft_worker;
GRANT SELECT ON raw.document_kind_definition TO undercroft_app;
GRANT SELECT ON raw.document_kind_definition TO undercroft_dbt;

-- Nothing for `undercroft_bi` on either: revoked the whole of `raw` in 040, and ADR 0024 says
-- not to grant it anything here later.

-- -- row-level security, as on `raw.document_text` (180) --------------------------------------
ALTER TABLE raw.document_kind ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw.document_kind_definition ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['document_kind', 'document_kind_definition'] LOOP
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

-- -- the view a model reads -----------------------------------------------------------------
-- Every live document with the kind its text was classified as. `security_invoker` is the
-- whole safety of it: without it a view runs as its OWNER, which owns the tables and so passes
-- their row-level security, and every tenant's dbt login would read every tenant's kinds.
--
-- `current` says whether the answer was given under the tenant's current catalogue; one given
-- under a replaced catalogue is kept (it is still what was said) but never ACCEPTED.
-- `accepted_kind` is the kind at 0.90 or above under the current catalogue, else NULL: the
-- threshold is applied here, when read, so moving it costs nothing (ADR 0085).
CREATE OR REPLACE VIEW raw.document_kinds WITH (security_invoker = true) AS
SELECT t.source,
       t.tenant_id,
       t.document_id,
       k.kind,
       k.confidence,
       CASE
           WHEN k.status = 'classified'
                AND k.confidence >= 0.90
                AND k.definition_hash = d.definition_hash
           THEN k.kind
       END AS accepted_kind,
       k.status,
       k.reason,
       k.version,
       COALESCE(k.definition_hash = d.definition_hash, false) AS current,
       k.classified_at
  FROM raw.document_text t
  JOIN raw.documents doc
    ON doc.source = t.source
   AND doc.tenant_id = t.tenant_id
   AND doc.document_id = t.document_id
   AND doc.deleted_at IS NULL
  JOIN raw.document_kind k
    ON k.tenant_id = t.tenant_id
   AND k.source_sha256 = t.source_sha256
  LEFT JOIN raw.document_kind_definition d
    ON d.tenant_id = t.tenant_id;

GRANT SELECT ON raw.document_kinds TO undercroft_worker;
GRANT SELECT ON raw.document_kinds TO undercroft_dbt;
-- Not `undercroft_app`: the view reads `raw.document_text.source_sha256`, a column the control
-- plane's column-scoped grant (180) does not include, and it has no need to.

-- A tenant's own dbt login is granted these in `repeatable/010_provision_tenant.sql`, the one
-- place a tenant's read access is stated.
