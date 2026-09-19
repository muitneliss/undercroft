/**
 * Spending the authorization code, and reading who consented out of the id token.
 *
 * Split from `oauth.ts`, which holds the decisions -- whether a state is live, whether the
 * caller is still an admin. This is the part that talks to Google, and it is worth reading
 * on its own because of what it deliberately does NOT do: it verifies no signature.
 *
 * That is sound here only because of where the token came from -- a direct, server-to-server
 * TLS response to a request carrying our client secret and a PKCE verifier we generated.
 * There is no attacker-supplied path to this value. The same two claims taken from anything
 * a browser handed us would have to be verified, and the day this function is reused for
 * that is the day it needs to be.
 */

/** Where Google is told to come back to. One URI for both sources; the state carries which. */
export const CALLBACK_PATH = "/oauth/google/callback";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleIngestConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The origin the BROWSER uses. Google builds `redirect_uri` from it. */
  readonly publicUrl: string;
  /**
   * The browser Picker's API key and the Google project number. Public values -- they
   * identify the app and authorise nothing -- and only Drive needs them.
   */
  readonly pickerApiKey?: string;
  readonly projectNumber?: string;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  /**
   * Injected in tests. Typed as the call this module actually makes rather than
   * `typeof fetch`, whose Bun signature carries a `preconnect` property no stand-in has and
   * none of this code uses.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Trailing slashes on the configured public URL, so the callback path joins cleanly. */
const TRAILING_SLASHES = /\/+$/u;

export function redirectUri(publicUrl: string): string {
  return `${publicUrl.replace(TRAILING_SLASHES, "")}${CALLBACK_PATH}`;
}

interface Exchanged {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string | null;
  readonly scope: string;
  readonly sub: string;
  readonly email: string;
}

const MS_PER_SECOND = 1000;

/**
 * Spend the authorization code.
 *
 * Returns `null` on any failure rather than throwing: every failure here means the same
 * thing to the caller -- the consent did not complete -- and the differences between them
 * are Google's business, not a customer's.
 */
export async function exchangeCode(
  google: GoogleIngestConfig,
  input: { code: string; verifier: string },
): Promise<Exchanged | null> {
  const doFetch = google.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(google.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: google.clientId,
        client_secret: google.clientSecret,
        code: input.code,
        code_verifier: input.verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(google.publicUrl),
      }).toString(),
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (accessToken === "") {
      return null;
    }

    const identity = readIdToken(body.id_token);
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
