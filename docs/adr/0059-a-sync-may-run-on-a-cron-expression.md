# 59. A sync may run on a cron expression, beside the four presets

- Status: Accepted
- Date: 2026-09-25
- Supersedes: the "no cron" reasoning in `packages/contracts/src/cadence.ts`,
  `packages/db/sql/100_cadence.sql` and `apps/ui/src/lib/cadence.ts`. No ADR recorded it; those
  three docstrings did, and each now points here.

## Context

A connection is read on one of four cadences: hourly, every six hours, daily, or paused. Each
preset is a gap since the last run started. Kestra's `ingest_due` flow asks the worker every
fifteen minutes which pairs are due, and starts them.

The cadence was deliberately not a cron string, for three reasons:

- **Kestra owns the tick.** Nothing in the database can make a cron fire, so a cron column
  would be a promise nobody keeps.
- **Admins want presets.** They say "every hour", not "0 \* \* \* \*".
- **A translator is worse than the fields.** A cron-to-prose translator that is subtly wrong,
  in two languages, is worse than five fields an operator can read.

The product owner now asks for more: users should be able to set the sync time themselves.
A gap since the last run cannot say "07:30 on weekdays" or "at 02:00, after the nightly
export". Every such request so far has been a time of day or a day of the week.

## Decision

**A fifth cadence, `custom`, carries a five-field cron expression.** The four presets keep
their meaning. `ops.connection.cron` holds the expression. A CHECK
(`290_connection_cron.sql`) keeps an expression beside `custom` and none beside a preset.

- **One rule, in contracts.** `packages/contracts/src/cadence.ts` checks an expression, lists
  its next fires and decides "due". It uses `croner` 10, which is MIT, has no dependencies and
  runs in the browser. The worker's due list, the control plane's card and the UI's form all
  call the same functions. The UI imports them from `@undercroft/contracts/cadence`.
- **Due means the first fire after the last run started.** A missed fire is caught up by
  exactly one run and never replayed. A pair that has never run is due now, as with a preset.
- **The zone is Asia/Singapore.** Every schedule time the UI prints is already in this zone
  (`apps/ui/src/lib/when.ts`), and Singapore has no daylight saving. The zone is defined once,
  as `SCHEDULE_ZONE`.
- **Exactly five fields, standard semantics.** When both day fields are set, a day matches if
  either does (Vixie cron). `?` is refused because `croner` reads it as the time of parsing.
- **The tick becomes five minutes**, and `SCHEDULER_TICK_MS` states it. An expression whose
  fires can fall closer together than one tick is refused. So is one that never fires.
  Closeness is measured on the times of day with the day fields widened to every day, which
  can only overstate how close fires fall. So an accepted expression can never beat the tick.
- **The server words its refusals.** The control plane refuses a bad expression with a
  sentence in the reader's language, and with `details.reason` for an agent: `cron-fields`,
  `cron-invalid`, `cron-never`, `cron-too-frequent` or `cron-without-custom`. The procedure's
  input stays one flat object, because the CLI builds its flags from it and the assistant's
  tool schema mirrors it.
- **A preview is the confirmation.** Choosing "Custom (cron)" opens a field. Under it the card
  lists the next three fires, with their weekdays, in Singapore time. Save stays off until the
  expression can be kept.

## Options rejected

- **Replace the presets with cron entirely.** Most admins want "daily" and should not have to
  spell it. Every existing row would need rewriting to an expression that means something
  subtly different, because a preset is a gap since the last run, not a time of day.
- **Only a "daily at HH:MM" picker.** It covers the most common request and none of the next
  ones, such as weekdays only or twice a day. It would be a second special case to maintain,
  beside the presets, and still leave cron as the eventual answer.
- **One Kestra trigger per connection.** The schedule would live in Kestra's state, where a
  deploy that redelivers `flows/` could drop it. The card could not compute the next run
  without asking Kestra. It would also bring back the per-tenant flow that
  `ingest_due` replaced because it scheduled nobody.
- **A cron-to-prose translator.** The earlier objection stands. It is wrong in edge cases, in
  two languages, and only one of the two gets checked. Dates computed by the scheduler's own
  function cannot disagree with the scheduler.
- **Validate in the tRPC input schema (zod refine).** The CLI would receive a list of zod
  issues rather than a sentence. A discriminated union on `cadence` would also break the CLI's
  flag builder and the assistant's object-only tool schema.

## Consequences

- Kestra asks three times as often: 288 small `GET /v1/runs/due` requests a day instead of 96.
  Each is one query over `ops.connection`.
- "Due now" on a card means within five minutes rather than fifteen, for presets too.
- An expression that stops parsing, for example after a library upgrade that reads it
  differently, gives no next run and is never due. It is visibly absent, not guessed.
- The closeness check refuses a few odd patterns whose close pair could never land on two
  consecutive firing days, for example "23:58 and 00:02, on the 1st only". This strictness is
  the price of an answer that does not depend on which month was sampled.
- `ops.connection.cron` is readable by `undercroft_bi`, like `cadence` beside it. An
  expression says when a source is read, and nothing about its data.
- `croner` enters `@undercroft/contracts`, and through it the SPA bundle and every server
  image, pinned exactly.
