/**
 * What one painted frame of the vault knows, and the light every part of it is drawn in.
 *
 * THE POINTER IS A LAMP, AND IT IS THE ONLY LIGHT. Every depth cue answers it: the vanishing
 * point swings away from it, so the vault turns in whichever direction the hand moves; the
 * ribs are stroked with a gradient centred on it, so the stone is only readable where it is
 * held; the data near it is at full ink and everything else is dimmer; records part around it
 * the way water parts around a finger. Nothing is lit that the lamp is not near, which is what
 * makes the cover read as high contrast rather than as a dark theme.
 *
 * Colour follows the reader's colour scheme (ADR 0064). At night the ground is Ink and the data
 * is Bone, the palette's two ends; by day the ground is the Page stock and the data is Ink, the
 * book as printed. In both, a division's hue appears only on the column the lamp is over -- the
 * column whose tab the visitor will open after signing in -- lifted toward Bone at night so it
 * holds contrast on Ink, and darkened toward Ink by day where the wheel's own value is too pale.
 * `frame.test.ts` holds both palettes to WCAG contrast on their own ground.
 *
 * This is the one place in the interface where motion is continuous rather than stepped. The
 * reasoning, and the boundary that keeps it here, is ADR 0063.
 */

import { parseHex, toHex } from "@/lib/acetate.ts";
import { type Point, type StageId, stageAt, type Vault } from "@/lib/vault/model.ts";

/** The book's stock, ink and wheel. DESIGN.md owns the values; these are its hexes. */
const INK = "#16150f";
const BONE = "#efe9d9";
const PAGE = "#f7f3e7";
const CHROME = "#eda600";
const TEAL = "#0f7673";
const VIOLET = "#634cb0";
const SIENNA = "#7f4023";
const ULTRAMARINE = "#234c9e";

/** `from` mixed toward `to` by `amount` (0..1), as hex. Refuses a colour it cannot read. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (a === null || b === null) {
    throw new Error(`not a hex colour: ${from} / ${to}`);
  }
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

/** Everything the painter colours with, for one colour scheme. */
export interface Palette {
  readonly ground: string;
  /** The data, the rules' colour at full strength, and the proof slip's lettering. */
  readonly ink: string;
  /** The lamp's colour where it marks something: a gate passing, a fresh block, the reader. */
  readonly accent: string;
  /** `r, g, b` of the lamp's warmth, for the halo around the reader. The page draws the glow. */
  readonly glow: string;
  /** `r, g, b` of every rule, rib and hairline; alphas are chosen where each is drawn. */
  readonly line: string;
  readonly lineStrength: number;
  readonly tones: Readonly<Record<StageId, string>>;
  /** People's hue: the invitation is the People division's act. */
  readonly people: string;
}

export const NIGHT: Palette = {
  ground: INK,
  ink: BONE,
  accent: CHROME,
  glow: "237, 166, 0",
  line: "239, 233, 217",
  lineStrength: 1,
  tones: {
    sources: mix(CHROME, BONE, 0.05),
    raw: mix(TEAL, BONE, 0.42),
    models: mix(VIOLET, BONE, 0.45),
    reports: mix(SIENNA, BONE, 0.5),
  },
  people: mix(ULTRAMARINE, BONE, 0.5),
};

export const DAY: Palette = {
  ground: PAGE,
  ink: INK,
  accent: mix(CHROME, INK, 0.45),
  glow: "237, 166, 0",
  line: "22, 21, 15",
  lineStrength: 0.7,
  tones: {
    sources: mix(CHROME, INK, 0.45),
    raw: TEAL,
    models: VIOLET,
    reports: SIENNA,
  },
  people: ULTRAMARINE,
};

export function paletteFor(dark: boolean): Palette {
  return dark ? NIGHT : DAY;
}

/** A palette's `r, g, b` at an alpha, as a canvas colour. */
export function rgba(rgb: string, alpha: number): string {
  return `rgba(${rgb}, ${alpha})`;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pixel {
  x: number;
  y: number;
}

export interface Lamp {
  /** Where the lamp is, in canvas pixels, smoothed. */
  x: number;
  y: number;
  /** The lamp's offset from the centre of the canvas, -1..1 on each axis, smoothed. */
  tiltX: number;
  tiltY: number;
  /** Whether a pointer is actually over the cover, as opposed to the lamp walking by itself. */
  held: boolean;
}

export interface Frame {
  readonly ctx: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /** The flow band and the reader's track, in canvas pixels. */
  readonly band: Rect;
  readonly track: Rect;
  readonly lamp: Lamp;
  readonly vault: Vault;
  readonly lit: StageId;
  readonly palette: Palette;
  /** Source names, and the words a hovered item carries: the catalogue's, never written here. */
  readonly sourceNames: readonly string[];
  readonly refusedWord: string;
  readonly echoWord: string;
  /** The corridor's drift, in arches. */
  readonly walk: number;
  /** Reduced motion: the lamp still lights, but nothing is pushed and nothing trails. */
  readonly still: boolean;
  /** Where each traveller was drawn last frame, for its trail. Owned by the caller. */
  readonly trails: Map<number, Pixel>;
}

/** How strongly the lamp lights a point, 0..1. */
export function lampLight(frame: Frame, x: number, y: number): number {
  const reach = Math.max(frame.width, frame.height) * 0.42;
  const distance = Math.hypot(x - frame.lamp.x, y - frame.lamp.y);
  return Math.max(0, 1 - distance / reach) ** 1.6;
}

/** Path space to canvas pixels, with the near layer's parallax against the lamp. */
export function mapper(frame: Frame): (point: Point) => Pixel {
  const { band, lamp } = frame;
  const dx = -lamp.tiltX * 14;
  const dy = -lamp.tiltY * 9;
  return (point) => ({ x: band.x + point.u * band.w + dx, y: band.y + point.v * band.h + dy });
}

/** A flare's strength, 1 the moment `at` happened and 0 once `over` seconds have passed. */
export function since(frame: Frame, at: number, over: number): number {
  const age = frame.vault.time - at;
  return age < 0 || age > over ? 0 : 1 - age / over;
}

/** The data's ink, or the lit column's hue when `u` is in the column the lamp is over. */
export function tone(frame: Frame, u: number): string {
  const stage = stageAt(u);
  return stage === frame.lit ? frame.palette.tones[stage] : frame.palette.ink;
}

/** A rule or rib in the palette's line colour, scaled to how strongly this scheme draws lines. */
export function line(frame: Frame, alpha: number): string {
  return rgba(frame.palette.line, alpha * frame.palette.lineStrength);
}

/** A small filled or stroked circle; the book's punched hole, at canvas scale. */
export function hole(ctx: CanvasRenderingContext2D, at: Pixel, radius: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI);
}
