---
title: >-
  ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read
  starts a new watermark
type: source
date: 2026-09-25
tags: []
source: docs/adr/0052-a-hubspot-scope-adds-to-the-specs-properties.md
source_path: docs/adr/0052-a-hubspot-scope-adds-to-the-specs-properties.md
source_hash: 3fb29176eb186f299a5c207d725726bbee1089651d2abf6b414ff4afc8813f55
ingested: 2026-09-25
---

# ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark

# ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark

Accepted 2026-09-25. Issue #202. Extends [[ADR 0034 The Watermark Is a Table Not a Max]] without superseding it.

**Context.** `specs/connectors/hubspot.yaml` names a fixed `properties:` list per CRM object, so the lake carried 8 of 302 company, 8 of 525 contact and 9 of 252 deal properties, and none a portal creates itself. Gmail, Drive and Xero had an admin-chosen scope (`connections.setScope`, `connections.browseScope`, the scope picker, `connections browse-scope`); HubSpot had none. Three facts shaped the design: the spec's list carries each object's incremental property (`hs_lastmodifieddate`, `lastmodifieddate` on contacts), so a scope able to replace it could stop the cursor; the chosen properties travel in a GET URL, repeated in HubSpot's next-page link, and HubSpot documents no ceiling while its forum measures about 16,000 characters before `414`; and the objects are read with a client-side filter against the stored watermark, so a mark kept across a widened request would filter out every unchanged record and the new property would reach only records that change later. Only item (1) of the issue is decided here: new objects, association edges and per-object enable/disable are later work.

**Decision.** The spec's `properties:` is a floor; a HubSpot scope adds to it and never takes from it. `HubspotScope` (`packages/contracts/src/connectionScope.ts`) is `{ properties: { <entity>: [<internal name>] } }` in `app.connection_detail`, internal names only. It is optional: HubSpot is not in `SCOPED_KINDS`, a connection with no row reads the spec's list as before, and `{ properties: {} }` means the same; Gmail, Drive and Xero keep "nobody chose" apart from "chose nothing". The one seam is the worker's opening of a spec run (`apps/worker/src/services/specRun.ts`), where Xero's scope already narrowed entities: `withChosenProperties` (`services/hubspot/properties.ts`) sets an object's `properties` query to the spec's list followed by the sorted chosen names it lacks, and the runtime never learns of the scope. The `properties` listing asks `GET /crm/v3/properties/{objectType}` for each object the spec lists at `/crm/v3/objects/{objectType}`, marking each property `system` (`hubspotDefined`) or `user` (the portal's own), its entity, and `always` for the floor; a 401/403 is `scope-insufficient`, worded for a private app. `overlongPropertyChoices` measures each object's chosen names as sent against `MAX_PROPERTY_QUERY_CHARS` (10,000); `setScope` refuses one over it as `too-many-properties` with `entity`, `chars` and `limit`, and the picker applies the same rule before Save. `raw.sync_cursor` gains `request_key` (`280_sync_cursor_request.sql`): `''` for an entity read as its spec declares, else a SHA-256 of the canonical widened request; a cursor is read only under the key about to be sent, so a changed request starts from no mark and an unchanged one keeps it, and `''` keeps every existing cursor valid across the deploy.

**Consequences.** An unscoped HubSpot connection sends exactly the requests it sent before and keeps its watermarks. Changing a choice re-reads that object in full once. `failOnEmpty` and `failOnExactCount` still apply, since only the query changes. A chosen property HubSpot has deleted is answered by its absence and nothing fills it in; the picker shows it under "no longer in HubSpot".

**Rejected.** Replacing the spec's list (could untick the cursor's property); declaring the widenable parameter in the spec (splits HubSpot knowledge and grows the format for one source); POSTing the list via the search endpoint (silently stops at 10,000 records); splitting a long list over several requests and merging (a payload HubSpot never sent); keeping the old watermark after widening; digesting every request including declared ones (would drop every existing cursor on deploy); making HubSpot a scoped source that must be chosen before it runs.
