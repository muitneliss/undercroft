/**
 * What the pointer is over in a village, and what the page says about it.
 *
 * The canvas draws no word, so pointing at something in the picture answers in the words beside
 * it: the element marked for it -- `data-actor` for a figure, `data-place` for a building --
 * takes `data-lit`, the same wash a hovered row takes. Pressing goes where that element goes,
 * through the film's hook.
 *
 * A target is `kind|id`: `actor|courier:hubspot`, `place|vault`. The world says what is under a
 * ray (`World.under`); this only turns events into rays and targets into lit words.
 */

import { type Camera, Raycaster, Vector2 } from "three";

/** Pressing a target: its kind and its id. */
export type PickHook = (kind: string, id: string) => void;

/** A figure's press target is named for the figure's key, behind this prefix. */
export const FIGURE_TARGET = "figure:";

/** Which of the page's elements answers a target. */
function wordsFor(words: HTMLElement, target: string | null): Element[] {
  if (target === null) {
    return [];
  }
  const [kind = "", id = ""] = target.split("|");
  return [...words.querySelectorAll(`[data-${kind}="${CSS.escape(id)}"]`)];
}

export class VillagePointer {
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly canvas: HTMLCanvasElement;
  private readonly words: HTMLElement;
  private readonly camera: Camera;
  private readonly under: (ray: Raycaster) => string | null;
  private readonly onPick: PickHook;
  private lit: string | null = null;

  constructor(
    elements: { readonly canvas: HTMLCanvasElement; readonly words: HTMLElement },
    camera: Camera,
    under: (ray: Raycaster) => string | null,
    onPick: PickHook,
  ) {
    this.canvas = elements.canvas;
    this.words = elements.words;
    this.camera = camera;
    this.under = under;
    this.onPick = onPick;
  }

  readonly hover = (event: Event): void => {
    if (this.aim(event)) {
      this.light(this.under(this.raycaster));
    }
  };

  readonly leave = (): void => {
    this.light(null);
  };

  readonly press = (event: Event): void => {
    if (!this.aim(event)) {
      return;
    }
    const [kind, id] = (this.under(this.raycaster) ?? "").split("|");
    if (kind !== undefined && kind !== "" && id !== undefined) {
      this.onPick(kind, id);
    }
  };

  private aim(event: Event): boolean {
    if (!(event instanceof MouseEvent)) {
      return false;
    }
    const box = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      -((event.clientY - box.top) / box.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return true;
  }

  private light(target: string | null): void {
    if (target === this.lit) {
      return;
    }
    for (const element of wordsFor(this.words, this.lit)) {
      element.removeAttribute("data-lit");
    }
    for (const element of wordsFor(this.words, target)) {
      element.setAttribute("data-lit", "");
    }
    this.lit = target;
    this.canvas.style.cursor = target === null ? "" : "pointer";
  }
}
