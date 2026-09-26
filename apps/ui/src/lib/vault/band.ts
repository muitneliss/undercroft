/**
 * The data path, painted across the band: the sources, the one wall and its one door, the
 * lake, the table's edge and its tray of refusals, the model lanes, the report, and every
 * record in flight. The light and colour rules they are drawn under are in `frame.ts`.
 */

import {
  BONE,
  CHROME,
  type Frame,
  hole,
  lampLight,
  mapper,
  type Pixel,
  STAGE_TONE,
  since,
  tone,
} from "@/lib/vault/frame.ts";
import {
  LAYOUT,
  positionOf,
  SOURCE_COUNT,
  STAGES,
  slotPoint,
  type Traveller,
} from "@/lib/vault/model.ts";

const PART_RADIUS = 120;
const PART_PUSH = 30;
const HAIRLINE = "rgba(239, 233, 217, 0.16)";
const QUIET = "rgba(239, 233, 217, 0.45)";

/** The lit column's faint wash, and the rules between the columns the gate's wall is not. */
export function columns(frame: Frame): void {
  const { ctx, band } = frame;
  const at = mapper(frame);
  const left = at({ u: STAGES.indexOf(frame.lit) * 0.25, v: 0 });
  const wash = ctx.createLinearGradient(0, band.y, 0, band.y + band.h);
  wash.addColorStop(0, "rgba(239, 233, 217, 0.035)");
  wash.addColorStop(1, "rgba(239, 233, 217, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(left.x, band.y - 8, band.w * 0.25, band.h + 16);
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = 1;
  for (const u of [0.5, 0.75]) {
    const top = at({ u, v: -0.04 });
    const bottom = at({ u, v: 1.02 });
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
}

/** The opening of the mark's arch: two jambs and a round head. */
function doorway(ctx: CanvasRenderingContext2D, door: Pixel, half: number, tall: number): void {
  ctx.moveTo(door.x + half, door.y + tall * 0.55);
  ctx.lineTo(door.x + half, door.y - tall * 0.2);
  ctx.arc(door.x, door.y - tall * 0.2, half, 0, Math.PI, true);
  ctx.lineTo(door.x - half, door.y + tall * 0.55);
  ctx.closePath();
}

/** The one wall and its one door: the mark's block with the arch cut through it. */
export function gate(frame: Frame): void {
  const { ctx, band, vault } = frame;
  const at = mapper(frame);
  const door = at(LAYOUT.gate);
  const half = Math.max(9, band.h * 0.05);
  const tall = Math.max(24, band.h * 0.12);
  const wallTop = at({ u: LAYOUT.gate.u, v: -0.04 });
  const wallBottom = at({ u: LAYOUT.gate.u, v: 1.02 });
  ctx.strokeStyle = BONE;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(wallTop.x, wallTop.y);
  ctx.lineTo(door.x, door.y - tall);
  ctx.moveTo(door.x, door.y + tall * 0.55);
  ctx.lineTo(wallBottom.x, wallBottom.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.rect(door.x - half - 5, door.y - tall, (half + 5) * 2, tall * 1.55);
  doorway(ctx, door, half, tall);
  ctx.fill("evenodd");
  const flare = Math.max(since(frame, vault.gateAt, 0.35), since(frame, vault.flares.choose, 1.2));
  if (flare > 0) {
    ctx.fillStyle = CHROME;
    ctx.globalAlpha = flare * 0.9;
    ctx.beginPath();
    doorway(ctx, door, half, tall);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

/** Each source as an open hole that flares when it sends on the reader's word. */
export function emitters(frame: Frame, labelled: boolean): void {
  const { ctx, vault } = frame;
  const at = mapper(frame);
  ctx.font = "600 11px 'Spline Sans Mono', ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (let source = 0; source < SOURCE_COUNT; source += 1) {
    const point = at({ u: LAYOUT.emitterU, v: LAYOUT.sourceV(source) });
    ctx.strokeStyle = BONE;
    ctx.lineWidth = 1.5;
    hole(ctx, point, 5);
    ctx.stroke();
    const flare = since(frame, vault.sourceFlares[source] ?? 0, 0.9);
    if (flare > 0) {
      ctx.fillStyle = CHROME;
      ctx.globalAlpha = flare;
      hole(ctx, point, 5 + (1 - flare) * 10);
      ctx.fill();
    }
    const name = frame.sourceNames[source];
    if (labelled && name !== undefined) {
      ctx.fillStyle = frame.lit === "sources" ? STAGE_TONE.sources : BONE;
      ctx.globalAlpha = 0.6 + 0.4 * lampLight(frame, point.x, point.y);
      ctx.fillText(name.toUpperCase(), point.x + 12, point.y - 11);
    }
    ctx.globalAlpha = 1;
  }
}

/** The raw lake: blocks laid once, inking in, echoing when their content arrives again. */
export function lake(frame: Frame): void {
  const { ctx, vault } = frame;
  const at = mapper(frame);
  const box = LAYOUT.lake;
  const top = at({ u: box.u0, v: box.v0 });
  const bottom = at({ u: box.u1, v: box.v1 });
  const cellW = (bottom.x - top.x) / box.cols;
  const cellH = (bottom.y - top.y) / box.rows;
  ctx.strokeStyle = "rgba(239, 233, 217, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(top.x - 4, top.y - 4, bottom.x - top.x + 8, bottom.y - top.y + 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(top.x - 3, top.y - 3, bottom.x - top.x + 6, bottom.y - top.y + 6);
  ctx.clip();
  const colour = tone(frame, box.u0);
  const w = cellW * 0.78;
  const h = cellH * 0.58;
  for (const block of vault.blocks) {
    const centre = at(slotPoint(vault, block.slot));
    const sinking = Math.min(1, Math.max(0, (centre.y - bottom.y + cellH) / cellH));
    ctx.globalAlpha = (0.42 + 0.58 * lampLight(frame, centre.x, centre.y)) * (1 - sinking * 0.85);
    ctx.fillStyle = since(frame, block.laidAt, 0.7) > 0 ? CHROME : colour;
    ctx.fillRect(centre.x - w / 2, centre.y - h / 2, w, h);
    const echo = since(frame, block.echoAt, 0.8);
    if (echo > 0) {
      const grow = (1 - echo) * 8;
      ctx.globalAlpha = echo;
      ctx.strokeStyle = CHROME;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(centre.x - w / 2 - grow, centre.y - h / 2 - grow, w + grow * 2, h + grow * 2);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Where a refusal sits in the tray, in path space. */
export function trayPoint(place: number): { u: number; v: number } {
  return { u: LAYOUT.tray.u + place * LAYOUT.tray.gap, v: LAYOUT.tray.v };
}

/** The generic table's edge, and the tray where a refused row is kept, struck. */
export function tableAndTray(frame: Frame): void {
  const { ctx, vault } = frame;
  const at = mapper(frame);
  const top = at({ u: LAYOUT.tableU, v: 0.08 });
  const bottom = at({ u: LAYOUT.tableU, v: 0.88 });
  ctx.strokeStyle = "rgba(239, 233, 217, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.stroke();
  ctx.setLineDash([]);
  vault.refused.forEach((refusal, place) => {
    const point = at(trayPoint(place));
    const fresh = since(frame, refusal.at, 0.6);
    ctx.globalAlpha = 0.5 + 0.5 * Math.max(fresh, lampLight(frame, point.x, point.y));
    ctx.strokeStyle = BONE;
    ctx.strokeRect(point.x - 5, point.y - 3, 10, 6);
    ctx.beginPath();
    ctx.moveTo(point.x - 7, point.y + 5);
    ctx.lineTo(point.x + 7, point.y - 5);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

/** Three model lanes; each collects three rows, seat by seat, and makes one shaped row. */
export function lanes(frame: Frame): void {
  const { ctx, vault } = frame;
  const at = mapper(frame);
  const flare = since(frame, vault.flares.model, 1.2);
  const ink = frame.lit === "models" ? STAGE_TONE.models : BONE;
  LAYOUT.laneV.forEach((v, lane) => {
    const start = at({ u: LAYOUT.laneIn, v });
    const end = at({ u: LAYOUT.laneOut, v });
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.3 + flare * 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let seat = 0; seat < 3; seat += 1) {
      hole(ctx, { x: end.x + 8 + seat * 8, y: end.y }, 2.6);
      if (seat < (vault.lanes[lane] ?? 0)) {
        ctx.fillStyle = ink;
        ctx.fill();
      } else {
        ctx.strokeStyle = QUIET;
        ctx.stroke();
      }
    }
  });
}

/** The report the shaped rows build, its top edge flaring when the reader asks. */
export function bars(frame: Frame): void {
  const { ctx, vault } = frame;
  const at = mapper(frame);
  const box = LAYOUT.bars;
  const step = (box.u1 - box.u0) / box.count;
  const flare = since(frame, vault.flares.ask, 1.4);
  const base = at({ u: box.u0, v: box.base });
  const baseEnd = at({ u: box.u1, v: box.base });
  ctx.strokeStyle = "rgba(239, 233, 217, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(base.x, base.y + 2);
  ctx.lineTo(baseEnd.x, baseEnd.y + 2);
  ctx.stroke();
  const colour = frame.lit === "reports" ? STAGE_TONE.reports : BONE;
  vault.bars.forEach((height, bar) => {
    const left = at({ u: box.u0 + (bar + 0.18) * step, v: box.base });
    const right = at({ u: box.u0 + (bar + 0.82) * step, v: box.base });
    const top = at({ u: box.u0, v: box.base - height * box.height });
    ctx.globalAlpha = 0.75 + 0.25 * Math.max(flare, lampLight(frame, left.x, top.y));
    ctx.fillStyle = colour;
    ctx.fillRect(left.x, top.y, right.x - left.x, base.y - top.y);
    ctx.fillStyle = CHROME;
    ctx.globalAlpha = flare;
    ctx.fillRect(left.x, top.y - 2, right.x - left.x, 2);
  });
  ctx.globalAlpha = 1;
}

/** Records part around the lamp when it is held over them. */
function parted(frame: Frame, at: Pixel): Pixel {
  const dx = at.x - frame.lamp.x;
  const dy = at.y - frame.lamp.y;
  const distance = Math.hypot(dx, dy);
  if (!frame.lamp.held || frame.still || distance >= PART_RADIUS || distance < 0.001) {
    return at;
  }
  const push = (1 - distance / PART_RADIUS) ** 2 * PART_PUSH;
  return { x: at.x + (dx / distance) * push, y: at.y + (dy / distance) * push };
}

/** Every record, copy and shaped row in flight, with a short trail; returns where each was drawn. */
export function travellers(frame: Frame): Map<Traveller, Pixel> {
  const { ctx, vault, trails } = frame;
  const at = mapper(frame);
  const drawn = new Map<Traveller, Pixel>();
  for (const traveller of vault.travellers) {
    const point = positionOf(vault, traveller);
    const here = parted(frame, at(point));
    const light = lampLight(frame, here.x, here.y);
    const colour = traveller.kind === "shaped" ? STAGE_TONE.models : tone(frame, point.u);
    const last = trails.get(traveller.id);
    if (!frame.still && last !== undefined && Math.hypot(here.x - last.x, here.y - last.y) < 60) {
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.35 + 0.3 * light;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(here.x, here.y);
      ctx.stroke();
    }
    const [w, h] = traveller.kind === "shaped" ? [20, 7] : [12, 6];
    ctx.globalAlpha = traveller.phase === "drop" ? 0.6 : 0.72 + 0.28 * light;
    ctx.fillStyle = traveller.phase === "pass" ? CHROME : colour;
    ctx.fillRect(here.x - w / 2, here.y - h / 2, w, h);
    drawn.set(traveller, here);
  }
  trails.clear();
  for (const [traveller, here] of drawn) {
    trails.set(traveller.id, here);
  }
  ctx.globalAlpha = 1;
  return drawn;
}
