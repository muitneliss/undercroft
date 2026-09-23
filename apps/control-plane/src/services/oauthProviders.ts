/**
 * The two OAuth providers a per-tenant consent can go through, and how each differs.
 *
 * One table rather than one module per provider: what varies between Google and Xero is
 * five facts -- the two endpoints, whether the client authenticates in the body or a Basic
 * header, whether PKCE is used, and whether an id token names who consented -- and a table
 * of five facts is easier to check against a provider's documentation than two copies of a
 * flow that differ in five places. The flow itself (`oauth.ts`) reads the table and knows no
 * provider by name.
 *
 * Each provider gets its own callback path, because a provider matches `redirect_uri`
 * exactly and each is registered in a different console. Two URIs to register, not one per
 * source: the handshake row carries the source.
 */

import { sourceKind } from "@undercroft/contracts";

export type Provider = "google" | "xero";

/** What a deployment holds for one provider: the client, and where the browser comes back. */
export interface ProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The origin the BROWSER uses. The provider builds `redirect_uri` from it. */
  readonly publicUrl: string;
  readonly authorizeUrl?: string;
  readonly tokenUrl?: string;
  /**
   * Injected in tests. Typed as the call this module actually makes rather than
   * `typeof fetch`, whose Bun signature carries a `preconnect` property no stand-in has and
   * none of this code uses.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Google's ingestion client: the provider config plus the Picker's two public values. */
export interface GoogleIngestConfig extends ProviderConfig {
  /**
   * The browser Picker's API key and the Google project number. Public values -- they
   * identify the app and authorise nothing -- and only Drive needs them.
   */
  readonly pickerApiKey?: string;
  readonly projectNumber?: string;
}

export interface ProviderShape {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  /** The scopes each of this provider's sources asks for. */
  readonly scopes: Readonly<Record<string, readonly string[]>>;
  /** Whether the authorize request carries a PKCE challenge. */
  readonly pkce: boolean;
  /** How the token endpoint learns which client is asking. */
  readonly clientAuth: "body" | "basic";
  /** Extra authorize parameters the provider needs to issue a refresh token. */
  readonly authorizeParams: Readonly<Record<string, string>>;
  /** Whether the token response carries an id token naming who consented. */
  readonly identity: boolean;
}

/** Trailing slashes on the configured public URL, so the callback path joins cleanly. */
const TRAILING_SLASHES = /\/+$/u;

export const PROVIDERS: Readonly<Record<Provider, ProviderShape>> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    /**
     * Drive is `drive.file`, deliberately, not `drive.readonly`. `drive.file` reaches only
     * what the admin picked in Google's own Picker, so the shipped promise "No other folder
     * is read" is enforced by Google rather than by our query filter -- and it is not a
     * Google "restricted" scope, so it carries no annual CASA security assessment. Gmail has
     * no such option: no non-restricted Gmail scope reaches attachments.
     *
     * `openid email` rides along so the callback learns which account consented. It is the
     * same identity scope sign-in uses and grants nothing further.
     */
    scopes: {
      gmail: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
      drive: ["openid", "email", "https://www.googleapis.com/auth/drive.file"],
    },
    pkce: true,
    clientAuth: "body",
    /**
     * `access_type=offline` AND `prompt=consent` are both required. Without the first Google
     * issues no refresh token at all; without the second it issues one only on the very
     * first consent, so a customer who reconnects gets a credential that dies at the next
     * expiry and cannot be refreshed -- a failure that shows up hours later, far from its
     * cause.
     */
    authorizeParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" },
    identity: true,
  },
  xero: {
    authorizeUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    /**
     * The same list `specs/connectors/xero.yaml` declares under `auth.scopes`, kept in step
     * by hand: the control plane does not read specs, and a consent narrower than the spec
     * would fail every run with a 403 far from here. `offline_access` is what makes Xero
     * issue a refresh token at all.
     */
    scopes: {
      xero: ["offline_access", "accounting.transactions.read", "accounting.contacts.read"],
    },
    // A confidential client with a secret: Xero takes it in a Basic header at the token
    // endpoint and reserves PKCE for clients that have none.
    pkce: false,
    clientAuth: "basic",
    authorizeParams: {},
    // No id token: the consent names nobody, and the organisation is chosen afterwards.
    identity: false,
  },
};

const PROVIDER_IDS: readonly Provider[] = ["google", "xero"];

/**
 * Which provider a source consents through, or `null` for one that has no consent flow.
 *
 * By kind: every account of Gmail consents through Google, the second mailbox included.
 */
export function providerOf(source: string): Provider | null {
  const kind = sourceKind(source);
  return PROVIDER_IDS.find((provider) => Object.hasOwn(PROVIDERS[provider].scopes, kind)) ?? null;
}

/** Where a provider is told to come back to. One URI per provider, registered in its console. */
export function redirectUri(publicUrl: string, provider: Provider): string {
  return `${publicUrl.replace(TRAILING_SLASHES, "")}/oauth/${provider}/callback`;
}
