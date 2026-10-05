---
title: ADR 0105 A Model Carries One Business Context, Reviewed Against Its Definition
type: source
date: 2026-10-05
tags: []
source: >-
  docs/adr/0105-a-model-carries-one-business-context-reviewed-against-its-definition.md
source_path: >-
  docs/adr/0105-a-model-carries-one-business-context-reviewed-against-its-definition.md
source_hash: 5d2f8bd7df5f710d65482fec61083799b6912c556440cda432148cdd6e44e8cf
ingested: 2026-10-05
---

# ADR 0105 A Model Carries One Business Context, Reviewed Against Its Definition

A model used to store only its technical definition -- SQL, tests, the columns its last build found -- so a person or agent had to guess what one row is, its key, what each column means and which rules it applies; a note kept elsewhere goes quietly stale when the SQL or a build changes. Each model now carries **one business context** in `app.model_context` (migration `460_model_context.sql`): purpose, grain, key, each column's definition with an optional unit or currency, and the rules it applies. The contract's `ModelContext` is strict: a key that is both declared and declared absent is refused, as is a column defined twice. Builds on [[ADR 0092 Lineage Draws Only Declared Relations]], [[ADR 0086 A Tenant Writes Its Own Macros]] and [[ADR 0077 Deleting a Model Drops What It Built]].

Decision. `missingSections`, one pure function shared by server and browser, names unanswered sections: a key is answered by its columns (several for a composite key) or by "no key" with a reason; rules by a list or an explicit `none`. A half-written context may be saved and is then `incomplete`. **The state is derived on read and never stored**: approving stores a fingerprint -- the sha256 of the model's SQL, the sha256 of its canonicalised tests (empty columns dropped, kinds a sorted set), its built column set, and the same for each model it reads DIRECTLY (declared `ref`s, through macros too). Reading compares it with `app.model` now; precedence is `incomplete` > `needs_review` > `current`. Each change is `{model, kind}` with kind `sql`, `tests`, `columns`, `dependency` (the set of models read changed) or `missing` (a model read was deleted); the approved text is still returned under the warning. With A -> B -> C a change to A flags B only. Test order, an empty test column, column order and the first build of a never-built model are not changes. Saving is approving: `models.setContext` (admin, effect `write`) carries the `basis` -- the hash of the fingerprint `models.get` returned -- and a moved definition is a `CONFLICT` with nothing written. `models.list` carries each model's state; `models.get` the whole context plus `absentColumns` and `upstreamUndeclared`, facts rather than judgements. Save, build and delete are unchanged: advisory only. The row cascades with its model, so a model recreated under the same name starts with no context. The worker gets no grant and the assistant no tool ([[ADR 0029: The assistant is an interleaf, and it acts only through the router]]); an outside agent only drafts, and writes after a person's yes through a write grant. The UI calls a key "declared", never unique or verified, and says this is documentation, not a test of the data.

Consequences: a scheduled build that changes columns is seen on the next read. V1 gaps: a macro whose text changes without changing which models it refs is not seen; and a context approved before the model's first build compares no columns until approved again. Rejected: storing the state, fingerprinting the whole upstream chain, fingerprinting macro text, blocking a build or save on `needs_review`, server-side drafts, and inferring definitions from names or data.
