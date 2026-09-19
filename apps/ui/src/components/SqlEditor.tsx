/**
 * The SQL editor: Monaco, self-hosted, loaded only with the Models route.
 *
 * Self-hosted means no request leaves the origin: the editor core and its worker are
 * bundled by Vite (`?worker`) rather than fetched from a CDN, which is what lets a
 * customer's SQL be typed on a machine that reaches nothing but this server.
 *
 * Uncontrolled, on purpose. Monaco owns its text model the way a `<textarea>` owns its
 * value; the parent gives an initial value and hears every changeRef, and remounts the editor
 * by `key` when a different model is opened. Pushing a controlled value back into Monaco on
 * every keystroke would move the cursor and fight the undo stack. The store is still the
 * owner of the draft -- `onChange` writes it there -- and `.claude/rules/state.md` holds:
 * there is no `useState`, and the one `useRef` is a DOM handle.
 */

import { editor as monacoEditor } from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import { useEffect, useRef } from "react";

// Monaco asks the page for a worker factory; without one it falls back to the main thread
// and warns on every keystroke. One worker serves the SQL language.
window.MonacoEnvironment = { getWorker: (): Worker => new EditorWorker() };

/** The mono face the rest of the interface sets in CSS, so the editor is the same page. */
function monoFace(): string {
  const face = getComputedStyle(document.documentElement).getPropertyValue("--face-mono").trim();
  return face === "" ? "monospace" : face;
}

export function SqlEditor({
  value,
  onChange,
  readOnly = false,
  label,
}: {
  /** The initial text. Later values are ignored; remount by `key` to replace it. */
  value: string;
  onChange: (sql: string) => void;
  readOnly?: boolean;
  label: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLElement>(null);
  const changeRef = useRef(onChange);

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = hostRef.current;
    if (element === null) {
      return;
    }
    const editor = monacoEditor.create(element, {
      value,
      language: "sql",
      theme: "vs",
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: monoFace(),
      fontSize: 13,
      lineNumbers: "on",
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 4,
      renderLineHighlight: "line",
    });
    const listening = editor.onDidChangeModelContent(() => {
      changeRef.current(editor.getValue());
    });
    return (): void => {
      listening.dispose();
      editor.dispose();
    };
  }, [readOnly]);

  // A named region, not a textbox: Monaco renders its own textbox inside, with its own name.
  return (
    <section
      ref={hostRef}
      className={readOnly ? "editor editor--readonly" : "editor"}
      aria-label={label}
    />
  );
}
