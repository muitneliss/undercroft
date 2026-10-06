/**
 * Lift Bun's idle timeout for the one request whose answer is a long stream.
 *
 * `Bun.serve` closes a connection that has sent nothing for `idleTimeout` seconds -- ten, the
 * default both servers keep, because a request that hangs is one that should be cut. An export
 * is the exception (ADR 0111): its first rows can take minutes to compute and the rest arrive in
 * bursts, and what bounds it is its own deadline. Measured against Bun 1.4.2: a response that
 * waits, and a stream that pauses, are both cut at ten seconds without this; with it, both pass.
 *
 * `env` is what Hono hands a route as `c.env`, which under `Bun.serve` is the server. Anything
 * else -- a suite calling `app.request` -- has no idle timeout to lift and is left alone.
 */
export function liftIdleTimeout(env: unknown, request: Request): void {
  if (typeof env !== "object" || env === null) {
    return;
  }
  const timeout: unknown = Reflect.get(env, "timeout");
  if (typeof timeout === "function") {
    // `0` turns the timeout off for this request alone; every other request keeps the default.
    Reflect.apply(timeout, env, [request, 0]);
  }
}
