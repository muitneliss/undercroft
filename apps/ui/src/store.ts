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

import type {
  ChartConfig,
  DashboardFilter,
  DashboardLayout,
  VisualDefinition,
} from "@undercroft/contracts/bi";
import type { TestKind } from "@undercroft/contracts/models";
import { DEFAULT_LOCALE, type Locale } from "@undercroft/core/locale";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DashboardDraft } from "@/lib/dashboardDraft.ts";
import type { ModelDraft } from "@/lib/modelDraft.ts";
import { patchVisual, type QuestionDraft, switchToSql } from "@/lib/questionDraft.ts";

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
  /**
   * Gmail and Drive: which MIME types to land. Empty means every type -- the same
   * recorded-decision idiom as empty labels or entities, not an absent choice.
   */
  readonly fileTypes: string[];
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
  /** Gmail and Drive: add or remove one file type. No type chosen means every one, deliberately. */
  toggleScopeFileType: (source: string, fileType: string) => void;
  /**
   * Put the file-type choice back to none, which means every file type.
   *
   * A verb of its own for the reason `clearScopeLabels` is: one step an operator took once,
   * read back beside the control it changed, rather than a loop of individual removals.
   */
  clearScopeFileTypes: (source: string) => void;
  /**
   * What the admin has typed into the custom-file-type field, and which source they typed it
   * against.
   *
   * The same reasoning as `scopeFilter` below: `useState` is banned, this value has no
   * endpoint until Add is pressed, and it carries its `source` so a half-typed MIME type
   * against Gmail cannot survive a move to Drive's picker.
   */
  fileTypeInput: { source: string; value: string };
  setFileTypeInput: (source: string, value: string) => void;
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
  /**
   * The SQL typed into the raw lake's console, per tenant.
   *
   * Keyed by tenant because the console is about ONE customer's lake and a query written
   * against another's tables would be answered with a refusal the author did not earn. Not
   * persisted, for the same reason `modelDraft` is not: this is a scratch query, and one
   * restored days later is not one anybody asked for.
   */
  lakeSql: Record<string, string>;
  setLakeSql: (tenantId: string, sql: string) => void;
  /**
   * Which page of the console's result the reader is on, per tenant.
   *
   * Here rather than in the query cache because it is a thing the reader chose, not a thing
   * the server knows -- and it resets to the first page whenever the SQL changes, because a
   * new question answered from page four is nobody's question.
   */
  lakeOffset: Record<string, number>;
  setLakeOffset: (tenantId: string, offset: number) => void;
  /**
   * Which stream the console last wrote itself a query for, per tenant, as a `streamKey`.
   *
   * This exists to make opening a line of the index happen ONCE. The console seeds itself
   * from the stream in the URL, and without a record of what it has already seeded it would
   * re-seed on every render -- throwing away whatever the reader had typed since, which is
   * the one thing a scratch editor must never do. Compare, seed, record: a reader who edits
   * the generated query keeps their edit, and a reader who opens a different line gets that
   * line's query.
   */
  lakeOpened: Record<string, string>;
  setLakeOpened: (tenantId: string, streamKey: string) => void;
  /**
   * Whether the workbench's table reference is folded away to its spine.
   *
   * Not per tenant: it is a fact about how this reader is working right now -- writing a
   * query, when the names are what they reach for, or reading a wide answer, when every
   * column of the grid is worth more than the reference. Not persisted either, like every
   * draft here: a fold restored days later is a rail somebody has to go and find.
   */
  lakeRailFolded: boolean;
  toggleLakeRail: () => void;

  modelDraft: ModelDraft | null;
  setModelDraft: (draft: ModelDraft | null) => void;
  setModelSql: (sql: string) => void;
  /** Turn one test on or off for one column. */
  setModelTest: (column: string, kind: TestKind, on: boolean) => void;
  addModelTestColumn: (column: string) => void;
  removeModelTestColumn: (column: string) => void;
  /** The server now holds what the draft holds: nothing is unsaved. */
  markModelSaved: () => void;
  /** The question being edited, or null. Same rules as `modelDraft`. */
  questionDraft: QuestionDraft | null;
  setQuestionDraft: (draft: QuestionDraft | null) => void;
  setQuestionName: (name: string) => void;
  /** The builder's definition with `patch` applied. No effect on a SQL question. */
  patchQuestionVisual: (patch: Partial<Omit<VisualDefinition, "kind">>) => void;
  setQuestionSql: (sql: string) => void;
  /** One way: the builder's compiled SQL becomes the question. */
  switchQuestionToSql: (sql: string) => void;
  setQuestionChart: (chart: ChartConfig) => void;
  /** The server now holds what the draft holds, under `id`. */
  markQuestionSaved: (id: string) => void;
  /** The dashboard being edited, or null. Same rules as `questionDraft`. */
  dashboardDraft: DashboardDraft | null;
  setDashboardDraft: (draft: DashboardDraft | null) => void;
  setDashboardName: (name: string) => void;
  /** The grid after one of `lib/dashboardLayout.ts`'s moves. */
  setDashboardLayout: (layout: DashboardLayout) => void;
  setDashboardFilters: (filters: DashboardFilter[]) => void;
  /** The server now holds what the draft holds, under `id`. */
  markDashboardSaved: (id: string) => void;
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
  return { source, labels: [], files: [], organisation: null, entities: [], fileTypes: [] };
}

/** How a slice writes: Zustand's partial setter, narrowed to this store. */
type Setter = (partial: Partial<UiState> | ((state: UiState) => Partial<UiState>)) => void;

/** The interface language, and the only slice that is persisted. */
function localeSlice(set: Setter): Pick<UiState, "locale" | "setLocale"> {
  return {
    locale: DEFAULT_LOCALE,
    setLocale: (locale): unknown => set({ locale }),
  };
}

/** What an admin is choosing a source may read, before they save it. */
function scopeSlice(
  set: Setter,
): Pick<
  UiState,
  | "scopeDraft"
  | "setScopeDraft"
  | "toggleScopeLabel"
  | "clearScopeLabels"
  | "setScopeOrganisation"
  | "toggleScopeEntity"
  | "toggleScopeFileType"
  | "clearScopeFileTypes"
  | "fileTypeInput"
  | "setFileTypeInput"
  | "scopeFilter"
  | "setScopeFilter"
> {
  return {
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
    toggleScopeFileType: (source, fileType): unknown =>
      set((state) => {
        const draft = draftFor(state.scopeDraft, source);
        return {
          scopeDraft: {
            ...draft,
            fileTypes: draft.fileTypes.includes(fileType)
              ? draft.fileTypes.filter((f) => f !== fileType)
              : [...draft.fileTypes, fileType],
          },
        };
      }),
    clearScopeFileTypes: (source): unknown =>
      set((state) => ({ scopeDraft: { ...draftFor(state.scopeDraft, source), fileTypes: [] } })),
    fileTypeInput: { source: "", value: "" },
    setFileTypeInput: (source, value): unknown => set({ fileTypeInput: { source, value } }),
    scopeFilter: { source: "", query: "" },
    setScopeFilter: (source, query): unknown => set({ scopeFilter: { source, query } }),
  };
}

/** A dbt model being edited: its SQL and the tests on each column. */
/** The raw lake console's scratch SQL, one per tenant. Not persisted; see the type above. */
function lakeSlice(
  set: Setter,
): Pick<
  UiState,
  | "lakeSql"
  | "setLakeSql"
  | "lakeOffset"
  | "setLakeOffset"
  | "lakeOpened"
  | "setLakeOpened"
  | "lakeRailFolded"
  | "toggleLakeRail"
> {
  return {
    lakeSql: {},
    // Editing the query returns the reader to the first page: the offset belonged to the
    // previous question, and carrying it over answers the new one from the middle.
    setLakeSql: (tenantId, sql): unknown =>
      set((state) => ({
        lakeSql: { ...state.lakeSql, [tenantId]: sql },
        lakeOffset: { ...state.lakeOffset, [tenantId]: 0 },
      })),
    lakeOffset: {},
    setLakeOffset: (tenantId, offset): unknown =>
      set((state) => ({ lakeOffset: { ...state.lakeOffset, [tenantId]: offset } })),
    lakeOpened: {},
    setLakeOpened: (tenantId, streamKey): unknown =>
      set((state) => ({ lakeOpened: { ...state.lakeOpened, [tenantId]: streamKey } })),
    // Open by default: an author who has just arrived does not know what they may name, and
    // a reference they have to discover a control to see is one most of them never see.
    lakeRailFolded: false,
    toggleLakeRail: (): unknown => set((state) => ({ lakeRailFolded: !state.lakeRailFolded })),
  };
}

function modelSlice(
  set: Setter,
): Pick<
  UiState,
  | "modelDraft"
  | "setModelDraft"
  | "setModelSql"
  | "setModelTest"
  | "addModelTestColumn"
  | "removeModelTestColumn"
  | "markModelSaved"
> {
  return {
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
  };
}

/** A question being built: its name, its visual, and the SQL behind it. */
function questionSlice(
  set: Setter,
): Pick<
  UiState,
  | "questionDraft"
  | "setQuestionDraft"
  | "setQuestionName"
  | "patchQuestionVisual"
  | "setQuestionSql"
  | "switchQuestionToSql"
  | "setQuestionChart"
  | "markQuestionSaved"
> {
  return {
    questionDraft: null,
    setQuestionDraft: (questionDraft): unknown => set({ questionDraft }),
    setQuestionName: (name): unknown =>
      set((state) =>
        state.questionDraft === null ? {} : { questionDraft: { ...state.questionDraft, name } },
      ),
    patchQuestionVisual: (patch): unknown =>
      set((state) =>
        state.questionDraft === null
          ? {}
          : { questionDraft: patchVisual(state.questionDraft, patch) },
      ),
    setQuestionSql: (sql): unknown =>
      set((state) =>
        state.questionDraft === null || state.questionDraft.definition.kind !== "sql"
          ? {}
          : { questionDraft: { ...state.questionDraft, definition: { kind: "sql", sql } } },
      ),
    switchQuestionToSql: (sql): unknown =>
      set((state) =>
        state.questionDraft === null
          ? {}
          : { questionDraft: switchToSql(state.questionDraft, sql) },
      ),
    setQuestionChart: (chart): unknown =>
      set((state) =>
        state.questionDraft === null ? {} : { questionDraft: { ...state.questionDraft, chart } },
      ),
    markQuestionSaved: (id): unknown =>
      set((state) => {
        const draft = state.questionDraft;
        if (draft === null) {
          return {};
        }
        return {
          questionDraft: {
            ...draft,
            id,
            saved: { name: draft.name, definition: draft.definition, chart: draft.chart },
          },
        };
      }),
  };
}

/** A dashboard being arranged: its name, its filters and its layout. */
function dashboardSlice(
  set: Setter,
): Pick<
  UiState,
  | "dashboardDraft"
  | "setDashboardDraft"
  | "setDashboardName"
  | "setDashboardLayout"
  | "setDashboardFilters"
  | "markDashboardSaved"
> {
  return {
    dashboardDraft: null,
    setDashboardDraft: (dashboardDraft): unknown => set({ dashboardDraft }),
    setDashboardName: (name): unknown =>
      set((state) =>
        state.dashboardDraft === null ? {} : { dashboardDraft: { ...state.dashboardDraft, name } },
      ),
    setDashboardLayout: (layout): unknown =>
      set((state) =>
        state.dashboardDraft === null
          ? {}
          : { dashboardDraft: { ...state.dashboardDraft, layout } },
      ),
    setDashboardFilters: (filters): unknown =>
      set((state) =>
        state.dashboardDraft === null
          ? {}
          : { dashboardDraft: { ...state.dashboardDraft, filters } },
      ),
    markDashboardSaved: (id): unknown =>
      set((state) => {
        const draft = state.dashboardDraft;
        if (draft === null) {
          return {};
        }
        return {
          dashboardDraft: {
            ...draft,
            id,
            saved: { name: draft.name, layout: draft.layout, filters: draft.filters },
          },
        };
      }),
  };
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...localeSlice(set),
      ...scopeSlice(set),
      ...lakeSlice(set),
      ...modelSlice(set),
      ...questionSlice(set),
      ...dashboardSlice(set),
    }),
    {
      name: "undercroft.ui",
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
