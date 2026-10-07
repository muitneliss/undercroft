/**
 * Runs a village: one renderer, one fixed camera that fits the whole world in the frame, the
 * look it is photographed with, and a clock that moves the world ten frames a second (ADR 0116).
 *
 * Every village is one of these: the Journal's town (`town.ts`), and every node-and-edge drawing,
 * a run's map and the models' lineage (`graphWorld.ts`). The film owns what they share; a
 * `World` owns what it shows, what one frame moves, and what lies under the pointer.
 *
 * NOTHING HERE IS REACT STATE (`.claude/rules/state.md`), for the vault's reason
 * (`lib/vault/runtime.ts`): a frame loop that rendered through React would re-render the page
 * ten times a second for values nothing else reads. React hands the film what to show (`show`),
 * and the film writes back only `data-` attributes on the page's own elements: `data-lit` on the
 * words the pointer is over (`pointer.ts`), and `data-village` on the frame, `failed` where there
 * is no WebGL or a model would not load, which shows the frame's own sentence instead of an
 * empty box. The frame is `aria-busy` until then.
 *
 * The loop runs only while the canvas is on screen and the tab is visible. Under
 * `prefers-reduced-motion` it never runs: each `show` paints one settled frame.
 */

import {
  Box3,
  type Object3D,
  OrthographicCamera,
  type Raycaster,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

import { FRAME_SECONDS } from "@/lib/village/folk.ts";
import { type Kit, loadKit } from "@/lib/village/kit.ts";
import { Look } from "@/lib/village/look.ts";
import { readTokens } from "@/lib/village/paint.ts";
import { type PickHook, VillagePointer } from "@/lib/village/pointer.ts";

export interface VillageElements {
  /** The frame the canvas sits in; carries `data-village`. */
  readonly frame: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** The words beside the picture, whose marked elements answer the pointer. */
  readonly words: HTMLElement;
}

/** What a film shows: a world built from the kit, told what to show, stepped frame by frame. */
export interface World<T> {
  /** What the camera fits into the frame. */
  readonly root: Object3D;
  /** In the scene, but not fitted: what stands and moves on the board. */
  readonly extras: readonly Object3D[];
  /** What to show now; `still` puts everything straight where it ends up. */
  show: (next: T, still: boolean) => void;
  /** One frame. */
  step: () => void;
  /** What a ray from the pointer lands on, as `kind|id`, or null. */
  under: (ray: Raycaster) => string | null;
  dispose: () => void;
}

export interface FilmOptions {
  /** The camera's bearing on the board. */
  readonly camera: Vector3;
  /** The highest the frame fits to: a spire does not get to leave a strip of empty page. */
  readonly fitHeight: number;
}

const FRAME_MS = FRAME_SECONDS * 1000;
/** Room around the world inside the frame, as a share of it. */
const MARGIN = 0.04;
/** Drawn at twice the screen's pixels or more, then downscaled: crisp ink at a miniature's scale. */
const LEAST_RATIO = 2;
const MOST_RATIO = 3;

/** The world's extent as the camera sees it: left, right, bottom, top. */
function seenExtent(box: Box3, camera: OrthographicCamera): [number, number, number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const seen = new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        xs.push(seen.x);
        ys.push(seen.y);
      }
    }
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

/** The frame is busy until the models load or will not: then it says which. */
function settle(frame: HTMLElement, state: "ready" | "failed"): void {
  frame.setAttribute("data-village", state);
  frame.removeAttribute("aria-busy");
}

export class Film<T> {
  private readonly renderer: WebGLRenderer;
  private readonly look: Look;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  private readonly still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly elements: VillageElements;
  private readonly world: World<T>;
  private readonly kit: Kit;
  private readonly options: FilmOptions;
  private readonly listeners: [EventTarget, string, (event: Event) => void][];
  private readonly resize = new ResizeObserver(() => this.measure());
  private readonly seen = new IntersectionObserver((entries) => {
    this.onScreen = entries.some((entry) => entry.isIntersecting);
    this.resume();
  });
  private current: T | null = null;
  private onScreen = true;
  private frame = 0;
  private last = 0;

  private constructor(
    elements: VillageElements,
    renderer: WebGLRenderer,
    parts: { readonly kit: Kit; readonly world: World<T>; readonly onPick: PickHook },
    options: FilmOptions,
  ) {
    this.elements = elements;
    this.renderer = renderer;
    this.kit = parts.kit;
    this.world = parts.world;
    this.options = options;
    this.look = new Look(renderer, this.scene, this.camera, readTokens(elements.frame));
    const pointer = new VillagePointer(
      elements,
      this.camera,
      (ray) => this.world.under(ray),
      parts.onPick,
    );
    this.listeners = [
      [elements.canvas, "pointermove", pointer.hover],
      [elements.canvas, "pointerleave", pointer.leave],
      [elements.canvas, "click", pointer.press],
      [document, "visibilitychange", (): void => this.resume()],
      [this.still, "change", (): void => this.reshow()],
    ];
  }

  /**
   * Starts a village, or marks the frame `failed` and returns null where there is no WebGL or
   * the models will not load: the page is whole without the picture, and says so.
   */
  static async start<Shown>(
    elements: VillageElements,
    build: (kit: Kit) => World<Shown>,
    onPick: PickHook,
    options: FilmOptions,
  ): Promise<Film<Shown> | null> {
    let renderer: WebGLRenderer | null = null;
    try {
      // No antialias here: the look's composer multisamples its own buffer.
      renderer = new WebGLRenderer({ canvas: elements.canvas, antialias: false });
      const kit = await loadKit(readTokens(elements.frame));
      const film = new Film(elements, renderer, { kit, world: build(kit), onPick }, options);
      film.begin();
      settle(elements.frame, "ready");
      return film;
    } catch {
      renderer?.dispose();
      settle(elements.frame, "failed");
      return null;
    }
  }

  private begin(): void {
    this.renderer.setPixelRatio(
      Math.min(MOST_RATIO, Math.max(LEAST_RATIO, globalThis.devicePixelRatio || 1)),
    );
    this.scene.add(this.world.root, ...this.world.extras);
    this.camera.position.copy(this.options.camera);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    for (const [target, type, listener] of this.listeners) {
      target.addEventListener(type, listener);
    }
    this.resize.observe(this.elements.canvas);
    this.seen.observe(this.elements.canvas);
    this.measure();
  }

  /** Fits the whole world into the frame, whatever the frame's shape. */
  private measure(): void {
    const { canvas } = this.elements;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    this.look.setSize(width, height, this.renderer.getPixelRatio());
    const box = new Box3().setFromObject(this.world.root);
    if (box.isEmpty()) {
      return;
    }
    // The camera looks at the world's middle, so a world off the origin is still framed.
    const middle = box.getCenter(new Vector3());
    this.camera.position.copy(this.options.camera).add(new Vector3(middle.x, 0, middle.z));
    this.camera.lookAt(middle.x, 0, middle.z);
    this.camera.updateMatrixWorld();
    box.max.y = Math.min(box.max.y, this.options.fitHeight);
    const [left, right, bottom, top] = seenExtent(box, this.camera);
    const scale =
      Math.max(((right - left) * (1 + MARGIN)) / width, ((top - bottom) * (1 + MARGIN)) / height) /
      2;
    this.camera.left = (left + right) / 2 - width * scale;
    this.camera.right = (left + right) / 2 + width * scale;
    this.camera.top = (top + bottom) / 2 + height * scale;
    this.camera.bottom = (top + bottom) / 2 - height * scale;
    this.camera.updateProjectionMatrix();
    this.look.frame(box);
    this.draw();
  }

  /** What the world shows now. */
  show(next: T): void {
    this.current = next;
    this.world.show(next, this.still.matches);
    this.measure();
    this.resume();
  }

  private reshow(): void {
    if (this.current !== null) {
      this.show(this.current);
    }
  }

  /** Loops while there is something to see and motion is welcome; otherwise one still frame. */
  private resume(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.still.matches || document.hidden || !this.onScreen) {
      this.draw();
      return;
    }
    this.last = 0;
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    if (this.last === 0 || now - this.last >= FRAME_MS) {
      // One frame per frame of time, never a burst: a tab that slept does not fast-forward.
      this.last = now;
      this.world.step();
      this.draw();
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private draw(): void {
    this.look.render();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.resize.disconnect();
    this.seen.disconnect();
    this.world.dispose();
    this.kit.dispose();
    this.look.dispose();
    this.renderer.dispose();
  }
}
