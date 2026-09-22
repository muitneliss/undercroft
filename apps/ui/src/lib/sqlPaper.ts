/**
 * How a query is SET: the editor's ink and its typography, kept apart from its behaviour.
 *
 * `SqlEditor.tsx` is what the editor DOES -- the document, the chord, the completion, the
 * handle a caller reads a selection through. This is what it LOOKS LIKE, and the two change
 * for different reasons: a rule about running the selection is not a rule about how a keyword
 * is weighted, and a reader after one of them should not have to read past the other.
 *
 * It stays this project's own typography rather than an editor's default theme, which is the
 * argument `SqlEditor.tsx` opens with: every token here comes from the same sheet the rest of
 * the book is set from, so the editor is a page of it rather than a window onto something
 * else.
 */

import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Syntax in ONE ink, plus two.
 *
 * A printed code listing distinguishes a keyword by weight, not by colour, and this
 * interface is printed matter end to end -- an editor lit up in an IDE's blue and purple
 * would be the one surface in the book that came from somewhere else. So: keywords take
 * weight, a comment takes the faintest ink, and exactly two hues from the section wheel mark
 * the two things a reader genuinely scans a query for -- the literal values it contains.
 */
export const listing = HighlightStyle.define([
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
export const paper = EditorView.theme({
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
