# 36. The readers ADR 0028 deferred, and a refusal that can be retried

- Status: Accepted
- Date: 2026-09-22
- Implements: [ADR 0028](0028-a-workbook-is-read-in-process-and-extract-is-scheduled-by-backlog.md),
  which named `pdf_ocr` and `image_ocr` as methods nothing dispatched to, and deferred
  `tesseract-ocr` on a stated condition

## Decision

Five content types gain readers — `.docx`, `text/csv`, `image/png`, `image/jpeg`, and a
scanned PDF — and a refusal stops being permanent.

ADR 0028 deferred OCR with a condition rather than a ban, and `deploy/Dockerfile.worker`
carried it in as many words: _"shipping a 200 MB binary nothing calls is weight in the image
and an attack surface in the process. **It arrives with the reader that needs it.**"_ The
binary now has callers. This ADR records that the condition was met, not that a decision was
reversed. (The 200 MB was an estimate; measured on amd64 it is 75.5 MB plus 547 kB for the
Vietnamese pack.)

Four parts of the decision are load-bearing enough to state here.

**A `.docx` is read lexically, not by walking a document model.** Turn `</w:p>` and `</w:tr>`
into a newline, `</w:tc>` into `" | "`, strip tags, decode entities — over `word/document.xml`
and the header, footer, footnote and endnote parts beside it. `zip.ts` is reused unchanged; a
Word document is a zip of OOXML exactly as a workbook is, so this costs no dependency, no
`soffice` and no container.

**OCR is always asked for in Vietnamese as well as English.** `tesseract … -l vie+eng`, and
`tesseract-ocr-vie` is pinned in the image.

**Not every image is a document.** An image below `OCR_MIN_IMAGE_BYTES` (20 KB) is refused by
name as `image-too-small-to-read` and no child process is started for it.

**`raw.document_text.reader_version` makes a refusal retryable.** The backlog predicate — one
constant, `PENDING_JOIN` — gains `OR (t.method IS NULL AND t.reader_version < <current>)`.
Bumping `CURRENT_READER_VERSION` re-offers everything that has no text, exactly once.

## Why

### The measurement that prompted it

On production, tenant `tai-001`, after the streaming work of ADR 0033–0035 finally landed
attachments: **1,557 images and 13 `.docx` recorded `unsupported-content-type`**, against 387
PDFs and 22 workbooks read. About three quarters of a customer's attachments were in the lake
and invisible to search and to dbt. The refusal was honest — that is what `UNSUPPORTED_TYPE`
is for — but it had no path out.

### Why lexical, and not a document model

This is the one place where the reasoning is borrowed rather than ours. A sibling project at
this company reads `.docx` through a document model and has paid for it twice:

1. a naive table-cell read **omits nested tables** — a questionnaire whose answers sat in a
   nested table read as blank, so the customer looked like they had left it empty;
2. the helper written to fix (1) **still misses text boxes** (`w:txbxContent`), where a
   Vietnamese contract routinely puts its fee. That defect is open in their tree today.

Both exist because a structural walk visits the shapes it knows about, and a document format
always has one more shape. A lexical pass cannot have either bug, because it never asks what
kind of container it is inside. Their own meta-rule from the first incident says the rest:
_a doc rule alone is insufficient; build the helper so the correct thing is default-safe._

The same source supplies the rule against flattening: collapsing all whitespace at extraction
time destroys table semantics irrecoverably, and forced them into a "first number within 140
characters of the label" heuristic that caused most of their extraction errors. `normalizeText`
is used here for the `readPdf` threshold check only, never on stored text.

### Why the Vietnamese pack is not optional

Of the 409 documents read on production, **69 (17%) carry Vietnamese diacritics**. Tesseract
without the pack does not fail on them — it returns confident English-looking words that were
never on the page, which reaches a search index looking exactly like data. That is `CLAUDE.md`
rule 2 broken by a missing apt package: a wrong value is invisibly false where an empty cell is
visibly missing.

It is also why the pack is pinned rather than assumed. `which tesseract` answers _installed_
and cannot answer _can read Vietnamese_; the sibling project has two machines that both had
tesseract and produced different OCR on the same files for exactly this reason.

### Why a size gate, and why it refuses by name

Of 1,557 images, **815 are under 20 KB** and only about 97 exceed 100 KB. A 20 KB PNG in an
email is a logo or a signature block. OCR-ing them would spend CPU to produce fragments that
make full-text search worse, not better. The boundary sits in the empty middle of a bimodal
distribution, which is what makes 20 KB unfussy rather than tuned.

Refusing **by name** rather than skipping is the point: an operator reading the ledger sees a
decision that was taken. ADR 0028 made the same argument for keeping `application/msword` in
the reader table as a refusal — _"an absent entry means nobody has thought about this type
yet"_.

### Why a scan is rasterised, and the numbers behind it

Tesseract's input is an image; leptonica has no PDF support, so `tesseract scan.pdf` answers
_"Pdf reading is not supported"_ and exits 1. Wiring `readPdf`'s below-threshold branch
straight into it would have recorded `tesseract-failed` on all 53 scans — a reason that tells
an operator the PDF is broken when the truth is that nobody rasterised it. A false name in the
ledger is worse than a refusal that says what is missing.

So a scan is `pdftoppm` and then `tesseract`, costing no new package because poppler was
already here for `pdftotext`.

**150 DPI, and the argument for 300 was ours and was wrong.** A Vietnamese diacritic is only a
few pixels at 150, and `má` read as `ma` is a different word — so we expected to need more.
Rendering an invented Vietnamese invoice at 10 pt and OCR-ing it with the reader's exact
command:

| DPI     | PNG    | OCR   | match      | accents kept |
| ------- | ------ | ----- | ---------- | ------------ |
| **150** | 92 KB  | 0.3 s | **100.0%** | 38/38        |
| 200     | 132 KB | 0.4 s | 99.8%      | 38/38        |
| 300     | 165 KB | 0.5 s | 99.5%      | 38/38        |
| 400     | 235 KB | 0.7 s | 99.0%      | 38/38        |

Higher is measurably worse for up to 2.6× the bytes. It is passed explicitly although it is
poppler's default, so poppler changing that default cannot quietly change what we read. What
this does **not** settle: the 53 real documents are noisy scans, not clean renders, and we have
no ground truth for them. What the number buys is that resolution is not the first thing to
suspect.

**The deadline is divided, not repeated.** `runProgram` applies its timeout per child, so a
30-page scan would have run for two and a half hours while every other reader obeyed five
minutes. `ocrScan` turns the budget into a wall-clock deadline once and gives each child what
is left of it.

**A cut is always said, and a hole is never left.** A scan stopped at the page cap or by the
clock returns `truncated`; a page that _fails_ fails the document. A tail can be said and a
hole cannot — the same rule `docx.ts` follows when it refuses an uninflatable part, and the one
ADR 0028 set for a workbook.

### Why a refusal must be retryable, and why the scope is a safety property

Without this the readers would have shipped reaching nothing: the backlog keys on
`source_sha256` changing, so the 1,190 already-refused documents — whose bytes have not moved —
would never be offered again.

The predicate is scoped to `t.method IS NULL`, and that scope is not an optimisation. The
sibling project's worst recorded extraction bug is exactly this hazard: a re-parse run without
OCR enabled **overwrote 2,602 already-OCR'd documents with empty text**, and every gate passed
because the row count was unchanged. Their law: _never swap text for empty; when a cheap re-run
can overwrite an expensive one, block it in code, not in the operator's memory._

`method IS NULL` states that property directly. The alternative spelling, `reason IS NOT NULL`,
selects the same rows today — the `document_text_said_why` CHECK makes one null exactly when
the other is not — but it is a proxy: a future reader that recorded text _and_ a caveat would
be re-queued by it, and could then be blanked by a worse run. The same bug through a different
door.

## Cost

**The reader version is bumped by hand.** The sibling project automates the equivalent by
hashing the toolchain — `tool → {binary, version, langs}` — into the cache key, precisely
because installing a language pack would otherwise never re-read a file that had "succeeded".
Ours is the cheaper form of the same idea and it has the same failure: change a reader, forget
the constant, and nothing is re-offered. The constant sits beside the `READERS` map so the two
are read together, and that is the whole of the mitigation.

**Raising the page cap will not re-read what it already cut.** A truncated row has a `method`,
and the retry mechanism re-queues only rows with no method. Those must be re-queued by hand.
That asymmetry is the price of the rule above, and it is stated here so it is discovered on
purpose rather than by someone wondering why their raised cap changed nothing.

**We still have no accuracy measurement for any reader, including `pdf_text`.** The sibling
project measured theirs before opening a human review queue and found coverage passing,
invariants passing, and **61% correct with 11% fabricated**. Everything this ADR adds is
measured for _coverage_ — which types get read — and not at all for _correctness_. That is the
honest next question, and it is deliberately not answered here.

## Options rejected

- **`soffice` / LibreOffice for `.doc` and `.xls`.** ADR 0028 refused it as "a container's
  worth of dependency for two files" and nothing here changes that; both stay refused by name.
- **`ocrmypdf` and the sibling's fallback chain** (`--skip-text --deskew --rotate-pages`, then
  a rasterising retry). A second OCR binary and another failure branch, for the 53 documents
  `pdftoppm` + `tesseract` already reach.
- **`ffmpeg` preprocessing, bank-specific crops, `--psm` whitelists.** Tuned to particular
  Vietnamese bank receipt layouts, including a colour crop that exists because grayscale OCR
  keeps the digits and erases the currency code. Not our documents, not yet our problem.
- **`-gray` on the rasteriser.** Measured: identical bytes and identical text at every DPI, so
  it buys nothing here — and the incident above is a reason not to take a flag that does not.
- **OCR-ing every image.** 815 logos and signature blocks, for fragments that make search
  worse.
- **A toolchain digest instead of a version constant.** The right answer eventually; more
  machinery than this change earns, and named above as the cost of not having it.
