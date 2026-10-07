/**
 * What the pointer is over in the village, and what the page says about it.
 *
 * The canvas draws no word, so pointing at something in the picture answers in the words beside
 * it: the work-list row of the figure under the pointer, or the link of the building, takes
 * `data-lit`, the same wash a hovered row takes. Pressing goes where that row or link goes.
 */

import { type Camera, type Object3D, Plane, Raycaster, Vector2, Vector3 } from "three";

import { PLACES } from "@/lib/village/layout.ts";

export interface VillageHooks {
  /** A figure was pressed: its key, as the scene names it. */
  readonly onFigure: (key: string) => void;
  /** A building was pressed: its place id from the layout. */
  readonly onPlace: (id: string) => void;
}

/** A figure's press target is named for the figure's key, behind this prefix. */
export const FIGURE_TARGET = "figure:";

/** Which of the page's elements answers a target: a row by actor, a link by place. */
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
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private readonly canvas: HTMLCanvasElement;
  private readonly words: HTMLElement;
  private readonly camera: Camera;
  private readonly figures: () => Object3D[];
  private readonly hooks: VillageHooks;
  private lit: string | null = null;

  constructor(
    elements: { readonly canvas: HTMLCanvasElement; readonly words: HTMLElement },
    camera: Camera,
    figures: () => Object3D[],
    hooks: VillageHooks,
  ) {
    this.canvas = elements.canvas;
    this.words = elements.words;
    this.camera = camera;
    this.figures = figures;
    this.hooks = hooks;
  }

  readonly hover = (event: Event): void => {
    if (this.aim(event)) {
      this.light(this.under());
    }
  };

  readonly leave = (): void => {
    this.light(null);
  };

  readonly press = (event: Event): void => {
    if (!this.aim(event)) {
      return;
    }
    const [kind, id] = (this.under() ?? "").split("|");
    if (kind === "actor" && id !== undefined) {
      this.hooks.onFigure(id);
    } else if (kind === "place" && id !== undefined) {
      this.hooks.onPlace(id);
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

  /** What is under the pointer: a figure first, then the building whose ground it is over. */
  private under(): string | null {
    for (const hit of this.raycaster.intersectObjects(this.figures(), true)) {
      if (hit.object.name.startsWith(FIGURE_TARGET)) {
        return `actor|${hit.object.name.slice(FIGURE_TARGET.length)}`;
      }
    }
    const spot = this.raycaster.ray.intersectPlane(this.ground, new Vector3());
    if (spot === null) {
      return null;
    }
    const place = PLACES.find((p) => Math.hypot(p.x - spot.x, p.z - spot.z) <= p.reach);
    return place === undefined ? null : `place|${place.id}`;
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
