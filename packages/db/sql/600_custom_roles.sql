-- A customer's own roles, and grants to a role or to one person, optionally until a moment.
-- ADR 0141, building on ADR 0139.
--
-- What a role lets someone do is still decided by Casbin in the control plane
-- (`apps/control-plane/src/services/rbac.ts`), over policy projected per request from these rows
-- and the built-in grants in code (`@undercroft/contracts/access`). These tables are the owners
-- of that policy; Casbin keeps none of it, and there is no `casbin_rule` table (ADR 0139).
--
-- ## app.access_role: every role a person can hold in a customer
--
-- Named `access_role` rather than `tenant_role`, which is taken: `ops.tenant_role` records each
-- customer's database LOGINS (`repeatable/010_provision_tenant.sql`), a different thing whose
-- name a reader would otherwise have to disambiguate by schema every time.
--
-- The four built-ins are ROWS here too, one set per customer, marked `builtin` and with
-- `permissions` NULL: their grants are code (`BUILT_IN_GRANTS`) and this table only says that the
-- key exists in the customer. That is what lets one foreign key, below, say "a role this
-- customer has" for a built-in and a custom key alike. The CHECKs tie the two kinds apart:
-- a built-in row is exactly one of the four keys and carries no permissions and no label, and
-- a custom row is never one of the four keys -- so a customer cannot define a role called
-- `admin` and have the last-admin guard, which is written on that literal, count its holders.
--
-- A key is a lowercase identifier and never contains `:`: Casbin subjects for a person are
-- `user:<uuid>`, so a role key can never be read as a person, nor a person as a role.
--
-- The built-in keys are written here in SQL, in the CHECK, the backfill and the trigger, and in
-- code as `BUILT_IN_ROLES`. `repos/accessRoles.test.ts` pins that the rows a new customer gets are
-- exactly that list, so a built-in added in code without a migration fails the gate.
--
-- `permissions` holds catalogue keys (`models:write`). The database cannot know the catalogue --
-- code owns it -- so a key the catalogue no longer has is kept here and projects NOTHING: the
-- projection asks Casbin only about catalogue permissions and lines a key it does not know are
-- never written (fail-closed, CLAUDE.md rule 2).
--
-- ## Role integrity: a foreign key, not a CHECK and not a read-then-write (ADR 0141)
--
-- `app.tenant_member.role` and `app.invitation.role` must name a role the customer has. A CHECK
-- cannot see another table, so PR 1's CHECKs (`590_tenant_roles.sql`) are replaced by a composite
-- foreign key onto `(tenant_id, key)`. The alternative, a service that checks the role exists
-- `FOR SHARE` before assigning and deletes with a guarded statement, binds only the code that
-- runs it -- `bun run invite` and any later writer would not -- and was rejected for that reason.
--
-- - `tenant_member`: NO ACTION. Deleting a role somebody holds is refused by the database,
--   atomically, whatever the service checked first. NO ACTION rather than RESTRICT because a
--   DELETE of a customer (`undoCreateTenant`) cascades to both tables, in the order Postgres
--   runs the cascades, and RESTRICT is checked the moment the role row goes -- whether it
--   passes would then depend on that order. NO ACTION is checked at the end of the statement,
--   after every cascade, and refuses a direct delete exactly as RESTRICT would.
--   `repos/accessRoles.test.ts` pins both: the held role refused, the customer deleted whole.
-- - `invitation`: ON DELETE CASCADE. An accepted or expired invitation is kept as history, and a
--   RESTRICT here would pin every role anyone was ever invited at, forever. The role's delete
--   statement refuses while an OPEN invitation names it (`repos/accessRoles.ts`); a closed one
--   goes with the role, its record kept in the audit log (`people.invite`,
--   `auth.invitationRedeemed`). If an invitation is sent in the instant a role is deleted, the
--   cascade removes it: the invitee is refused at sign-in, never admitted at a role that is gone.
--
-- Built-in rows for every customer: backfilled below for the ones that exist, and inserted by an
-- AFTER INSERT trigger for every later one, so `tenants.create`, `bun run invite --create-tenant`
-- and a test fixture that inserts `ops.tenant` directly all get them without knowing about this
-- table. The trigger runs as whoever inserted the tenant (SECURITY INVOKER), which is the
-- control plane or the bootstrap role, both of which may write here.
--
-- ## app.access_grant: one permission, to a role or a person, optionally until a moment
--
-- `subject_kind` says which; `role_key` or `user_id` is the subject, exactly one, so each gets
-- real referential integrity rather than a free-text `subject` column:
--
-- - a role grant references the role, and goes with it (ON DELETE CASCADE; the role's delete is
--   refused unless the deleter holds every permission granted to it, `repos/accessRoles.ts`);
-- - a person grant references their MEMBERSHIP, not their user: a grant to somebody who is no
--   member of the customer could never be exercised, and removing a person must remove what
--   they were granted, or re-inviting them a year later would quietly hand it back.
--
-- `object` and `action` are the Casbin request's own (`perm:models:write`, `use`), the shape
-- object grants will need (`model:orders`, `read`; ADR 0139's PR 3). This change accepts only
-- permission objects with `use`, and `access_grant_permission_only` says so in the database; the
-- change that widens it replaces that CHECK. The pattern admits no `*`, so no stored grant can be
-- a wildcard that Casbin's `keyMatch` would widen to every permission.
--
-- `expires_at` NULL is a standing grant. An expired grant is kept -- it is the record of what
-- someone held and when -- and projects nothing: `repos/membership.ts` compares it with `now()`
-- in the same statement that reads it, so there is no second clock to disagree with.
--
-- `access_grant_once` stores a grant once per subject, object and action, NULLS NOT DISTINCT
-- because one of `role_key` and `user_id` is always NULL. Saving it again moves its expiry.
--
-- ## Grants
--
-- The control plane owns both tables. The worker, dbt and BI get nothing: no build or report
-- reads who may do what, and BI is revoked `app` wholesale (`040_grants.sql`).

CREATE TABLE app.access_role (
    tenant_id   text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    key         text        NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$' AND length(key) <= 63),
    builtin     boolean     NOT NULL DEFAULT false,
    -- The customer's own name for the role, untranslated: it is tenant data, like a model's.
    label       text        CHECK (length(label) BETWEEN 1 AND 80),
    description text        NOT NULL DEFAULT '' CHECK (length(description) <= 500),
    permissions text[],
    -- The app_user who last saved it; NULL for a built-in, and once that person is gone.
    updated_by  uuid        REFERENCES app.app_user(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key),
    CONSTRAINT access_role_builtin_keys
        CHECK (builtin = (key IN ('viewer', 'member', 'builder', 'admin'))),
    CONSTRAINT access_role_builtin_grants_in_code CHECK (builtin = (permissions IS NULL)),
    CONSTRAINT access_role_custom_label CHECK (builtin = (label IS NULL))
);

INSERT INTO app.access_role (tenant_id, key, builtin)
SELECT t.id, b.key, true
FROM ops.tenant t
CROSS JOIN unnest(ARRAY['viewer', 'member', 'builder', 'admin']) AS b(key);

CREATE FUNCTION app.seed_builtin_roles() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO app.access_role (tenant_id, key, builtin)
    SELECT NEW.id, b.key, true
    FROM unnest(ARRAY['viewer', 'member', 'builder', 'admin']) AS b(key);
    RETURN NULL;
END;
$$;

CREATE TRIGGER tenant_builtin_roles
    AFTER INSERT ON ops.tenant
    FOR EACH ROW EXECUTE FUNCTION app.seed_builtin_roles();

-- PR 1's CHECKs, by the names `590_tenant_roles.sql` gave them, without IF EXISTS: a wrong name
-- must fail here rather than leave a CHECK naming four keys beside the key that replaces it,
-- which would refuse every custom role while this file reported success.
ALTER TABLE app.tenant_member DROP CONSTRAINT tenant_member_role_check;
ALTER TABLE app.tenant_member
    ADD CONSTRAINT tenant_member_role_exists
    FOREIGN KEY (tenant_id, role) REFERENCES app.access_role (tenant_id, key);

ALTER TABLE app.invitation DROP CONSTRAINT invitation_role_check;
ALTER TABLE app.invitation
    ADD CONSTRAINT invitation_role_exists
    FOREIGN KEY (tenant_id, role) REFERENCES app.access_role (tenant_id, key) ON DELETE CASCADE;

-- What the role's delete counts: who holds it and who is invited at it.
CREATE INDEX tenant_member_role ON app.tenant_member (tenant_id, role);
CREATE INDEX invitation_role ON app.invitation (tenant_id, role);

CREATE TABLE app.access_grant (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    text        NOT NULL REFERENCES ops.tenant(id) ON DELETE CASCADE,
    subject_kind text        NOT NULL CHECK (subject_kind IN ('role', 'user')),
    role_key     text,
    user_id      uuid,
    object       text        NOT NULL,
    action       text        NOT NULL,
    expires_at   timestamptz,
    granted_by   uuid        REFERENCES app.app_user(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT access_grant_one_subject CHECK (
        (subject_kind = 'role') = (role_key IS NOT NULL)
        AND (subject_kind = 'user') = (user_id IS NOT NULL)
    ),
    CONSTRAINT access_grant_permission_only
        CHECK (object ~ '^perm:[a-z]+:[a-z]+$' AND action = 'use'),
    CONSTRAINT access_grant_role_exists FOREIGN KEY (tenant_id, role_key)
        REFERENCES app.access_role (tenant_id, key) ON DELETE CASCADE,
    CONSTRAINT access_grant_member_exists FOREIGN KEY (tenant_id, user_id)
        REFERENCES app.tenant_member (tenant_id, user_id) ON DELETE CASCADE,
    CONSTRAINT access_grant_once
        UNIQUE NULLS NOT DISTINCT (tenant_id, subject_kind, role_key, user_id, object, action)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON app.access_role, app.access_grant TO undercroft_app;

-- No ALTER DEFAULT PRIVILEGES: none is written by hand anywhere (080_tenant_isolation.sql).
