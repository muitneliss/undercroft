/**
 * Facts about the run ledger that BOTH the worker and the browser have to agree on.
 *
 * Its own entry point rather than a line in `index.ts`, for the reason CLAUDE.md gives about
 * `@undercroft/core/locale`: the root barrel reaches `loadSpec`, which reaches `node:fs`, and a
 * browser module that imports it typechecks perfectly and fails Rollup outright. This file
 * imports nothing at all, so it is safe from either side.
 */

/**
 * How long a refused record keeps its own row in `ops.run_refusal`.
 *
 * The worker prunes to this (`services/extract/job.ts`) and the browser words the result
 * ("the per-document detail was cleared after 7 days") -- so it is one number in one place.
 * Two copies would drift the day one moved, and the symptom would be a sentence confidently
 * naming a retention window that is no longer the one being applied.
 *
 * SEVEN DAYS IS THE DETAIL ONLY. `ops.run_refusal_reason` -- the count per reason -- is never
 * pruned, which is what stops this retention from reintroducing the defect it lives inside a
 * fix for: a count with nothing behind it. `250_run_trace.sql` carries that argument in full.
 */
export const REFUSAL_RETENTION_DAYS = 7;
