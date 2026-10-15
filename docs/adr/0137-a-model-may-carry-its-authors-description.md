# 137. A model may carry its author's description, and the list says what each model reads

- Status: Accepted
- Date: 2026-10-15
- Supersedes, in part: [ADR 0112](0112-a-model-carries-no-business-context.md). Its removal of
  the business context stands whole: no `models.setContext`, no state worked out on a read, no
  flag, no interview question, no lineage read on `models.get`. What this replaces is its last
  sentence of _Options rejected_, which left "documentation of models" for "a new decision about
  who writes it, for whom, and what checks it". This is that decision, and it is a much smaller
  thing.
- Extends: [ADR 0092](0092-lineage-draws-only-declared-relations.md) (lineage is computed from
  what models declare, never stored), [ADR 0127](0127-lists-answer-summaries-and-the-server-hashes-what-it-stores.md)
  (lists answer summaries, an identical re-save writes nothing, the revision), [ADR 0133](0133-inventory-reads-page-after-an-item.md)
  (`models.list` pages)

## Context

People asked for two columns on the model list: what a model is, and what it depends on.

**What it depends on already exists.** `modelLineage` reads every `ref()` and `source()` a
model's saved SQL declares, through its macros, and records why where it cannot (ADR 0092).
`models.lineage` answers the graph and the editor's dependencies band lists one model's edges.
The list cannot show it because `models.list` does not answer it, and an agent choosing between
176 models has to read the whole graph -- or one part per model -- to learn which reads which.

**What it is has nowhere to go.** `app.model` holds SQL and tests. dbt has a `description:` for
every model, which its manifest and docs carry, and `schema.yml` is written by this platform
(`dbtTests.ts`), so a description could reach dbt for free. ADR 0112 removed a much larger
feature -- a five-part business context, approved against a fingerprint, flagged `incomplete` on
all 183 production models -- and said that documentation, if it came back, needed its own answer
to who writes it, for whom, and what checks it.

## Decision

### A description: optional, the author's, checked by nothing

- **Who writes it:** the model's author, when they want to, through `models.save` -- the
  editor's field, the CLI's `--description`, an MCP client's `description`. Nothing asks for one.
- **For whom:** a person reading the model list, an agent choosing which model to build on
  (the model-builder skill offers the brief's grain sentence as one), and dbt, whose manifest
  carries it from `schema.yml`.
- **What checks it:** nothing checks what it says. It is a claim in the author's words, like a
  comment; the model's tests remain the only statement about its rows the platform verifies.
  There is no `incomplete`, no badge on a model without one, no state, and no interview
  question that must be answered -- every one of those is what made ADR 0105's feature a flag on
  everything.

`app.model.description` is `text NULL` (`580_model_description.sql`), 1 to 1000 characters.
`null` is a model nobody described, which every existing model is.

**Neither brace is allowed.** dbt renders a model's `description` through Jinja when it parses
the project. A `{{ ... }}` in one would be executed, and one that is not valid Jinja fails the
parse of the whole project -- every model of the tenant stops building because of one model's
prose. The contract (`ModelDescription`) and a CHECK refuse `{` and `}` outright, as
`accepted_values` already refuses them for the same reason (ADR 0130). Refusing the character
rather than parsing for Jinja keeps the rule one a reader can check by eye.

**`models.save` reads the field three ways.** A string sets it, `null` clears it, and a save
that leaves it out keeps the description stored. The other reading -- absent means none --
would make every save from the CLI, from MCP and from every agent written before this field
silently erase the description, the first time someone fixed a typo in the SQL. The choice is
made inside the one upsert statement (`saveModel`), so a save that does not mention the
description is compared on SQL and tests alone and an identical re-save is still `unchanged`
and writes nothing (ADR 0127).

**The revision moves when a description does,** because an agent that keeps a model's
description in a repository has to learn of an edit. Its hash joins a model's revision entry
only where there is one, so a model without a description keeps the revision it had: the
deploy does not tell every agent of every tenant that every model changed.

**`schema.yml` carries it.** A model with a description has an entry whether or not it has
tests, `description:` as a YAML double-quoted string. A model with neither is still absent: an
empty entry is a warning in dbt's eyes.

The model list shows a description muted under the model's name, two lines at most. A model
without one shows nothing there.

### What a model depends on: computed, and only when asked

`models.list` takes `include: ["dependsOn"]`, and answers each model's `dependsOn`:

- `reads` -- each thing the model declares it reads, by node kind (`model`, `seed`, `raw`,
  `missing`), name, and the macro that declares it (`via`);
- `undeclared` -- the reasons its upstream cannot be read from its declarations.

Empty `reads` with reasons in `undeclared` is **not** a model that reads nothing; it is one whose
upstream nobody can name from its SQL (rule 2). The list writes "upstream not declared" beside
such a row rather than "reads nothing".

It is the same graph `models.lineage` answers, cut per model (`dependsOnByModel`, in
`@undercroft/db/services`), so the list and the lineage cannot disagree. It is **computed on
every call that asks, never stored**, for ADR 0092's reason: a stored graph is one more thing a
save can leave stale, and every model and macro it is read from is already read. It is
**opt-in**: the whole lineage is read from every model and macro however few models a page
holds, and a list that did not ask should not pay for it -- issue 444 was a list too big for its
client.

## Consequences

- A fresh database and an existing one both gain a nullable column; no row changes. Every
  model reads `description: null` until someone writes one.
- `models.list` and `models.get` answer `description` on every model. A client that does not
  know the field ignores it.
- A save that sends a description where none was is a write: `updatedAt` moves, an audit row
  is written, the revision's `models` part changes. A save that sends the description already
  stored, beside the SQL and tests already stored, still writes nothing.
- dbt's manifest, and `dbt docs` were it ever run, carry each description.
- The model editor gains a description field, and the list a dependencies column: the
  visual-regression baselines for both are retaken with this change.

## Options rejected

- **Required, like a macro's description.** A macro's description is required because an
  agent reads it to reuse the macro rather than writing the expression again, and a macro is
  small enough that one sentence says what it does. Required on models, it would refuse every
  save of the 183 existing models until someone wrote prose for each -- ADR 0112's failure in a
  sharper form, a refusal instead of a flag.
- **Column-level descriptions.** dbt has them, and they are where ADR 0105 grew from: a meaning
  and a unit per column is documentation nobody here was asked for and nobody kept. One
  sentence per model is what was asked for; a column's meaning stays in the brief, and its
  checkable part in its tests.
- **Storing dependencies on the model row.** It would make the list one read cheaper and be
  wrong after any save of a model it refs, any macro edit and any seed added. ADR 0092 rejected
  storing the graph for exactly this.
- **`dependsOn` on `models.get`.** ADR 0112 returned `models.get` to reading one model, after
  the business context made every get read the tenant's lineage. The editor already lists one
  model's dependencies from `models.lineage`; `get` stays one model.
- **Absent means "clear".** Simpler to state, and it erases a description on every save by a
  caller that never heard of the field -- which is, on the day this ships, every caller.
- **A separate `models.setDescription`.** Two writes for one model, which a reader has to know
  to call together, and a second audit trail; and it could not join the identical-re-save
  decision, which lives in the one upsert.
