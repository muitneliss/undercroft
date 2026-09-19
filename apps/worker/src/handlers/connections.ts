/**
 * The connection verbs: mint a credential, browse a source's scope, revoke a grant.
 *
 * Split from `lake.ts` because they authenticate differently and the difference is the whole
 * point -- see `serviceTokenOk` below.
 */

import {
  BrowseScopeRequest,
  RevokeConnectionRequest,
  StoreCredentialRequest,
} from "@undercroft/contracts";
import { createByteFetcher } from "@undercroft/core";
import type { Context, Hono } from "hono";
import { browseScope, revokeConnection, storeCredential } from "../services/connections.ts";
import { resolveToken } from "../services/ingest.ts";
import { bearerOf } from "./bearer.ts";
import type { LakeApiDeps } from "./lake.ts";

/**
 * Service token only, deliberately.
 *
 * `authenticate()` is NOT called on these three routes, unlike `/v1/lake/records`: an ingest
 * key is a per-tenant grant to LAND data, and accepting one to mint or destroy a credential
 * would quietly widen every key ever issued into a credential-management capability.
 */
function serviceTokenOk(deps: LakeApiDeps, c: Context): boolean {
  return deps.serviceToken !== "" && bearerOf(c.req.header("authorization")) === deps.serviceToken;
}

const UNAUTHENTICATED = {
  code: "unauthenticated",
  message: "the trigger token is required",
  details: [],
};

/** The connection verbs, for the control plane's OAuth flow. */
export function registerConnectionRoutes(app: Hono, deps: LakeApiDeps): void {
  registerCredentialRoute(app, deps);
  registerBrowseRoute(app, deps);
  registerRevokeRoute(app, deps);
}

function registerCredentialRoute(app: Hono, deps: LakeApiDeps): void {
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
      },
      parsed.data,
    );
    if (!outcome.ok) {
      return c.json({ code: "invalid_request", message: "unknown tenant", details: [] }, 404);
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

function registerBrowseRoute(app: Hono, deps: LakeApiDeps): void {
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

function registerRevokeRoute(app: Hono, deps: LakeApiDeps): void {
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
      },
      parsed.data,
    );
    return c.json(result, 200);
  });
}

/** The access token for a connection, refreshing under a lock if one is due. */
function tokenFor(deps: LakeApiDeps, input: { source: string; tenantId: string }): Promise<string> {
  return resolveToken(
    {
      exec: deps.exec,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      ...(deps.refreshers?.[input.source] === undefined
        ? {}
        : { refresher: deps.refreshers[input.source] }),
      ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
    },
    input,
  );
}
