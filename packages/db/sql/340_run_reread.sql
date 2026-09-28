-- ops.run_entity.reread / reread_documents: how many HELD records a run read again, and how many
-- documents that reading added to the lake. ADR 0076, #292.
--
-- A Gmail run now reads a message it already holds when that message carries an attachment the
-- current file-type choice allows and no earlier read landed -- after a type is added, after an
-- upgrade admits a new spelling, and once for every message marked before the harvest recorded
-- what it left behind. That is work a person should be able to see was done, and see the result
-- of, on the run itself: `runs get` answers from this row, over the CLI and MCP alike.
--
-- NULL, NOT 0, FOR A RUN THAT DID NOT SAY. Every run before this column, every spec run, every
-- Drive run and every `documents` row has nothing to report here, and a 0 would claim it looked
-- and found nothing. A Gmail run's `messages` row says 0 when it re-read nothing.

ALTER TABLE ops.run_entity
    ADD COLUMN IF NOT EXISTS reread           integer,
    ADD COLUMN IF NOT EXISTS reread_documents integer;

-- NO NEW GRANT: `090_runs.sql` grants `ops.run_entity` at table level, to the worker that writes
-- it and the control plane that reads it, and a table-level grant covers a column added later.
