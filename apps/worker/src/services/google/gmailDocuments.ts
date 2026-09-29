/**
 * A Gmail message's parts as documents to land: the attachments the choice takes, and its body.
 *
 * Split from `gmail.ts`, which reads the mailbox and builds the record, because both documents
 * obey one rule that the record does not: the split between `metadata` and `manifest`.
 * `metadata` reaches `raw.documents`, which dbt and BI can read, so it carries opaque ids,
 * enumerations and counts only; every name a human wrote goes in `manifest`, which lives in the
 * access-controlled object store. `pii.md`, ADR 0015.
 */

import { landedType } from "@undercroft/contracts";
import { decodeBase64Url, getStringPath } from "@undercroft/core";

import { decodeCharset } from "../extract/html.ts";
import type { DocumentToLand } from "../landDocument.ts";
import type { GoogleApi } from "./api.ts";
import type { AttachmentPart, BodyPart } from "./gmailAttachments.ts";

export const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/** What a message says about itself that its documents need. */
export interface MessageFacts {
  readonly messageId: string;
  readonly headers: Record<string, string>;
  readonly labelIds: string[];
  readonly sourceUpdatedAt: string | null;
}

function manifestOf(facts: MessageFacts): Record<string, string> {
  return {
    subject: facts.headers.Subject ?? "",
    from: facts.headers.From ?? "",
    to: facts.headers.To ?? "",
    messageId: facts.messageId,
  };
}

/** Bytes Gmail moved out of a message, by the id it gave them. */
async function partBytes(
  api: GoogleApi,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const body = await api.getJson(
    `${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    "attachments",
    0,
  );
  return decodeBase64Url(getStringPath(body, "data") ?? "");
}

/** One matching attachment as a document to land. */
export function attachmentDocument(
  api: GoogleApi,
  facts: MessageFacts,
  part: AttachmentPart,
): DocumentToLand {
  const { messageId, labelIds } = facts;
  return {
    // (messageId, partIndex), never attachmentId. See `gmail.ts`.
    documentId: part.documentId,
    // An attachment Gmail could only call `application/octet-stream` is filed under what its
    // extension says when the catalogue knows it -- a `.oa` as JSON. `fileFormats.ts`.
    contentType: landedType({ mimeType: part.mimeType, name: part.filename }),
    declaredBytes: part.size,
    metadata: { labelIds, partIndex: String(part.index), messageId },
    manifest: { filename: part.filename, ...manifestOf(facts) },
    sourceUpdatedAt: facts.sourceUpdatedAt,
    fetchBytes: () => partBytes(api, messageId, part.attachmentId),
  };
}

/**
 * A message's text as a document to land, beside its attachments. ADR 0084.
 *
 * A DOCUMENT, NOT A FIELD ON THE RECORD. `raw.records` is read by dbt directly, while a
 * document's text reaches Postgres only through `raw.document_text`, the one table `pii.md`
 * already lets hold what a person wrote -- and the BI role reads neither. So the body is split
 * from its record exactly as an attachment is, with the names in the manifest as there.
 *
 * STORED AS UTF-8. Gmail hands back a part's bytes in the charset its Content-Type declares, and
 * the text reader deliberately ignores a declared charset (a file's is too often wrong). A mail
 * part's declaration is the MIME standard's own, so it is honoured here, once, where it is still
 * attached to the bytes -- through the HTML reader's own `decodeCharset`, so a label the runtime
 * does not know is read as UTF-8 here exactly as it would be there.
 */
export function bodyDocument(api: GoogleApi, facts: MessageFacts, body: BodyPart): DocumentToLand {
  const { messageId, labelIds } = facts;
  return {
    documentId: body.documentId,
    contentType: body.mimeType,
    declaredBytes: body.size,
    metadata: { labelIds, messageId, part: "body" },
    manifest: manifestOf(facts),
    sourceUpdatedAt: facts.sourceUpdatedAt,
    fetchBytes: async (): Promise<Uint8Array> => {
      const bytes =
        body.attachmentId === ""
          ? decodeBase64Url(body.data)
          : await partBytes(api, messageId, body.attachmentId);
      return asUtf8(bytes, body.charset);
    },
  };
}

const UTF8_LABELS = new Set(["utf-8", "utf8", "us-ascii", "ascii"]);

/** Bytes UTF-8 already, or read in their declared charset and written as UTF-8. */
function asUtf8(bytes: Uint8Array, charset: string | null): Uint8Array {
  if (charset === null || UTF8_LABELS.has(charset)) {
    return bytes;
  }
  return new TextEncoder().encode(decodeCharset(bytes, charset));
}
