# 82. A connection re-syncs on its own schedule, within a daily request budget

- Status: Accepted
- Date: 2026-09-29
- Supersedes, in part:
  [ADR 0080](0080-a-list-whose-change-filter-cannot-see-every-change-is-read-whole-on-a-bound.md).
  Its spec field `incremental.wholeReadAfterHours` and the 24 hours `xero.yaml` declared with it
  are removed. What stands is its reason: Xero's change filter cannot see every change. So do
  `raw.sync_cursor.whole_read_at` as the start of the run that last read a list whole, and the
  one scheduler tick of slack for a preset.

## Context

ADR 0080 read every incremental Xero list whole once a day, and the day was written into the
spec. Two things were wrong with that.

**How often to re-sync is the customer's choice, not the connector's.** A whole read of a large
organisation spends much of the day's Xero requests. Whether it is worth that, and how often, is
decided by whoever reads the lake: someone who builds an aging report needs due dates to be
current; someone who reads only totals by month may not care. A fixed 24 hours made that
decision for everyone.

**Nothing bounded what whole reads spend.** Xero allows 5,000 requests a day per organisation
([OAuth 2.0 API limits](https://developer.xero.com/documentation/guides/oauth2/limits)). The
runtime's `requestsPerDay` is counted inside one process, per entity, and forgotten after each
run. A whole read that met Xero's limit got a 429, retried, and failed the run. The "what
changed" reads that should have kept the lake current were then starved as well.

## Decision

**A connection has a re-sync schedule: `ops.connection.resync_cadence` and `resync_cron`.** It
mirrors `cadence` and `cron` exactly: the same presets, `custom` with a five-field expression in
Singapore time, the same two CHECKs, and the same `cadenceSetting` check before it is written. It
is set on the Sources card beside the sync schedule, with the same control, or through
`connections.setResync` (CLI `connections set-resync`, MCP `connections_setResync`). **It is
`paused` by default: a re-sync is opted into.** A source that reads no list through a change
filter the source runs has nothing to re-sync. HubSpot is one: its client-side filter pages the
whole source anyway. `setResync` refuses such a source (`not-resyncable`), and its card shows no
re-sync row.

**A list is due for a whole read by `wholeReadDue`** in `@undercroft/contracts`. That is the rule
the sync cadence follows (`followingRunFor`), applied to the start of the run that last read the
list whole instead of the last run. A preset gets one scheduler tick of slack, because a run can
start up to one tick after the moment it became due (ADR 0080). A cron gets none, because it is
due at an instant. A list never read whole is always due, and a paused re-sync is never due. A
re-sync only happens during a sync run: nothing new is scheduled. So a paused sync means no
re-sync, and the card says so.

**Whole reads spend a daily budget written in the spec: `defaults.wholeReadBudget`.** Xero's
gives whole reads 4,000 of its 5,000 requests a day. The other 1,000 are the reserve for "what
changed" reads and **Run now**. A whole read covers a first read, a changed request (ADR 0072)
and a re-sync, because they are the same thing to the provider. The budget sits beside
`rateLimit`, not inside it, because `rateLimit` is also a per-entity override and a day's budget
per list would mean nothing. The schema refuses a budget that does not leave a reserve below
`rateLimit.requestsPerDay`.

**The count trusted is the provider's own.** Xero reports what the day has left in
`X-DayLimit-Remaining` on every response (`wholeReadBudget.remainingHeader`). That number already
includes retries, Xero's own window (fixed per organisation, reset at a time nobody tells us) and
every other app reading the same organisation. A count of our own could see none of these. A
whole read may make another request while the remaining count is above the reserve. Before any
response has reported it, a run falls back to its own whole-read requests, capped at the budget.
It never counts across runs: yesterday's count says nothing about a window we cannot see.
`dayBudget.ts` in the worker holds one budget per run, because the day belongs to the
organisation, not to one list.

**The runtime asks and reports, and the caller decides.** `RunContext.budget` has two
functions. `admit()` is asked before each page of a list and each chunk of a relation. `spent()`
is told each response's headers, retries included. A refusal ends the read as a truncated one.
What it read is kept, `ReadEnd.exhausted` says why it stopped, `listed` is `null` and no
end-of-entity guard runs. An empty first page is not an empty source when that page was never
asked for. The runtime does not ask before the further pages of one record, because stopping half
way would land that record short.

**A budget cut is not a failure, and the list resumes whole on a later run.** The worker decides,
per list, one of three things:

- **Read it whole,** under the budget. This applies when the list has no watermark for this
  request or `wholeReadDue` says so, and the day has room.
- **Read what changed,** from the reserve. This applies when a whole read is due and the day has
  no room, but a watermark exists. Ordinary edits still arrive.
- **Wait:** do not read the list at all this run. This applies when it has no watermark to fall
  back on and the day has no room. The journal says so (`whole_read_waiting`), and the list
  counts as read, so a run of waiting lists does not read as a grant that reaches nothing.

A whole read the budget cuts short lands what it read and saves no cursor, so the list is still
due on the next run. The journal records `whole_read_paused` with the requests it spent, and the
run closes `ok`. A failed run would have alerted the operators for a provider doing exactly what
its limits say. A list resumes from its start, not from a page. At 500 records a page, one list
needs about 2 million records before one day's budget cannot hold it, and Xero refuses a request
that has to process more than 100,000 documents long before that
([Efficient data retrieval](https://developer.xero.com/documentation/api/efficient-data-retrieval)).
So a re-sync spans days only when the day was already partly spent: by other lists, by other runs
or by other apps. Remembering a position inside a list would have to trust Xero's page order,
which ADR 0034 records as unreliable.

**The card says what a re-sync costs.** `raw.sync_cursor.whole_read_requests` records what each
list's last completed whole read cost. The card sums them over the lists the connection reads,
divides by the budget, and says "a full re-sync takes about N days" when N is more than one. It
also says when the stalest list was last read whole. The control plane may read five columns of
`raw.sync_cursor` for this, none of them the watermark. The grant is column-scoped in
`380_connection_resync.sql`.

**Xero's lists page at 500,** half of Xero's maximum of 1,000. A whole read costs a fifth of the
requests it did at 100. The changed request makes every paged list read whole once after deploy
(ADR 0072), under the budget.

## Consequences

- After the deploy, every Xero connection's re-sync is off. Each paged list is read whole once,
  because its request changed, and after that nothing is re-read on a schedule until an admin
  turns the re-sync on. Where it stays off, the edits Xero's filter cannot see (#314) stay stale
  until the record changes for some other reason. The Xero runbook says so.
- A new Xero connection's first read spends at most 4,000 requests a day. A large organisation's
  first read therefore finishes over several runs instead of failing on Xero's 429.
- A run that meets the day's budget closes `ok` with a warning in the journal, not `failed` with
  an alert.
- The card's estimate is empty until every list the connection reads has completed one whole
  read since this change. Before that there is no measured cost to show, and a guess would be
  rule 2 broken.
- Xero's refusal of requests that have to process more than 100,000 documents is untouched. An
  organisation that large still fails its first read, and needs a narrower request per call. That
  is separate work (#322).

## Rejected

- **Keep the interval in the spec, with a per-connection override.** Two owners for one fact. The
  spec's default would be a decision about a customer's data taken by whoever wrote the
  connector.
- **Resume a cut whole read at the page it stopped on, or at the highest stamp it reached.** A
  page number moves when a record is edited mid-read. Resuming from the stamp needs the list
  ordered by that stamp: Xero documents that order only for some lists, and ADR 0034 found it
  unreliable. With 500 records a page, restarting a list costs little, and a whole read of a list
  never depends on the order.
- **Count our own requests across runs, in a table.** It misses retries in a run that failed,
  other apps on the same organisation, and Xero's window, which resets at a time it does not
  publish. The provider's header has all three.
- **Re-sync on a count of runs.** Cadences range from five minutes to paused, so "every N runs" is
  a different time on every connection. A person reads a schedule, not a count.
- **Default the re-sync to daily for Xero.** It spends requests on an organisation's behalf that
  nobody chose to spend. The runbook says what leaving it off costs.
