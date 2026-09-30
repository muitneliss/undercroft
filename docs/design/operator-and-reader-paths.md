# Operator and reader paths

**Status:** accepted. **Date:** 2026-09-29. Refs #346, #347, #348.

Three walks through the book break today. An admin checking one account's data walks
Sources → Journal → Raw lake → Models. A reader follows a dashboard into its questions and
takes the figures out. An admin manages who belongs to a customer and with which role. This
document is the design contract for making each walk continuous: each step opens the next one
already narrowed to the same account, run, model or filter values; each count leads to what it
counts (ADR 0039); and a refusal is shown before the action, not after it.

It changes no permission. Raw records stay admin-only (the `lake.*` procedures' role gate;
ADR 0005 records why raw is unreviewed source content), the read boundary stays the tenant
(ADR 0018, 0020; #298), each connected account stays its own source (ADR 0043), and the
server's own checks stay the control. It does need some server work, listed under
[What changes from today](#what-changes-from-today); none of it adds a gate or widens one.

A runnable offline prototype with synthetic fixtures accompanies the proposal. It is a review
harness, not code to merge: accepted behaviour is rebuilt in `apps/ui` with the existing
components, store, router and dictionaries.

## Direction contract

THESIS: A number a person reads on a path is a door, not a dead end. The door opens onto the
same account, run, model or filter values, and says plainly what it cannot show. A limit the
server enforces is visible before the person reaches it.

OWN-WORLD: The book shell, seven divisions, paper, Archivo, Garamond, mono data and ruled rows
stay as `apps/ui/DESIGN.md` records them. No new division, palette, font, chart engine or
component family.

MOTION: Stepped, as everywhere outside the public cover: every new transition is
`steps(n, end)`. No modal; every step is a leaf with an address or opens in place.

STORY: An admin opens one account's runs from its card, opens a run, sees the scope that run
read with, and reaches the records it wrote. An analyst narrows the Models list to failed or
never-built models and follows one model's declared upstream to the raw lake. A viewer opens a
dashboard tile's question on the dashboard's own filter values, reads its figures as a table
and downloads them. An admin sees, before choosing, that the only admin cannot be demoted and
what each role grants.

## What changes from today

The contract below is written as the behaviour it asks for. This section says where that
differs from the code on `main`, so a reader does not take a proposal for a description.

### Server work

None of it changes who may call what; each procedure keeps the gate its neighbours have, and
reaches the CLI and MCP through the same router (ADR 0044, 0060) with no gate of its own.

| Need                                | Today                                                                          | Change                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Journal filtered to one account | `runs.list` takes only `limit` and `cursor`                                    | An optional `source`, matched against `ops.run.source`                                                                                                                                        |
| The scope a run started with        | Scope lives only on `app.connection_detail.selection`, which a save overwrites | A migration adds `app.run_scope`, one row per run written when the run first reads its scope, kept out of `ops.run` because BI can read every column there (ADR 0091); older runs have no row |
| A run's counts opening its records  | `lake.records` and `lake.documents` list by source and entity only             | An optional run id. `raw.records.run_id` names the run that last wrote each row, so the view can only show those, and counts the rest                                                         |
| Lineage                             | Nothing reads a model's `ref()` and `source()` for display                     | A read-only procedure built on `readJinja` (`packages/db/src/services/jinja.ts`), the same reader `models.check` already uses                                                                 |

### Behaviour a reader will notice change

| Where                     | Today                                                                                | After                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Gauge and progress        | With no bound set, drawn against the largest value, else 100 (`charts/readings.tsx`) | Says the bound is missing and draws no share, until the author sets one |
| Pivot totals              | A missing value is left out and the rest prints as a plain total (`lib/pivot.ts`)    | A sum over any missing value is marked incomplete                       |
| Source card write plates  | Disabled for a member or viewer; Run now is already absent                           | Absent                                                                  |
| Withdrawing an invitation | One press                                                                            | A second press naming the address, as Remove already is (`Roster.tsx`)  |
| A tile's title            | Opens its question with no parameter values                                          | Opens it on the dashboard's values, with a way back                     |
| The last admin's row      | Offers a lower role and Remove; the server refuses after the choice                  | Says it is the last admin and offers neither                            |

The gauge change is the one that alters a saved question's drawing: an existing gauge or
progress question with no bound stops drawing a share it guessed. That is rule 2 applied to a
figure the browser computes, not a regression.

Everything else is new UI over what the server already returns: a result's `truncated` flag,
`chart.options.max`, a definition's `updated_at`, the reader's role per customer from
`tenants.list`, and the four build states `modelBuild.ts` already marks.

## Operator path

### Journal and runs

- A source card opens the Journal filtered to that one account. The filter lives in the
  address: Back, Forward and a pasted link restore the same list.
- An ingest run shows the scope in effect when it started. The scope is observed at run time
  and stored with the run, because reading today's scope later would date today's answer to
  the past (ADR 0039). A run recorded before this exists shows an em dash, never today's scope.
- For an admin, a run's created and changed count per entity opens the raw records that run
  wrote. A raw record names only the run that last wrote it, so when later runs have rewritten
  some of them the view says how many, rather than presenting the shorter list as the run's
  whole output. That number is the run's own count (`ops.run_entity`) less the records that
  still name the run; it is never estimated.
- For a member or viewer the same counts are plain figures, with no link.

### Scope

Saving a scope states, for that source's kind, what happens to the records the lake already
holds. The statement matches what the next read does:

| Kind  | Held records outside the new scope                                      |
| ----- | ----------------------------------------------------------------------- |
| Drive | Marked removed at source by the next complete read (ADR 0071, 0078).    |
| Gmail | Stay live; a message that stops matching a label is not marked removed. |

A removal is never an erasure (ADR 0071): no statement may imply that anything leaves the
lake. Kinds not listed here get a statement only once their behaviour is confirmed against
the read.

### Models list

Above the list, one count per last-build state the list already marks, "never built"
included. The counts add up to the models listed. Pressing a count filters the list to those
models, with the filter in the address. "Never built" is a build state, not a sign that a
model is new.

### Lineage, inside the Models division

The wheel is full at seven (ADR 0019), so lineage is a view of the Models division.

- It draws only relations the server reads from the models' own declarations: model → model
  where one model `ref`s another, and raw lake table → model where a model declares the raw
  lake as a dbt source (`source('undercroft', '<table>')`, the one source the platform
  declares). A declaration counts only when every argument is a plain literal, as the Jinja
  reader behind `models.check` already reports it.
- A macro's own declarations count for the model that calls it. The shipped `gmail_letters()`
  reads `source('undercroft', 'records')`, so a model that calls it has the raw records as an
  upstream; a tenant's macro (ADR 0086) is read the same way from its saved definition.
- Selecting a model highlights its whole upstream chain and dims every node not on it.
- It never infers a relation from similar names, a model's filters or data. Every source
  account lands in the same raw tables and a model picks its account by a filter (ADR 0002,
  0043), so no edge runs from a source account to a model. Nothing in a model's record says
  which question or dashboard reads it, so no edge runs to a report.
- A model whose upstream cannot be read from its declarations, such as a dynamic reference,
  a call to a macro the project does not hold, or a raw table named directly (what
  `models.check` reports as `raw-direct`), is marked "upstream not declared". It is not drawn as a model
  without parents: a missing edge must not look like proof of no dependency.
- A `ref` to a model that no longer exists shows as a missing dependency. The edge is kept:
  ADR 0077 records that deleting a model leaves the models that ref it in place, and their next
  build fails and says why.
- Every path is also available as text and by keyboard; colour and dimming alone carry no
  meaning.

### Source cards

Every write plate on a source card (Connect, Reconnect, Choose what to sync, Change what
syncs, Disconnect) is absent, not disabled, for a role the server refuses it to. This follows
the convention already used for Run now, Keys, Raw lake links and the new-model form. Hiding is
courtesy; the server refuses regardless.

## Reports

Reports stays first-party on Chart.js with all sixteen chart types it offers today (ADR 0020).
A tile still links to its question; there is no drill-through.

### From a dashboard to its questions

- A tile's title opens its question with the dashboard's current values for every parameter
  that question takes, so it runs on the same values with nothing re-entered.
- A question opened from a tile offers a link back to that dashboard with the same filter
  values.

### Reading and taking the figures

- Every question drawn as a chart offers, to every role that can see it, the rows that drew it
  as a table on the same page. This is ADR 0020's own answer: what the sixteen types cannot
  draw, a question's table can print. Every figure prints with all its digits, and a missing
  value as an em dash, never 0. Selecting a point or bar marks the row that drew it.
- Any role that can see a result can download it as CSV. The file holds exactly the rows and
  columns on screen for the parameter values in use. Figures keep all their digits and sign,
  and a missing value is an empty field, never 0. A text cell starting with `=`, `+`, `-` or
  `@` does not open as a formula in a spreadsheet. A result cut at its row limit says so
  before the file is taken.
- The table and the CSV give a role only the rows it already sees, under the tenant's own
  login.

### Figures the UI computes itself

"Missing is not zero" (`.claude/rules/money.md`) and "never guess" (`CLAUDE.md` rule 2) apply
to figures Reports totals or bounds on its own:

- Where a pivot adds figures itself (a cell over several rows, a row or column total, the grand
  total), a sum that includes any missing value is marked incomplete. It never prints as a
  plain total.
- A gauge or progress bar shows the result's first value against the bound its question's
  author set. With no bound set it says the bound is missing and draws no share; it is never
  drawn against the largest value or against 100.

### The Reports list

- The list is searchable by name across dashboards and questions, with accents ignored, as the
  customer search does (`foldForSearch` in `lib/labelIndex.ts`, not the raw lake's
  length-preserving `fold`).
- The time beside each dashboard and question is named as when its definition was last saved.
  Nothing on the list presents it, or anything derived from it, as the data's freshness.

## People and Customers

### People

- When exactly one member of a customer holds admin, that member's row says so and offers no
  lower role and no removal. The server's last-admin guard stays the control (#168); the row
  only shows in advance what it refuses.
- Beside the invitation form, the division states what each role may do in this customer.
  Every statement matches what the server allows and refuses, and adds nothing to it.
- Withdrawing an open invitation takes a second press that names the address, in place, as
  removing a member does. Inviting stays admin-only, and a re-invite still refreshes the one
  open invitation (ADR 0010, invite-only sign-in).

### Customers

- The customer list narrows by the reader's role in each customer (admin, member, viewer),
  together with the existing search. The count shown equals the rows listed, and clearing both
  restores the full list.
- Creating a customer stays with platform superadmins (ADR 0013).

## Across all three paths

- Below the 760 px breakpoint every new control can be reached and pressed, and every name in
  a selected model's upstream chain stays readable.
- No step opens a modal (`apps/ui/DESIGN.md`), and every new transition's timing function is
  `steps()` (ADR 0014).
- Filter values live in the address; a second press is held by a `<details>` fold, as Remove's
  is; nothing uses `useState` (`.claude/rules/state.md`).
- Every new word is a dictionary entry, Vietnamese first; the role values viewer, member and
  admin stay as they are in both languages (`.claude/rules/i18n.md`). The role statement is one
  entry per role, never assembled from role names.

## Out of scope

- Edges from source accounts or to reports, questions and dashboards. Each needs a declared
  contract first; this view will not guess one.
- Drill-through from a chart point to the records behind it. A record-level view needs a
  declared mapping and its own access rule.
- A model version number, until a revision identity is agreed.
- A review step before every role change. The roster saves a role on selection by design.
- Any change to roles, grants or what a member or viewer may read.
