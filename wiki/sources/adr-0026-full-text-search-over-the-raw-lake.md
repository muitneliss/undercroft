---
title: 'ADR 0026: Full-text search over the raw lake'
type: source
date: 2026-09-20
tags: []
source: docs/adr/0026-full-text-search-over-the-raw-lake.md
source_path: docs/adr/0026-full-text-search-over-the-raw-lake.md
source_hash: d758640ee4f0ec3616ddba0ea162fb16789a23e8b20df5cf35fac77dff0fcd52
ingested: 2026-09-20
---

# ADR 0026: Full-text search over the raw lake

# 26. Full-text search over the raw lake, folded rather than dictionary-stemmed

* Status: Accepted
* Date: 2026-09-21
* Extends: [ADR 0024](0024-extracted-text-is-readable-by-dbt.md), which put a document's text in
  Postgres and left it reachable only by hand-written SQL
* Related: [ADR 0016](0016-the-worker-seals-the-control-plane-consents.md), whose "the worker
  holds what the control plane must not" argument is why the search runs where it does

## Decision

The Lake division gets **one search box** over a tenant's whole raw lake — `raw.records`
payloads and `raw.document_text` content — matching **diacritic-insensitively for Vietnamese**
and **with stemming for English**, in one query, admin-only.

Four things make it up, and each is a choice with a rejected alternative:

1. **Folding is built-in SQL, not the `unaccent` extension.**
2. **Two GIN expression indexes, not stored generated columns.**
3. **It runs as the tenant's dbt login, through the worker. No grant in the model changes.**
4. **The fold is length-preserving, so the snippet is the source's own Vietnamese.**

## 1. Why not `unaccent`

The textbook answer to Vietnamese diacritics in Postgres is an `unaccent` dictionary inside a
custom text-search configuration: `CREATE EXTENSION unaccent`, copy `simple`, remap the word
token types through it. It is one migration and it is what every article recommends.

It is ruled out here by what the **gate** can run. PGlite — real Postgres in WASM, and the only
place any of this repo's SQL is exercised before production — ships 21 contrib extensions at the
version this repo pins, and `unaccent` is not among them (`@electric-sql/pglite/dist/contrib/`
holds `pg_trgm`, `citext`, `hstore`, `fuzzystrmatch` and eighteen others; newer PGlite has
added it, this one has not). A search built on it would be enforced **nowhere** until a deploy:
`CLAUDE.md` already says a green `verify` is not evidence the rules held, and choosing a design
the offline gate structurally cannot execute makes that worse on purpose.

So `raw.fold` is `lower(translate(normalize(t, NFC), <table>, <table>))` — `normalize` and
`translate` are core SQL, identical in PGlite's PG 16 and in the managed database, with nothing
to install on either. The cost is that the table is a hundred-odd characters written out by
hand; `scripts/fold.test.ts` and `packages/db/src/rawSearch.test.ts` pin it.

**Rejected for the same reason:** a `pg_trgm` similarity search. It needs no dictionary, but
trigram similarity answers "looks like" rather than "contains", which for a contract reference
or an invoice number is a different question than the one being asked.

## 2. Why expression indexes and not a generated column

`ADD COLUMN ... GENERATED ALWAYS AS (...) STORED` is the shorter spelling and the one most
guides reach for. On `raw.records` it is a full table rewrite under `ACCESS EXCLUSIVE` — which
is precisely what `030_raw.sql` partitioned that table from its first migration to avoid, and
the payloads are already the largest thing in the database.

`CREATE INDEX ... USING gin (raw.record_tsv(payload))` on the partitioned **parent** adds no
column, propagates to the partitions that exist, and is inherited by every partition created
later for a new connector — so a new source is searchable with no migration, which is the same
property the table was partitioned for. Pinned by a test that plans a query against a partition
created after the migration ran.

## 3. Why the worker answers it

`180_document_text.sql` grants `undercroft_app` a **column-scoped** `SELECT` on
`raw.document_text` that deliberately excludes `text`, with the reason written beside it: the
UI had no screen for the content, and a request log is a far less controlled surface than the
table. A search box is a screen for the content, so that reasoning had to be revisited rather
than quietly outgrown.

**Rejected: granting `undercroft_app` the `text` column.** It would put every tenant's contract
text within reach of the internet-facing process for the sake of one endpoint, and it would
make a future bug in any control-plane handler a document-disclosure bug.

**Taken instead:** the search goes the way `lake.query` already goes — control plane → worker →
`sessions.as({ kind: "dbt" })`. The dbt login is the one `ops.provision_tenant` grants `SELECT`
on all three `raw` tables; the row-level policy on `raw`, keyed on `raw.tenant_of(current_user)`,
scopes it to one customer; and the statement runs inside the console's own read-only frame
(`inReadOnlyTransaction`, shared rather than copied, because a second spelling is a second place
to forget `SET TRANSACTION READ ONLY`).

**The exposure is therefore unchanged.** An admin admitted to this endpoint could already have
typed `SELECT text FROM document_text WHERE text LIKE '%...%'` into the Lake Console beside it
and got the same bytes back over the same hop. What changes is that they no longer have to, and
that a Vietnamese operator gets an answer when they type without tone marks. The grant model is
untouched: no role gains a privilege in this change, and `undercroft_bi` is still revoked the
whole `raw` schema.

Admin-only, for the reason `lake.records` is: an excerpt is the source's data verbatim.

## 4. Why the fold is length-preserving

The obvious snippet is `ts_headline`. It can only be given the **folded** text — that is what
the tsquery matches — so a Vietnamese operator searching their own documents would be shown
`hop dong thue nha`: their language with the tones stripped off, in their own product.

So `raw.fold` maps one character to one character (`translate` over NFC, not
`normalize(NFD)` + strip-the-marks, which changes length **and** leaves `đ` alone — `đ` being a
letter rather than a d with a mark on it, and most Vietnamese words holding one). An offset
found in the folded text is then valid in the NFC original, and `raw.search_excerpt` cuts the
window out of the original. Highlighting happens in the browser through the same fold
(`apps/ui/src/lib/fold.ts`), rather than as markup on the wire that every reader would have to
trust or escape.

That property is the one thing that cannot quietly break: if folding ever changes a string's
length, the excerpt slides off the match and returns a wrong answer that looks like a right one.
It is pinned on both sides — `length(raw.fold(x)) = length(normalize(x, NFC))` over a corpus in
SQL, the same in TypeScript — and `scripts/fold.test.ts` reads both real files and fails if
either table learns a letter the other does not.

**When no query term occurs literally** — a real match through the English stemmer, `contract`
against `contracts` — the excerpt is the head of the text and nothing is highlighted. Not a
nearby guess: a window positioned on a guessed offset reads exactly like one positioned on a
found match, which is rule 2 of `CLAUDE.md` broken by the presentation layer.

## What is deliberately limited

* **200,000 characters per value.** `to_tsvector` raises above the 1 MB tsvector ceiling, and
  inside an expression index that error is raised by the `INSERT` — so an unguarded index would
  refuse to land the document it was built to find. Past the cap a value is searchable in its
  first 200,000 characters and not beyond. Stated, and pinned by a test; `raw.record_tsv` falls
  back rather than going blank, because an unfindable row is worse than a truncated one.
* **Rank across the two kinds is a heuristic.** `ts_rank_cd` over a short JSON payload and over
  twenty pages of contract are not measuring the same thing. Within a kind the order is honest;
  across them it is an ordering, and the page is small enough to scan.
* **Records are indexed by value, not by key.** Indexing `payload::text` whole would make a
  search for `name` return every record a source ever sent — technically a match, useless as an
  answer.
* **Tombstones are returned, and say so.** "Which contract said this" is asked about terminated
  contracts more often than live ones; a hit that did not admit it had been deleted upstream
  would read as a current fact.

## Consequences

* One new migration, `190_raw_search.sql`, and one edited line in `080_tenant_isolation.sql` —
  the same two-sided shape ADR 0024 used, because the ledger keys on a file's name: the edit
  reaches fresh databases and future tenants, a catch-up loop covers the tenants that already
  exist.
* Index size. Two tsvectors per value (`simple` for Vietnamese syllables, `english` for stems)
  is more index than one, and buys a box that does not ask the reader which language a document
  was written in — which they generally do not know before they search.
* A second fold, in the browser, which is why `scripts/fold.test.ts` exists.
* English stemming is applied to folded Vietnamese as well. Vietnamese is analytic and its
  syllables are already separate words, so the `simple` half carries the language; the `english`
  half occasionally produces a stem of a Vietnamese syllable, which costs a little index and
  matches nothing a reader would notice.
