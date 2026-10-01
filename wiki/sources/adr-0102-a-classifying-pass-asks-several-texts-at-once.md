---
title: ADR 0102 A Classifying Pass Asks Several Texts at Once
type: source
date: 2026-10-01
tags: []
source: docs/adr/0102-a-classifying-pass-asks-several-texts-at-once.md
source_path: docs/adr/0102-a-classifying-pass-asks-several-texts-at-once.md
source_hash: 66f7b9738a7fd89284124483575037f2790d1df77175a7f653371a16c5851dd5
ingested: 2026-10-01
---

# ADR 0102 A Classifying Pass Asks Several Texts at Once

A classifying pass keeps several Jev calls in flight instead of one, superseding [[ADR 0085 A Document Is Classified Into Its Tenants Own Catalogue Of Kinds]] on two points only: "one call per digest, sequentially" and the batch of 500 digests.

Context. jev-1.13.0 costs $0.042 per million input tokens (output free), billed once per call however many questions it asks, and allows 40 requests and 100K tokens a second per key. One call at a time (\~0.5 s, \~3,000 tokens) used about 5% of that. A first classification of tai-001's \~51,000 texts costs ~~150M tokens (~~$6.30, the same on every publish) and took \~102 half-hourly ticks, about 51 hours of wall clock. The cost of a re-classification is time, not money. What a sync sends is unchanged: only a digest with no answer, an answer to a replaced catalogue, or a provider error is due.

Decision. (1) `IN_FLIGHT = 6` calls per run in `apps/worker/src/services/semantic/classify.ts`, through one helper, `services/semantic/inFlight.ts`, which the initialising sample also uses. With the default two semantic runs (`UNDERCROFT_MAX_CONCURRENT_SEMANTIC`) that is at most twelve calls, \~24 requests and \~36K tokens a second, under the limits; a 429/529 is retried by the SDK, and one that outlives the retries is a `provider-error` row asked again. (2) A stop starts no new call; calls in flight finish and are written, so a paid answer is never dropped. A defect is handled the same way: nothing more starts, then the error is thrown. (3) `DEFAULT_BATCH` is 3,000 digests, \~4 minutes a run; tai-001's first classification drops to \~17 ticks (\~8.5 h) for the same tokens. Memory is \~60 MB on average and \~200 MB in the worst case, inside the worker's 3 GB.

Consequences: a publish shows within a working day; a rise in `http-429` provider errors is the signal to lower `IN_FLIGHT` or the run limit; `task db:semantic-probe` still asks one at a time, because it measures the provider rather than our queueing. Rejected, after weighing the TypeSafe patterns: a short-prefix-then-full-text cascade (saves \~$3 a publish; measure first with the probe), speculative fan-out of extra questions (no consumer yet), falling back to a broader group on low confidence (a product decision needing groups in `DOCUMENT_KINDS`), hierarchical classification (several times the tokens), many more calls in flight (429s rather than speed), and an environment variable for the bound.
