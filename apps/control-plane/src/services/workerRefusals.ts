/**
 * What a worker's refusal means, read from its HTTP status alone.
 *
 * The control plane deliberately never reads a refusal's body into a failure -- a request to
 * the worker can carry a live refresh token, and a refusal can echo it -- so the status line is
 * the entire vocabulary for "why not", and which status means what is a contract rather than a
 * detail. It is written down once, here, and `workerClient.ts` speaks it. The two calls whose
 * body IS read (a run already in progress, a query Postgres refused) say why beside the call.
 *
 * Status meaning is per-endpoint, as it is in HTTP: a browse starts no run, so its 409 names
 * the credential rather than a run in progress. `BROWSE_REFUSALS` is that endpoint's reading.
 */

/**
 * Why a call did not succeed, in the three shapes a caller acts on differently.
 *
 * `unreachable` is worth retrying and means the worker is down; `refused` means the worker
 * answered and said no, which retrying will not fix. Collapsing them would make a
 * misconfigured tenant look like an outage.
 *
 * `scope-insufficient` is split out of `refused` for the same reason one level finer: it is
 * the only one of the three that the administrator reading the screen can fix, by
 * reconnecting the source and granting the permission that was withheld. Worded as an
 * outage -- which is what it was -- it sends them off to wait for a service that is fine.
 */
export type WorkerFailure =
  | "unreachable"
  | "refused"
  | "scope-insufficient"
  /**
   * The browse's 409: the credential lapsed and could not be refreshed, so the connection now
   * reads `expired`. Not `scope-insufficient`: no permission to tick, only a reconnect. #213.
   */
  | "credential-expired"
  | "credential-rejected"
  /** The worker's 409: the tenant already has a run of this kind going. */
  | "in-progress"
  /**
   * The worker's 412: the credential is for a different account than the connection it was
   * offered to is pinned to. Its own value because its remedy is its own -- add the account as
   * a connection of its own -- and because the consent flow re-resolves on it. ADR 0043.
   */
  | "account-mismatch"
  /** The author's SQL did not run. The outcome carries Postgres's sentence about it. */
  | "query-failed";

/** The worker's answer for SQL that did not run, whose body names why. */
export const BAD_REQUEST = 400;
/** The worker's answer for a credential Google refused. Every other status is a refusal. */
const FORBIDDEN = 403;
/** The worker's answer for a run already in progress, whose body names it. */
export const CONFLICT = 409;
/** The worker's answer for a pasted credential the provider turned away. */
const UNPROCESSABLE = 422;
/** The worker's answer to a credential for an account its connection is not pinned to. */
const PRECONDITION_FAILED = 412;

/** The refusals a status alone names. Anything else is `refused`: the worker said no. */
export const REFUSAL_BY_STATUS: ReadonlyMap<number, WorkerFailure> = new Map([
  [FORBIDDEN, "scope-insufficient"],
  [UNPROCESSABLE, "credential-rejected"],
  [CONFLICT, "in-progress"],
  [PRECONDITION_FAILED, "account-mismatch"],
]);

/**
 * The browse's own reading of a status. Its 409 is the credential, never a run in progress --
 * a browse starts no run -- so the status alone still says it and the body stays unread.
 */
export const BROWSE_REFUSALS: ReadonlyMap<number, WorkerFailure> = new Map([
  ...REFUSAL_BY_STATUS,
  [CONFLICT, "credential-expired"],
]);
