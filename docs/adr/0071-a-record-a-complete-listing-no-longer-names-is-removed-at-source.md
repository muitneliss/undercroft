# 71. A record a complete listing no longer names is removed at source

- Status: Accepted
- Date: 2026-09-28

## Context

Issue #278. Contacts archived in HubSpot stayed live in the lake after two scheduled runs, and
the Raw lake's "deleted at source" count read 0 for every HubSpot stream. Drive's count did
move. On production no HubSpot row had `raw.records.deleted_at` set, across associations,
companies, contacts and deals.

The cause was plain once traced. `raw.records.deleted_at` has been in the schema since
`030_raw.sql`, and the Raw lake counts it (`count(deleted_at)` in the control plane's
`summariseRecords`). dbt models filter on it too. But nothing ever wrote it. The upsert only
ever clears it. The one tombstone writer, `tombstoneMissing`, is Drive's, and it writes
`raw.documents`. A spec run read the live list, landed what it found and never looked at what it
did not find.

Before choosing, we had to know whether a HubSpot run reads the whole live list at all. It does.
Each object is `GET /crm/v3/objects/{type}?archived=false`. HubSpot documents `archived` as
"whether to return only results that have been archived", so `false` is every live record. The
list is paged by `after`, "the Record ID of the next contact" (HubSpot's contacts API reference),
so a record edited mid-read does not move out from under the cursor. The list has no cap like the
search endpoint's 10,000. The watermark is `strategy: client-filter`. That strategy pages the
whole source on every run and only skips LANDING records older than the mark (`incremental.ts`:
"a client filter skips; it never stops"). So every HubSpot run that gets to the end has named
every live record, including the ones it did not land.

HubSpot's own documentation also settles what "removed" covers:

- An archived record goes to the recycle bin. It can be restored within 90 days, and after that
  it is deleted permanently. A GDPR delete is permanent at once.
- A merge makes a new record with a new id, and both old ids leave the live list. Fetching an
  old id returns the merged record. The Primary ID Preservation beta keeps the primary's id, and
  then only the secondary's id leaves. The record the others merged into carries their ids in
  `hs_merged_object_ids` ("Merged [record] IDs"). Contacts, companies and deals all have it.
  Merges cannot be undone.

## Decision

**A spec entity may declare what an absence means, and HubSpot's objects do.** A new optional
entity field `removedWhen` (`connectorSpec.ts`) takes one of two values:

- `absent`: this list, read whole, is every live record the source holds. A held record it no
  longer names has been removed at source. Allowed on a `list` request only.
- `parent-removed`: a `batch-from` relation keyed by the id of the record it hangs off. It is
  removed and restored with that record. The referenced entity must be `absent`, and the schema
  refuses the spec otherwise.

Leaving the field out keeps today's behaviour: a record that stops appearing stays live. That is
the right default for a list the spec author cannot vouch for, such as a filtered query or a
label. It is Gmail's case, where a message that stops matching was relabelled, not deleted.

**Only the runtime decides whether a read listed everything** (`connector-runtime/src/listing.ts`).
`readEntity`'s return value, `ReadEnd.listed`, carries every id the source named, filtered or
not. It is `null` whenever there is any doubt:

- the entity is not `removedWhen: absent`;
- a `header` or `query-param` watermark was sent. The source then answers with only what changed,
  so a missing record may simply be unchanged (`asksSourceForLess`);
- `maxRecords` truncated the read;
- the listing is empty. A provider that answers "nothing" to a read that asked for everything is
  far likelier to be at fault than to have lost every record. Guessing wrong here would mark the
  whole lake removed.

The listing travels as the generator's return value, so a read that threw never produces one,
and neither does a read its caller stopped. That is the Drive rule, which ADR 0051 applies to a
stopped walk, and here it holds by control flow. No flag exists that a later edit could forget.
An id enters the set before the client filter runs, never after. A record skipped as unchanged is
still one the source holds. Leaving it out would report an unchanged portal deleted on its second
run, which is the trap ADR 0033 records for Drive's `seenIds`.

**The worker settles it last** (`runPaths.ts`, then `removals.ts`, then
`rawRecords.reconcileRemovals`). This happens after the ledger entry and after the cursor write,
and only with a listing. One statement marks every held row the listing does not name with
`deleted_at = now()`. A second clears `deleted_at` on every removed row the listing names again.
That second statement is needed because a restored record is usually unchanged: the client
filter does not land it, so no upsert ever reaches the row. A row already removed keeps the time
it was first found gone. The same listing settles each `parent-removed` relation, so a removed
deal's deal-to-company links are marked with it. This is decided with the deal rather than when
the links are read, because the link read asks only about deals that changed and so can never say
which deals are gone. Each settled stream writes a `removals_settled` line to the run's journal.

A removal is never an erasure. The row keeps its last payload, and every lake version behind it
stays readable. `deleted_at` is a statement about the source, and it is the column the Raw lake
already counts and dbt already filters. No UI change was needed for the count.

**`hs_merged_object_ids` is added to each HubSpot object's properties.** The record a merge
produced then names the ids that merged into it. A record that was merged away is marked removed
like any other absence, and a model can find where it went by joining on that property.

## Consequences

- The first complete HubSpot run after this ships marks removed everything deleted in HubSpot
  since it was landed. It stamps them with that run's time, which is when we noticed, not when
  HubSpot deleted them. The listing says a record is gone and says nothing about when.
- A record deleted between the list naming it and the batch read fetching it (ADR 0054) is
  listed, so it is not marked removed by that run. The next complete run marks it.
- `deleted_at` on `raw.records` is not in the lake, the same as Drive's on `raw.documents`. A
  rebuilt projection comes back with every row live until the next complete run decides again.
  That run's time then becomes the removal time. We accept this for now. Recording removals as
  lake objects would be a new object kind through `LakeStore` and a new branch in the
  projection, and nothing downstream needs the original instant yet.
- A removed row does not point at the record it merged into. The pointer lives on the survivor
  (`hs_merged_object_ids`), in its payload. The Raw lake does not show the link.
- A link that disappears while its deal stays live is not marked removed. The link read asks
  only about deals that changed, so it cannot tell. This is outside issue #278.
- Every HubSpot object added later needs `removedWhen: absent`, and every relation needs
  `parent-removed`. `connectorSpec.test.ts` pins that the shipped spec declares them.
- Xero declares nothing. Its watermark is a header, so only its first read could decide, and
  whether a Xero list is every live record is a separate question for each endpoint.

## Rejected

- **Reading `archived=true` as positive evidence.** A second paged read per object per run,
  over up to 90 days of recycle bin. It would catch archives and nothing else. A permanent or
  GDPR delete never appears there, and a merge is not an archive. The live listing would still
  be needed to see a restore. And its records would need a new spec concept, records that mean
  "gone", landed without becoming live rows. Positive evidence is better where it covers the
  case. Here it covers a subset of what the complete live listing already decides, and does not
  lower false removals: both have none given a complete listing, and it adds false negatives.
  It stays open as a refinement that records `archivedAt` for archived records.
- **A periodic full read of ids only.** Not needed: the client filter already pages every live
  record on every run. It is the answer for a source whose watermark narrows the listing, which
  none of the declared entities has.
- **Special-casing HubSpot in the worker.** A connector is configuration (`connectors.md`). An
  absence rule belongs next to the query whose completeness it depends on, where the next
  HubSpot object and any other source can declare it.
- **Inferring absence for every spec entity.** Only the spec author knows whether a list is
  every live record. For a filtered query or a label it is not, and inferring absence there
  reports deletions that never happened.
