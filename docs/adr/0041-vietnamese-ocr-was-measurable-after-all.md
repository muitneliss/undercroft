# 41. Vietnamese OCR was measurable after all, and the fixture was what could not measure it

- Status: Accepted
- Date: 2026-09-23
- Amends: [ADR 0040](0040-the-catalogue-does-not-inherit-the-lakes-deduplication.md), which
  recorded Vietnamese OCR fidelity as unmeasurable. That was true of the synthetic fixture and
  is not true of the quantity.

## Decision

A hand-labelled sample was taken over **real** documents, and the numbers are recorded here
because nothing in the repository can reproduce them: the measurement needed a reader, and the
documents are a customer's.

**41 of 44 anchors, 93.2%, over three documents**, each labelled from the document **before**
its stored extraction was fetched.

| document                                      | method      | anchors |
| --------------------------------------------- | ----------- | ------: |
| marketing flyer, English, dense prose         | `image_ocr` |   13/14 |
| government letter, Vietnamese, accented prose | `pdf_ocr`   |   13/14 |
| commercial invoice, numeric and tabular       | `pdf_ocr`   |   15/16 |

**Every number-critical anchor was exact: identifiers, amounts, bank details and dates, 12/12.**
On an accounting platform that is the class that matters — a wrong account number is worse than
a missing paragraph.

**The Vietnamese letter scored 13/14 with diacritics required**, at 32.4 combining marks per 100
letters, which is the ordinary range for Vietnamese prose. `tesseract-ocr-vie` is not merely
installed; it reads.

Two consequences follow, and the second is the one that saves work:

- ADR 0040's `UNMEASURED` entry is narrowed in `accuracy.ts` from _"OCR fidelity on Vietnamese,
  at any quality"_ to the fixture. The old wording claimed more than the evidence did.
- **`ocrmypdf` is not built.** It was proposed as a fallback _if quality proved insufficient_.
  Quality is sufficient. This is the measurement doing the job Luật 1 asks of it — stopping
  work, not starting it.

## Why the fixture could not measure what the corpus can

ADR 0040's reasoning was right and its conclusion was too wide. A gold page can only be
rendered in the fonts poppler substitutes, and none of them holds a Vietnamese glyph: measured,
`pdftotext` reads `Hợp đồng` from the gold PDF exactly while the same file rasterised loses
every accent. A score from that measures the fixture's font.

But a **real** Vietnamese scan was rendered by whatever produced it, so its diacritics are real
and survive to the page image. The quantity was always measurable; only the synthetic route to
it was blocked. Writing "unmeasurable" rather than "unmeasurable _this way_" is the error, and
it is the kind that stops the next person looking.

## What was investigated and deliberately not changed

**`terse-for-size` is mostly a correct description of the corpus, not a defect class.** Seven
distinct images were opened: three photographs of venues with little or no text, one
high-resolution circular logo whose text follows a curve, one banner **read correctly** at 66
characters and flagged only because 66 < 80, one company seal where OCR took the single clean
printed line and left the curved seal text and the handwriting, and one marketing banner that is
a genuine miss.

Both obvious levers were tested against that miss and **both failed**:

- `--psm` 3 / 11 / 6 / 12 returned 14 / 20 / 9 / 30 characters — the best still far below what is
  legible.
- Upscaling 2× returned 30 → 29 on the banner. On the seal it returned 32 → 65, which **looks
  like a doubling and is not**: the output is 16 tokens, only one carrying a Vietnamese mark,
  longest token six characters, against a document full of accented three-to-eight letter words.
  Fragments, not recovered text.

Reporting that 65 as a win would have been the sibling project's 11%-fabricated failure, arrived
at honestly. It is recorded here because the next person to reach for upscaling should reach
past it.

**The OCR gate still keys on bytes, and that was left alone on purpose.** Opening the images
showed a 1600×1600 logo at 1.4 MB clearing a 20 KB gate, which looks like an argument for a
pixel-dimension gate. It is not one: that logo is large in pixels too, so a pixel gate would
admit it identically. Aspect ratio would separate a banner strip from a page, but the one banner
measured was read _correctly_, so there is no defect for it to fix. **The measurement did not
show the byte gate causing harm, so the byte gate does not change** — Luật 1 says fix what the
measurement showed, and this is the discipline pointed at a change I had already proposed.

## Cost

**Three documents and forty-four anchors is a reading, not a rate.** It is enough to answer "is
the Vietnamese pack working" and "are amounts landing intact", and it is not enough to publish
a fidelity percentage for the corpus. The sample is seeded (`seed20260923`, ordered by
`md5(sha256)`) so it is reproducible and a held-out sample can exclude it — which Luật 2
requires, because this one is now burnt.

**The labeller was an LLM reading the same corpus, not an independent human.** That buys
blind-before-seen labelling and consistent anchors, and it does not buy independence: a
systematic misreading of a Vietnamese glyph could be shared between the labeller and the thing
being measured. A human-labelled sample would be strictly better evidence and is still not
taken.

**Anchor recall is not character fidelity.** It asks whether distinctive content survived, not
whether every character did. Invention was checked only as the plausibility of number-like
strings, not enumerated against the source — so the 11%-fabrication figure that mattered most in
the sibling project has **no counterpart here**, and saying so is part of the measurement.

## Options rejected

- **Publishing 93.2% as the extractor's accuracy.** Three documents. The figure is a reading.
- **Building `ocrmypdf` anyway**, because it was on the plan. The condition it was proposed under
  was not met.
- **Moving the OCR gate to pixel dimensions.** Argued above: no measured defect, and the change
  would not have excluded the image that prompted it.
- **Editing ADR 0040.** It is Accepted and immutable; a reversal gets a new ADR, and this is one.
