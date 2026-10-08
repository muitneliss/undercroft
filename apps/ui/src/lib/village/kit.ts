/**
 * Everything a village is built from, loaded and painted once (ADR 0116): the set's pieces, the
 * cast and its clips, the errata slip, and roads drawn along any line.
 *
 * A kit belongs to one film, which loads its own and disposes of it with itself. The models are
 * fetched once by the browser and cached; what a kit owns is the painted copies and the
 * materials, which are cheap to make and must not be shared between films that are disposed at
 * different times.
 */

import { type AnimationClip, Group, Mesh, type Object3D } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { type GLTF, GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import atlasFacts from "@/assets/village/atlas.json" with { type: "json" };
import clipsUrl from "@/assets/village/clips.glb?url";
import folkUrl from "@/assets/village/folk.glb?url";
import setUrl from "@/assets/village/set.glb?url";
import type { DivisionId } from "@/lib/divisions.ts";
import type { Point } from "@/lib/village/layout.ts";
import { Painter } from "@/lib/village/paint.ts";
import type { AtlasFacts, Tokens } from "@/lib/village/palette.ts";
import { roadOf, slipMaker, slipTexture } from "@/lib/village/props.ts";

export interface Cast {
  /** The characters, by KayKit name, each a rigged group to clone. */
  readonly models: ReadonlyMap<string, Object3D>;
  readonly clips: readonly AnimationClip[];
}

export interface Kit {
  readonly painter: Painter;
  readonly cast: Cast;
  /** A piece from the set, repainted; its roof in a division's hue if it stands for one. */
  readonly piece: (name: string, roof?: DivisionId | null) => Object3D;
  /** An errata slip on its post. */
  readonly slip: () => Object3D;
  /** A road along a line, owned by the kit and disposed with it. */
  readonly road: (line: readonly Point[]) => Object3D;
  readonly dispose: () => void;
}

const ATLAS: { readonly set: AtlasFacts; readonly folk: Readonly<Record<string, AtlasFacts>> } =
  atlasFacts;

/**
 * The rigs merged into one file share one set of bone names, and the loader makes them unique
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

export async function loadKit(tokens: Tokens): Promise<Kit> {
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
  const models = childrenByName(folk);
  for (const [name, model] of models) {
    painter.paintFigure(model, ATLAS.folk[name] ?? { top: [], bottom: [] });
  }
  const texture = slipTexture(painter);
  const owned: Object3D[] = [];
  return {
    painter,
    cast: { models, clips: clips.animations },
    piece: (name, roof = null): Object3D => {
      const source = pieces.get(name);
      const made = source === undefined ? new Group() : source.clone();
      painter.paint(made, ATLAS.set, roof);
      return made;
    },
    slip: slipMaker(painter, texture),
    road: (line): Object3D => {
      const made = roadOf(painter, line);
      owned.push(made);
      return made;
    },
    dispose: (): void => {
      for (const object of owned) {
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
