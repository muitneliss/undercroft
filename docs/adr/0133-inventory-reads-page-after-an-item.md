# 133. The inventory reads page after an item, and stay arrays when no page is asked

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0125](0125-a-read-names-its-target.md) (a page continues after an item, the
  scope browse), [ADR 0127](0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md)
  (lists answer summaries; `names` and `match`), [ADR 0122](0122-what-a-model-reads-over-mcp-is-bounded-in-every-copy.md)
  (an MCP answer shows 50 items of a list and at most 60 KB)

## Context

Issue 468. Over MCP, an answer carries at most 50 items of any list and 60 KB (ADR 0122), and
says so when it cuts. The cut is honest, but an agent with only MCP had no way past it on four
reads: `models.list`, `macros.list`, `bi.questions.list` and `models.lineage` took filters
(`names`, `match`; `name`, `direction`, `depth`) and no page. A tenant with 176 models could
read its first 50 and then only guess at names to `match`; the whole lineage of a large tenant
(197 nodes, 996 edges) could not be read at all, only its parts. The CLI has no clip, so the
gap was MCP's alone, but the inputs are the router's and every door gets them.

`connections.browseScope` already paged, with the rule ADR 0125 states: the cursor names the
last item of a page and the next page starts after it, and a cursor whose item has gone is
refused `unknown-cursor`, remedy `restart`. That rule lived inline in `scopeChoices.ts`.

## Decision

**The four reads take `limit` and `cursor`, by ADR 0125's rule, from one owner.**
`services/listPage.ts` holds the rule: `pageAfter` cuts one listing after the item a cursor
names, and `pageBoth` cuts two listings in step under one cursor. `scopeChoices.ts` now uses
`pageAfter`, unchanged in what it answers and in the cursors it writes. A cursor is an item's
key as JSON in base64url, compared only for equality with a key the listing holds now, so a
cursor that is not one of ours finds no item and is refused the same way, with nothing to parse
that could throw.

- **Order and keys.** Models and macros page by name, which is unique and their `ORDER BY`.
  Questions page by id: names are not unique, and `listQuestions` reads `ORDER BY name, id`, so
  the id places a question exactly. The lineage keys a node by its id and an edge by its two
  ends, in the graph's own order (`modelLineage.ts`), which `distinctBy` makes unique.
- **Paging follows narrowing.** `names` and `match` cut first (`listFilter.ts`), so a name
  nothing carries is still refused `unknown-names` before any page is cut, and every page of a
  walk is a page of the same narrowed list. Every lineage page narrows by the same `name`,
  `direction` and `depth` (`lineageAround`) before it is cut.
- **A lineage page** carries at most `limit` nodes and at most `limit` edges, each continuing
  after its own last item. One list may run out first; its later pages are empty until the
  other is done. `nextCursor` is `null` only when both are. A node or an edge that has left the
  graph makes the cursor `unknown-cursor`.
- **Bounds and defaults.** `limit` is 1 to 1,000. A `cursor` with no `limit` answers 50 -- the
  items an MCP answer shows -- and `bi.questions.list` asked for `include: ["definition"]` answers
  20, since 32 questions with their SQL were 59 KB (issue 444). `pageAsked` decides "was a page
  asked" once; the 20 lives beside the questions it is about. A `cursor` is at most 1,024
  characters, as browseScope's always was; the page input is `PageInput` in `listInputs.ts`,
  shared with browseScope.
- **The refusal** is BAD_REQUEST with `details: { procedure, reason: "unknown-cursor", remedy:
"restart" }`, worded once (`error.pageCursorUnknown`).

**The answer is an array unless a page was asked.** Asked neither `limit` nor `cursor`, each
list answers exactly the array it did and the lineage exactly `{ nodes, edges }`. Asked either,
a list answers `{ items, nextCursor }` and the lineage `{ nodes, edges, nextCursor }`. This is
the `bi.schema` precedent (ADR 0125): the shape follows the question, and the browser narrows
the union back to the shape it asked for and fails, rather than draws one page as the whole,
should the other arrive (`wholeList` in `apps/ui/src/lib/listAnswers.ts`). Over MCP an unpaged
list is already wrapped as `{ items }`, so the two answers differ there only by `nextCursor`.

ADR 0127 says "every list stays an array". It still does for every request it described: none of
them names a page. The page is a second answer to a second question, not a change to the first.

## Consequences

- An agent with only MCP walks any of the four reads to its end, 50 items or fewer at a time,
  and knows it reached the end because `nextCursor` is `null` -- never because a page was short.
- The browser, the assistant's tools and every client reading these arrays are unchanged; the
  UI's types name the whole answer (`Whole<>` in `apps/ui/src/api/types.ts`).
- A walk still reads the whole list or graph on every page, as the scope browse reads its whole
  listing (ADR 0125). Paging bounds what reaches the client, not what the server reads: a
  tenant's lists are small to read, and the graph is known only once every model is read.
- A cursor from one read handed to another is not refused for that alone: a models cursor given
  to `macros.list` continues after a macro of the same name, if one exists. It is opaque and
  the reader's to hand back where it came from.
- `connections.list` and `seeds.list` do not page. Nothing has overflowed them; they take the
  same `PageInput` the day one does.

## Options rejected

- **Always `{ items, nextCursor }`.** One shape is simpler to type, and breaks every caller that
  reads these lists today -- the browser's screens, the assistant's tools, the published skills
  and every agent script that indexes the array -- for a question none of them asks.
- **An offset cursor** (`offset`, or a page number). Simpler, and silently skips or repeats
  whatever a list gained or lost between two pages: a model saved during a walk would push one
  the reader has not seen past the page they are on. ADR 0125 rejected it for the browse.
- **A second procedure per list** (`models.listPage`). Two doors to one list whose filters must
  then be kept identical by hand, and one more tool in every agent's list to choose between.
- **Paging lineage nodes alone, with each page's edges.** An edge belongs to two nodes on
  different pages; carrying "the edges among this page's nodes" loses the rest, and carrying
  "every edge touching them" repeats them. Two lists in step say each edge exactly once.
- **Paging in SQL** (`WHERE name > $cursor ORDER BY name LIMIT n`). Cheaper per page, but the
  narrowing it must follow runs after the read (`names`, `match`, ADR 0127) and the lineage
  cannot be cut before every model is read at all, so SQL could page only the plain list. It
  would also be a second copy of ADR 0125's rule beside `scopeChoices.ts`'s, one that reads a
  cursor whose item has gone as a place to continue rather than refusing it.
