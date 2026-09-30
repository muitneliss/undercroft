# 93. A document keeps its last accepted kind while a new catalogue is asked

- Status: Accepted
- Date: 2026-09-30
- Amends: [ADR 0085](0085-a-document-is-classified-into-its-tenants-own-catalogue-of-kinds.md),
  decision 7 (what the view gives a model) and decision 5 (what a provider failure writes).

## Context

ADR 0085 re-classifies every text when a catalogue is published, because any change to the list
can change any answer, and its view `raw.document_kinds` gives an `accepted_kind` that is NULL for
an answer given under a replaced catalogue.

Both halves are right, and together they are wrong for the person reading a dashboard. A publish
re-asks `tai-001`'s texts over about a day, and until a text is re-asked its `accepted_kind` is
NULL. An admin who ADDS one kind therefore empties every figure built on the column for a day, and
refills it in batches of 500 every half hour. The owner asked (2026-09-30) that a document keep
showing the kind it had, marked as old, until the new catalogue has answered for it.

A second hole sits under the first: a result is keyed by the digest and a new answer REPLACES the
row, so a provider failure (a 429) while the new catalogue is asked overwrote the old answer with
nothing -- the document lost its kind to an outage, not to a new answer.

## Decision

1. **The view gains `last_accepted_kind`**: the kind at 0.90 or above under whichever catalogue gave
   the answer, the current one or the one it replaced. `current` and `version`, already in the view,
   say which. It is appended as the view's last column (`450_document_kinds_last_accepted.sql`).
2. **`accepted_kind` does not change.** It stays "confirmed under the current catalogue", so a model
   that must count only what the current list confirmed reads exactly what it read before. A
   dashboard that must not go blank reads `last_accepted_kind` and shows `current = false` as old.
3. **A provider failure does not replace an answer given under another catalogue.** The worker's
   write skips it (`upsertKindResults`); the row stays on the old hash, which is what keeps the text
   due, so the next run asks it again as it would have. Every other outcome still replaces the row:
   a new answer below 0.90 is a real answer under the new list, and showing the old kind over it
   would contradict what was just said.

## Consequences

- Publishing costs what it did (every text is asked again) and no longer blanks a tenant's figures
  while it is paid for.
- An old answer may name a kind the new catalogue removed. It is shown as what it was -- the kind
  under version N -- and never as current; a reader who cares filters on `current`.
- Once a text is re-asked, its old answer is gone: the view shows the current answer, accepted or
  not. Only one answer per digest is ever kept, as in ADR 0085.

## Options rejected

- **Make `accepted_kind` itself fall back to the old answer.** Every model already written against
  it would silently start counting answers the current catalogue never gave.
- **Keep every version's answer as its own row.** Pays storage for history no reader asked for, and
  the view would have to choose one anyway.
- **Re-ask only the texts a change could affect.** Which texts a new kind can take from is not
  knowable without asking (ADR 0085's reason for re-asking all of them).
