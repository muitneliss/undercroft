---
title: File formats a Gmail or Drive connection can land
type: source
date: 2026-09-29
tags: []
source: docs/reference/file-formats.md
source_path: docs/reference/file-formats.md
source_hash: 1f4e9dc0ae483b995f3d0460dca86740606e800b3ef7dee00709cf9d01c649d6
ingested: 2026-09-29
---

# File formats a Gmail or Drive connection can land

The reference page for every file type the connection picker offers, kept in step with `packages/contracts/src/fileFormats.ts` by `fileFormatsDoc.test.ts`. The decision behind it is [[ADR 0048: A file is recognised by its type first, and a signed record is verified before it is read]].

**Reading levels.** `text` (words in reading order), `table` (each sheet's rows, cells separated), `ocr` (tesseract, Vietnamese and English), `metadata` (lands and is catalogued, refused by name, not read). Bytes always stay whole in the raw lake.

**Matching.** MIME type first. The name counts only for `application/octet-stream`, and then only for an extension chosen as such, like `.oa`. Choosing `application/octet-stream` itself, which the Drive browse offers when such files are present, takes every file of that type. An extension is one to eight letters or digits after the last dot, at least one of them a letter, so `for Mr. Smith`, `Rev.1` and `Pte. Ltd.` have none. A Drive listing asks by MIME type; choosing an extension adds octet-stream and lets the name decide. The free-text field takes a MIME type or `.ext`.

**Not offered.** ZIP, RAR, HEIC and TIFF: no reader. With "every file type" they still land and are refused as `unsupported-content-type`.

**Formats.**

* Documents: PDF (text layer, else OCR; refusals `extractor-missing:pdftotext`, `pdftotext-failed`, `pdf-password-protected` (locked with an open password: bytes intact, needs an unlocked copy from the sender), `extractor-missing:pdftoppm`, `pdftoppm-failed`, and the OCR refusals), `.docx` (body, headers, footers, notes, nested tables, text boxes), `.doc` (read in process from Word 97 on, every story including text boxes and notes, recorded `doc`; refusals `legacy-doc-unsupported` for Word 95 or earlier, `doc-password-protected`, `doc-unreadable`; see [[ADR 0053: A legacy Word document is read in process, and only Word 95 stays refused]]).
* Google-native: Google Docs exported to `.docx`, Google Sheets to `.xlsx` (every sheet), Google Slides to plain text.
* Spreadsheets: `.xlsx`, `.xlsm` (macros never run; Drive's capital-E spelling matches), `.xls` (refused `legacy-xls-unsupported`: it shares `.doc`'s container, but its BIFF cells have no reader).
* Text: CSV (stored as text, not split into rows), plain text, Markdown.
* Web and mail: HTML (visible text; scripts and styles dropped; declared charset), MHTML (its HTML parts; resources skipped), `.eml` (headers, then text parts; one alternative only; RFC 2047 headers decoded), XML including XBRL (stored with tags, because element names carry the meaning).
* Structured: JSON (stored as text unless it claims the OpenAttestation schema).
* Signed records: `.oa` (OpenAttestation v2). Three checks, by the official library: integrity (`openattestation-tampered`), signature by the named `did:ethr` key (`openattestation-signature-invalid`), and DNS-DID identity (`openattestation-identity-invalid`). An incomplete check gives `openattestation-could-not-verify`. Refused before any check: an unsupported version, a malformed document, or an issuer that is not a `did:ethr` key proven by DNS-DID. The DID resolves offline, the DNS lookup goes over DNS-over-HTTPS, and the renderer URL is never fetched. Verified output is JSON: the verification results, then either `acraBusinessProfile` (ACRA issuer and a template listed in `acraTemplates.ts`: `BP-COMPANY-2022-1`, dates `DD/MM/YYYY`, or `BP-COMPANY-2024-1`, dates `DD Mon YYYY`; ISO dates, `null` for any other form, amounts as signed strings, officers with their own positions, SSIC codes split out) or the unwrapped `data`. A 2024 profile has every 2022 key in the same place (`addressSource` and `document.productCode` are `null`; `productId` keeps its own name), then its own: `entryDate`, `addressChangedDate` and `isNominee` (`null` when unstated) on officers and shareholders, and registration date, former names, change-of-name date, `annualFilings`, audit firms, charges, signature name and QR code. Texts read before a template was listed are laid out again from their verified data, with no re-read and no DNS, in each tenant's next extract run; see [[ADR 0081: ACRA templates are a configured table, and a reading is laid out again from itself]].
* Images: JPEG, PNG and WebP by OCR. An image under 20 KB is refused `image-too-small-to-read`; the other refusals are a missing tesseract, a failed run, nothing found, and out of time.

**When the choice changes.** A Gmail mark lists each attachment part it left behind (document id, bare MIME type, extension, declared size; never a filename). A held message is read again only when the current choice allows one of those parts and it is under the ceiling, and then only those parts land. Adding a type, or an upgrade that admits a new spelling such as `image/jpg`, lands those attachments on held mail by the end of the first run that finishes; removing a type deletes and reads nothing; an over-ceiling attachment never causes a re-read; a message marked before the list existed is read once more; each mailbox is its own source. The Journal and `runs get` (`reread` on the `messages` entity) say how many were read again. See [[ADR 0076 A Harvest Records What It Left Behind]].

**A message's body.** Since [[ADR 0080 A Gmail Harvest Lands Each Messages Body]] every Gmail message's body lands whatever the file-type choice, as its own document `<message id>:body`: the `text/plain` part, else the `text/html` one, stored as UTF-8. Its text reaches `raw.document_text` like any document's. On a mailbox that ran before that release, the first run after it reads every held message again once, for its body alone; attachments already landed are not fetched again.
