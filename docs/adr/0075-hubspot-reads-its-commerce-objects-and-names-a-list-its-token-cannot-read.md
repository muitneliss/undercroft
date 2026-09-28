# 75. HubSpot reads its commerce objects, and a list its token cannot read is named, not failed

- Status: Accepted
- Date: 2026-09-28
- Extends: [ADR 0073](0073-a-list-its-grant-cannot-read-is-named-not-failed.md). A list is
  named as not granted in a second case: when a pasted token is refused on that list's first
  request. It is the same `entity_not_granted` event, so it gets the same Journal line and the
  same flow mark. ADR 0073's line "HubSpot is bearer and is unaffected" no longer holds.
- Supersedes: one consequence of
  [ADR 0071](0071-a-record-a-complete-listing-no-longer-names-is-removed-at-source.md), "the link
  read asks only about deals that changed". A relation now asks about every record its parent's
  read named. The rest of ADR 0071 stands.

## Context

Issue 279 replaces issue 246. Up to v1.42.0 the HubSpot spec read companies, contacts, deals and
the deal-to-company link, and nothing else. An analyst could not report quotes or what was
quoted, match an owner id to a salesperson, tell a won deal from a lost one, or see a contact's
second company. The issue asks for these, in priority order:

- quotes, line items and products, including archived products that a line item still names;
- seven more link kinds: deal→quote, quote→line item, deal→line item, quote→contact,
  quote→company, contact→company and deal→contact;
- owners, active and archived;
- deal pipelines with their stages;
- a connection whose HubSpot permission lacks an object fails only that object, names the
  permission, and still lands the other streams in the same run.

HubSpot is connected by pasting a private app's token. The app's scopes are ticked in HubSpot, and
nothing here records them: `ops.connection.scope` is empty, and `partitionByGrant` does not judge
an empty grant. So a token without the quotes scope is only found out when quotes are requested.
Before this change that request failed the whole run, after companies, contacts and deals had
already landed.

What HubSpot documents, and what this decision relies on (verified against HubSpot's developer
docs and its public OpenAPI specs on 2026-09-28):

- `GET /crm/v3/objects/{quotes,line_items,products}` pages by `after`, as the three existing
  objects do. Only the search endpoints stop at 10,000 results: "The search endpoints are limited
  to 10,000 total results for any given query." `archived` means "Whether to return only results
  that have been archived", so archived records need a read of their own. The batch read takes
  the same `archived` parameter.
- A line item names its product in `hs_product_id`. "Products can't be associated with other
  objects", so there is no product link to read.
- `GET /crm/v3/owners` takes `archived` and pages by `after`. A record's owner id is the owner's
  `id`, not its `userId`.
- `GET /crm/v3/pipelines/deals` is not paged and takes no `archived`. Each stage carries
  `metadata`, whose values are strings (`"probability": "0.2"`).
- The v4 associations batch read answers each link with `associationTypes` (`category`,
  `typeId`, `label`). The v3 batch read answers a `type` only, and for contact→company "only the
  primary associated company will be returned". v4 also pages one record's links:
  `paging.next.after` "can be added alongside the 'id' to retrieve the next page".
- Scopes: quotes need `crm.objects.quotes.read` and line items `crm.objects.line_items.read`
  (`e-commerce` is also accepted for both). Products need `e-commerce` in the scope reference
  that private apps link to; the products API also accepts `crm.objects.products.read`. Owners
  need `crm.objects.owners.read`. Deal pipelines accept any of many scopes,
  `crm.objects.deals.read` among them.
- A missing scope is a `403`. HubSpot's error guide documents only the status. The category
  `MISSING_SCOPES` comes from HubSpot's own client code (`hubspot-local-dev-lib`). Neither says
  which key of the error's `context` names the scopes; the OpenAPI example uses `missingScopes`.

## Decision

**The spec reads twelve more entities** (`specs/connectors/hubspot.yaml`):

| Entity              | Request                                                   | Keyed on  | Removed when   |
| ------------------- | --------------------------------------------------------- | --------- | -------------- |
| `quotes`            | `GET /crm/v3/objects/quotes?archived=false`               | `id`      | absent         |
| `line_items`        | `GET /crm/v3/objects/line_items?archived=false`           | `id`      | absent         |
| `products`          | `GET /crm/v3/objects/products`, `archived` false and true | `id`      | absent         |
| `owners`            | `GET /crm/v3/owners`, `archived` false and true           | `id`      | absent         |
| `deal_pipelines`    | `GET /crm/v3/pipelines/deals`                             | `id`      | absent         |
| `contact_companies` | `POST /crm/v4/associations/contacts/companies/batch/read` | `from.id` | parent-removed |
| `deal_contacts`     | `POST /crm/v4/associations/deals/contacts/batch/read`     | `from.id` | parent-removed |
| `deal_quotes`       | `POST /crm/v4/associations/deals/quotes/batch/read`       | `from.id` | parent-removed |
| `deal_line_items`   | `POST /crm/v4/associations/deals/line_items/batch/read`   | `from.id` | parent-removed |
| `quote_line_items`  | `POST /crm/v4/associations/quotes/line_items/batch/read`  | `from.id` | parent-removed |
| `quote_contacts`    | `POST /crm/v4/associations/quotes/contacts/batch/read`    | `from.id` | parent-removed |
| `quote_companies`   | `POST /crm/v4/associations/quotes/companies/batch/read`   | `from.id` | parent-removed |

The four existing entities keep their requests byte for byte. Their request keys (ADR 0072) do not
move, their watermarks stand, and an unchanged record lands as `unchanged`. The new lists page by
`after` as a cursor, not by HubSpot's next link, so the spec itself carries `archived` to every
page. Quotes and line items keep a client-filter watermark on `hs_lastmodifieddate`. Products,
owners and pipelines have no watermark and are read whole on every run, so an unchanged record
lands as `unchanged`. For products this is on purpose: HubSpot does not say whether archiving a
product moves its `hs_lastmodifieddate`, so a watermark could leave an archived product's payload
still saying it is live. A new list sets `failOnEmpty: false` only where a portal can really have
none (quotes, line items, products, the links). Every portal has an owner and a deal pipeline, so
those two keep the guard.

**A list may be read in partitions** (`request.partitions` in `connectorSpec.ts`). The same path
is read once for each set of query values, one partition to its end before the next, and every
record lands under the one entity. The listing that decides removals is the union of the
partitions. A two-step read (ADR 0054) sends the partition's values on its batch read too.
Without them HubSpot answers an archived record as "not found", and the batch read takes that as a
deletion. `products` and `owners` read `archived=false` and then `archived=true`. So a product that
is archived stays one record, whose own `archived` says so, and a line item's `hs_product_id`
still resolves. The field is optional and has no default, so no existing request changes.

**A relation asks about every record its parent's read named** (`RunContext.keepIds`,
`ReadEnd.named`). Before, it asked only about records the client filter landed. A link read added
after its parent's watermark was set would then never learn the links of any record that has not
changed since. That would be every existing contact's companies, and every existing deal's
contacts, quotes and line items. The ids are only what the parent's read named, so a watermark
sent to the source still narrows them. **A record whose links HubSpot pages is read to its last
page** (`recordPageAfter` and `joinRecordPages` in `paging.ts`). It is asked by its own id and
`after`, and lands as one record with every link in `to`. A record that was not paged lands
exactly as it was answered, so the deal-to-company stream keeps its bytes.

**A pasted token's refusal is named, not failed** (`auth.grantRefusal: hubspot-missing-scopes`,
`connector-runtime/src/refusal.ts`). A `403` whose body has `category: "MISSING_SCOPES"`, on the
FIRST request of an entity, raises `EntityNotGranted`. The worker writes it as
`entity_not_granted` with the scope, the ADR 0073 event, and goes on to the next list. The scope
named is the entity's `readScope` when HubSpot lists it among the scopes it would accept, or lists
none. When HubSpot names other scopes and not that one, its own names are used. A relation whose
parent was not granted is named with the parent's scope and is not requested, because asked with
no ids it would land nothing and look like HubSpot answered it empty. A run that reads no list at
all still fails with `GrantTooNarrow`.

Everything else still fails the run (`.claude/rules/connectors.md`). That includes a 403 with any
other body, and the same refusal after a page has already been answered, which is a partial read.
The contract now allows `readScope` on a bearer spec. It requires one on every entity once
`grantRefusal` is declared, so a refusal always has a scope to name, and the runbook's table
(`docs/runbook/hubspot-setup.md`) has one place to agree with.

**The scope picker lists what the token can read.** `listProperties` leaves out an object that
HubSpot refuses for missing scopes, and still raises `scope-insufficient` when every object is
refused. Quotes, line items and products get their words in the picker and in the consent copy.
When a run names a HubSpot list as not granted, the Journal says to grant the scope in HubSpot,
not to reconnect: reconnecting a pasted token adds no scope.

**`failOnExactCount: 10000` is gone from HubSpot's defaults.** It guarded the search endpoint,
which no entity uses. On the objects list it would fail every run of a portal with exactly
10,000 line items.

## Consequences

- The first run after this release lands every quote, line item, product, owner and pipeline,
  and every link of the seven new kinds, for every existing record. The four existing streams
  land as they did.
- Each run now asks about the links of every contact and deal, not only the changed ones: one
  request per hundred parents per link kind. At the spec's pacing of 100 requests a minute, a
  portal with 20,000 contacts and 5,000 deals spends about 200 requests on contact→company and
  200 on the four deal link kinds, several minutes a run. That is the price of never guessing
  whether a link change moves its parent's `hs_lastmodifieddate`, which HubSpot does not say. It
  also narrows the gap ADR 0071 left: a link removed while its deal stays live now lands as a
  changed record, unless the deal is left with no links at all.
- A HubSpot token without companies, contacts or deals now closes its run as succeeded, with
  those lists named in the Journal, where before the run failed. This is the same trade ADR 0073
  made for Xero. The Sources card cannot show it, because there is no recorded grant to compare,
  so the Journal is where it shows.
- `e-commerce` is listed as deprecated on HubSpot's new developer platform. If a private app
  stops offering it, `crm.objects.products.read` is the scope to tick and the spec's `readScope`
  for products should follow.
- Not checked against a live portal:
  - which `context` key HubSpot's 403 names scopes under;
  - whether the v4 associations endpoints need both objects' scopes;
  - how many links v4 answers for one record before it pages;
  - whether a line item's `hs_product_id` still points to an archived product;
  - whether GET pipelines returns `metadata.isClosed` for every stage.

  Each is written to fail safe: an unrecognised refusal fails the run as before, and a paged record
  is followed rather than cut short.

## Rejected

- **Archived products and owners as separate entities** (`archived_products`). A record that is
  archived would move from one stream to the other, and every model would need a union to resolve
  a line item's product. The scope picker would also list the products' properties twice.
- **Reading the links only for parents that changed, plus a one-off full read.** This keeps the
  steady state cheap. But it needs the relation to remember its own mark, or a migration per link
  added, and it rests on an undocumented behaviour: that adding a link moves the parent's
  `hs_lastmodifieddate`. A relation that reads against every named parent needs neither.
- **Refusing the whole run when any list is refused.** This is what Xero did before ADR 0073, and
  the issue asks for the opposite. A second reporting path for HubSpot was rejected as well: the
  refusal reuses ADR 0073's event, so the Journal and the flow mark it without new wording rules.
- **The v3 associations batch read.** It answers only a contact's primary company, with no kind
  and no label.
- **Parsing any 403 as "not granted".** A suspended portal or a revoked token would then look like
  a narrow grant, and the run would close green having read nothing it could.
