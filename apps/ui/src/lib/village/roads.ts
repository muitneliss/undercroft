/**
 * The ways through the village: the named spots characters stand at and walk between, the roads
 * joining them, and the shortest way from anywhere to any spot (`layout.ts` has where things
 * stand; this has how one gets there).
 *
 * Source roads come in at the west edge, one per source slot, and meet at the gatehouse; the
 * main road runs east from the gate to the printing house; the lake-API road comes up from the
 * south edge to the vault's road.
 */

import type { Point } from "@/lib/village/layout.ts";

/** How many source roads the west edge has room for; a sixth source shares the last. */
export const ROAD_SLOTS = 5;

/** Each road's line across the west fields, centre first so one source runs straight in. */
const ROAD_Z: readonly number[] = [0, -2.3, 2.3, -4.6, 4.6];

/**
 * The named spots characters stand at and walk between. A road's three spots are generated per
 * slot: where it leaves the board, where its barrier stands, and where it bends to the gate.
 */
const FIXED_NODES: Record<string, Point> = {
  gateWest: { x: -9.4, z: 0 },
  gateEast: { x: -6.8, z: 0 },
  gateBench: { x: -6.3, z: 1.1 },
  hallRoad: { x: -4, z: 0 },
  hall: { x: -4, z: -2.6 },
  vaultRoad: { x: 0, z: 0 },
  vault: { x: 0, z: -0.8 },
  keeperRest: { x: -1.1, z: -0.9 },
  archiveRoad: { x: 1.8, z: 0 },
  archive: { x: 1.8, z: 1.1 },
  /** Out from behind the archive's tower, where the camera sees the scribe sort its documents. */
  sorting: { x: 3, z: 0.75 },
  scribeRest: { x: 2.8, z: 1.3 },
  readingRoad: { x: 3.6, z: 0 },
  reading: { x: 3.6, z: -0.8 },
  lectern: { x: 4.5, z: -0.7 },
  copyistRest: { x: 2.6, z: -0.8 },
  workshopRoad: { x: 7.8, z: 0 },
  workshop: { x: 7.8, z: -0.8 },
  inspect: { x: 8.9, z: -0.7 },
  artisanRest: { x: 6.8, z: -0.9 },
  inspectorRest: { x: 9.75, z: 0.8 },
  pressRoad: { x: 10.4, z: 0 },
  press: { x: 10.4, z: 0.9 },
  mill: { x: 9.75, z: -1.3 },
  apiEdge: { x: -2.6, z: 7.6 },
  apiShore: { x: -2.6, z: 1.2 },
};

function roadNodes(slot: number): Record<string, Point> {
  const z = ROAD_Z[slot] ?? 0;
  return {
    [`road${slot}Edge`]: { x: -13.2, z },
    [`road${slot}Bar`]: { x: -11.9, z },
    [`road${slot}Bend`]: { x: -10.8, z },
    [`courier${slot}Rest`]: { x: -6.2, z: -0.9 - slot * 0.55 },
  };
}

export const NODES: Readonly<Record<string, Point>> = Object.assign(
  {},
  FIXED_NODES,
  ...Array.from({ length: ROAD_SLOTS }, (_, slot) => roadNodes(slot)),
);

const MAIN_ROAD = [
  "gateWest",
  "gateEast",
  "hallRoad",
  "vaultRoad",
  "archiveRoad",
  "readingRoad",
  "workshopRoad",
  "pressRoad",
] as const;

const BRANCHES: readonly (readonly [string, string])[] = [
  ["hallRoad", "hall"],
  ["vaultRoad", "vault"],
  ["vault", "keeperRest"],
  ["archiveRoad", "archive"],
  ["archive", "scribeRest"],
  ["archiveRoad", "sorting"],
  ["readingRoad", "reading"],
  ["readingRoad", "lectern"],
  ["readingRoad", "copyistRest"],
  ["workshopRoad", "workshop"],
  ["workshop", "inspect"],
  ["workshopRoad", "artisanRest"],
  ["pressRoad", "inspectorRest"],
  ["workshop", "mill"],
  ["pressRoad", "press"],
  ["gateEast", "gateBench"],
  ["apiEdge", "apiShore"],
  ["apiShore", "vaultRoad"],
];

function edges(): readonly (readonly [string, string])[] {
  const list: (readonly [string, string])[] = [];
  for (let at = 1; at < MAIN_ROAD.length; at += 1) {
    list.push([MAIN_ROAD[at - 1] ?? "", MAIN_ROAD[at] ?? ""]);
  }
  for (let slot = 0; slot < ROAD_SLOTS; slot += 1) {
    list.push([`road${slot}Edge`, `road${slot}Bar`]);
    list.push([`road${slot}Bar`, `road${slot}Bend`]);
    list.push([`road${slot}Bend`, "gateWest"]);
    list.push(["gateEast", `courier${slot}Rest`]);
  }
  return [...list, ...BRANCHES];
}

const EDGES = edges();

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function nearestNode(at: Point): string {
  let best = "gateEast";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [name, node] of Object.entries(NODES)) {
    const away = distance(at, node);
    if (away < bestDistance) {
      best = name;
      bestDistance = away;
    }
  }
  return best;
}

/** Each spot's neighbours along the roads, and how far each is. */
function neighbours(): ReadonlyMap<string, readonly (readonly [string, number])[]> {
  const map = new Map<string, [string, number][]>();
  for (const [a, b] of EDGES) {
    const here = NODES[a];
    const there = NODES[b];
    if (here !== undefined && there !== undefined) {
      const away = distance(here, there);
      map.set(a, [...(map.get(a) ?? []), [b, away]]);
      map.set(b, [...(map.get(b) ?? []), [a, away]]);
    }
  }
  return map;
}

const NEIGHBOURS = neighbours();

/** The open spot nearest the start so far: the next one a shortest-path search settles. */
function cheapest(open: ReadonlySet<string>, best: ReadonlyMap<string, number>): string {
  let found = "";
  let lowest = Number.POSITIVE_INFINITY;
  for (const name of open) {
    const cost = best.get(name) ?? Number.POSITIVE_INFINITY;
    if (cost < lowest) {
      found = name;
      lowest = cost;
    }
  }
  return found;
}

/** Every spot's step back toward `start` on its shortest way there. */
function searchFrom(start: string, to: string): ReadonlyMap<string, string> {
  const best = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const open = new Set<string>([start]);
  while (open.size > 0) {
    const current = cheapest(open, best);
    open.delete(current);
    if (current === to) {
      break;
    }
    const cost = best.get(current) ?? 0;
    for (const [next, away] of NEIGHBOURS.get(current) ?? []) {
      if (cost + away < (best.get(next) ?? Number.POSITIVE_INFINITY)) {
        best.set(next, cost + away);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  return previous;
}

/**
 * The way from wherever a character stands to a named spot: first to the nearest spot on the
 * map, then along the roads by the shortest way. The points are the corners to walk through, the
 * destination last.
 */
export function route(from: Point, to: string): readonly Point[] {
  const target = NODES[to];
  if (target === undefined) {
    return [];
  }
  const start = nearestNode(from);
  const previous = searchFrom(start, to);
  const names: string[] = [to];
  while (names[0] !== start) {
    const before = previous.get(names[0] ?? "");
    if (before === undefined) {
      return [target];
    }
    names.unshift(before);
  }
  return names.map((name) => NODES[name] ?? target);
}

function nodeAt(name: string): Point {
  return NODES[name] ?? { x: 0, z: 0 };
}

/**
 * Spots a figure stands at beside a building rather than at its door: walked to, never paved. A
 * resting spot (`…Rest`) is one too.
 */
const UNPAVED: ReadonlySet<string> = new Set(["inspect", "lectern", "mill", "sorting"]);

/** The roads every village has: the main road, its branches, and the lake-API road. */
export function roadLines(): readonly (readonly Point[])[] {
  return [
    [...MAIN_ROAD.map(nodeAt), { x: 11.6, z: 0 }],
    ...BRANCHES.filter(([, to]) => !(to.endsWith("Rest") || UNPAVED.has(to))).map(([from, to]) => [
      nodeAt(from),
      nodeAt(to),
    ]),
  ];
}

/** One source's road, from the west edge to the gate: drawn only for a source that has one. */
export function sourceRoadLine(slot: number): readonly Point[] {
  return [nodeAt(`road${slot}Edge`), nodeAt(`road${slot}Bend`), nodeAt("gateWest")];
}

/** Where a source road's barrier stands, across it, when the grant has lapsed. */
export function barrierAt(slot: number): Point {
  return NODES[`road${slot}Bar`] ?? { x: -11.9, z: 0 };
}
