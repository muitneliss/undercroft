---
title: ADR 0069 Xero Reads Every List Its Granular Scopes Reach
type: source
date: 2026-09-27
tags: []
source: docs/adr/0069-xero-reads-every-list-its-granular-scopes-reach.md
source_path: docs/adr/0069-xero-reads-every-list-its-granular-scopes-reach.md
source_hash: 7f767d69cabdbc1a99225ad0568fca4b54c617119c2344430b71abc862635c93
ingested: 2026-09-27
---

# ADR 0069 Xero Reads Every List Its Granular Scopes Reach

# ADR 0069 Xero Reads Every List Its Granular Read Scopes Reach

Status: Accepted, 2026-09-27. Issue 271.

## Context

The Xero consent's three granular read scopes (`accounting.invoices.read`,
`accounting.payments.read`, `accounting.contacts.read`) reach thirteen lists, but the spec read
four (contacts, invoices, payments, credit notes). Invoices also reaches Quotes, PurchaseOrders,
RepeatingInvoices, LinkedTransactions and Items; payments reaches Overpayments, Prepayments and
BatchPayments; contacts reaches ContactGroups.

Per Xero's OpenAPI document the nine read differently: `Items`, `BatchPayments`,
`RepeatingInvoices` and `ContactGroups` take no `page` (paged, they would answer page two with page
one and never with an empty page); `Quotes` and `LinkedTransactions` take no `pageSize`;
`RepeatingInvoices`, `LinkedTransactions` and `ContactGroups` take no `If-Modified-Since`;
`RepeatingInvoice` and `ContactGroup` carry no `UpdatedDateUTC`.

Two further obstacles: `failOnEmpty` would fail every connection reading every entity (an empty
entity list, see [[ADR 0052: A HubSpot scope adds to the spec's properties, and a widened read starts a new watermark]])
on the first organisation with no quotes or contact groups, and on every run for a list read whole;
and a missing scope only surfaced as a 401 part-way through a run, while the card's
`needs_reconnect` did not stop the scheduler starting runs.

## Decision

* The spec declares all thirteen lists, each read as Xero's OpenAPI says it can be:
  `pagination: none`, no `pageSize`, no `incremental` or no `updatedAtPath` where Xero takes or
  carries none. No new consent, so nobody reconnects.
* The nine new lists set `failOnEmpty: false`; the four existing ones keep it. On Xero a credential
  problem is a 401/403 and raises, and a missing scope is refused before the run opens, so an empty
  200 is Xero saying there is nothing.
* `requireSpecGrant` (`apps/worker/src/services/grant.ts`, moved up from `google/`), called from
  `requireUsableConnection`, refuses an OAuth spec source whose recorded grant lacks a scope from
  `auth.scopes` before a ledger row exists, with `GrantTooNarrow` (`409 credential_unusable`). An
  empty recorded scope is not judged.
* `oauthProviders.test.ts` holds Xero's path-to-scope table and fails on an entity whose list is
  not in it or whose scope the consent lacks; `apps/ui/src/lib/xeroEntities.test.ts` holds the
  picker's hand copy to the spec.

## Consequences

A connection with no entity ticked reads all thirteen from the next run; one that ticked entities
reads what it ticked. At least nine extra requests a run, well inside Xero's 60 a minute and 5,000
a day. A list needing a new scope is a new consent, after which every older grant is refused at its
next run with a message to reconnect.

## Rejected

Paging every list; keeping `failOnEmpty` on the new lists; turning it off for all thirteen; a
per-entity `scope` field in the spec format; relying on the card's `needs_reconnect` alone.
