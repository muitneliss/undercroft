# 69. Xero reads every list its granular read scopes reach

- Status: Accepted
- Date: 2026-09-27

## Context

The Xero consent asks for three granular read scopes: `accounting.invoices.read`,
`accounting.payments.read` and `accounting.contacts.read`. The spec read four lists under them:
contacts, invoices, payments and credit notes. Xero's granular scope table puts nine more lists
under the same three scopes. So a connection already allowed to read them read none of them
(issue 271):

| Scope                      | Lists read before     | Also reachable                                                       |
| -------------------------- | --------------------- | -------------------------------------------------------------------- |
| `accounting.invoices.read` | Invoices, CreditNotes | Quotes, PurchaseOrders, RepeatingInvoices, LinkedTransactions, Items |
| `accounting.payments.read` | Payments              | Overpayments, Prepayments, BatchPayments                             |
| `accounting.contacts.read` | Contacts              | ContactGroups                                                        |

The nine do not read the way the four do. Xero's OpenAPI document (`xero_accounting.yaml`,
the GET parameters of each path) gives three kinds of difference:

- **Paging.** `Items`, `BatchPayments`, `RepeatingInvoices` and `ContactGroups` take no `page`
  and answer every record at once. The spec's default is `page-number` until an empty page. Each
  of these would answer page two with page one again and never with an empty page.
  `Quotes` and `LinkedTransactions` page, but take no `pageSize`.
- **Filtering.** `RepeatingInvoices`, `LinkedTransactions` and `ContactGroups` take no
  `If-Modified-Since`, so they cannot be read incrementally.
- **Change time.** `RepeatingInvoice` and `ContactGroup` carry no `UpdatedDateUTC`.

Two more things stood in the way.

- **`failOnEmpty`** fails an entity's first read that finds nothing, because "failed after 0"
  is what a credential problem looks like. Many organisations have no quotes, no purchase orders
  or no contact groups. For a list read whole on every run, "first read" means every run. And a
  connection with no entity ticked reads every entity the spec declares (ADR 0052). So declaring
  the nine with the default guard would have started failing every such connection at the next
  deploy.
- **A missing scope showed up late.** Xero refuses a list outside the grant with a 401, but only
  on the request for that list, part-way through a run that has already landed the entities
  before it. The card already reads `needs_reconnect` when the recorded grant does not cover
  what the consent asks for (`presentStatus`). But the scheduler knows nothing of grants and kept
  starting runs anyway.

## Decision

**The spec declares all thirteen lists,** each read as Xero's OpenAPI document says that list
can be read: `pagination: none` where Xero takes no `page`, no `pageSize` where it takes none,
no `incremental` where Xero takes no `If-Modified-Since`, and no `updatedAtPath` where the
record carries no change time. A list with no incremental read is read whole on every run. This
costs nothing in the lake, where an unchanged record lands as `unchanged`. The consent is
unchanged, so no connection needs to reconnect.

**The nine new lists set `failOnEmpty: false`; the four existing ones keep the guard.** An
empty 200 from Xero is Xero saying there is nothing. The failure the guard exists to catch does
not come back as an empty 200 on Xero:

- a credential problem is a 401 or a 403, and raises;
- a grant missing a scope is refused before the run opens (next paragraph).

**A spec source consenting through OAuth is refused before its run opens when the recorded
grant lacks a scope the spec declares.** `requireSpecGrant` in `apps/worker/src/services/grant.ts`
does this, called from `requireUsableConnection`, the guard that already refuses an unusable
connection before a ledger row exists. It reuses Google's `GrantTooNarrow`, so the error names
the scope a reconnect would add and answers `409 credential_unusable`. An empty recorded scope
is no evidence either way and is not judged, as in `missingReadScope` and `presentStatus`.

**Each entity is tied to the scope that reads it.** `oauthProviders.test.ts` holds Xero's
path-to-scope table and fails when the spec declares an entity whose list is not in the table,
or whose scope the consent does not ask for. The picker's hand copy of the entity list is held
to the spec by `apps/ui/src/lib/xeroEntities.test.ts`.

## Consequences

- A connection with no entity ticked reads all thirteen lists from the next run. A connection
  that ticked entities reads exactly what it ticked, as before.
- A first run makes nine or more extra requests, and each later run makes at least nine: one
  per unpaged list and at least one per paged list. At Xero's 60 a minute and 5,000 a day,
  this is well inside the budget for any cadence the platform offers.
- Adding a list that needs a new scope means a new consent. That consent is added to the spec
  and `oauthProviders.ts` together (the tests hold them to one list). From then on, every grant
  recorded without it is refused at its next run with a message that says to reconnect,
  instead of failing part-way through.

## Rejected

- **Page every list, and trust an empty page to arrive.** For the four unpaged lists it never
  arrives: Xero ignores the `page` it does not take, and the read loops or lands duplicates.
- **Keep `failOnEmpty` on the new lists.** Every connection reading every entity would fail on
  the first empty list, and on every run for the lists read whole.
- **Turn `failOnEmpty` off for all thirteen.** The four core lists are what a Xero connection
  is for. An empty first read of contacts or invoices is still worth a failure, and nothing here
  gave a reason to give that up.
- **A per-entity `scope` field in the spec format.** It would add a field to the format for one
  source, when the scopes are already a spec-level list and a test can hold the path-to-scope
  table.
- **Rely on the card's `needs_reconnect`.** The card can say it, but the scheduler still starts
  the run, and the run still fails part-way through.
