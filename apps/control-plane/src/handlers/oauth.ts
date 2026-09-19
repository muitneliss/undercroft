/**
 * `GET /oauth/:provider/callback` — where a provider sends the browser back.
 *
 * A plain HTTP route rather than a tRPC procedure, because a provider cannot speak tRPC,
 * and **one** route per provider rather than per source: a provider matches `redirect_uri`
 * exactly, so carrying the source in the handshake row means two URIs to register (Google's
 * and Xero's) rather than one per source.
 *
 * Transport only. Every decision -- whether the state is live, whether the caller is still
 * an admin, whether the code is worth spending -- is in `services/oauth.ts`, and every write
 * is a repo call from there. What is left here is the HTTP meaning of each outcome, which is
 * this layer's business and nowhere else's.
 *
 * Every outcome is a redirect back into the SPA, never a JSON body. The person at the other
 * end of this request is a customer's administrator who has just clicked "Allow" in a
 * provider's dialog; a 403 carrying a code would be the end of their afternoon.
 *
 * Registration order is load-bearing, and `server.test.ts` asserts it: this must be
 * registered before the SPA catch-all, or the provider's redirect gets a 200 serving
 * `index.html` and the consent silently never completes -- the hazard `/api/auth/*` already
 * carries a comment about.
 */

import type { Hono } from "hono";

import { completeConsent, type CompleteDeps, type Provider } from "../services/oauth.ts";

export interface OAuthRouteDeps extends CompleteDeps {
  /** Resolves the signed-in caller from the request headers. */
  resolveCaller: (headers: Headers) => Promise<{ userId: string; email: string } | null>;
}

/** Where the browser lands when a consent worked: straight to choosing what to share. */
function scopePath(tenantId: string, source: string): string {
  return `/tenants/${encodeURIComponent(tenantId)}/connect/${encodeURIComponent(source)}/scope`;
}

function failurePath(
  tenantId: string | undefined,
  source: string | undefined,
  reason: string,
): string {
  const base = tenantId === undefined ? "/tenants" : `/tenants/${encodeURIComponent(tenantId)}`;
  const params = new URLSearchParams({ connect: "failed", reason });
  if (source !== undefined) {
    params.set("source", source);
  }
  return `${base}?${params.toString()}`;
}

function providerFrom(param: string): Provider | null {
  return param === "google" || param === "xero" ? param : null;
}

export function registerOAuthRoutes(app: Hono, deps: OAuthRouteDeps): void {
  app.get("/oauth/:provider/callback", async (c) => {
    const provider = providerFrom(c.req.param("provider"));
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code") ?? "";

    // A provider reports a refusal here too: the admin pressed Cancel. Not an error, and it
    // must not be dressed as one.
    const declined = c.req.query("error");
    if (declined !== undefined && declined !== "") {
      return c.redirect(failurePath(undefined, undefined, "declined"), 302);
    }
    if (provider === null || state === "" || code === "") {
      return c.redirect(failurePath(undefined, undefined, "bad-state"), 302);
    }

    const caller = await deps.resolveCaller(c.req.raw.headers);
    const outcome = await completeConsent(deps, {
      provider,
      state,
      code,
      caller: caller === null ? null : { userId: caller.userId, email: caller.email },
    });

    if (!outcome.ok) {
      return c.redirect(failurePath(outcome.tenantId, outcome.source, outcome.reason), 302);
    }
    return c.redirect(scopePath(outcome.tenantId, outcome.source), 302);
  });
}
