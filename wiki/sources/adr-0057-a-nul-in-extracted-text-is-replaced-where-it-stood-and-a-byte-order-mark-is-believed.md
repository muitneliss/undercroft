---
title: >-
  ADR 0057: A NUL in extracted text is replaced where it stood, and a byte-order
  mark is believed
type: source
date: 2026-09-25
tags: []
source: docs/adr/0057-a-nul-in-extracted-text-is-replaced-where-it-stood.md
source_path: docs/adr/0057-a-nul-in-extracted-text-is-replaced-where-it-stood.md
source_hash: 005e6bcf966cb9858d10bbb32ff7c0451c33ea5fa65c8e5035f10927061aa1a3
ingested: 2026-09-25
---

# ADR 0057: A NUL in extracted text is replaced where it stood, and a byte-order mark is believed

# ADR 0057: A NUL in extracted text is replaced where it stood, and a byte-order mark is believed

Accepted 2026-09-25. Issue #218. Extends the extract verb of [[ADR 0024: A document's text is readable by dbt]].

**Context.** Three hourly extract runs over one tenant's Drive failed with `invalid byte sequence for encoding "UTF8": 0x00`, stored nothing, and the backlog grew from 2,369 to 3,569. The plain-text and JSON readers decode with a non-fatal UTF-8 `TextDecoder`, and a NUL byte is valid UTF-8, so U+0000 reached the text; HTML, MIME, Word and OCR output can carry one too. `upsertDocumentText` writes a batch as one `INSERT ... FROM unnest(...)`, and a Postgres `text` column refuses U+0000, so one document failed the whole batch and the next run drew the same batch. The likeliest source is a UTF-16 text file (Excel "Unicode Text", bank statements) read as UTF-8 -- a hypothesis, not a measurement.

**Decision.** U+0000 becomes U+FFFD in `extractText.ts`'s `read`, the constructor every reading passes through; the text keeps its length and the document is read, not refused. A plain-text or JSON file with a UTF-16 byte-order mark (`FF FE` or `FE FF`) is decoded as UTF-16 -- the marks the WHATWG Encoding Standard sniffs; without one it is UTF-8 as before. The write stays one statement: with the NUL gone, no reader value is one Postgres refuses (`pg` encodes a lone surrogate as U+FFFD; the CHECK and digest are the caller's by construction). `CURRENT_READER_VERSION` is not bumped, because a bump re-offers refusals and these documents never got a row at all.

**Rejected.** Dropping the NUL (a mark-less UTF-16 file would print clean ASCII beside mangled accents -- plausible and wrong, `CLAUDE.md` rule 2); refusing the document (one byte costs every word); scrubbing in the repo (a value decision, and the repo decides nothing per `layering.md`); row-by-row or retry-per-row writes (defends against a failure nothing can now produce, at the cost of a second write path); detecting mark-less UTF-16 by counting zero bytes (a guess at an unstated encoding).

**Consequences.** A run over a source holding such a file succeeds and the backlog drains; a marked UTF-16 export reads as its words, Vietnamese included. The reporter's ask that a failed run record what it read before the error is not done: with a one-statement write a failed run stored nothing, so its zero counts are true.
