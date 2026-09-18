/**
 * Exchanging a Google refresh token for a fresh access token.
 *
 * This is the function `accessToken` has always taken and never been given. Until now the
 * worker called it with no `refresher`, so a credential close to expiry marked the
 * connection `expired` and raised -- correct behaviour for HubSpot's private app, which has
 * nothing to refresh with, and a permanent outage for anything that does.
 *
 * Two properties are load-bearing and both are the caller's to provide:
 *
 * **It must run inside a transaction.** `accessToken` reads the credential `FOR UPDATE`,
 * and a row lock only holds inside one. On autocommit the lock lasts for the statement, so
 * two concurrent runs can both read the same refresh token and both spend it.
 *
 * **A failure must roll the transaction back rather than write a partial credential.**
 * Google does not rotate the refresh token on an ordinary refresh, so a failed exchange is
 * safely retried next run -- but only if nothing was written in between.
 *
 * Google returns no `refresh_token` on a refresh response. Carrying the existing one
 * forward is therefore not an optimisation, it is the only correct reading: treating the
 * absent field as an empty string would store a credential that can never refresh again,
 * and the customer would have to re-consent for no reason.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { ByteFetcher, Clock } from "@undercroft/core";
import { raiseForByteStatus, systemClock } from "@undercroft/core";
import type { Credential } from "@undercroft/db/repos";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetcher: ByteFetcher;
  readonly clock?: Clock;
  /** Overridable for tests; production never passes it. */
  readonly tokenUrl?: string;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
}

const MS_PER_SECOND = 1000;

/**
 * Build the refresher `accessToken` calls when a stored credential is close to expiry.
 *
 * Not retried. `withRetry` exists for a listed set of transient statuses, and a token
 * endpoint answering `invalid_grant` is not one of them -- retrying a revoked grant five
 * times turns a clear "the customer disconnected us" into a slow one.
 */
export function googleRefresher(
  config: GoogleOAuthConfig,
): (refreshToken: string) => Promise<Credential> {
  const clock = config.clock ?? systemClock;
  const url = config.tokenUrl ?? GOOGLE_TOKEN_URL;

  return async (refreshToken: string): Promise<Credential> => {
    const request = {
      url,
      method: "POST" as const,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    };

    const response = await config.fetcher.send(request);
    raiseForByteStatus(request, response);

    const body = JSON.parse(new TextDecoder().decode(response.bytes)) as TokenResponse;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (accessToken === "") {
      // A 200 with no token is not a token. Refusing here keeps the empty string out of the
      // sealed credential, where it would read as "connected" and 401 deep inside a sync.
      throw new Error("google token endpoint returned 200 with no access_token");
    }

    return {
      accessToken,
      // Absent means unchanged, not empty. See the module docstring.
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : refreshToken,
      expiresAt: expiryFrom(body.expires_in, clock),
    };
  };
}

/**
 * `expires_in` is a seconds count. A response without one is a credential with no recorded
 * expiry, which `needsRefresh` reads as fresh -- honest, and better than inventing an hour.
 */
function expiryFrom(expiresIn: unknown, clock: Clock): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    return null;
  }
  return new Date(clock.now().getTime() + expiresIn * MS_PER_SECOND).toISOString();
}
