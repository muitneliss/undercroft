-- A document keeps its last accepted kind while a new catalogue is being asked. ADR 0093.
--
-- `raw.document_kinds.accepted_kind` (400) is NULL for an answer given under a replaced
-- catalogue. That is right about what it says -- nothing has been confirmed under the new list
-- -- and wrong as the only column a model has: a publish re-asks every text over about a day,
-- and until each is re-asked its kind vanished from every dashboard built on the view. A tenant
-- who added one kind lost all of them for a day.
--
-- `last_accepted_kind` is the kind at 0.90 or above under WHICHEVER catalogue gave the answer:
-- the current one, or the one it replaced. It is not a guess about the new catalogue -- it is
-- what was said under the old one, and `current` and `version` beside it say so. A model that
-- wants only what the current catalogue confirmed keeps reading `accepted_kind`, unchanged; a
-- dashboard that must not go blank reads `last_accepted_kind` and shows `current = false` as old.
--
-- Appended as the LAST column, because `CREATE OR REPLACE VIEW` may only add columns at the end;
-- every other column is exactly 400's, so a model reading the view by name is untouched. The
-- grants 400 and `ops.provision_tenant` gave on the view survive a replace.

CREATE OR REPLACE VIEW raw.document_kinds WITH (security_invoker = true) AS
SELECT t.source,
       t.tenant_id,
       t.document_id,
       k.kind,
       k.confidence,
       CASE
           WHEN k.status = 'classified'
                AND k.confidence >= 0.90
                AND k.definition_hash = d.definition_hash
           THEN k.kind
       END AS accepted_kind,
       k.status,
       k.reason,
       k.version,
       COALESCE(k.definition_hash = d.definition_hash, false) AS current,
       k.classified_at,
       CASE
           WHEN k.status = 'classified' AND k.confidence >= 0.90
           THEN k.kind
       END AS last_accepted_kind
  FROM raw.document_text t
  JOIN raw.documents doc
    ON doc.source = t.source
   AND doc.tenant_id = t.tenant_id
   AND doc.document_id = t.document_id
   AND doc.deleted_at IS NULL
  JOIN raw.document_kind k
    ON k.tenant_id = t.tenant_id
   AND k.source_sha256 = t.source_sha256
  LEFT JOIN raw.document_kind_definition d
    ON d.tenant_id = t.tenant_id;
