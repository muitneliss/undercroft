# 54. A widened HubSpot object is read in two steps, so no choice of properties is too long

- Status: Accepted
- Date: 2026-09-25
- Supersedes: three clauses of
  [ADR 0052](0052-a-hubspot-scope-adds-to-the-specs-properties.md) -- "a choice too long for
  one request is refused when it is saved" (`too-many-properties`, `MAX_PROPERTY_QUERY_CHARS`),
  its rejected option "POST the property list instead of sending it in the URL", and "the spec
  format does not grow". Extends the rest of it, which stands: the spec's list is a floor, the
  scope is optional, `withChosenProperties` is the one seam, and a watermark belongs to the
  request it was read with.

## Context

Issue #210. ADR 0052 read a widened HubSpot object by adding the chosen properties to the list
GET's `properties` query, and so had to refuse, on save, any object whose choice would not fit
in one URL. A portal's full list of contact properties does not fit, so ticking "Select all"
on Contacts disabled the page's one Save, and the server refused the whole selection -- a
valid choice for Deals saved alongside it went down with it. Some of a portal's contact
properties could never reach the lake at all.

ADR 0052 rejected two ways of moving the list out of the URL: HubSpot's search endpoint, which
stops at 10,000 records without saying so, and splitting the list over several GETs and merging
the answers per record, which lands a payload HubSpot never sent. The reporter asked about a
third it did not consider: HubSpot's **batch read**, `POST /crm/v3/objects/{objectType}/batch/read`
with `{ inputs: [{ id }...], properties: [...] }` in the body. HubSpot's object API guide
(developers.hubspot.com, "Using object APIs") documents it at "up to 100 records in a batch
request", which is also the `limit` every object in the spec pages at, and says it is a POST
precisely because "using the POST method avoids the URL length limits that are applied to GET
requests". A call where some ids have no live record answers `207 Multi-Status`, with an
`errors[]` beside `results[]`.

It fits where the other two did not:

- It is not search: it reads records by id, so it has no 10,000 cap to truncate at.
- Each record it answers is one record HubSpot sent, in the same shape the list answers
  (`id`, `properties`, `createdAt`, `updatedAt`, `archived`) under the same id. Nothing is
  assembled from two answers.
- Its property list is in a POST body, which has no ceiling anywhere near a portal's property
  count.

## Decision

**A widened object is listed exactly as the spec declares it, and each page is then read whole
by a batch read that asks for the spec's properties and the chosen ones.** The list supplies
the ids and the cursor; the batch read supplies what is landed.

- **The spec format gains one optional step on a `list` request**, `batchRead` with a `path`,
  a `bodyTemplate` (`hubspot-batch-read`) and the `properties` to ask for
  (`packages/contracts/src/connectorSpec.ts`). A named template, like `batch-from`'s, because a
  spec may not carry code. It has no `chunkSize`: how many ids one call may carry is the
  endpoint's limit, not a choice, so the template carries it (100), and the block stays all
  strings for the request key's digest.
- **Why the format grows, when ADR 0052 said it would not.** ADR 0052 refused a
  `request.widen` field because it split one piece of HubSpot knowledge -- which parameter a
  scope widens -- between a spec field and a module. `batchRead` is not that: it says nothing
  about scopes, it describes a request shape (list, then read the page by id in a POST), and
  the runtime executes it like `batch-from` without knowing why it was asked. The alternative
  that keeps the format still is a second HubSpot reader in the worker, which would re-implement
  pacing, retry, paging, the guards and the watermark filter beside the runtime's -- a second
  place for each to go wrong. `connectors.md`'s valve (the lake write API) does not fit either:
  the worker already holds the credential and runs the read; sending it out through an external
  caller would move the whole object read out of the runtime for one extra request per page.
- **The shipped spec does not use it.** `withChosenProperties` adds it to an entity a scope
  widened -- `path` is the list's path plus `/batch/read`, `properties` is the spec's list
  followed by the chosen names it lacks, sorted -- and returns the SAME entity when a choice
  adds nothing. An unscoped connection sends byte-for-byte the requests it always sent, and
  keeps its watermarks; `hubspotScope.test.ts` pins both.
- **The list page is what is counted and what the watermark filters**, exactly as on a one-step
  read, so `seen`, `failOnEmpty`, `failOnExactCount`, `maxRecords` and the client filter all
  mean what they meant (`reader.ts`, `rereadPage`). A record the watermark filters out is not
  asked of the batch read at all: the steady state of an incremental read costs one extra
  request per page that changed, not per page.
- **The request key covers the batch read.** `requestKeyOf` digests the whole request, and
  `batchRead` is part of it, so changing a choice still starts that object from no mark. So
  does this deploy: every object ADR 0052 widened now sends a different request, and reads in
  full once.
- **Every id the list named is accounted for, or the read raises** (`batchRead.ts`). HubSpot
  answers a batch read that could not find some ids with `207 Multi-Status` and an
  `OBJECT_NOT_FOUND` error naming them in `context.ids`. Such a record was deleted or archived
  between the two calls; it is not landed, and nothing is lost, because a list started a
  moment later would not have named it either. That is the one shortfall accepted, because it
  is the one the source itself explains. Any other error category, an id answered by neither a
  record nor a not-found, or a record nobody asked for raises a `ConnectorError`, so the run
  fails, keeps its watermark and re-reads next time -- `.claude/rules/connectors.md`'s "a
  failure raises, never an empty stream".
- **Records are landed in the order the list named them**, whatever order the batch read
  answers in, so a widened read lands in the same order an unscoped one does.
- **The length refusal is removed**, since no URL carries a choice any more: the
  `too-many-properties` outcome of `connections.setScope`, its message in both locales,
  `MAX_PROPERTY_QUERY_CHARS` and `overlongPropertyChoices` in the contracts, the picker's
  pre-check and its message in both locales, and the CLI contract's paragraph about it. A guard
  kept for a case that cannot happen is a second rule for the next reader to keep in step.

## Consequences

- Every property of every object can be chosen and saved at once, Select all included, and is
  read into the lake. No object's choice can block another's save.
- A widened object makes up to twice the requests of an unscoped one on a full read, paced by
  the same limiter: 12,069 contacts is 121 list pages and 121 batch reads, about two and a half
  minutes at the spec's 100 requests a minute.
- A chosen property HubSpot has since deleted is still sent and still answered by its absence,
  as ADR 0052 said of the list. Should HubSpot ever answer it on the batch read with an error
  instead, that error is not `OBJECT_NOT_FOUND`, so the read raises and says so rather than
  dropping records.
- A record merged into another between the two calls may come back under the surviving id;
  that is "a record nobody asked for", and the read raises. The next run lists the survivor and
  reads it normally.
- The worker, not the spec, still owns what a scope does to a HubSpot read. The runtime learns
  one more request shape and never learns there was a scope.

## Options rejected

- **Per-object saving**: keep the URL, save the objects that fit, hold back and name the one
  that does not, and make Select all stop short. It unblocks Deals, and it still leaves some
  Contacts properties unreadable for good -- the other half of the issue -- while adding a
  partial-save state to the picker, the service and the CLI.
- **Search (`POST /crm/v3/objects/{objectType}/search`).** Rejected in ADR 0052 and still:
  it stops at 10,000 records without saying so, and the reporter's contacts already number
  12,069.
- **Batch-read every object, scoped or not.** One read path instead of two, and it would double
  every HubSpot connection's requests and change what every unscoped connection sends -- and
  so its watermarks -- for no change in what is read.
- **Declare `batchRead` in `hubspot.yaml` for every object.** The same objection: the unscoped
  read must stay the read it was, and what a scope does is the worker's knowledge (ADR 0052).
- **Fail the read on `OBJECT_NOT_FOUND` too.** It would fail a long first read whenever
  somebody deleted a contact at the wrong moment, and then fail its retry the same way on a
  busy portal, for a record that no longer exists and that a read started a moment later would
  never have seen.
- **Fill a not-found record from the list's own copy.** The list asked for the floor only, so
  the landed row would silently lack every chosen property -- a payload that looks complete and
  is not.
- **A `chunkSize` on `batchRead`, as `batch-from` has.** A knob for the endpoint's own limit,
  which a spec author can only get wrong; and a number in the request would stop
  `canonicalJson` digesting it for the request key.
