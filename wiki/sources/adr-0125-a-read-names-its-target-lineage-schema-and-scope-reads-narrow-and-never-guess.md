---
title: >-
  ADR 0125 A Read Names Its Target: Lineage, Schema and Scope Reads Narrow, and
  Never Guess
type: source
date: 2026-10-13
tags: []
source: docs/adr/0125-a-read-names-its-target.md
source_path: docs/adr/0125-a-read-names-its-target.md
source_hash: b19c23d5af7e123111abb44e00192e0b0a0bc4ebc27554b5f1d5b9e4d6e95803
ingested: 2026-10-13
---

# ADR 0125 A Read Names Its Target: Lineage, Schema and Scope Reads Narrow, and Never Guess

Extends ADR 0092 (what `models.lineage` answers) and ADR 0047 (the Drive listing). Four reads took no target, so the only answer was the whole tenant (issue 443): over 2,433 MCP calls `models.lineage` (101 KB) overflowed the client 11 times of 11, `connections.browseScope` (2,331 Drive folders, 315 KB) four times and `bi.schema` (164 KB) twice, each followed by a script over the spilled file.

Decision. Each read takes optional inputs that only narrow; with none it answers exactly what it did before, so the browser is unchanged. `models.lineage({ name, direction, depth })` answers the node, what it reaches within `depth` edges `up`, `down` or `both` (each walked on its own, never turning round to reach siblings), and every edge between kept nodes; `name` is a model, a raw table as `schema.table` (`raw.records`), or a missing dependency as written; the graph is still computed whole (`lineageAround`). `bi.schema` and `lake.querySchema({ tables, match, columns })` narrow by one rule in `tableSchema.ts` after the worker's read; `match` is a case-insensitive substring; `columns: false` answers `{ columns: false, tables: [{ name }] }` with no `columns` key per table, and the browser narrows the union back to the answer with columns. `connections.browseScope({ parentId, query, limit, cursor })` answers one level of the folder or label tree (`parentId: null` is the top), a search of names and folder paths, or a page with `nextCursor`; the worker still lists whole and places each item with `parentId` (a Drive folder's seen parent folder; a Gmail label's `/`-prefix label when it exists), and the control plane cuts it in `scopeChoices.ts`. `partial` passes through every cut unchanged.

Nothing that narrows may guess: an unknown model, table or parent is `NOT_FOUND` with the missing names in `details`, never an empty graph, shorter schema or empty level; a parent asked of a listing with no tree (Xero, HubSpot, or a worker from before `parentId`) is refused `not-a-tree`. A cursor names the last item of a page and the next page starts after it; an item that has left the listing makes it `unknown-cursor` (remedy `restart`) rather than a restart that repeats a page. The CLI gives a nullable scalar input its scalar's typed flag, so only `null` needs `--input-json`.

Consequences: agents get what they name; a browse still costs the worker a whole listing per page; items carry an optional `parentId`, the browse answer a `nextCursor`, and `bi.schema`'s answer type is a union. Rejected: narrowing in the worker (a Drive listing cannot be resumed half-way, so it reads whole anyway), an offset cursor (silently skips or repeats), an empty `columns` array (reads as no columns), a `top` flag or `""` sentinel (items already say `parentId: null`), and a regex `match`.
