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

## Held records a run read again

A Gmail run reads a message it already holds when that message carries an attachment the
current file-type choice allows and no earlier read landed
([File formats](file-formats.md#when-the-choice-changes)). The run's `messages` entity then
carries `reread`, with two counts:

| Field       | Counts                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| `records`   | held messages this run read again                                               |
| `documents` | attachments that reading stored for the first time, also counted in `documents` |

`reread` is `null` on every other entity, on every Drive and spec run, and on runs recorded
before ADR 0076. A Gmail run that read nothing again says `0` for both counts. The Journal says
the same two numbers in its own line.

## Drive folders

A Drive run also reports `folders`: the folders its walk listed, each landed as a record that
names only its id and the folder that listed it (ADR 0078). A folder is landed again only when
that changed, so an unchanged tree counts nothing there. The run's `files` entity never
counts a folder.

A Drive file whose bytes are already held is not downloaded again, but its record is landed
again when it changed, for instance when the file was moved. It then counts as Changed on
`files` and adds nothing to `documents`.

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
