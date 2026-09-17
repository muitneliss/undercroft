# 9. UI state has one owner, and `useState` is banned

- Status: Accepted
- Date: 2026-09-17

## Decision

The control-plane UI has exactly two homes for state. **Server data** lives in the tRPC
React Query cache, read through the generated hooks (`trpc.tenants.list.useQuery()`); the
client is set up with the classic `@trpc/react-query` integration (`createTRPCReact`), whose
whole reason to exist is those hooks. **Client data** lives in a single Zustand store,
`apps/ui/src/store.ts` (`useUiStore`).

`useState` is banned. The ban is enforced mechanically by an ast-grep rule (`no-usestate`,
scoped to `apps/ui/**`) that fails `bun run lint:state`, which runs inside `bun run verify`
and therefore in CI. A path-scoped rule file, `.claude/rules/state.md`, carries the
convention for humans and agents; it is symlinked to `apps/ui/AGENTS.md` so Codex reads the
same bytes, the way root `AGENTS.md` symlinks `CLAUDE.md`.

The `QueryClient` and tRPC client in `main.tsx` are module-level singletons, not
`useState(() => ...)`.

## Why

- **Two values that should be one, drifting apart, is an invisible bug.** A component that
  fetches into `useState` owns a stale copy of server data the moment the cache updates
  elsewhere; a piece of UI choice held in `useState` cannot be read by a sibling that needs
  it. Forcing server data into the query cache and client data into one store means every
  value is read from the one place that owns it. This is the UI face of the repo's "one
  writer, many callers" rule.
- **The rule file alone is not enforcement.** `.claude/rules/*.md` is discovered
  automatically only by Claude Code; other agents and human reviewers can miss it, and a
  convention a reviewer cannot reliably catch is one an ast-grep rule can. The soft gate
  states the intent; the hard gate holds the line.
- **Module-level clients are correct here.** The tRPC docs wrap the client in `useState` to
  give each SSR request its own instance. This is a browser-only SPA with no SSR, so one
  client per tab is right — and it keeps the setup itself from violating the ban.

## Rejected

- **The `@trpc/tanstack-react-query` integration** (`createTRPCContext` + `useTRPC()` +
  `queryOptions()`). It was already a dependency, but we standardised on the classic
  `@trpc/react-query` hooks per the linked setup doc and removed the other so the repo does
  not carry two integrations of the same thing.
- **Enforcing the ban with ESLint `no-restricted-syntax`.** ESLint already owns the money
  rules there, but ast-grep was chosen as the state gate because its pattern syntax
  (`useState($$$ARGS)`, `React.useState($$$ARGS)`) states the banned shape directly and
  keeps this concern in its own rule file rather than growing the money selector list.
- **Banning `useReducer` and `useRef` too.** A DOM ref is not application state, and a
  strictly-local reducer is not a competing source of truth. The rule discourages them for
  shared state but does not fail the build on them.
