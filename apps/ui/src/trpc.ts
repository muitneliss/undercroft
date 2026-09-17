/**
 * The tRPC client.
 *
 * `AppRouter` is imported as a TYPE ONLY. That is what lets the client and server share
 * one definition of every shape without the browser ever loading the server -- and with
 * it `pg` and the secret-key loader. Two things keep the promise enforced rather than
 * trusted: an ESLint `no-restricted-imports` zone (allowTypeImports) that lets only a type
 * import of this path through, and `verbatimModuleSyntax`, which elides the type import so
 * nothing from the control plane reaches the bundle.
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "@undercroft/control-plane/router";

// The annotation is required, not decorative: without it the inferred type names the
// control plane's internal router types, which is neither portable nor truly type-only.
export const trpc: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
  // Same-origin: the browser sends the session cookie automatically, so no custom fetch is
  // needed. The control plane serves /trpc on the same origin the SPA is served from.
  links: [httpBatchLink({ url: "/trpc" })],
});
