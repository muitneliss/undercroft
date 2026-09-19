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

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

import type {
  BrowseScopeResponse,
  CredentialInput,
  RevokeConnectionResponse,
  StoreCredentialResponse,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";
import { upsertConnection } from "@undercroft/db/repos";

export type WorkerOutcome<T> = { ok: true; value: T } | { ok: false; reason: WorkerFailure };

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
export type WorkerFailure = "unreachable" | "refused" | "scope-insufficient";

export interface StoreCredentialInput {
  readonly source: string;
  readonly tenantId: string;
  readonly externalAccountId: string;
  readonly scope: string;
  readonly credential: CredentialInput;
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
    kind: "labels";
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

/** The worker's answer for a credential Google refused. Every other status is a refusal. */
const FORBIDDEN = 403;
/** The worker's answer for a run already in progress, whose body names it. */
const CONFLICT = 409;

export function createHttpWorkerClient(config: HttpWorkerConfig): WorkerClient {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function post<T>(path: string, body: unknown): Promise<WorkerOutcome<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.triggerToken}`,
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
  async function trigger(input: {
    source: string;
    tenantId: string;
    triggeredBy: string;
  }): Promise<TriggerOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${config.baseUrl}/v1/runs/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.triggerToken}`,
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

  return {
    storeCredential: (input) => post("/v1/connections/credential", input),
    browseScope: (input) => post("/v1/connections/browse", input),
    revokeConnection: (input) => post("/v1/connections/revoke", input),
    triggerIngest: trigger,
  };
}

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
  #labels: BrowseScopeResponse["items"] = [];
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

  withLabels(labels: BrowseScopeResponse["items"]): this {
    this.#labels = labels;
    return this;
  }

  async storeCredential(
    input: StoreCredentialInput,
  ): Promise<WorkerOutcome<StoreCredentialResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    this.stored.push(input);
    if (this.#exec !== null) {
      await upsertConnection(this.#exec, {
        tenantId: input.tenantId,
        source: input.source,
        status: "connected",
        externalAccountId: input.externalAccountId,
        scope: input.scope,
      });
    }
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

  browseScope(): Promise<WorkerOutcome<BrowseScopeResponse>> {
    if (this.#failWith !== null) {
      return this.#fail();
    }
    return Promise.resolve({ ok: true, value: { items: this.#labels } });
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

  #fail<T>(): Promise<WorkerOutcome<T>> {
    return Promise.resolve({ ok: false, reason: this.#failWith ?? "unreachable" });
  }
}
