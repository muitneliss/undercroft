-- A document keeps its name, its link and the record of its bytes' purge; its bytes do not
-- outlive the extract pass. ADR 0161.
--
-- THE OWNER'S DECISION. A document's file lives in the customer's own Drive or mailbox. Once it
-- has been landed and the extract pass has had its attempt at it -- read it, or refused it with a
-- reason -- its bytes are deleted from the lake, and what stays is this row: the file's name,
-- where it lives at the source, when it changed there (`metadata.sourceUpdatedAt`) and when we
-- saw it (`observed_at`), and the record of the purge below. A person traces a document back to
-- its source with these; nothing here can be read again from the lake.
--
-- WHAT THIS REVERSES, ON PURPOSE. ADR 0015 and `pii.md` kept every name a human wrote out of
-- this table, because `raw.documents` is granted to every tenant's dbt login and so is one model
-- from a dashboard. `file_name` puts the file's name here, readable by dbt and so by whatever a
-- customer builds on it. That is the decision, made knowing it, and ADR 0161 supersedes 0015 on
-- it. A mail's subject and addresses are still NOT here: the decision was the file's name.
--
-- `file_name`: what the source calls the file -- a Drive file's name, an attachment's filename, a
-- member's path inside its archive. NULL where the source gives a document none (a mail's body, a
-- HubSpot note) or a landing from before this column that the operator's backfill has not
-- reached: never a guessed one.
--
-- `source_url`: where a person opens it at the source. A Drive file's `/file/d/<id>/view`, a
-- message's `#all/<messageId>`, an archive member's archive's link. NULL where no link can be
-- derived from what we hold -- a HubSpot record's link needs the portal id, which no landing
-- carries -- and never a constructed guess.
--
-- `bytes_purged_at`, `bytes_purge_outcome`, `bytes_purge_report`: set together or not at all.
-- The outcome is `deleted` (the blob was there and is gone) or `absent` (it was already gone when
-- the purge came for it -- a purge cut off between the delete and this write, finished by the
-- next). The report is the lake key of the `_reports/document-bytes-purge/` object the purge
-- wrote before it deleted anything, which names every digest it set out to remove and the run or
-- the operator that did it. They are cleared when the document lands NEW bytes, which are in the
-- lake again until their own extraction is attempted.
--
-- NO GRANT. `raw.documents` is granted at table level -- SELECT, INSERT, UPDATE to the worker
-- (040), SELECT to the control plane (130) and to every tenant's dbt login
-- (`repeatable/010_provision_tenant.sql`) -- and a table-level grant covers a column added after
-- it. That is the point for `file_name`, not an accident of it.
ALTER TABLE raw.documents
    ADD COLUMN IF NOT EXISTS file_name           text,
    ADD COLUMN IF NOT EXISTS source_url          text,
    ADD COLUMN IF NOT EXISTS bytes_purged_at     timestamptz,
    ADD COLUMN IF NOT EXISTS bytes_purge_outcome text,
    ADD COLUMN IF NOT EXISTS bytes_purge_report  text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_purge_outcome') THEN
        ALTER TABLE raw.documents ADD CONSTRAINT documents_purge_outcome
            CHECK (bytes_purge_outcome IN ('deleted', 'absent'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'documents_purge_whole') THEN
        ALTER TABLE raw.documents ADD CONSTRAINT documents_purge_whole
            CHECK ((bytes_purged_at IS NULL) = (bytes_purge_outcome IS NULL)
               AND (bytes_purged_at IS NULL) = (bytes_purge_report IS NULL));
    END IF;
END
$$;

-- "Which documents still hold these bytes, in any tenant?" -- the question the purge asks of
-- every digest before it deletes one, because a blob is shared by content across documents,
-- sources and tenants. `documents_digest` (250) leads with the source and the tenant and cannot
-- answer it. Partial, because only a document whose bytes are still held can stop a purge, and
-- once the backlog is purged that is the few documents the extract pass has not reached.
CREATE INDEX IF NOT EXISTS documents_held_digest
    ON raw.documents (sha256) WHERE bytes_purged_at IS NULL;
