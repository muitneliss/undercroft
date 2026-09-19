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
 * `locale` is the first such piece, and it is the one that would most obviously have been
 * kept somewhere else. i18next holds a current language of its own, and react-i18next
 * re-renders off it -- but it is a PROJECTION of this field, not a second owner: `@/i18n`
 * subscribes here and pushes the value down. Reversing that, and calling
 * `i18n.changeLanguage` from a button, would put the user's choice in a library's internals
 * where the store cannot see it and where nothing persists it. See `docs/adr/0012`.
 *
 * The tenant in focus is deliberately NOT here. It belongs to the URL, which already
 * survives a reload and can be pasted to a colleague; a `selectedTenantId` used to sit
 * beside `locale`, read by nothing, and a remembered selection that disagrees with the
 * address bar is exactly the drift this store exists to prevent.
 *
 * ## Why `persist`, and why only over `locale`
 *
 * A language chosen on one visit and forgotten by the next is not a chosen language. So the
 * locale is written to `localStorage` and read back at startup. The drafts below are not:
 * a half-made choice restored days later, after the thing it referred to may have changed,
 * is worse than an empty form.
 */

// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: The store's initializer is one object literal naming every action the interface has; it grows one entry per verb, and splitting it would put the actions somewhere other than the store that owns them.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.

import type { TestKind } from "@undercroft/contracts/models";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ModelDraft } from "@/lib/modelDraft.ts";

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
  /** Xero: which of the organisations the consent can see. Null until one is chosen. */
  readonly organisation: { readonly id: string; readonly name: string } | null;
  /** Xero: which entities to read. Empty means every one the spec declares, deliberately. */
  readonly entities: string[];
}

interface UiState {
  /** The language every surface is rendered in, and the one the server is asked to answer in. */
  locale: Locale;
  /** Change language. The only writer; `@/i18n` follows this, never the other way round. */
  setLocale: (locale: Locale) => void;
  /** The scope selection in progress, or null when nothing is being edited. */
  scopeDraft: ScopeDraft | null;
  setScopeDraft: (draft: ScopeDraft) => void;
  /** Add or remove one Gmail label. Absent labels mean the whole mailbox, deliberately. */
  toggleScopeLabel: (source: string, label: string) => void;
  /**
   * Put the selection back to none, which for Gmail MEANS the whole mailbox.
   *
   * A verb of its own rather than the component looping `toggleScopeLabel`, because that
   * loop is forty writes for one decision an operator took once, and because the picker
   * reads back the consequence beside the control: clearing has to be the single step the
   * reader is told about.
   */
  clearScopeLabels: (source: string) => void;
  /** Xero: choose the organisation to read. One at a time; a consent that sees several is told which. */
  setScopeOrganisation: (source: string, organisation: { id: string; name: string }) => void;
  /** Xero: add or remove one entity. No entity chosen means every one, deliberately. */
  toggleScopeEntity: (source: string, entity: string) => void;
  /**
   * What the admin has typed into the label index's filter, and which source they typed it
   * against.
   *
   * Client state no endpoint knows about, so it lives here for the same reason the draft
   * does: `useState` is banned, and a second owner of "what is on screen" is how a filter
   * and the list it filters drift apart.
   *
   * It carries its `source` for the same reason `scopeDraft` does, and it is the cheaper of
   * the two ways to get the property that matters -- a word typed against Gmail's labels
   * must not still be narrowing the screen after a move to another source. The alternative
   * was an effect that cleared the field on arrival, which is a SECOND writer racing the
   * first, and one whose reset an operator sees happen. Reading `source` here instead makes
   * a stale filter unrepresentable rather than merely cleaned up afterwards.
   *
   * Deliberately NOT persisted: a filter restored on a later visit hides labels for a
   * reason the reader can no longer see.
   */
  scopeFilter: { source: string; query: string };
  setScopeFilter: (source: string, query: string) => void;
  /**
   * The model being edited, or null. Seeded from `models.get` when the editor opens a model
   * it does not hold, and kept -- unsaved edits survive a visit to another division, and the
   * list says so. Not persisted: a draft restored days later, after a colleague may have
   * changed the model beneath it, is worse than the saved version.
   */
  modelDraft: ModelDraft | null;
  setModelDraft: (draft: ModelDraft | null) => void;
  setModelSql: (sql: string) => void;
  /** Turn one test on or off for one column. */
  setModelTest: (column: string, kind: TestKind, on: boolean) => void;
  addModelTestColumn: (column: string) => void;
  removeModelTestColumn: (column: string) => void;
  /** The server now holds what the draft holds: nothing is unsaved. */
  markModelSaved: () => void;
}

/**
 * The draft for one source, or an empty one when what is held belongs to another source.
 *
 * Every draft write goes through this, so a tick made against Gmail's labels can never land
 * in a draft that was started for Drive: the source is checked once, here, rather than in
 * each action.
 */
function draftFor(held: ScopeDraft | null, source: string): ScopeDraft {
  if (held !== null && held.source === source) {
    return held;
  }
  return { source, labels: [], files: [], organisation: null, entities: [] };
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      setLocale: (locale): unknown => set({ locale }),
      scopeDraft: null,
      setScopeDraft: (scopeDraft): unknown => set({ scopeDraft }),
      toggleScopeLabel: (source, label): unknown =>
        set((state) => {
          const draft = draftFor(state.scopeDraft, source);
          return {
            scopeDraft: {
              ...draft,
              labels: draft.labels.includes(label)
                ? draft.labels.filter((l) => l !== label)
                : [...draft.labels, label],
            },
          };
        }),
      clearScopeLabels: (source): unknown =>
        set((state) => ({ scopeDraft: { ...draftFor(state.scopeDraft, source), labels: [] } })),
      setScopeOrganisation: (source, organisation): unknown =>
        set((state) => ({ scopeDraft: { ...draftFor(state.scopeDraft, source), organisation } })),
      toggleScopeEntity: (source, entity): unknown =>
        set((state) => {
          const draft = draftFor(state.scopeDraft, source);
          return {
            scopeDraft: {
              ...draft,
              entities: draft.entities.includes(entity)
                ? draft.entities.filter((e) => e !== entity)
                : [...draft.entities, entity],
            },
          };
        }),
      scopeFilter: { source: "", query: "" },
      setScopeFilter: (source, query): unknown => set({ scopeFilter: { source, query } }),
      modelDraft: null,
      setModelDraft: (modelDraft): unknown => set({ modelDraft }),
      setModelSql: (sql): unknown =>
        set((state) =>
          state.modelDraft === null ? {} : { modelDraft: { ...state.modelDraft, sql } },
        ),
      setModelTest: (column, kind, on): unknown =>
        set((state) => {
          const draft = state.modelDraft;
          if (draft === null) {
            return {};
          }
          const held = draft.tests[column] ?? [];
          const kinds = on ? [...new Set([...held, kind])] : held.filter((k) => k !== kind);
          return { modelDraft: { ...draft, tests: { ...draft.tests, [column]: kinds } } };
        }),
      addModelTestColumn: (column): unknown =>
        set((state) => {
          const draft = state.modelDraft;
          if (draft === null || column in draft.tests) {
            return {};
          }
          return { modelDraft: { ...draft, tests: { ...draft.tests, [column]: [] } } };
        }),
      removeModelTestColumn: (column): unknown =>
        set((state) => {
          const draft = state.modelDraft;
          if (draft === null) {
            return {};
          }
          const tests = Object.fromEntries(
            Object.entries(draft.tests).filter(([held]) => held !== column),
          );
          return { modelDraft: { ...draft, tests } };
        }),
      markModelSaved: (): unknown =>
        set((state) => {
          const draft = state.modelDraft;
          if (draft === null) {
            return {};
          }
          return { modelDraft: { ...draft, saved: { sql: draft.sql, tests: draft.tests } } };
        }),
    }),
    {
      name: "undercroft.ui",
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
