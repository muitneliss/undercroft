/**
 * The worker, in memory.
 *
 * Its own module because it is a TEST DOUBLE and the thing it stands in for is a socket: a
 * suite that wants one should not have to import the HTTP client to get it, and the HTTP
 * client should not grow because the double did.
 */

import {
  type BrowseListing,
  type BrowseScopeResponse,
  CSV_BOM,
  type ExportQueryRequest,
  type QueryAnswer,
  type RawSearchResponse,
  resultCsv,
  type RevokeConnectionResponse,
  type SchemaResponse,
  type StoreCredentialResponse,
  type TableResult,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { upsertConnection } from "@undercroft/db/repos";
import type {
  BuildInput,
  BuildOutcome,
  DropOutcome,
  QueryInput,
  SearchInput,
  StoreCredentialInput,
  InitialiseOutcome,
  TriggerOutcome,
  WorkerClient,
  WorkerOutcome,
} from "./workerClient.ts";
import { InMemoryBuilds } from "./inMemoryBuilds.ts";
import type { WorkerFailure } from "./workerRefusals.ts";

/**
 * A worker that answers from memory.
 *
 * A real implementation of the seam, not a mock: it records what it was asked and refuses
 * anything it was not set up for, so a flow that called the wrong verb fails loudly instead
 * of passing on a default.
 */
export class InMemoryWorkerClient implements WorkerClient {
  readonly stored: StoreCredentialInput[] = [];
  readonly revoked: { source: string; tenantId: string }[] = [];
  readonly triggered: { source: string; tenantId: string; triggeredBy: string }[] = [];
  /** The builds this double ran, and what a waited one answers (`inMemoryBuilds.ts`). */
  readonly builds = new InMemoryBuilds();
  /** Every catalogue this double was asked to initialise, and did. */
  readonly initialised: { tenantId: string; triggeredBy: string }[] = [];
  #catalogueExists = false;
  /** Every model and seed whose relations this double was asked to drop, and did, in order. */
  readonly dropped: ({ tenantId: string; model: string } | { tenantId: string; seed: string })[] =
    [];
  /** Which listing each browse asked for: the one fact about a browse only its caller decides. */
  readonly browsed: { source: string; tenantId: string; kind: BrowseListing }[] = [];
  #choices: BrowseScopeResponse = { items: [], partial: [] };
  #schema: SchemaResponse = { tables: [] };
  #failWith: WorkerFailure | null = null;
  #runningAs: string | null = null;
  #dependents: readonly string[] = [];
  #exec: SqlExecutor | null = null;

  /** Refuse to initialise, as the worker does for a tenant that already has a catalogue. */
  catalogueExists(): this {
    this.#catalogueExists = true;
    return this;
  }

  /** Answer every trigger and build with "already running as `runId`", the worker's 409. */
  runningAs(runId: string): this {
    this.#runningAs = runId;
    return this;
  }

  /**
   * Honour the side effect the real worker has: a stored credential leaves a connected
   * `ops.connection` row behind.
   *
   * Not decoration. `app.connection_detail` has a foreign key to that row, so a caller that
   * writes an account label after a successful store depends on it existing. A fake that
   * skipped it would make the callback pass here and fail against the real worker -- which
   * is the failure mode `.claude/rules/tests.md` means by "a fake that never refuses makes a
   * broken boundary look fine".
   */
  backedBy(exec: SqlExecutor): this {
    this.#exec = exec;
    return this;
  }

  /** Make every call fail, to exercise the caller's failure path. */
  failing(reason: WorkerFailure): this {
    this.#failWith = reason;
    return this;
  }

  /** What every schema read answers, the analytics and the raw console's alike. */
  withSchema(schema: SchemaResponse): this {
    this.#schema = schema;
    return this;
  }

  /** What every browse answers: labels, organisations, or Drive's folders and file types. */
  withChoices(choices: BrowseScopeResponse): this {
    this.#choices = choices;
    return this;
  }

  async storeCredential(
    input: StoreCredentialInput,
  ): Promise<WorkerOutcome<StoreCredentialResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    if (this.#exec !== null) {
      // The worker's own guard, run for real: a connection pinned to another account refuses,
      // and nothing is recorded as stored. A fake that sealed it anyway would be the fake that
      // never refuses, over the one refusal this flow exists to make. ADR 0043.
      const recorded = await upsertConnection(this.#exec, {
        tenantId: input.tenantId,
        source: input.source,
        status: "connected",
        externalAccountId: input.externalAccountId,
        scope: input.scope,
      });
      if (!recorded) {
        return { ok: false, reason: "account-mismatch" };
      }
    }
    this.stored.push(input);
    return Promise.resolve({
      ok: true,
      value: {
        tenantId: input.tenantId,
        source: input.source,
        status: "connected",
        expiresAt: input.credential.expiresAt,
      },
    });
  }

  browseScope(input: {
    source: string;
    tenantId: string;
    kind: BrowseListing;
  }): Promise<WorkerOutcome<BrowseScopeResponse>> {
    this.browsed.push(input);
    return this.#unlessFailing(this.#choices);
  }

  revokeConnection(input: {
    source: string;
    tenantId: string;
  }): Promise<WorkerOutcome<RevokeConnectionResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.revoked.push(input);
    return Promise.resolve({ ok: true, value: { revokedUpstream: true } });
  }

  initialiseDocumentKinds(input: {
    tenantId: string;
    triggeredBy: string;
  }): Promise<InitialiseOutcome> {
    if (this.#failWith !== null) {
      return Promise.resolve({ ok: false, reason: this.#failWith });
    }
    if (this.#runningAs !== null) {
      return Promise.resolve({ ok: false, reason: "in-progress", runId: this.#runningAs });
    }
    if (this.#catalogueExists) {
      return Promise.resolve({ ok: false, reason: "exists" });
    }
    this.initialised.push(input);
    return Promise.resolve({ ok: true, runId: `run-init-${String(this.initialised.length)}` });
  }

  triggerIngest(input: {
    source: string;
    tenantId: string;
    triggeredBy: string;
  }): Promise<TriggerOutcome> {
    if (this.#failWith !== null) {
      return Promise.resolve({ ok: false, reason: this.#failWith });
    }
    if (this.#runningAs !== null) {
      return Promise.resolve({ ok: false, reason: "in-progress", runId: this.#runningAs });
    }
    this.triggered.push(input);
    return Promise.resolve({ ok: true, runId: `run-mem-${String(this.triggered.length)}` });
  }

  /**
   * A build: refused when `failing` says so; refused as running when `runningAs` says so, naming
   * that run as the worker's 409 does (`failing("in-progress")` names none); and otherwise run
   * by `builds`, which keeps what it was asked and answers with what it was given.
   */
  buildModels(input: BuildInput): Promise<BuildOutcome> {
    const failure = this.#failWith;
    if (failure !== null && failure !== "in-progress") {
      return Promise.resolve({ ok: false, reason: failure });
    }
    const held = failure === "in-progress" ? "" : this.#runningAs;
    if (held !== null) {
      return Promise.resolve({ ok: false, reason: "in-progress", runId: held });
    }
    return Promise.resolve(this.builds.run(input));
  }

  /** Refuse every drop because these relations read from the model, as the worker's 409 does. */
  dependedOnBy(dependents: readonly string[]): this {
    this.#dependents = dependents;
    return this;
  }

  dropModel(input: { tenantId: string; model: string }): Promise<DropOutcome> {
    return this.#drop(input);
  }

  dropSeed(input: { tenantId: string; seed: string }): Promise<DropOutcome> {
    return this.#drop(input);
  }

  // Drop nothing and say so: dropped, refused naming dependents, or not reached. What the worker
  // drops is proven against a real catalogue (`apps/worker/src/handlers/models.test.ts`).
  #drop(input: InMemoryWorkerClient["dropped"][number]): Promise<DropOutcome> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    if (this.#dependents.length > 0) {
      return Promise.resolve({ ok: false, reason: "depended-on", dependents: this.#dependents });
    }
    this.dropped.push(input);
    return Promise.resolve({ ok: true, value: { dropped: [] } });
  }

  dqFailures(): Promise<WorkerOutcome<TableResult>> {
    return this.#unlessFailing({ columns: [], rows: [], truncated: false });
  }

  /** Every query this double was asked to run, in order. */
  readonly queries: QueryInput[] = [];
  /** Every search it was asked, in order. */
  readonly searches: SearchInput[] = [];
  #answer: QueryAnswer = { columns: [], rows: [], truncated: false };
  /** Nothing found, which is a real answer rather than an absent one. */
  #found: RawSearchResponse = { hits: [], truncated: false, capped: [] };
  #refusal: string | null = null;

  /**
   * Answer every query with `result`, and with the tables its plan read when `relations` is
   * given -- which the real worker reads from Postgres's plan (`runFramedWithRelations`).
   */
  answering(result: QueryAnswer): this {
    this.#answer = result;
    return this;
  }

  /** Refuse every query with Postgres's sentence, as the real worker would for bad SQL. */
  refusingQueries(message: string): this {
    this.#refusal = message;
    return this;
  }

  runQuery(input: QueryInput): Promise<WorkerOutcome<QueryAnswer>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.queries.push(input);
    if (this.#refusal !== null) {
      return Promise.resolve({ ok: false, reason: "query-failed", message: this.#refusal });
    }
    return Promise.resolve({ ok: true, value: this.#answer });
  }

  /** Every export this double was asked to stream, in order. */
  readonly exports: ExportQueryRequest[] = [];

  /**
   * Stream the answer `answering` was given as the real worker streams one -- the shared CSV
   * encoder, its byte-order mark first -- or refuse as it refuses bad SQL.
   */
  exportQuery(input: ExportQueryRequest): Promise<WorkerOutcome<ReadableStream<Uint8Array>>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.exports.push(input);
    if (this.#refusal !== null) {
      return Promise.resolve({ ok: false, reason: "query-failed", message: this.#refusal });
    }
    const csv = new TextEncoder().encode(CSV_BOM + resultCsv(this.#answer));
    return Promise.resolve({ ok: true, value: new Response(csv).body ?? new ReadableStream() });
  }

  readSchema(): Promise<WorkerOutcome<SchemaResponse>> {
    return this.#unlessFailing(this.#schema);
  }

  /**
   * The raw console answers exactly as the dashboard runner does here.
   *
   * Deliberately the same recorded list and the same canned answer: this fake exists to let
   * a caller's OWN decisions be tested -- who is admitted, what is recorded, what a refusal
   * becomes on screen -- and which Postgres login the real worker used is not a thing a fake
   * can honestly model. The login boundary is proven where it lives, against real Postgres
   * in `privileges.test.ts`.
   */
  runRawQuery(input: QueryInput): Promise<WorkerOutcome<TableResult>> {
    return this.runQuery(input);
  }

  readRawSchema(): Promise<WorkerOutcome<SchemaResponse>> {
    return this.readSchema();
  }

  /**
   * Records the question and answers with whatever `answersSearchWith` was given.
   *
   * Like `runRawQuery`, this fake models the CALLER's decisions -- who is admitted, what is
   * recorded, what a refusal becomes on screen -- and not the matching, which is Postgres's and
   * is proven against it in `packages/db/src/rawSearch.test.ts`. A fake that pretended to fold
   * Vietnamese would be a second, quietly different answer to what the reader asked.
   */
  searchRaw(input: SearchInput): Promise<WorkerOutcome<RawSearchResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.searches.push(input);
    return Promise.resolve({ ok: true, value: this.#found });
  }

  /** What the next search answers with. Defaults to nothing found, which is a real answer. */
  answersSearchWith(found: RawSearchResponse): this {
    this.#found = found;
    return this;
  }

  /** `value`, unless this double was told to fail every call. */
  #unlessFailing<T>(value: T): Promise<WorkerOutcome<T>> {
    return this.#failWith === null ? Promise.resolve({ ok: true, value }) : this.#fail();
  }

  #fail<T>(): Promise<WorkerOutcome<T>> {
    return Promise.resolve({ ok: false, reason: this.#failWith ?? "unreachable" });
  }
}
