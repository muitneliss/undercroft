-- The control plane: who our customers are, what they have connected, and who
-- may see it.
--
-- The data model was already tenant-scoped -- lake keys carry the tenant,
-- curated tables are keyed (source, tenant_id, source_record_id), and migration
-- 006 fixed an aggregate that crossed tenants. What was missing was a registry:
-- nothing owned the list of tenants, their connections, or their credentials.
-- Those lived in `VCDO_<SOURCE>_CREDENTIALS`, one global env var per source,
-- which cannot describe more than one customer and cannot be rotated at runtime.
--
-- WHY POSTGRES AND NOT THE LAKE. A connection is mutable state: tokens rotate,
-- schedules change, scopes are edited. `.claude/rules/raw-lake.md` forbids
-- overwriting an object in place, so a rotating credential cannot live there
-- without breaking the one rule that makes the lake an archive rather than a
-- cache. This is a projection; it belongs in the projection store.
--
-- WHY A SEPARATE `app` SCHEMA. Migration 002 ends with
--
--     ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT SELECT ON TABLES TO metabase_ro;
--
-- so every table created in `ops` from then on is automatically readable by the
-- BI role. Putting sealed credentials or user emails there would hand them to
-- every Metabase user the moment this file runs -- exactly the trap 002's own
-- closing comment names ("a later migration that grants broadly would otherwise
-- silently open this up"). Revoking afterwards is fragile, because the next
-- table added forgets again. `dq` already demonstrates the durable answer: a
-- whole schema the BI role has no USAGE on. Sensitive tables go in `app`.
--
-- The split is therefore a security boundary, not filing:
--
--   ops.*  run health, tenant labels, connection status -- belongs on a dashboard.
--   app.*  credentials, users, sessions, invitations   -- belongs to nobody but the API.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app;

-- ---------------------------------------------------------------------------
-- ops.tenant -- one row per customer whose data we hold.
--
-- `id` is a CASE-ID, not a name, and that is load-bearing rather than tidy.
-- The id is interpolated into every raw lake key, every log line and every
-- object listing; `.claude/rules/pii.md` makes a client name PII, so a named id
-- would spray PII across all three. The real name lives in `display_name`, in
-- this table only, where access is controlled.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.tenant (
    id            text        PRIMARY KEY,
    display_name  text        NOT NULL,
    status        text        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'suspended', 'archived')),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ops.connection -- one row per (tenant, source) the customer has connected.
--
-- Holds no secret material. The token that makes a connection work lives in
-- app.connection_secret, keyed identically, so that this table can stay visible
-- to BI and to the operator UI while the credential is not.
--
-- `external_account_id` is THEIR identifier, never ours: the HubSpot portal id,
-- the Xero organisation id, the mailbox address, the Drive root. Conflating it
-- with `tenant_id` is the defect that meant live Xero had never run -- it would
-- have sent our CASE-ID in the `xero-tenant-id` header.
--
-- `config` carries what the operator chose to sync: Drive folder ids, Gmail
-- labels, HubSpot entities. It is jsonb because the shape differs per source and
-- a column per source would be four mostly-null columns.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.connection (
    tenant_id              text        NOT NULL REFERENCES ops.tenant (id) ON DELETE CASCADE,
    source                 text        NOT NULL
                                       CHECK (source IN ('hubspot', 'xero', 'gmail', 'drive')),
    status                 text        NOT NULL DEFAULT 'disconnected'
                                       CHECK (status IN ('disconnected', 'connected',
                                                         'needs_scope', 'needs_reconnect')),
    external_account_id    text        NOT NULL DEFAULT '',
    external_account_label text        NOT NULL DEFAULT '',
    scopes                 text[]      NOT NULL DEFAULT '{}',
    config                 jsonb       NOT NULL DEFAULT '{}'::jsonb,
    schedule_cron          text        NOT NULL DEFAULT '',
    backfill_from          date,
    last_run_id            text        NOT NULL DEFAULT '',
    connected_by           uuid,
    connected_at           timestamptz,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source)
);

-- ---------------------------------------------------------------------------
-- ops.audit_log -- who did what.
--
-- A control plane whose buttons mint OAuth tokens to a customer's email and
-- accounting system needs to be able to answer "who connected this, and when".
-- `detail` never carries a token; obs_log's redaction is the backstop, this
-- column's discipline is the rule.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.audit_log (
    id             bigserial   PRIMARY KEY,
    actor_user_id  uuid,
    tenant_id      text,
    action         text        NOT NULL,
    detail         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_at_idx ON ops.audit_log (tenant_id, at DESC);

-- ---------------------------------------------------------------------------
-- app.app_user -- someone who may sign in.
--
-- Sign-in accepts both Google Workspace and personal Google accounts, so the
-- hosted domain cannot be the authorisation check. `is_staff` is granted by
-- matching VCDO_SSO_STAFF_DOMAINS at first login; everyone else must have been
-- invited. An account that is neither is refused, because an open Google
-- sign-in on this surface would admit every Google account there is.
--
-- Email is compared case-insensitively through a functional unique index rather
-- than citext, which would need an extension this database may not be able to
-- create.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.app_user (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text        NOT NULL,
    google_sub    text        UNIQUE,
    display_name  text        NOT NULL DEFAULT '',
    is_staff      boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_key ON app.app_user (lower(email));

-- ---------------------------------------------------------------------------
-- app.tenant_member -- which tenants a user may see, and in what capacity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.tenant_member (
    tenant_id  text        NOT NULL REFERENCES ops.tenant (id) ON DELETE CASCADE,
    user_id    uuid        NOT NULL REFERENCES app.app_user (id) ON DELETE CASCADE,
    role       text        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

-- ---------------------------------------------------------------------------
-- app.invitation -- the only way a non-staff account gets in.
--
-- The token is stored as a SHA-256 digest, never in the clear: this table is in
-- the backup set, and a leaked backup should not hand over working invitations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.invitation (
    token_sha256 text        PRIMARY KEY,
    tenant_id    text        NOT NULL REFERENCES ops.tenant (id) ON DELETE CASCADE,
    email        text        NOT NULL,
    role         text        NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    invited_by   uuid        REFERENCES app.app_user (id) ON DELETE SET NULL,
    expires_at   timestamptz NOT NULL,
    accepted_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitation_email_idx ON app.invitation (lower(email));

-- ---------------------------------------------------------------------------
-- app.session -- server-side, so signing out actually revokes.
--
-- A stateless signed cookie cannot be withdrawn before it expires. This surface
-- holds the buttons that mint tokens to a customer's accounting system, so
-- "revoke now" has to mean now.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.session (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES app.app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS session_user_idx ON app.session (user_id);

-- ---------------------------------------------------------------------------
-- app.connection_secret -- the sealed credential.
--
-- Separate table, separate schema, same key as ops.connection. Sealed with
-- AES-256-GCM by vcdo.core.secrets; `key_version` exists so rotation can add a
-- key rather than rewrite every row at once.
--
-- NOTE FOR RESTORE: this table is in the backup set, and the master key is NOT.
-- That is deliberate and it is also a trap -- a dump restored without its key
-- yields rows that cannot be opened, and a dump stored beside its key yields
-- encryption that buys nothing. See ADR 0005.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.connection_secret (
    tenant_id   text        NOT NULL,
    source      text        NOT NULL,
    ciphertext  bytea       NOT NULL,
    nonce       bytea       NOT NULL,
    key_version integer     NOT NULL DEFAULT 1,
    expires_at  timestamptz,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, source),
    FOREIGN KEY (tenant_id, source) REFERENCES ops.connection (tenant_id, source) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Attribute the operational tables to a tenant.
--
-- Source record ids, and the entity keys derived from them, are only unique
-- WITHIN a tenant -- the same reasoning that puts the tenant in every raw lake
-- key. dq.quarantine matters most here: it holds rejected rows WITH their
-- original payload, so without a tenant column there is no way to erase one
-- customer's quarantined raw data, which ADR 0002 already flags as a PDPA
-- deadline.
--
-- '' rather than NULL, so rows written before the column existed stay
-- addressable rather than becoming un-queryable.
-- ---------------------------------------------------------------------------
ALTER TABLE ops.gate_finding ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '';
ALTER TABLE dq.quarantine    ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS quarantine_tenant_idx ON dq.quarantine (tenant_id, quarantined_at DESC);

-- Deliberately NO foreign key from curated.* to ops.tenant.
-- tests/integration publishes under ad-hoc `itest-<hex>` tenants that are never
-- registered, and a FK would make `make itest` fail on its own fixtures. The
-- registry is authoritative for the control plane, not a constraint on history.

-- ---------------------------------------------------------------------------
-- The BI role gets none of `app`.
--
-- Explicit, following 002's stated reasoning that revoking beats relying on
-- never having granted -- and note that no ALTER DEFAULT PRIVILEGES is set on
-- this schema, so tables added here later stay closed by default rather than
-- open by default.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA app FROM metabase_ro;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM metabase_ro;

COMMIT;
