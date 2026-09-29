# 84. A Gmail harvest lands each message's body, as a document of that message

- Status: Accepted
- Date: 2026-09-29
- Reverses: the promise a Gmail connection has made since it was built -- "message headers and
  the attachment types you allow", with bodies never fetched -- which lived on the consent card
  and in `apps/worker/src/services/google/gmail.ts` rather than in an ADR of its own.
- Extends: [ADR 0024](0024-extracted-text-is-readable-by-dbt.md) (the body's text is extracted
  text like any document's) and [ADR 0076](0076-a-harvest-records-what-it-left-behind.md) (a held
  message's body is reached through the left-behind list).

## Context

A Gmail connection landed each message's six headers into `raw.records` and the attachments the
file-type choice allowed into the lake. The text of the mail itself -- what a customer asked for,
what was agreed, why an invoice was disputed -- was never read. Deriving meaning from mail (the
semantic probe, [#302](https://github.com/muitneliss/undercroft/pull/302)) and searching it both
need that text, and the headers and attachments do not carry it.

The consent to read bodies was obtained from the tenant outside the system, which the project's
owner decided is sufficient: this is an open-source platform still under development, and the
connection card is the promise to every connection made after this change.

## Decision

1. **A body is a DOCUMENT of its message, never a field of its record.** It lands through the same
   sink as an attachment, under `<messageId>:body`: bytes in the lake (create-only, deduplicated
   by content), an opaque catalogue row in `raw.documents` (`{labelIds, messageId, part: "body"}`),
   the subject and addresses in the lake manifest only. The extract verb's existing text and HTML
   readers turn it into `raw.document_text`, the one table `pii.md` already lets hold what a person
   wrote, which the BI role cannot read. `raw.records` keeps exactly the six headers.
2. **Which part is the body.** The first `text/plain` part with no filename, else the first
   `text/html` one; the payload itself counts, since a single-part message is its body. A text part
   with a filename is an attachment and stays the file-type choice's to take. A large body Gmail
   moved out of the message is fetched by its `attachmentId`, and is no longer also taken as an
   attachment.
3. **Stored as UTF-8.** Gmail returns a part's bytes in the charset its Content-Type declares, and
   the text reader deliberately ignores a declared charset. The declaration is honoured once, at
   landing, through the HTML reader's own `decodeCharset`.
4. **The file-type choice does not govern the body.** Every read message lands its body; the choice
   still decides attachments. A body over the 25 MiB ceiling is refused by the sink and listed as
   left behind, exactly as an attachment is.
5. **Mail already held gets its body through ADR 0076's list.** `360_gmail_body_left_behind.sql`
   adds a body entry to every Gmail mark that has a list; `planReads` treats a body entry as wanted
   whatever the choice, reads the message once more, and looks only at what the list names, so no
   attachment is fetched twice. A mark with no list is already read in full.
6. **The card says it.** "Message headers, message text and the attachment types you allow, from
   the mailbox you connect", in both locales.

## Consequences

- Mail becomes searchable in the Lake Console and readable by a tenant's dbt models through
  `raw.document_text`, joined to its message by `document_id` = `<messageId>:body`.
- A reply quotes the mail before it, so a thread's text is stored once per message. The lake
  deduplicates identical bytes only; a model that wants a thread's words once has to take the
  newest body, or strip quoted lines itself.
- The first Gmail run after this release reads every held message again once. At Gmail's pace of
  about three messages a second, a mailbox of 16,000 held messages is about ninety minutes, once.
- `extract_due` has one more document per message to read. Text and HTML are read in process,
  spawning nothing, so the cost is the row rather than the CPU.

## Options rejected

- **The body in the record's payload.** `raw.records` is read by dbt directly and by the control
  plane; it would put every word of every mail one `dbt run` from a dashboard, and it would
  bypass the extract verb, so search and the text readers would never see it.
- **`format=raw`, landing the whole RFC 822 message.** One more paced request per message, which
  doubles a harvest's duration, and a second copy of every attachment inside the message bytes.
- **A table of its own for bodies.** A second place for text a person wrote, needing a second
  exception in `pii.md` and a second search index, for what the document path already does.
- **Clearing every Gmail mark to NULL to force a full re-read.** A full read offers every
  attachment again, so every attachment already landed would be fetched a second time to reach a
  body that is inline in the message.
