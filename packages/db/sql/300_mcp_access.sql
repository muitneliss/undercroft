-- app.access_token: a person's own credential for a door that cannot hold a cookie. ADR 0060.
--
-- An agent outside the browser -- a model-context client at `/mcp` -- presents
-- `Authorization: Bearer upat_<id>.<secret>`. The token belongs to a PERSON, not to a tenant
-- and not to a service: it reaches exactly what its owner reaches, through the same role gates,
-- in every tenant they belong to. It is not the service token ADR 0044 rejected; that would be
-- a credential with nobody behind it. This one has somebody behind it, and dies with them:
-- `ON DELETE CASCADE` from `app.app_user`, and the control plane re-resolves the owner's
-- `app_user` on every request, so removing a person's access removes their tokens' at once.
--
-- WHAT IS STORED. The sha-256 of the whole token, never the token: it is shown once, when it is
-- minted, the way an ingest key is (`120_ingest_keys.sql`). The `upat_<8>` id is a prefix so a
-- token seen in a config file can be matched to its row by eye; it is not part of the lookup.
--
-- THE GRANT. `scope` is what the person chose when minting it: `read` lists and runs only what
-- `handlers/surface.ts` classifies as a read, `write` everything their role allows. The column
-- is `scope` because `grant` is an SQL keyword; the repo maps it to `grant` and nothing above
-- the repo knows the column name.
--
-- EXPIRY IS REQUIRED, AND A YEAR AT MOST. A credential that never expires is one nobody
-- remembers minting. The ceiling is a CHECK rather than only the form's options, because a
-- form is one caller and the table is the rule; `expires_at` is computed in the INSERT from
-- the database's own clock, so the check and the value read one clock.
--
-- `last_used_at` is written at most once a minute per token, by the UPDATE's own WHERE clause
-- (`repos/accessToken.ts`) -- a guard in SQL rather than in a process's memory, so two control
-- planes cannot each think they are the first to note a use.

CREATE TABLE IF NOT EXISTS app.access_token (
    id           text        PRIMARY KEY CHECK (id ~ '^upat_[A-Za-z0-9_-]{8}$'),
    token_sha256 char(64)    NOT NULL UNIQUE,
    user_id      uuid        NOT NULL REFERENCES app.app_user(id) ON DELETE CASCADE,
    label        text        NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    scope        text        NOT NULL CHECK (scope IN ('read', 'write')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz,
    last_used_at timestamptz,
    CONSTRAINT access_token_expiry_bounded CHECK (
        expires_at > created_at AND expires_at <= created_at + interval '365 days'
    )
);

-- The account page lists one person's tokens, newest first; admission reads by digest, which
-- the UNIQUE above already indexes.
CREATE INDEX IF NOT EXISTS access_token_user_idx ON app.access_token (user_id, created_at DESC);

-- -- grants -------------------------------------------------------------------------------
-- In this file, for the reason `privileges.md` gives: 040's `ON ALL TABLES IN SCHEMA app` was
-- expanded against the tables that existed when it ran, so a table added later has NO grants
-- and the symptom is "permission denied for table" at the first sign-in with the suite green.
GRANT SELECT, INSERT, UPDATE, DELETE ON app.access_token TO undercroft_app;

-- Nothing for `undercroft_worker`: it never admits a person's token -- the lake write API takes
-- ingest keys, which are a tenant's, not a person's. Nothing for any dbt or BI role either: they
-- have no USAGE on `app` at all (040). Stated rather than omitted, so adding a grant here means
-- contradicting a sentence.

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).
