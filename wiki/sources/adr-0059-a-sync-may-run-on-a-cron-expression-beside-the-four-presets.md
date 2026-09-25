---
title: 'ADR 0059: A sync may run on a cron expression, beside the four presets'
type: source
date: 2026-09-25
tags: []
source: docs/adr/0059-a-sync-may-run-on-a-cron-expression.md
source_path: docs/adr/0059-a-sync-may-run-on-a-cron-expression.md
source_hash: a8f5a9f42ac19acd47cf6b012eb0ecfaf196442d45f4dae8d559962f4c2a3014
ingested: 2026-09-25
---

# ADR 0059: A sync may run on a cron expression, beside the four presets

Accepted 2026-09-25. Supersedes the "no cron" reasoning that lived only in the docstrings of `packages/contracts/src/cadence.ts`, `packages/db/sql/100_cadence.sql` and `apps/ui/src/lib/cadence.ts`; no earlier ADR recorded it.

**Context.** A connection was read on one of four presets -- hourly, every six hours, daily, paused -- each a gap since the last run started, and Kestra's `ingest_due` asked the worker every fifteen minutes what was due. Cron had been refused on three grounds: Kestra owns the tick so a cron column is a promise nobody keeps, admins want presets, and a cron-to-prose translator wrong in two languages is worse than the five fields. The product owner asked for users to set the sync time themselves, which a gap cannot express ("07:30 on weekdays").

**Decision.** A fifth cadence, `custom`, carries a five-field cron expression in `ops.connection.cron`; a CHECK in `290_connection_cron.sql` keeps an expression beside `custom` and none beside a preset, and the four presets keep their meaning. The one rule is in `packages/contracts/src/cadence.ts` (on `croner` 10, browser-safe, imported by the UI as `@undercroft/contracts/cadence`): it checks an expression, lists its next fires and decides "due". Due means the first fire strictly after the last run started, so a missed fire is caught up by exactly one run; a never-run pair is due now. Cron is evaluated in Asia/Singapore (`SCHEDULE_ZONE`, the zone every UI time is printed in; no daylight saving), exactly five fields, Vixie OR semantics for the two day fields, `?` refused. The Kestra tick becomes five minutes (`SCHEDULER_TICK_MS`), and an expression that never fires or whose fires can fall closer than one tick is refused -- closeness measured on the times of day with the day fields widened, which can only overstate it. The control plane words each refusal in the reader's language with `details.reason` (`cron-fields`, `cron-invalid`, `cron-never`, `cron-too-frequent`, `cron-without-custom`), keeping the procedure input one flat object for the CLI's flags and the assistant's tool schema. The UI's confirmation is a preview of the next three fires, with weekdays, in Singapore time; Save stays off until the expression can be kept.

**Rejected.** Replacing the presets with cron (a preset is a gap, not a time of day, and most admins want "daily"); a "daily at HH:MM" picker only (a second special case that still leaves cron as the answer); one Kestra trigger per connection (schedule in Kestra's state, next run unknowable to the card, the per-tenant flow `ingest_due` replaced); a cron-to-prose translator (the earlier objection stands); validating in the tRPC input schema (the CLI would get zod issues instead of a sentence, and a union would break its flag builder).

**Consequences.** Kestra asks 288 times a day instead of 96, and "due now" means within five minutes for presets too. A stored expression that stops parsing gives no next run and is never due. A few odd patterns whose close pair could never fall on consecutive firing days are refused. `ops.connection.cron` is readable by `undercroft_bi`, like `cadence`. `croner` enters `@undercroft/contracts` and so the SPA and every server image, pinned exactly.
