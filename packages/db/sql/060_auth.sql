-- Better Auth's four tables. See docs/adr/0010-better-auth-for-sessions.md.
--
-- These are the ONLY tables in this database written by a library rather than by our own
-- SQL, and that shapes every choice below.
--
-- Naming. Better Auth's defaults are `user`, `session`, `account`, `verification`. All four
-- are unusable here: `user` is a reserved word, and `app.session` already exists with an
-- incompatible shape (opaque text id, `revoked_at`, uuid user_id). So every table is
-- prefixed `auth_` and mapped back to Better Auth's model names in its config. The mapping
-- lives in apps/control-plane/src/auth/auth.ts -- change one and you must change the other.
--
-- `text` ids, not uuid. Better Auth generates its own ids and hands them to the insert;
-- text is the type it natively emits, and nothing on our side foreign-keys these rows
-- (`app.tenant_member` keys `app.app_user.id`, and the bridge between the two identities is
-- the email address). Choosing uuid here would buy nothing and add a cast between us and a
-- writer we do not control.
--
-- Nullability is deliberately loose. Every column Better Auth might omit on some path is
-- nullable, because a NOT NULL on a column a third-party writer populates is a runtime
-- landmine: it turns a library upgrade that stops sending `name` into a failed login rather
-- than a cosmetically empty field. The columns that are NOT NULL are the ones a session
-- cannot mean anything without.

-- -- app.auth_user ----------------------------------------------------------
-- The authentication identity. NOT the authorization identity: membership and roles hang
-- off app.app_user, and a sign-in is resolved to that row by email.
CREATE TABLE IF NOT EXISTS app.auth_user (
    id             text PRIMARY KEY,
    name           text,
    email          text NOT NULL UNIQUE,
    email_verified boolean NOT NULL DEFAULT false,
    image          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- -- app.auth_session -------------------------------------------------------
-- Server-side sessions, so a session can be withdrawn before it expires. The cookie carries
-- `token.signature`; `token` is what this column holds, and the signature is verified by
-- Better Auth rather than by our SQL.
CREATE TABLE IF NOT EXISTS app.auth_session (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES app.auth_user(id) ON DELETE CASCADE,
    token      text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_session_user_id_idx ON app.auth_session (user_id);

-- -- app.auth_account -------------------------------------------------------
-- One row per linked sign-in method. `access_token`/`refresh_token` are the GOOGLE LOGIN
-- tokens, held encrypted by Better Auth (account.encryptOAuthTokens). They are identity
-- scopes only: Gmail and Drive ingestion credentials are a different concern with different
-- cardinality and live sealed in app.connection_secret, keyed (tenant_id, source). Do not
-- reach for these to read a mailbox.
CREATE TABLE IF NOT EXISTS app.auth_account (
    id                       text PRIMARY KEY,
    user_id                  text NOT NULL REFERENCES app.auth_user(id) ON DELETE CASCADE,
    account_id               text NOT NULL,
    provider_id              text NOT NULL,
    access_token             text,
    refresh_token            text,
    access_token_expires_at  timestamptz,
    refresh_token_expires_at timestamptz,
    scope                    text,
    id_token                 text,
    password                 text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Better Auth recognises a provider-side identity by (provider_id, account_id).
CREATE UNIQUE INDEX IF NOT EXISTS auth_account_provider_account_idx
    ON app.auth_account (provider_id, account_id);
CREATE INDEX IF NOT EXISTS auth_account_user_id_idx ON app.auth_account (user_id);

-- -- app.auth_verification --------------------------------------------------
-- Short-lived challenges. The email-OTP plugin stores codes here, hashed (storeOTP:
-- "hashed"), which is the same stance app.invitation takes with token_sha256: a database
-- read must not yield something replayable.
CREATE TABLE IF NOT EXISTS app.auth_verification (
    id         text PRIMARY KEY,
    identifier text NOT NULL,
    value      text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_verification_identifier_idx
    ON app.auth_verification (identifier);

-- -- The join between the two identities ------------------------------------
-- Email is what links Better Auth's `auth_user` to our `app_user`, so it has to mean one
-- person. `app.app_user.email` is `text UNIQUE`, and that is case-SENSITIVE: without the
-- index below, `Ada@example.test` and `ada@example.test` can both exist while Better Auth
-- lowercases on write, and the join silently picks the wrong row -- a session whose tenant
-- list is mysteriously empty.
--
-- This will fail loudly if such a pair already exists, which is the correct outcome: a
-- duplicated identity is not something to index around.
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_uidx ON app.app_user (lower(email));

-- -- Grants ------------------------------------------------------------------
-- These are NOT optional and cannot be left to 040_grants.sql. That file's
-- `GRANT ... ON ALL TABLES IN SCHEMA app` is a one-shot snapshot -- Postgres expands it to
-- the tables that existed when it ran -- and the migration ledger means it never runs
-- again. Without the four grants below, every login fails with "permission denied for table
-- auth_user" while every existing test stays green.
--
-- undercroft_app only. The worker has no business in a session, and `040_grants.sql`
-- already REVOKEs the whole app schema from undercroft_bi and undercroft_dbt, so a
-- dashboard cannot read a login token. No ALTER DEFAULT PRIVILEGES here: there is exactly
-- one in this database and a gate test fails if a second appears.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    app.auth_user, app.auth_session, app.auth_account, app.auth_verification
    TO undercroft_app;

