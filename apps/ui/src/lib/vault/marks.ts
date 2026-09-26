/**
 * What the film writes into the document, which is only ever a few attributes on the page's own
 * lists: the stage the lamp is over, how far the reader has come, and each stage's tone. The
 * lists stay the content; these attributes are how their styling follows the picture behind
 * them. Each is written only when it changes, sixty times a second being otherwise sixty style
 * recalculations for nothing.
 */

import type { Palette } from "@/lib/vault/frame.ts";
import { type Reader, STAGES, type StageId, STEPS, stageAt, stepU } from "@/lib/vault/model.ts";

function setWhenChanged(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/** `data-lit` on the stage the lamp is over; `data-state` on each step: done, current, ahead. */
export function markPath(stages: Element, steps: Element, lit: StageId, reader: Reader): void {
  for (const [index, item] of Array.from(stages.children).entries()) {
    setWhenChanged(item, "data-lit", String(stageAt((index + 0.5) / STAGES.length) === lit));
  }
  for (const [index, item] of Array.from(steps.children).entries()) {
    const step = STEPS[index] ?? "ask";
    const passed = reader.u >= stepU(step) ? "done" : "ahead";
    setWhenChanged(item, "data-state", step === reader.step ? "current" : passed);
  }
}

/** `--tone` on each stage: the hole a lit stage punches is its column's tone in this palette. */
export function tintStages(stages: Element, palette: Palette): void {
  for (const [index, item] of Array.from(stages.children).entries()) {
    if (item instanceof HTMLElement) {
      item.style.setProperty("--tone", palette.tones[STAGES[index] ?? "sources"]);
    }
  }
}
