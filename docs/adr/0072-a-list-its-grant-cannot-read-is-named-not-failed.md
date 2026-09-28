# 72. A list its grant cannot read is named in the run, not failed, and Xero asks for settings

- Status: Accepted
- Date: 2026-09-28
- Supersedes: three points of
  [ADR 0069](0069-xero-reads-every-list-its-granular-scopes-reach.md). These are its table's
  placing of Items under `accounting.invoices.read`, its decision that "a spec source
  consenting through OAuth is refused before its run opens when the recorded grant lacks a
  scope the spec declares", and its rejection of "a per-entity `scope` field in the spec
  format". The rest of ADR 0069 stands: how each list pages and filters, and `failOnEmpty`.

## Context

Since v1.42.0 a default Xero run fails on items with a bare `HTTP 401`, after eight lists have
read with the same token. The lists after items are never read (issue 276). ADR 0069 read
`/Items` under `accounting.invoices.read`, because Xero's granular scope table lists items
there. Live Xero does not agree. Xero's OpenAPI document (`xero_accounting.yaml`) gives each
path's scopes as its `security`. There, `GET /Items` is under `accounting.settings` and
`accounting.settings.read` only, the same as `/Accounts`, `/TrackingCategories`, `/TaxRates`
and `/Currencies`. The consent never asked for `accounting.settings.read`.

Issue 277 asks for those four lists. Without them, the account code, tax type and currency on
an invoice line cannot be resolved from the lake.

Asking for a new scope meets ADR 0069's rule that a grant recorded without a scope the spec
declares is refused before its run opens. Under that rule, adding the scope stops every run of
every existing Xero connection until someone reconnects. Those grants can still read the
twelve lists outside `accounting.settings.read`. A rule that loses twelve lists to protect five
fails in the direction rule 2 warns about: it throws away evidence we have.

## Decision

**The consent asks for `accounting.settings.read`.** It is added to `auth.scopes` in
`specs/connectors/xero.yaml` and to the Xero provider in `oauthProviders.ts`. Items moves under
it, and the spec declares four more lists under it:

| Entity                | Path                                       | Keyed on             | Read                         |
| --------------------- | ------------------------------------------ | -------------------- | ---------------------------- |
| `accounts`            | `/Accounts`                                | `AccountID`          | unpaged; `If-Modified-Since` |
| `tracking_categories` | `/TrackingCategories?includeArchived=true` | `TrackingCategoryID` | unpaged; whole every run     |
| `tax_rates`           | `/TaxRates`                                | `TaxType`            | unpaged; whole every run     |
| `currencies`          | `/Currencies`                              | `Code`               | unpaged; whole every run     |

Each follows the OpenAPI document, as ADR 0069's lists do. None of the four takes `page`.
Only `/Accounts` takes `If-Modified-Since`. `TaxRate` and `Currency` have no id field and no
change time, so each is keyed on the code that a line carries and that Xero holds unique per
organisation. All four set `failOnEmpty: false`, like ADR 0069's other added lists.

Archived records. `/TrackingCategories` is the only one of the four with an `includeArchived`
parameter, so the spec sends it; old lines still name archived categories. Its options arrive
nested inside each category. `/Accounts` and `/TaxRates` have no such parameter. Their `Status`
enums include `ARCHIVED`, and Xero's own examples narrow them with `where=Status=="ACTIVE"`.
So the spec sends no `where` and reads them as Xero answers unfiltered. The OpenAPI document
does not say in words that an unfiltered read includes archived records. We have not checked
that against a live organisation yet. The first run on an organisation with an archived
account is where to check it.

**Each entity names the scope it is read under, as `readScope`.** The spec contract validates
it. In an oauth2 spec whose consent names scopes, every entity must name one, and it must be
one of `auth.scopes`. An entity without one would be read on any grant and meet the 401
part-way through a run, which is issue 276. The field is written once, beside the entity it
governs. `oauthProviders.test.ts` still holds Xero's path-to-scope table. It now fails when an
entity's `readScope` differs from the table, which is the check that would have caught items.

**A run reads what its grant reaches and names the rest.** `partitionByGrant` in
`apps/worker/src/services/grant.ts` replaces `requireSpecGrant`. `openSpecRun` calls it after
the admin's entity choice, before any request. A list whose `readScope` the recorded grant
lacks is not requested. The run writes one `entity_not_granted` warning per such list into
`ops.run_event`, with the list and the scope. The Journal words it through the catalogue, in
Vietnamese by default: the list was not read, and reconnecting grants the scope. The flow
diagram shows the list as not granted, with the same remedy. The other lists are read, and the
skip does not fail the run.

This reuses the run-event machinery. A skipped list is not a refused record, so it does not go
to `ops.run_refusal`, where it would inflate the refused count. It gets no `ops.run_entity` row: a
list never requested has no count, and a `0` would read as Xero answering it empty.

**A run left with nothing to read fails.** When every list the run was to read is ungranted, it
records the warnings and then fails with `GrantTooNarrow`, naming the scopes. Closing green
having read nothing would call "no list was readable" a success.

**An empty recorded grant is still not judged.** Nothing recorded is no evidence either way,
as in `missingReadScope` and `presentStatus`. Every list is read, and Xero answers for itself.

## Consequences

- A connection recorded before this change keeps its schedule and reads its twelve lists.
  Each run names items, accounts, tracking categories, tax rates and currencies as not granted,
  and closes `succeeded`. No run meets a 401 on items.
- The card of every such connection reads **reconnect**, because `presentStatus` compares the
  grant with the consent. The card only offers "Run now" when it is `connected`, so until
  the organisation is reconnected only the schedule starts runs. The card's sentence is the
  general "the access has lapsed or been withdrawn". That overstates a grant that still reads
  most lists, and a sentence of its own for this case is left for a later change.
- After a reconnect, a default run reads all seventeen lists. That is four unpaged requests
  more than v1.42.0 made, well inside Xero's 60 a minute.
- The next scope added to the consent costs nothing at deploy. Grants without it read the
  lists they can and name the rest until they reconnect.
- A spec author writing an oauth2 spec with scopes must name `readScope` on every entity. HubSpot
  is bearer and is unaffected.

## Rejected

- **Keep ADR 0069's refusal before the run opens.** It stops every existing Xero connection at
  the next deploy, to protect five lists.
- **Drop items from the default read.** Issue 276 suggests it. The data is readable under the
  scope we now ask for, and dropping it would hide the scope error rather than fix it.
- **Record a skipped list in `ops.run_refusal` or as a zero-count `ops.run_entity`.** The
  first counts records and would inflate the run's refused total. The second states a count
  that was never taken.
- **Keep the scope table only in a test (ADR 0069's choice).** The test can fail the gate, but
  the worker cannot read a test at run time, and deciding per list needs the scope at run
  time. One field in the spec serves both, and the test pins the field to Xero's table.
- **Refuse the whole run when any list is ungranted, but only for a new scope.** That needs a
  second rule about which scopes are "new". The per-list rule needs none.
