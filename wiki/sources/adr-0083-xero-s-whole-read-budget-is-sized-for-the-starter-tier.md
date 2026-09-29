---
title: ADR 0083 Xero's Whole-Read Budget Is Sized for the Starter Tier
type: source
date: 2026-09-29
tags: []
source: docs/adr/0083-xero-s-whole-read-budget-is-sized-for-the-starter-tier.md
source_path: docs/adr/0083-xero-s-whole-read-budget-is-sized-for-the-starter-tier.md
source_hash: 1f3691d4aa673df655188d299c027d89105d9fdb6de5363f9b2870951c886816
ingested: 2026-09-29
---

# ADR 0083 Xero's Whole-Read Budget Is Sized for the Starter Tier

# ADR 0083 Xero's whole-read budget is sized for the starter tier

Status: Accepted, 2026-09-29. Supersedes in part [[ADR 0082 A Connection Re-Syncs on Its Own Schedule Within a Daily Request Budget]]: its Xero numbers (a 5,000-request day, 4,000 for whole reads) are replaced; the mechanism stands.

## Context

Xero allows 5,000 requests a day only on higher tiers; an app starts on the starter tier with 1,000. With a reserve of 1,000, `X-DayLimit-Remaining` on a starter app can never exceed it, so no whole read was admitted past its first request. The first v1.48.0 run proved it: every paged list (invoices, payments, credit notes, purchase orders, overpayments, prepayments, bank transactions, manual journals) had lost its watermark to the page-size change and waited, and would have waited forever; contacts stopped after one request. About 400 requests had been spent that day, consistent only with a 1,000-request day.

## Decision

Xero's day is 1,000 requests; whole reads may spend 800, leaving a 200 reserve (a daily sync of every list costs about 35). Sized for the smallest tier because the error is asymmetric: too large a reserve on a starter app admits nothing, too small a budget on a larger app only reads whole more slowly. An app on a higher tier raises both numbers in `xero.yaml`.

## Consequences

The affected organisation's whole read needs about 30 requests at 500 a page and finishes in one run. An hourly Xero sync on the starter tier costs about 840 a day, beyond what the tier can spare; such a connection should sync daily or every six hours.

## Rejected

Reading the tier from the provider (Xero reports only what is left, so a tier is indistinguishable from a busy day); a reserve as a share of the remaining count (it shrinks exactly when a reserve is needed).
