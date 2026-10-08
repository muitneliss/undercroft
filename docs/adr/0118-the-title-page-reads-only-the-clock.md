# 118. The title page reads only the clock

- Status: Accepted
- Date: 2026-10-08
- Supersedes: from [ADR 0115](0115-the-title-page-is-printed-in-the-readers-weather.md), the
  opt-in weather reading -- the plate beneath the leaf, the position asked of the browser, the
  call to Open-Meteo, the persisted `weatherWanted` consent -- and the almanac line that carried
  it, with the skies, the chill and the lit sun and moon drawn from a reading
- Keeps: everything else in ADR 0115 -- the board that follows the reader's clock, the sun or
  moon in outline on its course, the leaf that never changes, and the stepped motion of
  [ADR 0014](0014-frames-are-size-motion-is-stepped.md)

## Context

ADR 0115 printed the sign-in board in the reader's weather. The clock was always read; the sky
was read only when the reader pressed a plate in an "almanac" line beneath the leaf, which said
what the board was printing ("Day, by your clock"), offered "Read the weather where you are",
and stated the consent before the browser asked for a position.

The owner asked for the almanac row to be removed. The almanac was the only way to the weather
reading, so without it the reading, its consent, its third-party call and every sky drawn from
it would be code with no caller.

## Decision

**The title page reads the reader's clock and nothing else.**

- The almanac is gone, and with it the opt-in reading: no position is asked for, no request
  leaves the sign-in page for a third party, and nothing about the reader's weather is kept.
- The board stays as ADR 0115 drew it on the clock alone: the ground follows the light (night,
  dawn, day, dusk), and the sun or moon stands in outline on a dotted course. No cloud, rain or
  star is drawn, for ADR 0115's reason: the clock says where the sun is and nothing about the
  sky.
- The code is named for what it now reads: `components/Sky.tsx`, `lib/sky.ts` and
  `components/useMinute.ts` replace `Weather.tsx`, `lib/weather.ts` and `useTitleWeather.ts`.

## Options rejected

- **Keep the almanac but hide it.** A hidden row is still a consent flow, a geolocation path and
  a third-party call to test and keep correct, for a reading nobody can ask for.
- **Keep the reading and move its plate elsewhere on the page.** The request was fewer things on
  the first screen anyone sees, not the same thing in another place. A location prompt and a call
  to a weather service do not belong on a public sign-in page as decoration.
- **Remove the whole sky board, back to the plain bone board.** The clock-driven board asks for
  nothing and was not what the owner pointed at; it stays.
- **Edit ADR 0115.** Accepted ADRs are immutable; why the reading was added, and why it went,
  both stay readable.

## Consequences

- The sign-in page makes no third-party request and shows no permission prompt.
- `signIn.weather.*` leaves both catalogues. `weatherWanted` leaves the store and its
  `partialize`; a reader who had opted in still has the key in `localStorage`
  (`undercroft.ui`). The store has no persist version or migration, and none is added:
  `persist` merges the stale key into the state, where nothing reads it, and the next write
  stores only `locale` and `filmHeld`, which drops it.
- `apps/ui/DESIGN.md` describes the clock-only board.
