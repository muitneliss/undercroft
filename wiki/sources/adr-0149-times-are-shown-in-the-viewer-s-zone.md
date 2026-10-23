---
title: ADR 0149 Times Are Shown in the Viewer's Zone
type: source
date: 2026-10-23
tags: []
source: docs/adr/0149-times-are-shown-in-the-viewers-zone.md
source_path: docs/adr/0149-times-are-shown-in-the-viewers-zone.md
source_hash: 1d0a2425b528e908ff62c9c7eceaa1e0765063554a64b0df14e301eadfe9a455
ingested: 2026-10-23
---

# ADR 0149 Times Are Shown in the Viewer's Zone

Supersedes, in part, [[ADR 0012 Vietnamese First, i18next in Browser and Server]] (its rule that `@/lib/when` formats in `Asia/Singapore`; that the language never moves the zone stands), [[ADR 0059: A sync may run on a cron expression, beside the four presets]] (that every schedule time the UI prints, and the cron preview, is in Singapore time; a cron is still evaluated in `SCHEDULE_ZONE`) and [[ADR 0141 Custom Roles and Grants Under the Subset Rule]] (a grant's day sent as the end of that day in the schedule zone, `endOfScheduleDay`). It touches [[ADR 0115 The Title Page Is Printed In The Reader's Weather]], whose line that times are shown in Asia/Singapore now names a rule that is gone; its decision is unchanged.

**Why.** Every instant the web UI printed was in Singapore time whatever the reader's language or place, so an operator in Vietnam who acted at 11:24 saw the activity log say 12:24 with no zone on the screen -- a wrong value that looks right. The fixed zone protected one comparison (an expiry beside a cron) and broke the one a reader makes constantly (a time on screen against their own clock). Only the cron field is written in a zone, and it already names it.

**Decision.** A browser (`apps/ui`, `apps/mcp-widgets`) shows an instant in the viewer's own zone, the runtime's default. The locale still never moves the zone. A day typed into a form is the viewer's local day: a grant "until the 31st" is the last second of the 31st in the viewer's zone (`endOfLocalDay`), and a dashboard's date presets count the viewer's days. A cron is still written and evaluated in Singapore time, and its field's hint (`cronHint`, `cronZone`) says so; its previewed fires print in the viewer's zone and the preview's heading says that. Text the server writes (an email, a Lark card, a refusal) cannot know its reader's zone, so it stays in Asia/Singapore and names the zone (`formatWhen`, `timeZoneName: "short"`); the assistant's clock stays Singapore's and its prompt says so. `when.ts` caches each formatter by shape, locale and the zone it reads on every call, because a formatter fixes its zone when built and the runtime's zone can change under a running page. The visual tier keeps `timezoneId: "Asia/Singapore"`, so its baselines do not move.

**Consequences.** Two readers in two zones see two clock readings for one instant, each right for its reader; a screenshot carries no zone, so a support conversation should give the zone or the run's id. For a reader outside Singapore an expiry and a cron can read an hour apart on one card, each naming its zone. A suite that asserts a rendered clock or day sets `process.env.TZ` itself (`apps/ui/src/test/zone.ts`), since `bun test` runs in UTC and a laptop in its own zone.

**Rejected.** Keeping Singapore time and labelling the zone on every screen (honest, but every reader in Vietnam would subtract an hour from every time, every day, and the one who forgets acts on the wrong hour); a per-user zone setting stored by the server (a setting nobody knows to change, wrong the day the person travels, a column, a procedure and a form, when the browser already knows; the server's text naming its zone is enough until a reader asks for more).
