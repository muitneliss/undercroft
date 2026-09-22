---
title: ADR 0039 A Count Has a Route to Its Constituents
type: source
date: 2026-09-22
tags: []
source: docs/adr/0039-a-count-has-a-route-to-its-constituents.md
source_path: docs/adr/0039-a-count-has-a-route-to-its-constituents.md
source_hash: 75bb88632e0cc6147f4222ad438d87cea3e89500e534953d35da2862b06e411b
ingested: 2026-09-22
---

# ADR 0039 A Count Has a Route to Its Constituents

Every number the journal prints must have a route to what it is made of -- the Absence Rule one level up: an em dash rather than a zero, and never a figure that leads nowhere. The ADR was written from a real failure on 2026-09-22, when an operator read `255 bản ghi · 245 bị từ chối` off a run's flow rail and needed an SSH session and seven psql queries to learn that the 245 were 230 email signature images under the OCR size gate, 14 blank scans and one legacy `.doc` -- a healthy run draining a backlog left by a deploy four minutes earlier.

Three defects made that unanswerable in the browser. The `extract` verb recorded no refusals: `runExtract` wrote each reason to `raw.document_text.reason` and nothing to `ops.run_refusal`, so `ops.run.refused` said 245 while the ledger held nothing behind it, and `RunDetail` gates its refusals table on `refusals.length > 0` so the section was not drawn at all. That broke PRODUCT.md principle 3 for one verb, silently, with the gate green throughout. Nothing recorded how deep the queue was, so a run refusing 245 of 500 with 2,337 waiting behind it rendered identically to one with nothing behind it. And nothing recorded which build produced a run, so a deploy landing at 10:03 that changed the 10:07 run's behaviour was discoverable only by `docker inspect`.

The decision has five parts. `runExtract` records what it refuses into `ops.run_refusal` and `ops.run_entity` as `ingest` already does, carrying the provider's opaque document id and never a filename. A rollup outlives the records: `ops.run_refusal_reason` holds one row per distinct reason per run and is never pruned, while `ops.run_refusal` holds one row per record and is pruned at seven days -- without the split, retention would reintroduce the very defect the ADR fixes, delayed, since a month-old run would print `refused: 245` over an empty table. Pruning is opportunistic and named, called by the verb that writes the rows and returning what it removed. `ops.run.pending_before` is stored at run time rather than derived, because recomputing it later answers a question about today and dates the answer wrongly to the past. `ops.run.release_tag` is baked into the image as a build arg rather than read from the deploy pointer, because CI pushes both the version tag and `latest` and Dokploy tracks `latest` deliberately, so the pointer names no version.

A refusal reason is words, then a code, then a severity. `refusalReasons.ts` gives every reason a sentence and a next action, and one of exactly two severities: `benign` is a fact about a document nobody can act on, `act` is a fact about the deployment somebody can. There is deliberately no third value, because a "maybe" is read as an act by the anxious and a benign by the tired. An unrecognised code renders as a visible gap and counts as `act`.

Rejected options include reading extract's reasons from `raw.document_text` in the control plane (it hard-codes one verb's storage quirk into the read path and points the control plane at a table whose column scope exists to keep `text` away from it), storing only the rollup (it breaks principle 3 literally), pruning both tables at seven days (it re-creates the defect on a delay, which is worse because it would look fixed for a week), recomputing the backlog on read, pinning `IMAGE_TAG` to a version in Dokploy, and capturing the worker's stdout into a queryable store.

Consequences: `REFUSAL_RETENTION_DAYS` lives in `@undercroft/contracts/runs` because the worker prunes to it and the browser words it. Three states must stay distinguishable -- refused nothing, refused with records, and refused with records pruned. Every run now carries a release stamp, `ingest` and `transform` included. `ops.run_refusal` settles at roughly 41,000 rows instead of 2M a year unbounded.
