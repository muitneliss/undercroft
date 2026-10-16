/**
 * One POST to the worker, its refusals mapped onto `WorkerOutcome`: the shape of most verbs in
 * `workerClient.ts`, and of the reads in `workerQueries.ts`.
 *
 * Its own module so that both use the one mapping rather than a copy: which status names which
 * refusal is a contract (`workerRefusals.ts`), and a second spelling of it is a second place a
 * refusal could start reading the body it must never read.
 */

import type { WorkerOutcome } from "./workerClient.ts";
import { REFUSAL_BY_STATUS, type WorkerFailure } from "./workerRefusals.ts";
import { exchange, type WorkerTransport } from "./workerTransport.ts";

/** How one call is posted; `refusals` is which refusal each status names on that endpoint. */
export interface PostOptions<T> {
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
/** A POST as `postTo` builds one: to a path, with a body, its answer parsed or its refusal named. */
export type Post = <T>(
  path: string,
  body: unknown,
  options?: PostOptions<T>,
) => Promise<WorkerOutcome<T>>;

export function postTo(t: WorkerTransport): Post {
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
