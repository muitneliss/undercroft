---
description: One owner per piece of UI state; useState is banned
paths: ["apps/ui/**/*.ts", "apps/ui/**/*.tsx"]
---

# UI state has one owner

The UI has exactly two homes for state, and `useState` is neither.

- **Server data → the tRPC React Query cache.** Read it with the generated hooks
  (`trpc.tenants.list.useQuery()`), never by fetching into local state. The cache already
  owns fetching, caching, staleness and invalidation; a component that copies server data
  into `useState` immediately owns a stale second copy.
- **Client data → the Zustand store** in `apps/ui/src/store.ts` (`useUiStore`). Anything the
  user chose in the browser that no endpoint knows about — the selected tenant, an open
  panel, a draft filter — lives there, so it is one value read from one place.

## NEVER

- **NEVER call `useState` (or `React.useState`).** It creates a third, unowned source of
  truth that competes with the query cache and the store, and the bug it causes — two
  values that should be one drifting apart — is invisible until a user hits it. Put the
  state in the store instead. This is enforced: `bun run lint:rules` (ast-grep, rule
  `no-usestate`) fails the build, and it runs inside `bun run verify` and CI.

## Follow

- **The provider clients are module-level singletons, not `useState`.** `main.tsx` builds
  the `QueryClient` and tRPC client once at module scope. The tRPC docs wrap them in
  `useState` for SSR; this is a browser-only SPA, so one client per tab is correct and the
  ban holds.
- **`useReducer` and `useRef` are not a loophole.** They are not banned (a DOM ref is not
  application state), but reach for them only for genuinely local, non-shared concerns. If a
  second component would want the value, it belongs in the store.
- **Derive, don't duplicate.** Prefer computing from the query cache or the store during
  render over storing a copy you then have to keep in sync.

The reasoning behind adopting Zustand and banning `useState` is recorded in
`docs/adr/0009-ui-state-in-zustand-no-usestate.md`.
