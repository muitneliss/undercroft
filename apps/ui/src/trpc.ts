/**
 * The tRPC React Query client.
 *
 * `AppRouter` is imported as a TYPE ONLY. That is what lets the client and server share
 * one definition of every shape without the browser ever loading the server -- and with
 * it `pg` and the secret-key loader. Two things keep the promise enforced rather than
 * trusted: an ESLint `no-restricted-imports` zone (allowTypeImports) that lets only a type
 * import of this path through, and `verbatimModuleSyntax`, which elides the type import so
 * nothing from the control plane reaches the bundle.
 *
 * `createTRPCReact` builds the React Query-integrated hooks (`trpc.tenants.list.useQuery()`),
 * which is the whole point: server state lives in React Query, not in component state. That
 * is also why `.claude/rules/state.md` bans `useState` -- with the query cache owning server
 * data and the Zustand store owning client data, a local `useState` is a third, unowned
 * source of truth.
 */

import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@undercroft/control-plane/router";

// The annotation is required, not decorative: without it the inferred type reaches into the
// control plane's internal trpc module to name itself (TS2742), which is neither portable nor
// truly type-only. `unknown` is the SSR context -- this SPA does not server-render.
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();
