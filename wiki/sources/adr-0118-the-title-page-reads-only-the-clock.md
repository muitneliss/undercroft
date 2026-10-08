---
title: ADR 0118 The Title Page Reads Only the Clock
type: source
date: 2026-10-08
tags: []
source: docs/adr/0118-the-title-page-reads-only-the-clock.md
source_path: docs/adr/0118-the-title-page-reads-only-the-clock.md
source_hash: 4321cf72862eb84bc3346d25a75244599bf85d5950ea1316c1b00d479bfd2a40
ingested: 2026-10-08
---

# ADR 0118 The Title Page Reads Only the Clock

Withdraws the opt-in weather reading of [[ADR 0115 The Title Page Is Printed In The Reader's Weather]] and the "almanac" line beneath the sign-in leaf that carried it -- the plate, the position asked of the browser, the call to Open-Meteo, the persisted `weatherWanted` consent, and the skies, chill and lit sun and moon drawn from a reading. Keeps the rest of 0115: the board that follows the reader's clock, the sun or moon in outline on its dotted course, the leaf that never changes, and the stepped motion of [[ADR 0014 Frames Are Size, Nothing Eases]].

Context. The owner asked for the almanac row ("Outside", "Day, by your clock", "Read the weather where you are", the consent sentence) to be removed. It was the only way to the weather reading, so the reading, its consent, its third-party call and every sky drawn from it would have been code with no caller.

Decision. The title page reads the reader's clock and nothing else: no position is asked for, no request leaves the sign-in page for a third party, nothing about the reader's weather is kept. No cloud, rain or star is drawn, for 0115's reason that the clock says where the sun is and nothing about the sky. The code is renamed for what it reads: `components/Sky.tsx`, `lib/sky.ts` and `components/useMinute.ts` replace `Weather.tsx`, `lib/weather.ts` and `useTitleWeather.ts`.

Rejected: hiding the almanac (still a consent flow, geolocation path and third-party call to keep correct, for a reading nobody can ask for), moving the plate elsewhere (the request was fewer things on the first screen, and a location prompt and weather-service call do not belong on a public sign-in page as decoration), removing the whole sky board (it asks for nothing and was not what the owner pointed at), and editing ADR 0115 (accepted ADRs are immutable). Consequences: no third-party request and no permission prompt on sign-in; `signIn.weather.*` leaves both catalogues; `weatherWanted` leaves the store and its `partialize`, with no persist migration added because `persist` merges the stale `localStorage` key into state where nothing reads it and the next write drops it; `apps/ui/DESIGN.md` describes the clock-only board.
