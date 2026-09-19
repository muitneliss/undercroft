/**
 * The opaque page cursor every paged list shares.
 *
 * A cursor is `<instant>|<id>` in base64url: the pair the list's index is ordered by, so a
 * page boundary is exact even when two rows share an instant. It is opaque to the caller,
 * which only ever hands it back, and it decodes to `null` rather than throwing for anything
 * that is not one of ours -- a stale bookmark reads as "from the top", not as a 500.
 */

export interface CursorKey {
  readonly at: string;
  readonly id: string;
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): CursorKey | null {
  if (cursor === null || cursor === undefined || cursor === "") {
    return null;
  }
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  const split = text.indexOf("|");
  if (split <= 0) {
    return null;
  }
  return { at: text.slice(0, split), id: text.slice(split + 1) };
}
