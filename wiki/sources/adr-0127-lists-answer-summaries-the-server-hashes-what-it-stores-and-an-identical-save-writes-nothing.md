---
title: >-
  ADR 0127 Lists Answer Summaries, the Server Hashes What It Stores, and an
  Identical Save Writes Nothing
type: source
date: 2026-10-13
tags: []
source: docs/adr/0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md
source_path: docs/adr/0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md
source_hash: bf5b504a63436e270335fbea7de69991f30301ad0950819990031bc4c7a78df6
ingested: 2026-10-13
---

# ADR 0127 Lists Answer Summaries, the Server Hashes What It Stores, and an Identical Save Writes Nothing

Extends ADR 0125 (a read names its target) and ADR 0113 (a mutation that takes effect is recorded). Two issues from one audit of 2,433 MCP calls: issue 444, lists that sent every item's body (`bi.questions.list` 69 KB of which 59 KB SQL, `connections.list` about 25 KB of chosen names, `models.list` 116 KB of build columns, `models.reference` 35 KB of static text per call); and issue 445, no cheap way to ask whether anything changed or whether the server's copy equals a local file, so a wrapper downloaded and hashed everything 401 times and sent byte-identical re-saves.

Decision. Lists answer summaries, `get` answers a body, and `include` brings a body back; every list stays an array. `bi.questions.list` answers `{ id, name, kind, chartType, updatedAt, updatedBy, definitionSha256 }`, with `include: ["definition", "chart"]` for either in full (the dashboard asks). `connections.list` leaves out `config` and adds `chosen` counts (`labels`, `folders`, `files`, `entities`, `properties` per object; `null` for a field of another kind, and `chosen: null` when no readable scope is recorded, so 0 is only a recorded zero); `include: ["config"]` for the names (scope picker and schedule ask); `runs.get` is unchanged. `models.list` leaves out build `columns` and adds `columnCount` (`null` while unknown, never 0), `include: ["columns"]` for the list; the lineage panel reads columns from `models.get`. Every list takes `names` and `match` by one rule (`listFilter.ts`, shared with `bi.schema`'s tables); an unknown name is `NOT_FOUND` naming all missing in `details.names`. `models.reference({ parts })` answers only `sources`, `platformMacros` or `tenantMacros`, marked with `parts`; whole without. The browser reads a body it asked for through a `select` (`listAnswers.ts`) that fails the query when it is missing; no casts.

The server hashes exactly the bytes it stores, in Postgres: `sqlSha256`, `testsSha256` on models, `sqlSha256`, `descriptionSha256` on macros, `definitionSha256` on questions, on list and get, as hex SHA-256 of `convert_to(column::text, 'UTF8')`. For text a client hashes its own file; for `jsonb` (tests, definition) Postgres normalises the text, so a client compares only with a hash the server gave. `models.revision` returns `{ revision, models, macros, questions }`: each part is the SHA-256 of canonical JSON of per-item entries in key order (key, then the hashes of what a save writes), `revision` the hash of the parts; repos read only names and hashes. A new kind (seeds) is one field on `RevisionParts`. An identical `models.save` or `macros.save` answers `{ ok: true, unchanged: true }`, touches neither `updated_at` nor `updated_by` and writes no audit row, decided by the upsert's own `WHERE ... IS DISTINCT FROM ... RETURNING`; `create` over a taken name stays refused.

Consequences: choosing costs a summary; the skills read `models.revision` and ask for `parts`; questions moved to `services/biQuestions.ts`, the reference to `services/modelReference.ts`, browse refusal wording to `handlers/browseRefusal.ts`; a no-op question save still writes. Rejected: `ifRevisionNot` on each list (turns arrays into unions for a call the revision already makes cheap), a monotonic counter (needs a writer per table and moves on identical re-saves), hashing in the control plane (a second definition of the bytes for `jsonb`), timestamps in the revision, reshaping lists into `{ items, revision }`, and a discriminated union per item (tRPC's serialised output drops optional undefined keys).
