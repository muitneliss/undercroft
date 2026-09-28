# What an ingest run counts

Each ingest run reports five numbers for every entity it read. The Journal's run detail shows
them in its "By entity" table, and `runs get` returns them over the CLI and MCP. Both read the
same row in `ops.run_entity`. The worker writes that row once, when the run settles, so the
two surfaces cannot disagree.

| Column    | Field       | Counts                                                                        |
| --------- | ----------- | ----------------------------------------------------------------------------- |
| Landed    | `landed`    | records this run read that reached the raw lake: New + Changed + Unchanged    |
| New       | `created`   | records the lake had never held before, stored as their first version         |
| Changed   | `changed`   | records the lake already held whose content differs, stored as a new version  |
| Unchanged | `unchanged` | records identical to the newest version the lake holds, so nothing was stored |
| Refused   | `refused`   | records that could not be landed, each listed with its reason; not in Landed  |

**Landed = New + Changed + Unchanged, for every entity of every run.** All four count
records, and only the records this run read. The run's totals on the run list are the same
columns summed over its entities.

A record that is read again with the same content counts as Unchanged. The lake stores
nothing new for it, and the version already stored keeps its content and its observation
time.

A run that is stopped partway, by a deploy or by a person, keeps the counts of what it landed
before it stopped, and those counts still add up. A run that could not record its counts at
all, because the worker was killed or was shut down before the run reached a point where it
could stop, shows zeroes that are not a count, and its error says so.

## Two places the split is coarser

- **Documents** (Gmail attachments, Drive files) are counted beside the records as their own
  entity, `documents`. A document whose content differs from the stored one is counted as
  New, not Changed. Landed = New + Unchanged there, because Changed is always 0.
- **A lake API batch** (`POST /v1/lake/records`) answers in its own published shape, where
  `created` is every record stored as a new version, first or not. The totals of the run it
  is recorded under still split New and Changed.

## Where the numbers come from

The worker decides each record's column when it writes the record to the raw lake, in
`apps/worker/src/services/land.ts`. The projection into `raw.records` runs afterwards and does
not decide any of these numbers.

Runs recorded before the fix for issue #284 counted New, Changed and Unchanged from that
projection instead. It saw only records the lake actually stored, so on those runs a record
read again unchanged is in Landed and in no other column. Those rows are kept as they were
recorded and are not corrected.
