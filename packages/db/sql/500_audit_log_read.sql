-- ops.audit_log becomes something people read. ADR 0112.
--
-- WHAT IS ADDED. Who acted, by id as well as address (`user_id`); how it ended (`outcome`, and
-- `reason` for an attempt that did not succeed); and the door it came through (`channel`, and
-- `credential`, a bearer token's id). All nullable except `outcome`, because every row written
-- before this file has none of them, and a value invented for an old row would be a guess.
--
-- `user_id` has no foreign key: an audit row outlives the person it names, and a cascade that
-- deleted a removed person's history would delete the evidence the trail exists to keep.

ALTER TABLE ops.audit_log
    ADD COLUMN IF NOT EXISTS user_id    uuid,
    ADD COLUMN IF NOT EXISTS outcome    text NOT NULL DEFAULT 'ok',
    ADD COLUMN IF NOT EXISTS reason     text,
    ADD COLUMN IF NOT EXISTS channel    text,
    ADD COLUMN IF NOT EXISTS credential text;

ALTER TABLE ops.audit_log DROP CONSTRAINT IF EXISTS audit_log_outcome_known;
ALTER TABLE ops.audit_log ADD CONSTRAINT audit_log_outcome_known
    CHECK (outcome IN ('ok', 'refused', 'failed'));
ALTER TABLE ops.audit_log DROP CONSTRAINT IF EXISTS audit_log_channel_known;
ALTER TABLE ops.audit_log ADD CONSTRAINT audit_log_channel_known
    CHECK (channel IS NULL OR channel IN ('web', 'cli', 'mcp', 'assistant'));

-- The rows written before this file named the actor by address only. An address names exactly one
-- app_user (`email` is UNIQUE), so the match is exact, not a guess; a row whose address matches
-- nobody -- a refused sign-in, a person since deleted -- keeps a NULL `user_id`.
UPDATE ops.audit_log a
   SET user_id = u.id
  FROM app.app_user u
 WHERE a.user_id IS NULL
   AND u.email = a.actor
   AND a.action <> 'auth.refused';

-- Action names become the router's procedure paths, so one key labels a row in every language.
-- A connection sealed from a pasted token was `connection.connected` with `method: token`; the
-- OAuth callback's seal keeps the name `connections.connected`, since no procedure does it.
UPDATE ops.audit_log SET action = 'connections.setToken'
 WHERE action = 'connection.connected' AND detail ->> 'method' = 'token';
UPDATE ops.audit_log SET action = CASE action
        WHEN 'bi.question.save'        THEN 'bi.questions.save'
        WHEN 'bi.question.delete'      THEN 'bi.questions.delete'
        WHEN 'bi.dashboard.save'       THEN 'bi.dashboards.save'
        WHEN 'bi.dashboard.delete'     THEN 'bi.dashboards.delete'
        WHEN 'bi.export.create'        THEN 'bi.exports.create'
        WHEN 'connection.cadence_set'  THEN 'connections.setCadence'
        WHEN 'connection.resync_set'   THEN 'connections.setResync'
        WHEN 'connection.scope_set'    THEN 'connections.setScope'
        WHEN 'connection.connected'    THEN 'connections.connected'
        WHEN 'connection.disconnected' THEN 'connections.disconnect'
        WHEN 'people.remove'           THEN 'people.removeMember'
    END
 WHERE action IN (
        'bi.question.save', 'bi.question.delete', 'bi.dashboard.save', 'bi.dashboard.delete',
        'bi.export.create', 'connection.cadence_set', 'connection.resync_set',
        'connection.scope_set', 'connection.connected', 'connection.disconnected', 'people.remove'
    );

-- The three readers: a tenant's admin, a person, a superadmin. Each pages newest first by id.
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON ops.audit_log (tenant_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON ops.audit_log (user_id, id DESC);

-- -- grants -------------------------------------------------------------------------------
-- Append-only in the database, not only by convention. 040 granted the control plane the whole
-- DML on every table in `ops`; it never needed to change or delete an audit row, and a trail its
-- own writer can edit is a story, not evidence. The worker keeps the INSERT 040 gave it.
REVOKE UPDATE, DELETE, TRUNCATE ON ops.audit_log FROM undercroft_app;
