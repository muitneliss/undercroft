/**
 * Runs the vault behind the public home: one animation loop that advances the film and paints it,
 * and the pointer that holds the lamp.
 *
 * NOTHING HERE IS REACT STATE. Sixty frames a second of pointer position and simulation would
 * be sixty renders a second of the whole landing page, and none of it is anything the rest of
 * the app will ever want (`.claude/rules/state.md`). The film keeps its values on itself, and
 * the only thing it writes to the document is a `data-` attribute on the stage and step the
 * lamp is over, and only when that changes.
 *
 * The canvas is fixed to the viewport under every section, so the vault's lines run the length
 * of the page (ADR 0066); the band and the track are re-measured each frame as the page scrolls.
 * It stops when the tab is hidden, and under
 * `prefers-reduced-motion` it never loops: it paints one settled frame and repaints it when the
 * pointer moves, so the lamp and the proof slips still answer the hand while nothing travels
 * (ADR 0063).
 */

import { type Lamp, type Palette, type Pixel, paletteFor, type Rect } from "@/lib/vault/frame.ts";
import { createVault, type StageId, STEP_STAGE, stageAt, type Vault } from "@/lib/vault/model.ts";
import { vaultAim } from "@/lib/vault/lamp.ts";
import { markPath, tintStages } from "@/lib/vault/marks.ts";
import { advance, trigger } from "@/lib/vault/reader.ts";
import { paint } from "@/lib/vault/scene.ts";

export interface VaultElements {
  /** The whole home: the pointer is tracked over all of it. */
  readonly page: HTMLElement;
  /** Fixed to the viewport, under every section, so the vault runs the length of the page. */
  readonly canvas: HTMLCanvasElement;
  /** The empty band the data path is drawn into. */
  readonly band: HTMLElement;
  /** The four stage items and the six step items, in path order. */
  readonly stages: HTMLElement;
  readonly steps: HTMLElement;
}

export interface VaultWords {
  readonly sourceNames: readonly string[];
  readonly refused: string;
  readonly echo: string;
}

/** One film for every visitor: the seed is the day the cover was drawn. */
const SEED = 20_260_926;
/** How long a still pointer keeps the lamp before the reader walks by itself again. */
const HOLD_MS = 4000;
const LAMP_FOLLOW = 9;
const TILT_FOLLOW = 4;
const LONGEST_FRAME = 0.05;
const SETTLED_FRAMES = 420;
/** The film opens mid-reel, with a lake already laid, the reader still at the door. */
const PRE_ROLL_FRAMES = 270;
const DRIFT_RATE = 0.05;
const INTERACTIVE = "a, button, input, select, textarea";

function relative(element: Element, to: DOMRect): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.left - to.left, y: rect.top - to.top, w: rect.width, h: rect.height };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class VaultFilm {
  private readonly vault: Vault = createVault(SEED);
  private readonly trails = new Map<number, Pixel>();
  private readonly pointer = { x: 0, y: 0, over: false, movedAt: Number.NEGATIVE_INFINITY };
  private readonly lamp: Lamp = { x: 0, y: 0, tiltX: 0, tiltY: 0, held: false };
  private readonly size = { width: 0, height: 0 };
  private readonly still = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly dark = globalThis.matchMedia("(prefers-color-scheme: dark)");
  private band: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private track: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private drift = 0;
  private frame = 0;
  private last = 0;
  private readonly elements: VaultElements;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly words: VaultWords;

  private constructor(elements: VaultElements, ctx: CanvasRenderingContext2D, words: VaultWords) {
    this.elements = elements;
    this.ctx = ctx;
    this.words = words;
  }

  /** Starts the film, or returns null where there is no 2D canvas (the page is whole without it). */
  static start(elements: VaultElements, words: VaultWords): (() => void) | null {
    const ctx = elements.canvas.getContext("2d");
    if (ctx === null) {
      return null;
    }
    const film = new VaultFilm(elements, ctx, words);
    for (let at = 0; at < PRE_ROLL_FRAMES; at += 1) {
      advance(film.vault, 1 / 30, 0);
    }
    return film.run();
  }

  private run(): () => void {
    const { page, canvas, band } = this.elements;
    tintStages(this.elements.stages, this.palette());
    const resize = new ResizeObserver(() => this.measure());
    resize.observe(canvas);
    resize.observe(band);
    const listeners: [EventTarget, string, (event: Event) => void][] = [
      [page, "pointermove", (event): void => this.move(event)],
      [page, "pointerdown", (event): void => this.press(event)],
      [page, "pointerleave", (): void => this.leave()],
      [globalThis, "scroll", (): void => this.scrolled()],
      [document, "visibilitychange", (): void => this.resume()],
      [this.still, "change", (): void => this.resume()],
      [this.dark, "change", (): void => this.recolour()],
    ];
    for (const [target, type, listener] of listeners) {
      target.addEventListener(type, listener);
    }
    this.measure();
    void document.fonts.ready.then(() => this.measure());
    this.resume();
    return (): void => {
      this.halt();
      resize.disconnect();
      for (const [target, type, listener] of listeners) {
        target.removeEventListener(type, listener);
      }
    };
  }

  private palette(): Palette {
    return paletteFor(this.dark.matches);
  }

  /** The reader switched between light and dark: the film changes palette where it stands. */
  private recolour(): void {
    tintStages(this.elements.stages, this.palette());
    if (this.frame === 0) {
      this.draw(performance.now());
    }
  }

  /** Loops while the tab is shown and motion is welcome; otherwise paints one still frame. */
  private resume(): void {
    this.halt();
    if (this.still.matches) {
      this.settle();
    } else if (!document.hidden) {
      this.last = 0;
      this.frame = requestAnimationFrame((now) => this.tick(now));
    }
  }

  private halt(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Reduced motion: the film run forward to a settled moment, then held. */
  private settle(): void {
    if (this.vault.reader.step === null) {
      for (let at = 0; at < SETTLED_FRAMES; at += 1) {
        advance(this.vault, 1 / 30, 0.95);
      }
    }
    this.draw(performance.now());
  }

  /** Where the band and the track are on the fixed canvas; they move whenever the page scrolls. */
  private place(): void {
    const box = this.elements.canvas.getBoundingClientRect();
    this.band = relative(this.elements.band, box);
    this.track = relative(this.elements.steps, box);
  }

  /** Scrolling moves the band under the fixed vault; a looping film re-places it every frame. */
  private scrolled(): void {
    if (this.frame === 0) {
      this.place();
      this.draw(performance.now());
    }
  }

  private measure(): void {
    const { canvas } = this.elements;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    this.size.width = box.width;
    this.size.height = box.height;
    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.place();
    if (this.lamp.x === 0 && this.lamp.y === 0) {
      this.lamp.x = box.width * 0.5;
      this.lamp.y = box.height * 0.45;
    }
    if (this.frame === 0) {
      this.draw(performance.now());
    }
  }

  private held(now: number): boolean {
    return this.pointer.over && now - this.pointer.movedAt < HOLD_MS;
  }

  private pathU(x: number): number {
    return (x - this.band.x) / Math.max(1, this.band.w);
  }

  private lit(now: number): StageId {
    return this.held(now)
      ? stageAt(this.pathU(this.pointer.x))
      : STEP_STAGE[this.vault.reader.step ?? "invite"];
  }

  /** The lamp follows its target; the vault leans with it. */
  private aim(now: number, dt: number): void {
    const { lamp, size } = this;
    lamp.held = this.held(now);
    const { pointer, band, track, vault } = this;
    const { x: aimX, y: aimY } = vaultAim({
      held: lamp.held ? pointer : null,
      band,
      track,
      readerU: vault.reader.u,
      time: vault.time,
      view: size,
    });
    const follow = 1 - Math.exp(-dt * LAMP_FOLLOW);
    lamp.x += (aimX - lamp.x) * follow;
    lamp.y += (aimY - lamp.y) * follow;
    const lean = 1 - Math.exp(-dt * TILT_FOLLOW);
    lamp.tiltX += ((lamp.x / Math.max(1, size.width) - 0.5) * 2 - lamp.tiltX) * lean;
    lamp.tiltY += ((lamp.y / Math.max(1, size.height) - 0.5) * 2 - lamp.tiltY) * lean;
  }

  private tick(now: number): void {
    const dt = this.last === 0 ? 0 : Math.min(LONGEST_FRAME, (now - this.last) / 1000);
    this.last = now;
    this.place();
    this.aim(now, dt);
    this.drift += dt * DRIFT_RATE;
    advance(this.vault, dt, this.lamp.held ? clampUnit(this.pathU(this.pointer.x)) : null);
    this.draw(now);
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }

  private draw(now: number): void {
    const lit = this.lit(now);
    paint({
      ctx: this.ctx,
      width: this.size.width,
      height: this.size.height,
      band: this.band,
      track: this.track,
      lamp: this.lamp,
      vault: this.vault,
      lit,
      palette: this.palette(),
      sourceNames: this.words.sourceNames,
      refusedWord: this.words.refused,
      echoWord: this.words.echo,
      walk: this.drift,
      still: this.still.matches,
      trails: this.trails,
    });
    markPath(this.elements.stages, this.elements.steps, lit, this.vault.reader);
  }

  private move(event: Event): void {
    if (!(event instanceof PointerEvent)) {
      return;
    }
    const box = this.elements.canvas.getBoundingClientRect();
    const { pointer, lamp } = this;
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.over = true;
    pointer.movedAt = performance.now();
    if (this.still.matches) {
      lamp.x = pointer.x;
      lamp.y = pointer.y;
      lamp.held = true;
      this.draw(pointer.movedAt);
    }
  }

  private leave(): void {
    this.pointer.over = false;
    this.lamp.held = false;
    if (this.still.matches) {
      this.draw(performance.now());
    }
  }

  /** Pressing the flow is a run from the reader's own hand. Links and buttons stay links. */
  private press(event: Event): void {
    const { target } = event;
    if (target instanceof Element && target.closest(INTERACTIVE) !== null) {
      return;
    }
    this.move(event);
    this.place();
    const { y } = this.pointer;
    if (y >= this.band.y - 24 && y <= this.track.y + this.track.h) {
      trigger(this.vault, "run");
      if (this.still.matches) {
        this.draw(performance.now());
      }
    }
  }
}
