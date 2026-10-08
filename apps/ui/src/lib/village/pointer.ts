/**
 * What the pointer is over in a village, and what the page says about it.
 *
 * The canvas draws no word, so pointing at something in the picture answers in the words beside
 * it: the element marked for it -- `data-actor` for a figure, `data-place` for a building --
 * takes `data-lit`, the same wash a hovered row takes. Pressing goes where that element goes,
 * through the film's hook.
 *
 * One of those elements is the target's card (`data-card`), in the frame over the canvas: the
 * same words again, shown above the figure's head or the building's roof. It is set there
 * whenever it lights and again on every drawn frame (`follow`), so it walks with a figure at the
 * film's ten frames a second, and it is kept inside the frame. The card is a place to read the
 * words, never their only place: it is `aria-hidden`, and the lists keep them.
 *
 * A target is `kind|id`: `actor|courier:hubspot`, `place|vault`. The world says what is under a
 * ray (`World.under`); this only turns events into rays and targets into lit words.
 */

import { type Camera, Raycaster, Vector2, type Vector3 } from "three";

/** Pressing a target: its kind and its id. */
export type PickHook = (kind: string, id: string) => void;

/** A figure's press target is named for the figure's key, behind this prefix. */
export const FIGURE_TARGET = "figure:";

/** The room between a card and what it stands over, in CSS pixels. */
const CARD_GAP = 6;

/** What the pointer asks of the world: what a ray lands on, and where a target's card stands. */
export interface PointedWorld {
  readonly under: (ray: Raycaster) => string | null;
  readonly anchor: (target: string) => Vector3 | null;
}

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
  private readonly world: PointedWorld;
  private readonly onPick: PickHook;
  private lit: string | null = null;
  private card: HTMLElement | null = null;

  constructor(
    elements: { readonly canvas: HTMLCanvasElement; readonly words: HTMLElement },
    camera: Camera,
    world: PointedWorld,
    onPick: PickHook,
  ) {
    this.canvas = elements.canvas;
    this.words = elements.words;
    this.camera = camera;
    this.world = world;
    this.onPick = onPick;
  }

  readonly hover = (event: Event): void => {
    if (this.aim(event)) {
      this.light(this.world.under(this.raycaster));
    }
  };

  readonly leave = (): void => {
    this.light(null);
  };

  readonly press = (event: Event): void => {
    if (!this.aim(event)) {
      return;
    }
    const [kind, id] = (this.world.under(this.raycaster) ?? "").split("|");
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
    const lit = wordsFor(this.words, target);
    for (const element of lit) {
      element.setAttribute("data-lit", "");
    }
    this.lit = target;
    this.card =
      lit.find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && element.hasAttribute("data-card"),
      ) ?? null;
    this.canvas.style.cursor = target === null ? "" : "pointer";
    this.follow();
  }

  /** Sets the lit card over its target as the camera sees it now, inside the frame. */
  readonly follow = (): void => {
    const point = this.lit === null || this.card === null ? null : this.world.anchor(this.lit);
    if (point === null || this.card === null) {
      return;
    }
    point.project(this.camera);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const across = this.card.offsetWidth;
    const left = Math.min(Math.max(((point.x + 1) / 2) * width - across / 2, 0), width - across);
    const top = Math.max(((1 - point.y) / 2) * height - this.card.offsetHeight - CARD_GAP, 0);
    this.card.style.translate = `${Math.max(left, 0)}px ${top}px`;
  };
}
