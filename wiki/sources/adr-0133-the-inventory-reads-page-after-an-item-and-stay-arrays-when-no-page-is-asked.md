---
title: >-
  ADR 0133 The Inventory Reads Page After an Item, and Stay Arrays When No Page
  Is Asked
type: source
date: 2026-10-13
tags: []
source: docs/adr/0133-inventory-reads-page-after-an-item.md
source_path: docs/adr/0133-inventory-reads-page-after-an-item.md
source_hash: 780d3072d6b763de1b5131af9c31c7334ee3c9f8e376157b111718c7161f3ed4
ingested: 2026-10-13
---

# ADR 0133 The Inventory Reads Page After an Item, and Stay Arrays When No Page Is Asked

Extends [[ADR 0125 A Read Names Its Target: Lineage, Schema and Scope Reads Narrow, and Never Guess]] (a page continues after an item), ADR 0127 (lists answer summaries; `names` and `match`) and [[ADR 0122 What a Model Reads over MCP Is Bounded in Every Copy]] (an MCP answer shows 50 items of a list and at most 60 KB). Issue 468: an agent with only MCP could not read past the clip on `models.list`, `macros.list`, `bi.questions.list` and `models.lineage`, which took filters and no page; the CLI has no clip, but the inputs are the router's.

Decision. The four reads take `limit` and `cursor` by ADR 0125's rule, from one owner: `services/listPage.ts`, whose `pageAfter` cuts one listing after the item a cursor names and `pageBoth` cuts two listings in step under one cursor; `scopeChoices.ts` (the browse) now uses `pageAfter`, unchanged in its answers and cursors. A cursor is an item's key as JSON in base64url, compared only for equality with a key the listing holds now, so a foreign cursor is refused the same way and nothing parsed can throw. Models and macros page by name (unique, their `ORDER BY`); questions by id, since names repeat and `listQuestions` reads `ORDER BY name, id`; the lineage keys a node by id and an edge by its two ends, in the graph's order. Paging follows narrowing: `names`/`match` cut first, so an unknown name is still `unknown-names`, and every lineage page narrows by the same `name`/`direction`/`depth`. A lineage page carries at most `limit` nodes and `limit` edges, each list continuing after its own last item; one may run out first and answer empty pages; `nextCursor` is null only when both are done. `limit` is 1 to 1,000; a cursor alone answers 50, or 20 for `bi.questions.list` with `include: ["definition"]` (32 questions with SQL were 59 KB); `pageAsked` decides "was a page asked" once; a cursor is at most 1,024 characters; `PageInput` in `listInputs.ts` is shared with the browse. A gone item is BAD\_REQUEST `{ procedure, reason: "unknown-cursor", remedy: "restart" }` (`error.pageCursorUnknown`).

The answer is an array unless a page was asked: with neither input each list answers its array and the lineage `{ nodes, edges }`; with either, `{ items, nextCursor }` and `{ nodes, edges, nextCursor }`, by the `bi.schema` union precedent; the browser narrows back with `wholeList` and fails rather than draw a page as the whole. ADR 0127's "every list stays an array" still holds for every request it described.

Consequences: an MCP-only agent walks any of the four to the end and knows the end by `nextCursor: null`; the browser, assistant tools and existing clients are unchanged (`Whole<>` in the UI's types); a walk still reads the whole list or graph per page; a cursor handed to another read is not refused for that alone; `connections.list` and `seeds.list` do not page yet. Rejected: always `{ items, nextCursor }` (breaks every caller), an offset cursor (skips or repeats), a second procedure per list (two doors to keep identical), paging lineage nodes alone with their edges (loses or repeats edges), and paging in SQL (the narrowing runs after the read and the lineage cannot be cut before every model is read; a second copy of the rule).
