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
 * `sql({ dialect: PostgreSQL, schema })`, and what is left in this file is this project's
 * own typography rather than a second editor's.
 *
 * Uncontrolled, on purpose. CodeMirror owns its document the way a `<textarea>` owns its
 * value; the parent gives an initial value, hears every change, and remounts by `key` when a
 * different model is opened. Pushing a controlled value back in on every keystroke would move
 * the cursor and fight the undo history. The store is still the owner of the draft --
 * `onChange` writes it there -- and `.claude/rules/state.md` holds: there is no `useState`,
 * and every `useRef` here is a DOM handle or a latch for a callback.
 */

import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { PostgreSQL, type SQLNamespace, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import type { SchemaResponse } from "@undercroft/contracts";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";

/**
 * Syntax in ONE ink, plus two.
 *
 * A printed code listing distinguishes a keyword by weight, not by colour, and this
 * interface is printed matter end to end -- an editor lit up in an IDE's blue and purple
 * would be the one surface in the book that came from somewhere else. So: keywords take
 * weight, a comment takes the faintest ink, and exactly two hues from the section wheel mark
 * the two things a reader genuinely scans a query for -- the literal values it contains.
 */
const listing = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], fontWeight: "700" },
  { tag: [tags.comment], color: "var(--ink-3)", fontStyle: "italic" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--hue-grass)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--hue-sienna)" },
  { tag: [tags.typeName, tags.standard(tags.name)], color: "var(--hue-teal)" },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: "var(--ink-2)" },
  { tag: [tags.invalid], color: "var(--errata-ink)" },
]);

/**
 * The editor's own typography, taken from the page's tokens rather than restated.
 *
 * `&` is CodeMirror's own root. `height: 100%` is what lets a caller size the editor by
 * sizing its host -- the console gives its editor a pane it can drag, the model editor gives
 * it a fixed leaf, and neither has to know anything about CodeMirror to do it.
 */
const paper = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--ink)",
    backgroundColor: "var(--leaf)",
    fontSize: "var(--t-small)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--face-mono)",
    lineHeight: "1.7",
    overflow: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: "var(--rule-strong) transparent",
  },
  ".cm-content": { padding: "var(--s-3) 0", caretColor: "var(--ink)" },
  ".cm-line": { padding: "0 var(--s-4)" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--ink-3)",
    border: "none",
    borderRight: "var(--hair) solid var(--rule)",
    paddingRight: "var(--s-1)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--s-2) 0 var(--s-3)" },
  ".cm-activeLine": { backgroundColor: "rgba(22, 21, 15, 0.035)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgba(35, 76, 158, 0.18)",
  },
  ".cm-selectionMatch": { backgroundColor: "rgba(237, 166, 0, 0.28)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "rgba(237, 166, 0, 0.32)",
    outline: "none",
  },
  // The completion list is a leaf lying over the page: a hairline and the board stock, the
  // same die every other panel in the interface is cut from.
  ".cm-tooltip": {
    backgroundColor: "var(--leaf)",
    border: "var(--hair) solid var(--rule-strong)",
    borderRadius: "var(--r-plate)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--face-mono)",
    fontSize: "var(--t-small)",
    maxHeight: "16rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "var(--s-1) var(--s-3)" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--ink)",
    color: "var(--leaf)",
  },
  ".cm-completionLabel": { fontFamily: "var(--face-mono)" },
  ".cm-completionDetail": {
    marginLeft: "var(--s-3)",
    color: "var(--ink-3)",
    fontStyle: "normal",
    fontSize: "var(--t-micro)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "var(--bone)",
  },
});

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
 * The two things the caller owns: the run chord, and hearing every edit.
 *
 * One `keymap.of`, in one array, because precedence here is the array's order and splitting
 * it would put the chord's priority in two places. `Mod-Enter` goes first so Enter's own
 * binding cannot claim it.
 */
function wiring(submit: () => boolean, changed: (sql: string) => void): Extension[] {
  return [
    keymap.of([
      { key: "Mod-Enter", run: submit },
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
  submit: () => boolean,
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
function submitVia(latch: { current: (() => void) | undefined }): boolean {
  const submit = latch.current;
  if (submit === undefined) {
    return false;
  }
  submit();
  return true;
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
   */
  onSubmit?: () => void;
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
  readOnly = false,
  label,
  className,
  schema,
}: SqlEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const submitRef = useRef(onSubmit);

  useEffect(() => {
    changeRef.current = onChange;
    submitRef.current = onSubmit;
  }, [onChange, onSubmit]);

  useEffect(() => {
    const element = hostRef.current;
    if (element === null) {
      return;
    }

    const view = mount(
      element,
      { doc: value, readOnly, label, schema },
      (): boolean => submitVia(submitRef),
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
    />
  );
}
