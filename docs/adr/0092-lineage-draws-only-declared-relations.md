# 92. Lineage draws only the relations the models declare

- Status: Accepted
- Date: 2026-09-30
- Refs: #346, the design contract `docs/design/operator-and-reader-paths.md` ("Lineage, inside
  the Models division").
- Builds on: [ADR 0002](0002-one-generic-raw-table-no-business-schema.md) (one generic raw
  table), [ADR 0019](0019-the-wheel-is-full.md) (seven divisions),
  [ADR 0043](0043-a-second-mailbox-is-a-second-source.md) (a second account is a second source),
  [ADR 0077](0077-deleting-a-model-drops-what-it-built.md) (deleting a model leaves the models
  that ref it) and [ADR 0086](0086-a-tenant-writes-its-own-macros.md) (a tenant's own macros).

## Context

An analyst following one model's inputs today opens every model's SQL and follows its `ref()`
calls by hand. Nothing reads a model's `ref()` and `source()` for display, although
`models.check` already reads them (`jinja.ts`) to tell an author about an unknown ref.

A lineage view is easy to make look complete and hard to make true. The obvious additions --
an edge from the Gmail account a model filters on, an edge from a model to the dashboard that
reads it, an edge between `stg_deals` and `stg_deals_v2` -- would each be guessed, from a
`where source = ...`, from a question's SQL, from a name. Every account lands in the same raw
tables and a model picks its account by a filter (ADR 0002, 0043), and nothing in a model's row
says which question reads it. A guessed edge is drawn exactly like a declared one, and a reader
trusts it the same; a missing one reads as proof of no dependency. Both are rule 2 broken in a
picture.

## Decision

- **`models.lineage`** is a read-only procedure with `models.list`'s gate (any member of the
  customer), reaching the CLI and MCP through the router like every other. It is computed on
  every call from the saved models' and macros' text (`modelLineage.ts` in `packages/db`), not
  stored: a stored graph is one more thing a save could leave stale.
- **An edge is a declaration and nothing else**: model to model for `ref('m')`, raw lake table
  to model for `source('undercroft', 't')` -- the one source the platform declares -- each only
  when every argument is a plain literal, as `jinja.ts` reports it. There are no source-account
  nodes and no report, question or dashboard nodes.
- **A macro's declarations count for the model that calls it**, through as many macros as it
  takes, each macro read once however the calls cycle. The shipped `gmail_letters()` gives its
  caller the raw records; a tenant's macro is read from its saved definition. The edge names the
  macro whose text holds the declaration.
- **"Upstream not declared" rather than no parents.** A model whose upstream its text cannot
  show carries each reason: a `ref()` or `source()` with an argument that is not a literal; a
  call to a macro the project does not hold; a relation named directly past `ref()`/`source()`
  -- what `models.check` reports as `raw-direct` and `analytics-direct`, and any table of a
  declared source's schema after `from` or `join`, such as `raw.document_text`; and a query run
  from Jinja (`run_query`, `statement`), whose SQL is a string. The last two go beyond the design
  contract's examples; they are the same case -- a read the declarations do not show.
- **A ref to a model that does not exist is a missing-dependency node, with its edge.** ADR
  0077 keeps the models that ref a deleted one; their next build fails and says why, and the
  lineage shows the same fact before the build does. A `source()` naming a table the source does
  not declare is a missing dependency the same way.
- **It is a view of the Models division**, not an eighth division (ADR 0019), at
  `/tenants/:id/models?view=lineage&model=<name>`. Not under `/models/…`, where every segment is
  a model's name: a segment called `lineage` would shadow a model a customer may call that.
- **Selecting a model highlights its whole upstream chain and dims the rest**, and says so in
  words on every node and in a text list of the chain -- what each node reads, and why when it
  cannot be read. Below 760px the drawing gives way to that list, which wraps, so every name in
  the chain is readable. The drawing is plain HTML and SVG on a fixed grid: no graph library.

## Consequences

- The picture is only as complete as the declarations. A model that reads a relation without
  declaring it shows that it does, with the reason, and never as a model that reads nothing.
- Relations to the outside -- an account, a report -- stay undrawn until they have a declared
  contract of their own. That is the design contract's "out of scope", recorded here as the
  reason rather than as a gap.
- A new way for a model to read (a second declared source, a dbt package) needs its reading
  added to `modelLineage.ts`, or every model using it is marked "upstream not declared" -- the
  failure is loud, which is the direction it should fail in.
- The graph is recomputed per request by reading every model and macro of the tenant. A
  tenant's project is small; if one stops being, the answer is a cache keyed by the texts'
  `updated_at`, not a stored graph.

## Options rejected

- **Inferring edges from table names, filters or data**, including an edge from a source
  account. A guessed edge is indistinguishable from a declared one on the page.
- **Asking dbt for its manifest** (`dbt parse`). It is the authoritative graph, but it needs the
  worker, a parse of the whole project on every view, and it fails outright on one broken model,
  leaving nothing to show for the others. The text reader is already the one `models.check`
  trusts, and reports what it cannot read instead of failing.
- **Dropping a ref whose target is gone.** It would hide the one fact about that model a reader
  most needs.
- **A path such as `/models/lineage`.** It collides with a model named `lineage`.
- **A graph library** (the run map's `@xyflow/react`). Its canvas is a pan-and-zoom surface
  that needs its own keyboard model; a layered grid with a text list says the same and reads on
  a phone.
