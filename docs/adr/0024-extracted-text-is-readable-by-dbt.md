# 24. A document's text is readable by dbt, and says how it was read

- Status: Accepted
- Date: 2026-09-20
- Amends: the "NEVER put a name a human wrote into `raw.documents` or a lake key" rule in
  [`.claude/rules/pii.md`](../../.claude/rules/pii.md), by naming one table that deliberately
  holds what a human wrote
- Extends: [ADR 0015](0015-google-is-a-first-party-collector.md), which put a document's bytes
  in the lake and its opaque facts in Postgres, and left the content unread by anything

## Decision

A new table, `raw.document_text`, holds the **text of a landed document**, and
`undercroft_dbt` may `SELECT` it.

Every row carries either a `method` — how the text was obtained — or a `reason` why it could
not be. Never neither, and never an empty string standing in for both.

`raw.documents` itself does **not** change. Its metadata stays exactly as narrow as ADR 0015
and `pii.md` made it: opaque provider ids, types, counts. A filename, a subject or a folder
name still goes in the lake manifest and still never reaches Postgres. What this ADR permits
is one table whose **entire purpose** is the content, not a loosening of the columns beside it.

## Why the rule has to move at all

The bytes have been in the lake since ADR 0015 and nothing has ever opened them. Measured on a
real tenant: **122 documents, 347 MB** — 58 PDF (252 MB), 42 JPEG, 8 XLSX, 7 DOCX, 3 PNG,
2 legacy DOC, 2 TXT. Every one of them is archived, addressable by `lake_key`, verified by
`sha256` — and unqueryable. A customer asking "which of my contracts mentions this clause"
has no way to ask it, and the platform's answer today is that it holds the document and cannot
read it.

`pii.md`'s rule was written about **metadata**: `raw.documents` is granted to the dbt role, so
a filename in a column there is one `dbt run` from a dashboard, and a filename buys nothing
that an opaque id does not. That reasoning is still correct and still holds for that table.

It does not extend to the text, because the text is not incidental — it is the thing the
customer is asking for. A rule that forbids it forbids the feature, so the decision is to
permit it once, in one named place, rather than to let it arrive column by column.

## What still protects it

**The BI role cannot reach `raw` at all.** `packages/db/sql/040_grants.sql` revokes the whole
schema from it (`REVOKE ALL ON SCHEMA raw FROM undercroft_bi`), and `privileges.md` states the
rule behind that revoke. So extracted text reaches a dashboard only through a model the
customer wrote, in their own schema, as their own role — a deliberate step, not a default.

That single revoke is now the only thing standing between a scanned contract and a chart.
**Do not grant `undercroft_bi` anything in `raw` later.** Whatever reason arrives for it, the
right answer is a model in `analytics_<slug>`, which is what that schema is for.

## Why the method is a column and not a log line

`vcc-ostwin`, the project this extraction strategy is taken from, returns `(text, method)`
from every extractor and keeps both. That is worth copying, for the reason this codebase keeps
refusals: a PDF read through its text layer and the same PDF read by OCR are different
evidence, and an empty result from a missing binary is a third thing again.

Collapsing them into "we have no text for this document" is the failure `pii.md` and rule 2
already name in another form — the silent zero that cannot be told from a real absence. So the
method is a column a customer's model can filter on, and a refusal is a `reason` beside it.

## Options rejected

**Keep the text in the lake only, as a sidecar object.** It preserves the rule untouched and
is useless: dbt cannot read the object store, which is the whole point of the lake's access
boundary. The customer would be exactly where they started.

**Put the text in a separate schema outside `raw`.** It sounds safer and is worse. The text is
a projection of lake bytes, rebuildable and droppable, which is the definition of what lives
under `raw`; moving it elsewhere would state that it is durable when it is not, and would need
its own grant story rather than inheriting the one that already revokes BI.

**Extract during ingest.** OCR over 252 MB of PDFs is tens of minutes of CPU. Chaining it to
every sync makes an ingest run's duration a function of how much OCR is outstanding, and makes
a failed OCR look like a failed sync. It is its own verb, with its own `ops.run`.
