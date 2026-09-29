---
title: "Gmail integration: from email and attachments to SQL"
description: "Build a Gmail integration that lands chosen-label emails and attachments in a raw data lake, extracts text, and makes it queryable in Postgres with SQL."
translationKey: "gmail-integration"
pubDate: "2026-09-29"
tags: ["Gmail", "Integration", "SQL", "ELT"]
keywords:
  [
    "gmail integration",
    "gmail api",
    "gmail to database",
    "email attachment extraction",
    "extract invoices from email",
  ]
hero: "../../../assets/posts/gmail-integration/hero.png"
heroAlt: "Gmail integration sketch from chosen labels through the collector, raw lake and text extraction to raw.document_text and SQL"
integration: "gmail"
---

A Gmail integration for analytics needs to preserve more than an attachment download. An invoice may arrive as a PDF, a receipt as an image, and an explanation of a disputed charge in the email itself. Undercroft reads messages from chosen Gmail labels, lands their bodies and allowed attachments in a raw data lake, and extracts text into Postgres for SQL and dbt.

That gives engineering and finance teams a path from Gmail to database without treating every email as an accounting entry. The captured documents are evidence; your models decide what that evidence means. [Undercroft is open-source](https://github.com/muitneliss/undercroft), and its collector, readers and access boundaries can be inspected in the repository.

## How does the Gmail integration move email into a database?

The path is Gmail API → first-party collector → raw lake → text extraction → `raw.document_text` → SQL. Message records also project into `raw.records`, while `raw.documents` catalogues the landed documents. Postgres holds rebuildable projections; the lake holds the captured bytes.

Gmail uses a collector implemented inside the worker rather than a YAML connector. The generic connector format reads JSON records, while this source also needs binary attachments and a union of separate label queries. Keeping those operations in the worker also keeps credential use inside the process that can open the sealed credential.

Landing and extraction are separate runs. An email can be safely captured before its PDF has been read, and an OCR failure does not turn a completed ingest into a failed sync. The [raw data lake guide](/en/immutable-raw-data-lake/) explains the durable storage boundary; the [ETL vs ELT comparison](/en/etl-vs-elt/) explains why business transformations follow ingestion.

## Which parts of an email are stored?

The collector separates each message into three paths. The record retains six headers: `From`, `To`, `Cc`, `Subject`, `Date` and `Message-ID`, alongside provider identifiers and collection facts. Neither the message body nor Gmail's `snippet` is put into that record.

![An email branches into headers stored as a record, a body stored as a document, and attachments stored as separate documents](../../../assets/posts/gmail-integration/flow.png)

The body is a document identified by `<messageId>:body`. The collector chooses the first `text/plain` part without a filename, falling back to the first `text/html` part. It honours the declared charset when landing and stores the body as UTF-8. A text part with a filename remains an attachment.

Attachment choices do not govern the body: a selected message's body is collected even when its attachment types are excluded, subject to the document size ceiling. Bodies and attachments over 25 MiB are refused. After extraction, the body's words live in `raw.document_text.text`, where a model can associate them with the original message.

This is not a whole-mailbox `.eml` export. The collector stores the message's record and documents separately, avoiding another copy of every attachment inside an archived full message.

## How do you connect the Gmail API and choose labels?

An operator first configures a dedicated Google ingestion OAuth client. It is separate from the sign-in client: logging into Undercroft does not itself authorise mailbox collection. The [Google ingestion setup runbook](https://github.com/muitneliss/undercroft/blob/main/docs/runbook/google-ingestion-setup.md) contains the deployment settings and callback configuration.

Once that setup is ready:

1. A tenant admin opens the Gmail source and chooses **Connect**.
2. The admin completes Google's consent flow for the mailbox.
3. They choose labels and the attachment types to collect, then save the selection.
4. They choose **Run now** and inspect the Journal for landed counts and refusals.

Several selected labels mean messages from any of them. The collector issues one query per label and unions message IDs, because passing all labels in one Gmail request would require messages to carry every selected label. A connection with no recorded selection fails instead of defaulting to the whole mailbox.

The OAuth permission is `gmail.readonly`; the chosen-label restriction is enforced by Undercroft's collector, not by a label-specific Google token. That distinction matters when assessing access: the grant permits mailbox reading, while the saved selection controls what the collector collects.

## Which attachments can email attachment extraction read?

Landing a file preserves its bytes. Reading it produces text or a named refusal, depending on the format and the actual file. The current [file-format reference](https://github.com/muitneliss/undercroft/blob/main/docs/reference/file-formats.md) documents the full catalogue.

| Attachment                     | What becomes available for text queries                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| PDF                            | Text layer first; OCR when the layer contains fewer than 80 visible characters      |
| JPEG, PNG, WebP                | OCR with Vietnamese and English recognition; images under 20 KB are refused         |
| DOCX and supported legacy DOC  | Document text; unreadable or protected files get named refusals                     |
| XLSX and XLSM                  | Rows from every sheet; XLSM macros are never executed                               |
| CSV, plain text, Markdown, XML | Text, retaining markup where applicable; CSV is not automatically split into rows   |
| Legacy XLS                     | Bytes and catalogue entry, with `legacy-xls-unsupported` instead of extracted cells |

HTML and saved `.eml` files also have readers. The `.eml` reader does not extract attachments nested inside that saved email. ZIP, RAR, HEIC and TIFF are not offered in the format picker; choosing every file type can still land unsupported files, which then record `unsupported-content-type`.

Matching uses MIME type first. A filename extension is consulted only when the provider reports `application/octet-stream`. Renaming a file does not override a known MIME type or make an unsupported reader appear.

## How can you query email text with SQL?

Extraction writes how a document was read in `method`, or why it could not be read in `reason`. A separate `truncated` flag identifies text cut at an extraction limit. Those fields let a model distinguish readable evidence from missing or incomplete evidence.

This illustrative query uses real columns. Run it with the tenant's dbt login, which can read that tenant's text; the BI login cannot read `raw` directly:

```sql
SELECT source, document_id, method, truncated, left(text, 240) AS excerpt
FROM raw.document_text
WHERE (source = 'gmail' OR source LIKE 'gmail.%')
  AND reason IS NULL
  AND text ILIKE '%invoice%'
LIMIT 20;
```

It finds a word, not a verified invoice. A payment reminder quoting an older invoice can match too. Before building a report, check extraction refusals and truncation, then define the document grain and fields your model needs.

The source filter deliberately includes `gmail.%`: the first connected mailbox uses `gmail`, and additional mailboxes get separate source keys. A filter for only `gmail` silently leaves them out. The shipped `gmail_letters()` dbt macro can fold copies across mailboxes by the RFC `Message-ID` and expose header conflicts, but quoted text inside replies still needs your own modeling decision.

## Can you extract invoices from email automatically?

Undercroft provides document capture and text extraction. It does not ship an invoice business schema that turns every PDF into approved line items, totals and payment status. Your dbt models define those fields and their validation; an unreadable amount must remain missing rather than become zero.

Optional document classification adds a separate signal. With the worker's TypeSafe API key configured, an admin can initialise a tenant-owned catalogue of document kinds and publish it for classification. Initialisation sends sampled text to TypeSafe's Jev; subsequent classification uses the published catalogue. This provider step is distinct from ordinary text extraction.

The `raw.document_kinds` view exposes the predicted kind and confidence. Its `accepted_kind` is NULL below 0.90 or when the result belongs to a replaced catalogue. A classification such as invoice describes the document; it does not validate its amounts or approve a transaction. For structured accounting data alongside email evidence, see the [Xero integration guide](/en/xero-integration-postgres/).

## How do privacy and repeat syncs work?

Document metadata stays narrow: opaque provider IDs, types, timestamps and counts. Filenames and human-written descriptive metadata belong in the access-controlled lake manifest, not `raw.documents`. Extracted text is an explicit exception because its purpose is to preserve the document's words. The BI role has no access to the `raw` schema; a customer-written model controls what reaches reporting.

Ordinary repeat runs skip messages already held. Adding an attachment type rereads only held messages in the selected labels whose recorded missing parts now qualify. Removing a type deletes nothing. Connections from before body collection receive a one-time reread for missing bodies, without fetching already-landed attachments again.

Extraction is scheduled from pending work, with an hourly backlog check, rather than chained to every sync. Review both ingest and extraction evidence before treating a report as complete. A successful download and a searchable document are two different outcomes.

## FAQ

### Does this Gmail integration read my entire inbox?

With chosen labels, the collector reads their union; a missing selection is refused. Google grants `gmail.readonly` access, so label selection is an application collection boundary rather than a narrower OAuth permission.

### Can I save Gmail bodies to a database without attachments?

Bodies are collected independently of the attachment-type choice. They land as documents in the lake and become text in `raw.document_text` after extraction, rather than fields in the message record.

### Can it read scanned invoices and receipts?

PDFs with insufficient embedded text fall back to OCR, and supported image attachments use Vietnamese and English OCR. Password protection, unreadable files and OCR failures produce explicit reasons rather than a promise of complete extraction.

### Does a successful sync mean every invoice is ready for SQL?

No: text extraction runs separately, and some documents may be pending or refused. Check `method`, `reason` and `truncated` before relying on extracted evidence in a model.
