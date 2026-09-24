/**
 * What an admin chose to share, as one shape both sides agree on.
 *
 * The UI writes it through `connections.setScope`, the worker reads it before a run, and
 * the card renders a summary of it. One schema so a picker that saved something the
 * collector does not understand is a parse failure at the boundary rather than a run that
 * quietly reads nothing.
 *
 * Names are carried beside ids deliberately. The card says "Matching files in 2 selected
 * folders" and the picker has to re-render the choice without a round trip to Google, and
 * neither works from ids alone. This is exactly why the value lives in `app.connection_detail`,
 * a schema BI has no USAGE on -- see `packages/db/sql/070_google_ingestion.sql`.
 */

import { z } from "zod";

import { sourceKind } from "./sourceInstance.ts";

const Chosen = z.object({
  id: z.string().min(1),
  /** As the customer sees it. PII: never copied into `raw.documents.metadata` or a key. */
  name: z.string(),
});

/** `typeof x === "object"` still admits null and says nothing about indexing. This does. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Which file types a Gmail or Drive connection may land, shared by both scopes: MIME types,
 * and extensions such as `.oa` for a format that has none. `fileFormats.ts` says how a file is
 * matched against them.
 *
 * Empty is the same *recorded decision* idiom as `GmailScope.labels` and `XeroScope.entities`
 * below: it means every file type, not an absent choice. The default is `application/pdf`
 * alone, so a selection saved before this field existed -- every one of them -- keeps landing
 * exactly what it always did; nothing widens until an admin visits the picker and says so.
 */
const FileTypes = z.array(z.string().min(1)).default(["application/pdf"]);

export const GmailScope = z.object({
  kind: z.literal("gmail"),
  /**
   * Empty is a *recorded decision*, not an absent one: it means the whole mailbox, which is
   * what `scope.gmailWholeMailbox` renders. A connection that has never been scoped has no
   * row at all, which is how `needs_scope` is told from "deliberately everything".
   */
  labels: z.array(Chosen).default([]),
  fileTypes: FileTypes,
});

export const DriveScope = z.object({
  kind: z.literal("drive"),
  /**
   * What the admin picked, in the Google Picker or from `connections.browseScope`. These are
   * the only things a run reads. The credential is `drive.readonly` and could read more, so
   * the promise "no other folder is read" is kept by the collector's own `'<id>' in parents`
   * query and by `recurse`, not by Google. ADR 0047.
   */
  files: z.array(Chosen.extend({ kind: z.enum(["folder", "file"]) })).default([]),
  fileTypes: FileTypes,
  /**
   * Whether a picked folder is read to the bottom, or one level only.
   *
   * **False is what a selection saved before this field existed means**, and the default is
   * what makes that true: such a row carries no `recurse` key, parses to `false`, and keeps
   * landing exactly what it landed yesterday. The alternative -- recursing by default -- would
   * widen every recorded consent in the estate by deploying, with nobody having said so. The
   * same reasoning as `FileTypes` above; ADR 0031.
   */
  recurse: z.boolean().default(false),
});

/**
 * Which Xero organisation to read, and which of the spec's entities.
 *
 * One consent can cover several organisations -- an accountant's login sees every client's
 * books -- and the platform must not guess which one a customer meant. The organisation's
 * id goes to `ops.connection.external_account_id` (it is Xero's `xero-tenant-id` header);
 * its name stays here, where BI cannot read it. An empty entity list means every entity the
 * spec declares, which is a recorded decision, like Gmail's empty label list.
 */
export const XeroScope = z.object({
  kind: z.literal("xero"),
  organisation: Chosen,
  entities: z.array(z.string().min(1)).default([]),
});

export const ConnectionScope = z.discriminatedUnion("kind", [GmailScope, DriveScope, XeroScope]);

export type GmailScope = z.infer<typeof GmailScope>;
export type DriveScope = z.infer<typeof DriveScope>;
export type XeroScope = z.infer<typeof XeroScope>;
export type ConnectionScope = z.infer<typeof ConnectionScope>;

/**
 * Kinds that must be told what to read before a run may read anything.
 *
 * One set, shared by the card that shows `needs_scope`, the schedule that skips such a
 * source, and the collector that refuses to run it. A second copy is how one of the three
 * starts reading a whole mailbox on the strength of a missing row.
 *
 * Not exported: it holds KINDS, and a caller handed a set would ask it `.has(source)` -- which
 * answers `false` for `gmail.3fa9c1d2e0ab` and so waves a second mailbox past the scope check.
 * `isScopedSource` reads the kind first, every time.
 */
const SCOPED_KINDS: ReadonlySet<string> = new Set(["gmail", "drive", "xero"]);

/** Whether this source must have a chosen scope before it may be read. Any account of a kind. */
export function isScopedSource(source: string): boolean {
  return SCOPED_KINDS.has(sourceKind(source));
}

/** The key a source's selection must carry to count as chosen. See `parseScope`. */
const SELECTION_KEY: Readonly<Record<string, string>> = {
  gmail: "labels",
  drive: "files",
  xero: "organisation",
};

/** True when this source needs a scope and none usable has been chosen. */
export function needsScope(source: string, selectionJson: string): boolean {
  return isScopedSource(source) && parseScope(source, selectionJson) === null;
}

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
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  // The source's own key must be PRESENT, not merely defaultable. Zod's `.default([])` would
  // otherwise turn `{}` into a valid empty selection -- which reads as "the whole mailbox",
  // exactly the collapse of "nobody has chosen yet" into "somebody chose everything" that
  // the rest of this file exists to prevent. It also catches a Drive-shaped selection saved
  // under Gmail: the key it carries is not the key that source uses.
  // Every account of a kind is scoped the same way, so the shape is decided by the kind.
  const kind = sourceKind(source);
  const key = SELECTION_KEY[kind];
  const carried = key === undefined || !isRecord(raw) ? undefined : raw[key];
  if (carried === undefined || carried === null || typeof carried !== "object") {
    return null;
  }

  const parsed = ConnectionScope.safeParse({ ...raw, kind });
  return parsed.success ? parsed.data : null;
}
