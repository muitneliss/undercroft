/**
 * Runs the village: one renderer, one fixed camera, and a clock that moves the world ten frames
 * a second (ADR 0115).
 *
 * NOTHING HERE IS REACT STATE (`.claude/rules/state.md`), for the vault's reason
 * (`lib/vault/runtime.ts`): a frame loop that rendered through React would re-render the page
 * ten times a second for values nothing else reads. The film keeps its values on itself. React
 * hands it a scene (`show`), and the film writes back only `data-` attributes on the page's own
 * elements: `data-lit` on the words the pointer is over in the picture (`pointer.ts`), and
 * `data-village` on the frame, `failed` where there is no WebGL or a model would not load, which
 * shows the frame's own sentence saying so instead of an empty box. The frame is `aria-busy`
 * until then.
 *
 * The loop runs only while the canvas is on screen and the tab is visible. Under
 * `prefers-reduced-motion` it never runs: each `show` paints one settled frame with everyone
 * already where their work is.
 */

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  type Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OutlineEffect } from "three/addons/effects/OutlineEffect.js";

import { Figure, FRAME_SECONDS } from "@/lib/village/folk.ts";
import { readTokens } from "@/lib/village/paint.ts";
import { type VillageHooks, VillagePointer } from "@/lib/village/pointer.ts";
import { placeProps } from "@/lib/village/props.ts";
import type { VillageScene } from "@/lib/village/script.ts";
import { loadStage, type Stage } from "@/lib/village/stage.ts";

export type { VillageHooks } from "@/lib/village/pointer.ts";

export interface VillageElements {
  /** The frame the canvas sits in; carries `data-village`. */
  readonly frame: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** The words beside the picture: rows marked `data-actor`, links marked `data-place`. */
  readonly words: HTMLElement;
}

const FRAME_MS = FRAME_SECONDS * 1000;
/** The camera's bearing on the board: from the south, raised, turned a little from the east. */
const CAMERA_AT = new Vector3(5, 15, 17);
/** The one raking light, low from the north-west. */
const LIGHT_AT = new Vector3(-10, 9, -4);
/**
 * The light, split so a face turned fully to the lamp lands on its token's own colour
 * (ambient + rake = 1) and the toon ramp steps the rest down toward two thirds of it. Each is
 * scaled by pi because three's Lambert term divides by it.
 */
const AMBIENT = 0.66 * Math.PI;
const RAKE = 0.34 * Math.PI;
/** Room around the board inside the frame, as a share of it. */
const MARGIN = 0.04;
/** The highest the frame fits to: a spire does not get to leave a strip of empty page. */
const FIT_HEIGHT = 1.6;
const OUTLINE_THICKNESS = 0.0032;
/** The bell's swing, one position a frame: two full swings when a scheduled run opens. */
const BELL_SWING = [0.35, 0, -0.35, 0, 0.35, 0, -0.35, 0];

/** The board's extent as the camera sees it: left, right, bottom, top. */
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

export class VillageFilm {
  private readonly renderer: WebGLRenderer;
  private readonly effect: OutlineEffect;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly figures = new Map<string, Figure>();
  private readonly props = new Group();
  private readonly still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly elements: VillageElements;
  private readonly pointer: VillagePointer;
  private readonly stage: Stage;
  private readonly listeners: [EventTarget, string, (event: Event) => void][];
  private readonly resize = new ResizeObserver(() => this.measure());
  private readonly seen = new IntersectionObserver((entries) => {
    this.onScreen = entries.some((entry) => entry.isIntersecting);
    this.resume();
  });
  private current: VillageScene | null = null;
  private onScreen = true;
  private frame = 0;
  private last = 0;
  private bellFrame = 0;

  private constructor(
    elements: VillageElements,
    hooks: VillageHooks,
    renderer: WebGLRenderer,
    stage: Stage,
  ) {
    this.elements = elements;
    this.renderer = renderer;
    this.stage = stage;
    this.effect = new OutlineEffect(renderer, {
      defaultThickness: OUTLINE_THICKNESS,
      defaultColor: new Color(readTokens(elements.frame).ink).toArray(),
    });
    this.pointer = new VillagePointer(
      elements,
      this.camera,
      () => [...this.figures.values()].map((figure) => figure.holder),
      hooks,
    );
    this.listeners = [
      [elements.canvas, "pointermove", this.pointer.hover],
      [elements.canvas, "pointerleave", this.pointer.leave],
      [elements.canvas, "click", this.pointer.press],
      [document, "visibilitychange", (): void => this.resume()],
      [this.still, "change", (): void => this.reshow()],
    ];
  }

  /**
   * Starts the village, or marks the frame `failed` and returns null where there is no WebGL or
   * the models will not load: the page is whole without the picture, and says so.
   */
  static async start(elements: VillageElements, hooks: VillageHooks): Promise<VillageFilm | null> {
    let renderer: WebGLRenderer | null = null;
    try {
      renderer = new WebGLRenderer({ canvas: elements.canvas, antialias: true, alpha: true });
      const stage = await loadStage(readTokens(elements.frame));
      const film = new VillageFilm(elements, hooks, renderer, stage);
      film.build();
      VillageFilm.settle(elements.frame, "ready");
      return film;
    } catch {
      renderer?.dispose();
      VillageFilm.settle(elements.frame, "failed");
      return null;
    }
  }

  /** The frame is busy until the models load or will not: then it says which. */
  private static settle(frame: HTMLElement, state: "ready" | "failed"): void {
    frame.setAttribute("data-village", state);
    frame.removeAttribute("aria-busy");
  }

  private build(): void {
    this.renderer.setClearColor(0x00_00_00, 0);
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    const light = new DirectionalLight(0xff_ff_ff, RAKE);
    light.position.copy(LIGHT_AT);
    this.scene.add(new AmbientLight(0xff_ff_ff, AMBIENT), light, this.stage.root, this.props);
    this.camera.position.copy(CAMERA_AT);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    for (const [target, type, listener] of this.listeners) {
      target.addEventListener(type, listener);
    }
    this.resize.observe(this.elements.canvas);
    this.seen.observe(this.elements.canvas);
    this.measure();
  }

  /** Fits the whole board into the frame, whatever the frame's shape. */
  private measure(): void {
    const { canvas } = this.elements;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.renderer.setSize(width, height, false);
    const box = new Box3().setFromObject(this.stage.root);
    box.max.y = Math.min(box.max.y, FIT_HEIGHT);
    const [left, right, bottom, top] = seenExtent(box, this.camera);
    const scale =
      Math.max(((right - left) * (1 + MARGIN)) / width, ((top - bottom) * (1 + MARGIN)) / height) /
      2;
    this.camera.left = (left + right) / 2 - width * scale;
    this.camera.right = (left + right) / 2 + width * scale;
    this.camera.top = (top + bottom) / 2 + height * scale;
    this.camera.bottom = (top + bottom) / 2 - height * scale;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  /** What the village shows now. Figures come and go with their characters. */
  show(next: VillageScene): void {
    this.current = next;
    const still = this.still.matches;
    const keep = new Set(next.actors.map((actor) => actor.key));
    for (const [key, figure] of this.figures) {
      if (!keep.has(key)) {
        figure.dispose();
        this.figures.delete(key);
      }
    }
    for (const actor of next.actors) {
      let figure = this.figures.get(actor.key);
      if (figure === undefined) {
        figure = new Figure(actor, this.stage.cast, {
          crate: (): Object3D => this.stage.piece("crate"),
          slip: this.stage.slip,
        });
        this.figures.set(actor.key, figure);
        this.scene.add(figure.holder);
      }
      figure.cast(actor, still);
    }
    if (next.bellRinging && this.bellFrame === 0) {
      this.bellFrame = 1;
    }
    placeProps(this.props, this.stage, next);
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
      for (const figure of this.figures.values()) {
        figure.step();
      }
      this.swingBell();
      this.draw();
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private swingBell(): void {
    const swing = this.stage.bell.getObjectByName("swing");
    if (swing === undefined || this.bellFrame === 0) {
      return;
    }
    swing.rotation.x = BELL_SWING[this.bellFrame - 1] ?? 0;
    this.bellFrame = this.bellFrame >= BELL_SWING.length ? 0 : this.bellFrame + 1;
  }

  private draw(): void {
    this.effect.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const [target, type, listener] of this.listeners) {
      target.removeEventListener(type, listener);
    }
    this.resize.disconnect();
    this.seen.disconnect();
    for (const figure of this.figures.values()) {
      figure.dispose();
    }
    this.stage.dispose();
    this.renderer.dispose();
  }
}
