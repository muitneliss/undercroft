/**
 * The `Authorization: Bearer <token>` header, read once.
 *
 * Shared by the lake verbs and the connection verbs, which authenticate differently -- an
 * ingest key for the first, the service token alone for the second -- but read the header the
 * same way. Its own module so neither handler has to import the other, and it carries the
 * service-token check and the refresh-aware token lookup for the same reason.
 */

import { sourceKind } from "@undercroft/contracts";
import type { Context } from "hono";
import type { JobDeps } from "../services/jobs.ts";
import type { LakeApiDeps } from "./lake.ts";
import { type Refresher, resolveToken } from "../services/runTypes.ts";

const BEARER = /^Bearer\s+(?<token>.+)$/iu;

export function bearerOf(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = BEARER.exec(header);
  return match?.groups?.token ?? null;
}

/**
 * Service token only. An ingest key is a per-tenant grant to LAND data, and accepting one to
 * mint or destroy a credential would widen every key ever issued into a credential-management
 * capability.
 */
export function serviceTokenOk(deps: LakeApiDeps, c: Context): boolean {
  return deps.serviceToken !== "" && bearerOf(c.req.header("authorization")) === deps.serviceToken;
}

export const UNAUTHENTICATED = {
  code: "unauthenticated",
  message: "the trigger token is required",
  details: [],
};

/**
 * The refresher for a source's KIND. Every account of a kind was minted by the same OAuth
 * client, so they share one -- and a map keyed by source would give a second mailbox none,
 * leaving it to 401 an hour after consent. ADR 0043.
 */
function refresherFor(deps: LakeApiDeps, source: string): Refresher | undefined {
  return deps.refreshers?.[sourceKind(source)];
}

/** The access token for a connection, refreshing under a lock if one is due. */
export function tokenFor(
  deps: LakeApiDeps,
  input: { source: string; tenantId: string },
): Promise<string> {
  const refresher = refresherFor(deps, input.source);
  return resolveToken(
    {
      exec: deps.exec,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      ...(refresher === undefined ? {} : { refresher }),
      ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
    },
    input,
  );
}

/** The run deps for one source, with that source's refresher if it has one. */
export function jobDepsFor(deps: LakeApiDeps, source: string, specsDir: string): JobDeps {
  const refresher = refresherFor(deps, source);
  return {
    lake: deps.lake,
    exec: deps.exec,
    specsDir,
    ...(deps.log === undefined ? {} : { log: deps.log }),
    ...(deps.env ? { env: deps.env } : {}),
    ...(refresher === undefined ? {} : { refresher }),
    ...(deps.transactor === undefined ? {} : { transactor: deps.transactor }),
    ...(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }),
    ...(deps.byteFetcher === undefined ? {} : { byteFetcher: deps.byteFetcher }),
    ...(deps.dbt === undefined ? {} : { dbt: { ...deps.dbt, exec: deps.exec } }),
    ...(deps.extractSpawn === undefined ? {} : { extractSpawn: deps.extractSpawn }),
    ...(deps.stop === undefined ? {} : { stop: deps.stop }),
  };
}
