/**
 * How a door lets a procedure hold its request open (ADR 0124): the half of `Context.holdOpen`
 * that knows the transport.
 *
 * Bun cuts a request that has sent nothing for ten seconds. A procedure that waits on purpose
 * declares how long it may (`ProcedureMeta.holdsOpenSeconds`), the router's root middleware asks
 * the context to hold the request that long, and the context does it through one of these --
 * built by the door, which is the only code that holds the request and the server answering it.
 * So no procedure, service or middleware reaches Bun.
 *
 * A context holds nothing until its door says so (`createContext` builds it holding nothing):
 * `/trpc` and `/mcp` replace that with `holdFor` their request, and `holdOpen.test.ts` proves
 * both do over a real socket. Not holding is the safe default -- it is what every other request
 * already gets -- and it is what the assistant keeps, whose catalogue gives its model no
 * `waitSeconds` to pass.
 */

import { liftIdleTimeout } from "@undercroft/core";
import type { Context } from "./trpc.ts";

/** What a procedure declares about itself to the router's middleware (`trpc.ts`). */
export interface ProcedureMeta {
  /**
   * The longest, in seconds, this procedure may keep its request open before it answers: its own
   * bound on a wait, plus the time to answer after it. Declaring it lifts Bun's idle timeout to it
   * for that request alone, at every door, so the procedure's own cap is what bounds it. Bun takes
   * at most 255. A procedure that does not wait on purpose declares none, and a request of it that
   * hangs is cut at ten seconds, as it should be.
   */
  readonly holdsOpenSeconds?: number;
}

/**
 * The hold for a request `Bun.serve` is answering: Hono's `c.env` is the server, and lifting the
 * idle timeout is a call on it about this request alone. `/trpc` and `/mcp` build their contexts
 * with one, so a wait holds at both.
 */
export function holdFor(env: unknown, request: Request): Context["holdOpen"] {
  return (seconds) => liftIdleTimeout(env, request, seconds);
}
