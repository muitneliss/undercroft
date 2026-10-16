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
  type CredentialInput,
  type DqFailuresRequest,
  DropModelResponse,
  type ExportQueryRequest,
  type ModelPreview,
  type PreviewModelRequest,
  type QueryAnswer,
  type QueryScope,
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
  BROWSE_REFUSALS,
  CONFLICT,
  type InitialiseOutcome,
  initialiseRefusalOf,
  type WorkerFailure,
} from "./workerRefusals.ts";
import { type BuildInput, type BuildOutcome, buildOn } from "./workerBuild.ts";
import { exportOn } from "./workerExport.ts";
import { postTo } from "./workerPost.ts";
import { previewOn } from "./workerPreview.ts";
import { queriesOn } from "./workerQueries.ts";
import {
  type Envelope,
  envelopeOf,
  exchange,
  type FetchLike,
  type WorkerTransport,
} from "./workerTransport.ts";

export type { BuildAnswer, BuildInput, BuildOutcome } from "./workerBuild.ts";
export type { InitialiseOutcome } from "./workerRefusals.ts";

/**
 * What a caller sends to run a query.
 *
 * `offset` is optional HERE and required on `RunQueryRequest`, because the schema's default
 * applies when the worker parses the body -- a caller that does not page should not have to
 * say `offset: 0` to mean "from the beginning".
 */
export type QueryInput = Omit<RunQueryRequest, "offset"> & { readonly offset?: number };

/**
 * A report's query: a `QueryInput` and the scope it reads under (ADR 0142) -- `null` for the
 * customer's BI login, which reads every model; otherwise the models the reader reaches, which
 * the worker reads as the scope login for exactly those. Required, so every caller decides; it is
 * sent to a route of its own (`ScopedRunQueryRequest` says why).
 */
export type ReportQueryInput = QueryInput & { readonly scope: QueryScope | null };

/** An export, under the scope of the reader who downloads it, for the reason a query has one. */
export type ExportInput = ExportQueryRequest & { readonly scope: QueryScope | null };

export type WorkerOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: WorkerFailure;
      /**
       * The worker's own sentence, for the refusals an author can act on: a failed query, and a
       * model preview dbt would not compile.
       */
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
  /** Build some models as one run, and wait for it unless asked not to. */
  buildModels: (input: BuildInput) => Promise<BuildOutcome>;
  /** Drop what a model built, before its row goes; drops nothing when it refuses. */
  dropModel: (input: { tenantId: string; model: string }) => Promise<DropOutcome>;
  /** Drop the table a seed's loads made, before its row goes, as `dropModel` does (ADR 0128). */
  dropSeed: (input: { tenantId: string; seed: string }) => Promise<DropOutcome>;
  /** The rows a failed test stored, as the worker reads them for an admin. */
  dqFailures: (input: DqFailuresRequest) => Promise<WorkerOutcome<TableResult>>;
  /**
   * SQL an author wrote, run as the tenant's read-only login -- or its scope login for the
   * reader's models -- with the tables its plan read.
   */
  runQuery: (input: ReportQueryInput) => Promise<WorkerOutcome<QueryAnswer>>;
  /** Every row of that SQL as a CSV stream, as the same login (`workerExport.ts`, ADR 0111). */
  exportQuery: (input: ExportInput) => Promise<WorkerOutcome<ReadableStream<Uint8Array>>>;
  /** The tenant's analytics schema, as that login -- or the reader's scope login -- sees it. */
  readSchema: (input: {
    tenantId: string;
    scope: QueryScope | null;
  }) => Promise<WorkerOutcome<SchemaResponse>>;
  /** One SELECT over the RAW lake, as the tenant's dbt login. Admin-only at the caller. */
  runRawQuery: (input: QueryInput) => Promise<WorkerOutcome<TableResult>>;
  /** The `raw` schema's tables and columns, for the console's sidebar. */
  readRawSchema: (input: { tenantId: string }) => Promise<WorkerOutcome<SchemaResponse>>;
  /**
   * What an unsaved model returns: compiled by dbt in the tenant's project, run in the read-only
   * frame as its dbt login (`workerPreview.ts`, ADR 0132). Admin-only at the caller.
   */
  previewModel: (input: PreviewModelRequest) => Promise<WorkerOutcome<ModelPreview>>;
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
  /**
   * The raw streams the reader reaches, a whole source where `entity` is `null` (ADR 0142), or
   * `null` for a reader who reaches the whole lake. Required, so every caller decides.
   */
  readonly streams: readonly { readonly source: string; readonly entity: string | null }[] | null;
};

export interface HttpWorkerConfig {
  readonly baseUrl: string;
  readonly triggerToken: string;
  /** Injected in tests. The process uses the platform's `fetch`. */
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
 * The third call whose refusal body IS read: a 409 names a build in progress, or what reads from
 * the model -- the tenant's own model names, never a value.
 */
/**
 * A drop at `path`: a model's or a seed's, which the worker answers the same way. A worker older
 * than the seed route answers 404, which is a refusal, so nothing is deleted.
 */
function dropOn<Body extends { tenantId: string }>(
  t: WorkerTransport,
  path: string,
): (input: Body) => Promise<DropOutcome> {
  return (input) =>
    exchange(t, { path, body: input }, async (response) => {
      if (!response.ok) {
        return dropRefusalOf(response.status === CONFLICT ? await envelopeOf(response) : null);
      }
      const parsed = DropModelResponse.safeParse(await response.json());
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: "refused" };
    });
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
    // Its own module: the worker's build deadline, and a refusal whose body is read.
    buildModels: buildOn(t),
    dropModel: dropOn(t, "/v1/models/drop"),
    dropSeed: dropOn(t, "/v1/seeds/drop"),
    dqFailures: (input) => post("/v1/dq/failures", input),
    exportQuery: exportOn(t),
    // Its own module: the preview's deadline, and two refusals whose body is read.
    previewModel: previewOn(t),
    // Its own module: the routes a read takes by what its reader may read (ADR 0142).
    ...queriesOn(t),
  };
}
