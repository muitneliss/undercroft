# 149. Times are shown in the viewer's zone

- Status: Accepted
- Date: 2026-10-23
- Supersedes, in part: [ADR 0012](0012-vietnamese-first-i18n-with-i18next.md), the bullet "the
  language changes the words, never the clock" where it fixes `@/lib/when` to
  `timeZone: "Asia/Singapore"`. That the language never moves the zone stands.
- Supersedes, in part: [ADR 0059](0059-a-sync-may-run-on-a-cron-expression.md), where it says
  every schedule time the UI prints is in Asia/Singapore and that the card lists the next fires
  in Singapore time. A cron is still evaluated in `SCHEDULE_ZONE`, defined once.
- Supersedes, in part: [ADR 0141](0141-custom-roles-and-grants-under-the-subset-rule.md), where a
  grant's day is sent as the last second of that day in the schedule zone (`endOfScheduleDay`).
- Touches: [ADR 0115](0115-the-title-page-is-printed-in-the-readers-weather.md), whose line "the
  rule that times are shown in Asia/Singapore is not touched" now describes a rule that is gone.
  Its decision is unchanged: the device's hour still sets the board's light, and is never printed.

## Context

Every instant the web UI printed was formatted in Asia/Singapore, whatever the reader's language
and wherever they sat (`apps/ui/src/lib/when.ts`, `timeZone: SCHEDULE_ZONE`). ADR 0012 chose it so
an expiry would never read an hour off from the cron printed beside it, and ADR 0059 leaned on it
when the zone of a cron had to be chosen.

The reader it hurt is the platform's main one. An operator in Vietnam acted at 11:24 on their own
clock, and the activity log said 12:24, with no zone on the screen. Nothing on the page said the
time was Singapore's, so the only reading available was that the log was wrong, or that the action
was someone else's. That is the failure the product's second rule names: a wrong value that looks
right. The fixed zone protected one comparison, an expiry beside a cron, and broke the comparison a
reader makes all the time, a time on screen against the clock on their wall.

Most of what the UI prints is not a schedule at all: a run's start, a feed's lines, an invitation's
expiry, a published catalogue, a key's last use. Only the cron field is written in a zone, and that
field already names it (`cronHint`, `cronZone`).

## Decision

**A browser shows an instant in the viewer's own zone.** That is the runtime's default zone, the
one `Intl` resolves with no `timeZone` given. It applies to `apps/ui` and `apps/mcp-widgets`.

- **The locale still never moves the zone.** Language changes the words and the digits. A reader
  using Vietnamese in Singapore sees Singapore's clock, and one using English in Hanoi sees Hanoi's.
- **A day typed into a form is the viewer's local day.** A grant "until the 31st" is sent as the
  last second of the 31st in the viewer's zone (`endOfLocalDay`), so the day picked is still the
  day the list prints. A dashboard's date presets count the viewer's days, so "today" is the date
  the screen beside it shows.
- **A cron is still written in Singapore time and says so.** `packages/contracts/src/cadence.ts`
  evaluates it in `SCHEDULE_ZONE`, unchanged. Its field's hint and the label beside a stored
  expression keep "SGT". Its previewed fires are instants like any other, so they print in the
  viewer's zone, and the preview's heading says that.
- **Text the server writes names its zone.** An email, a Lark card or a refusal is written where
  the reader's zone is unknown, and one card reaches a whole group. It stays in Asia/Singapore and
  carries the zone's name (`formatWhen`, `timeZoneName: "short"`). The assistant's clock is still
  Singapore's, and its prompt says so rather than claiming the screen shows that zone.
- **A cached formatter is keyed by its zone.** `Intl.DateTimeFormat` fixes its zone when it is
  built, and the runtime's zone can change under a running page. `when.ts` reads the zone on every
  call and keys its cache by shape, locale and zone, so a formatter never prints for a zone it was
  not built in.

The visual-regression tier keeps `timezoneId: "Asia/Singapore"`: its pages now follow the
browser's zone, which is that one, so the baselines do not move.

## Consequences

- **Two readers in two zones see two clock readings for one instant**, each right for its reader.
  A screenshot passed between them carries no zone. A support conversation about a time should
  give the zone, or quote the run's id.
- **An expiry and a cron can now read an hour apart on one card**, for a reader outside Singapore:
  the cron's fields are SGT, and the expiry is local. The cron's field names its zone and the
  preview names the reader's, which is the protection ADR 0012 wanted, now said rather than forced.
- **A suite that asserts a rendered clock or day sets `process.env.TZ` itself.** `bun test` runs
  in UTC by default and a laptop in its own zone, and a test that depends on either passes for the
  wrong reason somewhere.

## Options rejected

- **Keep Singapore time and label the zone on every screen.** It would make the log honest, but
  still wrong for its main reader: everyone in Vietnam would have to subtract an hour from every
  time they read, every day, and the one who forgets acts on the wrong hour. A label explains a
  conversion; it does not do it.
- **A per-user zone setting, stored by the server.** It would let an email speak the reader's zone
  too. But it is a setting nobody would know to change, it is wrong the day the person travels, it
  needs a column, a procedure and a form, and the browser already knows the answer without asking.
  The server's text naming its zone is enough until a reader asks for more.
