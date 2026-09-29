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
  DropModelResponse,
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
  type InitialiseOutcome,
  initialiseRefusalOf,
  REFUSAL_BY_STATUS,
  type WorkerFailure,
} from "./workerRefusals.ts";
import {
  type Envelope,
  envelopeOf,
  exchange,
  type FetchLike,
  type WorkerTransport,
} from "./workerTransport.ts";

export type { InitialiseOutcome } from "./workerRefusals.ts";

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

/** A drop's extra answer: what reads from the model, named, so it can be dealt with. ADR 0077. */
export type DropOutcome =
  | { readonly ok: true; readonly value: DropModelResponse }
  | { readonly ok: false; readonly reason: "depended-on"; readonly dependents: readonly string[] }
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
  /** Draw a tenant's first catalogue of document kinds from a sample of its texts. ADR 0085. */
  initialiseDocumentKinds: (input: {
    tenantId: string;
    triggeredBy: string;
  }) => Promise<InitialiseOutcome>;
  /** Build one model and wait for it: the editor is looking. */
  buildModel: (input: {
    tenantId: string;
    model: string;
    triggeredBy: string;
  }) => Promise<WorkerOutcome<BuildModelResponse>>;
  /** Drop what a model built, before its row goes; drops nothing when it refuses. */
  dropModel: (input: { tenantId: string; model: string }) => Promise<DropOutcome>;
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

/**
 * One POST to the worker, with its refusals mapped onto `WorkerOutcome`. With a `schema` the
 * answer is parsed, not cast, so its defaults apply: `BrowseScopeResponse.partial` makes an
 * older worker's answer read as "whole" rather than as no answer. Unparseable is a refusal.
 */
function postTo(t: WorkerTransport): typeof post {
  function post<T>(
    path: string,
    body: unknown,
    options: PostOptions<T> = {},
  ): Promise<WorkerOutcome<T>> {
    const { schema, refusals = REFUSAL_BY_STATUS, deadlineMs = t.timeoutMs } = options;
    return exchange(t, { path, body, deadlineMs }, async (response): Promise<WorkerOutcome<T>> => {
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
    });
  }
  return post;
}

/**
 * Starting a run: the one call whose 409 body IS read, because `run_in_progress` carries the
 * running run's id in `details`, which is a run id and never a token.
 */
function triggerOn(t: WorkerTransport): typeof trigger {
  function trigger(input: Parameters<WorkerClient["triggerIngest"]>[0]): Promise<TriggerOutcome> {
    const body = { ...input, trigger: "manual", chain: true };
    return exchange(t, { path: "/v1/runs/ingest", body }, async (response) => {
      if (response.status === CONFLICT) {
        const refusal = await envelopeOf(response);
        if (refusal?.code === "run_in_progress" && Array.isArray(refusal.details)) {
          return { ok: false, reason: "in-progress", runId: String(refusal.details[0] ?? "") };
        }
        return { ok: false, reason: "refused" };
      }
      if (!response.ok) {
        return { ok: false, reason: "refused" };
      }
      const started = (await response.json()) as { runId: string };
      return { ok: true, runId: started.runId };
    });
  }
  return trigger;
}

/** Initialising a catalogue: its refusal body is read, as `initialiseRefusalOf` says why. */
function initialiseOn(t: WorkerTransport): WorkerClient["initialiseDocumentKinds"] {
  return (input) =>
    exchange(t, { path: "/v1/runs/semantic-init", body: input }, async (response) => {
      if (response.ok) {
        return { ok: true, runId: ((await response.json()) as { runId: string }).runId };
      }
      return initialiseRefusalOf(response.status, await envelopeOf(response));
    });
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
  function query(path: string, input: QueryInput): Promise<WorkerOutcome<TableResult>> {
    return exchange(t, { path, body: input }, async (response) => {
      if (response.status === BAD_REQUEST) {
        const refusal = await envelopeOf(response);
        if (refusal?.code === "query_failed" && typeof refusal.message === "string") {
          return { ok: false, reason: "query-failed", message: refusal.message };
        }
        return { ok: false, reason: "refused" };
      }
      if (!response.ok) {
        return { ok: false, reason: "refused" };
      }
      return { ok: true, value: (await response.json()) as TableResult };
    });
  }
  return query;
}

/**
 * The third call whose refusal body IS read: a 409 names a build in progress, or what reads from
 * the model -- the tenant's own model names, never a value.
 */
function dropOn(t: WorkerTransport): typeof drop {
  function drop(input: { tenantId: string; model: string }): Promise<DropOutcome> {
    return exchange(t, { path: "/v1/models/drop", body: input }, async (response) => {
      if (!response.ok) {
        return dropRefusalOf(response.status === CONFLICT ? await envelopeOf(response) : null);
      }
      const parsed = DropModelResponse.safeParse(await response.json());
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "refused" };
    });
  }
  return drop;
}

/** A refused drop, read from its envelope; a status that names nothing is a plain refusal. */
function dropRefusalOf(refusal: Envelope): DropOutcome {
  if (refusal?.code === "relation_depended_on" && Array.isArray(refusal.details)) {
    return { ok: false, reason: "depended-on", dependents: refusal.details.map(String) };
  }
  return { ok: false, reason: refusal?.code === "run_in_progress" ? "in-progress" : "refused" };
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
  const drop = dropOn(t);

  return {
    storeCredential: (input) => post("/v1/connections/credential", input),
    browseScope: (input) =>
      post("/v1/connections/browse", input, {
        schema: BrowseScopeResponse,
        refusals: BROWSE_REFUSALS,
      }),
    revokeConnection: (input) => post("/v1/connections/revoke", input),
    triggerIngest: trigger,
    initialiseDocumentKinds: initialiseOn(t),
    // The worker's own build deadline plus room for the rows; the default would cut a
    // build that is legitimately slow and report it as unreachable.
    buildModel: (input) => post("/v1/models/build", input, { deadlineMs: BUILD_DEADLINE_MS }),
    dropModel: drop,
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
