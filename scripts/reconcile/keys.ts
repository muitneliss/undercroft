/**
 * Identity: how one record is named, so that the same record on two systems gets the same key.
 *
 * THREE GMAIL IDENTIFIERS, AND ONLY ONE OF THEM CROSSES MAILBOXES.
 * - The Gmail message id (`18f…`) names a message IN ONE MAILBOX. The same letter delivered to
 *   two mailboxes has two of them, so a key made of the bare id reads one letter as two, and
 *   two letters that happen to share an id across accounts as one (issue #143).
 * - The RFC 5322 `Message-ID` header names the LETTER. It is the key for "is this the same
 *   email" across mailboxes, and it is absent or duplicated often enough that it can never be
 *   the only key.
 * - The thread id groups messages in one mailbox and identifies nothing on its own.
 * So a message key is always `mailbox:gmailId`, and the letter key is the normalised
 * Message-ID, kept beside it.
 */

const GMAIL_ID = /^[0-9a-f]{8,24}$/u;
const ANGLE = /^<|>$/gu;

export type Mailbox = "primary" | "secondary";

/** A Gmail message id, lower-cased; `null` for anything that is not one. */
export function gmailId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return GMAIL_ID.test(value) ? value : null;
}

/** The key of a message: mailbox-qualified, because a bare Gmail id does not cross accounts. */
export function messageKey(mailbox: Mailbox, raw: string): string | null {
  const id = gmailId(raw);
  return id === null ? null : `${mailbox}:${id}`;
}

/**
 * The key of a letter: the RFC Message-ID without its angle brackets and surrounding space.
 *
 * Case is kept. RFC 5322 makes the local part case-sensitive, and lower-casing it would merge
 * two letters a sender distinguished.
 */
export function letterKey(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(ANGLE, "").trim();
  return value.length > 0 && value.includes("@") ? value : null;
}
