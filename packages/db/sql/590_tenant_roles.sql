-- A person may hold `builder` in a customer, and be invited at it. ADR 0139.
--
-- `builder` saves, builds and previews models, macros and reference tables and reads the raw
-- lake, without the people, the sources, the keys or the customer itself (issue 481). What a
-- role lets someone do is not stored here or anywhere in the database: it is the control
-- plane's permission catalogue, evaluated by Casbin over policy projected from these rows
-- (`apps/control-plane/src/services/rbac.ts`). The column stores which role a person holds,
-- and this CHECK is what keeps that a role the catalogue knows.
--
-- A CHECK rather than validation in the service alone, and fail-closed: the zod enum at the
-- router refuses an unknown role first, but `bun run invite` and any later writer reach the
-- same columns, and a row holding a key no policy grants would be a member with nothing --
-- or, the day a policy line used a typo'd key, one with something nobody meant. PR 2 replaces
-- this CHECK with a reference to the customer's own roles; until then it names the four.
--
-- The inline CHECKs of `020_control_plane.sql` are named by Postgres's own rule,
-- `<table>_<column>_check` -- verified against `pg_constraint` -- and dropped WITHOUT
-- `IF EXISTS`: a wrong name must fail this migration rather than leave the old CHECK standing
-- beside the new one, which would refuse every builder while the file reported success. The
-- whole file is one implicit transaction, so no moment exists with no CHECK at all.
--
-- The last-admin guard (`repos/membership.ts`) and `listAdmins` are written on the literal
-- `'admin'` and are unchanged: `builder` is never counted as an admin.
--
-- No grant moves: both tables keep the grants `040_grants.sql` gave them.

ALTER TABLE app.tenant_member DROP CONSTRAINT tenant_member_role_check;
ALTER TABLE app.tenant_member
    ADD CONSTRAINT tenant_member_role_check
    CHECK (role IN ('viewer', 'member', 'builder', 'admin'));

ALTER TABLE app.invitation DROP CONSTRAINT invitation_role_check;
ALTER TABLE app.invitation
    ADD CONSTRAINT invitation_role_check
    CHECK (role IN ('viewer', 'member', 'builder', 'admin'));
