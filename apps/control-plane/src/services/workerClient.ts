/**
 * The control plane's one channel to the worker.
 *
 * The control plane cannot seal a credential: it has no `UNDERCROFT_SECRET_KEY`, and that
 * absence is the security property, not an oversight. It CAN run the browser half of a
 * consent, because Google's redirect must land on a public origin and the worker has none.
 * So the token bundle crosses one internal hop, on the same trigger-token allowlist Kestra
 * uses, and the internet-facing service keeps the property that it can never read a stored
 * credential back. ADR 0016.
 *
 * A capability, not a config bag. `main.ts` builds one of these from env and injects it;
 * nothing below the entrypoint knows a URL or a token exists, and a test substitutes
 * `InMemoryWorkerClient` without a socket.
 */

import type {
  BrowseScopeResponse,
  BuildModelResponse,
  CredentialInput,
  DqFailuresRequest,
  RevokeConnectionResponse,
  RunQueryRequest,
  SchemaResponse,
  StoreCredentialResponse,
  TableResult,
} from "@undercroft/contracts";

export type WorkerOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: WorkerFailure;
      /** The worker's own sentence, for the one refusal an author can act on: a failed query. */
      message?: string;
    };

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
  | "credential-rejected"
  /** The worker's 409: the tenant already has a run of this kind going. */
  | "in-progress"
  /** The author's SQL did not run. The outcome carries Postgres's sentence about it. */
  | "query-failed";

export interface StoreCredentialInput {
  readonly source: string;
  readonly tenantId: string;
  readonly externalAccountId: string;
  readonly scope: string;
  readonly credential: CredentialInput;
  /** Prove a pasted token against the provider before sealing it. See the worker. */
  readonly validate?: boolean;
}

/**
 * Starting a run has one more answer than the other verbs: "already running, as this id".
 * Not a failure to retry and not a refusal to word as one -- the person pressing Run now
 * wants to watch the run that exists.
 */
export type TriggerOutcome =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly reason: "in-progress"; readonly runId: string }
  | { readonly ok: false; readonly reason: WorkerFailure };

export interface WorkerClient {
  storeCredential: (input: StoreCredentialInput) => Promise<WorkerOutcome<StoreCredentialResponse>>;
  browseScope: (input: {
    source: string;
    tenantId: string;
    kind: "labels" | "organisations";
  }) => Promise<WorkerOutcome<BrowseScopeResponse>>;
  revokeConnection: (input: {
    source: string;
    tenantId: string;
  }) => Promise<WorkerOutcome<RevokeConnectionResponse>>;
  /** Start an ingest for one source. `triggeredBy` is an `app_user` uuid, never an address. */
  triggerIngest: (input: {
    source: string;
    tenantId: string;
    triggeredBy: string;
  }) => Promise<TriggerOutcome>;
  /** Build one model and wait for it: the editor is looking. */
  buildModel: (input: {
    tenantId: string;
    model: string;
    triggeredBy: string;
  }) => Promise<WorkerOutcome<BuildModelResponse>>;
  /** The rows a failed test stored, as the worker reads them for an admin. */
  dqFailures: (input: DqFailuresRequest) => Promise<WorkerOutcome<TableResult>>;
  /** SQL an author wrote, run as the tenant's read-only login. */
  runQuery: (input: RunQueryRequest) => Promise<WorkerOutcome<TableResult>>;
  /** The tenant's analytics schema, as that login sees it. */
  readSchema: (input: { tenantId: string }) => Promise<WorkerOutcome<SchemaResponse>>;
}

/**
 * The part of `fetch` this client actually uses.
 *
 * Narrower than `typeof globalThis.fetch` on purpose: under Bun that type carries a
 * `preconnect` method, so a substitute would have to supply one that nothing here ever
 * calls. An injected seam should ask for what it uses and no more -- the platform's own
 * `fetch` still satisfies this.
 */
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HttpWorkerConfig {
  readonly baseUrl: string;
  readonly triggerToken: string;
  /** Injected in tests. The process uses the platform's `fetch`. */
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** A synchronous build: the worker's two-minute deadline, and a little for the rows. */
const BUILD_DEADLINE_MS = 150_000;

/** The worker's answer for SQL that did not run, whose body names why. */
const BAD_REQUEST = 400;
/** The worker's answer for a credential Google refused. Every other status is a refusal. */
const FORBIDDEN = 403;
/** The worker's answer for a run already in progress, whose body names it. */
const CONFLICT = 409;
/** The worker's answer for a pasted credential the provider turned away. */
const UNPROCESSABLE = 422;

/** Where the worker is and how to reach it. Passed rather than closed over, so the two
 * request helpers below can live at module scope and be read on their own. */
interface WorkerTransport {
  readonly doFetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs: number;
  readonly baseUrl: string;
  readonly triggerToken: string;
}

/** One POST to the worker, with its refusals mapped onto `WorkerOutcome`. */
function postTo(t: WorkerTransport): typeof post {
  async function post<T>(
    path: string,
    body: unknown,
    deadlineMs: number = t.timeoutMs,
  ): Promise<WorkerOutcome<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      const response = await t.doFetch(`${t.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t.triggerToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        // The body is deliberately not read into the failure. A refusal from this endpoint
        // can echo a request that carried a live refresh token, and a control-plane log is
        // not where that belongs. The STATUS carries no such payload, which is what makes
        // it the right place to tell a withheld permission from every other refusal.
        if (response.status === FORBIDDEN) {
          return { ok: false, reason: "scope-insufficient" };
        }
        if (response.status === UNPROCESSABLE) {
          return { ok: false, reason: "credential-rejected" };
        }
        if (response.status === CONFLICT) {
          return { ok: false, reason: "in-progress" };
        }
        return { ok: false, reason: "refused" };
      }
      return { ok: true, value: (await response.json()) as T };
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The one call whose refusal body IS read: a 409 `run_in_progress` carries the running
   * run's id in `details`, which is a run id and never a token. Every other status is
   * handled as `post` handles it.
   */
  return post;
}

/** Starting a run, whose refusal carries a runId when one is already in flight. */
function triggerOn(t: WorkerTransport): typeof trigger {
  async function trigger(input: {
    source: string;
    tenantId: string;
    triggeredBy: string;
  }): Promise<TriggerOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t.timeoutMs);
    try {
      const response = await t.doFetch(`${t.baseUrl}/v1/runs/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t.triggerToken}`,
        },
        body: JSON.stringify({ ...input, trigger: "manual", chain: true }),
        signal: controller.signal,
      });
      if (response.status === CONFLICT) {
        const body = (await response.json().catch(() => null)) as {
          code?: unknown;
          details?: unknown;
        } | null;
        if (body?.code === "run_in_progress" && Array.isArray(body.details)) {
          return { ok: false, reason: "in-progress", runId: String(body.details[0] ?? "") };
        }
        return { ok: false, reason: "refused" };
      }
      if (!response.ok) {
        return { ok: false, reason: "refused" };
      }
      const started = (await response.json()) as { runId: string };
      return { ok: true, runId: started.runId };
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }

  return trigger;
}

export function createHttpWorkerClient(config: HttpWorkerConfig): WorkerClient {
  const doFetch = config.fetch ?? globalThis.fetch;
  const t: WorkerTransport = {
    doFetch: config.fetch ?? globalThis.fetch,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    baseUrl: config.baseUrl,
    triggerToken: config.triggerToken,
  };
  const post = postTo(t);
  const trigger = triggerOn(t);

  return {
    storeCredential: (input) => post("/v1/connections/credential", input),
    browseScope: (input) => post("/v1/connections/browse", input),
    revokeConnection: (input) => post("/v1/connections/revoke", input),
    triggerIngest: trigger,
    // The worker's own build deadline plus room for the rows; the default would cut a
    // build that is legitimately slow and report it as unreachable.
    buildModel: (input) => post("/v1/models/build", input, BUILD_DEADLINE_MS),
    dqFailures: (input) => post("/v1/dq/failures", input),
    runQuery: query,
    readSchema: (input) => post("/v1/queries/schema", input),
  };

  /**
   * The other call whose refusal body IS read: a 400 `query_failed` carries Postgres's
   * sentence about the author's SQL, which quotes the author's own text and nothing else,
   * and is the one thing that lets them fix it. Every other status is handled as `post`
   * handles it.
   */
  async function query(input: RunQueryRequest): Promise<WorkerOutcome<TableResult>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t.timeoutMs);
    try {
      const response = await doFetch(`${config.baseUrl}/v1/queries/run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.triggerToken}`,
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (response.status === BAD_REQUEST) {
        const body = (await response.json().catch(() => null)) as {
          code?: unknown;
          message?: unknown;
        } | null;
        if (body?.code === "query_failed" && typeof body.message === "string") {
          return { ok: false, reason: "query-failed", message: body.message };
        }
        return { ok: false, reason: "refused" };
      }
      if (!response.ok) {
        return { ok: false, reason: "refused" };
      }
      return { ok: true, value: (await response.json()) as TableResult };
    } catch {
      return { ok: false, reason: "unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
