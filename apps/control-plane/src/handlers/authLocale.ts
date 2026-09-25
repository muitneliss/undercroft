/**
 * The language a Better Auth endpoint or hook answers in.
 *
 * Its own module because two files need it -- `auth.ts` for its hooks and `devSignIn.ts` for
 * its refusal -- and the second is imported by the first.
 */

import { type Locale, negotiateLocale } from "@undercroft/core";

/**
 * Which language to answer a Better Auth hook in.
 *
 * `/trpc` resolves this once per request in `server.ts`; inside these hooks there is no
 * `Context`, because they are called from within the library. Better Auth hands each of them
 * the endpoint context, which carries the originating request -- and therefore the same
 * `Accept-Language` the browser sent, so the answer is the same one arrived at the same way.
 *
 * Structural rather than Better Auth's own `GenericEndpointContext`: the two hooks are given
 * slightly different shapes, and this depends on the one field both actually carry.
 *
 * Everything here is optional in the library's types, because a sign-in driven by something
 * other than an HTTP call has no request at all. That resolves to Vietnamese, which is the
 * product's default and not a guess -- `negotiateLocale` records why.
 */
export interface HookContext {
  readonly request?: Request | undefined;
  readonly headers?: Headers | undefined;
}

export function localeOf(context: HookContext | null | undefined): Locale {
  const asked =
    context?.request?.headers.get("accept-language") ??
    context?.headers?.get("accept-language") ??
    null;
  return negotiateLocale(asked);
}
