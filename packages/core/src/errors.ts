/**
 * The error types that cross package boundaries.
 *
 * Every one of these carries enough context to tell a retry from an investigation.
 * "Request failed" sends someone to read logs; "failed after 412 records on entity
 * `deals`, HTTP 429" tells them what happened before they open anything.
 */

// biome-ignore-all lint/complexity/useMaxParams: Four functions take five arguments, each a distinct required input with no sensible grouping. Bundling them into an options object to satisfy a count would hide which are required.
// biome-ignore-all lint/style/noExcessiveClassesPerFile: Error types declared next to the seam that raises them, which is where a reader looks for them.
// biome-ignore-all lint/style/noParameterProperties: TypeScript parameter properties in two classes. The alternative is declaring each field and then assigning it in the constructor, which is the same information written twice.

export class UndercroftError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A non-2xx response. `retryAfterMs` is whatever the server asked for, unclamped. */
export class HttpError extends UndercroftError {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodyExcerpt: string = "",
    readonly retryAfterMs: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(`HTTP ${status} from ${url}`, options);
  }
}

/**
 * A source failed.
 *
 * `seen` is in the message on purpose: a connector that failed having read nothing is a
 * credential or permission problem, and one that failed after 412 records is a transient
 * upstream fault. Those want different responses, and the count is the only thing that
 * distinguishes them at a glance.
 */
export class ConnectorError extends UndercroftError {
  constructor(
    readonly connector: string,
    readonly entity: string,
    readonly seen: number,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${connector}/${entity} failed after ${seen} records: ${detail}`, options);
  }
}

/**
 * A quota that cannot be waited out.
 *
 * Distinct from a 429, which is "slow down". A daily cap is "come back tomorrow", and
 * sleeping until then would park a worker for hours pretending to make progress.
 */
export class QuotaExhausted extends UndercroftError {
  constructor(
    readonly scope: string,
    readonly limit: number,
    readonly resetsAt: Date,
  ) {
    super(
      `${scope} quota of ${limit} is exhausted until ${resetsAt.toISOString()}; ` +
        "this cannot be waited out within a run",
    );
  }
}
