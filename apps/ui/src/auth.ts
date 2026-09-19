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
 * `state.md` exists to prevent. This module exports three verbs and no state.
 *
 * Each verb THROWS on failure. Better Auth's client returns `{ data, error }` instead, which
 * a React Query mutation would read as success; converting here is what makes `isError` and
 * the error copy in `SignIn.tsx` mean anything.
 */

import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import i18next from "i18next";

import { useUiStore } from "@/store.ts";

const authClient = createAuthClient({ plugins: [emailOTPClient()] });

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
 * Hand the browser to Google. Navigates away, so there is nothing to await and no state to
 * hold; a refusal comes back to `AFTER_REFUSAL`, which `App.tsx` reads as `reason=denied`.
 */
export function signInWithGoogle(): void {
  void authClient.signIn.social({
    provider: "google",
    callbackURL: AFTER_SIGN_IN,
    errorCallbackURL: AFTER_REFUSAL,
  });
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

/** Exchange a code for a session. Throws if the code is wrong, expired, or not allowed. */
export async function signInWithCode(email: string, otp: string): Promise<void> {
  const { error } = await authClient.signIn.emailOtp({ email, otp }, { headers: acceptLanguage() });
  if (error !== null) {
    throw new Error(error.message ?? i18next.t("signIn.codeFailed"));
  }
}
