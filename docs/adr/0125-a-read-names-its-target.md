# 125. A read names its target: lineage, schema and scope reads narrow, and never guess

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0092](0092-lineage-draws-only-declared-relations.md) (what `models.lineage`
  answers), [ADR 0047](0047-drive-reads-with-drive-readonly.md) (the Drive listing)

## Context

Four reads took no target, so the only answer was the whole tenant (issue 443). Over 2,433 MCP
calls in 119 agent sessions, `models.lineage` (197 nodes, 996 edges, 101 KB) overflowed the
client 11 times out of 11, `connections.browseScope` (2,331 Drive folders with paths, 315 KB)
four times and `bi.schema` (191 tables, 164 KB) twice. Each time the agent's next step was a
script over the spilled file to keep the five to ten things it had asked about.

## Decision

Each read takes optional inputs that only narrow. With none, each answers exactly what it
answered before, so the browser is unchanged.

- **`models.lineage({ name, direction, depth })`** answers the part of the graph around one
  node: the node, what it reaches within `depth` edges `up` (what it reads), `down` (what
  reads it) or `both`, and every edge between two kept nodes. `both` walks each way on its
  own; a walk that turned round would reach a model's siblings and call them related. `name`
  is a node's name as the graph spells it: a model, a raw table as `schema.table`
  (`raw.records`), or a missing dependency as written. The graph is still computed whole,
  since what reaches a node is known only once every model is read (`lineageAround`).
- **`bi.schema` and `lake.querySchema({ tables, match, columns })`** answer the named tables,
  or those whose name holds `match` as a case-insensitive substring, by one rule in one
  service (`tableSchema.ts`) after the worker's read. `columns: false` answers
  `{ columns: false, tables: [{ name }] }`: no table carries a `columns` key. The browser's
  queries narrow the union back to the answer with columns and fail, rather than draw empty
  tables, should the other arrive.
- **`connections.browseScope({ parentId, query, limit, cursor })`** answers one level of the
  folder or label tree (`parentId: null` is the top), a search of names and folder paths, or a
  page with `nextCursor`. The worker still lists whole and now says where each item sits:
  `parentId` on a Drive folder (the folder above it, when the listing saw one) and on a Gmail
  label (the label its name continues past a `/`, when one exists). The control plane cuts
  the listing (`scopeChoices.ts`). `partial` passes through every cut unchanged: a page of an
  incomplete listing is a page of something incomplete.

**Nothing that narrows may guess.** A model, table or parent that is not there is refused as
`NOT_FOUND`, worded for the reader and naming what is missing in `details`, never answered
with an empty graph, a shorter schema or an empty level -- each of which would read as a fact
about something that does not exist. A browse by parent over a listing in which no item has a
place in a tree (Xero's organisations, HubSpot's properties, or a worker built before
`parentId`) is refused as `not-a-tree` rather than answered as an empty level.

**A page continues after an item, not at a number.** The cursor names the last item a page
held; the next page starts after it in the listing as it is read then. An item that has left
the listing makes the cursor `unknown-cursor`, refused with remedy `restart`, rather than a
page restarted from the top that repeats what the reader has.

The CLI gives a nullable scalar input the typed flag of its scalar, so `--parent-id <id>`
works and only `null` needs `--input-json`.

## Consequences

- An agent asks for the five things it wants and gets five things. The skills say to.
- A browse still costs the worker a whole listing per page -- a dozen paced Drive requests.
  Paging bounds what reaches the client, not what the worker reads.
- `BrowseScopeResponse` items carry an optional `parentId`, and the control plane's browse
  answer carries `nextCursor` (`null` when whole). `bi.schema`'s answer type is a union.

## Options rejected

- **Narrowing in the worker.** The worker owns the listing, but a Drive listing cannot be
  resumed half-way -- each folder's path needs the folders above it, which the sort spreads
  across Google's pages -- so the worker would read whole anyway. The tree is the worker's
  knowledge and leaves it as data (`parentId`); the cut is a reader's request and stays with
  the router's other narrowing. The schema reads stay out of the worker for the same reason:
  one catalogue query is cheap, and one rule serves both doors.
- **An offset cursor.** Simpler, and silently skips or repeats whatever a listing gained or
  lost between two pages.
- **An empty `columns` array for names alone.** It reads as a table with no columns.
- **A `top: true` flag, or `""`, for the top of a tree.** Items already say `parentId: null`
  at the top; asking with the value the answer uses needs no second input and no sentinel.
- **A regex for `match`.** One more language to get subtly wrong, run on a caller's input.
