/**
 * Where a person opens a Google document at its source: `raw.documents.source_url` (ADR 0161).
 *
 * Once a document's text has been read its bytes are purged from the lake, so this link and the
 * file's name are how anybody finds the file again. Both rules are DERIVED FROM THE ID alone,
 * one place for each, because two callers need them: the collectors at landing time, and the
 * operator's backfill for documents landed before the column existed, which has the id and not
 * the listing.
 *
 * Drive's own `webViewLink` was considered and not used. It costs a field on every listing,
 * differs from this only in which editor a native Doc opens in, and the backfill could never
 * have it -- so the column would hold two spellings of one link depending on when a file landed.
 * `/file/d/<id>/view` is Drive's documented address for any file and redirects a Doc, Sheet or
 * Slides file to its editor.
 *
 * A Gmail link names the MESSAGE, and `u/0` is whichever Google account the reader's browser
 * signed in first. A reader signed in to several accounts may land in the wrong mailbox and
 * switch account; the alternative, the mailbox's address in the URL, would put an address into
 * a column dbt reads, which the owner's decision did not extend to. Said in ADR 0161.
 */

/** A Drive file, by its id. */
export function driveFileLink(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

/** A Gmail message, by the id the API gave it -- the message an attachment or a body is part of. */
export function gmailMessageLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`;
}
