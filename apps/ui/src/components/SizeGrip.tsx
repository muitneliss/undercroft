/**
 * An edge a reader drags -- the whole of it, rather than a speck in one corner.
 *
 * This replaces the browser's own `resize` property on the four surfaces that had it (ADR
 * 0040, superseding that part of ADR 0037). `resize` draws its grip in the bottom-right
 * corner and nowhere else, so a reader who reaches for the edge -- where every other
 * resizable pane they have ever used puts it -- finds nothing, and a reader without a mouse
 * finds nothing at all, because that corner has no keyboard at any time.
 *
 * IT SIZES THE ELEMENT IT IS WRITTEN INTO. `parentElement`, and no other interface: no ref
 * threading, no id, no context. That is the one thing the two props do not say and the
 * reason all four call sites are a single line. Write it into a box, give the box a
 * `position: relative` and the floor and ceiling it may travel between, and the box is
 * resizable.
 *
 * THE SHEET STILL SAYS HOW FAR. Limits are read off `getComputedStyle` at the moment a drag
 * starts, never passed in as props, which is what keeps `apps/ui/src/index.css` the single
 * place a pane's travel is written -- the property ADR 0037 prized about `resize` and the one
 * thing this must not lose. It is also why the folded rail and the narrow-viewport rail keep
 * clamping a dragged width with no code here at all: what we write is the same INLINE measure
 * `resize` wrote, and those rules were already written to outrank one.
 *
 * NO STATE, STILL. Two refs -- a DOM handle and a latch for the drag in flight -- and nothing
 * in the Zustand store, nothing persisted, no re-render between `pointerdown` and `pointerup`.
 * A pane's measure is not a fact the platform needs to remember, which was ADR 0037's
 * objection to a handle of our own and is answered rather than ignored here.
 *
 * An `<hr>` rather than a `<div role="separator">`, because `hr`'s implicit role IS separator
 * and Biome's `useSemanticElements` is right to refuse the div. The arithmetic is in
 * `@/lib/dragSize`, which is the half of this a gate with no layout engine can check.
 */

import { useEffect, useRef } from "react";

import {
  GRIP_STEP,
  lengthInPx,
  type SizeAxis,
  type SizeLimits,
  sizeFromDrag,
  sizeFromKey,
  type SizeOrigin,
  travelShare,
} from "@/lib/dragSize.ts";

const MEASURE = { inline: "width", block: "height" } as const;
const FLOOR = { inline: "minWidth", block: "minHeight" } as const;
const CEILING = { inline: "maxWidth", block: "maxHeight" } as const;

/** What the sheet allows this pane right now, resolved against its container. */
function limitsOf(pane: HTMLElement, axis: SizeAxis): SizeLimits {
  const style = globalThis.getComputedStyle(pane);
  const parent = pane.parentElement;
  const basis = axis === "inline" ? (parent?.clientWidth ?? 0) : (parent?.clientHeight ?? 0);
  return {
    min: lengthInPx(style[FLOOR[axis]], basis),
    max: lengthInPx(style[CEILING[axis]], basis),
  };
}

/**
 * The measure this pane has now.
 *
 * The rect rather than the computed `width`, because the rect is the border box and this
 * sheet is `box-sizing: border-box` throughout -- so the number read here and the number
 * written back mean the same box. Engines disagree about which box a computed `width`
 * reports, and a pane that jumps by its own padding on the first drag is how you find out.
 */
function measureOf(pane: HTMLElement, axis: SizeAxis): number {
  const rect = pane.getBoundingClientRect();
  return axis === "inline" ? rect.width : rect.height;
}

/**
 * Say where along its travel the edge now sits, for a reader who cannot see it.
 *
 * Nothing is said where the sheet leaves an end open: `separator` implies a 0..100 range, and
 * a share of an unbounded travel would be a number with no meaning read out as if it had one.
 */
function report(handle: HTMLElement | null, size: number, limits: SizeLimits): void {
  if (handle === null) {
    return;
  }
  const share = travelShare(size, limits);
  if (share === null) {
    handle.removeAttribute("aria-valuenow");
    return;
  }
  handle.setAttribute("aria-valuenow", String(share));
}

/** The drag in flight, or `null` between drags. */
type DragRef = React.RefObject<{ origin: SizeOrigin; limits: SizeLimits } | null>;

/**
 * Give the pane its new measure, and say where the edge now sits.
 *
 * Every write goes through here -- drag, key and reset alike -- so the inline style and what
 * a screen reader is told cannot disagree.
 */
function write(handle: HTMLElement, axis: SizeAxis, size: number, limits: SizeLimits): void {
  const pane = handle.parentElement;
  if (pane === null) {
    return;
  }
  pane.style.setProperty(MEASURE[axis], `${String(Math.round(size))}px`);
  report(handle, size, limits);
}

function coordOf(axis: SizeAxis, event: React.PointerEvent<HTMLHRElement>): number {
  return axis === "inline" ? event.clientX : event.clientY;
}

function beginDrag(
  axis: SizeAxis,
  dragRef: DragRef,
  event: React.PointerEvent<HTMLHRElement>,
): void {
  const pane = event.currentTarget.parentElement;
  if (pane === null || event.button !== 0) {
    return;
  }
  dragRef.current = {
    limits: limitsOf(pane, axis),
    origin: { size: measureOf(pane, axis), at: coordOf(axis, event) },
  };
  // Capture rather than a window listener: every later move and the release are retargeted
  // here, so a fast drag off an 8px strip does not drop and there is nothing to unsubscribe.
  event.currentTarget.setPointerCapture(event.pointerId);
  // Focus follows the hand, which is what lets Escape below reach this element at all.
  event.currentTarget.focus();
  // Without this the drag starts a text selection across everything it passes over.
  event.preventDefault();
}

function moveDrag(
  axis: SizeAxis,
  dragRef: DragRef,
  event: React.PointerEvent<HTMLHRElement>,
): void {
  const drag = dragRef.current;
  if (drag === null) {
    return;
  }
  const size = sizeFromDrag(drag.origin, coordOf(axis, event), drag.limits);
  write(event.currentTarget, axis, size, drag.limits);
}

function endDrag(dragRef: DragRef, event: React.PointerEvent<HTMLHRElement>): void {
  dragRef.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
}

function keyEdge(
  axis: SizeAxis,
  dragRef: DragRef,
  event: React.KeyboardEvent<HTMLHRElement>,
): void {
  const handle = event.currentTarget;
  const pane = handle.parentElement;
  if (pane === null) {
    return;
  }
  const drag = dragRef.current;
  if (drag !== null && event.key === "Escape") {
    write(handle, axis, drag.origin.size, drag.limits);
    dragRef.current = null;
    return;
  }
  const limits = limitsOf(pane, axis);
  const next = sizeFromKey(event.key, {
    axis,
    limits,
    size: measureOf(pane, axis),
    step: GRIP_STEP,
  });
  // A key this edge does not answer is left to whatever is under it -- the other axis's
  // arrows still scroll the pane, which a separator that swallowed them would not.
  if (next === null) {
    return;
  }
  write(handle, axis, next, limits);
  event.preventDefault();
}

/** Back to the measure the sheet declares -- the reset the browser's corner never had. */
function resetEdge(axis: SizeAxis, event: React.MouseEvent<HTMLHRElement>): void {
  const pane = event.currentTarget.parentElement;
  if (pane === null) {
    return;
  }
  pane.style.removeProperty(MEASURE[axis]);
  report(event.currentTarget, measureOf(pane, axis), limitsOf(pane, axis));
}

export function SizeGrip({
  axis,
  label,
}: {
  /** Which measure this edge moves: `inline` is a width, `block` is a height. */
  axis: SizeAxis;
  /** What this edge moves, already translated -- a screen reader hears it with no picture. */
  label: string;
}): React.JSX.Element {
  const handleRef = useRef<HTMLHRElement>(null);
  const dragRef: DragRef = useRef<{ origin: SizeOrigin; limits: SizeLimits } | null>(null);

  // Where the edge rests, once there is a box to measure. The only thing this component
  // needs its own ref for: every handler below is given the element by the event.
  useEffect(() => {
    const handle = handleRef.current;
    const pane = handle?.parentElement ?? null;
    if (handle !== null && pane !== null) {
      report(handle, measureOf(pane, axis), limitsOf(pane, axis));
    }
  }, [axis]);

  return (
    <hr
      ref={handleRef}
      className={axis === "inline" ? "grip grip--inline" : "grip grip--block"}
      aria-label={label}
      // The orientation of the SEPARATOR, not of the drag: the rail's grip is a vertical
      // line that moves a width.
      aria-orientation={axis === "inline" ? "vertical" : "horizontal"}
      tabIndex={0}
      onPointerDown={(event): void => {
        beginDrag(axis, dragRef, event);
      }}
      onPointerMove={(event): void => {
        moveDrag(axis, dragRef, event);
      }}
      onPointerUp={(event): void => {
        endDrag(dragRef, event);
      }}
      onPointerCancel={(event): void => {
        endDrag(dragRef, event);
      }}
      onKeyDown={(event): void => {
        keyEdge(axis, dragRef, event);
      }}
      onDoubleClick={(event): void => {
        resetEdge(axis, event);
      }}
    />
  );
}
