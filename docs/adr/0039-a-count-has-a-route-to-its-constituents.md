# 39. A count has a route to its constituents

- Status: Accepted
- Date: 2026-09-22

## Context

On 2026-09-22 an operator read `255 bản ghi · 245 bị từ chối` off a run's flow rail and could
not find out what the 245 were. Answering it took an SSH session and seven `psql` queries; the
answer was 230 email signature images under the OCR size gate, 14 blank scans and one legacy
`.doc` — a healthy run draining a backlog left by a deploy four minutes earlier.

Three separate defects made that unanswerable in the browser:

1. **The `extract` verb recorded no refusals.** `runExtract` wrote each reason to
   `raw.document_text.reason` and nothing to `ops.run_refusal`, so `ops.run.refused` said 245
   while the ledger held nothing behind it. `RunDetail` gates its refusals table on
   `refusals.length > 0`, so the section was not drawn at all — the count appeared in the one
   place that could not explain it. This broke PRODUCT.md principle 3 ("refusal is a
   first-class outcome") for one verb, silently, with the gate green throughout.
2. **Nothing recorded how deep the queue was.** A run refusing 245 of 500 with 2,337 waiting
   behind it is draining a backlog; the identical run with nothing behind it is a fault. The
   two rendered alike.
3. **Nothing recorded which build produced a run.** The run at 10:07 stamped
   `reader_version 2` and the one at 09:07 stamped `0`, because a deploy landed at 10:03. That
   was discoverable only by `docker inspect`.

## Decision

**Every number the journal prints has a route to what it is made of.** This is the Absence
Rule one level up: an em dash rather than a zero, and never a figure that leads nowhere.

- **`runExtract` records what it refuses** — into `ops.run_refusal` and `ops.run_entity`, as
  `ingest` already does. The id is the provider's own opaque document id; a filename stays in
  the lake manifest (`pii.md`) and does not come back out.
- **A rollup outlives the records.** `ops.run_refusal_reason` holds one row per distinct
  reason per run and is **never pruned**; `ops.run_refusal` holds one row per record and is
  pruned at **7 days**. Without the split, retention reintroduces the very defect this ADR
  fixes, delayed: a month-old run would print `refused: 245` over an empty table. With it, a
  year-old run still answers "230 of them were images too small to read" and loses only the
  individual ids. The permanent half costs ~3–8 rows per run against ~245.
- **Pruning is opportunistic and named.** `ops.prune_run_refusals` is called by the verb that
  writes the rows — one `DELETE` does not earn a scheduler — and returns what it removed so
  the journal can say so. A store that prunes silently cannot be told from one losing data.
- **`ops.run.pending_before` is an observation, not a derivation.** It is stored at run time
  because recomputing it later answers a question about today and dates the answer wrongly to
  the past. `NULL` means "this verb has no queue to report", never 0.
- **`ops.run.release_tag` is baked into the image, not read from the deploy pointer.** CI
  pushes `v1.16.0` _and_ `latest`, and Dokploy tracks `latest` deliberately so there is never a
  version to keep in step by hand and no mismatch to chase. The cost of that choice is that the
  pointer names no version, so the version rides inside the artifact as a build arg
  (`deploy/Dockerfile.*`). A build cut from no release stamps its commit. `""` means "this
  build did not say" — never a guess.
- **A refusal reason is words, then a code, then a severity.** `refusalReasons.ts` gives every
  reason a sentence, a next action, and one of two severities. `benign` is a fact about a
  document nobody can act on; `act` is a fact about this deployment somebody can. There is
  deliberately no third value: a "maybe" is read as an act by the anxious and a benign by the
  tired. An unrecognised code renders as a visible gap and counts as `act`.

## Options rejected

- **Read extract's reasons from `raw.document_text` in the control plane.** No worker change,
  but it hard-codes one verb's storage quirk into the read path and points the control plane at
  a table whose column scope exists to keep `text` away from it (`pii.md`, ADR 0024). The hole
  was that the verb did not record; the fix is that it records.
- **Store only the rollup, never the per-record rows.** Cheapest, and it breaks principle 3
  literally — "a row the pipeline refuses is recorded with its reason" stops being true.
- **Prune both tables at 7 days.** Simplest retention, and it re-creates this ADR's defect on a
  delay, which is worse than the defect: it would look fixed for a week.
- **Recompute the backlog when the leaf is opened.** No new column, but the number then
  describes today rather than the run — a confident wrong answer instead of none.
- **Pin `IMAGE_TAG` to a version in Dokploy so the pointer names the build.** Rejected by the
  operators who run it: every release would need the panel changed to match, and a panel left
  on the previous version is a mismatch that is both silent and noisy to trace. The deploy flow
  is right; the artifact was the thing not carrying its own name.
- **Capture the worker's stdout into a queryable store.** It would genuinely retire
  `docker logs`, and it is a log ingestion and retention subsystem with a new PII surface over
  raw text. Out of scope deliberately; this ADR is the structured ledger, enriched.

## Consequences

- A refusal count is now pressable, and the reasons under it are sentences an operator can act
  on rather than codes they must learn.
- Three states must stay distinguishable, and do: refused nothing (no band), refused with
  records (rollup, unfoldable), refused with records pruned (rollup, plus a sentence saying the
  per-document detail was cleared). The third showing an empty table would be this ADR's defect
  wearing a hat.
- `REFUSAL_RETENTION_DAYS` lives in `@undercroft/contracts/runs` because the worker prunes to
  it and the browser words it; two copies would drift, and the symptom would be a sentence
  naming a window no longer being applied.
- Every run now carries a release stamp, `ingest` and `transform` included, so "did this change
  with a deploy?" is answerable from the ledger alone.
- `ops.run_refusal` settles at ~41,000 rows instead of ~2M a year unbounded.
