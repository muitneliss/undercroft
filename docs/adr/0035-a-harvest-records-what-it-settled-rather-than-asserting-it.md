# 35. A harvest records what it settled, rather than asserting it

- Status: Accepted
- Date: 2026-09-22

## Decision

`raw.records` gains a nullable `documents_landed integer`
(`packages/db/sql/230_documents_landed.sql`). A collector counts the documents that actually
reached the lake and the catalogue beside a record, the record sink records that count against
the row after it has projected the chunk, and `knownRecords` holds a record only when the
column is **not null**.

Three consequences, each load-bearing:

- **A row written before this column existed says nothing, so it is not held.** It is read once
  more, its documents land, and it is marked. That is the whole repair: no `DELETE` (the worker
  holds none on `raw.records`), no hand-run SQL against a customer's database, and no operator
  step to forget.
- **The count is what LANDED, never what was matched.** A document refused for its declared size
  never becomes a `raw.documents` row and never will. A message whose only attachment was too
  large settles zero documents, honestly, and is complete.
- **The column is written by `markHarvested`, not by the projection.** It is the one column in
  `raw.records` that is not a projection of the lake, and that is not an oversight — see below.

ADR 0033 is Accepted and stands. What this supersedes is one sentence of it: "Together these
make 'present in `raw.records`' mean 'fully harvested', which is the invariant that makes
skipping safe at all." The invariant is now carried on the row and checked, rather than asserted
about code.

## Why

v1.15.0 shipped skip-known. The ordering rule that made it safe — a record's documents land
before the record — binds the rows that rule wrote. It says nothing at all about the rows
already in the table, and on any tenant that had run before the release, that is every row.

The rows already in the table were written by the OLD order: `landRecords`, then
`loadStreamToRaw`, then `landDocuments`. The ingest oom-killed on 2026-09-21 (ADR 0033)
completed the first two and died before the third. So one tenant's `raw.records` holds 7,786
Gmail messages and `raw.documents` holds **zero**, and the invariant is false for every one of
them.

The run the operator triggered after the fix said so plainly, and said it while reporting
success:

```
work_listed       total:7786  skipped:7786
entity_done       messages  landed:0  skipped:7786
documents_landed  created:0
```

Every message skipped on presence, no attachment ever fetched, and nothing about it
self-corrects — the next run does the same thing for the same reason, for ever. The operator's
report was "I can see rows in records but nothing in documents".

This is not a coding slip, and treating it as one is how it happens again. It is the shape of
every invariant a codebase **asserts** rather than **records**: the assertion is true of the
code that carries it and is applied to data that code never touched. A green gate cannot see
it, because there is nothing about the new code that is wrong.

### Why the fact cannot ride in the lake manifest

The obvious place is the lake manifest — `extra` on `LakeStore.put`, which does not affect the
content hash, so carrying a count there re-lands nothing and costs no storage. It was the first
design, and it does not work.

The lake is **idempotent by content** (`.claude/rules/raw-lake.md`): re-storing identical bytes
writes nothing and reports `unchanged`. So a re-landed record produces no new version, therefore
no journal entry, and `loadStreamToRaw` projects from the journal. A legacy Gmail record read
again produces byte-identical canonical JSON — `messageRecord` builds its payload from the id,
thread, labels, headers and internalDate, none of which move — so nothing is written, nothing is
projected, the column stays NULL, and the message is re-read **on every run for ever**: the same
43 minutes the whole of ADR 0033 was about, bought back by its repair.

A fact that changes while the bytes do not has no way through a content-addressed store. It
follows that the marker must be written by whoever knows the fact, after the projection has put
a row there to write it on. That writer is the record sink, through `markHarvested` in
`apps/worker/src/repos/rawRecords.ts` — the repo that owns this table group, so `raw.records`
still has one module writing it (`.claude/rules/layering.md`).

The cost of that is worth stating rather than discovering: rebuilding `raw.records` from the
lake, which `raw-lake.md` says is always allowed, leaves every row NULL and so re-reads every
source once. Slow, never wrong — the direction this area is built to fail in, and the same
caveat ADR 0033 already records for the rest of the table.

### Why counting what landed, and not what was matched

A marker that meant "every part this message matched has a row" would be a second bug wearing
the shape of a fix. `MAX_DOCUMENT_BYTES` refuses an attachment on its _declared_ size, before
any fetch; that refusal is deterministic and will be identical on every future run. Such a
message would therefore be short of its own target for ever and re-fetched for ever —
unharvestable rather than incomplete, which is exactly the failure ADR 0033 already refused on
the landing side, arriving through the other door.

Drive makes the same point more sharply, because there every file _is_ a document: an oversized
Drive file legitimately lands a record with no catalogue row at all. Counting what landed gives
it a mark of zero, which is the truth and is a complete harvest.

Nothing compares the stored count against reality today, so a wrong count would be inert and
invisible. That is precisely why the column's **value** is asserted in the tests rather than only
its not-null-ness.

### A second defect found on the way, and fixed here

`DocumentSink.flush` answered only for the chunk that call itself landed. But a full buffer
lands on its own inside `add`, and that outcome was discarded — so on a mailbox of one attachment
per message, where the document buffer and the record buffer fill at the same moment, `flush`
reported an empty set at exactly the moment the caller asked. Every record in that batch was
released regardless of how its attachment had fared, which is the ADR 0033 loss reappearing
above 200 messages.

The sink now accumulates what settled since the caller last asked, and `flush` drains it. Pinned
by a test over more than one chunk, with one attachment refused; under one chunk the bug cannot
occur, which is why the test is over one.

## Cost

**Every existing Gmail and Drive tenant re-reads its source exactly once.** For the 7,786-message
mailbox that is the 43 minutes of paced `messages.get` ADR 0033 described — spent once, to land
the attachments that should already be there. Every run after it skips as before. This is the
intended behaviour of the repair and not a side effect of it.

**A record refused in the lake is never marked**, so an old row for the same id — from a run
before this change — stays unmarked and is read again. Deliberate: marking on a landing that
failed would claim this run finished a message it refused.

**The count is evidence, not a constraint.** Nothing reads its value yet. It is a count rather
than a boolean because `documents_landed = 0` across 7,786 rows is the sentence this outage
could not say, and because a boolean would have been the same shape of unverified claim that
failed.

## Options rejected

- **Reconcile the stored count against `raw.documents` on every probe.** The strongest-looking
  option, and it would also self-heal a catalogue row lost later. Rejected on three counts.
  There is no join key: a Gmail document id is `messageId:partIndex` and the link to its record
  lives in `metadata->>'messageId'`, so the statement would have to know what one collector's
  ids look like — a repo deciding something, and a collector's knowledge leaking two layers
  down. It contradicts the tombstone pass: `tombstoneMissing` marks a Drive document the source
  dropped while its record row remains, so count-versus-rows would disagree for ever and
  re-download that file every run. And it buys nothing for the outage — the not-null marker
  already re-reads all 7,786 — while the case it would additionally cover has no evidence behind
  it and would be repaired by rebuilding `raw.documents` from the lake rather than by re-fetching
  from Google.
- **Delete the affected rows and let skip-known re-read them.** The instinct, and the reason it
  is refused is in `.claude/rules/privileges.md`: the worker holds no `DELETE` on `raw.records`,
  and a repair that needs a human with a superuser connection against a customer's database is
  not a repair — it is an incident with an audience. A defect in shipped code should be fixed by
  shipping code.
- **A boolean `harvest_complete`, or a schema-version column.** Same width, same cost, strictly
  less said. A count answers "how many" for an operator reading the table during an incident;
  neither of the others does.
- **Add the count to the record payload.** Rejected outright: the payload is content-addressed,
  so every one of the 7,786 records would land as a new lake version carrying no new information
  about the source, and the lake's history would record our own bookkeeping as if it were the
  customer's data.
- **Date the rows — treat anything observed before the release as legacy.** Rejected: a
  hard-coded cutoff is unverifiable, does not generalise to the next time a landing contract
  changes, and says nothing about the one row that matters.
- **Amend ADR 0033.** Refused by convention and by preference. Its reasoning was right about the
  hazard and right about the ordering; what it missed is that an invariant applies to the data,
  not to the code. Editing it to look as though it had always said so would delete the only
  evidence that this failure mode is easy to miss.
