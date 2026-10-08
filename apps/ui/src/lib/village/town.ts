/**
 * The Journal's village as a world for the film (`film.ts`): the board and its buildings, the
 * cast at work, what the runs left behind, the machinery the runs drive, and the weather
 * (ADR 0116, `docs/design/village.md`).
 *
 * The board owns what does not move. The figures (`folk.ts`) own the cast; the props
 * (`props.ts`) are rebuilt from each scene; the works (`works.ts`) move only while a run drives
 * them; the ambience (`ambience.ts`) moves on its own.
 */

import { Box3, Group, type Object3D, Plane, type Raycaster, Vector3 } from "three";

import { Ambience } from "@/lib/village/ambience.ts";
import type { World } from "@/lib/village/film.ts";
import { Figure } from "@/lib/village/folk.ts";
import type { Kit } from "@/lib/village/kit.ts";
import { boardTiles, PLACEMENTS, PLACES } from "@/lib/village/layout.ts";
import { FIGURE_TARGET } from "@/lib/village/pointer.ts";
import { placeProps } from "@/lib/village/props.ts";
import { roadLines, sourceRoadLine } from "@/lib/village/roads.ts";
import type { VillageScene } from "@/lib/village/script.ts";
import { Works } from "@/lib/village/works.ts";

/**
 * The board, and the top of each building a reader can point at: the highest of what stands
 * within its reach, so a building's card clears its roof and its flag.
 */
function boardOf(kit: Kit): { root: Group; roofs: Map<string, Vector3> } {
  const root = new Group();
  const roofs = new Map(PLACES.map((place) => [place.id, new Vector3(place.x, 0, place.z)]));
  for (const tile of boardTiles()) {
    const ground = kit.piece(tile.water ? "hex_water" : "hex_grass");
    ground.position.set(tile.x, 0, tile.z);
    root.add(ground);
  }
  for (const line of roadLines()) {
    root.add(kit.road(line));
  }
  for (const spot of PLACEMENTS) {
    const made = kit.piece(spot.piece, spot.division);
    made.position.set(spot.x, spot.y ?? 0, spot.z);
    made.rotation.y = (spot.turn * Math.PI) / 2;
    made.scale.setScalar(spot.scale);
    root.add(made);
    const top = new Box3().setFromObject(made).max.y;
    for (const place of PLACES) {
      const roof = roofs.get(place.id);
      if (roof !== undefined && Math.hypot(place.x - spot.x, place.z - spot.z) <= place.reach) {
        roof.y = Math.max(roof.y, top);
      }
    }
  }
  return { root, roofs };
}

export class Town implements World<VillageScene> {
  readonly root: Group;
  readonly extras: readonly Object3D[];
  private readonly kit: Kit;
  private readonly figures = new Map<string, Figure>();
  private readonly cast = new Group();
  private readonly props = new Group();
  private readonly works: Works;
  private readonly ambience: Ambience;
  private readonly roads = new Map<number, Object3D>();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private readonly roofs: ReadonlyMap<string, Vector3>;

  constructor(kit: Kit) {
    this.kit = kit;
    const board = boardOf(kit);
    this.root = board.root;
    this.roofs = board.roofs;
    this.works = new Works(this.root, kit.painter);
    this.root.add(this.works.group);
    this.ambience = new Ambience(this.root, (name) => kit.piece(name));
    this.extras = [this.cast, this.props, this.ambience.group];
  }

  show(next: VillageScene, still: boolean): void {
    const keep = new Set(next.actors.map((actor) => actor.key));
    for (const [key, figure] of this.figures) {
      if (!keep.has(key)) {
        figure.dispose();
        this.figures.delete(key);
      }
    }
    for (const actor of next.actors) {
      let figure = this.figures.get(actor.key);
      if (figure === undefined) {
        figure = new Figure(actor, this.kit.cast, {
          crate: (): Object3D => this.kit.piece("crate"),
          slip: this.kit.slip,
        });
        this.figures.set(actor.key, figure);
        this.cast.add(figure.holder);
      }
      figure.cast(actor, still);
    }
    this.works.set(next, still);
    placeProps(
      this.props,
      {
        piece: (name): Object3D => this.kit.piece(name),
        slip: this.kit.slip,
        sourceRoad: (slot): Object3D => {
          const known = this.roads.get(slot) ?? this.kit.road(sourceRoadLine(slot));
          this.roads.set(slot, known);
          return known;
        },
      },
      next,
    );
  }

  step(): void {
    for (const figure of this.figures.values()) {
      figure.step();
    }
    this.works.step();
    this.ambience.step();
  }

  /** A figure first, then the building whose ground the pointer is over. */
  under(ray: Raycaster): string | null {
    const holders = [...this.figures.values()].map((figure) => figure.holder);
    for (const hit of ray.intersectObjects(holders, true)) {
      if (hit.object.name.startsWith(FIGURE_TARGET)) {
        return `actor|${hit.object.name.slice(FIGURE_TARGET.length)}`;
      }
    }
    const spot = ray.ray.intersectPlane(this.ground, new Vector3());
    if (spot === null) {
      return null;
    }
    const place = PLACES.find((p) => Math.hypot(p.x - spot.x, p.z - spot.z) <= p.reach);
    return place === undefined ? null : `place|${place.id}`;
  }

  /** Above a figure's head, or above a building's roof. */
  anchor(target: string): Vector3 | null {
    const [kind = "", id = ""] = target.split("|");
    if (kind === "actor") {
      return this.figures.get(id)?.head() ?? null;
    }
    return kind === "place" ? (this.roofs.get(id)?.clone() ?? null) : null;
  }

  dispose(): void {
    for (const figure of this.figures.values()) {
      figure.dispose();
    }
  }
}
