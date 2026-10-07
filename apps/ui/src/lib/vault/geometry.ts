/** Where the film's DOM sits, in the canvas's own coordinates; `runtime.ts` measures with these. */

import type { Rect } from "@/lib/vault/frame.ts";

/** Where `element` sits inside `to`, as the rectangle the film draws against. */
export function relative(element: Element, to: DOMRect): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.left - to.left, y: rect.top - to.top, w: rect.width, h: rect.height };
}

export function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
