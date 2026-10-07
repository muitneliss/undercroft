/**
 * A node-and-edge drawing as a world for the film (`film.ts`): a run's map or the models'
 * lineage, built from a `VillageGraph` (`graph.ts`). Every node is one building, every edge one
 * road, and every flowing edge carries traffic (ADR 0116).
 *
 * The world is rebuilt only when what it draws changes: the nodes, where they stand, how each is
 * marked, the edges and which of them flow. A run's map is re-read every second while the run
 * works, and a re-read that changed none of that leaves the buildings standing and the carriers
 * walking.
 */

import { Group, type Mesh, type Object3D, type Raycaster } from "three";

import { Carrier } from "@/lib/village/carriers.ts";
import type { World } from "@/lib/village/film.ts";
import type { VillageGraph } from "@/lib/village/graph.ts";
import { buildingFor, groundUnder, roadsFor } from "@/lib/village/graphParts.ts";
import type { Kit } from "@/lib/village/kit.ts";

const NODE_TARGET = "node:";

/** What the world draws, as one string: when it changes, the world is rebuilt. */
function shapeOf(graph: VillageGraph): string {
  return JSON.stringify([
    graph.nodes.map((node) => [node.id, node.kind, node.x, node.z, node.state, node.slip]),
    graph.edges.map((edge) => [edge.id, edge.state, edge.flowing, edge.broken]),
  ]);
}

export class GraphWorld implements World<VillageGraph> {
  readonly root = new Group();
  readonly extras: readonly Object3D[];
  private readonly kit: Kit;
  private readonly traffic = new Group();
  private readonly buildings = new Group();
  private readonly made: Mesh[] = [];
  private carriers: Carrier[] = [];
  private shape = "";
  private ground: Object3D | null = null;

  constructor(kit: Kit) {
    this.kit = kit;
    this.extras = [this.traffic];
  }

  show(graph: VillageGraph, still: boolean): void {
    const shape = shapeOf(graph);
    if (shape !== this.shape) {
      this.shape = shape;
      this.build(graph);
    }
    for (const carrier of this.carriers) {
      if (still) {
        carrier.settle();
      }
    }
  }

  private build(graph: VillageGraph): void {
    this.clear();
    if (graph.nodes.length === 0) {
      return;
    }
    const ground = groundUnder(this.kit, graph.nodes);
    if (ground !== null) {
      ground.name = "ground";
      this.ground = ground;
      this.made.push(ground);
      this.root.add(ground);
    }
    for (const road of roadsFor(this.kit, graph.edges)) {
      this.made.push(road);
      this.root.add(road);
    }
    for (const node of graph.nodes) {
      this.buildings.add(buildingFor(this.kit, node));
    }
    this.root.add(this.buildings);
    // Several carriers on one road would walk in step, so each starts a different way along.
    this.carriers = graph.edges
      .filter((edge) => edge.flowing)
      .map((edge, at) => new Carrier(this.kit, edge.path, graph.carrier, (at * 0.37) % 1));
    for (const carrier of this.carriers) {
      this.traffic.add(carrier.holder);
    }
  }

  private clear(): void {
    for (const carrier of this.carriers) {
      carrier.dispose();
    }
    this.carriers = [];
    for (const mesh of this.made) {
      mesh.geometry.dispose();
    }
    this.made.length = 0;
    this.buildings.clear();
    this.root.clear();
    this.ground = null;
  }

  step(): void {
    for (const carrier of this.carriers) {
      carrier.step();
    }
  }

  /** The building under the pointer, as `node|id`; the bare board, as `ground|board`. */
  under(ray: Raycaster): string | null {
    for (const hit of ray.intersectObjects(this.buildings.children, true)) {
      let node: Object3D | null = hit.object;
      while (node !== null && !node.name.startsWith(NODE_TARGET)) {
        node = node.parent;
      }
      if (node !== null) {
        return `node|${node.name.slice(NODE_TARGET.length)}`;
      }
    }
    return this.ground !== null && ray.intersectObject(this.ground).length > 0
      ? "ground|board"
      : null;
  }

  dispose(): void {
    this.clear();
  }
}
