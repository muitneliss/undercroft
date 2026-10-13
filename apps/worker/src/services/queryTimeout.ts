/**
 * A statement Postgres cancelled at its time limit (#447, ADR 0123).
 *
 * Nothing broke, and asking again will not help. The same question takes the same time, so a
 * caller that is told "the service did not answer, try again" asks it again and again. That was
 * the wording every timed-out search got, because the error reached the boundary as an unnamed
 * failure. This names it, so the caller can say what happened and what to change instead: narrow
 * the question. `isStatementTimeout` is the one place the driver's error is read for it.
 */

export class QueryTimedOut extends Error {
  /** The limit the statement ran into, so the sentence a reader sees can state it. */
  readonly limitMs: number;

  constructor(limitMs: number, options?: { cause?: unknown }) {
    super(`the statement ran past its ${String(limitMs)} ms limit and was cancelled`, options);
    // biome-ignore lint/security/noSecrets: a class name, mixed case enough to read as high entropy.
    this.name = "QueryTimedOut";
    this.limitMs = limitMs;
  }
}

/** Postgres's `query_canceled`. Shared by the statement timeout and by a cancel request. */
const QUERY_CANCELED = "57014";
/**
 * Postgres's wording for the timeout, as opposed to `pg_cancel_backend`'s "due to user request".
 * Both carry 57014. Only the timeout is "too long, narrow it". An operator cancelling a statement
 * by hand must not be told to the reader as a limit they ran into, so a cancel this does not
 * recognise stays the unnamed failure it was.
 */
const STATEMENT_TIMEOUT = /statement timeout/u;

/** Whether `error`, or anything it wraps, is Postgres cancelling a statement at its timeout. */
export function isStatementTimeout(error: unknown): boolean {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if ("code" in at && at.code === QUERY_CANCELED && STATEMENT_TIMEOUT.test(at.message)) {
      return true;
    }
  }
  return false;
}
