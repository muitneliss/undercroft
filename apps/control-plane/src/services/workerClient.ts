/**
 * The control plane's one channel to the worker.
 *
 * The control plane cannot seal a credential: it has no `UNDERCROFT_SECRET_KEY`, and that
 * absence is the security property, not an oversight. It CAN run the browser half of a
 * consent, because Google's redirect must land on a public origin and the worker has none.
 * So the token bundle crosses one internal hop, on the same trigger-token allowlist Kestra
 * uses, and the internet-facing service keeps the property that it can never read a stored
 * credential back. ADR 0014.
 *
 * A capability, not a config bag. `main.ts` builds one of these from env and injects it;
 * nothing below the entrypoint knows a URL or a token exists, and a test substitutes
 * `InMemoryWorkerClient` without a socket.
 */

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
 * Why a call did not succeed, in the two shapes a caller acts on differently.
 *
 * `unreachable` is worth retrying and means the worker is down; `refused` means the worker
 * answered and said no, which retrying will not fix. Collapsing them would make a
 * misconfigured tenant look like an outage.
 */
export type WorkerFailure = "unreachable" | "refused";

export interface StoreCredentialInput {
  readonly source: string;
  readonly tenantId: string;
  readonly externalAccountId: string;
  readonly scope: string;
  readonly credential: CredentialInput;
}

export interface WorkerClient {
  storeCredential(input: StoreCredentialInput): Promise<WorkerOutcome<StoreCredentialResponse>>;
  browseScope(input: {
    source: string;
    tenantId: string;
    kind: "labels";
  }): Promise<WorkerOutcome<BrowseScopeResponse>>;
  revokeConnection(input: {
    source: string;
    tenantId: string;
  }): Promise<WorkerOutcome<RevokeConnectionResponse>>;
}

export interface HttpWorkerConfig {
  readonly baseUrl: string;
  readonly triggerToken: string;
  /** Injected in tests. The process uses the platform's `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
        // not where that belongs.
        return { ok: false, reason: "refused" };
      }
      return { ok: true, value: (await response.json()) as T };
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
  #labels: { id: string; name: string }[] = [];
  #failWith: WorkerFailure | null = null;
  #exec: SqlExecutor | null = null;

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

  withLabels(labels: { id: string; name: string }[]): this {
    this.#labels = labels;
    return this;
  }

  async storeCredential(
    input: StoreCredentialInput,
  ): Promise<WorkerOutcome<StoreCredentialResponse>> {
    if (this.#failWith !== null) return this.#fail();
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
    if (this.#failWith !== null) return this.#fail();
    return Promise.resolve({ ok: true, value: { items: this.#labels } });
  }

  revokeConnection(input: {
    source: string;
    tenantId: string;
  }): Promise<WorkerOutcome<RevokeConnectionResponse>> {
    if (this.#failWith !== null) return this.#fail();
    this.revoked.push(input);
    return Promise.resolve({ ok: true, value: { revokedUpstream: true } });
  }

  #fail<T>(): Promise<WorkerOutcome<T>> {
    return Promise.resolve({ ok: false, reason: this.#failWith ?? "unreachable" });
  }
}
