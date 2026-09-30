/**
 * Which face of a saved question the reader has open: its drawing, its rows, or how it is
 * defined.
 *
 * In the address, like every other choice on a question's page (`.claude/rules/state.md`), so
 * a link to a question's rows opens on its rows -- a dashboard tile's "View data" is exactly
 * that link. The drawing is the default and is written as no key at all, so the address of a
 * question read the ordinary way stays the address it always had. Anything a hand-edited
 * address says that is not a pane opens the drawing rather than an empty page.
 */

/** The search key the pane rides under. */
export const PANE = "view";

export const QUESTION_PANES = ["chart", "data", "definition"] as const;
export type QuestionPane = (typeof QUESTION_PANES)[number];

const DEFAULT_PANE: QuestionPane = "chart";

export function paneFromSearch(search: URLSearchParams): QuestionPane {
  const named = search.get(PANE);
  return QUESTION_PANES.find((pane) => pane === named) ?? DEFAULT_PANE;
}

/** The search string with `pane` open; the drawing drops the key rather than naming itself. */
export function withPane(search: URLSearchParams, pane: QuestionPane): URLSearchParams {
  const next = new URLSearchParams(search);
  if (pane === DEFAULT_PANE) {
    next.delete(PANE);
  } else {
    next.set(PANE, pane);
  }
  return next;
}
