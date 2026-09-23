---
title: ADR 0038 The Console Buffer Is a Script
type: source
date: 2026-09-22
tags: []
source: docs/adr/0038-the-console-buffer-is-a-script.md
source_path: docs/adr/0038-the-console-buffer-is-a-script.md
source_hash: 15bf8af8f625a6501f3b450e15a899d6ce096efb4a3f8aa38bce936a4ab36dc3
ingested: 2026-09-22
---

# ADR 0038 The Console Buffer Is a Script

The raw lake's SQL console runs what an author wrote as a script rather than as one query. Run splits the buffer at its top-level semicolons (`apps/ui/src/lib/statements.ts`) and asks `lake.query` for each statement separately, in its own pane, stacked in the order they were written (`apps/ui/src/components/LakeAnswers.tsx`). A semicolon inside a string literal, a quoted identifier, a dollar-quoted body or a comment is a character rather than a terminator, and a blank line is never one. With a selection, the press means the selection and nothing else: one rule, `selectionOf` in `SqlEditor.tsx` over the primary range, serves both the `Mod-Enter` keymap, which CodeMirror hands the view, and the Run button, which reaches the view through a small imperative handle because it does not sit inside the editor.

The server is unchanged. `lake.query` still takes one statement and still frames it as `SELECT * FROM (…) AS _q LIMIT n OFFSET m`, so the extended protocol still makes a second statement a syntax error rather than a second statement. That guarantee is what makes running a stranger's SQL safe, it is pinned by a test in `queryRunner.test.ts`, and the splitting is in the browser precisely so that nothing about it changes -- a console that wants two answers asks twice. The browser is also the only place "run the selection" can be answered at all, because the selection never leaves the editor.

Two statements in the buffer previously answered nothing: the frame wrapped the author's text in a sub-select, so the second statement was a syntax error attributed to SQL the author had written correctly. The console taught by refusing that its buffer held exactly one question, while being the one surface in the platform that exists for an operator's own questions -- which arrive in pairs, "what landed" and "what did the extractor make of it".

The statements of one press run ONE AT A TIME, on a promise chain the answer column owns, and this is a correctness requirement rather than politeness. `createTenantSessions.as` mints a fresh password for the tenant's dbt role and then opens a pool with it, and a role has one password; two overlapping queries rotate it twice and leave the first connection refused with an authentication error, which the reader would read as a refusal of their SQL. Running the panes in parallel was rejected for that reason, and because `httpBatchLink` would have collected same-tick mutations into one batch that tRPC resolves concurrently. The better fix -- a per-(tenant, role) mutex or a single retry inside `createTenantSessions.as`, which would also close the collision the console already has on its first paint between `querySchema` and the seeded query -- is a change to the credential path and was deferred to a commit whose diff is about that path. The queue is pinned by a test that holds the first query and asserts the second has not been asked.

Each pane owns its own mutation, and therefore its own rows, its own refusal and its own page; the page it is on is the offset that pane last asked for, read back off the mutation, and `lakeOffset` is deleted from the store. One mutation with an array of results held elsewhere was rejected as server data in a third home, the drift [[ADR 0009 UI State in Zustand, useState Banned]] bans `useState` to prevent. A press is a committed run -- `lakeRun` in the store, numbered per tenant -- rather than a read of the editor's live text, so typing does not disturb what is already on screen, and two identical statements stay two questions because panes are numbered rather than keyed by their SQL. Ten statements is the cap, and what was not run is printed rather than dropped.

The row count moved off the workbench bar onto each pane's own head, beside the grid it counts: a bar cannot say "a hundred rows" about three answers. The bar still says whether anything is running and disables its Run verb while it is. Stacked panes were chosen over a tab strip with the user, because comparing two answers is why a reader ran two statements and a comparison that costs a press happens in the reader's head; splitting on blank lines as well as semicolons was rejected with the user too, since a query written with a blank line in the middle is one query.
