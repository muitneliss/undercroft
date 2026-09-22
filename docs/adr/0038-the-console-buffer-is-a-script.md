# 38. The lake console's buffer is a script, and a selection is what a press means

- Status: Accepted
- Date: 2026-09-22

## Decision

The raw lake's SQL console runs what an author wrote as a **script**, not as one query.

- **Run splits the buffer at its top-level semicolons** (`apps/ui/src/lib/statements.ts`),
  and each statement is asked of `lake.query` separately, in its own pane, stacked in the
  order they were written (`apps/ui/src/components/LakeAnswers.tsx`). A semicolon inside a
  string literal, a quoted identifier, a dollar-quoted body or a comment is a character, not
  a terminator; a blank line is never a terminator.
- **With a selection, the press means the selection** and nothing else. One rule --
  `selectionOf` in `SqlEditor.tsx`, over the primary range -- serves both entry points: the
  `Mod-Enter` keymap, which CodeMirror hands the view, and the Run button, which reaches the
  view through a small imperative handle because it does not sit inside the editor.
- **The statements of one press run one at a time**, on a promise chain the answer column
  owns. A pane that has not had its turn says so.
- **Each pane owns its own mutation**, and therefore its own rows, its own refusal and its
  own page. Which page it is on is the offset that pane last asked for, read back off its
  mutation; `lakeOffset` is deleted from the store.
- **A press is a committed run** (`lakeRun` in the store, numbered per tenant), not a read of
  the editor's live text. Typing does not disturb what is already on screen.
- **The row count moved off the workbench bar** onto each pane's own head, beside the grid it
  counts. The bar still says whether anything is running, and its Run verb is disabled while
  it is.
- **Ten statements is the cap**, and what was not run is printed rather than dropped.

The server is unchanged. `lake.query` still takes one statement, still frames it as
`SELECT * FROM (…) AS _q LIMIT n OFFSET m`, and the extended protocol still makes a second
statement a syntax error rather than a second statement.

## Why

- **Two statements in the buffer answered nothing at all.** The frame wraps the author's text
  in a sub-select, so a second statement was a syntax error attributed to SQL the author had
  written correctly. The console taught, by refusing, that its buffer held exactly one
  question -- while being the one surface in the platform that exists for an operator's own
  questions, which arrive in pairs: "what landed" and "what did the extractor make of it".
- **The splitting belongs in the browser.** The single-statement guarantee is what makes
  running a stranger's SQL safe (`.claude/rules/privileges.md`, ADR 0016), it is pinned by a
  test in `queryRunner.test.ts`, and nothing here weakens it. A console that wants two
  answers asks twice. It is also the only place "run the selection" can be answered at all,
  because the selection never leaves the editor.
- **A selection is the gesture that makes a scratch buffer usable.** Without it, re-asking
  one of five questions means deleting the other four, which is why an operator's buffer
  never accumulates the working set the feature was built for.
- **One at a time is a correctness requirement, not politeness.**
  `createTenantSessions.as` mints a fresh password for the tenant's dbt role and then opens a
  pool with it, and a role has one password. Two overlapping queries rotate it twice and the
  first connection is refused with an authentication error -- which the reader would see as a
  refusal of their SQL. The queue is pinned by a test that holds the first query and asserts
  the second has not been asked.
- **Each pane owning its mutation is what keeps the rows in one place.** The alternative --
  one mutation and an array of results held somewhere -- is server data in a third home,
  which is the drift `.claude/rules/state.md` bans `useState` to prevent. It is also what
  makes the page a derived fact rather than a stored one.
- **A bar cannot say "a hundred rows" about three answers.** Moving the count to the pane is
  what the count was always for: the two facts a reader cannot get from the grid, printed on
  the grid they are about.

## Rejected

- **Splitting on blank lines as well as semicolons.** Rejected with the user: a query written
  with a blank line in the middle is one query, and tearing it in half would answer a
  question nobody asked -- with a syntax error about text the author did not write.
- **A tab strip, one answer at a time.** Rejected with the user: comparing two answers is why
  a reader ran two statements, and a comparison that costs a press is one that happens in the
  reader's head. The panes stack, share the height above a floor, and past the floor the
  column scrolls.
- **Sending the whole buffer to the worker and splitting it there.** Rejected: it would put a
  SQL parser on the path that the single-statement frame exists to keep simple, and the frame
  is a security boundary rather than a convenience.
- **Running the panes in parallel.** Rejected for the rotation race above. `httpBatchLink`
  would additionally have collected same-tick mutations into one batch, which tRPC resolves
  concurrently -- so "parallel in the browser" is "concurrent at the worker" with certainty
  rather than probability.
- **Fixing the race in the worker as part of this change.** Deferred, and it is the better
  fix: a per-(tenant, role) mutex or a single retry inside `createTenantSessions.as` would
  also close the collision the console already has on its first paint, where `querySchema`
  and the seeded query open two dbt sessions at once. It is a change to the credential path
  and belongs in a commit whose diff is about that path.
- **Keeping `lakeOffset` in the store, keyed by statement.** Rejected: it would be a second
  copy of a fact the pane's own mutation already holds, and the two would drift the first
  time a page-turn failed.
- **Numbering the panes by the statement's text.** Rejected: two identical statements in one
  buffer are two questions, and a pane keyed by its SQL would collapse them into one.
