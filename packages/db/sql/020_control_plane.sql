-- The control-plane and operational schemas.
--
--   app  -- users, sessions, invitations, SEALED CREDENTIALS, ingest keys.
--           The BI role has no USAGE here, ever. A dashboard user who could read this
--           could read every tenant's OAuth credentials.
--   ops  -- tenants, connections (no secret material), runs, audit log. Freshness and
--           run health belong on a dashboard, so BI may read named views here.

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION undercroft_owner;
CREATE SCHEMA IF NOT EXISTS ops AUTHORIZATION undercroft_owner;

-- -- ops.tenant -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.tenant (
    id          text PRIMARY KEY,               -- a CASE-id, never a customer name
    display_name text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- -- ops.connection ---------------------------------------------------------
-- Status and the external account, but NO secret material. The ciphertext lives in
-- app.connection_secret, which BI and dbt cannot see.
CREATE TABLE IF NOT EXISTS ops.connection (
    tenant_id           text NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    source              text NOT NULL,
    status              text NOT NULL DEFAULT 'disconnected'
        CHECK (status IN ('disconnected', 'connected', 'error', 'expired')),
    external_account_id text,                    -- e.g. a Xero organisation id
    scope               text NOT NULL DEFAULT '',
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source)
);

CREATE TABLE IF NOT EXISTS ops.run (
    id         text PRIMARY KEY,
    tenant_id  text NOT NULL,
    source     text NOT NULL,
    verb       text NOT NULL,
    status     text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'ok', 'failed')),
    created    integer NOT NULL DEFAULT 0,
    changed    integer NOT NULL DEFAULT 0,
    unchanged  integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at   timestamptz
);

CREATE TABLE IF NOT EXISTS ops.audit_log (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id  text,
    actor      text NOT NULL,
    action     text NOT NULL,
    detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
    at         timestamptz NOT NULL DEFAULT now()
);

-- -- app tables --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.app_user (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email       text NOT NULL UNIQUE,
    display_name text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.tenant_member (
    tenant_id text NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    role      text NOT NULL CHECK (role IN ('viewer', 'member', 'admin')),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS app.session (
    id         text PRIMARY KEY,                 -- opaque, server-side
    user_id    uuid NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS app.invitation (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  text NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    email      text NOT NULL,
    role       text NOT NULL CHECK (role IN ('viewer', 'member', 'admin')),
    token_sha256 char(64) NOT NULL,              -- the token itself never stored
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz
);

-- Sealed OAuth credentials. AES-256-GCM ciphertext; the master key is not in the
-- database. Separate from ops.connection so the BI role, which has no USAGE on `app`,
-- cannot reach it even by mistake.
CREATE TABLE IF NOT EXISTS app.connection_secret (
    tenant_id   text NOT NULL,
    source      text NOT NULL,
    ciphertext  bytea NOT NULL,
    key_version integer NOT NULL,
    expires_at  timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source),
    FOREIGN KEY (tenant_id, source) REFERENCES ops.connection(tenant_id, source) ON DELETE CASCADE
);

-- Per-tenant ingest keys for the lake write API. Stored as a digest, never in the clear.
CREATE TABLE IF NOT EXISTS app.ingest_key (
    id              text PRIMARY KEY,            -- the public key id
    token_sha256    char(64) NOT NULL,
    tenant_id       text NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    allowed_sources text[] NOT NULL DEFAULT '{}',  -- empty means every source
    label           text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    revoked_at      timestamptz,
    last_used_at    timestamptz
);
