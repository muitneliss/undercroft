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
 * Colour: the ground is Ink and the data is Bone, the two ends of the palette. A division's
 * hue appears only on the column the lamp is over -- the column whose tab the visitor will
 * open after signing in -- lifted toward Bone so it holds contrast on Ink.
 *
 * This is the one place in the interface where motion is continuous rather than stepped. The
 * reasoning, and the boundary that keeps it here, is ADR 0063.
 */

import { type Point, type StageId, stageAt, type Vault } from "@/lib/vault/model.ts";

/** The palette's two ends and its lamp. DESIGN.md owns the values; these are its hexes. */
export const INK = "#16150f";
export const BONE = "#efe9d9";
export const CHROME = "#eda600";

/** A hex colour mixed toward Bone by `amount` (0..1), as `rgb()`. */
export function lift(hex: string, amount: number): string {
  function channel(from: string, at: number): number {
    return Number.parseInt(from.slice(at, at + 2), 16);
  }
  function mix(at: number): number {
    return Math.round(channel(hex, at) + (channel(BONE, at) - channel(hex, at)) * amount);
  }
  return `rgb(${mix(1)}, ${mix(3)}, ${mix(5)})`;
}

/** Each column's division hue from the wheel, lifted to read on Ink. */
export const STAGE_TONE: Record<StageId, string> = {
  sources: lift(CHROME, 0.05),
  raw: lift("#0f7673", 0.42),
  models: lift("#634cb0", 0.45),
  reports: lift("#7f4023", 0.5),
};

/** People's hue: the invitation is the People division's act. */
export const PEOPLE_TONE = lift("#234c9e", 0.5);

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

/** Bone, or the lit column's hue when `u` is in the column the lamp is over. */
export function tone(frame: Frame, u: number): string {
  const stage = stageAt(u);
  return stage === frame.lit ? STAGE_TONE[stage] : BONE;
}

/** A small filled or stroked circle; the book's punched hole, at canvas scale. */
export function hole(ctx: CanvasRenderingContext2D, at: Pixel, radius: number): void {
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, 2 * Math.PI);
}
