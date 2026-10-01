# 101. A spec lands the text a person wrote as a document of its record

- Status: Accepted
- Date: 2026-10-01
- Extends: [ADR 0084](0084-a-gmail-harvest-lands-each-messages-body.md), whose rule that a body
  is a document of its message and never a field of its record now holds for a spec source too;
  [ADR 0024](0024-extracted-text-is-readable-by-dbt.md), whose `raw.document_text` is where that
  text is read; and [ADR 0052](0052-a-hubspot-scope-adds-to-the-specs-properties.md), whose scope can
  no longer ask for a field the spec says is never read.
- Issue: [#372](https://github.com/muitneliss/undercroft/issues/372), HubSpot notes, calls and
  tasks.

## Context

HubSpot's notes, calls and tasks are what a team logs on a company, contact or deal. Each has
fields a model needs -- times, owners, a call's outcome, a task's status and due date -- and one
field of free text: `hs_note_body`, `hs_call_body`, `hs_task_body`, up to 65,536 characters of
what a person wrote about a customer.

The HubSpot connector is a spec, read by the generic runtime, and everything a spec reads lands in
the record's payload in `raw.records`. That table is granted to `undercroft_app` and full-text
indexed. ADR 0084 refused to put a Gmail body there for exactly that reason, and put it in the
lake as a document whose text reaches Postgres only in `raw.document_text`, which a tenant's own
dbt may read and the control plane and BI may not. The same text from HubSpot deserves the same
place.

Calls also carry a recording URL and, on some portals, a transcript and a summary made from it.
The issue says never to read either. A scope (ADR 0052) lists every property an object has, so an
admin could tick one of them.

## Decision

1. **A spec entity may declare which fields are text a person wrote** (`documents: [{ path,
part, contentType }]`). The runtime, which holds each record as it was parsed without loss,
   removes each declared field from the record BEFORE it is canonicalised, and hands the text on
   beside the record. The payload that is hashed, landed and projected therefore never held the
   text, whichever request asked for it -- the spec's own query or a batch read a scope widened.
   A missing, `null` or empty field yields no document; a value that is not text fails the read,
   because the spec named the wrong field.
2. **The worker lands each one through the document sink**, as a Gmail body lands: bytes in the
   lake (create-only, content-addressed), an opaque row in `raw.documents` whose metadata is
   `{ entity, sourceRecordId, part }`, and nothing in the manifest. The document's id is
   `<entity>:<record id>:<part>` -- `notes:51:body`. The entity is in it because HubSpot numbers
   each object type separately, and there is no `/` in it so that a document key is never the
   container of another. The extract verb's HTML reader turns it into `raw.document_text`, and an
   edited body lands under the same id as a new version, which the extract verb reads again
   because its digest changed.
3. **A document must be down before its entity's watermark moves.** Under a client-filter
   watermark an unchanged record is never offered again, so a mark saved past a record whose text
   failed to land would lose that text for good. The documents of a run share one sink, flushed
   before each entity saves its mark; if any could not be landed the run fails with its counts,
   and the mark stays where it was. A document over the 25 MiB ceiling is a recorded refusal, as
   everywhere, and does not hold the mark. A stopped run (ADR 0051) drops the documents it holds,
   which loses nothing because no mark moved past them. The run counts them in one `documents`
   row, as the Google path does.
4. **A spec entity may declare field names that are never read** (`neverRead`, with `*` for any
   run of characters). The scope listing leaves them out and a run drops them from whatever a
   scope chose -- the CLI and MCP can write a scope too, and a name chosen before the spec refused
   it stays in a saved one. The picker also leaves out the fields that land as documents, which
   no record holds. HubSpot's calls refuse `*recording*`, `*transcri*` and `*summary*`; all three
   activities refuse `hs_body_preview*`, which are copies of the body's text. No transcript API is
   called.
5. **HubSpot reads notes, calls and tasks** with their links to companies, contacts and deals and
   with `call_dispositions`, the portal's own table of what each outcome GUID means. All three are
   read under `crm.objects.contacts.read`, as HubSpot's reference says; there is no scope of their
   own. HubSpot names no scope for the dispositions endpoint, and the spec reads it under the same
   one.
6. **A deleted activity's text stays.** The record is marked removed at source like any other
   (ADR 0071); its document is not, and a model that wants live activities only joins the text to
   the record by document id and keeps the records that are not removed.

## Consequences

- A tenant's dbt reads an activity's text by joining `raw.document_text.document_id` to
  `'<entity>:' || source_record_id || ':body'`. The body is HTML, read to text by the extract verb;
  the lake keeps HubSpot's HTML exactly.
- `documentText.ts` already tells bodies from files by the `:body` ending, so HubSpot's activity
  text counts with Gmail's bodies in the semantic measurements.
- A body that is cleared in HubSpot leaves the last text it had. The record changes and no document
  is offered for it, because there is nothing to land, and landing an empty document for every
  activity without a body would be a catalogue row and an extraction each for nothing. Nothing in
  the lake says the body is gone, so a model shows the old text; saying so is left for later.
- A tenant with a catalogue of document kinds
  ([ADR 0085](0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md)) has each
  activity's text classified like any document with text, once per distinct text, as a Gmail body
  already is. A portal with many logged activities adds that many questions on its first run.
- A changed body is counted as New on `documents`, not Changed, as every document is
  (`docs/reference/run-counts.md`).
- Declaring `documents` on an entity changes its request key, so its watermark starts again once
  and every record's text is offered on the next run. An entity that declares none keeps its key.

## Options rejected

- **The body in the record's payload.** `raw.records` is read by dbt directly, granted to the
  control plane and full-text indexed, which would put every word a salesperson wrote one
  `dbt run` from a dashboard, and bypass the extract verb that search and the text readers use.
  ADR 0084 refused it for mail; nothing about HubSpot's text is different.
- **A HubSpot-specific collector in code**, as Gmail and Drive are
  ([ADR 0015](0015-a-first-party-collector-for-byte-sources.md)). Those are code
  because their content is bytes the runtime cannot carry. HubSpot's text is a JSON string, which
  the runtime already holds without loss, and everything else about these objects -- paging,
  watermarks, removals, links, a refused scope -- is what the spec already does. A collector would
  re-implement all of it to move one field. A declaration is a few lines of configuration, and
  the next source with free text (a Xero note, a ticket's description) gets it without code.
- **Stripping the body in the worker after the read.** The worker sees the record as canonical
  text; removing a field there means parsing it again and serialising it again, which
  `connectors.md` forbids because numbers lose digits on the way.
- **Requesting the body in a separate read.** It would cost a request per page to fetch what the
  list already answered, and leave a window in which the record and its text are from two reads.
- **Not saving the mark but letting the run succeed** when a document failed. The run would close
  green with text missing, which the issue forbids for a rate-limited read and which is the same
  silence. Failing names the problem; the next run lands what is missing.
- **A hardcoded table of call outcome labels.** HubSpot's defaults are documented, but a portal adds
  its own, and a label written into the repo would be a guess about a portal it has never seen.
