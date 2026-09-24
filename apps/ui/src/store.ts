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
import { type LakeRun, planRun } from "@/lib/statements.ts";

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
  /**
   * Drive: whether a picked folder is read to the bottom, or one level only.
   *
   * False is what an unvisited form means, and what every selection saved before this
   * existed means. ADR 0031.
   */
  readonly recurse: boolean;
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
  /**
   * Tick every label the mailbox listed, keeping any already ticked that it did not list.
   *
   * NOT the same decision as clearing. A full list is a closed filter: only mail carrying one
   * of these labels is read, and a label created later is not added to it. The three
   * `selectAll*` verbs share one rule -- a union, never a replacement -- so pressing one can
   * only add ticks and never silently drop one. `withEvery` below is that rule.
   */
  selectAllScopeLabels: (source: string, offered: readonly string[]) => void;
  /** Xero: choose the organisation to read. One at a time; a consent that sees several is told which. */
  setScopeOrganisation: (source: string, organisation: { id: string; name: string }) => void;
  /** Xero: add or remove one entity. No entity chosen means every one, deliberately. */
  toggleScopeEntity: (source: string, entity: string) => void;
  /** Xero: put the entity choice back to none, which means every entity the spec declares. */
  clearScopeEntities: (source: string) => void;
  /**
   * Xero: tick every entity the picker offers, keeping any already ticked that it does not.
   * Closed like the other two: an entity the spec gains later is not read until it is ticked.
   */
  selectAllScopeEntities: (source: string, offered: readonly string[]) => void;
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
   * Tick every curated file type, keeping a custom one the admin typed in. A closed list: a
   * type on neither is not read, which is exactly what an empty choice does NOT mean.
   */
  selectAllScopeFileTypes: (source: string, offered: readonly string[]) => void;
  /** Drive: turn reading sub-folders on or off. ADR 0031. */
  toggleScopeRecurse: (source: string) => void;
  /**
   * Drive: add what one Picker session chose to what is already chosen.
   *
   * Adds, never replaces. Google's Picker opens with nothing ticked and cannot be told what was
   * chosen before, so a session that replaced the list left an admin who picked two folders in
   * two sessions with one (#197). A pick already held keeps its place and is not listed again:
   * the id is what a run reads, so two entries with one id are one folder read twice over.
   */
  addScopeFiles: (source: string, picked: readonly ChosenFile[]) => void;
  /** Drive: take one pick off the list. The Picker can only add, so this is the way back. */
  removeScopeFile: (source: string, id: string) => void;
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
   * What the console's last press committed, per tenant: the statements it is running.
   *
   * THE PRESS IS THE COMMIT, and this is the record of it. The editor's text changes under
   * every keystroke; what is on screen underneath must not, or a reader who starts typing
   * their next question watches the answer to the last one rearrange itself. So the text is
   * split at the press and the statements are kept here, and the panes below read this
   * rather than `lakeSql`.
   *
   * Which PAGE each of those panes is on is deliberately not here: every pane runs its own
   * mutation, so the offset it last asked for is already a fact of that mutation, and a
   * second copy in this store would be two answers to one question. See `state.md`.
   */
  lakeRun: Record<string, LakeRun>;
  /** Commit a run over `text` -- the whole buffer, or what the author had selected. */
  startLakeRun: (tenantId: string, text: string, fromSelection: boolean) => void;
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

  /**
   * Which refusal reason is unfolded on a run's leaf, per run id; absent is none.
   *
   * Per run rather than one value, because the journal can hold more than one run's leaf open
   * at a time -- a single field would close a reason on the run above the moment a reader
   * opened one on the run below, which reads as the page fighting them.
   *
   * Not in the URL, unlike the open RUN. A run's detail is a thing an operator pastes to a
   * colleague mid-call; which of its reasons they had unfolded while reading is not, and
   * putting it in the address bar would make every fold a history entry to press Back
   * through. Client-only, so the store owns it and no component keeps a second copy
   * (`state.md`).
   */
  openReason: Record<string, string>;
  /** Unfold this reason, or fold it if it is the one already open on that run. */
  toggleReason: (runId: string, reason: string) => void;
  /**
   * Which document source has its refusal reasons unfolded on the lake's index, per tenant;
   * absent is none. One per tenant, like a run's reason: the rollup unfolds under its own row,
   * and two open at once would push the rows between them apart for no reading anyone asked
   * for. Client-only and not in the URL, for the same reason `openReason` is not.
   */
  openLakeRefusals: Record<string, string>;
  /** Unfold this source's refusals, or fold them if they are the ones already open. */
  toggleLakeRefusals: (tenantId: string, source: string) => void;

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
  /**
   * Whether the interleaf is hinged open.
   *
   * Client state with no endpoint behind it, so the store owns it rather than `useState` --
   * which is banned here and gated by ast-grep (`.claude/rules/state.md`). It is deliberately
   * NOT per-customer: the assistant follows the reader across divisions and customers the way
   * a hand in the margin does, and an open panel that closed itself on a tab change would read
   * as the application losing it.
   */
  assistantOpen: boolean;
  toggleAssistant: () => void;
  /**
   * The question being typed, before it is sent.
   *
   * In the store rather than in the input, for the reason every other draft here is: the
   * interleaf is `React.lazy`-loaded and unmounts when it closes, and a reader who closed the
   * panel mid-sentence should find the sentence still there. Cleared by whoever sends it.
   */
  assistantDraft: string;
  setAssistantDraft: (draft: string) => void;
  /**
   * What the reader has typed into a privileged proof's confirmation field.
   *
   * One value rather than one per proof, because only one proof is ever awaiting an answer: the
   * model stops at an approval request and asks nothing else until it has one. Keying it by
   * approval id would be a map that never holds two entries.
   */
  assistantConfirm: string;
  setAssistantConfirm: (typed: string) => void;
  /**
   * Which account of a kind the reader chose to look at, per tenant and kind. Read it through
   * `chosenAccount`, which is the only other place that knows how it is keyed.
   *
   * Only an explicit choice is stored. Which account shows when nobody has chosen -- the
   * first -- is derived from the list every render (`selectedFor` in
   * `@/lib/connectionState`), so a disconnected account cannot leave a stale default behind.
   * Not persisted: which mailbox somebody was reading last week is not a preference.
   */
  selectedAccount: Record<string, string>;
  /** Show this account of `kind`. Also called once a newly added account is scoped. */
  selectAccount: (tenantId: string, kind: string, source: string) => void;
}

/** One tenant's one kind, as `selectedAccount` is keyed. Nothing outside this file builds it. */
function accountKey(tenantId: string, kind: string): string {
  return `${tenantId}|${kind}`;
}

/** The account of `kind` the reader chose on `tenantId`'s schedule, if they chose one. */
export function chosenAccount(
  state: { readonly selectedAccount: Readonly<Record<string, string>> },
  tenantId: string,
  kind: string,
): string | undefined {
  return state.selectedAccount[accountKey(tenantId, kind)];
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
  return {
    source,
    labels: [],
    files: [],
    organisation: null,
    entities: [],
    fileTypes: [],
    recurse: false,
  };
}

/**
 * What "select all" -- or a Drive pick -- leaves chosen: everything already held, in its place,
 * then each offered entry not yet held, once, told apart by `key`.
 *
 * A union rather than `offered` alone, because what is held can be more than what is shown --
 * a custom file type the admin typed, a label saved last month that the mailbox no longer
 * lists, a folder picked in an earlier Picker session -- and replacing the list with what is
 * on screen would drop that entry without a word.
 */
function withEvery<T>(held: readonly T[], offered: readonly T[], key: (entry: T) => string): T[] {
  const seen = new Set(held.map(key));
  const added: T[] = [];
  for (const entry of offered) {
    if (!seen.has(key(entry))) {
      seen.add(key(entry));
      added.push(entry);
    }
  }
  return [...held, ...added];
}

/** A tick-list entry is its own key. */
function itself(entry: string): string {
  return entry;
}

/** How a slice writes: Zustand's partial setter, narrowed to this store. */
type Setter = (partial: Partial<UiState> | ((state: UiState) => Partial<UiState>)) => void;

/**
 * The three verbs every scope tick-list answers -- one entry, none, every offered one -- written
 * once for all three lists.
 *
 * Gmail's labels, Xero's entities and the file types are the same control over a different
 * field of the draft, and three hand-copied toggles were three places for "the source is
 * checked by `draftFor`" or "select all is a union" to be forgotten in one of them. The field
 * name stays inside this file: the store's interface still speaks `toggleScopeLabel`, so no
 * component learns how a draft is laid out.
 */
function tickList(
  set: Setter,
  field: "labels" | "entities" | "fileTypes",
): {
  toggle: (source: string, entry: string) => unknown;
  clear: (source: string) => unknown;
  selectAll: (source: string, offered: readonly string[]) => unknown;
} {
  function rewrite(source: string, next: (held: readonly string[]) => string[]): unknown {
    return set((state) => {
      const draft = draftFor(state.scopeDraft, source);
      return { scopeDraft: { ...draft, [field]: next(draft[field]) } };
    });
  }

  return {
    toggle: (source, entry): unknown =>
      rewrite(source, (held) =>
        held.includes(entry) ? held.filter((e) => e !== entry) : [...held, entry],
      ),
    clear: (source): unknown => rewrite(source, () => []),
    selectAll: (source, offered): unknown =>
      rewrite(source, (held) => withEvery(held, offered, itself)),
  };
}

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
  | "selectAllScopeLabels"
  | "setScopeOrganisation"
  | "toggleScopeEntity"
  | "clearScopeEntities"
  | "selectAllScopeEntities"
  | "toggleScopeFileType"
  | "clearScopeFileTypes"
  | "selectAllScopeFileTypes"
  | "toggleScopeRecurse"
  | "addScopeFiles"
  | "removeScopeFile"
  | "fileTypeInput"
  | "setFileTypeInput"
  | "scopeFilter"
  | "setScopeFilter"
> {
  const labels = tickList(set, "labels");
  const entities = tickList(set, "entities");
  const fileTypes = tickList(set, "fileTypes");

  return {
    scopeDraft: null,
    setScopeDraft: (scopeDraft): unknown => set({ scopeDraft }),
    toggleScopeLabel: labels.toggle,
    clearScopeLabels: labels.clear,
    selectAllScopeLabels: labels.selectAll,
    setScopeOrganisation: (source, organisation): unknown =>
      set((state) => ({ scopeDraft: { ...draftFor(state.scopeDraft, source), organisation } })),
    toggleScopeEntity: entities.toggle,
    clearScopeEntities: entities.clear,
    selectAllScopeEntities: entities.selectAll,
    toggleScopeFileType: fileTypes.toggle,
    clearScopeFileTypes: fileTypes.clear,
    selectAllScopeFileTypes: fileTypes.selectAll,
    toggleScopeRecurse: (source): unknown =>
      set((state) => {
        const draft = draftFor(state.scopeDraft, source);
        return { scopeDraft: { ...draft, recurse: !draft.recurse } };
      }),
    addScopeFiles: (source, picked): unknown =>
      set((state) => {
        const draft = draftFor(state.scopeDraft, source);
        return { scopeDraft: { ...draft, files: withEvery(draft.files, picked, (f) => f.id) } };
      }),
    removeScopeFile: (source, id): unknown =>
      set((state) => {
        const draft = draftFor(state.scopeDraft, source);
        return { scopeDraft: { ...draft, files: draft.files.filter((f) => f.id !== id) } };
      }),
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
  | "lakeRun"
  | "startLakeRun"
  | "lakeOpened"
  | "setLakeOpened"
  | "lakeRailFolded"
  | "toggleLakeRail"
  | "openReason"
  | "toggleReason"
  | "openLakeRefusals"
  | "toggleLakeRefusals"
> {
  return {
    lakeSql: {},
    // Typing does not disturb what is already on screen: the panes below answer the run that
    // was pressed, and a keystroke is not a press.
    setLakeSql: (tenantId, sql): unknown =>
      set((state) => ({ lakeSql: { ...state.lakeSql, [tenantId]: sql } })),
    lakeRun: {},
    startLakeRun: (tenantId, text, fromSelection): unknown =>
      set((state) => ({
        lakeRun: {
          ...state.lakeRun,
          [tenantId]: planRun(state.lakeRun[tenantId], text, fromSelection),
        },
      })),
    lakeOpened: {},
    setLakeOpened: (tenantId, streamKey): unknown =>
      set((state) => ({ lakeOpened: { ...state.lakeOpened, [tenantId]: streamKey } })),
    // Open by default: an author who has just arrived does not know what they may name, and
    // a reference they have to discover a control to see is one most of them never see.
    lakeRailFolded: false,
    toggleLakeRail: (): unknown => set((state) => ({ lakeRailFolded: !state.lakeRailFolded })),
    openReason: {},
    toggleReason: (runId, reason): unknown =>
      set((state) => ({ openReason: toggleOpen(state.openReason, runId, reason) })),
    openLakeRefusals: {},
    toggleLakeRefusals: (tenantId, source): unknown =>
      set((state) => ({ openLakeRefusals: toggleOpen(state.openLakeRefusals, tenantId, source) })),
  };
}

/**
 * Open `key` in `scope`, or close it if it is the one already open there.
 *
 * Pressing the open thing again closes it, which is what a reader expects of a thing that
 * opened when they pressed it. The scope is dropped rather than set to `""`, so "closed" and
 * "opened on a key with no name" cannot be the same stored value.
 */
function toggleOpen(
  open: Record<string, string>,
  scope: string,
  key: string,
): Record<string, string> {
  const { [scope]: current, ...rest } = open;
  return current === key ? rest : { ...rest, [scope]: key };
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

/**
 * The interleaf: whether it is open, and what is half-typed in it.
 *
 * Neither is persisted. `partialize` keeps only the locale, and that is right here too: a
 * half-typed question restored days later, against a customer the reader may no longer have
 * open, is a sentence they did not write in a place they did not leave it.
 */
function assistantSlice(
  set: Setter,
): Pick<
  UiState,
  | "assistantOpen"
  | "toggleAssistant"
  | "assistantDraft"
  | "setAssistantDraft"
  | "assistantConfirm"
  | "setAssistantConfirm"
> {
  return {
    assistantOpen: false,
    toggleAssistant: (): unknown => set((state) => ({ assistantOpen: !state.assistantOpen })),
    assistantDraft: "",
    setAssistantDraft: (assistantDraft): unknown => set({ assistantDraft }),
    assistantConfirm: "",
    setAssistantConfirm: (assistantConfirm): unknown => set({ assistantConfirm }),
  };
}

/** Which account of each multi-account kind is on show. See `selectedAccount`. */
function accountSlice(set: Setter): Pick<UiState, "selectedAccount" | "selectAccount"> {
  return {
    selectedAccount: {},
    selectAccount: (tenantId, kind, source): unknown =>
      set((state) => ({
        selectedAccount: { ...state.selectedAccount, [accountKey(tenantId, kind)]: source },
      })),
  };
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...localeSlice(set),
      ...accountSlice(set),
      ...scopeSlice(set),
      ...lakeSlice(set),
      ...modelSlice(set),
      ...questionSlice(set),
      ...dashboardSlice(set),
      ...assistantSlice(set),
    }),
    {
      name: "undercroft.ui",
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
);
