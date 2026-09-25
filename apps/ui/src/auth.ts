/**
 * The browser's half of sign-in.
 *
 * A module-level singleton, the same shape `main.tsx` uses for the query and tRPC clients
 * and for the same reason: this is a browser-only SPA, so one client per tab is correct, and
 * `state.md` explicitly blesses module-level singletons where it bans `useState`.
 *
 * No `baseURL` and no `credentials: "include"`. The control plane serves this bundle, so
 * `/api/auth` is same-origin and the browser attaches the cookie by itself -- the
 * arrangement ADR 0004 exists to protect. Vite proxies `/api` to :3000 in dev.
 *
 * **`authClient.useSession` is deliberately not used.** `App.tsx`'s single auth read stays
 * `trpc.session.me.useQuery`, because that is the call that resolves the `app_user` uuid the
 * rest of the app is keyed by; Better Auth only knows the authentication identity. A second
 * session source would be two values that should be one, drifting apart -- exactly the bug
 * `state.md` exists to prevent. This module exports verbs and no state.
 *
 * Each verb THROWS on failure. Better Auth's client returns `{ data, error }` instead, which
 * a React Query mutation would read as success; converting here is what makes `isError` and
 * the error copy in `SignIn.tsx` mean anything.
 *
 * ## Signing in on a model-context client's behalf (ADR 0061)
 *
 * When a connector such as claude.ai sends a person here to sign in, Better Auth's authorize
 * step lands them on `/sign-in` (and, once signed in, `/consent`) with the request's parameters
 * and a signature in the URL. `oauthProviderClient` puts that signed query on every non-GET
 * call this client makes FROM SUCH A PAGE -- it reads `sig` off the URL and adds nothing on a
 * page without one, so an ordinary sign-in is untouched -- and the server then answers a
 * successful sign-in with where the authorization continues instead of with the session. The
 * verbs below report that address, and the page goes there rather than to the book.
 */

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import i18next from "i18next";

import { useUiStore } from "@/store.ts";

const authClient = createAuthClient({ plugins: [emailOTPClient(), oauthProviderClient()] });

/** Where the book opens after an ordinary sign-in. */
const HOME = "/";

/**
 * The parameters Better Auth signs onto the sign-in and consent pages, which are not the
 * client's own and must not be sent back to the authorize endpoint as if they were.
 */
const SIGNED_PARAMS = new Set(["sig", "exp", "ba_iat", "ba_param", "ba_pl"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Where the server said to go next, when it answered a sign-in or a consent with the rest of
 * an authorization rather than with a session; `null` for an ordinary answer.
 */
function continuation(data: unknown): string | null {
  return isRecord(data) && data.redirect === true && typeof data.url === "string" ? data.url : null;
}

/**
 * Whether this page is a step of a model-context client's authorization: Better Auth signed
 * the query it was sent here with. Read off the URL, the one place the flow keeps it.
 */
export function isAuthorizing(): boolean {
  return new URLSearchParams(globalThis.location.search).has("sig");
}

/**
 * The authorize endpoint for the request this page was sent with, unsigned: where a Google
 * sign-in comes back to, so the authorization resumes with the new session. Better Auth also
 * carries the request through Google on its own; this is the address it would otherwise have
 * no way back from. `prompt=login` is dropped, or the resumed request would ask for the
 * sign-in that just happened.
 */
function resumeAuthorization(): string {
  const params = new URLSearchParams(globalThis.location.search);
  for (const name of [...params.keys()]) {
    if (SIGNED_PARAMS.has(name)) {
      params.delete(name);
    }
  }
  const prompt = (params.get("prompt") ?? "").split(" ").filter((p) => p !== "login" && p !== "");
  if (prompt.length === 0) {
    params.delete("prompt");
  } else {
    params.set("prompt", prompt.join(" "));
  }
  return `/api/auth/oauth2/authorize?${params.toString()}`;
}

/**
 * The language this browser wants sign-in answered in.
 *
 * Read from the store at call time rather than captured, for the same reason `main.tsx`
 * reads it per tRPC request: the first of these two calls makes the server *send an email*,
 * and an operator who changed language a second ago should not receive the previous one.
 *
 * `i18next.t` rather than a `useTranslation` hook, because this module is a singleton and
 * not a component. It is the same instance and therefore the same language -- `@/i18n`
 * keeps it following the store.
 */
function acceptLanguage(): Record<string, string> {
  return { "accept-language": useUiStore.getState().locale };
}

/** Where a successful sign-in lands, and where a refused one goes. */
const AFTER_SIGN_IN = "/tenants";
const AFTER_REFUSAL = "/?reason=denied";

/**
 * Hand the browser to Google. Resolves once the server has answered with Google's address and
 * the browser is on its way there; a refusal at Google comes back to `AFTER_REFUSAL`, which
 * `App.tsx` reads as `reason=denied`. Throws if the server would not start the sign-in at all.
 */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await authClient.signIn.social(
    {
      provider: "google",
      callbackURL: isAuthorizing() ? resumeAuthorization() : AFTER_SIGN_IN,
      errorCallbackURL: AFTER_REFUSAL,
    },
    { headers: acceptLanguage() },
  );
  if (error !== null) {
    throw new Error(error.message ?? i18next.t("signIn.googleFailed"));
  }
}

/**
 * Ask for a one-time code.
 *
 * Succeeds whether or not the address has access: the server will not say, because doing so
 * would turn this form into a list of who can sign in. So the copy after this resolves must
 * promise a code only *if* the address has access.
 */
export async function sendSignInCode(email: string): Promise<void> {
  const { error } = await authClient.emailOtp.sendVerificationOtp(
    { email, type: "sign-in" },
    { headers: acceptLanguage() },
  );
  if (error !== null) {
    // The server's own message when it gave one -- it composes in the language this call
    // asked for -- and our own sentence only when it did not.
    throw new Error(error.message ?? i18next.t("signIn.sendFailed"));
  }
}

/**
 * Exchange a code for a session, and say where to go: the book, or -- mid-authorization -- the
 * consent step. Throws if the code is wrong, expired, or not allowed.
 */
export async function signInWithCode(email: string, otp: string): Promise<string> {
  const { data, error } = await authClient.signIn.emailOtp(
    { email, otp },
    { headers: acceptLanguage() },
  );
  if (error !== null) {
    throw new Error(error.message ?? i18next.t("signIn.codeFailed"));
  }
  return continuation(data) ?? HOME;
}

/**
 * Sign in on a local stack as the address the control plane was started with
 * (`UNDERCROFT_DEV_SIGN_IN_AS`). The server chooses who, never this call. A server without the
 * method answers 404, which is the case `signIn.devFailed` explains.
 */
export async function signInForDevelopment(): Promise<string> {
  const { data, error } = await authClient.$fetch("/sign-in/dev", {
    method: "POST",
    headers: acceptLanguage(),
  });
  if (error !== null) {
    // A 404 is the method being off, whatever words the router put on it; anything else is
    // the server's own refusal, worded in the language this call asked for.
    const refusal = error.status === 404 ? undefined : error.message;
    throw new Error(refusal ?? i18next.t("signIn.devFailed"));
  }
  return continuation(data) ?? HOME;
}

/** What a model-context client said about itself when it registered. */
export interface RequestingClient {
  /** Self-asserted, so the consent page shows the redirect host beside it. */
  readonly name: string | null;
}

/** The client asking for access, by the id in the consent page's query. */
export async function requestingClient(clientId: string): Promise<RequestingClient> {
  const { data, error } = await authClient.$fetch("/oauth2/public-client", {
    method: "GET",
    query: { client_id: clientId },
    headers: acceptLanguage(),
  });
  if (error !== null) {
    throw new Error(error.message ?? i18next.t("consent.clientFailed"));
  }
  return { name: isRecord(data) && typeof data.client_name === "string" ? data.client_name : null };
}

/**
 * Answer the consent page: `scope` is what the person agreed to -- a subset of what was asked,
 * never more -- or `null` to refuse. Resolves with where the client asked to be sent back to,
 * carrying the authorization code or the refusal.
 */
export async function answerConsent(scope: string | null): Promise<string> {
  const { data, error } = await authClient.$fetch("/oauth2/consent", {
    method: "POST",
    body: scope === null ? { accept: false } : { accept: true, scope },
    headers: acceptLanguage(),
  });
  const next = continuation(data);
  if (error !== null || next === null) {
    throw new Error(error?.message ?? i18next.t("consent.answerFailed"));
  }
  return next;
}
