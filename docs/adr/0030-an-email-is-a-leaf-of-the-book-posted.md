# 30. An email is a leaf of the book, posted

- Status: Accepted
- Date: 2026-09-21
- Supersedes: the "there is exactly one thing this platform emails... that is why the
  interface is three fields and not a templating system" reasoning in the docstring of
  [`packages/core/src/email.ts`](../../packages/core/src/email.ts), and the "a sign-in code
  has nothing to gain from HTML and something to lose" note on `EmailMessage.text`
- Extends: [ADR 0012](0012-vietnamese-first-i18n-with-i18next.md), which made the control
  plane's catalogue the only place a sentence this server writes may be written

## Decision

Undercroft's emails are **set**, in the visual world `apps/ui/DESIGN.md` already describes:
warm page stock on a bone board, a running head, a schedule of facts under hairlines, a
die-cut plate for the one next action, and — for a run that failed — the errata slip, which is
the only object in the whole system allowed vermilion.

Three things carry the decision:

1. **`EmailMessage` gains an optional `html`; `text` stays required.** The plain-text branch
   is the message. The markup is the same message set.
2. **One document, two renderings.** `renderEmailLeaf` in
   [`packages/core/src/emailTemplate.ts`](../../packages/core/src/emailTemplate.ts) takes a
   structured `EmailLeaf` and returns both branches. Neither is authored separately.
3. **Nothing in an email calls home.** No image, no remote font, no tracking pixel.

All five messages are affected: the sign-in code, the invitation, a failed run, a lapsing
grant, a lapsing ingest key.

## Why the old decision expired rather than was wrong

`email.ts` argued for three fields on an explicit condition: _"the day a second kind of
message exists is the day to grow it, and guessing now would mean maintaining a mail framework
nobody asked for."_ That was correct when it was written and there was one message. There are
now five, three of which are alerts to a customer's administrators that carry a source, a
timestamp, a reason and a link. The condition the docstring named has been met, so this is the
growth it authorised, not a reversal of it.

What it is NOT is a mail framework. There is no layout language, no partials, no inheritance,
no per-message template file. There is one leaf shape and six kinds of block, and a message is
a list of them.

## Why one document rather than two catalogues

The obvious implementation is an `html` key beside every `body` key. It fails the same way
every time and the failure is invisible: somebody corrects a sentence in the markup, nobody
opens the text, and from then on the two branches say different things. The readers who get
the text branch — a plain-text client, a screen reader set to prefer it, every quoted reply —
are told something the sender stopped believing.

Rendering both from one description makes that unrepresentable. A sentence cannot exist in one
branch and not the other, and `emailTemplate.test.ts` compares them literally, phrase by
phrase. It is the same reasoning as rule 3 in `CLAUDE.md` — one writer, many callers — applied
to words instead of bytes.

This is also why the renderer applies caps in code rather than with `text-transform`. With the
transform in CSS the markup said SOURCE and the text said Source, and a parity test that has
to compare case-insensitively is a test that has stopped noticing real edits.

## Why nothing may call home

A web font is one `<link>` and it would give the emails their real faces. It also tells a
third party the exact moment a sign-in code was opened, from which IP, by which client. For a
platform whose emails are mostly credentials and security notices, that is a worse thing to
ship than an email set in Georgia — which is the fallback chosen deliberately, being the one
face everywhere that has a true italic and old-style warmth.

The same argument bans a spacer image and a tracking pixel, so there is no open-rate metric.
Nobody asked for one.

The cost is honest and worth stating: **Archivo, EB Garamond and Spline Sans Mono will not
load in most mail clients.** The stacks name them first, so a reader who happens to have them
gets them; everyone else gets Helvetica, Georgia and their platform mono. The structure,
palette, rules and spacing carry the identity instead of the lettering, which is the part of
the design that survives the medium.

## Why the errata slip is only on a failure

`DESIGN.md`'s Vermilion Rule holds vermilion out of the wheel so that the correction slip is
the only thing wearing it. A template that painted every notice vermilion would spend the one
colour the system reserves, and the next reader would have nothing left to make a real
correction stand out.

So a failed run gets the slip, because it IS a correction. A grant or a key about to lapse has
not lapsed: its date is set in Pending umber, the same tone the interface's pending status mark
uses. `emailTemplate.test.ts` pins this from both sides — an errata block wears vermilion, and
a leaf without one carries no vermilion anywhere.

## Why escaping moved into the renderer

`i18n/index.ts` runs i18next with `escapeValue: false`, and that has to stay: its output feeds
the plain-text branch and HTTP refusals, where `&#39;` in a customer's name is a defect.

So the markup branch escapes each value as it writes it. This is not a formality. An ingest
key's label and a run's error message are written outside this repo and land in an
administrator's inbox; before there was markup, there was nothing for them to break out of.

## Options rejected

- **Keep every email plain text, improve only the copy.** Cheapest, and it leaves the alerts
  unreadable at a glance: a failed-run notice is a wall of prose where the source, the time and
  the reason all have equal weight, which is exactly the job a ruled schedule does better.
- **Markup for the notices, plain text for the sign-in code.** Tempting, because `email.ts`'s
  specific objection was about credentials. But the objection was to HTML _as decoration_, and
  a code set large in a keylined box on a page a reader recognises is better at the one job the
  message has. Keeping one message off the shared shape would also leave a branch nobody
  exercises.
- **An off-the-shelf email framework (MJML, react-email).** A build step, a dependency tree and
  a second component vocabulary that knows nothing about plates, leaves or the Vermilion Rule —
  to produce six blocks of table markup. It would also render only the markup branch, which
  hands back the drift problem this ADR exists to remove.
- **A dark-mode variant.** The system has one stock and it is warm bone; printed matter is not
  dark. The template declares `color-scheme: light` and carries explicit `bgcolor` attributes
  for the clients that force an inversion anyway.

## Consequences

- An email can be looked at before it is posted: `task dev:email-preview` renders all five, in
  both languages, from the real composers, to `data/email-preview/`. It imports
  `signInCodeMessage`, `invitationMessage` and the three in `alerts.ts` rather than fixtures
  shaped like them, so a preview cannot drift from what is sent.
- The sign-in code's composition moved out of the Better Auth hook into an exported
  `signInCodeMessage`, matching the four that were already pure values.
- The catalogue's email entries are now one key per sentence and per label, rather than five
  sentences joined into one `body` — which is what `.claude/rules/i18n.md` asked for already.
- A new kind of message is a new list of existing blocks. A new kind of **block** is a case in
  two switches, both of which fail to compile until it is answered in both branches.
