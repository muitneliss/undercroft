# 102. A classifying pass asks several texts at once

- Status: Accepted
- Date: 2026-10-01
- Supersedes: [ADR 0085](0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md)
  decision 5 on two points only -- "one Jev call per digest, **sequentially**" and the batch of
  **500** digests. Everything else in ADR 0085 stands.

## Context

ADR 0085 asked Jev one text at a time, and the flow's comment said that starting more would "only
queue them at the provider". The provider's published limits say otherwise. For `jev-1.13.0`
(docs.typesafe.ai/models, read 2026-10-01):

- **$0.042 per million input tokens**; output is free. A call is billed once for its state,
  however many questions it asks (`cookbooks/parallel_questions`).
- **40 requests and 100K tokens a second** per key, "adjusting dynamically".

One call at a time, at the measured p50 of ~0.5 s and ~3,000 input tokens, is about 2 requests
and 6K tokens a second. That is **about 5% of the allowance**. A first classification of
`tai-001`'s ~51,000 texts costs about 150M tokens, which is **~$6.30**, and the same again on
every publish. At 500 texts a tick every 30 minutes it took **~102 ticks, about 51 hours** of wall
clock. (ADR 0085's "seven hours" counted the time spent in calls, not the ticks between them.)

The cost of a re-classification is therefore not money. It is the two days a tenant waits for
its documents to carry the kinds it just published.

What a sync sends is unchanged: only a text whose content digest has no answer, an answer to a
replaced catalogue, or a provider error is due (`DUE_JOIN`). Speed matters on the first
classification and after a publish, when every text is due at once.

## Decision

1. **A pass keeps six calls in flight** (`IN_FLIGHT` in `services/semantic/classify.ts`), through
   one helper, `services/semantic/inFlight.ts`, that the initialising sample uses too. With the
   worker's default of two semantic runs at once (`UNDERCROFT_MAX_CONCURRENT_SEMANTIC`), that is
   at most twelve calls: ~24 requests and ~36K tokens a second. Both stay under the limits, with
   room left for limits the provider says it moves. A 429 or 529 is retried by the SDK with
   backoff. One that outlives the retries is a `provider-error` row, which the next run asks
   again, as before.
2. **A stop starts no new call, and the calls in flight finish and are written.** An answer that
   has been paid for is not dropped, which is the promise ADR 0085's "written as it goes" made.
   A defect is handled the same way: nothing more starts, the calls in flight settle, then the
   error is thrown.
3. **A run reads 3,000 digests** (`DEFAULT_BATCH`), which at six in flight is about four minutes,
   the run length the 30-minute flow was sized for. A first classification of `tai-001` takes
   about 17 ticks, roughly **8.5 hours instead of 51**, for the same tokens. The batch holds at
   most 32,000 characters a text: ~60 MB at the average length and ~200 MB in the worst case,
   inside the worker's 3 GB limit.

The token cost is unchanged: the same texts are asked the same question, once each.

## Consequences

- A publish is visible in a tenant's kinds within a working day rather than over a weekend.
- The provider sees bursts of up to twelve concurrent requests from one key. If its limits fall
  below that, `provider-error` rows with `http-429` will rise in the run's counts, which is the
  signal to lower `IN_FLIGHT` or `UNDERCROFT_MAX_CONCURRENT_SEMANTIC`.
- `task db:semantic-probe` still asks one text at a time on purpose: it measures the provider's
  speed, not our queueing.

## Options rejected

The TypeSafe patterns (docs.typesafe.ai/patterns) were each weighed against this workload:

- **A cascade: ask on a short prefix first, and on the full text only below 0.90 confidence.** It
  would save perhaps half the tokens, about $3 a publish. In return, a quarter of texts would
  make a second call, and each result would need a column for which stage answered it. Measure
  agreement first, with `task db:semantic-probe` at a short `maxChars` against 32,000, and build
  it only if publishes become frequent enough for the dollars to matter.
- **Speculative fan-out** (language, contains personal data, needs review, asked in the same
  call). Nearly free, since the state is paid once, but nothing consumes the answers yet. It
  belongs with the feature that needs them.
- **Falling back to a broader group when confidence is low** (the
  `classification_using_confidence` cookbook). This needs groups in `DOCUMENT_KINDS` and a change
  to `raw.document_kinds`. It is a product decision, not a speed one.
- **Hierarchical classification** (a choice per level, beam search). It costs one call per level
  per beam, which is several times the tokens of the flat choice. The flat 38-kind choice
  already left 0.7% of texts `other`.
- **Many more calls in flight.** Twenty or more per run would put two runs over 40 requests a
  second, and the cost would show up as 429s rather than speed.
- **Concurrency set by an environment variable.** The bound is a fact about one provider's
  limits and the run count beside it. A constant with its arithmetic in the docstring says why;
  a variable would not, and `UNDERCROFT_MAX_CONCURRENT_SEMANTIC` already lets an operator turn
  the total down.
