# 80. A list whose change filter cannot see every change is read whole on a bound

- Status: Accepted
- Date: 2026-09-29
- Extends: [ADR 0034](0034-the-watermark-is-a-table-not-a-max.md) and
  [ADR 0072](0072-a-watermark-is-keyed-on-the-request-as-sent.md). Both stand: a watermark is
  still handed back only under the format it was written in and for the request it was read
  with. This adds a third reason to refuse it: its age.

## Context

After its first run, every paged Xero list asks only for what changed since its watermark, with
`If-Modified-Since`. Xero's own documentation says that header cannot see every change
([Requests and Responses](https://developer.xero.com/documentation/api/accounting/requests-and-responses),
"Retrieving modified resources"):

> Not all changes will trigger a change of the UpdatedDateUTC field. These include changes to
> partially paid transactions which don't generate a journal such as DueDate or SentToContact,
> and Contact fields pulled from other sources such as Balances, IsSupplier, and isCustomer. As a
> result, transactions with these changes may not be returned with an If-Modified-Since query.

The Contacts page repeats it for `Balances`, `IsCustomer` and `IsSupplier`. Both lists say "such
as", and they are not complete: Fivetran documents that a line's `AccountCode` does not move
`UpdatedDateUTC` either. So a due date moved on a partially paid invoice stayed in the lake as
it was first read, every run reported success, and an aging model bucketed the invoice by the
old date (issue 314). Nothing forced a whole read except a change to the request (ADR 0072).

What others do, as documented: Fivetran re-reads Xero contacts whole once a day and reads
invoice changes from Xero's webhooks, which it added because `SentToContact` edits were missed.
Airbyte and Singer's tap-xero filter on `UpdatedDateUTC` alone and miss the same edits.

## Decision

**An incremental entity may declare `wholeReadAfterHours`.** A run reads such an entity whole,
sending no watermark, when the run that last read it whole started that many hours before this
one did, less one scheduler tick. Every Xero list read on `If-Modified-Since` declares 24.

- **The time is a run's start, kept in `raw.sync_cursor.whole_read_at`.** Any read that sent no
  watermark records the start of the run that made it. That covers a first read, a changed
  request and a read the bound forced. The cadence's due rule measures the gap between run
  starts too (`cadence.ts`). A time taken when the write happened would put a daily source's
  last whole read ten minutes short of a day old on every run, for a read that takes ten minutes.
- **One tick short, because a cron fires at an instant and the tick is how late a run may
  start past it.** Two runs of `0 9 * * *` can start a few minutes less than 24 hours apart.
  Measured exactly, the second would trust the mark, and the list would be read whole every
  second day.
- **The refusal is the same `null` `readSyncCursor` already answers.** A run that is given no
  watermark reads whole whatever the reason, so the caller has nothing new to decide.
- **A whole read is idempotent in the lake.** A record nobody edited lands as `unchanged`. One
  edited without moving its stamp lands as `changed`. The run's counts show both.

The bound this gives, per list, is the one the Xero runbook states. A value Xero changes without
moving `UpdatedDateUTC` reaches the lake within 24 hours plus one run interval, each run
starting up to one tick late: at most 25 hours on the hourly cadence and 30 every six hours. On
the daily cadence every run reads whole, since two daily runs start at least a day apart, so the
bound is one day. A paused source reads whole on its first run a day after its last whole read,
whenever that is.

## Consequences

- Every cursor written before this change has no whole read on record. The first run after the
  deploy reads each Xero list whole once, which also repairs any value that has already gone
  stale. No reconnect is needed.
- A whole read costs, per list, one request per 100 records plus the empty page that ends it,
  at Xero's 1.1-second spacing. That happens once a day, against 5,000 requests a day per
  organisation.
- Xero refuses a GET that has to process more than 100,000 documents
  ([Efficient data retrieval](https://developer.xero.com/documentation/api/efficient-data-retrieval)).
  An organisation that large already fails its first read. It would now also fail the daily
  whole read, and the run says so rather than keeping a stale value quietly. Reading it at all
  needs a narrower request, which is separate work.
- `Balances` on a contact remains Xero's own snapshot, converted to the base currency. It moves
  with every payment and with the passage of time, so even a daily read is a day old at worst.
  A model should derive outstanding and overdue amounts from invoices, where the currency is
  explicit (`money.md`).

## Rejected

- **Xero's webhooks.** Fivetran uses them, and a webhook would shorten the delay. It needs a new
  public endpoint that verifies Xero's signature, a key per Xero app, and a second way in that
  must still reach the lake through the one writer. Xero disables a webhook after 24 hours of
  failed deliveries, so it cannot promise a bound alone. It may come later, on top of this.
- **Re-read open invoices (`Statuses=AUTHORISED`) on every run.** It is cheap and is the filter
  Xero optimises. But it covers only the invoice half of the note: not contacts, not an
  `AccountCode` edited on a paid invoice, not the edits nobody has listed. It can be added later
  to tighten the bound for due dates.
- **A bound counted in runs.** Cadences range from five minutes to paused, so "every N runs" is
  a different time on every source. The issue asks for a bound a person can read.
- **`where=UpdatedDateUTC>=…`.** It reads the same field, so it misses the same edits, and Xero
  calls it unoptimised.
