# 83. Xero's whole-read budget is sized for the starter tier

- Status: Accepted
- Date: 2026-09-29
- Supersedes, in part:
  [ADR 0082](0082-a-connection-re-syncs-on-its-own-schedule-within-a-daily-request-budget.md).
  Its numbers for Xero, a day of 5,000 requests of which whole reads take 4,000, are replaced.
  The mechanism it decided stands unchanged.

## Context

ADR 0082 wrote Xero's day as 5,000 requests and gave whole reads 4,000, keeping 1,000 in reserve.
A whole read may make another request while Xero's `X-DayLimit-Remaining` is above the reserve.

Xero allows 5,000 requests a day only on its higher tiers. An app starts on the starter tier, which
allows 1,000 ([OAuth 2.0 API limits](https://developer.xero.com/documentation/guides/oauth2/limits)).
On that tier the remaining count can never be above a reserve of 1,000 once the first response
reports it. So no whole read was ever admitted past its first request.

The first run on v1.48.0 showed it. The new page size had changed every paged list's request, so
none held a watermark it could fall back on. Invoices, payments, credit notes, purchase orders,
overpayments, prepayments, bank transactions and manual journals all waited, and would have
waited on every run after. Contacts stopped after one request. The organisation had spent about
400 requests that day across seven runs, which is consistent only with a 1,000-request day.

## Decision

**Xero's day is 1,000 requests, and whole reads may spend 800 of it.** The reserve is 200.
A daily sync of every list costs about 35 requests, so 200 is ample for it and for Run now.

The numbers are sized for the smallest tier because the error is not symmetric:

- A budget sized for the larger tier on a starter app admits no whole read at all.
- A budget sized for the starter tier on a larger app only reads whole a little more slowly.

An organisation whose app has moved to a higher tier raises both numbers in `xero.yaml`.

## Consequences

- A whole read of the organisation that showed this needs about 30 requests at 500 records a
  page, so it finishes in one run.
- An hourly Xero sync on the starter tier costs about 840 requests a day. That is more than the
  starter tier can spare, whatever the whole-read budget says. This is Xero's limit, and a
  connection on that tier should sync daily or every six hours.

## Rejected

- **Read the tier from the provider.** Xero reports what is left, never the size of the day, so
  the tier cannot be told apart from a busy day.
- **Size the reserve as a share of the remaining count.** A share of a number that falls as the
  day is spent is not a reserve: it shrinks exactly when a reserve is needed.
