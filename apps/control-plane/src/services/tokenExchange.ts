/**
 * Spending the authorization code, and reading who consented out of the id token.
 *
 * Split from `oauth.ts`, which holds the decisions -- whether a state is live, whether the
 * caller is still an admin. This is the part that talks to the provider, and it is worth
 * reading on its own because of what it deliberately does NOT do: it verifies no signature.
 *
 * That is sound here only because of where the token came from -- a direct, server-to-server
 * TLS response to a request carrying our client secret and, for Google, a PKCE verifier we
 * generated. There is no attacker-supplied path to this value. The same two claims taken
 * from anything a browser handed us would have to be verified, and the day this function is
 * reused for that is the day it needs to be.
 */

// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { type Provider, type ProviderConfig, PROVIDERS, redirectUri } from "./oauthProviders.ts";

export interface Exchanged {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string | null;
  readonly scope: string;
  /** The provider's opaque subject, or `""` where the provider names nobody (Xero). */
  readonly sub: string;
  readonly email: string;
}

const MS_PER_SECOND = 1000;

/**
 * Spend the authorization code.
 *
 * Returns `null` on any failure rather than throwing: every failure here means the same
 * thing to the caller -- the consent did not complete -- and the differences between them
 * are the provider's business, not a customer's.
 */
export async function exchangeCode(
  provider: Provider,
  config: ProviderConfig,
  input: { code: string; verifier: string },
): Promise<Exchanged | null> {
  const shape = PROVIDERS[provider];
  const doFetch = config.fetch ?? globalThis.fetch;
  const form = new URLSearchParams({
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(config.publicUrl, provider),
  });
  if (shape.pkce) {
    form.set("code_verifier", input.verifier);
  }
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (shape.clientAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
  }

  try {
    const response = await doFetch(config.tokenUrl ?? shape.tokenUrl, {
      method: "POST",
      headers,
      body: form.toString(),
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (accessToken === "") {
      return null;
    }

    const identity = shape.identity ? readIdToken(body.id_token) : { sub: "", email: "" };
    return {
      accessToken,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : "",
      expiresAt:
        typeof body.expires_in === "number"
          ? new Date(Date.now() + body.expires_in * MS_PER_SECOND).toISOString()
          : null,
      scope: typeof body.scope === "string" ? body.scope : "",
      sub: identity.sub,
      email: identity.email,
    };
  } catch {
    return null;
  }
}

/**
 * Read `sub` and `email` out of the id token's payload.
 *
 * The signature is NOT verified, and that is sound here only because of where the token came
 * from: a direct, server-to-server TLS response to a request carrying our client secret and
 * a PKCE verifier we generated. There is no attacker-supplied path to this value. The same
 * two claims taken from anything a browser handed us would have to be verified.
 */
function readIdToken(idToken: unknown): { sub: string; email: string } {
  if (typeof idToken !== "string") {
    return { sub: "", email: "" };
  }
  const payload = idToken.split(".")[1];
  if (payload === undefined) {
    return { sub: "", email: "" };
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return {
      sub: typeof claims.sub === "string" ? claims.sub : "",
      email: typeof claims.email === "string" ? claims.email : "",
    };
  } catch {
    return { sub: "", email: "" };
  }
}
