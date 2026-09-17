/**
 * The client-state store.
 *
 * One store, one owner. Server data does NOT live here -- it lives in the React Query cache
 * behind the tRPC hooks (`trpc.*.useQuery()`), which already handles fetching, caching and
 * invalidation. This store holds only *client* state: choices the user has made in the
 * browser that no endpoint knows about.
 *
 * `.claude/rules/state.md` bans `useState` precisely so this stays true. A local `useState`
 * would be a third, unowned source of truth competing with the query cache and this store;
 * the ast-grep hard gate (`bun run lint:state`) fails the build if one appears.
 *
 * `selectedTenantId` is the first such piece: the control plane's data path (connectors,
 * runs, model preview) hangs off a tenant, so which tenant is in focus is a client choice.
 */

import { create } from "zustand";

interface UiState {
  /** The tenant the operator is currently focused on, or null when none is selected. */
  selectedTenantId: string | null;
  /** Focus a tenant. Selecting the already-selected tenant clears the selection (toggle). */
  selectTenant: (id: string) => void;
  /** Clear the selection outright, e.g. when the selected tenant is no longer visible. */
  clearTenant: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedTenantId: null,
  selectTenant: (id) =>
    set((state) => ({ selectedTenantId: state.selectedTenantId === id ? null : id })),
  clearTenant: () => set({ selectedTenantId: null }),
}));
