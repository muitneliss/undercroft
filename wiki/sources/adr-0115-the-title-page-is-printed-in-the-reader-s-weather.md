---
title: ADR 0115 The Title Page Is Printed In The Reader's Weather
type: source
date: 2026-10-07
tags: []
source: docs/adr/0115-the-title-page-is-printed-in-the-readers-weather.md
source_path: docs/adr/0115-the-title-page-is-printed-in-the-readers-weather.md
source_hash: bc10968f45972676a33173a742fe12ff175d7ed6334d10807a4d181d8592f0d7
ingested: 2026-10-07
---

# ADR 0115 The Title Page Is Printed In The Reader's Weather

Makes the sign-in page (the title page) answer the reader's weather, inside the design system rather than as an exception to it. Keeps the stepped motion of [[ADR 0014 Frames Are Size, Nothing Eases]] and does not join the one continuous-motion exception, [[ADR 0063 The Public Cover Moves Continuously]]; adds a second persisted field to the store of [[ADR 0009 UI State in Zustand, useState Banned]]. The page is public, so nobody on it has agreed to anything, and weather depends on where the reader is.

Decision. The board the leaf lies on follows the reader's clock always and their sky only when they ask. The device's hour sets night, dawn, day or dusk with no request and no permission, and is never printed as a time, so the Asia/Singapore display rule is untouched. The weather is opt-in through a plate beneath the leaf beside a Garamond sentence stating, before the browser asks, that the position is rounded to a tenth of a degree (about eleven kilometres), sent only to Open-Meteo and stored nowhere (product principle 5). What is drawn is what is known: on the clock alone the sun or moon is an outline on the day's arc and no sky is drawn; an unknown WMO code, a missing field or a failed request is a refused reading and the page says it follows the clock alone; winter is a measured temperature at or below 15 °C, never the month. Motion is a `steps()` flip book (rain drops a tile in four frames, clouds move a step a second, the sun's rays tick 5° a frame), reduced motion holds the first frame and keeps the `--pass` ink-in, and only the board changes, thinning out where the leaf lies. The consent is `weatherWanted` in the Zustand store, persisted beside the locale; the reading lives in the query cache and the position is never stored.

Rejected: a location from the browser's time zone (every Vietnamese device reports `Asia/Ho_Chi_Minh`, so Hanoi would get Saigon's weather, a guess shown as a reading), asking for the position on arrival (a permission prompt before the page has said why), a server-side Open-Meteo proxy (an unauthenticated third-party-calling endpoint on the control plane for a decoration), and continuous motion like the cover. Consequences: no third-party request unless the reader presses the plate, then one rounded coordinate a quarter hour while the page is open; refusals are shown in words under the leaf; `/consent` and the book keep the plain board.
