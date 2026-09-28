---
title: Runbook HubSpot Setup
type: source
date: 2026-09-28
tags: []
source: docs/runbook/hubspot-setup.md
source_path: docs/runbook/hubspot-setup.md
source_hash: c8023aa0f587e048ab0f03997d60f9b08d872d3bce51bbbe9c59734ed9994e35
ingested: 2026-09-28
---

# Runbook HubSpot Setup

# Runbook: setting up HubSpot ingestion

How a customer's HubSpot portal is connected with a private app's token, which scopes each kind of
data needs, and how to verify. Decision record: [[ADR 0075 HubSpot Reads Its Commerce Objects And Names A List Its Token Cannot Read]].

* No consent screen: a HubSpot admin creates a private app (Settings → Integrations → Private apps)
  and an Undercroft admin pastes its token on the Sources leaf; the worker checks it by reading one
  company before sealing it.
* Scopes per data, matching each entity's `readScope` in `specs/connectors/hubspot.yaml`:
  companies `crm.objects.companies.read`; contacts `crm.objects.contacts.read`; deals and
  `deal_pipelines` `crm.objects.deals.read`; quotes `crm.objects.quotes.read`; line items
  `crm.objects.line_items.read`; products (archived included) `e-commerce`, or
  `crm.objects.products.read` where offered; owners (deactivated included)
  `crm.objects.owners.read`; links need both objects' scopes.
* A missing scope costs one list: the run reads the rest, succeeds, and the Journal names the list
  and scope; the list's links are named with the same scope. A token with no scope at all fails.
* The property picker ("Change what syncs") widens companies, contacts, deals, quotes, line items
  and products, and leaves out an object the token may not read.
* Adding a scope later: tick it in HubSpot, paste a new token if HubSpot issued one; the next run
  backfills that list and its links.
* Failure table: refused paste, "not granted" lines, all lists not granted, picker without
  permission, 401 after a revoked token, other 403s.
