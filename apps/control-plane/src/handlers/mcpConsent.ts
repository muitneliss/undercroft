/**
 * A consent to a model-context app (ADR 0061), as the authorization server stores it, and the
 * moment a person gives one (ADR 0120).
 *
 * Beside `mcpAuth.ts`, which reads a consent on every call, because both have to know the same
 * thing -- what a stored consent row looks like -- and this module's other half has to know two
 * more things about the provider that nothing else does: which request grants a consent, and where
 * the app it was granted to is found during that request.
 */

import { getOAuthProviderState } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import type { HookContext } from "./authLocale.ts";
import { oauthCredential } from "./mcpAccessToken.ts";

/** A consent as the adapter answers it: the fields read here, typed as what they must be. */
export interface StoredConsent {
  readonly id: string;
  readonly clientId: string;
  readonly scopes: unknown;
  readonly createdAt?: unknown;
  readonly updatedAt?: unknown;
}

/** The strings of a stored list, or none: the adapter's columns arrive typed as nothing. */
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/** A consent a person has just given an app, as the authorization server stored it. */
export interface Consented {
  /** The person's address, from the session that consented. */
  readonly email: string;
  /** The app, as `oauthCredential` names it: the id its later calls are audited by. */
  readonly credential: string;
  /** What the stored consent grants. */
  readonly scopes: readonly string[];
}

/** Told of each consent given, with the request that gave it. Recording it is the caller's. */
export type OnConsent = (consented: Consented, request: HookContext) => Promise<void>;

/** The consent page's answer, the one request a person grants an app through. */
const CONSENT_PATH = "/oauth2/consent";

/** Whether the consent page's answer said yes. */
function accepted(body: unknown): boolean {
  return typeof body === "object" && body !== null && "accept" in body && body.accept === true;
}

/**
 * Whether an answer to the consent page went on to issue an authorization code: the redirect back
 * to the app carries `code`. A refusal carries `error`, and a consent that first sends the person
 * to sign in again (`prompt=login`) carries neither -- nothing was granted by THAT request, even
 * where an earlier consent row stands.
 */
function issuedCode(returned: unknown): boolean {
  if (isAPIError(returned) || typeof returned !== "object" || returned === null) {
    return false;
  }
  const url = "url" in returned ? returned.url : null;
  return typeof url === "string" && URL.canParse(url) && new URL(url).searchParams.has("code");
}

/** The app the authorization request in flight is for, as the provider verified it. */
async function clientInFlight(): Promise<string | null> {
  return new URLSearchParams((await getOAuthProviderState())?.query ?? "").get("client_id");
}

/** One of a plugin's after-hooks, as Better Auth takes them. */
export type AfterHook = NonNullable<NonNullable<BetterAuthPlugin["hooks"]>["after"]>[number];

/**
 * An after-hook that tells `onConsent` of each consent given, and does nothing else. Where no
 * authorization server is built the path it matches does not exist, and it never runs.
 *
 * An after-hook on the consent endpoint, because the provider writes the consent through its own
 * adapter, so no database hook sees it, and offers no callback of its own (1.7.5). The app is read
 * from the provider's request state -- the authorization request whose signature its own
 * before-hook verified (`getOAuthProviderState`) -- and the scopes from the consent row as stored,
 * not from what the page sent: the row is what `mcpAuth.ts` reads on every call.
 */
export function consentHook(onConsent: OnConsent): AfterHook {
  return {
    matcher: (context): boolean => context.path === CONSENT_PATH,
    handler: createAuthMiddleware(async (ctx) => {
      if (!(accepted(ctx.body) && issuedCode(ctx.context.returned))) {
        return;
      }
      const clientId = await clientInFlight();
      const session = await getSessionFromCtx(ctx, { disableRefresh: true });
      if (clientId === null || session === null) {
        return;
      }
      const consent = await ctx.context.adapter.findOne<StoredConsent>({
        model: "oauthConsent",
        where: [
          { field: "clientId", value: clientId },
          { field: "userId", value: session.user.id },
        ],
      });
      if (consent !== null) {
        const credential = oauthCredential(clientId);
        const scopes = strings(consent.scopes);
        await onConsent({ email: session.user.email, credential, scopes }, ctx);
      }
    }),
  };
}
