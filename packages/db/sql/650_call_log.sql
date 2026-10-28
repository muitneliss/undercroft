-- ops.call_log: an agent's call kept whole -- what it sent, what it was answered, how it broke --
-- for a platform superadmin, for 30 days. ADR 0151.
--
-- The audit log (ADR 0113, 0120) says who called what and how it ended, and copies nothing of a
-- call's input: its reader is a customer's admin, and it is kept for ever. This table is the
-- other half, for debugging an agent: the request, the answer and the error's real cause. So it
-- is its own table, not `audit_log.detail`:
--
--   - only a platform superadmin reads it (`audit.calls`, `audit.call`), never a customer's
--     admin, and a superadmin already holds admin in every customer (ADR 0013);
--   - only the agent doors write it (cli, mcp, assistant): the browser polls, and its reads
--     would bury an agent's (ADR 0120's reason);
--   - it is bounded: a request and a response are each cut at 256 KB (`*_truncated`, with the
--     whole size in `*_bytes`), and a row older than 30 days is deleted;
--   - an answer carrying a customer's rows or document text is kept as its SHAPE only --
--     columns, a count, the notes beside them -- never a cell (`response_kept = 'shape'`). The
--     control plane's login is denied `raw.document_text.text` and every analytics and dq
--     schema (ADR 0026 section 3, 180_document_text.sql, `.claude/rules/pii.md`), and a copy here
--     would be that grant by another name.
--
-- No foreign key to anything: a row outlives a person removed, a token revoked, a customer
-- deactivated, and a superadmin reading why a call failed must still see who made it. `actor` is
-- the address as it was, as in the audit log. `tenant_id` is the tenant the call NAMED, as sent:
-- this table is not the audit log, and no customer's admin reads it, so it is not attributed.

CREATE TABLE IF NOT EXISTS ops.call_log (
    id                  bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                  timestamptz NOT NULL DEFAULT now(),
    -- Joins this row to its spans and log lines (ADR 0058): `task obs:trace TRACE=<trace_id>`.
    trace_id            text,
    tenant_id           text,
    user_id             uuid,
    actor               text,
    channel             text        NOT NULL,
    -- A bearer credential's id (`upat_...`, `oauth:<client>`), never the token; NULL for a session.
    credential          text,
    path                text        NOT NULL,
    type                text        NOT NULL,
    outcome             text        NOT NULL,
    reason              text,
    duration_ms         integer,
    request             text,
    request_bytes       integer,
    request_truncated   boolean     NOT NULL DEFAULT false,
    -- 'whole', 'shape' (no cell, ADR 0151) or 'none' (an answer that is itself this log).
    response_kept       text        NOT NULL,
    response            text,
    response_bytes      integer,
    response_truncated  boolean     NOT NULL DEFAULT false,
    error               jsonb,
    CONSTRAINT call_log_channel_agent CHECK (channel IN ('cli', 'mcp', 'assistant')),
    CONSTRAINT call_log_type_known CHECK (type IN ('query', 'mutation')),
    CONSTRAINT call_log_outcome_known CHECK (outcome IN ('ok', 'refused', 'failed')),
    CONSTRAINT call_log_response_kept_known CHECK (response_kept IN ('whole', 'shape', 'none'))
);

-- The retention sweep, and the three ways a superadmin narrows the list: by person, by customer.
CREATE INDEX IF NOT EXISTS call_log_at_idx ON ops.call_log (at);
CREATE INDEX IF NOT EXISTS call_log_user_idx ON ops.call_log (user_id, id DESC);
CREATE INDEX IF NOT EXISTS call_log_tenant_idx ON ops.call_log (tenant_id, id DESC);

-- -- grants -------------------------------------------------------------------------------
-- In this file, because `040_grants.sql`'s `ON ALL TABLES IN SCHEMA ops` reached only the tables
-- that existed when it ran (`privileges.md`). The control plane writes a row, reads it back for a
-- superadmin, and deletes it when it is 30 days old; it never changes one. Nothing for the worker,
-- dbt or BI: BI holds USAGE on `ops` (040) for `ops.run`, and a table-level grant here is all that
-- would stand between a dashboard and an agent's requests.
REVOKE ALL ON ops.call_log FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON ops.call_log TO undercroft_app;
