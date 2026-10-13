# 127. Lists answer summaries, the server hashes what it stores, and an identical save writes nothing

- Status: Accepted
- Date: 2026-10-13
- Extends: [ADR 0125](0125-a-read-names-its-target.md) (a read names its target),
  [ADR 0113](0113-every-action-is-in-the-audit-log-and-people-can-read-it.md) (a mutation that takes effect is recorded)

## Context

Two issues from the same audit of 2,433 MCP calls in 119 agent sessions.

Issue 444: several lists returned every item's body, so choosing one item cost the whole
tenant's content. `bi.questions.list` sent every definition (32 questions, 69 KB, 59 KB of it
SQL). `connections.list` sent every selected HubSpot property and Drive pick (25 KB on
average). `models.list` sent every build's columns (176 models, 116 KB; it overflowed the
client 17 times). `models.reference` sent the same static `sources.yml` and platform macros on
every call (35 KB, 25 calls), mostly to read the tenant's own macros.

Issue 445: an agent that keeps SQL in a repository had no cheap way to ask "did anything
change?" or "is the server's copy the same as my file?". Its wrapper downloaded every list and
hashed it on the client 401 times, fetched whole models 708 times to compare them, and sent 10
byte-identical re-saves, each of which looked like an edit to everyone watching.

## Decision

**Lists answer summaries, `get` answers a body, and `include` brings a body back.** Every list
stays an array.

- `bi.questions.list` answers `{ id, name, kind, chartType, updatedAt, updatedBy,
definitionSha256 }`. `include: ["definition", "chart"]` adds either in full, which the
  dashboard's tiles ask for.
- `connections.list` leaves out `config` and adds `chosen`, the counts of what the scope chose:
  `labels`, `folders`, `files`, `entities`, and `properties` per object. A field that does not
  belong to the card's kind is `null`, and `chosen` is `null` when no readable scope is
  recorded, so `0` is only ever a recorded zero. `include: ["config"]` adds the names, which the
  scope picker and the schedule ask for. `runs.get`'s recorded scope reads `configOf` directly
  and is unchanged.
- `models.list` leaves out each build's `columns` and adds `columnCount`, `null` while no build
  has found any (a SELECT always has a column, so none recorded is "not known", never 0). The
  rule the browser kept in `builtColumnCount` moved to the server. `include: ["columns"]` adds
  the list. The lineage panel reads the columns from `models.get`, which it already fetches.
- `macros.list` already left out definitions.
- Every one of the four takes `names` and `match`, narrowed by one rule (`listFilter.ts`),
  which `bi.schema`'s tables now share. A name nothing carries is `NOT_FOUND` naming every
  missing one in `details.names`, as ADR 0125 refuses an unknown table.
- `models.reference({ parts })` answers only `sources`, `platformMacros` or `tenantMacros`,
  marked with `parts`, and reads the tenant's macros only when asked. With no `parts` it answers
  whole, as before.

The browser's types say a body may be absent, because a procedure's output type cannot depend
on its input. A screen that asks for a body reads it through a `select` (`listAnswers.ts`) that
fails the query when the body is missing rather than drawing a tile with no chart or a scope
picker that reads a missing selection as "nothing chosen". No cast anywhere.

**The server hashes exactly the bytes it stores, in Postgres.** Each model carries `sqlSha256`
and `testsSha256`, each macro `sqlSha256` and `descriptionSha256`, each question
`definitionSha256`, on the list and on `get`: hex SHA-256 of
`convert_to(<column>::text, 'UTF8')`. For text (SQL, a description) that is the SHA-256 of the
UTF-8 text a client holds, so a client hashes its file and compares. For `jsonb` (tests, a
definition) it is Postgres's own text of the stored value, which normalises key order and
spacing; a client cannot reproduce it and compares with a hash the server gave before. Hashing
in SQL rather than over a JavaScript serialisation is what makes it the stored bytes:
`JSON.stringify` orders nothing and `canonicalJson` refuses JavaScript numbers.

**`models.revision` answers whether anything changed, in one small read.** It returns
`{ revision, models, macros, questions }`. Each part is the SHA-256 of the canonical JSON of
one entry per item in key order -- the item's key, then the hash of each thing a save writes
(`[name, sqlSha256, testsSha256]`, `[name, sqlSha256, descriptionSha256]`,
`[id, name, definitionSha256, chartSha256]`) -- and `revision` is the hash of the parts
together. The repos read only names and hashes, so no SQL leaves Postgres to compute it. A part
moves on a create, a delete, a rename and a real edit, and holds on an identical re-save and on
a build. A new kind of authored content (the seeds) is one more field on `RevisionParts`, which
the compiler then requires `partsOf` to answer; adding it changes every `revision` once.

**An identical save writes nothing.** `models.save` with the stored SQL and tests (compared as
`jsonb`, by value) and `macros.save` with the stored description and definition answer
`{ ok: true, unchanged: true }`, touch neither `updated_at` nor `updated_by`, and write no audit
row, because nothing took effect (ADR 0113). The repo decides it in the upsert's own
`ON CONFLICT ... DO UPDATE ... WHERE stored IS DISTINCT FROM new ... RETURNING`, so two racing
saves cannot both read "different" and both write. Every successful save now answers
`unchanged`, `false` for a write. A `create` over an existing name stays refused, identical or
not.

## Consequences

- Choosing an item costs a summary; reading one costs that item. The skills say so, read
  `models.revision` before acting on what they read earlier, and ask `models.reference` for
  `parts`.
- The schedule and the scope picker ask `connections.list` for its config, and the dashboard
  asks `bi.questions.list` for its bodies; every other screen reads the summary, so the
  browser sends less too.
- `services/bi.ts` lost its questions to `services/biQuestions.ts`, the model reference moved
  to `services/modelReference.ts`, and `browseScope`'s refusal wording to
  `handlers/browseRefusal.ts`: each file had grown past what one may be.
- A no-op question save still writes: `bi.questions.save` was not asked for and is unchanged.

## Options rejected

- **`ifRevisionNot` on each list, answering `{ unchanged: true }` with no items.** It turns
  each list's answer from an array into a union, for every caller, to save a call the revision
  already makes cheap: a client reads `models.revision` and lists only when it moved.
- **A monotonic counter for the revision.** It needs a writer on every save and delete of three
  tables (a trigger or a sequence per tenant), and it moves on an identical re-save unless every
  writer is taught not to. A hash of content is computed from what is already stored and is
  equal exactly when the content is.
- **Hashing in the control plane.** Equal for text, but for `jsonb` it hashes a JavaScript
  re-serialisation, which is a second definition of the bytes.
- **Timestamps in the revision.** `updatedAt` moved on every identical re-save until this ADR,
  and a timestamp says when, not what; content says what.
- **Reshaping a list into `{ items, revision }`.** Breaks every caller to carry a value one
  separate read answers.
- **A discriminated union per list item for the body.** tRPC's serialised output drops an
  optional `undefined` key, so `"definition" in item` cannot narrow; optional fields and one
  checked `select` read better and need no cast.
