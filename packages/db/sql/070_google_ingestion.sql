-- Per-tenant Google ingestion: the consent handshake, and what the admin chose to share.
--
-- Two tables and a short list of grants that 040 could not have made. Both tables live in
-- `app` rather than `ops`, and that placement is the whole point of this file -- see the
-- comment on each.

-- -- app.connection_detail ---------------------------------------------------
-- The human half of a connection: which mailbox, and which labels or documents the admin
-- picked. `ops.connection` holds the machine half (status, the provider's opaque account
-- id) and is readable by BI so freshness can go on a dashboard.
--
-- WHY THIS IS NOT A COLUMN ON ops.connection. `040_grants.sql` says
-- `GRANT SELECT ON ops.connection TO undercroft_bi`, and a table-level grant covers
-- columns added later -- Postgres does not re-ask. So a `selection jsonb` added to that
-- table would put a customer's Gmail label names ("Invoices/Acme Pte Ltd") and Drive
-- folder names on a Metabase dashboard, permanently and silently. `app` is the only schema
-- BI has no USAGE on, which makes it the only correct home for a value carrying names a
-- person wrote.
CREATE TABLE IF NOT EXISTS app.connection_detail (
    tenant_id     text        NOT NULL,
    source        text        NOT NULL,
    -- The mailbox address or Drive account as a human reads it. PII: rendered to the admin
    -- who granted it, never projected into analytics.
    account_label text        NOT NULL DEFAULT '',
    -- What was chosen, with names: {"labels":[{"id":"Label_8","name":"Invoices"}]} or
    -- {"files":[{"id":"1A2b","name":"2026 statements","kind":"folder"}]}. Shape is the
    -- service's business, not the schema's -- a CHECK here would have to change every time
    -- a provider grows a way to be scoped.
    selection     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    chosen_at     timestamptz,
    -- The app_user uuid of the admin who chose. Who narrowed a grant is part of the grant.
    chosen_by     text        NOT NULL DEFAULT '',
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source),
    FOREIGN KEY (tenant_id, source) REFERENCES ops.connection(tenant_id, source) ON DELETE CASCADE
);

-- -- app.oauth_handshake -----------------------------------------------------
-- One in-flight OAuth consent. Written when an admin starts the flow, consumed once by the
-- callback, and gone.
--
-- WHY A TABLE AND NOT A COOKIE. The control plane has no cookie middleware -- Better Auth
-- owns every cookie in the process -- so a signed cookie for this would be a wider change
-- than a table. A row also gives three things a cookie cannot: a TTL the server enforces
-- rather than trusts, single-use consumption that is one DELETE ... RETURNING rather than a
-- read-then-write race, and a record of WHICH admin began the flow, which the audit entry
-- needs and a cookie in somebody else's browser could never prove.
--
-- `state` is stored as a digest, exactly as `app.invitation.token_sha256` is: a database
-- read then yields something that cannot be replayed. The PKCE verifier is NOT hashed --
-- it has to be sent back to Google verbatim -- which is the second reason this table is in
-- `app` and not in `ops`.
CREATE TABLE IF NOT EXISTS app.oauth_handshake (
    state_sha256    char(64)    PRIMARY KEY,
    tenant_id       text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    source          text        NOT NULL,
    verifier        text        NOT NULL,
    requested_scope text        NOT NULL DEFAULT '',
    -- app_user uuid of the admin who started it. The callback re-checks this caller is
    -- still an admin of tenant_id; starting a flow is not a standing authorisation.
    started_by      text        NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL
);

-- Sweeping expired rows is a maintenance job, not a constraint. The index makes it cheap
-- and makes "is this handshake still live" an index lookup rather than a scan.
CREATE INDEX IF NOT EXISTS oauth_handshake_expires_idx ON app.oauth_handshake (expires_at);

-- -- Grants ------------------------------------------------------------------
-- These are NOT optional, for the reason written at length in 060_auth.sql: 040's
-- `GRANT ... ON ALL TABLES IN SCHEMA app` was expanded by Postgres to the tables that
-- existed when it ran, and the ledger means it never runs again. A table added here with no
-- grant fails at first use with "permission denied" while the whole suite stays green.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.connection_detail, app.oauth_handshake
    TO undercroft_app;

-- -- The three grants 040 should have made -----------------------------------
-- These close live defects rather than enabling new ones. None has ever fired because the
-- code paths that need them were never wired: `accessToken` has had no caller passing a
-- refresher, and nothing outside a test has ever sealed a credential.
--
--   setStatus()       -> UPDATE ops.connection          -- the worker held only SELECT
--   upsertConnection()-> INSERT ops.connection          -- the worker held only SELECT
--   writeCredential() -> INSERT app.connection_secret   -- the worker held SELECT, UPDATE
--
-- The worker is now the only role that seals a credential (it is the only process holding
-- UNDERCROFT_SECRET_KEY), so it must be able to create the connection row the credential's
-- foreign key points at.
GRANT INSERT, UPDATE ON ops.connection TO undercroft_worker;
GRANT INSERT, DELETE ON app.connection_secret TO undercroft_worker;

-- The worker READS a scope and never chooses one. Disconnecting is an admin's decision made
-- in the control plane; the worker only carries it out against the provider. Withholding
-- UPDATE here is what makes that a privilege rather than a convention.
GRANT SELECT ON app.connection_detail TO undercroft_worker;

-- No ALTER DEFAULT PRIVILEGES. There is exactly one in this database and a gate test fails
-- if a second appears; see 040_grants.sql.
