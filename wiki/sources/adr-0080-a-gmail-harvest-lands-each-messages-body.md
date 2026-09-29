---
title: ADR 0080 A Gmail Harvest Lands Each Messages Body
type: source
date: 2026-09-29
tags: []
source: docs/adr/0080-a-gmail-harvest-lands-each-messages-body.md
source_path: docs/adr/0080-a-gmail-harvest-lands-each-messages-body.md
source_hash: f60437d99e24b861977a2ec7f50eafc9c8a86a755ed5aee8a279574afed3aec8
ingested: 2026-09-29
---

# ADR 0080 A Gmail Harvest Lands Each Messages Body

# ADR 0080 A Gmail harvest lands each message's body, as a document of that message

Status: Accepted, 2026-09-29. Reverses the promise a Gmail connection made since it was built ("message headers and the attachment types you allow", bodies never fetched), which lived on the consent card and in `gmail.ts` rather than in an ADR. Extends [[ADR 0024: A document's text is readable by dbt]] and [[ADR 0076 A Harvest Records What It Left Behind]].

## Context

A Gmail connection landed six headers into `raw.records` and the chosen attachments into the lake; the text of the mail was never read. Deriving meaning from mail (the semantic probe, #302) and searching it need that text. Consent to read bodies was obtained from the tenant outside the system, which the owner judged sufficient for an open-source platform still under development; the card is the promise to every later connection.

## Decision

* A body is a DOCUMENT of its message (`<messageId>:body`), never a field of its record: lake bytes, an opaque `raw.documents` row (`{labelIds, messageId, part: "body"}`), names in the manifest only. The extract verb's text and HTML readers put it in `raw.document_text`, which the BI role cannot read. `raw.records` keeps exactly the six headers.
* The body is the first `text/plain` part with no filename, else the first `text/html` one; the payload itself counts. A large body Gmail moved out is fetched by its `attachmentId` and is no longer also taken as an attachment.
* Stored as UTF-8, decoding the part's declared charset once at landing through the HTML reader's `decodeCharset`.
* The file-type choice does not govern the body; a body over the 25 MiB ceiling is refused and listed as left behind, like an attachment.
* Held mail gets its body through ADR 0076's list: `360_gmail_body_left_behind.sql` adds a body entry to every Gmail mark with a list; `planReads` treats it as wanted whatever the choice and reads the message once, looking only at listed parts.
* The card: "Message headers, message text and the attachment types you allow, from the mailbox you connect", in both locales.

## Consequences

Mail becomes searchable and readable by a tenant's dbt models through `raw.document_text` (`document_id` = `<messageId>:body`). Replies quote earlier mail, so a thread's text is stored once per message. The first Gmail run after the release reads every held message again once (about ninety minutes for 16,000 at three a second). `extract_due` gains one in-process text read per message.

## Rejected

The body in the record's payload (dbt reads `raw.records` directly, and it would bypass extraction and search); `format=raw` RFC 822 landing (one more paced request per message, and every attachment stored twice); a table of its own for bodies (a second PII exception and search index); clearing every mark to NULL to force a full re-read (re-fetches every attachment already landed).
