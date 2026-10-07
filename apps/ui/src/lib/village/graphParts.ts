/**
 * What a graph's village is built from (`graphWorld.ts`): the board under it, a building per
 * node, and the roads, merged so a lineage of hundreds of edges is a handful of meshes.
 *
 * WHICH BUILDING. A node's kind decides it, and its roof wears its division's hue, which is what
 * a hue is for (the Wheel Rule): a model is a house of the Models division, a raw lake table a
 * storehouse of the Raw lake's, a missing dependency a ruin. A run's stages are the town's own
 * buildings: an entity read is a market stall of Sources, the run's verdict the town hall, a
 * build the workshop, a lake-API landing the vault. Models differ from one another by a stable
 * pick of house from their name, so a large lineage reads as a town and not as one house copied.
 *
 * HOW A ROAD IS DRAWN. As the board drew its wire: a plain road for a declared edge, an inked one
 * on the selected node's upstream chain, dashed on its downstream chain, and faint where the
 * selection dims it; a road from a dependency that no longer exists is broken into pieces. An
 * arrowhead of the road's own colour stands at the target end.
 */

import {
  BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  Group,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import type { GraphEdge, GraphNode, GraphNodeKind, GraphState } from "@/lib/village/graph.ts";
import type { Kit } from "@/lib/village/kit.ts";
import type { Point } from "@/lib/village/layout.ts";
import { mix } from "@/lib/village/palette.ts";
import { dashes, ribbon } from "@/lib/village/ribbon.ts";

const SQRT3 = Math.sqrt(3);
/** Ground beyond the outermost buildings, in world units. */
const MARGIN = 3;
const BUILDING_SCALE = 1.35;
const ROAD_WIDTH = 0.42;
const ROAD_LEVEL = 0.07;
/** The arrowhead's size, and how far before the target building's middle it stands. */
const ARROW_SIZE = 0.26;
const ARROW_BACK = 1.1;

/** How wide each state's road is, and how far above the rest: the chain is drawn over all. */
const WIDTH: Readonly<Record<GraphState, number>> = {
  selected: 1.35,
  chain: 1.35,
  downstream: 1.1,
  plain: 1,
  dim: 0.6,
};
const LIFT: Readonly<Record<GraphState, number>> = {
  selected: 0.03,
  chain: 0.03,
  downstream: 0.02,
  plain: 0.01,
  dim: 0,
};

/** The houses a model may be, picked by its name so the pick is stable across loads. */
const HOUSES = ["house", "reading_room", "tavern", "barracks", "lumbermill", "archive"] as const;
const STOREHOUSES = ["reading_room", "tower", "house"] as const;

const BUILDING: Readonly<Record<GraphNodeKind, readonly string[]>> = {
  entity: ["press"],
  outcome: ["hall"],
  models: ["workshop"],
  lake: ["vault"],
  model: HOUSES,
  raw: STOREHOUSES,
  missing: ["ruin"],
};

function pick(options: readonly string[], name: string): string {
  let hash = 0;
  for (const letter of name) {
    hash = (hash * 31 + (letter.codePointAt(0) ?? 0)) % 9973;
  }
  return options[hash % options.length] ?? options[0] ?? "house";
}

/**
 * A geometry's positions and normals as plain floats. KayKit's are stored quantised, as
 * normalised integers within the model's own small bounds; moved out to a tile's place on a large
 * board they would be clamped back into those bounds.
 */
function unquantised(geometry: BufferGeometry): BufferGeometry {
  for (const name of ["position", "normal"]) {
    const attribute = geometry.getAttribute(name);
    if (attribute !== undefined && !(attribute.array instanceof Float32Array)) {
      const values = new Float32Array(attribute.count * attribute.itemSize);
      for (let at = 0; at < attribute.count; at += 1) {
        for (let axis = 0; axis < attribute.itemSize; axis += 1) {
          values[at * attribute.itemSize + axis] = attribute.getComponent(at, axis);
        }
      }
      geometry.setAttribute(name, new BufferAttribute(values, attribute.itemSize));
    }
  }
  return geometry;
}

/** Every mesh's geometry under an object, placed in the world, ready to merge. */
function placedGeometries(object: Object3D): BufferGeometry[] {
  object.updateMatrixWorld(true);
  const geometries: BufferGeometry[] = [];
  object.traverse((node) => {
    if (node instanceof Mesh) {
      geometries.push(unquantised(node.geometry.clone()).applyMatrix4(node.matrixWorld));
    }
  });
  return geometries;
}

/** One mesh of many geometries, sharing one material. */
function merged(
  geometries: BufferGeometry[],
  material: MeshStandardMaterial | Mesh["material"],
): Mesh | null {
  if (geometries.length === 0) {
    return null;
  }
  const geometry = mergeGeometries(geometries, false);
  for (const part of geometries) {
    part.dispose();
  }
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The material a piece is painted with: its first mesh's. */
function materialOf(piece: Object3D): Mesh["material"] | null {
  let found: Mesh["material"] | null = null;
  piece.traverse((node) => {
    if (found === null && node instanceof Mesh) {
      found = node.material;
    }
  });
  return found;
}

/** The board under every node: hex tiles over the graph's extent, merged into one mesh. */
export function groundUnder(kit: Kit, nodes: readonly GraphNode[]): Mesh | null {
  const xs = nodes.map((node) => node.x);
  const zs = nodes.map((node) => node.z);
  const left = Math.min(...xs) - MARGIN;
  const right = Math.max(...xs) + MARGIN;
  const near = Math.min(...zs) - MARGIN;
  const far = Math.max(...zs) + MARGIN;
  const tile = kit.piece("hex_grass");
  const parts: BufferGeometry[] = [];
  const material = materialOf(tile);
  for (let row = Math.floor(near / SQRT3); row <= Math.ceil(far / SQRT3); row += 1) {
    for (let column = Math.floor(left / 2) - 1; column <= Math.ceil(right / 2); column += 1) {
      tile.position.set(column * 2 + (row % 2 === 0 ? 0 : 1), 0, row * SQRT3);
      for (const geometry of placedGeometries(tile)) {
        parts.push(geometry);
      }
    }
  }
  return material === null ? null : merged(parts, material);
}

/** A node's building, named for the node so the pointer can say which it is. */
export function buildingFor(kit: Kit, node: GraphNode): Object3D {
  const holder = new Group();
  holder.name = `node:${node.id}`;
  const building = kit.piece(pick(BUILDING[node.kind], node.name), node.division);
  building.scale.setScalar(BUILDING_SCALE * (node.state === "selected" ? 1.15 : 1));
  holder.add(building);
  if (node.slip) {
    const slip = kit.slip();
    slip.position.set(0.9, 0, 0.7);
    holder.add(slip);
  }
  if (node.state === "selected") {
    const flag = kit.piece("flag", node.division);
    flag.scale.setScalar(3);
    flag.position.set(-0.9, 0, 0.6);
    holder.add(flag);
  }
  if (node.state === "dim") {
    holder.traverse((part) => {
      if (part instanceof Mesh && !Array.isArray(part.material)) {
        part.material = kit.painter.faded(part.material);
        part.castShadow = false;
      }
    });
  }
  holder.position.set(node.x, 0, node.z);
  return holder;
}

/** The arrowhead at a road's target end, pointing along its last stretch. */
function arrowAt(line: readonly Point[]): BufferGeometry | null {
  const end = line.at(-1);
  const before = line.at(-2);
  if (end === undefined || before === undefined) {
    return null;
  }
  const length = Math.hypot(end.x - before.x, end.z - before.z) || 1;
  const dx = (end.x - before.x) / length;
  const dz = (end.z - before.z) / length;
  const arrow = new ConeGeometry(ARROW_SIZE, ARROW_SIZE * 1.6, 3);
  arrow.rotateZ(-Math.PI / 2);
  arrow.rotateY(-Math.atan2(dz, dx));
  arrow.translate(end.x - dx * ARROW_BACK, ROAD_LEVEL + 0.08, end.z - dz * ARROW_BACK);
  return arrow;
}

/** The colour each state's road is laid in. */
function inkOf(kit: Kit, state: GraphState): string {
  const { tokens } = kit.painter;
  switch (state) {
    case "chain":
    case "selected":
      return tokens.ink2;
    case "downstream":
      return tokens.ink3;
    case "dim":
      return mix(tokens.page, tokens.bone, 0.5);
    case "plain":
      return tokens.page;
    default: {
      const exhaustive: never = state;
      throw new Error(`unhandled state ${String(exhaustive)}`);
    }
  }
}

/** Every road, merged by how it is drawn: one mesh for each state's roads and arrowheads. */
export function roadsFor(kit: Kit, edges: readonly GraphEdge[]): Mesh[] {
  const byState = new Map<GraphState, BufferGeometry[]>();
  for (const edge of edges) {
    const parts = byState.get(edge.state) ?? [];
    // A road from a dependency that is gone is broken into pieces; the board dashed its wire.
    const lines = edge.state === "downstream" || edge.broken ? dashes(edge.path) : [edge.path];
    for (const line of lines) {
      parts.push(ribbon(line, ROAD_WIDTH * WIDTH[edge.state], ROAD_LEVEL + LIFT[edge.state]));
    }
    const arrow = arrowAt(edge.path);
    if (arrow !== null) {
      parts.push(arrow);
    }
    byState.set(edge.state, parts);
  }
  const meshes: Mesh[] = [];
  for (const [state, parts] of byState) {
    const prepared = parts.map((part) => (part.index === null ? part : part.toNonIndexed()));
    for (const part of prepared) {
      part.deleteAttribute("uv");
    }
    const mesh = merged(prepared, kit.painter.flat(inkOf(kit, state), false));
    if (mesh !== null) {
      meshes.push(mesh);
    }
  }
  return meshes;
}
