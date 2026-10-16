-- Object grants: a role or a person given to READ one model, one raw stream, one report -- or
-- the whole of one of them. ADR 0142, the third of the four changes ADR 0139 planned.
--
-- ## What a grant may name now
--
-- `access_grant_permission_only` (600) admitted only `perm:<permission>` with `use`. It is
-- replaced by `access_grant_object_shape`, which admits that AND the three object forms, each
-- with `read`:
--
--   model:<name>             a model or a reference table, by name; `model:*` is every one
--   raw:<source>/<entity>    one raw stream; `raw:<source>/*` a whole source; `raw:*` the lake
--   report:question:<uuid>   one saved question; `report:dashboard:<uuid>` one dashboard;
--                            `report:*` every report
--
-- The patterns are the ones `parseReachObject` reads in `@undercroft/contracts/access`, and they
-- say the same thing the projection relies on: a `*` stands only where it means "the whole of",
-- and never inside a name. Casbin's `keyMatch` reads a `*` in a policy object as "anything from
-- here on", so a stored `model:fct_*` would have been a grant on every model starting `fct_` that
-- nobody wrote. A model's name is `MODEL_NAME`'s grammar; a source is a source instance (ADR 0043:
-- `gmail` or `gmail.<12 hex>`), which is why the separator is `/` and not `.` -- `raw:gmail.*`
-- would have reached the customer's every mailbox; an entity is anything but `*` and a control
-- character, at most the 128 characters `lake.records` takes. A uuid is lowercase, as Postgres
-- prints one, so the grant and the row it names compare as text.
--
-- The old CHECK is dropped by its name, without IF EXISTS: a wrong name must fail here rather
-- than leave the narrow CHECK beside the wide one, which would refuse every object grant while
-- this file reported success.
--
-- ## A custom role keeps what it reached
--
-- From this change a customer's own role reaches only the objects granted to it; the four
-- built-ins still reach the whole customer, in code (`BUILT_IN_POLICY` in `rbac.ts`). Until now
-- every role reached everything, so a role defined before this change is given `model:*`,
-- `raw:*` and `report:*` here -- what it already had -- rather than losing every model, stream
-- and report at the deploy. A customer narrows it by deleting those grants. Granted by nobody
-- (NULL): no person made this grant.
--
-- ## A grant goes with what it names
--
-- A grant on a model, a reference table, a question or a dashboard is deleted with the row it
-- names, by an AFTER DELETE trigger on each table -- in the database, for the reason ADR 0141
-- gives for foreign keys: it binds every writer, not only the service that remembers to. Names
-- are reused (a model deleted today and a new one saved tomorrow under the same name are
-- different things), and a grant that outlived its model would hand the new one to whoever held
-- the old. The projection refuses a dangling one as well (`repos/membership.ts`), for the grant
-- saved in the instant its object was deleted. A raw grant is never cascaded: a stream is not a
-- row the customer deletes, and a grant on a source that has not landed yet is how an admin
-- prepares a connection.

ALTER TABLE app.access_grant DROP CONSTRAINT access_grant_permission_only;
ALTER TABLE app.access_grant
    ADD CONSTRAINT access_grant_object_shape CHECK (
        (object ~ '^perm:[a-z]+:[a-z]+$' AND action = 'use')
        OR (action = 'read' AND (
            object ~ '^model:(\*|[a-z][a-z0-9_]{0,62})$'
            OR object ~ '^raw:(\*|[a-z][a-z0-9_-]{0,63}(\.[0-9a-f]{12})?/(\*|[^*[:cntrl:]]{1,128}))$'
            OR object ~ '^report:(\*|(question|dashboard):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'
        ))
    );

INSERT INTO app.access_grant (tenant_id, subject_kind, role_key, object, action)
SELECT r.tenant_id, 'role', r.key, w.object, 'read'
FROM app.access_role r
CROSS JOIN unnest(ARRAY['model:*', 'raw:*', 'report:*']) AS w(object)
WHERE NOT r.builtin
ON CONFLICT ON CONSTRAINT access_grant_once DO NOTHING;

-- The grants on one object, by tenant and object: what the cascade below deletes.
CREATE INDEX access_grant_object ON app.access_grant (tenant_id, object);

-- SECURITY INVOKER: whoever deletes the model or the report deletes its grants, and that is the
-- control plane (or a customer's own deletion, cascading from `ops.tenant`), which owns both.
-- One branch per table rather than one CASE: a model row has no `id` and a report row's `name`
-- is not its object, and PL/pgSQL prepares only the branch it runs.
CREATE FUNCTION app.drop_object_grants() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_object text;
BEGIN
    IF TG_TABLE_NAME IN ('model', 'seed') THEN
        v_object := 'model:' || OLD.name;
    ELSIF TG_TABLE_NAME = 'bi_question' THEN
        v_object := 'report:question:' || OLD.id::text;
    ELSE
        v_object := 'report:dashboard:' || OLD.id::text;
    END IF;
    DELETE FROM app.access_grant WHERE tenant_id = OLD.tenant_id AND object = v_object;
    RETURN NULL;
END;
$$;

CREATE TRIGGER model_grants_follow
    AFTER DELETE ON app.model FOR EACH ROW EXECUTE FUNCTION app.drop_object_grants();
CREATE TRIGGER seed_grants_follow
    AFTER DELETE ON app.seed FOR EACH ROW EXECUTE FUNCTION app.drop_object_grants();
CREATE TRIGGER question_grants_follow
    AFTER DELETE ON app.bi_question FOR EACH ROW EXECUTE FUNCTION app.drop_object_grants();
CREATE TRIGGER dashboard_grants_follow
    AFTER DELETE ON app.bi_dashboard FOR EACH ROW EXECUTE FUNCTION app.drop_object_grants();

-- ## An export runs under the reach of the person who asked for it
--
-- The models the asker reached when they asked, NULL for every model: the download runs under
-- that, narrowed by what they reach at the moment they download it (`services/biExports.ts`).
ALTER TABLE app.bi_export ADD COLUMN scope_models text[];
