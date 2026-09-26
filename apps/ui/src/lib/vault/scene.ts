/**
 * The whole frame, back to front: the lamp-lit undercroft, the data path across its floor
 * (`band.ts`), the reader's track with a thread from each step into the data it moved, and the
 * proof slip for whatever the lamp is held over.
 */

import {
  bars,
  columns,
  emitters,
  gate,
  lake,
  lanes,
  tableAndTray,
  trayPoint,
  travellers,
} from "@/lib/vault/band.ts";
import { type Frame, hole, line, mapper, type Pixel, rgba, since } from "@/lib/vault/frame.ts";
import {
  LAYOUT,
  type Point,
  STEPS,
  type StepId,
  slotPoint,
  stepU,
  type Traveller,
} from "@/lib/vault/model.ts";

const ARCHES = 9;
const ARCH_GAP = 0.62;
const HOVER_RADIUS = 34;
const LABELLED_BAND = 640;

/** Ink, warmed where the lamp is. */
function ground(frame: Frame): void {
  const { ctx, width, height, lamp, palette } = frame;
  ctx.fillStyle = frame.palette.ground;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(
    lamp.x,
    lamp.y,
    0,
    lamp.x,
    lamp.y,
    Math.max(width, height) * 0.55,
  );
  glow.addColorStop(0, rgba(palette.glow, palette.glowAlpha));
  glow.addColorStop(0.35, rgba(palette.glow, palette.glowAlpha * 0.3));
  glow.addColorStop(1, rgba(palette.glow, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

/** Where the corridor recedes to: away from the lamp, so the vault turns with the hand. */
function vanishing(frame: Frame): Pixel {
  const { width, height, lamp } = frame;
  return {
    x: width * 0.5 - lamp.tiltX * width * 0.24,
    y: height * 0.4 - lamp.tiltY * height * 0.2,
  };
}

/**
 * The undercroft: a barrel of round arches receding to the vanishing point and drifting slowly
 * toward the viewer. Stroked with a gradient centred on the lamp, so the stone can be read only
 * where it is lit.
 */
function vaultRibs(frame: Frame): void {
  const { ctx, width, height, lamp } = frame;
  const vanish = vanishing(frame);
  const near = { x: width * 0.5, half: Math.max(width * 0.62, height * 0.7), floor: height * 1.08 };
  const lift = height * 0.8;
  const light = ctx.createRadialGradient(
    lamp.x,
    lamp.y,
    0,
    lamp.x,
    lamp.y,
    Math.max(width, height) * 0.62,
  );
  light.addColorStop(0, line(frame, 0.9));
  light.addColorStop(0.4, line(frame, 0.26));
  light.addColorStop(1, line(frame, 0.05));
  ctx.strokeStyle = light;
  const phase = frame.walk % 1;
  for (let arch = ARCHES - 1; arch >= 0; arch -= 1) {
    const depth = 0.55 + (arch + 1 - phase) * ARCH_GAP;
    const scale = 1 / depth;
    const cx = vanish.x + (near.x - vanish.x) * scale;
    const floor = vanish.y + (near.floor - vanish.y) * scale;
    const half = near.half * scale;
    const spring = floor - lift * scale;
    // Fade in at the far end, and out as an arch passes over the viewer.
    const fade = Math.min(1, (ARCHES - arch - phase) / 1.5) * Math.min(1, depth - 0.55);
    ctx.globalAlpha = Math.max(0, fade) * (0.35 + 0.65 * Math.min(1, scale * 1.4));
    ctx.lineWidth = Math.max(0.6, 2.2 * scale);
    ctx.beginPath();
    ctx.moveTo(cx - half, floor);
    ctx.lineTo(cx - half, spring);
    ctx.ellipse(cx, spring, half, half * 0.9, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(cx + half, floor);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Which part of the band a step acts on, for the thread drawn up from it. */
function stepTarget(frame: Frame, step: StepId): Point {
  switch (step) {
    case "invite":
      return { u: LAYOUT.emitterU, v: -0.08 };
    case "connect": {
      const flares = frame.vault.sourceFlares;
      return {
        u: LAYOUT.emitterU,
        v: LAYOUT.sourceV(Math.max(0, flares.indexOf(Math.max(...flares)))),
      };
    }
    case "choose":
      return LAYOUT.gate;
    case "run":
      return { u: (LAYOUT.lake.u0 + LAYOUT.lake.u1) / 2, v: LAYOUT.lake.v1 };
    case "model":
      return { u: LAYOUT.laneOut, v: LAYOUT.laneV[2] };
    default:
      return { u: (LAYOUT.bars.u0 + LAYOUT.bars.u1) / 2, v: LAYOUT.bars.base };
  }
}

/** Cause to effect: a curve from a step up into the data it moved, with a bead running up it. */
function thread(frame: Frame, from: Pixel, step: StepId, flare: number): void {
  const { ctx } = frame;
  const to = mapper(frame)(stepTarget(frame, step));
  const bend = { x: from.x, y: (from.y + to.y) / 2 };
  const colour = step === "invite" ? frame.palette.people : frame.palette.accent;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.globalAlpha = flare * 0.85;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(bend.x, bend.y, to.x, to.y);
  ctx.stroke();
  const t = Math.min(1, (1 - flare) * 2.2);
  function along(a: number, b: number, c: number): number {
    return (1 - t) ** 2 * a + 2 * (1 - t) * t * b + t ** 2 * c;
  }
  ctx.globalAlpha = flare;
  hole(ctx, { x: along(from.x, bend.x, to.x), y: along(from.y, bend.y, to.y) }, 3.5);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** The reader's track: six ticks, inked in chrome as the reader passes them. */
function readerTrack(frame: Frame): void {
  const { ctx, track, vault } = frame;
  const readerU = Math.min(1, Math.max(0, vault.reader.u));
  ctx.lineWidth = 1;
  ctx.strokeStyle = line(frame, 0.35);
  ctx.beginPath();
  ctx.moveTo(track.x, track.y);
  ctx.lineTo(track.x + track.w, track.y);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = frame.palette.accent;
  ctx.beginPath();
  ctx.moveTo(track.x, track.y);
  ctx.lineTo(track.x + readerU * track.w, track.y);
  ctx.stroke();
  for (const step of STEPS) {
    const tick = { x: track.x + stepU(step) * track.w, y: track.y };
    const reached = readerU >= stepU(step);
    ctx.fillStyle = reached ? frame.palette.accent : frame.palette.ground;
    ctx.strokeStyle = reached ? frame.palette.accent : line(frame, 0.6);
    ctx.lineWidth = 1.5;
    hole(ctx, tick, 4);
    ctx.fill();
    ctx.stroke();
    const flare = since(frame, vault.flares[step], 1.3);
    if (flare > 0) {
      thread(frame, tick, step, flare);
    }
  }
}

/** The reader: an open hole before the invitation, inked once they are signed in. */
function readerMark(frame: Frame): void {
  const { ctx, track, vault } = frame;
  const at = { x: track.x + Math.min(1, Math.max(0, vault.reader.u)) * track.w, y: track.y };
  const pulse = frame.still ? 0 : 0.5 + 0.5 * Math.sin(vault.time * 4);
  ctx.fillStyle = rgba(frame.palette.glow, 0.2);
  hole(ctx, at, 12 + pulse * 5);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = vault.reader.signedIn ? frame.palette.accent : frame.palette.ink;
  ctx.fillStyle = vault.reader.signedIn ? frame.palette.accent : frame.palette.ground;
  hole(ctx, at, 7);
  ctx.fill();
  ctx.stroke();
}

interface Hovered {
  readonly at: Pixel;
  readonly hash: string;
  readonly note: string;
}

/** The thing nearest the lamp, when the lamp is held close enough to read it. */
function hovered(frame: Frame, drawn: Map<Traveller, Pixel>): Hovered | null {
  if (!frame.lamp.held) {
    return null;
  }
  const { vault, sourceNames } = frame;
  const at = mapper(frame);
  const candidates: Hovered[] = [
    ...vault.blocks.map((block) => {
      const source = sourceNames[block.source] ?? "";
      const note = block.echoes > 0 ? `${source} · ${frame.echoWord}` : source;
      return { at: at(slotPoint(vault, block.slot)), hash: block.hash, note };
    }),
    ...[...drawn]
      .filter(([traveller]) => traveller.kind !== "shaped")
      .map(([traveller, here]) => ({
        at: here,
        hash: traveller.hash,
        note: sourceNames[traveller.source] ?? "",
      })),
    ...vault.refused.map((refusal, place) => ({
      at: at(trayPoint(place)),
      hash: refusal.hash,
      note: frame.refusedWord,
    })),
  ];
  let best: Hovered | null = null;
  let bestDistance = HOVER_RADIUS;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.at.x - frame.lamp.x, candidate.at.y - frame.lamp.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/** A proof slip beside the thing under the lamp: its content address and where it came from. */
function proofSlip(frame: Frame, item: Hovered): void {
  const { ctx, width } = frame;
  const first = `sha256:${item.hash}…`;
  const second = item.note.toUpperCase();
  ctx.font = "600 12px 'Spline Sans Mono', ui-monospace, monospace";
  const w = Math.max(ctx.measureText(first).width, ctx.measureText(second).width) + 20;
  const h = second === "" ? 26 : 44;
  const flip = item.at.x + 24 + w > width - 8;
  const x = flip ? item.at.x - 24 - w : item.at.x + 24;
  const y = item.at.y - 34 - h / 2;
  ctx.strokeStyle = frame.palette.accent;
  ctx.lineWidth = 1;
  hole(ctx, item.at, 9);
  ctx.moveTo(item.at.x + (flip ? -7 : 7), item.at.y - 7);
  ctx.lineTo(flip ? x + w : x, y + h / 2);
  ctx.stroke();
  ctx.fillStyle = frame.palette.ground;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = frame.palette.ink;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textBaseline = "middle";
  ctx.fillStyle = frame.palette.ink;
  ctx.fillText(first, x + 10, y + 13);
  if (second !== "") {
    ctx.fillStyle = frame.palette.accent;
    ctx.font = "700 10px 'Archivo', ui-sans-serif, sans-serif";
    ctx.fillText(second, x + 10, y + 31);
  }
}

/** One whole frame, back to front. */
export function paint(frame: Frame): void {
  ground(frame);
  vaultRibs(frame);
  columns(frame);
  emitters(frame, frame.band.w >= LABELLED_BAND);
  lake(frame);
  tableAndTray(frame);
  lanes(frame);
  bars(frame);
  gate(frame);
  const drawn = travellers(frame);
  readerTrack(frame);
  readerMark(frame);
  const item = hovered(frame, drawn);
  if (item !== null) {
    proofSlip(frame, item);
  }
}
