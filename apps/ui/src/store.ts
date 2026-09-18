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
 *
 * `locale` is the second, and it is the one that would most obviously have been kept
 * somewhere else. i18next holds a current language of its own, and react-i18next re-renders
 * off it -- but it is a PROJECTION of this field, not a second owner: `@/i18n` subscribes
 * here and pushes the value down. Reversing that, and calling `i18n.changeLanguage` from a
 * button, would put the user's choice in a library's internals where the store cannot see
 * it and where nothing persists it. See `docs/adr/0012`.
 *
 * ## Why `persist`, and why only over `locale`
 *
 * A language chosen on one visit and forgotten by the next is not a chosen language. So the
 * locale is written to `localStorage` and read back at startup. `selectedTenantId` is
 * deliberately NOT persisted: the tenant in focus belongs to the URL, which already survives
 * a reload and can be pasted to a colleague, and a remembered selection that disagrees with
 * the address bar is exactly the drift this store exists to prevent.
 */

import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** One item an admin picked, as both the picker and the card need to see it. */
export interface ChosenFile {
  readonly id: string;
  readonly name: string;
  readonly kind: "folder" | "file";
}

/**
 * The selection an admin is part-way through making.
 *
 * Client state with no endpoint behind it until Save is pressed, which is exactly what the
 * store is for -- and `useState` is banned, so there is no third place it could live.
 * Deliberately NOT persisted: a half-made choice restored days later, after the labels it
 * referred to may have been renamed, is worse than an empty form.
 */
export interface ScopeDraft {
  readonly source: string;
  readonly labels: string[];
  readonly files: ChosenFile[];
}

interface UiState {
  /** The tenant the operator is currently focused on, or null when none is selected. */
  selectedTenantId: string | null;
  /** Focus a tenant. Selecting the already-selected tenant clears the selection (toggle). */
  selectTenant: (id: string) => void;
  /** Clear the selection outright, e.g. when the selected tenant is no longer visible. */
  clearTenant: () => void;
  /** The language every surface is rendered in, and the one the server is asked to answer in. */
  locale: Locale;
  /** Change language. The only writer; `@/i18n` follows this, never the other way round. */
  setLocale: (locale: Locale) => void;
  /** The scope selection in progress, or null when nothing is being edited. */
  scopeDraft: ScopeDraft | null;
  setScopeDraft: (draft: ScopeDraft) => void;
  /** Add or remove one Gmail label. Absent labels mean the whole mailbox, deliberately. */
  toggleScopeLabel: (source: string, label: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      selectedTenantId: null,
      selectTenant: (id) =>
        set((state) => ({ selectedTenantId: state.selectedTenantId === id ? null : id })),
      clearTenant: () => set({ selectedTenantId: null }),
      locale: DEFAULT_LOCALE,
      setLocale: (locale) => set({ locale }),
      scopeDraft: null,
      setScopeDraft: (scopeDraft) => set({ scopeDraft }),
      toggleScopeLabel: (source, label) =>
        set((state) => {
          const draft = state.scopeDraft?.source === source ? state.scopeDraft : null;
          const labels = draft?.labels ?? [];
          return {
            scopeDraft: {
              source,
              files: draft?.files ?? [],
              labels: labels.includes(label)
                ? labels.filter((l) => l !== label)
                : [...labels, label],
            },
          };
        }),
    }),
    {
      name: "undercroft.ui",
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
