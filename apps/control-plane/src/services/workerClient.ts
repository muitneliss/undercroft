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

import {
  type BrowseListing,
  BrowseScopeResponse,
  type BuildModelResponse,
  type CredentialInput,
  type DqFailuresRequest,
  type RawSearchRequest,
  type RawSearchResponse,
  type RevokeConnectionResponse,
  type RunQueryRequest,
  type SchemaResponse,
  type SearchKind,
  type StoreCredentialResponse,
  type TableResult,
} from "@undercroft/contracts";
import { traced } from "@undercroft/telemetry";

import {
  BAD_REQUEST,
  BROWSE_REFUSALS,
  CONFLICT,
  REFUSAL_BY_STATUS,
  type WorkerFailure,
} from "./workerRefusals.ts";

/**
 * What a caller sends to run a query.
 *
 * `offset` is optional HERE and required on `RunQueryRequest`, because the schema's default
 * applies when the worker parses the body -- a caller that does not page should not have to
 * say `offset: 0` to mean "from the beginning".
 */
export type QueryInput = Omit<RunQueryRequest, "offset"> & { readonly offset?: number };

export type WorkerOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: WorkerFailure;
      /** The worker's own sentence, for the one refusal an author can act on: a failed query. */
      message?: string;
    };

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
    kind: BrowseListing;
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
  runQuery: (input: QueryInput) => Promise<WorkerOutcome<TableResult>>;
  /** The tenant's analytics schema, as that login sees it. */
  readSchema: (input: { tenantId: string }) => Promise<WorkerOutcome<SchemaResponse>>;
  /** One SELECT over the RAW lake, as the tenant's dbt login. Admin-only at the caller. */
  runRawQuery: (input: QueryInput) => Promise<WorkerOutcome<TableResult>>;
  /** The `raw` schema's tables and columns, for the console's sidebar. */
  readRawSchema: (input: { tenantId: string }) => Promise<WorkerOutcome<SchemaResponse>>;
  /**
   * One question over the whole raw lake, as that same dbt login. Admin-only at the caller.
   *
   * Here rather than in the control plane's own repos because of which login answers it: the
   * control plane is deliberately denied the `text` column of `raw.document_text`, and this
   * feature does not change that by a column. ADR 0026.
   */
  searchRaw: (input: SearchInput) => Promise<WorkerOutcome<RawSearchResponse>>;
}

/**
 * What a caller sends to search.
 *
 * `kinds`, `limit` and `offset` are optional HERE and required on `RawSearchRequest`, for the
 * reason `QueryInput` gives: the schema's defaults apply when the worker parses the body, and a
 * caller who wants the whole lake should not have to spell out that it wants both halves.
 */
export type SearchInput = Omit<RawSearchRequest, "kinds" | "limit" | "offset"> & {
  readonly kinds?: readonly SearchKind[];
  readonly limit?: number;
  readonly offset?: number;
};

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

/** How one call is posted; `refusals` is which refusal each status names on that endpoint. */
interface PostOptions<T> {
  readonly deadlineMs?: number;
  readonly schema?: {
    safeParse: (raw: unknown) => { success: true; data: T } | { success: false };
  };
  readonly refusals?: ReadonlyMap<number, WorkerFailure>;
}

/** Where the worker is and how to reach it. Passed rather than closed over, so the two
 * request helpers below can live at module scope and be read on their own. */
interface WorkerTransport {
  readonly doFetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs: number;
  readonly baseUrl: string;
  readonly triggerToken: string;
}

/**
 * One POST to the worker, with its refusals mapped onto `WorkerOutcome`. With a `schema` the
 * answer is parsed, not cast, so its defaults apply: `BrowseScopeResponse.partial` makes an
 * older worker's answer read as "whole" rather than as no answer. Unparseable is a refusal.
 */
function postTo(t: WorkerTransport): typeof post {
  async function post<T>(
    path: string,
    body: unknown,
    options: PostOptions<T> = {},
  ): Promise<WorkerOutcome<T>> {
    const { schema, refusals = REFUSAL_BY_STATUS } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.deadlineMs ?? t.timeoutMs);
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
        return { ok: false, reason: refusals.get(response.status) ?? "refused" };
      }
      const raw: unknown = await response.json();
      const parsed = schema?.safeParse(raw) ?? { success: true as const, data: raw as T };
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "refused" };
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

/**
 * The other call whose refusal body IS read: a 400 `query_failed` carries Postgres's sentence
 * about the author's SQL, which quotes the author's own text and nothing else, and is the one
 * thing that lets them fix it. Every other status is handled as `post` handles it.
 *
 * At module scope beside `postTo` and `triggerOn`, for the reason `WorkerTransport`'s own
 * docstring gives about those two: a request helper that can be read on its own is one a
 * reviewer can check against the endpoint it calls.
 */
function queryOn(t: WorkerTransport): typeof query {
  async function query(path: string, input: QueryInput): Promise<WorkerOutcome<TableResult>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t.timeoutMs);
    try {
      const response = await t.doFetch(`${t.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${t.triggerToken}`,
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
  return query;
}

export function createHttpWorkerClient(config: HttpWorkerConfig): WorkerClient {
  const t: WorkerTransport = {
    // Carrying this request's `traceparent`, so the worker's span joins the same trace.
    doFetch: traced(config.fetch ?? globalThis.fetch),
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    baseUrl: config.baseUrl,
    triggerToken: config.triggerToken,
  };
  const post = postTo(t);
  const trigger = triggerOn(t);
  const query = queryOn(t);

  return {
    storeCredential: (input) => post("/v1/connections/credential", input),
    browseScope: (input) =>
      post("/v1/connections/browse", input, {
        schema: BrowseScopeResponse,
        refusals: BROWSE_REFUSALS,
      }),
    revokeConnection: (input) => post("/v1/connections/revoke", input),
    triggerIngest: trigger,
    // The worker's own build deadline plus room for the rows; the default would cut a
    // build that is legitimately slow and report it as unreachable.
    buildModel: (input) => post("/v1/models/build", input, { deadlineMs: BUILD_DEADLINE_MS }),
    dqFailures: (input) => post("/v1/dq/failures", input),
    runQuery: (input) => query("/v1/queries/run", input),
    readSchema: (input) => post("/v1/queries/schema", input),
    // The raw lake's console. Same refusal handling, different login at the far end: the
    // worker answers this one as the tenant's dbt role, which is the only one that may read
    // `raw` at all. See `queryRunner.runRawQuery`.
    runRawQuery: (input) => query("/v1/queries/raw/run", input),
    readRawSchema: (input) => post("/v1/queries/raw/schema", input),
    // Plain `post`, not `query`: there is no author's SQL here to quote back, so there is no
    // refusal body worth reading. A search that did not run is a refusal like any other.
    searchRaw: (input) => post("/v1/queries/raw/search", input),
  };
}
