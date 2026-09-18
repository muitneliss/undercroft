---
title: ADR 0009 UI State in Zustand, useState Banned
type: source
date: 2026-09-18
tags: []
source: docs/adr/0009-ui-state-in-zustand-no-usestate.md
source_path: docs/adr/0009-ui-state-in-zustand-no-usestate.md
source_hash: 5e9acdb2ffc48e4798a6f4bb39d4e6015b85bc8dfa85d9f644d79fe082cac52b
ingested: 2026-09-18
---

# ADR 0009 UI State in Zustand, useState Banned

## Decision

The control-plane UI has exactly two homes for state. **Server data** lives in the tRPC
React Query cache, read through the generated hooks (`trpc.tenants.list.useQuery()`) via
the classic `@trpc/react-query` integration. **Client data** lives in a single Zustand
store, `apps/ui/src/store.ts` (`useUiStore`).

`useState` is **banned**, enforced mechanically by an ast-grep rule (`no-usestate`, scoped
to `apps/ui/**`) that fails `bun run lint:state`, which runs inside `bun run verify` and CI.
A path-scoped rule file, `.claude/rules/state.md`, carries the convention for humans and
agents; it is symlinked to `apps/ui/AGENTS.md` so other agents read the same bytes.

The `QueryClient` and tRPC client in `main.tsx` are module-level singletons, not
`useState(() => ...)`.

## Why

* **Two values that should be one, drifting apart, is an invisible bug.** A component that
  fetches into `useState` owns a stale copy of server data the moment the cache updates
  elsewhere; a piece of UI choice held in `useState` cannot be read by a sibling that needs
  it. This is the UI face of the repo's "one writer, many callers" rule.
* **The rule file alone is not enforcement.** `.claude/rules/*.md` is discovered
  automatically only by Claude Code; other agents and human reviewers can miss it. The soft
  gate states the intent; the hard gate holds the line.
* **Module-level clients are correct here.** The tRPC docs wrap the client in `useState` for
  SSR. This is a browser-only SPA with no SSR, so one client per tab is right — and it keeps
  the setup itself from violating the ban.

## Rejected

* **The `@trpc/tanstack-react-query` integration.** Standardised on the classic hooks so the
  repo does not carry two integrations of the same thing.
* **Enforcing the ban with ESLint `no-restricted-syntax`.** ast-grep was chosen because its
  pattern syntax states the banned shape directly and keeps the concern in its own rule file.
* **Banning `useReducer` and `useRef` too.** A DOM ref is not application state, and a
  strictly-local reducer is not a competing source of truth. Discouraged, not build-failing.
