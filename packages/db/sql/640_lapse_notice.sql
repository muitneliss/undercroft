-- A lapsed grant is told to its customer's admins, once per lapse. ADR 0150.
--
-- When a provider refuses a grant (Google's invalid_grant, a Xero refresh token gone unused)
-- the worker marks `ops.connection.status = 'expired'` and the card asks for a reconnect -- but
-- an admin who does not open the card is never told. The alert tick now emails them, claiming
-- each lapse with one UPDATE that marks and returns, like every other notice (110_alerts.sql).
--
--   app.connection_secret.lapse_told_at   when the admins were told this grant had lapsed.
--                                         NULL is "not told", which is every row the day this
--                                         ships: a connection already lapsed is told once on
--                                         the first tick, deliberately -- nobody was told
--                                         before. `writeCredential` clears it when it writes a
--                                         credential for a connection that is no longer
--                                         lapsed, which is what a reconnect is, so the next
--                                         lapse is told again.
--
-- On the secret's table, not on ops.connection: BI holds SELECT on ops.connection, and a
-- table-level grant reaches a column added later. When an admin was emailed is the platform's
-- own bookkeeping, not a customer's data.
--
-- No new grant, for the reason 110 gives: the control plane holds SELECT and UPDATE on every
-- table in `app`, and the worker writes the column through the UPDATE on app.connection_secret
-- it already has (040_grants.sql, 070_google_ingestion.sql).

ALTER TABLE app.connection_secret
    ADD COLUMN IF NOT EXISTS lapse_told_at timestamptz;
