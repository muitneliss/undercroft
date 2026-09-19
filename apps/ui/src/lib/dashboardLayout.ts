/**
 * A dashboard's grid, and the moves an author can make on it.
 *
 * Twelve columns, as every grid a reader has met; a tile is a rectangle of whole cells with
 * a top-left corner. Every move here returns a layout the contract accepts: a tile cannot
 * leave the grid, cannot shrink past two cells a side (a chart in one cell is a smudge),
 * and cannot grow past the grid's width. Clamping rather than refusing, because an author
 * pressing "wider" at the right edge wants the widest tile there is, not an error.
 *
 * Adding a tile puts it below everything, full-height enough for a chart and half the
 * width, so two new tiles sit side by side once one is moved. A question already on the
 * dashboard is not added twice.
 */

import type { DashboardLayout, DashboardTile } from "@undercroft/contracts/bi";

export const COLUMNS = 12;
/** The smallest a tile may be, on either side. */
export const MIN_SIDE = 2;
/** As the contract bounds a tile's height. */
export const MAX_HEIGHT = 12;
/** As the contract bounds a tile's row. */
const MAX_ROW = 1000;
const NEW_WIDTH = 6;
const NEW_HEIGHT = 4;

function clampSize(value: number, max: number): number {
  return Math.min(max, Math.max(MIN_SIDE, value));
}

/** The tile, brought inside the grid and the size bounds. */
export function clampTile(tile: DashboardTile): DashboardTile {
  const w = clampSize(tile.w, COLUMNS);
  const h = clampSize(tile.h, MAX_HEIGHT);
  const x = Math.min(COLUMNS - w, Math.max(0, tile.x));
  const y = Math.min(MAX_ROW, Math.max(0, tile.y));
  return { questionId: tile.questionId, x, y, w, h };
}

function withTile(
  layout: DashboardLayout,
  questionId: string,
  change: (tile: DashboardTile) => DashboardTile,
): DashboardLayout {
  return {
    tiles: layout.tiles.map((tile) =>
      tile.questionId === questionId ? clampTile(change(tile)) : tile,
    ),
  };
}

export function moveTile(
  layout: DashboardLayout,
  questionId: string,
  dx: number,
  dy: number,
): DashboardLayout {
  return withTile(layout, questionId, (tile) => ({ ...tile, x: tile.x + dx, y: tile.y + dy }));
}

export function resizeTile(
  layout: DashboardLayout,
  questionId: string,
  dw: number,
  dh: number,
): DashboardLayout {
  return withTile(layout, questionId, (tile) => ({ ...tile, w: tile.w + dw, h: tile.h + dh }));
}

/** The first free row beneath every tile. */
function bottomOf(layout: DashboardLayout): number {
  return layout.tiles.reduce((low, tile) => Math.max(low, tile.y + tile.h), 0);
}

/** The layout with `questionId` on a new tile beneath the rest; unchanged if it is already on. */
export function addTile(layout: DashboardLayout, questionId: string): DashboardLayout {
  if (layout.tiles.some((tile) => tile.questionId === questionId)) {
    return layout;
  }
  const placed = clampTile({ questionId, x: 0, y: bottomOf(layout), w: NEW_WIDTH, h: NEW_HEIGHT });
  return { tiles: [...layout.tiles, placed] };
}

export function removeTile(layout: DashboardLayout, questionId: string): DashboardLayout {
  return { tiles: layout.tiles.filter((tile) => tile.questionId !== questionId) };
}

/** Tiles in reading order: top to bottom, then left to right. */
export function inReadingOrder(layout: DashboardLayout): DashboardTile[] {
  return [...layout.tiles].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The nine things a tile's controls can do to it, one cell at a time. */
export const TILE_ACTIONS = [
  "left",
  "right",
  "up",
  "down",
  "wider",
  "narrower",
  "taller",
  "shorter",
  "remove",
] as const;
export type TileAction = (typeof TILE_ACTIONS)[number];

export function applyTileAction(
  layout: DashboardLayout,
  questionId: string,
  action: TileAction,
): DashboardLayout {
  switch (action) {
    case "left":
      return moveTile(layout, questionId, -1, 0);
    case "right":
      return moveTile(layout, questionId, 1, 0);
    case "up":
      return moveTile(layout, questionId, 0, -1);
    case "down":
      return moveTile(layout, questionId, 0, 1);
    case "wider":
      return resizeTile(layout, questionId, 1, 0);
    case "narrower":
      return resizeTile(layout, questionId, -1, 0);
    case "taller":
      return resizeTile(layout, questionId, 0, 1);
    case "shorter":
      return resizeTile(layout, questionId, 0, -1);
    case "remove":
      return removeTile(layout, questionId);
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled tile action ${String(exhaustive)}`);
    }
  }
}
