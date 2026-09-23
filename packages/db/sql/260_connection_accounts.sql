-- app.oauth_handshake.adds_account: whether a consent ADDS an account, or (re)connects one.
--
-- A tenant may hold several accounts of one kind -- two Gmail mailboxes -- and each further
-- account is a source of its own, `gmail.<account key>`. ADR 0043. Two consents look identical
-- on the wire: "Reconnect" on the first mailbox and "Add another account" both start from the
-- bare `gmail`. They must not be resolved alike. A reconnect names the account it expects, and
-- a different Google account arriving at its callback is REFUSED -- otherwise the other
-- mailbox's mail is filed under this one's stream, green, with nothing erroring. An add names
-- no account, and whichever one consented gets a source of its own. Only the admin's click
-- knows which was meant, so the handshake records it.
--
-- A column rather than a second value squeezed into `source`: a source that meant "the kind,
-- but adding" would be a string that is a source everywhere except in this one table.
--
-- `false` by default, which is what every in-flight handshake written before this column means:
-- they were all started by a Connect or Reconnect button, because no other button existed.

ALTER TABLE app.oauth_handshake
    ADD COLUMN IF NOT EXISTS adds_account boolean NOT NULL DEFAULT false;

-- NO NEW GRANT. `070_google_ingestion.sql` grants `SELECT, INSERT, UPDATE, DELETE ON
-- app.oauth_handshake TO undercroft_app` at table level, and in Postgres a table-level privilege
-- covers every column, including one added later. The same finding, for the same reason, as
-- `230_documents_landed.sql`; `packages/db/src/privileges.test.ts` and the control plane's
-- suites, which `become` `undercroft_app`, are what keep that from being wishful.
