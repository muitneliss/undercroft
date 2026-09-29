/**
 * How the control plane reaches the worker: one POST, one deadline, one token.
 *
 * Apart from `workerClient.ts` so the verbs there read as what they send and what each refusal
 * means, and the mechanics of sending read once, here.
 */

/**
 * The part of `fetch` this client actually uses.
 *
 * Narrower than `typeof globalThis.fetch` on purpose: under Bun that type carries a
 * `preconnect` method, so a substitute would have to supply one that nothing here ever
 * calls. An injected seam should ask for what it uses and no more -- the platform's own
 * `fetch` still satisfies this.
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Where the worker is and how to reach it. Passed rather than closed over, so the request
 * helpers in `workerClient.ts` can live at module scope and be read on their own. */
export interface WorkerTransport {
  readonly doFetch: (input: string, init?: RequestInit) => Promise<Response>;
  readonly timeoutMs: number;
  readonly baseUrl: string;
  readonly triggerToken: string;
}

/**
 * One POST to the worker, bounded by a deadline, and `read`'s reading of the answer.
 *
 * The one place a request is sent, so every verb has the same deadline, the same token and
 * the same answer for a worker that never replied: `unreachable`, which is worth retrying,
 * rather than whatever `read` would have made of half an answer. `read` decides everything
 * else -- including whether a refusal's body may be read at all (see `postTo`).
 */
export async function exchange<T>(
  t: WorkerTransport,
  request: { readonly path: string; readonly body: unknown; readonly deadlineMs?: number },
  read: (response: Response) => Promise<T>,
): Promise<T | { ok: false; reason: "unreachable" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.deadlineMs ?? t.timeoutMs);
  try {
    const response = await t.doFetch(`${t.baseUrl}${request.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${t.triggerToken}` },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    return await read(response);
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** A refusal's envelope, for the few calls whose refusal names why. `null` when it has none. */
export type Envelope = { code?: unknown; message?: unknown; details?: unknown } | null;

export function envelopeOf(response: Response): Promise<Envelope> {
  return response.json().catch(() => null) as Promise<Envelope>;
}
