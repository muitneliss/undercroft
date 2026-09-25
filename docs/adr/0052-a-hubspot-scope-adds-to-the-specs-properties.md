# 52. A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark

- Status: Accepted
- Date: 2026-09-25
- Extends: ADR 0034 (the watermark), without superseding any of it

## Context

Issue #202. `specs/connectors/hubspot.yaml` names a fixed `properties:` list on each CRM
object, so the lake carried 8 of a portal's 302 company properties, 8 of 525 contact properties
and 9 of 252 deal properties -- and none of the properties a portal creates for itself, which
are the ones its operational reporting is built on. Gmail, Drive and Xero already had an
admin-chosen read scope (`connections.setScope`, `connections.browseScope`, the scope picker,
`connections browse-scope` at the CLI). HubSpot had none: browsing it was refused as
`unsupported`, and its scope page said the source needed no scope.

The reporter ranked four widenings by cost. This decision covers the first only: choosing,
per existing object, which further properties are read. New objects, new association edges and
turning an object off are later work.

Three facts shaped the design.

1. **The spec's list carries the cursor.** Each object is read incrementally against
   `hs_lastmodifieddate` -- `lastmodifieddate` on contacts, which is the difference between a
   cursor that advances and one that never does. A scope that could replace the list could
   remove that property, and the read would report success every day with its cursor stuck.
2. **The chosen properties travel in a URL.** HubSpot lists an object with a GET whose
   `properties` parameter is one comma-separated string, and the page-two link it hands back
   repeats it. HubSpot documents no ceiling for that URL; its developer forum measures one at
   about 16,000 characters, after which the answer is `414 Request-URI Too Large`. A portal's
   full list of contact properties is longer than that on its own.
3. **The objects are read with a client-side filter against the stored watermark.** Kept across
   a widened request, yesterday's mark filters out every record that has not changed since --
   so a property chosen today would reach only the records that happen to change afterwards,
   and nothing would say which rows carry it.

## Decision

**The spec's `properties:` list is a floor. A HubSpot scope adds to it and never takes from it.**

- `HubspotScope` in `packages/contracts/src/connectionScope.ts` is
  `{ properties: { <entity>: [<internal name>, ...] } }`, stored in `app.connection_detail`
  like every other scope. Internal names only: the picker lists labels live and the card
  speaks in counts, so no label is kept at rest.
- It is **optional**. HubSpot is not in `SCOPED_KINDS`: a connection with no scope row reads
  the spec's list, as it always did, which is the narrowest reading rather than the widest.
  `{ properties: {} }` means the same. Gmail, Drive and Xero keep "nobody chose yet" apart from
  "chose nothing" exactly as before.
- **The one seam is the worker's opening of a spec run** (`apps/worker/src/services/specRun.ts`),
  where Xero's scope already narrowed which entities are read. HubSpot's widens what each
  object read asks for: `withChosenProperties` (`services/hubspot/properties.ts`) returns the
  entity with its `properties` query set to the spec's list followed by each chosen name the
  spec does not already read, sorted. The generic connector runtime is handed that entity and
  never learns there was a scope; the spec format does not grow.
- **The listing is live and read off the spec.** `browseScope` for `hubspot` with the new
  `properties` listing asks `GET /crm/v3/properties/{objectType}` for each object the spec
  lists at `/crm/v3/objects/{objectType}` with a `properties` query, and marks each property
  `system` (HubSpot's `hubspotDefined`) or `user` (the portal's own), with the entity it is
  read on and `always` where the spec reads it anyway. A 401 or 403 -- a private app without
  the object's read scope -- is the existing `scope-insufficient` refusal, worded for a private
  app rather than for a consent screen.
- **A choice too long for one request is refused when it is saved.** `overlongPropertyChoices`
  measures each object's chosen names as they will be sent, percent-encoded, against
  `MAX_PROPERTY_QUERY_CHARS` (10,000). `connections.setScope` refuses one over it with the
  object named (`too-many-properties`, with `entity`, `chars` and `limit`), and the picker
  applies the same function before Save is pressed. Ten thousand leaves the rest of the URL --
  path, the spec's own properties, the page cursor -- well inside the ceiling that was
  measured rather than documented.
- **A watermark belongs to the request it was read with.** `raw.sync_cursor` gains
  `request_key` (`packages/db/sql/280_sync_cursor_request.sql`): `''` for an entity read exactly
  as its spec declares it, otherwise a SHA-256 of the canonical request a scope made of it. The
  worker reads a cursor only under the key it is about to send, so a changed request starts
  from no mark and costs one full read, and an unchanged one keeps its mark. `''` for the
  declared request, rather than a digest of it, is what keeps every existing cursor -- and every
  stream no scope touches -- valid across the deploy that brings this in.

## Consequences

- An admin can read any of a portal's properties, its own included, from the picker or with
  `connections browse-scope --source hubspot` and `connections set-scope`.
- A HubSpot connection nobody has scoped sends byte-for-byte the requests it sent before, and
  keeps its watermarks. `hubspotScope.test.ts` pins the requests against the shipped spec, and
  that a changed request drops its mark while an unchanged one keeps it.
- Changing a HubSpot choice re-reads that object in full once. Unchanged records land as new
  lake observations only where their payload changed, which a widened payload does; that is
  the honest cost of the lake carrying the new property on every row rather than on some.
- `failOnEmpty` and `failOnExactCount` still apply to a widened read: the widened entity keeps
  the spec's guards, since only its query changes.
- A chosen property HubSpot has since deleted is sent and answered by its absence. Nothing
  fills it in; the picker shows it under "no longer in HubSpot" so it can be unticked.

## Options rejected

- **Replace the spec's list with the chosen one.** Simpler to state, and it hands an admin the
  power to untick the cursor's property -- fact 1.
- **Declare the widenable parameter in the spec** (`request.widen: properties`). The listing is
  HubSpot code whatever the spec says, so the knowledge would be split between a spec field
  and a module, and the connector format would grow for one source. `connectors.md` keeps the
  format from growing for every exotic need.
- **POST the property list instead of sending it in the URL.** HubSpot's only list-by-POST is
  its search endpoint, which stops at 10,000 records without saying so -- exactly the silent
  truncation `failOnExactCount` exists to catch -- and the contacts in the reporter's portal
  already number 12,069.
- **Split a long list over several requests and merge per record.** Each subset would need its
  own pagination and the merge would assemble a payload HubSpot never sent, which the lake
  would then store as if it had.
- **Keep the old watermark after widening.** Fact 3: the new property would reach only records
  that change later, with no way to tell which rows carry it.
- **Key the watermark by a digest of every request, declared ones included.** Correct, and it
  would have thrown away every existing cursor in the estate on deploy for no change in what
  is asked.
- **Make HubSpot a scoped source that must be chosen before it runs.** It would stop every
  HubSpot connection until an admin saved a choice that changes nothing about what is read.
