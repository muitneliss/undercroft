# 115. The title page is printed in the reader's weather

- Status: Accepted
- Date: 2026-10-07
- Relates to: [ADR 0014](0014-frames-are-size-motion-is-stepped.md), whose stepped motion this keeps rather than
  excepts; [ADR 0063](0063-the-public-cover-moves-continuously.md), the one surface that is
  excepted, which this does not join; [ADR 0009](0009-ui-state-in-zustand-no-usestate.md), whose
  store gains its second persisted field. None is superseded.

## Context

The sign-in page is the title page of the book: one leaf on a bone board. It is the first
screen everyone sees, and it had nothing that answered the person in front of it. The request
was for the page to react to the reader's weather (rain, winter, sun, night) with animation,
inside the design system.

Weather depends on where the reader is, and this page is public: nobody on it has signed in or
agreed to anything. Three ways of finding a location were on the table, and each says
something different about the product's second rule, never guess.

## Decision

**The board answers the reader's clock always, and their sky only when they ask.**

- **The clock is read without asking.** The device's own hour sets night, dawn, day or dusk. It
  is a fact about the device, needs no request and no permission, and is never printed as a
  time, so the rule that times are shown in Asia/Singapore is not touched.
- **The weather is opt-in, and the consent is stated before the browser asks.** A plate beneath
  the leaf, beside one sentence in Garamond saying what will happen: the browser asks for a
  position, the position is rounded to a tenth of a degree (about eleven kilometres), sent only
  to Open-Meteo, and stored nowhere. Product principle 5, consent stated before the redirect,
  applied to a permission prompt.
- **What is drawn is what is known.** On the clock alone the sun or moon is printed in outline
  at its place on the day's arc, and no sky is drawn. A WMO code outside the table, a missing
  field or a failed request is a refused reading, and the page says it follows the clock alone.
  Winter is the measured temperature (15 °C or below), never the month: Hanoi and Ho Chi Minh
  City share a calendar and not a season.
- **The motion is stepped.** Rain is hatching that drops a tile in four frames, snow a sheet of
  marks stepping down, clouds banks of ruled hairlines that move one step a second, the sun's
  rays a clock hand. Every loop is `steps()`; reduced motion holds the first frame and keeps the
  `--pass` ink-in.
- **The leaf does not change.** Only the board does; the form keeps its contrast in every
  scene, and the weather thins out where the leaf lies.

The consent is `weatherWanted` in the Zustand store, persisted beside the locale for the same
reason: a choice made on one visit and forgotten by the next was not made. The position is not
stored by us; the reading lives in the query cache.

## Options rejected

- **A location from the browser's time zone.** No prompt, but every device in Vietnam reports
  `Asia/Ho_Chi_Minh`, so a reader in Hanoi in January would be shown Saigon's weather. That is
  a guess presented as a reading.
- **Asking for the position on arrival.** The most accurate, and it makes a permission prompt
  the first thing anyone sees, before the page has said why.
- **A server-side proxy for Open-Meteo.** It would hide the reader's address from Open-Meteo,
  but it puts an unauthenticated endpoint that calls a third party onto the control plane, for
  a decoration. The reader who opts in sends a rounded coordinate and their own address to one
  documented service, and the sentence beside the plate says so.
- **Continuous motion, as on the cover.** ADR 0063 makes `/` the one exception to stepped
  motion. A second exception for a decoration would make the exception the rule; the flip book
  reads as the same book as every leaf after it.

## Consequences

- The sign-in page makes no third-party request unless the reader presses the plate. A reader
  who does sends Open-Meteo a coordinate rounded to a tenth of a degree, once a quarter hour
  while the page is open.
- A refused position or an unreadable answer is visible, in words, under the leaf.
- The consent and the sign-in page are the only change; the consent step at `/consent` and the
  book itself keep the plain board.
