/**
 * Where everything in the village stands (`docs/design/village.md`).
 *
 * One building per division, laid out along the path the data takes, left to right: the roads of
 * the customer's sources come in at the west edge through the gatehouse, the main road runs east
 * past the town hall to the stone vault, whose door opens on the lake behind it, the reading room
 * beside the vault and the archive across the road, the workshop, and ends at the printing house.
 * The lake-API road comes up from the south edge to the vault, because a caller with an ingest
 * key lands without a source's gate. The roads and the way along them are `roads.ts`.
 *
 * Pure data, so the runtime and anything else that needs a position read the same map. World
 * units are KayKit's: a hex tile is 2 across its flats, and +Y is up.
 */

import type { DivisionId } from "@/lib/divisions.ts";

export interface Point {
  readonly x: number;
  readonly z: number;
}

/** A model from the set, placed: by its name in `set.glb`, and the division its roof names. */
export interface Placement extends Point {
  readonly piece: string;
  /** Turn about +Y, in quarter turns. */
  readonly turn: number;
  readonly scale: number;
  readonly division: DivisionId | null;
}

export type PlaceId =
  | "gate"
  | "sign"
  | "hall"
  | "vault"
  | "archive"
  | "reading"
  | "workshop"
  | "press"
  | "houses";

/** A building a reader can press: it opens the division it stands for. */
export interface Place extends Point {
  readonly id: PlaceId;
  readonly division: DivisionId;
  /** How far from its centre a press still counts as the building. */
  readonly reach: number;
}

const SQRT3 = Math.sqrt(3);
const COLUMNS = 13;
const ROWS = 9;

/** The board: KayKit's pointy-top tiles in offset rows, centred on the origin. */
export function boardTiles(): readonly (Point & { readonly water: boolean })[] {
  const tiles: (Point & { water: boolean })[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = (column - (COLUMNS - 1) / 2) * 2 + (row % 2 === 1 ? 1 : 0) - 0.5;
      const z = (row - (ROWS - 1) / 2) * SQRT3;
      tiles.push({ x, z, water: isLake(x, z) });
    }
  }
  return tiles;
}

/** The lake behind the vault, north of the main road: the vault is the door to it. */
function isLake(x: number, z: number): boolean {
  return z < -2.6 && x > -1.6 && x < 6.6;
}

const BUILDING_SCALE = 1.5;

/** Every building, prop and tree, in the order they are placed. */
export const PLACEMENTS: readonly Placement[] = [
  { piece: "gate", x: -8, z: 0, turn: 1, scale: BUILDING_SCALE, division: null },
  { piece: "gate_tower", x: -8, z: -2.6, turn: 0, scale: BUILDING_SCALE, division: "sources" },
  { piece: "wall", x: -8, z: 3, turn: 1, scale: BUILDING_SCALE, division: null },
  { piece: "sign", x: -9.9, z: 1.3, turn: 0, scale: 3, division: "customers" },
  { piece: "hall", x: -4, z: -4.2, turn: 0, scale: BUILDING_SCALE, division: "journal" },
  { piece: "vault", x: 0, z: -2.2, turn: 0, scale: BUILDING_SCALE, division: "lake" },
  { piece: "reading_room", x: 3.6, z: -2.1, turn: 0, scale: BUILDING_SCALE, division: "lake" },
  { piece: "archive", x: 1.8, z: 2.5, turn: 2, scale: BUILDING_SCALE, division: "lake" },
  { piece: "workshop", x: 7.8, z: -2.2, turn: 0, scale: BUILDING_SCALE, division: "models" },
  { piece: "press", x: 10.4, z: 2.3, turn: 2, scale: BUILDING_SCALE, division: "reports" },
  { piece: "house", x: 9, z: -5.4, turn: 0, scale: BUILDING_SCALE, division: "people" },
  { piece: "house", x: 11.4, z: -3.8, turn: 3, scale: BUILDING_SCALE, division: "people" },
  { piece: "house", x: 7, z: 4.6, turn: 2, scale: BUILDING_SCALE, division: "people" },
  { piece: "well", x: -2, z: 1.6, turn: 0, scale: BUILDING_SCALE, division: null },
  { piece: "pallet", x: 6.4, z: 1.3, turn: 0, scale: 2, division: null },
  { piece: "barrel", x: 5.2, z: 1.5, turn: 0, scale: 2, division: null },
  { piece: "sack", x: 11.6, z: 1.2, turn: 0, scale: 2, division: null },
  { piece: "trees_large", x: -10.5, z: -6, turn: 0, scale: 1, division: null },
  { piece: "trees_medium", x: -6.5, z: -6.2, turn: 1, scale: 1, division: null },
  { piece: "trees_medium", x: 12, z: -6, turn: 2, scale: 1, division: null },
  { piece: "trees_small", x: 12.4, z: 5.6, turn: 0, scale: 1, division: null },
  { piece: "trees_large", x: 10, z: 6, turn: 1, scale: 1, division: null },
  { piece: "trees_small", x: 1.2, z: 6, turn: 0, scale: 1, division: null },
  { piece: "tree", x: 3.8, z: 5.4, turn: 0, scale: 1.4, division: null },
  { piece: "rock", x: -7, z: 5.4, turn: 0, scale: 2, division: null },
  { piece: "tree", x: -5.6, z: 3.8, turn: 0, scale: 1.4, division: null },
  { piece: "trees_medium", x: -10.6, z: 6, turn: 0, scale: 1, division: null },
];

/** The buildings a reader can press, and the division each opens. */
export const PLACES: readonly Place[] = [
  { id: "gate", division: "sources", x: -8, z: -1, reach: 2 },
  { id: "sign", division: "customers", x: -9.9, z: 1.3, reach: 0.8 },
  { id: "hall", division: "journal", x: -4, z: -4.2, reach: 1.6 },
  { id: "vault", division: "lake", x: 0, z: -2.2, reach: 1.6 },
  { id: "archive", division: "lake", x: 1.8, z: 2.5, reach: 1.2 },
  { id: "reading", division: "lake", x: 3.6, z: -2.1, reach: 1.2 },
  { id: "workshop", division: "models", x: 7.8, z: -2.2, reach: 1.6 },
  { id: "press", division: "reports", x: 10.4, z: 2.3, reach: 1.6 },
  { id: "houses", division: "people", x: 10, z: -4.6, reach: 2.4 },
];

/** Where the vault's crates are stacked, the step its refused crates are set aside on, and the bell. */
export const VAULT_STACK: Point = { x: 1.1, z: -1 };
export const SET_ASIDE: Point = { x: -1.4, z: -1.6 };
export const WORKSHOP_PIECES: Point = { x: 7.4, z: 1.2 };
export const BELL: Point = { x: -2.5, z: -4.4 };
