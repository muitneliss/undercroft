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
 *
 * A NAME IS NOT A FILE'S IDENTITY, AND NEITHER IS ITS CONTENT HASH. A Drive file id names
 * one file; md5 names bytes, which two files can share and a Google-native file does not
 * have. `fileExtension` refuses to invent an extension out of a name like
 * `Agreement for Mr. Smith`, which the audit found reading as extension `smith`.
 */

const GMAIL_ID = /^[0-9a-f]{8,24}$/u;
const HUBSPOT_ID = /^\d{1,20}$/u;
const EXTENSION = /^[0-9a-z]{1,6}$/u;
const DIGITS_ONLY = /^\d+$/u;
const SLASHES = /\/+/gu;
const EDGE_SLASHES = /^\/|\/$/gu;
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

/** A HubSpot object id as its decimal string; `null` for anything else. */
export function hubspotId(raw: string | number | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  return HUBSPOT_ID.test(value) ? value : null;
}

/**
 * A path relative to its root, in one Unicode form, with single slashes.
 *
 * NFC because a name typed on macOS arrives decomposed and the same name typed on Windows
 * composed; the two render identically and compare unequal. Case is kept -- Drive allows two
 * names that differ only in case, and folding them would merge two files.
 */
export function relativePath(path: string, root = ""): string {
  const normal = path.normalize("NFC").replace(SLASHES, "/");
  const base = root.normalize("NFC").replace(SLASHES, "/").replace(EDGE_SLASHES, "");
  const trimmed = normal.replace(EDGE_SLASHES, "");
  if (base.length > 0 && (trimmed === base || trimmed.startsWith(`${base}/`))) {
    return trimmed.slice(base.length).replace(EDGE_SLASHES, "");
  }
  return trimmed;
}

/**
 * A file's extension, or `null` when the name does not carry one.
 *
 * The text after the last dot counts only when it is short and plain: `Rev.1` is not a
 * version extension, `Pte. Ltd.` ends in nothing, and `for Mr. Smith` does not end in
 * `smith`. MIME is the primary signal everywhere in this suite; the extension is a fallback,
 * and a fallback that invents a value is worse than none.
 */
export function fileExtension(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return null;
  }
  const tail = name.slice(dot + 1).toLowerCase();
  if (!EXTENSION.test(tail) || DIGITS_ONLY.test(tail)) {
    return null;
  }
  return tail;
}
