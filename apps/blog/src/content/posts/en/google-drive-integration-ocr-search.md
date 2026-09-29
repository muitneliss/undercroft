---
title: "Google Drive integration: OCR and document search"
description: "Use Google Drive integration to ingest selected folders into a raw data lake, OCR Vietnamese scans, classify documents and search their extracted text."
translationKey: "google-drive-integration"
pubDate: "2026-09-29"
tags: ["Google Drive", "Integration", "OCR", "Search"]
keywords:
  [
    "google drive integration",
    "google drive api",
    "google drive ocr",
    "document search",
    "vietnamese ocr",
    "unstructured data",
  ]
hero: "../../../assets/posts/google-drive-integration/hero.png"
heroAlt: "Google Drive integration sketch showing selected folders, a collector, raw lake, Vietnamese OCR, document kinds and search"
integration: "google-drive"
---

A Google Drive integration becomes useful when the files your team stores can answer questions. Which contract contains a renewal clause? Where is the scanned document mentioning a reference number? Undercroft ingests files from selected Drive folders into an immutable raw data lake, extracts text from supported formats, and makes that text searchable alongside other source records. Scanned PDFs and images can go through Vietnamese and English OCR.

The workflow also supports document kinds, such as invoice, contract and other, through an optional classification stage. Ingestion, extraction and classification are separate operations: a file can be safely captured before it becomes readable or receives a kind. That distinction helps engineers and finance or operations teams understand what is available, what is still processing, and what the platform could not read.

## How does the Google Drive integration work?

The path starts with an administrator's saved selection: folders or individual files, allowed file types, and whether to include subfolders. Undercroft's first-party collector reads that selection through the Google Drive API and lands document bytes through the platform's shared lake writer.

Drive is implemented as a collector in the worker, rather than a YAML connector. The generic connector format handles JSON records; downloading PDFs and exporting Google documents require a byte-preserving path. Both approaches feed the same platform, but a PDF does not become a JSON record by passing through a text decoder.

The raw lake preserves captured bytes. Postgres holds the document catalogue and, after extraction, the text in `raw.document_text`. These database tables are rebuildable projections of the durable lake. Filenames and folder names remain in the access-controlled lake manifest; the document catalogue holds opaque identifiers, types and counts.

For the storage rationale, see the [immutable raw data lake guide](/en/immutable-raw-data-lake/). The broader [data integration and REST API connector guide](/en/data-integration-rest-api-yaml-connectors/) explains how document sources fit beside structured API sources.

## How do you connect chosen folders through the Google Drive API?

Deployment setup and a tenant's selection are separate steps. The operator configures Google's ingestion OAuth client; a tenant admin then connects an account and records what to sync. The [Google ingestion runbook](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md) contains the exact environment variables and callback configuration.

1. Configure an ingestion OAuth client separately from the Google sign-in client. Enable the required APIs and register the deployment's callback and browser origins.
2. Configure the ingestion credentials and Drive Picker settings. The client secret stays out of the browser; the worker seals the connection credential and refreshes access afterwards.
3. Connect the Drive account as a tenant admin. Choose the folders or files, allowed formats, and whether the selection includes subfolders.
4. Start **Run now**, then inspect the Journal's counts and refusals before relying on the captured collection.

The ingestion grant uses `drive.readonly`. That permission is broader than the selected folders: the collector enforces the saved selection in its queries. The browser Picker's `drive.file` scope is separate and does not supply ingestion access to a folder's existing contents.

Folder depth is explicit. A nonrecursive selection reads the folder's immediate files; a recursive selection walks beneath it. Multiple Drive accounts can be connected to one tenant, each with its own selection, schedule and run history. Folder selection therefore deserves the same review as any other data integration scope.

## Which Drive files become searchable text?

Landing a file and reading its contents are different capabilities. Every landed file keeps its bytes whole, while the reading level determines what becomes searchable. The [file-format reference](https://github.com/muitneliss/undercroft/blob/main/docs/reference/file-formats.md) records the exact types and refusal reasons.

| File or format                            | What the worker reads                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| PDF                                       | Text layer first; OCR when the whole layer has fewer than 80 visible characters |
| JPEG, PNG, WebP                           | Vietnamese and English OCR, subject to reading limits                           |
| DOCX and supported legacy DOC             | Document text, including supported tables and additional text areas             |
| Google Docs                               | Exported DOCX, then the Word reader                                             |
| XLSX and XLSM                             | Rows from every sheet; macros are never executed                                |
| Google Sheets                             | Exported XLSX, then the workbook reader                                         |
| Google Slides                             | Exported plain text                                                             |
| TXT, CSV, Markdown, XML and ordinary JSON | Text content; CSV is not automatically parsed into business rows                |
| Legacy XLS                                | Bytes and catalogue entry, with a named unsupported-reader refusal              |

HTML, saved web archives and saved email files also have readers. Attachments inside an `.eml` file are not extracted by that reader. ZIP, RAR, HEIC and TIFF are not offered as supported choices; selecting every file type can still land unsupported files, which receive a reading refusal.

Matching starts with MIME type. A filename extension is consulted only when the provider reports `application/octet-stream` and the administrator selected that extension. This avoids treating a dot in a document title as reliable format information. Google-native documents require exports, so their landed representation differs from a downloaded PDF or image.

## How does Google Drive OCR handle Vietnamese scans?

In Undercroft, Google Drive OCR means downloading the selected material and running extraction in the worker. Images use Tesseract with Vietnamese and English language packs. PDFs first pass through `pdftotext`; when their entire text layer falls below the 80-character threshold, their pages are rasterised and OCR is recorded as `pdf_ocr`.

That rule is specific: it is not a promise to OCR every image embedded in a PDF that already has substantial text. The extraction result records how the text was obtained, or a reason it could not be obtained. OCR runs separately from ingestion, so an unreadable scan does not erase a successfully captured file.

![A scanned contract passes through Vietnamese and English OCR, becomes extracted text, and appears as a document search hit](../../../assets/posts/google-drive-integration/flow.png)

An image below the 20 KB gate is refused as `image-too-small-to-read`. Other outcomes include `ocr-found-nothing`, `ocr-out-of-time` and missing-extractor errors. Password-protected PDFs retain their bytes but require an unlocked copy to be read.

The repository's Vietnamese OCR investigation confirmed that accented Vietnamese content survived in a small real-document sample. It explicitly rejects presenting that sample as a general accuracy percentage. For a finance workflow, review representative scans and compare important identifiers, dates and amounts against the original; searchable text alone is not verified accounting data.

## How are documents classified as invoices or contracts?

Classification reads extracted text and chooses among a tenant's catalogue of document kinds. The current provider is TypeSafe's Jev. An admin can initialise the catalogue from a sample evaluated against the generic kind list, then add, remove or edit kinds. The fallback `other` remains available so every document is not forced into a more specific label.

Edits remain drafts until publication. Publishing a changed catalogue causes reclassification against that version; making several edits before publishing avoids repeatedly classifying against intermediate lists. The worker needs `UNDERCROFT_TYPESAFE_API_KEY`, and classification does not become due without a published catalogue. Initialisation is itself an admin-triggered provider operation, so this stage needs an explicit decision about sending document text to that provider.

Results retain the kind, confidence, probabilities and catalogue definition. The `raw.document_kinds` view exposes `accepted_kind` as NULL when confidence is below 0.90 or the answer belongs to a replaced catalogue. Short text and provider failures have named statuses. The catalogue procedures are available through the router, CLI and MCP; the decision introducing them leaves the dedicated UI to a separate change.

These labels organise unstructured data without supplying a business schema. An invoice label does not extract trustworthy invoice line items or define an accounts-payable model. Your dbt models decide how accepted classifications contribute to reports.

## Can you search the whole lake without writing SQL?

Yes. The Lake division provides an admin-only full-text search box over a tenant's raw record values and extracted document text. Document search does not depend on classification being enabled. It can find a clause in a readable Drive file while also searching records landed from other sources.

Vietnamese matching ignores diacritics, so `hop dong` can match `hợp đồng`. Excerpts preserve the source's accented text. English stemming also supports matches such as `contract` against `contracts`. This is full-text search, not a promise of semantic answers or fuzzy correction of OCR mistakes.

Search indexes the first 200,000 characters per value. Unreadable documents have no extracted content to match, and a missing hit does not prove a phrase was absent from the original. Search runs through the worker using the tenant's dbt login; the BI role still cannot read the raw schema directly.

For engineering checks, this illustrative read-only SQL uses the real extraction table to summarise methods and refusals under an authorised tenant dbt connection:

```sql
SELECT method, reason, count(*) AS documents
FROM raw.document_text
GROUP BY method, reason;
```

Review those outcomes alongside the ingestion Journal. For material arriving through email as well as shared folders, the [Gmail integration guide](/en/gmail-integration-email-to-database/) covers the other collection route. The [open-source Undercroft repository](https://github.com/muitneliss/undercroft) holds the implementation and its documented boundaries.

## FAQ

### Does Google Drive integration read my entire Drive?

The collector reads the saved file or folder selection, allowed types and chosen recursion depth. Its `drive.readonly` OAuth grant is broader, so the application enforces that selection.

### Does Google Drive OCR support Vietnamese?

Undercroft runs Tesseract with Vietnamese and English for supported images and scanned PDFs. Quality depends on the source, and the repository does not establish a universal accuracy guarantee.

### Can I search documents before configuring classification?

Yes: full-text search uses extracted document text and raw record values independently of document kinds. Classification needs its own provider configuration and an admin-published catalogue.

### Does OCR automatically create invoice tables in Postgres?

No: extraction produces text, and classification supplies a document kind with confidence. Your dbt models define the business schema and any downstream reports.
