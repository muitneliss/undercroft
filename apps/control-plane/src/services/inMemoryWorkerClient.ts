/**
 * The worker, in memory.
 *
 * Its own module because it is a TEST DOUBLE and the thing it stands in for is a socket: a
 * suite that wants one should not have to import the HTTP client to get it, and the HTTP
 * client should not grow because the double did.
 */

import type {
  BrowseListing,
  BrowseScopeResponse,
  BuildModelResponse,
  RawSearchResponse,
  RevokeConnectionResponse,
  SchemaResponse,
  StoreCredentialResponse,
  TableResult,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { upsertConnection } from "@undercroft/db/repos";
import type {
  QueryInput,
  SearchInput,
  StoreCredentialInput,
  TriggerOutcome,
  WorkerClient,
  WorkerOutcome,
} from "./workerClient.ts";
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
  readonly built: { tenantId: string; model: string; triggeredBy: string }[] = [];
  /** Which listing each browse asked for: the one fact about a browse only its caller decides. */
  readonly browsed: { source: string; tenantId: string; kind: BrowseListing }[] = [];
  #choices: BrowseScopeResponse = { items: [], partial: [] };
  #failWith: WorkerFailure | null = null;
  #runningAs: string | null = null;
  #exec: SqlExecutor | null = null;

  /** Answer every trigger with "already running as `runId`", the worker's 409. */
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
    if (this.#failWith !== null) {
      return this.#fail();
    }
    return Promise.resolve({ ok: true, value: this.#choices });
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

  /** A build that succeeded with nothing to show: no steps, an empty relation. */
  buildModel(input: {
    tenantId: string;
    model: string;
    triggeredBy: string;
  }): Promise<WorkerOutcome<BuildModelResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.built.push(input);
    return Promise.resolve({
      ok: true,
      value: {
        runId: `run-mem-build-${String(this.built.length)}`,
        ok: true,
        testsFailed: 0,
        error: null,
        steps: [],
        preview: { columns: [], rows: [], truncated: false },
      },
    });
  }

  dqFailures(): Promise<WorkerOutcome<TableResult>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    return Promise.resolve({ ok: true, value: { columns: [], rows: [], truncated: false } });
  }

  /** Every query this double was asked to run, in order. */
  readonly queries: QueryInput[] = [];
  /** Every search it was asked, in order. */
  readonly searches: SearchInput[] = [];
  #answer: TableResult = { columns: [], rows: [], truncated: false };
  /** Nothing found, which is a real answer rather than an absent one. */
  #found: RawSearchResponse = { hits: [], truncated: false };
  #refusal: string | null = null;

  /** Answer every query with `result`. */
  answering(result: TableResult): this {
    this.#answer = result;
    return this;
  }

  /** Refuse every query with Postgres's sentence, as the real worker would for bad SQL. */
  refusingQueries(message: string): this {
    this.#refusal = message;
    return this;
  }

  runQuery(input: QueryInput): Promise<WorkerOutcome<TableResult>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.queries.push(input);
    if (this.#refusal !== null) {
      return Promise.resolve({ ok: false, reason: "query-failed", message: this.#refusal });
    }
    return Promise.resolve({ ok: true, value: this.#answer });
  }

  readSchema(): Promise<WorkerOutcome<SchemaResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    return Promise.resolve({ ok: true, value: { tables: [] } });
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

  #fail<T>(): Promise<WorkerOutcome<T>> {
    return Promise.resolve({ ok: false, reason: this.#failWith ?? "unreachable" });
  }
}
