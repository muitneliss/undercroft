-- Send every text that holds a reader's own remarks back to be read again, once.
--
-- Until this release the worker's spawn joined a child's stdout and stderr into one string, and
-- the extractors stored that string as the document's text. So `tesseract`'s "Estimating
-- resolution as 190" -- printed for almost every image -- ended every image's text, and was the
-- WHOLE text of an image with no words on it, which should have been `ocr-found-nothing`. And
-- `pdftotext`'s "Syntax Error" lines pushed a scan's empty text layer past the routing threshold,
-- so the scan was stored as `pdf_text` and never OCR'd. The readers now keep stdout alone
-- (`SpawnResult` in `apps/worker/src/services/transform.ts`); this repairs what they already
-- wrote.
--
-- DELETE, NOT A GENERATION BUMP. `CURRENT_READER_VERSION` re-queues REFUSALS only: the backlog
-- in `apps/worker/src/repos/documentText.ts` never offers a row that was read, whatever its
-- generation, because a cheap re-run overwriting good text is the worst extraction bug on
-- record. These rows WERE read, so a bump cannot reach them, and widening that predicate for
-- one repair would widen it for good. Deleting the row instead makes the document "never read",
-- which the backlog already offers; `raw.document_text` is a projection, and the bytes it is
-- read from are in the lake untouched (`CLAUDE.md` rule 1). A number in a file on purpose: it
-- must happen exactly once, at the deploy that brings the fixed readers -- the reason
-- `320_xero_reread.sql` gives.
--
-- WHAT MATCHES is the remarks themselves, found by surveying 4,000 production texts for lines
-- that recur across unrelated documents: tesseract's and leptonica's (`Estimating resolution`,
-- `Empty page!!`, `Detected N diacritics`, `Image too small to scale!!`, `Error in pix…` /
-- `Error in box…`) and poppler's (`Syntax Error`, `Syntax Warning`). Only the three methods a
-- child process produces -- a `docx` that says "Syntax Error" was read in process and is left
-- alone. A document that merely quotes one of these phrases is read again and comes back the
-- same, so a false match costs one read and never a text.
--
-- WHAT IT COSTS, measured on production before this was written: the scan took 27 seconds and
-- matched 9,130 rows over about 4,000 distinct texts. `extract_due` reads 500 texts a tick,
-- hourly, so the backlog drains over roughly eight hours, and until then those documents have
-- no text: absent from search and from any model, rather than present and wrong.

DELETE FROM raw.document_text
 WHERE method IN ('image_ocr', 'pdf_ocr', 'pdf_text')
   AND (text LIKE '%Estimating resolution as %'
     OR text LIKE '%Empty page!!%'
     OR text LIKE '%Detected % diacritics%'
     OR text LIKE '%Image too small to scale!!%'
     OR text LIKE '%Error in pix%'
     OR text LIKE '%Error in box%'
     OR text LIKE '%Syntax Error%'
     OR text LIKE '%Syntax Warning%');
