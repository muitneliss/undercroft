# 90. Reports computes no figure it cannot stand behind: a gauge draws only against its author's bound, and a pivot sum over a missing value is incomplete

- Status: Accepted
- Date: 2026-09-30
- Builds on: [ADR 0020](0020-bi-is-first-party-metabase-leaves-the-stack.md) (Reports is
  first-party on Chart.js, and what a drawing cannot say a table can), and applies CLAUDE.md
  rule 2 and `.claude/rules/money.md` to figures the browser computes itself.
- Supersedes: nothing. The behaviour it replaces was never a decision; it was a fallback written
  into `charts/readings.tsx` and `lib/pivot.ts`.

## Context

Almost every figure in Reports is one the database sent: the browser prints it with every digit
and never through a float. Two drawings are the exception, because they compute a figure of their
own, and both guessed.

- **A gauge or a progress bar** shows the result's first value as a share of a bound. The bound is
  a fact about the business -- a target, a budget, a capacity -- that only the question's author
  knows, and it is optional (`chart.options.max`). With none set, the drawing used the largest
  value in the result, else 100. A needle three quarters of the way round against a bound nobody
  chose is indistinguishable from one against a real target. A missing reading, meanwhile, was
  drawn as a needle at zero.
- **A pivot** adds figures itself: a cell over several rows, each row's and column's total, the
  grand total. A null contributed nothing and the rest printed as the total, so `100` over three
  rows where one amount was missing read exactly like a real `100`.

Both are "no evidence is not a pass" failing silently: the page renders a clean figure, and
nothing tells the reader it is not one.

## Decision

- **A gauge or a progress bar draws a share only against the bound its author set.** With no
  bound (or one that is not a positive finite number) it prints the reading, says the bound is
  missing, and draws nothing -- an empty arc would itself read as a zero. With a bound but no
  reading it draws nothing either. The decision is one wordless function,
  `readingShare` in `apps/ui/src/lib/readingBound.ts`, which both drawings call.
- **A pivot figure carries `incomplete`**, set when anything summed into it was missing or would
  not read as a number, and it propagates: a total over an incomplete cell is incomplete, up to
  the grand total. The partial sum is kept and printed with the word "incomplete" beside it, and a
  note beneath the table says what the word means. A group that is whole prints plainly. A
  combination no row mentions is missing (an em dash) but is not a missing _value_ and taints no
  total. `apps/ui/src/lib/pivot.ts`.
- **The mark is text, not colour**, so it survives a screen reader, a print and a copy.

## Consequences

- An existing gauge or progress question saved with no bound stops drawing a share and says why,
  until its author sets one. That is the rule applied, not a regression: the share it drew was
  never the author's.
- A pivot over data with gaps now shows which totals are partial. A reader who recounted by hand
  no longer has to.
- Any future figure Reports computes in the browser -- a running total, an average, a percentage
  of a column -- inherits the same obligation: it carries its own incompleteness, or it is not
  computed.

## Options rejected

- **Withhold an incomplete pivot total** (print an em dash). A partial sum is still worth reading,
  and the truncated-result note already set the precedent of qualifying a figure rather than
  hiding it. Withholding would also make a pivot over one missing value useless.
- **Mark by colour or an asterisk alone.** A tint is invisible to a screen reader and lost on
  print; an asterisk needs a legend the reader may not connect to it. A word beside the figure
  and a note that defines it say the same thing both ways.
- **Keep the gauge fallback but label it** ("against the largest value"). The drawing would
  still present a share nobody chose as the shape of the data, and a label under a needle is
  read after the needle, if at all.
- **Default the bound to 100 for percentage-looking columns.** The browser cannot know a column
  is a percentage; guessing that is the same guess one level down.
