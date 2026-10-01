---
title: Runbook HubSpot Setup
type: source
date: 2026-10-01
tags: []
source: docs/runbook/hubspot-setup.md
source_path: docs/runbook/hubspot-setup.md
source_hash: ca7ee8d9e6ff613780faf79ab87fa0902b6aaaae673ddfaa5dde448c707acc37
ingested: 2026-10-01
---

# Runbook HubSpot Setup

# Runbook: setting up HubSpot ingestion

How a customer's HubSpot portal is connected with a private app's token, which scopes each kind of
data needs, and how to verify. Decision records: [[ADR 0075 HubSpot Reads Its Commerce Objects And Names A List Its Token Cannot Read]], and [[ADR 0101 A Spec Lands the Text a Person Wrote as a Document of Its Record]] for notes, calls and tasks.

* No consent screen: a HubSpot admin creates a private app (Settings → Integrations → Private apps)
  and an Undercroft admin pastes its token on the Sources leaf; the worker checks it by reading one
  company before sealing it.
* Scopes per data, matching each entity's `readScope` in `specs/connectors/hubspot.yaml`:
  companies `crm.objects.companies.read`; contacts `crm.objects.contacts.read`; deals and
  `deal_pipelines` `crm.objects.deals.read`; quotes `crm.objects.quotes.read`; line items
  `crm.objects.line_items.read`; products (archived included) `e-commerce`, or
  `crm.objects.products.read` where offered; owners (deactivated included)
  `crm.objects.owners.read`; notes, calls (with `call_dispositions`) and tasks all
  `crm.objects.contacts.read`, which HubSpot uses for activities; links (including `note_*`,
  `call_*`, `task_*` to companies, contacts and deals) need both objects' scopes.
* A missing scope costs one list: the run reads the rest, succeeds, and the Journal names the list
  and scope; the list's links are named with the same scope. A token with no scope at all fails.
* The property picker ("Change what syncs") widens companies, contacts, deals, quotes, line items,
  products, notes, calls and tasks, and leaves out an object the token may not read, the text
  fields that land as documents, and what is never read.
* Adding a scope later: tick it in HubSpot, paste a new token if HubSpot issued one; the next run
  backfills that list and its links.
* Failure table: refused paste, "not granted" lines, all lists not granted, picker without
  permission, 401 after a revoked token, other 403s.
* Notes, calls and tasks (section 6): every live one, open and completed tasks alike, with time,
  owner (`hubspot_owner_id`, an owner's `id`), creator (`hs_created_by`, an owner's `userId`) and links; a call's outcome GUID resolves through `call_dispositions`; a note keeps
  `hs_attachment_ids` but the files are not read. The text (`hs_note_body`, `hs_call_body`,
  `hs_task_body`) is never in the record: it lands as the document `<entity>:<id>:body`, and a
  tenant's model joins `raw.document_text` to the record (filtering `deleted_at`) to read it. A
  cleared text keeps its last document. Recordings and transcripts are never read, and the picker
  does not offer a call's recording, transcript, summary or body previews.
