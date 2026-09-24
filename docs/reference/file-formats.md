# File formats a Gmail or Drive connection can land

This page lists every file type the connection picker offers. For each one it gives the
public specification, how the file is recognised, and how much of it the worker reads into
`raw.document_text`. `packages/contracts/src/fileFormatsDoc.test.ts` fails the gate when the picker offers a
format that has no section here, or when a section's specification link or reading level
disagrees with the catalogue in `packages/contracts/src/fileFormats.ts`.

Every file that lands keeps its bytes whole in the raw lake, whatever the reading level says.
The reading level describes only what becomes searchable text.

| Reading level | Meaning                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------- |
| `text`        | The words are extracted in reading order.                                                     |
| `table`       | Each sheet's rows are extracted, cells separated, so a model can split them again.            |
| `ocr`         | The file is a picture; `tesseract` reads it in Vietnamese and English.                        |
| `metadata`    | The file lands and is catalogued, but nothing reads its content. A named refusal is recorded. |

## How a file is matched to a chosen type

1. **The MIME type is asked first.** A file that Drive or Gmail labels `application/pdf` is a
   PDF, whatever its name says. An extension never overrides a MIME type and never widens one.
2. **The name is consulted only when the MIME type is `application/octet-stream`**, the type a
   provider uses when it does not know. Then only an extension that was chosen as such counts,
   for example `.oa`. Choosing `application/octet-stream` itself, which the Drive browse offers
   when such files are present, takes every file of that type, whatever its name.
3. **An extension is one to eight letters or digits after the last dot, with at least one
   letter.** Anything else is a name that happens to contain a dot. `Services Agreement for
Mr. Smith`, `Tax Queries Rev.1`, `Acme Pte. Ltd.` and `CONTRACT 01.01/2024 QT-FXpdf` all have
   no extension.

A Drive listing asks Google only by MIME type, because Drive's query language cannot filter by
extension reliably. When an extension is chosen, the listing also asks for
`application/octet-stream`, and the name then decides which of those files lands. An
octet-stream file whose name does not match is not landed.

The picker's free-text field accepts either a MIME type (`image/png`) or an extension (`.oa`).

## What is not offered

ZIP and RAR archives, HEIC and TIFF images are not offered. The worker has no reader for them,
and offering a type that lands but cannot be read would promise something it does not do. A
file of any type still lands when the admin chooses "every file type". If the worker has no
reader for it, it is recorded with the refusal `unsupported-content-type`, and the document's
`content_type` names the type.

## The formats

### PDF

- Choice: `application/pdf`
- Extensions: `.pdf`
- Specification: <https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf>
- Reads: `text`

`pdftotext` reads the text layer. When the whole layer carries fewer than 80 visible
characters, the PDF is treated as a scan. Its pages are then rasterised and read by OCR, recorded as `pdf_ocr`.
The refusals are `extractor-missing:pdftotext`, `pdftotext-failed`,
`extractor-missing:pdftoppm`, `pdftoppm-failed` and the OCR refusals under [JPEG](#jpeg-image).

### Word document (.docx)

- Choice: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Extensions: `.docx`
- Specification: <https://ecma-international.org/publications-and-standards/standards/ecma-376/>
- Reads: `text`

The reader covers the body, headers, footers, footnotes and endnotes, including nested tables
and text boxes. A package it cannot open is refused as `docx-unreadable`.

### Word document (.doc)

- Choice: `application/msword`
- Extensions: `.doc`
- Specification: <https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/>
- Reads: `metadata`

This is the binary format from before 2007. Reading it would need LibreOffice in the worker
image, so it is refused as `legacy-doc-unsupported`.

### Google Docs

- Choice: `application/vnd.google-apps.document`
- Extensions: none. A Google Doc has no file of its own.
- Specification: <https://developers.google.com/workspace/drive/api/guides/ref-export-formats>
- Reads: `text`

A Google Doc has no bytes to download. Drive exports it as a `.docx`, which lands under that
type and is read as a Word document. The record keeps Drive's own type in `metadata.mimeType`.
Google caps an export at 10 MB.

### Excel spreadsheet (.xlsx)

- Choice: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- Extensions: `.xlsx`
- Specification: <https://ecma-international.org/publications-and-standards/standards/ecma-376/>
- Reads: `table`

Every sheet is read row by row, with shared strings resolved. A workbook the reader cannot open
is refused as `xlsx-unreadable`.

### Macro-enabled Excel workbook (.xlsm)

- Choice: `application/vnd.ms-excel.sheet.macroenabled.12`
- Extensions: `.xlsm`
- Specification: <https://ecma-international.org/publications-and-standards/standards/ecma-376/>
- Reads: `table`

It is the same package as an `.xlsx` with one extra part. The sheets are read exactly as an
`.xlsx`'s are, and the macros are never run. Drive spells the type with a capital `E`, and both
spellings match.

### Excel spreadsheet (.xls)

- Choice: `application/vnd.ms-excel`
- Extensions: `.xls`
- Specification: <https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-xls/>
- Reads: `metadata`

This is the binary workbook format from before 2007. It is refused as `legacy-xls-unsupported`,
for the reason given for `.doc`.

### Google Sheets

- Choice: `application/vnd.google-apps.spreadsheet`
- Extensions: none.
- Specification: <https://developers.google.com/workspace/drive/api/guides/ref-export-formats>
- Reads: `table`

Drive exports a Google Sheet as an `.xlsx`, so every sheet arrives, not only the first as a
CSV export would give. It is then read as a workbook.

### Google Slides

- Choice: `application/vnd.google-apps.presentation`
- Extensions: none.
- Specification: <https://developers.google.com/workspace/drive/api/guides/ref-export-formats>
- Reads: `text`

Drive exports a Google Slides deck as plain text, and that text is stored.

### CSV file

- Choice: `text/csv`
- Extensions: `.csv`
- Specification: <https://www.rfc-editor.org/rfc/rfc4180>
- Reads: `text`

The file is stored as the text it is. It is not split into rows, because doing that would mean
guessing a delimiter, a quoting style and an encoding that the file does not state.

### Plain text

- Choice: `text/plain`
- Extensions: `.txt`
- Specification: <https://www.rfc-editor.org/rfc/rfc2046>
- Reads: `text`

The file is decoded as UTF-8. A byte that is not valid UTF-8 becomes a visible replacement
character rather than ending the read.

### Markdown (.md)

- Choice: `text/markdown`
- Extensions: `.md`
- Specification: <https://spec.commonmark.org/>
- Reads: `text`

The file is stored as the text it is, markup included. `text/x-markdown` is read the same way.

### Web page (.html)

- Choice: `text/html`
- Extensions: `.html`, `.htm`
- Specification: <https://html.spec.whatwg.org/multipage/>
- Reads: `text`

The reader keeps the text a reader sees on the page, one block per line, with table cells
separated by `|`. It drops `<script>`, `<style>`, `<template>` and `<noscript>`. The page is
decoded in the charset its `<meta>` declares, or UTF-8 if it declares none. Numeric character
references and the common named ones are decoded. Any other named reference is left as written,
which is visibly odd but never silently deleted.

### Saved web page archive (.mhtml)

- Choice: `multipart/related`
- Extensions: `.mhtml`, `.mht`
- Specification: <https://www.rfc-editor.org/rfc/rfc2557>
- Reads: `text`

A browser's "save page as a single file". The archive's HTML parts are decoded from
quoted-printable or base64 and read as web pages. Images, fonts and stylesheets in the archive
are skipped.

### Email saved as a file (.eml)

- Choice: `message/rfc822`
- Extensions: `.eml`
- Specification: <https://www.rfc-editor.org/rfc/rfc5322>
- Reads: `text`

The reader outputs the message's Subject, From, To, Cc and Date, then every text part, and it
decodes non-ASCII headers (RFC 2047). When a message offers plain text and HTML as
alternatives, only the plain text is read, so no sentence is indexed twice. A forwarded message
is read in place. Attachments inside the saved email are not read.

### XML, including XBRL filings (.xml)

- Choice: `application/xml`
- Extensions: `.xml`, `.xbrl`
- Specification: <https://www.w3.org/TR/xml/>
- Reads: `text`

The file is stored as the text it is, tags included. In an XBRL financial statement the element
names are the meaning: `ifrs-full:Revenue` is what makes the number beside it revenue.
`text/xml` is read the same way.

### JSON

- Choice: `application/json`
- Extensions: `.json`
- Specification: <https://www.json.org/json-en.html>
- Reads: `text`

The file is stored as the text it is. The one exception is a document whose `version` names the
OpenAttestation schema. That document is verified first and read as described under
[OpenAttestation](#signed-openattestation-record-oa), whatever its file is called.

### Signed OpenAttestation record (.oa)

- Choice: `.oa`
- Extensions: `.oa`
- Specification: <https://schema.openattestation.com/2.0/schema.json>
- Reads: `text`

An OpenAttestation document is JSON whose every value is salted and whose Merkle root is signed
by its issuer. Singapore ACRA Business Profiles are the common case. No MIME type is registered
for it, and Drive and Gmail both send it as `application/octet-stream`. It is therefore chosen
by extension, and it lands with the content type `application/json`. The JSON reader
recognises it by its content, never by its name.

**Nothing is read from a document that does not verify.** The official library,
`@tradetrust-tt/tt-verify`, runs three checks:

| Check              | What it establishes                                           | Refusal when it fails               |
| ------------------ | ------------------------------------------------------------- | ----------------------------------- |
| Document integrity | The content still hashes to the signed Merkle root.           | `openattestation-tampered`          |
| Document status    | The root was signed by the `did:ethr` key the document names. | `openattestation-signature-invalid` |
| Issuer identity    | The issuer's DNS TXT record (DNS-DID) lists that key.         | `openattestation-identity-invalid`  |

When a check cannot complete, usually because the DNS lookup failed, the refusal is
`openattestation-could-not-verify`. That is a verdict about the run, not the document. Three
more refusals are decided before any check runs:

- `openattestation-unsupported-version` for a schema version other than 2.0.
- `openattestation-malformed` for a document claiming 2.0 without a signature or proof.
- `openattestation-unsupported-issuer` for any issuer that is not a `did:ethr` key proven by
  DNS-DID. This refusal is also why no document can send the worker to a URL its author chose.

Two lookups leave the worker, and each is narrower than the library's default:

- **The `did:ethr` key is resolved to its default document, offline.** The ERC-1056 registry
  on Ethereum is not read, so no Ethereum RPC or credential is needed. As a consequence, a key
  that its owner re-assigned on-chain is not detected. On 2026-09-24 ACRA's signing key had no
  registry change. The live DNS check below is what still binds the key to its issuer.
- **The DNS-DID record is looked up over DNS-over-HTTPS** through `@tradetrust-tt/dnsprove`:
  Google, then Cloudflare, then its other public resolvers, in order.

The renderer URL in `$template` is never fetched.

The verified text is JSON. It starts with `openAttestation.verification`: the three results and
each issuer's name, DID and DNS location. After that comes one of two things:

- **`acraBusinessProfile`**, for a document that every issuer proves at `acratrustbar.gov.sg`
  and whose template is `BP-COMPANY-2022-1`. It holds the UEN, name, company type, status,
  registered address, activities (each split into a description and an SSIC code when the name
  ends in one), capitals, officers with their own positions, shareholders, and document details
  such as the receipt number and verification URL. Dates are converted from `DD/MM/YYYY` to ISO,
  or become `null` when they are not real dates. Amounts and share counts stay the exact strings
  the issuer signed. Currencies stay in words.
- **`data`**, the unwrapped document, for any other issuer or template. The salt is removed at
  the first two colons of each value, so URLs and DIDs keep their own colons.

A verification whose DNS lookup failed is not retried until the worker's reader version is next
raised.

### JPEG image

- Choice: `image/jpeg`
- Extensions: `.jpg`, `.jpeg`
- Specification: <https://www.w3.org/Graphics/JPEG/itu-t81.pdf>
- Reads: `ocr`

`tesseract -l vie+eng` reads the image. The refusals are:

- `image-too-small-to-read` for an image under 20 KB, which is almost always a logo or a
  signature, not a document.
- `extractor-missing:tesseract` when tesseract is not installed.
- `tesseract-failed` when it ran and failed.
- `ocr-found-nothing` when it ran and found no text.
- `ocr-out-of-time` when the document's time budget ran out.

The non-standard spelling `image/jpg` is read the same way.

### PNG image

- Choice: `image/png`
- Extensions: `.png`
- Specification: <https://www.w3.org/TR/png/>
- Reads: `ocr`

It is read and refused exactly as a JPEG is.

### WebP image

- Choice: `image/webp`
- Extensions: `.webp`
- Specification: <https://developers.google.com/speed/webp/docs/riff_container>
- Reads: `ocr`

It is read as a JPEG is. Tesseract opens WebP through leptonica, which the worker image installs
with WebP support. If that support is ever missing, each WebP file is refused as
`tesseract-failed`.
