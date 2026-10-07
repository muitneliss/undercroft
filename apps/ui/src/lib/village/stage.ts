/**
 * The village's set: the board, its roads and buildings, painted in the book's tokens, plus the
 * models and clips the cast is made from (ADR 0115).
 *
 * The stage owns what does not move. The runtime owns the clock, and `folk.ts` owns the cast.
 */

import { type AnimationClip, Group, Mesh, type Object3D } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import atlasFacts from "@/assets/village/atlas.json" with { type: "json" };
import clipsUrl from "@/assets/village/clips.glb?url";
import folkUrl from "@/assets/village/folk.glb?url";
import setUrl from "@/assets/village/set.glb?url";
import { boardTiles, PLACEMENTS } from "@/lib/village/layout.ts";
import { Painter } from "@/lib/village/paint.ts";
import type { AtlasFacts, Tokens } from "@/lib/village/palette.ts";
import { makeBell, roadOf, slipMaker, slipTexture } from "@/lib/village/props.ts";
import { roadLines, sourceRoadLine } from "@/lib/village/roads.ts";

export interface Cast {
  /** The five models, by KayKit name, each a rigged group to clone. */
  readonly models: ReadonlyMap<string, Object3D>;
  readonly clips: readonly AnimationClip[];
}

export interface Stage {
  readonly root: Group;
  readonly cast: Cast;
  /** A piece from the set, repainted, ready to place: a crate, a handcart, a fence. */
  readonly piece: (name: string) => Object3D;
  /** An errata slip on its post. */
  readonly slip: () => Object3D;
  /** A source's road by slot, built once and given back each time. */
  readonly sourceRoad: (slot: number) => Object3D;
  /** The bell, which the runtime swings. */
  readonly bell: Object3D;
  readonly dispose: () => void;
}

const ATLAS: { readonly set: AtlasFacts; readonly folk: Readonly<Record<string, AtlasFacts>> } =
  atlasFacts;

/**
 * Five rigs merged into one file share one set of bone names, and the loader makes them unique
 * by suffix (`hips_2`); so do the clips' rigs. A clip addresses a bone by name, so each rig gets
 * its own names back, and each track the name of the bone it moves.
 */
const DUPLICATE_SUFFIX = /_\d+$/u;

function unsuffix(gltf: GLTF): void {
  for (const model of gltf.scene.children) {
    model.traverse((node) => {
      node.name = node.name.replace(DUPLICATE_SUFFIX, "");
    });
  }
  for (const clip of gltf.animations) {
    for (const track of clip.tracks) {
      const dot = track.name.indexOf(".");
      track.name = track.name.slice(0, dot).replace(DUPLICATE_SUFFIX, "") + track.name.slice(dot);
    }
  }
}

function childrenByName(gltf: GLTF): Map<string, Object3D> {
  return new Map(gltf.scene.children.map((child) => [child.name, child]));
}

/** A piece from the set, cloned and repainted; under a roof's division if it stands for one. */
function pieceOf(
  painter: Painter,
  pieces: ReadonlyMap<string, Object3D>,
  name: string,
  roof: Parameters<Painter["paint"]>[2] = null,
): Object3D {
  const source = pieces.get(name);
  const made = source === undefined ? new Group() : source.clone();
  painter.paint(made, ATLAS.set, roof);
  return made;
}

function boardOf(painter: Painter, pieces: ReadonlyMap<string, Object3D>): Group {
  const root = new Group();
  for (const tile of boardTiles()) {
    const ground = pieceOf(painter, pieces, tile.water ? "hex_water" : "hex_grass");
    ground.position.set(tile.x, 0, tile.z);
    root.add(ground);
  }
  for (const line of roadLines()) {
    root.add(roadOf(painter, line));
  }
  for (const spot of PLACEMENTS) {
    const made = pieceOf(painter, pieces, spot.piece, spot.division);
    made.position.set(spot.x, spot.y ?? 0, spot.z);
    made.rotation.y = (spot.turn * Math.PI) / 2;
    made.scale.setScalar(spot.scale);
    root.add(made);
  }
  return root;
}

export async function loadStage(tokens: Tokens): Promise<Stage> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const [set, folk, clips] = await Promise.all([
    loader.loadAsync(setUrl),
    loader.loadAsync(folkUrl),
    loader.loadAsync(clipsUrl),
  ]);
  unsuffix(folk);
  unsuffix(clips);
  const painter = new Painter(tokens);
  const pieces = childrenByName(set);
  const root = boardOf(painter, pieces);
  const bell = makeBell(painter);
  root.add(bell);
  const models = childrenByName(folk);
  for (const [name, model] of models) {
    painter.paintFigure(model, ATLAS.folk[name] ?? { top: [], bottom: [] });
  }
  const texture = slipTexture(painter);
  const roads = new Map<number, Object3D>();

  return {
    root,
    cast: { models, clips: clips.animations },
    piece: (name): Object3D => pieceOf(painter, pieces, name),
    slip: slipMaker(painter, texture),
    sourceRoad: (slot): Object3D => {
      const known = roads.get(slot) ?? roadOf(painter, sourceRoadLine(slot));
      roads.set(slot, known);
      return known;
    },
    bell,
    dispose: (): void => {
      for (const object of [root, ...roads.values()]) {
        object.traverse((child) => {
          if (child instanceof Mesh) {
            child.geometry.dispose();
          }
        });
      }
      texture.dispose();
      painter.dispose();
    },
  };
}
