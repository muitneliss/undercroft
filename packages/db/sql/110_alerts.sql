-- Alerts: what has to be recorded for a failure or an expiry to be emailed exactly once.
--
-- Nothing here is a queue. The control plane claims what to send with one UPDATE that
-- marks the row as handled and returns it, so two ticks -- or two replicas -- cannot both
-- send the same notice. What is stored is the outcome of the claim, never the email.
--
--   ops.run.notice              'sent' or 'suppressed', set with notified_at. A second
--                               failure of the same pair within a day of a sent notice is
--                               suppressed; a successful run in between resets that.
--   app.connection_secret       grant_expires_at is when the GRANT lapses -- Xero's sixty
--                               days unused -- as distinct from expires_at, which is the
--                               access token's hourly rotation. NULL where no provider
--                               tells us (Google, HubSpot), never a guess. warned_at is
--                               the claim; a new grant end clears it.
--   app.ingest_key.warned_at    the same claim for a key with an expiry.
--   app.app_user.locale         the language an alert to this person is written in.
--
-- No new grant: table-level grants cover a column added later. The control plane holds
-- UPDATE on every table in `app` and `ops`; the worker writes grant_expires_at through the
-- UPDATE on app.connection_secret it already has.

ALTER TABLE ops.run
    ADD COLUMN IF NOT EXISTS notice text CHECK (notice IN ('sent', 'suppressed'));

ALTER TABLE app.connection_secret
    ADD COLUMN IF NOT EXISTS grant_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS warned_at        timestamptz;

ALTER TABLE app.ingest_key
    ADD COLUMN IF NOT EXISTS warned_at timestamptz;

ALTER TABLE app.app_user
    ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi', 'en'));
