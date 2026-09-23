# 40. The catalogue does not inherit the lake's deduplication

- Status: Accepted
- Date: 2026-09-23

## Context

`packages/lake/src/store.ts` is content-addressed. Its docstring records why: a legacy
provenance-addressed store held _15,790 artefacts over 5,259 distinct payloads — 10.42 GB where
1.98 GB would do_, and writing a blob at `_blobs/xx/<digest>` fixed it, to the point that an
existing object with a matching digest is not a collision but deduplication working.

`raw.documents`, the catalogue above it, is provenance-addressed, and nothing in the repository
said so. Gmail's only stable identity for an attachment is `(messageId, partIndex)` — its
`attachmentId` changes between fetches, so the choice is correct — which makes one attachment
quoted down a reply chain one row per message. **Production holds 4,476 catalogue rows over 2,030
distinct `sha256`: 55% of the catalogue names bytes it already names.** The lake solved 3:1
duplication by content-addressing; the layer above reintroduced 2.2:1 by provenance-addressing.

Three things followed, and none of them was visible:

1. **Every redundant row was re-extracted.** A blob GET, a full SHA-256 re-hash, a temp write,
   and — since the OCR readers landed in v1.16.0 — one `tesseract` child for an image or
   `pdftoppm` plus up to thirty `tesseract` children for a scan. A 30-page duplicate scan is 31
   processes re-run to produce text we already hold verbatim, and every
   `CURRENT_READER_VERSION` bump re-pays it.
2. **The customer was shown a byte total the object store disagrees with.**
   `summariseDocuments` summed `byte_length` across catalogue rows, so the Lake division's
   figure and the actual S3 bill differed by roughly the duplication ratio.
3. **A search matching a four-times-quoted attachment returned four near-identical hits**, on a
   20-hit page.

Separately, looking at the corpus to design the accuracy measurement surfaced what looked like
an inconsistency: `TEXT_LAYER_MIN_CHARS = 80` declared a PDF's text layer to be a scan's stray
characters, while the OCR reader had no floor at all — so 96 of 197 OCR'd images (49%) were
stored as reads at a length the same codebase would have called noise arriving from a PDF.

## Decision

**An extraction is reused across identical bytes, within one tenant and one source, and the
duplication is reported rather than hidden.**

- `PENDING_JOIN` in `apps/worker/src/repos/documentText.ts` offers **one row per distinct
  digest**, and `WRITE_BY_DIGEST` fans the answer out to every sibling row of the same
  `(tenant_id, source, sha256)` still awaiting one. The copy carries the `reader_version` of the
  pass that produced the text; a refusal fans out too, because bytes a generation cannot open
  are bytes it cannot open.
- `raw.documents (source, tenant_id, sha256)` is indexed by `250_documents_sha_idx.sql`. There
  was no index on `sha256` anywhere before it.
- `summariseDocuments` reports `distinctBlobs` beside `documents`, and **`bytes` is now summed
  over distinct blobs rather than over rows**. The Lake division prints both.

### Why cross-tenant reuse is refused by construction, and why RLS would not have caught it

Same-tenant reuse crosses nothing that exists in the schema: `tenant_id` matches, so the
`tenant_own` policy yields identically either way, grants are table- and column-scoped rather
than row-scoped, and `source_sha256` already records exactly the fact the reuse rests on.

Cross-tenant reuse is categorically wrong, and **the mechanism that looks like it would catch a
mistake does not.** The extract worker runs as `undercroft_worker`, which holds
`platform_all ... USING (true)` on both `raw.documents` and `raw.document_text`
(`180_document_text.sql`). **Row-level security protects readers; the writer is not one.** A
cross-tenant copy would materialise tenant A's contract into a row whose `tenant_id` is B, and
RLS would then serve it faithfully to B as B's own — enforcing a lie the writer told it. Nothing
would raise, nothing would go red, and B's own dbt login could `SELECT` it.

So the scope is a bind parameter in the statement, never data: `(tenant_id, source)`, the shape
`pendingDocuments` and `upsertDocumentText` already had.

"But the lake already shares a blob across tenants" is the argument to be ready for, and it does
not transfer. `_blobs/xx/<digest>` has no tenant segment, and that is safe because reaching a
blob requires its digest, which you only obtain from a manifest under a tenant-scoped key.
Copying _text_ publishes content into a row with no second gate in front of it.

### A routing threshold is not a quality bar

`TEXT_LAYER_MIN_CHARS` is renamed **`TEXT_LAYER_ROUTING_CHARS`** and its docstring now says what
it decides: below 80 normalised characters a PDF goes to a **different reader**, because for a
PDF there is one — `pdf_ocr` reads the same document a second way. For an image there is no
second way, so the identical number would mean _refuse_, which is a different decision.

**The measurement that settled it:** applying the garbage heuristic from `corpusSignals.ts` (≥25
high-code-point non-alphanumerics in the first 1,200 characters) to those 96 short OCR rows
returns **zero, mean 0.0**. They are clean text from small images that genuinely hold a few real
words. An 80-character floor on OCR would discard 96 correct readings — a loss dressed as a fix.
`ocr.ts` gates on **source bytes** instead, before it spends a child process, which is the
question an image can actually answer.

What the data does support is a signal rather than a refusal: `terseForSize` in
`corpusSignals.ts` counts a source large enough that almost no text is the suspicious shape.
**It stays a lead and is never acted on.** Confirming one means opening the document, which is
the human review queue the accuracy work says to measure before opening.

## Consequences

- Draining the extraction backlog costs roughly the duplication ratio less. At
  `DEFAULT_BATCH = 500` hourly and serialised, ~5 ticks rather than ~9.
- **The catalogue still holds duplicate rows, deliberately.** `documents_digest` is not UNIQUE
  and is not a constraint of any kind: duplicate digests within a tenant are the normal, correct
  state of a provenance-addressed table. The index exists to make them cheap, never to forbid
  them.
- Reuse across `gmail` → `drive` for one tenant is **out of scope**: `source` is in the primary
  key and widening it is a separate argument.
- The Lake division's byte figure changes meaning, and will drop for any customer with
  duplication. It now agrees with the object store's own inventory, which is the point.

## What the accuracy measurement could not establish

Recorded here as well as in `UNMEASURED` in `apps/worker/src/services/extract/accuracy.ts`,
because a number is conditional on what it was taken over and the conditions have to travel with
it:

- **Vietnamese OCR fidelity is unmeasurable with a synthetic fixture, at any quality.** A gold
  page can only be rendered in the fonts poppler substitutes, and none of them holds a
  Vietnamese glyph. Measured: `pdftotext` reads `Hợp đồng` from the gold PDF exactly, and the
  same file rasterised loses every accent. A score from that measures the fixture. **This is the
  one that matters most**, because the failure this corpus is most exposed to — OCR without the
  language pack — produces confident, clean, wrong words, and every plausibility signal we have
  would call such a document fine. **Garbage-free is not accurate.**
- **OCR fidelity on a real scan**, for want of labelled data: producing some means a person
  reading customer documents. Tier A scores OCR over a _rendered_ page, which is far cleaner
  than a photographed invoice; tier B asks only whether output is _plausible_.
- **Whether a defect count is a defect.** A garbage or `terseForSize` count is a lead.
- **Text a reader added that the document did not contain.** `added` is an upper bound only: a
  reader's own cell and part separators land in it beside anything genuinely invented.
- **Anything about a part the zip container dropped**, since the OOXML oracle reads members
  through the same `zip.ts` the readers do.

## Alternatives rejected

- **Deduplicating the catalogue itself** — one row per `(tenant, source, sha256)`. It would
  discard the fact that a document arrived four times, which is provenance and is the one thing
  `raw.documents` exists to record. Duplication is a fact about the corpus, not a defect in it.
- **Reusing across tenants**, which the lake's own blob sharing makes superficially tempting.
  See above: the asset is not the text, it is the fact that this tenant holds this document.
- **Leaving `bytes` as a row sum with the distinct count beside it.** The "the gap between the
  two IS the useful figure" argument holds for the counts, because both are true counts of
  something. It does not hold here: a doubled byte total is true of nothing — not the disk, not
  the bill, not any download a customer could perform — and the error is not recoverable from
  the counts either, because duplicates are not uniformly sized. A wrong number printed beside a
  correct one reads as a wrong number that has already been accounted for.
- **Giving OCR the same 80-character floor**, to make the two readers consistent. The data
  refuses it: 96 correct readings would go. The threshold was renamed instead, so the next
  reader sees a routing decision rather than an inconsistency to harmonise.
