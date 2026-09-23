/**
 * The SQL editor: CodeMirror 6, self-hosted, loaded only with the leaf that needs it.
 *
 * Self-hosted means no request leaves the origin: the editor is bundled by Vite, so a
 * customer's SQL is typed on a machine that reaches nothing but this server.
 *
 * WHY CODEMIRROR AND NOT MONACO. Monaco is an IDE with an editor inside it: it shipped a
 * 2.4 MB chunk and a web worker for a textarea that holds a SELECT, and its completion needed
 * a hand-written provider, a module-level map keyed by model URI, and a separately imported
 * `suggestController` before a single suggestion could appear on screen -- three pieces of
 * machinery that `@codemirror/lang-sql` answers with one `schema` option. The whole of it is
 * `sql({ dialect: PostgreSQL, schema })`, and what the editor is SET in is this project's own
 * typography rather than a second editor's -- in `@/lib/sqlPaper`, which is where the ink
 * lives so that this file is only what the editor does.
 *
 * Uncontrolled, on purpose. CodeMirror owns its document the way a `<textarea>` owns its
 * value; the parent gives an initial value, hears every change, and remounts by `key` when a
 * different model is opened. Pushing a controlled value back in on every keystroke would move
 * the cursor and fight the undo history. The store is still the owner of the draft --
 * `onChange` writes it there -- and `.claude/rules/state.md` holds: there is no `useState`,
 * and every `useRef` here is a DOM handle or a latch for a callback.
 *
 * THE HOST DIV HAS ONE REACT CHILD: the grip on its bottom edge. CodeMirror APPENDS its own
 * `view.dom` to the parent it is given rather than clearing it, and React never reorders a
 * single static child, so the two live in the same box without either reconciling the
 * other's nodes -- and the grip is out of flow, so it changes no measurement CodeMirror makes.
 * Whether that grip is the live one is decided by the SHEET and not by a prop: in the lake
 * console this editor is a pane inside a window that carries its own edge, and
 * `.workbench__editor > .editor > .grip` is where those two grips are told apart. An editor
 * should not have to know which window it was put in. ADR 0042.
 */

import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, type SQLNamespace, sql } from "@codemirror/lang-sql";
import { bracketMatching, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import type { SchemaResponse } from "@undercroft/contracts";
import { useEffect, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";

import { SizeGrip } from "@/components/SizeGrip.tsx";
import { listing, paper } from "@/lib/sqlPaper.ts";

/**
 * The tables and columns, in the shape `@codemirror/lang-sql` completes from.
 *
 * A column carries its Postgres type as the option's detail, because "amount numeric" and
 * "amount text" are different facts and the author choosing between two columns is the one
 * who needs to know which they are taking.
 */
function namespaceOf(schema: SchemaResponse): SQLNamespace {
  const tables: Record<string, SQLNamespace> = {};
  for (const table of schema.tables) {
    tables[table.name] = table.columns.map((column) => ({
      label: column.name,
      type: "property",
      detail: column.type,
    }));
  }
  return tables;
}

/**
 * The language, in a compartment so it can be replaced without losing the document.
 *
 * IT HAS TO BE RECONFIGURABLE. The schema arrives from a query, so at mount it is still
 * `undefined`; an editor configured once would complete keywords forever and never a table
 * name, which is exactly what "autocomplete does not work" looks like from the outside.
 */
const language = new Compartment();

function languageFor(schema: SchemaResponse | undefined): Extension {
  if (schema === undefined) {
    // Keywords only, and that is honest: an editor that suggested a table the login cannot
    // read would be teaching the author a query that refuses.
    return sql({ dialect: PostgreSQL, upperCaseKeywords: true });
  }
  return sql({ dialect: PostgreSQL, schema: namespaceOf(schema), upperCaseKeywords: true });
}

/**
 * Everything about the language and the look. None of it depends on the caller's callbacks,
 * which is why it is a value rather than a closure.
 */
function editing(
  readOnly: boolean,
  label: string,
  schema: SchemaResponse | undefined,
): Extension[] {
  return [
    lineNumbers(),
    history(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    autocompletion({ icons: false }),
    language.of(languageFor(schema)),
    syntaxHighlighting(listing),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    // CodeMirror renders its own contenteditable; naming it here is what a screen reader
    // announces, and it is why the host below is a plain div.
    EditorView.contentAttributes.of({ "aria-label": label }),
    paper,
  ];
}

/**
 * What the author has selected, or null when they have selected nothing.
 *
 * ONE RULE, TWO ENTRY POINTS: the chord, which CodeMirror hands the view, and a run button
 * elsewhere on the page, which reaches the view through the handle below. Both ask this, so
 * "run the selection" cannot come to mean two slightly different things. The PRIMARY range --
 * a multi-cursor selection has several, and their concatenation is text nobody wrote.
 */
function selectionOf(view: EditorView | null): string | null {
  if (view === null) {
    return null;
  }
  const range = view.state.selection.main;
  return range.empty ? null : view.state.sliceDoc(range.from, range.to);
}

/**
 * The two things the caller owns: the run chord, and hearing every edit.
 *
 * One `keymap.of`, in one array, because precedence here is the array's order and splitting
 * it would put the chord's priority in two places. `Mod-Enter` goes first so Enter's own
 * binding cannot claim it.
 */
function wiring(
  submit: (selected: string | null) => boolean,
  changed: (sql: string) => void,
): Extension[] {
  return [
    keymap.of([
      // The view is the argument CodeMirror already passes, so the chord reads the selection
      // from the state that produced it rather than through a ref that may not be filled yet.
      { key: "Mod-Enter", run: (view): boolean => submit(selectionOf(view)) },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      // Tab indents rather than leaving the editor. Escape first, then Tab, is the way out --
      // CodeMirror's own convention, and the one a screen reader expects.
      indentWithTab,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        changed(update.state.doc.toString());
      }
    }),
  ];
}

/**
 * Build the editor on a host element. Module-level, so the component below reads as the
 * three things it actually does: mount, keep the schema in step, dispose.
 */
function mount(
  element: HTMLElement,
  config: { doc: string; readOnly: boolean; label: string; schema: SchemaResponse | undefined },
  submit: (selected: string | null) => boolean,
  changed: (sql: string) => void,
): EditorView {
  return new EditorView({
    parent: element,
    state: EditorState.create({
      doc: config.doc,
      extensions: [
        ...editing(config.readOnly, config.label, config.schema),
        ...wiring(submit, changed),
      ],
    }),
  });
}

/**
 * Run whatever the caller last passed as `onSubmit`, through the latch rather than the
 * closure the editor was built with -- a console that re-renders with a new callback must
 * not keep running the first one.
 *
 * Returns false when there is nothing to run, which is CodeMirror's word for "not handled":
 * the chord falls through rather than being swallowed by a caller that has no run verb.
 */
function submitVia(
  latch: { current: ((selected: string | null) => void) | undefined },
  selected: string | null,
): boolean {
  const submit = latch.current;
  if (submit === undefined) {
    return false;
  }
  submit(selected);
  return true;
}

/**
 * What a caller with a run button outside the editor can ask it. The button is on the
 * workbench's bar, which has no view to read; without this it would run the whole buffer
 * while the chord ran the selection, and one verb would mean two things.
 */
export interface SqlEditorHandle {
  /** The selected text, or null when the selection is empty. */
  selectedText: () => string | null;
}

interface SqlEditorProps {
  /** The initial text. Later values are ignored; remount by `key` to replace it. */
  value: string;
  onChange: (sql: string) => void;
  /**
   * What Ctrl/Cmd+Enter does, when the caller has something for it to do.
   *
   * The shortcut every SQL console has, because the hand that just finished typing the query
   * is already on the keyboard and reaching for a button is the slowest part of the loop. A
   * caller with no run verb passes nothing and the chord stays unbound rather than bound to
   * a silence.
   *
   * It is handed the selected text, or null when nothing is selected. A caller that runs the
   * whole document either way ignores the argument.
   */
  onSubmit?: (selected: string | null) => void;
  /** Filled with the handle above, for a caller whose run verb is not the chord. */
  ref?: React.Ref<SqlEditorHandle>;
  readOnly?: boolean;
  label: string;
  /** Extra classes on the editor's frame, for a caller that needs a different height. */
  className?: string;
  /** The tables this editor may name, for completion. Absent means keywords only. */
  schema?: SchemaResponse;
}

export function SqlEditor({
  value,
  onChange,
  onSubmit,
  ref,
  readOnly = false,
  label,
  className,
  schema,
}: SqlEditorProps): React.JSX.Element {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const submitRef = useRef(onSubmit);

  useEffect(() => {
    changeRef.current = onChange;
    submitRef.current = onSubmit;
  }, [onChange, onSubmit]);

  useImperativeHandle(
    ref,
    (): SqlEditorHandle => ({ selectedText: (): string | null => selectionOf(viewRef.current) }),
    [],
  );

  useEffect(() => {
    const element = hostRef.current;
    if (element === null) {
      return;
    }

    const view = mount(
      element,
      { doc: value, readOnly, label, schema },
      (selected): boolean => submitVia(submitRef, selected),
      (next): void => {
        changeRef.current(next);
      },
    );
    viewRef.current = view;

    return (): void => {
      viewRef.current = null;
      view.destroy();
    };
  }, [readOnly]);

  /** The schema, whenever it arrives or changes, without disturbing what has been typed. */
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }
    view.dispatch({ effects: language.reconfigure(languageFor(schema)) });
  }, [schema]);

  return (
    <div
      ref={hostRef}
      className={["editor", readOnly ? "editor--readonly" : "", className ?? ""]
        .filter((name) => name !== "")
        .join(" ")}
    >
      <SizeGrip axis="block" label={t("grip.editorHeight")} />
    </div>
  );
}
