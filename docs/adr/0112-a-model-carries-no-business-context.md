# 112. A model carries no business context

- Status: Accepted
- Date: 2026-10-06
- Supersedes: [ADR 0105](0105-a-model-carries-one-business-context-reviewed-against-its-definition.md),
  in full

## Context

ADR 0105 gave every model one business context -- a purpose, a grain, a key, each column's
meaning and unit, the rules it applies -- approved by an admin against a fingerprint of the
model's definition and of the models it reads, with a state (`incomplete`, `needs_review`,
`current`) worked out on every read. It shipped in #389, with a `models.setContext` procedure, a
band in the model editor, a column in the model list, and an interview in the model-builder skill
that asked for the key, the units and the rules so they could be saved.

Production says it does not belong here:

- **It asks the wrong people for the wrong thing.** Undercroft is for people who write dbt SQL and
  dbt tests. The feature asked them to write, and then approve, prose documentation for every
  model -- work the platform's users do not do and were not asking for.
- **Nobody used it.** The production tenant holds 183 models, and every one of their contexts was
  empty, all five sections missing. No other tenant has a model. `app.model_context` holds no row.
- **It flagged everything.** 183 models, 183 `incomplete` badges. ADR 0105 itself rejected
  fingerprinting the whole upstream chain because "a flag on everything teaches a reader to ignore
  the flag"; the feature reached the same state by another road, because a flag that no one
  answers is a flag on everything.
- **`current` verified nothing.** A context in its best state said only that some prose was
  approved against today's definition. It said nothing about the data. The model's `unique` and
  `not_null` tests were, and remain, the only check that a key identifies a row -- ADR 0105 had to
  spend a paragraph of UI copy keeping a reader from taking a declared key for a checked one.
- **It cost more than it gave.** About 2,700 lines across the contract, the service, the router,
  the UI, the store and the skills, and a read of every model and macro of the tenant, to work out
  lineage, on every `models.get` and `models.list`.

## Decision

**The business context is removed entirely.** Nothing of ADR 0105 survives:

- `models.setContext` is gone from the router, so from the CLI and `/mcp` too, which derive from
  it. `models.list` and `models.get` answer with a model's definition and last build, and no
  `context` field. `models.get` reads one model again, not the tenant's whole lineage.
- The contract's `ModelContext` and its companions, `services/modelContext.ts`, `repos/modelContext.ts`
  and their strings in both locales go.
- The model editor has no context band and the model list no context column. The browser's draft
  of a context, and its slot in the store, go with them.
- `500_drop_model_context.sql` drops `app.model_context`. `460_model_context.sql` stays as it was
  applied, because the migration ledger keys on a file's name: a database that already ran it
  would never notice it had gone (ADR 0036's rule that a change is undone by a later migration).
- The `undercroft-model-builder` skill returns to its interview before #389: the grain, the
  columns with their meaning, source and type, the rows, the name, the tests. Its questions about
  a key, units and business rules, its step that saved the context, and
  `references/context-audit.md` go. The `undercroft` skill no longer defines the term.

A model's meaning still has two homes, both of which existed before ADR 0105: the brief the
model-builder skill writes with the person before any SQL, and the model's tests, which are the
only statement about a model the platform checks.

## Consequences

- An agent or a person that called `models.setContext` gets the router's answer for a procedure
  that does not exist. No call ever succeeded in production: the table holds no row.
- An MCP client or CLI that read `context` from `models.list` or `models.get` finds it absent.
  The published skills were its only documented reader, and they no longer mention it.
- A fresh database creates `app.model_context` at 460 and drops it at 500. That is two statements
  and is the price of a ledger that never rewrites history.
- The model editor's views lose a band and a column, so the visual-regression baselines for the
  model list and the model editor are retaken with this change.

## Options rejected

- **Keep the backend and hide the UI.** The cost that matters is not the band: it is the contract,
  the procedure, the published skill text and a lineage read on every model read. Hidden, it would
  still answer `incomplete` for every model to every agent, and still be code to keep true.
- **Keep the skill's interview questions only, without storing the answers.** Asking for a key,
  units and rules made sense as input to something saved. With nothing saved, the questions
  lengthen every interview for an answer the platform discards; the grain sentence and the
  `unique` test already say what the key is, and say it in a form that is checked.
- **Keep it as it is, and wait for use.** A feature every reader is taught to ignore does not
  become useful by waiting: the 183 badges are what a new reader sees first, and each later model
  adds one. If documentation of models is wanted again, it is a new decision about who writes it,
  for whom, and what checks it -- not a reason to keep this one running empty.
- **Soften the flag instead** -- show no badge while a context is empty, flag only `needs_review`.
  It removes the noise and keeps every other cost, and it leaves the platform storing approvals
  that nobody writes.
