---
title: ADR 0101 A Spec Lands the Text a Person Wrote as a Document of Its Record
type: source
date: 2026-10-01
tags: []
source: >-
  docs/adr/0101-a-spec-lands-the-text-a-person-wrote-as-a-document-of-its-record.md
source_path: >-
  docs/adr/0101-a-spec-lands-the-text-a-person-wrote-as-a-document-of-its-record.md
source_hash: 3bffa1b5ed3b81ab4edad26d8cadf0a98e66575c945fc0722213a37ae49225d6
ingested: 2026-10-01
---

# ADR 0101 A Spec Lands the Text a Person Wrote as a Document of Its Record

A spec entity may declare which fields of a record are text a person wrote (`documents: [{ path, part, contentType }]`), and that text lands as a DOCUMENT of its record, never in its payload -- the rule [[ADR 0084 A Gmail Harvest Lands Each Messages Body]] set for a Gmail body, now held by any spec source. Issue #372: HubSpot notes, calls and tasks, whose `hs_note_body`, `hs_call_body` and `hs_task_body` must not reach `raw.records`, which `undercroft_app` reads and full-text indexes.

Decision. The connector runtime (`packages/connector-runtime/src/documents.ts`), which holds each record as `lossless-json` parsed it, removes each declared field BEFORE the record is canonicalised and hands the text on beside it (`RawRecordOut.documents`), whichever request asked for it -- the spec's query or a batch read a scope widened. Missing, `null` or empty yields no document; a non-text value fails the read. The worker (`apps/worker/src/services/specDocuments.ts`) lands each through the document sink as `<entity>:<record id>:<part>` (`notes:51:body`): no `/`, so a document key is never another's container, and the entity because HubSpot numbers each object type separately. `raw.documents.metadata` is `{ entity, sourceRecordId, part }`; the extract verb's HTML reader puts the text in `raw.document_text` ([[ADR 0024: A document's text is readable by dbt]]). An edited body is a new version under the same id and is extracted again. Documents are flushed before each entity saves its watermark, and a document that could not land fails the run and keeps the mark, so a client-filter read never skips a record whose text is missing; a size refusal is recorded and does not hold the mark; a stopped run drops held documents. One `documents` row counts them per run. A per-entity `neverRead` (name patterns, `*` wildcard) is left out of the HubSpot property picker and dropped from any saved scope ([[ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark]]); calls refuse `*recording*`, `*transcri*`, `*summary*`, all three activities `hs_body_preview*`, and the picker also leaves out document fields. HubSpot reads notes, calls, tasks, `call_dispositions` (outcome GUID to label, from the portal) and nine activity links, all under `crm.objects.contacts.read`. A deleted activity's record is marked removed ([[ADR 0071 A Record A Complete Listing No Longer Names Is Removed At Source]]); its document stays, and a model filters on the record.

Consequences: a model joins `raw.document_text.document_id` to `'<entity>:' || source_record_id || ':body'`; HubSpot text counts with mail bodies in the `:body` measurements and is classified by a tenant's document kinds; a body cleared in HubSpot keeps its last document; a changed body counts as New; declaring `documents` changes an entity's request key once. Rejected: the body in the payload, a HubSpot-specific collector in code ([[ADR 0015 A First-Party Collector for Byte Sources]] is for bytes, not JSON strings), stripping in the worker after canonicalisation, a separate read for the body, letting the run succeed with text missing, and a hardcoded table of outcome labels.
