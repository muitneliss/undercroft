/**
 * The one error the suite raises. `code` says what kind of failure it was -- `REFUSED` for a
 * write the read allow-list stopped, `SHAPE` for an answer in an unexpected form, an HTTP
 * status or a CLI error code otherwise -- so a caller can turn it into a BLOCKED case with a
 * reason instead of a crash, and a test can assert which guard fired.
 */

export interface ReconcileErrorOptions {
  readonly code?: string;
  readonly status?: number;
  readonly cause?: unknown;
}

export class ReconcileError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: ReconcileErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ReconcileError";
    this.code = options.code ?? "ERROR";
    this.status = options.status ?? 0;
  }
}

/** The message of anything thrown, for a BLOCKED case's reason. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
