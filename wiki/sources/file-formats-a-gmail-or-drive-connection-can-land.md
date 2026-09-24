---
title: File formats a Gmail or Drive connection can land
type: source
date: 2026-09-24
tags: []
source: docs/reference/file-formats.md
source_path: docs/reference/file-formats.md
source_hash: a6f799e44379345250e5402a63f21fbccde4d76c025f99589773f5105cfdbf4e
ingested: 2026-09-24
---

# File formats a Gmail or Drive connection can land

The reference page for every file type the connection picker offers, kept in step with `packages/contracts/src/fileFormats.ts` by `fileFormatsDoc.test.ts`. The decision behind it is [[ADR 0048: A file is recognised by its type first, and a signed record is verified before it is read]].

**Reading levels.** `text` (words in reading order), `table` (each sheet's rows, cells separated), `ocr` (tesseract, Vietnamese and English), `metadata` (lands and is catalogued, refused by name, not read). Bytes always stay whole in the raw lake.

**Matching.** MIME type first. The name counts only for `application/octet-stream`, and then only for an extension chosen as such, like `.oa`. Choosing `application/octet-stream` itself, which the Drive browse offers when such files are present, takes every file of that type. An extension is one to eight letters or digits after the last dot, at least one of them a letter, so `for Mr. Smith`, `Rev.1` and `Pte. Ltd.` have none. A Drive listing asks by MIME type; choosing an extension adds octet-stream and lets the name decide. The free-text field takes a MIME type or `.ext`.

**Not offered.** ZIP, RAR, HEIC and TIFF: no reader. With "every file type" they still land and are refused as `unsupported-content-type`.

**Formats.**

* Documents: PDF (text layer, else OCR; refusals `extractor-missing:pdftotext`, `pdftotext-failed`, `pdf-password-protected` (locked with an open password: bytes intact, needs an unlocked copy from the sender), `extractor-missing:pdftoppm`, `pdftoppm-failed`, and the OCR refusals), `.docx` (body, headers, footers, notes, nested tables, text boxes), `.doc` (refused `legacy-doc-unsupported`).
* Google-native: Google Docs exported to `.docx`, Google Sheets to `.xlsx` (every sheet), Google Slides to plain text.
* Spreadsheets: `.xlsx`, `.xlsm` (macros never run; Drive's capital-E spelling matches), `.xls` (refused `legacy-xls-unsupported`).
* Text: CSV (stored as text, not split into rows), plain text, Markdown.
* Web and mail: HTML (visible text; scripts and styles dropped; declared charset), MHTML (its HTML parts; resources skipped), `.eml` (headers, then text parts; one alternative only; RFC 2047 headers decoded), XML including XBRL (stored with tags, because element names carry the meaning).
* Structured: JSON (stored as text unless it claims the OpenAttestation schema).
* Signed records: `.oa` (OpenAttestation v2). Three checks, by the official library: integrity (`openattestation-tampered`), signature by the named `did:ethr` key (`openattestation-signature-invalid`), and DNS-DID identity (`openattestation-identity-invalid`). An incomplete check gives `openattestation-could-not-verify`. Refused before any check: an unsupported version, a malformed document, or an issuer that is not a `did:ethr` key proven by DNS-DID. The DID resolves offline, the DNS lookup goes over DNS-over-HTTPS, and the renderer URL is never fetched. Verified output is JSON: the verification results, then either `acraBusinessProfile` (ACRA issuer and template `BP-COMPANY-2022-1`; ISO dates, amounts as signed strings, officers with their own positions, SSIC codes split out) or the unwrapped `data`.
* Images: JPEG, PNG and WebP by OCR. An image under 20 KB is refused `image-too-small-to-read`; the other refusals are a missing tesseract, a failed run, nothing found, and out of time.
