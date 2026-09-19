/**
 * The connection verbs, for the control plane's OAuth flow.
 *
 * **Service token only, deliberately.** `authenticate()` is not called here, unlike
 * `/v1/lake/records`: an ingest key is a per-tenant grant to LAND data, and accepting one to
 * mint or destroy a credential would quietly widen every key ever issued into a
 * credential-management capability.
 */

import {
  BrowseScopeRequest,
  RevokeConnectionRequest,
  StoreCredentialRequest,
} from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";
import type { Hono } from "hono";
import { browseScope, revokeConnection, storeCredential } from "../services/connections.ts";
import { serviceTokenOk, tokenFor, UNAUTHENTICATED } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

export function registerConnectionRoutes(app: Hono, deps: LakeApiDeps): void {
  /**
   * The connection verbs, for the control plane's OAuth flow.
   *
   * **Service token only, deliberately.** `authenticate()` is not called here, unlike
   * `/v1/lake/records`: an ingest key is a per-tenant grant to LAND data, and accepting one
   * to mint or destroy a credential would quietly widen every key ever issued into a
   * credential-management capability.
   */

  registerConnectionsCredentialRoute(app, deps);
  registerConnectionsBrowseRoute(app, deps);
  registerConnectionsRevokeRoute(app, deps);
}

/**
 * What a refused credential means over HTTP.
 *
 * Three different answers, deliberately: a provider that rejected the token is a 400 the
 * admin can act on, a provider we could not reach is a 502 that says try again, and anything
 * else is a plain invalid request. Collapsing them would tell an operator to re-paste a token
 * that was fine.
 */
/**
 * What a refused credential means over HTTP.
 *
 * Three refusals, three statuses, because the remedies differ: a token the provider turned
 * away is a 422 (the body was well-formed and wrong), a source nobody can probe is a 400, and
 * a tenant that does not exist is a 404. Collapsing them would tell an operator to re-paste a
 * token that was fine.
 */
function credentialRefusal(
  reason: string,
  source: string,
): [{ code: string; message: string; details: string[] }, 422 | 400 | 404] {
  if (reason === "credential-rejected") {
    return [
      { code: "credential_rejected", message: "the provider refused this credential", details: [] },
      422,
    ];
  }
  if (reason === "cannot-validate") {
    return [
      { code: "invalid_request", message: `${source} cannot be validated`, details: [] },
      400,
    ];
  }
  return [{ code: "invalid_request", message: "unknown tenant", details: [] }, 404];
}

function registerConnectionsCredentialRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/connections/credential", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }

    const parsed = StoreCredentialRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        {
          code: "invalid_request",
          message: "request did not match the store credential schema",
          // The issue paths, never the values: this body carries a live refresh token.
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    }

    const outcome = await storeCredential(
      {
        exec: deps.exec,
        ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
        ...(deps.env === undefined ? {} : { env: deps.env }),
        ...(deps.byteFetcher === undefined ? {} : { fetcher: deps.byteFetcher }),
      },
      parsed.data,
    );
    if (!outcome.ok) {
      return c.json(...credentialRefusal(outcome.reason, parsed.data.source));
    }
    return c.json(
      {
        tenantId: parsed.data.tenantId,
        source: parsed.data.source,
        status: "connected",
        expiresAt: outcome.expiresAt,
      },
      200,
    );
  });
}

function registerConnectionsBrowseRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/connections/browse", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }

    const parsed = BrowseScopeRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "source, tenantId and kind are required", details: [] },
        400,
      );
    }

    const outcome = await browseScope(
      {
        exec: deps.exec,
        fetcher: deps.byteFetcher ?? createByteFetcher(),
        token: () => tokenFor(deps, parsed.data),
      },
      parsed.data,
    );
    if (!outcome.ok) {
      // Two refusals, two codes, because the remedies have nothing in common. A source
      // that cannot be browsed is a request this build will never serve; a credential
      // Google refused is one reconnect away from working, and the caller can only say so
      // if the status tells it apart from every other 400 this endpoint can answer.
      if (outcome.reason === "scope-insufficient") {
        return c.json(
          {
            code: "scope_insufficient",
            message: `the ${parsed.data.source} grant does not permit this`,
            details: [],
          },
          403,
        );
      }
      return c.json(
        {
          code: "invalid_request",
          message: `${parsed.data.source} cannot be browsed`,
          details: [],
        },
        400,
      );
    }
    return c.json({ items: outcome.items }, 200);
  });
}

function registerConnectionsRevokeRoute(app: Hono, deps: LakeApiDeps): void {
  app.post("/v1/connections/revoke", async (c) => {
    if (!serviceTokenOk(deps, c)) {
      return c.json(UNAUTHENTICATED, 401);
    }

    const parsed = RevokeConnectionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json(
        { code: "invalid_request", message: "source and tenantId are required", details: [] },
        400,
      );
    }

    const result = await revokeConnection(
      {
        exec: deps.exec,
        fetcher: deps.byteFetcher ?? createByteFetcher(),
        token: () => tokenFor(deps, parsed.data),
        ...(deps.xero === undefined ? {} : { xero: deps.xero }),
        ...(deps.env === undefined ? {} : { env: deps.env }),
      },
      parsed.data,
    );
    return c.json(result, 200);
  });
}
