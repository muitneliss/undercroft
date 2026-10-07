/**
 * What moves in the village without a run behind it: weather and machinery. Clouds drift over the
 * board and their shadows cross it, the windmill's sails and the watermill's wheel turn, the
 * division flags stir.
 *
 * None of it is a character, and none of it says anything about the customer's data: rule 2
 * governs what the cast does (`script.ts`), and a cloud claims nothing. It moves on the same
 * stepped clock as everything else, a fixed amount per frame and nothing between, and under
 * reduced motion it does not move at all.
 */

import { Group, Mesh, MeshBasicMaterial, type Object3D } from "three";

/** Where the clouds drift, west to east. */
const CLOUD_FROM = -22;
const CLOUD_TO = 22;
const CLOUD_DRIFT = 0.035;
/**
 * Each cloud: which model, where it starts along the drift, how far north, how high, how big,
 * and whether the reader sees it. Most are seen only by their shadows crossing the board: a cloud
 * between the camera and the village would hide the village. Two small ones float at the back.
 */
const CLOUDS: readonly (readonly [string, number, number, number, number, boolean])[] = [
  ["cloud_big", -14, -2, 9, 2, false],
  ["cloud_big", 4, 5, 9, 1.6, false],
  ["cloud_small", 13, -5, 9, 2.2, false],
  ["cloud_small", -9, -10.5, 3.2, 0.9, true],
  ["cloud_big", 7, -11, 3.6, 0.8, true],
];
/** A cloud the reader does not see: it writes no colour and no depth, and still casts a shadow. */
const SHADOW_ONLY = new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
SHADOW_ONLY.userData = { outlineParameters: { visible: false } };

/** A quarter of a turn of the sails every eight frames. */
const SAIL_TURN = Math.PI / 16;
const WHEEL_TURN = Math.PI / 20;
/** A flag's stir: a small swing, one position a frame. */
const FLAG_STIR = [0, 0.08, 0.14, 0.08, 0, -0.08, -0.14, -0.08];

function partsNamed(root: Object3D, word: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (node.name.includes(word)) {
      found.push(node);
    }
  });
  return found;
}

export class Ambience {
  readonly group = new Group();
  private readonly clouds: Object3D[] = [];
  private readonly sails: Object3D[];
  private readonly wheels: Object3D[];
  private readonly flags: Object3D[];
  private frame = 0;

  constructor(world: Object3D, piece: (name: string) => Object3D) {
    for (const [name, along, north, height, scale, seen] of CLOUDS) {
      const cloud = piece(name);
      cloud.position.set(along, height, north);
      cloud.scale.setScalar(scale);
      cloud.traverse((node) => {
        node.receiveShadow = false;
        if (!seen && node instanceof Mesh) {
          node.material = SHADOW_ONLY;
        }
      });
      this.clouds.push(cloud);
      this.group.add(cloud);
    }
    this.sails = partsNamed(world, "windmill_top_fan");
    this.wheels = partsNamed(world, "watermill_wheel");
    this.flags = partsNamed(world, "flag_");
  }

  /** One frame of weather and machinery. */
  step(): void {
    this.frame += 1;
    for (const cloud of this.clouds) {
      cloud.position.x += CLOUD_DRIFT;
      if (cloud.position.x > CLOUD_TO) {
        cloud.position.x = CLOUD_FROM;
      }
    }
    for (const sail of this.sails) {
      sail.rotation.z += SAIL_TURN;
    }
    for (const wheel of this.wheels) {
      wheel.rotation.x -= WHEEL_TURN;
    }
    for (const [at, flag] of this.flags.entries()) {
      flag.rotation.y = FLAG_STIR[(this.frame + at * 3) % FLAG_STIR.length] ?? 0;
    }
  }
}
