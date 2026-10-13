/**
 * Lift Bun's idle timeout for one request whose answer is long in coming on purpose.
 *
 * `Bun.serve` closes a connection that has sent nothing for `idleTimeout` seconds -- ten, the
 * default both servers keep, because a request that hangs is one that should be cut. Two kinds
 * of request are the exception, and each is bounded by something of its own instead:
 *
 * - An export (ADR 0111): its first rows can take minutes to compute and the rest arrive in
 *   bursts, and what bounds it is its worker's deadline. It lifts the timeout altogether (`0`).
 * - A procedure that waits on purpose (ADR 0124), such as `runs.get` with `waitSeconds`: it
 *   lifts the timeout to its own cap, so even a wait that went wrong is cut a little after it.
 *
 * Measured against Bun 1.4.2: a response that waits, and a stream that pauses, are both cut
 * near the timeout without this; with it, both pass. Bun's own limit is 255 seconds.
 *
 * `env` is what Hono hands a route as `c.env`, which under `Bun.serve` is the server. Anything
 * else -- a suite calling `app.request` -- has no idle timeout to lift and is left alone.
 */
export function liftIdleTimeout(env: unknown, request: Request, seconds = 0): void {
  if (typeof env !== "object" || env === null) {
    return;
  }
  const timeout: unknown = Reflect.get(env, "timeout");
  if (typeof timeout === "function") {
    // For this request alone; every other request keeps the default. `0` turns it off.
    Reflect.apply(timeout, env, [request, seconds]);
  }
}
