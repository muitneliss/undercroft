/**
 * Exchanging a Xero refresh token for a fresh pair.
 *
 * Xero ROTATES: every refresh issues a new refresh token and kills the one just spent.
 * That is the whole difference from Google's refresher beside this one, and it changes two
 * things. The response MUST carry a `refresh_token`, and a 200 without one is refused --
 * carrying the old one forward, which is the right reading for Google, would here store a
 * token Xero has already invalidated and the customer would have to consent again for no
 * visible reason. And the caller must write the new pair back under the row lock
 * `accessToken` already takes before the access token is used, which `credentials.ts` does.
 *
 * The client authenticates with a Basic header, as Xero's token endpoint expects for a
 * confidential client, rather than with `client_secret` in the body.
 */

// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { ByteFetcher, Clock } from "@undercroft/core";
import { raiseForByteStatus, systemClock } from "@undercroft/core";
import type { Credential } from "@undercroft/db/repos";

export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";

export interface XeroOAuthConfig {
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

/** The Basic credential Xero's identity endpoints take for a confidential client. */
export function xeroClientAuthorization(config: {
  readonly clientId: string;
  readonly clientSecret: string;
}): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

/**
 * Build the refresher `accessToken` calls when a stored Xero credential is close to expiry.
 *
 * Not retried, for the reason the Google refresher gives: `invalid_grant` is the customer
 * having disconnected us, and five attempts turn a clear answer into a slow one.
 */
export function xeroRefresher(
  config: XeroOAuthConfig,
): (refreshToken: string) => Promise<Credential> {
  const clock = config.clock ?? systemClock;
  const url = config.tokenUrl ?? XERO_TOKEN_URL;

  return async (refreshToken: string): Promise<Credential> => {
    const request = {
      url,
      method: "POST" as const,
      headers: {
        authorization: xeroClientAuthorization(config),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    };

    const response = await config.fetcher.send(request);
    raiseForByteStatus(request, response);

    const body = JSON.parse(new TextDecoder().decode(response.bytes)) as TokenResponse;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const rotated = typeof body.refresh_token === "string" ? body.refresh_token : "";
    if (accessToken === "") {
      throw new Error("xero token endpoint returned 200 with no access_token");
    }
    if (rotated === "") {
      // The one just spent is dead. Storing it would seal a credential that cannot refresh
      // and reads as "connected" until the next run 401s.
      throw new Error("xero token endpoint returned 200 with no rotated refresh_token");
    }

    return { accessToken, refreshToken: rotated, expiresAt: expiryFrom(body.expires_in, clock) };
  };
}

function expiryFrom(expiresIn: unknown, clock: Clock): string | null {
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn)) {
    return null;
  }
  return new Date(clock.now().getTime() + expiresIn * MS_PER_SECOND).toISOString();
}
