/**
 * What an admin chose to share, as one shape both sides agree on.
 *
 * The UI writes it through `connections.setScope`, the worker reads it before a run, and
 * the card renders a summary of it. One schema so a picker that saved something the
 * collector does not understand is a parse failure at the boundary rather than a run that
 * quietly reads nothing.
 *
 * Names are carried beside ids deliberately. The card says "PDFs in 2 selected folders" and
 * the picker has to re-render the choice without a round trip to Google, and neither works
 * from ids alone. This is exactly why the value lives in `app.connection_detail`, a schema
 * BI has no USAGE on -- see `packages/db/sql/070_google_ingestion.sql`.
 */

import { z } from "zod";

const Chosen = z.object({
  id: z.string().min(1),
  /** As the customer sees it. PII: never copied into `raw.documents.metadata` or a key. */
  name: z.string(),
});

export const GmailScope = z.object({
  kind: z.literal("gmail"),
  /**
   * Empty is a *recorded decision*, not an absent one: it means the whole mailbox, which is
   * what `scope.gmailWholeMailbox` renders. A connection that has never been scoped has no
   * row at all, which is how `needs_scope` is told from "deliberately everything".
   */
  labels: z.array(Chosen).default([]),
});

export const DriveScope = z.object({
  kind: z.literal("drive"),
  /**
   * What the admin picked in the Google Picker. Under the `drive.file` scope these are the
   * only things the credential can read at all -- Google enforces it, so the promise "no
   * other folder is read" is not ours to keep or break.
   */
  files: z.array(Chosen.extend({ kind: z.enum(["folder", "file"]) })).default([]),
});

export const ConnectionScope = z.discriminatedUnion("kind", [GmailScope, DriveScope]);

export type GmailScope = z.infer<typeof GmailScope>;
export type DriveScope = z.infer<typeof DriveScope>;
export type ConnectionScope = z.infer<typeof ConnectionScope>;

/**
 * Read a stored selection, or `null` when there is nothing usable there.
 *
 * Null rather than a default: "nobody has chosen yet" and "somebody chose nothing" are
 * different facts, and a collector that treated a malformed row as "the whole mailbox"
 * would read far more than anyone agreed to.
 */
export function parseScope(source: string, selectionJson: string): ConnectionScope | null {
  let raw: unknown;
  try {
    raw = JSON.parse(selectionJson);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const parsed = ConnectionScope.safeParse({ kind: source, ...raw });
  return parsed.success ? parsed.data : null;
}
