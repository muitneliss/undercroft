/**
 * A sentence that arrives after a press -- "Copied", "Saved", "Saving…" -- printed where it
 * belongs and read aloud when it does (WCAG 4.1.3).
 *
 * ## Why the element outlives its text
 *
 * A screen reader announces a live region when its CONTENT changes while it is already in the
 * document. A `role="status"` element mounted together with its sentence -- the obvious
 * `{copied ? <p role="status">…</p> : null}` -- is, in most of them, never read at all: there
 * was no region yet to watch when the text appeared. So the element here is always mounted and
 * only its text comes and goes.
 *
 * While there is nothing to say it wears `visually-hidden`, which takes it out of flow: an
 * empty `<p>` left in a `.stack` or a `.row` would still be a flex item and still cost the
 * layout a gap. It stays in the accessibility tree throughout, which is what keeps it a region
 * the reader is listening to. Once the text arrives the same node takes the caller's class.
 *
 * Only as persistent as its own mount: put it where the press that fills it does not also
 * mount it, which is beside the button rather than inside a branch that opens on success.
 */

export function StatusLine({
  text,
  className,
  as: Element = "p",
}: {
  /** What to say, or `null` for nothing yet. */
  text: string | null;
  /** The class the sentence is printed in once there is one. */
  className: string;
  /** `span` where the sentence sits in a run of inline content, as a table cell's note does. */
  as?: "p" | "span";
}): React.JSX.Element {
  return (
    <Element className={text === null ? "visually-hidden" : className} role="status">
      {text}
    </Element>
  );
}
