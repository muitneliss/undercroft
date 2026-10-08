/**
 * The machinery a run drives: the gatehouse's doors, the bell by the town hall, the copyist's
 * lectern and the lumbermill's saw (`docs/design/village.md`).
 *
 * WHY THIS IS NOT THE AMBIENCE. The windmill's sails and the clouds (`ambience.ts`) move on their
 * own because they claim nothing about the data. Everything here does claim something, and so it
 * moves only with a run behind it, rule 2 applied to machinery: the doors stand open while a
 * courier is out fetching, the page turns while the copyist copies, the saw turns while the
 * artisan builds, and the bell swings when a scheduled run has just opened. A saw that turned
 * with nothing building would be a wrong picture nobody could see.
 *
 * The scene (`script.ts`) stays the only state: `set` reads what to move from the actors' doings
 * and the bell, and keeps no other record of the runs. Each part moves on the film's frames, one
 * stepped position a frame and nothing between. Under reduced motion the doors are put straight
 * where they end up, and the rest holds still: nothing loops.
 */

import { Group, type Object3D } from "three";

import { LECTERN } from "@/lib/village/layout.ts";
import type { Painter } from "@/lib/village/paint.ts";
import { makeBell, makeLectern } from "@/lib/village/props.ts";
import { NODES } from "@/lib/village/roads.ts";
import type { Doing, Role, VillageScene } from "@/lib/village/script.ts";

/** How far open a gate door stands, one position a frame: three frames to open, three to close. */
const DOOR_SWING = [0, 0.4, 0.8, 1.15];
/** The page's turn over the spine, one position a frame, then a rest while the next is read. */
const LEAF_TURN = [0, 0.45, 0.9, 1.35, 1.8, 2.25, 2.7, 3.05];
const LEAF_REST = 12;
/** The saw's turn each frame: not a whole number of its teeth, or a turning saw looks still. */
const SAW_TURN = 0.7;
/** The bell's swing, one position a frame: two full swings when a scheduled run opens. */
const BELL_SWING = [0.35, 0, -0.35, 0, 0.35, 0, -0.35, 0];

/** Every part of the board whose name contains `word`; KayKit names a piece's moving parts. */
function partsNamed(root: Object3D, word: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (node.name.includes(word)) {
      found.push(node);
    }
  });
  return found;
}

function busy(scene: VillageScene, role: Role, doing: Doing): boolean {
  return scene.actors.some((actor) => actor.role === role && actor.doing === doing);
}

export class Works {
  /** What the works add to the board: the bell and the lectern. */
  readonly group = new Group();
  /**
   * Each gate door and the way it swings. The doors hinge at the gatehouse's posts; the left one
   * swings to its local +Z by turning one way and the right one by turning the other, and local
   * +Z is east, into the village, as the gate is placed.
   */
  private readonly doors: readonly (readonly [Object3D, 1 | -1])[];
  private readonly saws: readonly Object3D[];
  private readonly bell: Object3D | undefined;
  private readonly leaf: Object3D | undefined;
  private open = false;
  private turning = false;
  private sawing = false;
  private doorFrame = 0;
  private leafFrame = 0;
  private bellFrame = 0;

  /** `board` is where the KayKit pieces stand: the gate and the lumbermill are found in it. */
  constructor(board: Object3D, painter: Painter) {
    this.doors = [
      ...partsNamed(board, "gate_door_left").map((door) => [door, 1] as const),
      ...partsNamed(board, "gate_door_right").map((door) => [door, -1] as const),
    ];
    this.saws = partsNamed(board, "lumbermill_saw");
    const bell = makeBell(painter);
    const lectern = makeLectern(painter);
    const reader = NODES.lectern ?? LECTERN;
    lectern.position.set(LECTERN.x, 0, LECTERN.z);
    // The board faces whoever stands at the lectern's spot.
    lectern.rotation.y = Math.atan2(reader.x - LECTERN.x, reader.z - LECTERN.z);
    this.group.add(bell, lectern);
    this.bell = bell.getObjectByName("swing");
    this.leaf = lectern.getObjectByName("leaf");
  }

  /** What the scene drives now. `still` puts the doors where they end up; the rest holds. */
  set(scene: VillageScene, still: boolean): void {
    this.open = scene.actors.some((actor) => actor.doing === "fetching");
    this.turning = busy(scene, "copyist", "copying");
    this.sawing = busy(scene, "artisan", "building");
    if (scene.bellRinging && !still && this.bellFrame === 0) {
      this.bellFrame = 1;
    }
    if (still) {
      this.doorFrame = this.open ? DOOR_SWING.length - 1 : 0;
      this.swingDoors();
    }
  }

  /** One frame of every part a run is driving. */
  step(): void {
    const toward = this.open ? this.doorFrame + 1 : this.doorFrame - 1;
    this.doorFrame = Math.min(DOOR_SWING.length - 1, Math.max(0, toward));
    this.swingDoors();
    if (this.leaf !== undefined && (this.turning || this.leafFrame !== 0)) {
      // A page already turning finishes its turn and lies flat; it never stops in the air.
      this.leafFrame = (this.leafFrame + 1) % (LEAF_TURN.length + LEAF_REST);
      this.leaf.rotation.z = LEAF_TURN[this.leafFrame] ?? 0;
    }
    if (this.sawing) {
      for (const saw of this.saws) {
        saw.rotation.x -= SAW_TURN;
      }
    }
    if (this.bell !== undefined && this.bellFrame !== 0) {
      this.bell.rotation.x = BELL_SWING[this.bellFrame - 1] ?? 0;
      this.bellFrame = this.bellFrame >= BELL_SWING.length ? 0 : this.bellFrame + 1;
    }
  }

  private swingDoors(): void {
    const angle = DOOR_SWING[this.doorFrame] ?? 0;
    for (const [door, way] of this.doors) {
      door.rotation.y = angle * way;
    }
  }
}
