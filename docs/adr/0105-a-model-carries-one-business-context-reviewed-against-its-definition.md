# 105. A model carries one business context, reviewed against its definition

- Status: Accepted
- Date: 2026-10-05
- Refs: #384
- Builds on: [ADR 0029](0029-the-assistant-is-an-interleaf.md) (the assistant has no model writes),
  [ADR 0044](0044-an-agent-reaches-undercroft-as-a-caller.md) and
  [ADR 0060](0060-an-agent-reaches-undercroft-over-mcp.md) (one router, three doors),
  [ADR 0067](0067-the-published-skills-are-one-family-over-both-doors.md) (the published skills),
  [ADR 0077](0077-deleting-a-model-drops-what-it-built.md) (deleting a model),
  [ADR 0086](0086-a-tenant-writes-its-own-macros.md) (a tenant's own macros) and
  [ADR 0092](0092-lineage-draws-only-declared-relations.md) (lineage reads only declarations).

## Context

A model stores its technical definition -- SQL, tests, the columns its last build found -- and
nothing about what it means. A person or an agent reading `stg_orders` has to guess what one
row is, which columns identify it, what `amount` is in, and which rules the SQL applies. The
model-builder skill already interviews a person for exactly this, and writes it as a brief,
which is then lost with the conversation.

A note kept anywhere else goes quietly stale. The SQL changes, a scheduled build adds a column,
a model it reads is rewritten, and the note still reads as true. A stale description that
looks current is rule 2 broken in prose: a wrong value that is invisibly false.

## Decision

- **One business context per model**, in `app.model_context` (`460_model_context.sql`): a
  purpose, a grain, a key, each column's definition with an optional unit or currency, and the
  rules the model applies. The shape is the contract's `ModelContext`; strict objects, so a key
  that is both declared and declared absent is refused, as is a column defined twice.
- **Each section can be answered or not**, and `missingSections` -- one pure function the
  server and the browser share -- names the unanswered ones. A key is answered by its columns
  (several for a composite key) or by "no key" with a reason. Rules are answered by a list or
  by an explicit `none`; an empty list is a question not yet asked. A half-written context may
  be saved; it is then `incomplete`, and says what is missing.
- **The state is derived on read and never stored.** Approving stores a fingerprint of the
  definition the context was approved against: the sha256 of the model's own SQL as written,
  the sha256 of its tests canonicalised (a column with no tests dropped, kinds as a sorted set,
  `canonicalJson`), the set of columns its build found; and the same three for each model it
  reads DIRECTLY. Reading compares that with `app.model` now. The precedence is `incomplete` >
  `needs_review` > `current`; `changes` is returned under `incomplete` too.
- **A change is named `{model, kind}`**: `sql`, `tests`, `columns` for the model or one it
  reads; `dependency` when the set of models it reads differs from approval (a model now read,
  or one no longer read); `missing` when a model it read has been deleted. The approved text is
  still returned under any warning: the old description is the best there is until a person
  writes a better one.
- **Direct upstream only, macros included.** "Reads" is `models.lineage`'s graph (ADR 0092): a
  declared `ref()`, in the model's text or in any macro it calls. With A -> B -> C, a change to
  A flags B and names A; C is described in terms of B, whose definition did not change, so C
  stays `current`. Approving B again without changing it leaves C alone.
- **What is not a change**: test kinds in another order, a column listed with no tests,
  columns in another order, and the FIRST build of a model approved before it was ever built
  -- columns going from none to some is the build finding what the SQL said, not the SQL
  changing.
- **Saving is approving, and carries a `basis`**: the sha256 of the fingerprint `models.get`
  returned. If the definition moved since, nothing is written and the answer is `CONFLICT`,
  worded in the caller's language. Nobody approves a definition they did not read. The
  approval that IS written records the fingerprint the service checked, so a save landing a
  moment after the check makes the context `needs_review` on the next read rather than
  silently approved.
- **`models.setContext`** is an admin procedure with effect `write`: a read-only credential
  cannot approve. `models.list` carries each model's state, `missing` and `changes`;
  `models.get` the whole context plus `absentColumns` (key or defined columns the last build
  did not have, `null` when never built) and `upstreamUndeclared` (lineage cannot read part of
  the model, so a change through it is not seen). Both are facts read off the definition, not
  judgements of meaning. The CLI command and the MCP tool come from the router like every other.
- **Advisory only.** `models.save`, `models.build` and `models.delete` neither read nor change
  a context. A context that needs review never blocks a build.
- **Cascade on delete.** A model deleted and created again under the same name starts with no
  context: it is a different model, maybe written by someone who never saw the first.
- **No grant for the worker, no tool for the assistant.** The worker records columns and knows
  nothing of contexts; deriving state on read is what lets it stay that way. The in-platform
  assistant (`writeTools.ts`) is given no `setContext`, for the reason it has no `models.save`
  (ADR 0029). An agent outside drafts, and writes only through a CLI profile that allows
  writes or an MCP grant of `write`, after a person's yes; no draft is stored on the server.
- **The UI says documentation, not data.** The band names a declared key "declared", never
  unique, verified or passed, and says in one sentence that this is the state of the
  documentation, not a test of the data. A key is checked only by the model's `unique` test.

## Consequences

- A scheduled build the control plane never hears about still flags a context whose columns
  it changed, the next time anyone reads the model.
- **V1 gap: a macro's text.** A macro that changes what it computes without changing which
  models it `ref`s is not seen: the fingerprint holds the models a model reads, not the macros
  it calls. A macro that starts or stops reading a model is seen, as `dependency`.
- **V1 gap: after a first build.** A context approved before the model's first build compares
  no columns until it is approved again: its fingerprint holds none, and a later read cannot
  tell the first build's columns from a later build's. `absentColumns` still shows any column
  the context names that the build lacks. Approving again after the first build closes it.
- Reading a model now reads every model and macro of the tenant once, to work out lineage --
  the cost `models.lineage` already pays.

## Options rejected

- **Storing the state**, set on save and cleared on approve. A scheduled build would change
  columns behind it, and keeping it true would need the worker to write `app.model_context`.
- **Fingerprinting the whole upstream chain.** Every model below the first change would flag,
  and a flag on everything teaches a reader to ignore the flag.
- **Fingerprinting macro text.** Every model calling a shared macro would flag on a comment
  edit; the gap above is the smaller cost, and is recorded rather than hidden.
- **Blocking a build or a save on `needs_review`.** The editor's promise is that a saved
  mistake is a row and a build runs what was saved; a stale description is a reader's
  warning, not a reason to keep a table out of date.
- **Drafts on the server.** A draft an agent wrote would sit beside the approved text looking
  half-official. The draft lives in the conversation, or in the browser's store, until a
  person approves it.
- **Inferring definitions** from column names, sample data or SQL. A guessed meaning is
  indistinguishable from a written one on the page.
