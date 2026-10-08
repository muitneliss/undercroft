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
  /** Height above the board, for what floats: a lily sits on the lake, below the grass. */
  readonly y?: number;
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
const PROP_SCALE = 2;
const FLAG_SCALE = 3;
/** Where a lily or a reed sits: on the water, which lies below the grass. */
const WATER_LEVEL = -0.18;

/**
 * What makes the village look lived in rather than laid out: work left by each building, trees
 * on the edges, plants on the lake. Kept apart from the buildings so the map of what stands for
 * what stays short.
 */
const DRESSING: readonly Placement[] = [
  // The gate: what the couriers have stacked inside it.
  { piece: "crate_big", x: -6.6, z: -2.5, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "barrel", x: -6.1, z: -3.1, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "sack", x: -6.8, z: 2.6, turn: 1, scale: PROP_SCALE, division: null },
  { piece: "lumber", x: -5.8, z: 2.9, turn: 0, scale: PROP_SCALE, division: null },
  // The hall and its yard.
  { piece: "grain", x: -6.6, z: -5.8, turn: 0, scale: 1, division: null },
  { piece: "rock_e", x: -5.3, z: -1.6, turn: 0, scale: PROP_SCALE, division: null },
  // The vault and the reading room, on the shore.
  { piece: "stone", x: -1.6, z: -2.9, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "bucket", x: 1, z: -1.8, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "crate_long", x: 5.7, z: -1.75, turn: 1, scale: PROP_SCALE, division: null },
  // The archive, across the road.
  { piece: "barrel", x: 0.7, z: 3.2, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "crate", x: 3, z: 3.3, turn: 0, scale: PROP_SCALE, division: null },
  // The workshop's ladder, and the timber waiting behind its lumbermill.
  { piece: "ladder", x: 8.8, z: -3.4, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "lumber", x: 9.5, z: -3.95, turn: 0, scale: PROP_SCALE, division: null },
  // The press's yard, and the stone the lumbermill moved off the workshop's.
  { piece: "stone", x: 12.1, z: 0.8, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "crate_big", x: 11.7, z: 3.2, turn: 0, scale: PROP_SCALE, division: null },
  { piece: "handcart", x: 9.1, z: 3.4, turn: 3, scale: PROP_SCALE, division: null },
  // The houses: a windmill, a fence, a tent at the edge of the fields.
  { piece: "windmill", x: 12.2, z: -1.5, turn: 3, scale: BUILDING_SCALE, division: null },
  { piece: "fence_stone", x: 8.4, z: -4.2, turn: 0, scale: BUILDING_SCALE, division: null },
  { piece: "tent", x: -3.4, z: 4.4, turn: 1, scale: PROP_SCALE, division: null },
  // Trees and rocks round the edges.
  { piece: "trees_b_medium", x: -8.6, z: -6.3, turn: 0, scale: 1, division: null },
  { piece: "tree_b", x: -2.3, z: -6.3, turn: 0, scale: 1.4, division: null },
  { piece: "trees_b_medium", x: 7.4, z: -6.4, turn: 1, scale: 1, division: null },
  { piece: "trees_b_large", x: -0.6, z: 5.9, turn: 0, scale: 1, division: null },
  { piece: "tree_b", x: 5.4, z: 6.2, turn: 0, scale: 1.4, division: null },
  { piece: "hills_trees", x: -8.6, z: 5.9, turn: 0, scale: 1, division: null },
  { piece: "rock_c", x: 4.3, z: 4.2, turn: 0, scale: PROP_SCALE, division: null },
  // The lake's lilies and reeds.
  { piece: "lily_a", x: 1, z: -4.2, turn: 0, scale: 1.5, division: null, y: WATER_LEVEL },
  { piece: "lily_b", x: 3.4, z: -5, turn: 1, scale: 1.5, division: null, y: WATER_LEVEL },
  { piece: "lily_a", x: 4.8, z: -6, turn: 2, scale: 1.5, division: null, y: WATER_LEVEL },
  { piece: "reeds_a", x: -0.9, z: -3.5, turn: 0, scale: 1.5, division: null, y: WATER_LEVEL },
  { piece: "reeds_b", x: 5.2, z: -5.6, turn: 0, scale: 1.5, division: null, y: WATER_LEVEL },
  // The watermill at the lake's east shore; its wheel turns with the weather (`ambience.ts`).
  { piece: "watermill", x: 7.1, z: -4.4, turn: 3, scale: BUILDING_SCALE, division: null },
  // Each division's flag beside its building, in the division's hue.
  { piece: "flag", x: -6.9, z: -3.3, turn: 0, scale: FLAG_SCALE, division: "sources" },
  { piece: "flag", x: -2.9, z: -5.1, turn: 0, scale: FLAG_SCALE, division: "journal" },
  { piece: "flag", x: -2, z: -2.3, turn: 0, scale: FLAG_SCALE, division: "lake" },
  { piece: "flag", x: 6.5, z: -1.9, turn: 0, scale: FLAG_SCALE, division: "models" },
  { piece: "flag", x: 11.5, z: 1.7, turn: 0, scale: FLAG_SCALE, division: "reports" },
  { piece: "flag", x: 10.2, z: -6, turn: 0, scale: FLAG_SCALE, division: "people" },
];

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
  // The workshop's lumbermill, whose saw turns while a build runs (`works.ts`). An eighth of a
  // turn, because the saw sits under an eave: square to the board, the eave hides it from the
  // camera.
  { piece: "lumbermill", x: 10.2, z: -2.4, turn: 0.5, scale: 1.4, division: "models" },
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
  { piece: "mountain", x: 12, z: -6.2, turn: 2, scale: 1, division: null },
  { piece: "trees_small", x: 12.4, z: 5.6, turn: 0, scale: 1, division: null },
  { piece: "trees_large", x: 10, z: 6, turn: 1, scale: 1, division: null },
  { piece: "trees_small", x: 1.2, z: 6, turn: 0, scale: 1, division: null },
  { piece: "tree", x: 3.8, z: 5.4, turn: 0, scale: 1.4, division: null },
  { piece: "rock", x: -7, z: 5.4, turn: 0, scale: 2, division: null },
  { piece: "tree", x: -5.6, z: 3.8, turn: 0, scale: 1.4, division: null },
  { piece: "trees_medium", x: -10.6, z: 6, turn: 0, scale: 1, division: null },
  ...DRESSING,
];

/** The buildings a reader can press, and the division each opens. */
export const PLACES: readonly Place[] = [
  { id: "gate", division: "sources", x: -8, z: -1, reach: 2 },
  { id: "sign", division: "customers", x: -9.9, z: 1.3, reach: 0.8 },
  { id: "hall", division: "journal", x: -4, z: -4.2, reach: 1.6 },
  { id: "vault", division: "lake", x: 0, z: -2.2, reach: 1.6 },
  { id: "archive", division: "lake", x: 1.8, z: 2.5, reach: 1.2 },
  { id: "reading", division: "lake", x: 3.6, z: -2.1, reach: 1.2 },
  // Between the workshop and its lumbermill, so a press on either opens the models.
  { id: "workshop", division: "models", x: 9, z: -2.25, reach: 2.1 },
  { id: "press", division: "reports", x: 10.4, z: 2.3, reach: 1.6 },
  { id: "houses", division: "people", x: 10, z: -4.6, reach: 2.4 },
];

/** Where the vault's crates are stacked, the step its refused crates are set aside on, and the bell. */
export const VAULT_STACK: Point = { x: 1.1, z: -1 };
export const SET_ASIDE: Point = { x: -1.4, z: -1.6 };
export const WORKSHOP_PIECES: Point = { x: 7.4, z: 1.2 };
export const BELL: Point = { x: -2.5, z: -4.4 };
/** The copyist's lectern, beside the reading room; it faces the `lectern` spot its reader stands at. */
export const LECTERN: Point = { x: 4.95, z: -1.05 };
