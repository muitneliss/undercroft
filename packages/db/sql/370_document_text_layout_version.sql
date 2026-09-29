-- Which GENERATION OF LAYOUTS a row of text was written in -- the thing that lets a reading be
-- laid out again from what it already holds, without the bytes being read again. ADR 0081, #313.
--
-- `reader_version` (240) answers "could a newer reader open this refused document?" and so
-- re-queues REFUSALS only: a row that was READ never re-enters the backlog, because a cheap
-- re-run overwriting good text is the worst extraction bug on record. That leaves no way to
-- reach a text that was read correctly but LAID OUT under an older table -- an ACRA Business
-- Profile read as unwrapped `data` before its template was known. Deleting the rows instead, as
-- 350 does, would re-read them from the lake, and an OpenAttestation re-read re-verifies over
-- DNS: a lookup that failed that hour would swap 418 verified texts for refusals.
--
-- So each text is stamped with the layout generation it was written in
-- (`ACRA_LAYOUT_VERSION`, beside the template table in
-- `apps/worker/src/services/extract/acraTemplates.ts`), and an extract run offers the texts of
-- a re-layable method stamped older than that. Each is laid out again from its own verified
-- data, and every one offered is stamped current whether its text changed or not -- which is
-- what makes a raised generation reach each row exactly once, rather than a scheduler ticking
-- for ever over a document from another issuer that will never become a profile.
--
-- DEFAULT 0, NOT NULL, for the reason 240 gives: every row written before this column sorts
-- below every generation and is looked at once, never skipped as a NULL.

ALTER TABLE raw.document_text
    ADD COLUMN IF NOT EXISTS layout_version integer NOT NULL DEFAULT 0;

-- NO GRANT, for the reason 240 records in full: a column added later falls back to the
-- relation's table-level privileges, so the worker writes it and the dbt roles read it under
-- `180_document_text.sql`'s grants already, and `undercroft_app`'s column-scoped SELECT does
-- not extend to it -- which is correct, since the control plane has no question to put to it.
