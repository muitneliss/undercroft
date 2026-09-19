/**
 * The SQL editor: Monaco, self-hosted, loaded only with the Models route.
 *
 * Self-hosted means no request leaves the origin: the editor core and its worker are
 * bundled by Vite (`?worker`) rather than fetched from a CDN, which is what lets a
 * customer's SQL be typed on a machine that reaches nothing but this server.
 *
 * Uncontrolled, on purpose. Monaco owns its text model the way a `<textarea>` owns its
 * value; the parent gives an initial value and hears every change, and remounts the editor
 * by `key` when a different model is opened. Pushing a controlled value back into Monaco on
 * every keystroke would move the cursor and fight the undo stack. The store is still the
 * owner of the draft -- `onChange` writes it there -- and `.claude/rules/state.md` holds:
 * there is no `useState`, and the one `useRef` is a DOM handle.
 */

// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useExhaustiveDependencies: The editor takes its initial value ONCE, at mount; the parent remounts it by key when the model changes. Listing `value` would re-create the editor on every keystroke, which is the controlled-input mistake the docstring describes.
// biome-ignore-all lint/nursery/useReactCompiler: The change handler is kept in a ref so the editor, created once, always calls the latest one. The compiler reads a ref written in an effect as a hazard; here it is the documented way to hand an imperative library a callback that may change.
// biome-ignore-all lint/nursery/useReactNamingConvention: Fires on the `host` and `change` handles, which it wants suffixed `Ref`. They are named for what they hold -- the element Monaco mounts in, the handler it calls -- which is how the effect reads, and the convention this follows is DisplayNameForm's beside it.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useGlobalThis: Monaco declares `MonacoEnvironment` on `Window`, not on `globalThis`; the property is typed only through `window`, and the worker factory has to land where Monaco reads it.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

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
  const host = useRef<HTMLElement>(null);
  const change = useRef(onChange);

  useEffect(() => {
    change.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const element = host.current;
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
      change.current(editor.getValue());
    });
    return (): void => {
      listening.dispose();
      editor.dispose();
    };
  }, [readOnly]);

  // A named region, not a textbox: Monaco renders its own textbox inside, with its own name.
  return (
    <section
      ref={host}
      className={readOnly ? "editor editor--readonly" : "editor"}
      aria-label={label}
    />
  );
}
