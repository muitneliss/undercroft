/**
 * The BM25 door refusing a search it cannot answer truthfully (ADR 0156 decision 5).
 *
 * `raw.search_document_bm25` raises SQLSTATE 55000, `object_not_in_prerequisite_state`, rather
 * than answer a page that is not what it says: when the tenant's two indexes are not both valid
 * and ready (one dropped between the readiness check and the door), and when its page is shorter
 * than asked while more documents match than it holds -- matches past the depth of both heads,
 * or a query with no positive term to rank, such as `-xe` alone. Neither is the reader's fault
 * or a failure: the search is asked again ADR 0123's way, and its answer says what that ranked.
 *
 * Read by its code, never by its sentence: the sentence is the door's to reword, the code is the
 * contract 680 states. This is the one place the driver's error is read for it, as
 * `queryTimeout.ts` is for the timeout. Nothing else in the search statement raises 55000; were
 * something to, the cost is a search answered the older way, which says so when it cut anything,
 * and never a hit that is not one.
 */

/** Postgres's `object_not_in_prerequisite_state`, the door's refusal. */
const OBJECT_NOT_IN_PREREQUISITE_STATE = "55000";

/** Whether `error`, or anything it wraps, is the door refusing to rank this search. */
export function isBm25Refusal(error: unknown): boolean {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if ("code" in at && at.code === OBJECT_NOT_IN_PREREQUISITE_STATE) {
      return true;
    }
  }
  return false;
}
