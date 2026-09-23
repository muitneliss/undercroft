/**
 * The arithmetic behind a draggable edge, with no DOM in it.
 *
 * `SizeGrip` is the hand: it reads the sheet, captures the pointer and writes an inline
 * measure. Everything it has to get RIGHT is here instead, because the offline gate has no
 * layout engine -- happy-dom computes style but not boxes, and it has no `setPointerCapture`
 * at all -- so a drag cannot be asserted end to end (ADR 0037 recorded that limit for the
 * browser's own grip; ADR 0042 inherits it). What a test can see is this: given where a drag
 * began and where the pointer is now, what measure is being asked for, and what the sheet
 * allows it to be.
 *
 * Two conventions hold throughout and are what let one module serve four edges:
 *
 * - **A measure only ever grows toward the pointer's larger coordinate.** Every grip in the
 *   book sits on a right or a bottom edge, so dragging right widens and dragging down
 *   heightens. An edge on the other side of its box would need the sign flipped, and there
 *   is none; the day there is, it arrives here rather than at four call sites.
 * - **A limit is a number or it is `null`**, never a sentinel. `null` is "the sheet declares
 *   none", which is a different fact from "zero" and has to stay different: `Home` on an edge
 *   with no floor must do nothing rather than collapse the pane.
 */

/** Which measure an edge moves: `inline` is a width, `block` is a height. */
export type SizeAxis = "inline" | "block";

/** What the sheet allows, in px. `null` is "the sheet declares none". */
export interface SizeLimits {
  readonly min: number | null;
  readonly max: number | null;
}

/** Where a drag began: the measure the element had, at the coordinate it had it at. */
export interface SizeOrigin {
  readonly size: number;
  readonly at: number;
}

/**
 * One arrow press, in px.
 *
 * A line of the page's own body text, so a reader holding the key moves the edge at about
 * the rate they read. Small enough to land on a column boundary, large enough that crossing
 * a pane is not a career.
 */
export const GRIP_STEP = 16;

/**
 * The measure, brought inside what the sheet allows.
 *
 * The floor is applied before the ceiling, so where a sheet declares a `max` below its own
 * `min` -- which `.rail-ref--folded` does on purpose, clamping a dragged rail down to its
 * spine -- the ceiling is the one that wins. That is the behaviour the fold depends on.
 */
export function clampSize(size: number, limits: SizeLimits): number {
  const floored = limits.min === null ? size : Math.max(limits.min, size);
  return limits.max === null ? floored : Math.min(limits.max, floored);
}

/** The measure a pointer now at `at` is asking for, clamped to what the sheet allows. */
export function sizeFromDrag(origin: SizeOrigin, at: number, limits: SizeLimits): number {
  return clampSize(origin.size + (at - origin.at), limits);
}

/**
 * The measure a key press asks for, or `null` for a key this edge does not answer.
 *
 * `null` is also the caller's signal NOT to swallow the event: the arrows of the other axis
 * belong to whatever is under the grip -- usually a scroll -- and a separator that ate them
 * would be a keyboard trap wearing a resize handle.
 */
export function sizeFromKey(
  key: string,
  from: { axis: SizeAxis; size: number; limits: SizeLimits; step: number },
): number | null {
  const grow = from.axis === "inline" ? "ArrowRight" : "ArrowDown";
  const shrink = from.axis === "inline" ? "ArrowLeft" : "ArrowUp";
  if (key === grow) {
    return clampSize(from.size + from.step, from.limits);
  }
  if (key === shrink) {
    return clampSize(from.size - from.step, from.limits);
  }
  if (key === "Home") {
    return from.limits.min;
  }
  if (key === "End") {
    return from.limits.max;
  }
  return null;
}

/**
 * One computed length, in px. `"none"`, `"auto"` and `""` are `null`.
 *
 * A percentage needs a basis because a browser does not resolve one for you: Chrome reports
 * `min-height: 9rem` as `"144px"` but leaves the editor pane's `max-height: 72%` as `"72%"`,
 * so an edge that read only px would find no ceiling on the one surface whose ceiling is a
 * share of the window.
 *
 * `Number.parseInt` rather than a float parse, which the money plugin bans repo-wide and is
 * right to: a sub-pixel fraction of a pane is not a fact anybody can see, and a pane measure
 * is an integer index of the same kind as a port (see `.biome/plugins/money.grit`).
 */
export function lengthInPx(computed: string, basis: number): number | null {
  const digits = Number.parseInt(computed, 10);
  if (Number.isNaN(digits)) {
    return null;
  }
  return computed.endsWith("%") ? (basis * digits) / 100 : digits;
}

/**
 * How far along its travel this edge sits, 0..100, for `aria-valuenow`.
 *
 * `null` where the sheet leaves either end open, because a share of an unbounded travel is
 * a number with no meaning, and a screen reader reading "47" off one is worse served than by
 * hearing nothing. Clamped at both ends so a measure outside its own limits -- which is what
 * a folded rail still holding a dragged inline width is -- reads as 0 or 100 rather than as
 * a negative percentage.
 */
export function travelShare(size: number, limits: SizeLimits): number | null {
  const { min, max } = limits;
  if (min === null || max === null || max <= min) {
    return null;
  }
  return Math.round(Math.min(100, Math.max(0, ((size - min) / (max - min)) * 100)));
}
