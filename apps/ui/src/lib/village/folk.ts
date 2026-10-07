/**
 * The cast: one figure per character in the scene, walking its routes in stop-motion.
 *
 * A figure is told what its character is doing (`script.ts`) and turns that into a choreography,
 * a short loop of legs: walk to a spot, then hold a clip there for a while. It moves only on the
 * runtime's frames, a fixed stride per frame along the route, and its clips are already keyed on
 * those frames (STEP, by the asset script). So a figure is never between two poses: that is the
 * whole of the stop-motion.
 *
 * Under reduced motion a figure never walks. It is put straight where its work is and holds the
 * first frame of that work's clip.
 */

import {
  AnimationClip,
  type AnimationAction,
  AnimationMixer,
  Group,
  Mesh,
  type Object3D,
  BoxGeometry,
  MeshBasicMaterial,
} from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";

import type { Point } from "@/lib/village/layout.ts";
import { FIGURE_TARGET } from "@/lib/village/pointer.ts";
import { NODES, route } from "@/lib/village/roads.ts";
import type { Actor, Doing, Role } from "@/lib/village/script.ts";
import type { Cast } from "@/lib/village/kit.ts";

/** Seconds per frame: the village's ten frames a second (ADR 0116). */
export const FRAME_SECONDS = 0.1;
/** How far a figure walks in one frame. */
const STRIDE = 0.17;
/** KayKit's characters stand about 2.3 units tall; the village's stand about one. */
export const FIGURE_SCALE = 0.5;

/** Which KayKit character plays each role (`docs/design/village.md`). */
const MODEL: Readonly<Record<Role, string>> = {
  courier: "Ranger",
  carter: "Ranger",
  keeper: "Rogue",
  scribe: "Mage",
  artisan: "Barbarian",
  inspector: "Knight",
};

/** Where each role is at home. A courier's home is by its own road's slot. */
function homeOf(actor: Pick<Actor, "role" | "slot">): string {
  switch (actor.role) {
    case "courier":
      return `courier${actor.slot ?? 0}Rest`;
    case "carter":
      return "apiEdge";
    case "keeper":
      return "keeperRest";
    case "scribe":
      return "scribeRest";
    case "artisan":
      return "artisanRest";
    case "inspector":
      return "inspectorRest";
    default: {
      const exhaustive: never = actor.role;
      throw new Error(`unhandled role ${String(exhaustive)}`);
    }
  }
}

/** One leg of a choreography: walk to `to`, then hold `clip` for `hold` frames (forever if null). */
interface Leg {
  readonly to: string;
  readonly clip: string;
  readonly hold: number | null;
  readonly carrying: boolean;
}

/**
 * What a doing looks like, as legs. A loop repeats; a last leg held forever is where the figure
 * stays. `still` is the leg reduced motion shows: where the work is.
 */
function choreography(actor: Actor): { legs: readonly Leg[]; still: number } {
  const home = homeOf(actor);
  const slot = actor.slot ?? 0;
  const plays: Readonly<Record<Doing, () => { legs: readonly Leg[]; still: number }>> = {
    resting: () => ({ legs: [stay(home, "Idle_A")], still: 0 }),
    failed: () => ({ legs: [stay(home, "Idle_A")], still: 0 }),
    waiting: () => ({ legs: [stay("gateBench", "Sit_Floor_Idle")], still: 0 }),
    fetching: () => ({
      legs: [
        { to: `road${slot}Edge`, clip: "PickUp", hold: 13, carrying: false },
        { to: "vault", clip: "PickUp", hold: 13, carrying: true },
      ],
      still: 1,
    }),
    barred: () => ({
      legs: [
        { to: `road${slot}Bar`, clip: "Interact", hold: 13, carrying: false },
        { to: `road${slot}Bend`, clip: "Idle_A", hold: 10, carrying: false },
      ],
      still: 0,
    }),
    sealing: () => ({ legs: [stay("keeperRest", "Use_Item")], still: 0 }),
    reading: () => ({ legs: [stay("archive", "Working_A")], still: 0 }),
    building: () => ({ legs: [stay("workshop", "Hammering")], still: 0 }),
    inspecting: () => ({ legs: [stay("inspect", "Interact")], still: 0 }),
    handing: () => ({ legs: [stay("reading", "Waving")], still: 0 }),
    delivering: () => ({
      legs: [
        { to: "vault", clip: "PickUp", hold: 13, carrying: true },
        { to: "apiEdge", clip: "Idle_A", hold: 5, carrying: false },
      ],
      still: 0,
    }),
  };
  return plays[actor.doing]();
}

/** The bones a carried crate is held by: a carrying figure walks on the walk's legs and the hold's arms. */
const ARM_BONES = /^(?:upperarm|lowerarm|wrist|hand|handslot|chest|spine|head)/u;

/** The bone a track moves: the part of its name before the property. */
function boneOf(track: { readonly name: string }): string {
  return track.name.split(".")[0] ?? "";
}

export function carryClip(clips: readonly AnimationClip[]): AnimationClip | null {
  const walk = clips.find((clip) => clip.name === "Walking_A");
  const hold = clips.find((clip) => clip.name === "Holding_A");
  if (walk === undefined || hold === undefined) {
    return null;
  }
  return new AnimationClip("Carrying", walk.duration, [
    ...walk.tracks.filter((track) => !ARM_BONES.test(boneOf(track))),
    ...hold.tracks.filter((track) => ARM_BONES.test(boneOf(track))),
  ]);
}

/** What a figure is given to hold: a crate to carry, and a slip to stand under. */
export interface FigureMakers {
  readonly crate: () => Object3D;
  readonly slip: () => Object3D;
}

/** A leg held forever at `to`: where a figure stays while it works or rests. */
function stay(to: string, clip: string): Leg {
  return { to, clip, hold: null, carrying: false };
}

/** What a press lands on, shared by every figure: the skinned meshes' own bounds lag their pose. */
const HIT_BOX = new BoxGeometry(0.5, 0.9, 0.5);
const HIT_MATERIAL = new MeshBasicMaterial();

export class Figure {
  /** The figure's place in the world: moved and turned, never scaled. */
  readonly holder = new Group();
  readonly key: string;
  private readonly body: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly crate: Object3D;
  private readonly makeSlip: () => Object3D;
  private slip: Object3D | null = null;
  private slipFrame = 0;
  private legs: readonly Leg[] = [];
  private leg = 0;
  private path: Point[] = [];
  private held = 0;
  private playing = "";
  private doing: Doing | null = null;

  constructor(actor: Actor, cast: Cast, make: FigureMakers) {
    this.key = actor.key;
    this.makeSlip = make.slip;
    const model = cast.models.get(MODEL[actor.role]);
    this.body = model === undefined ? new Group() : cloneRig(model);
    this.body.scale.setScalar(FIGURE_SCALE);
    this.holder.add(this.body);
    this.mixer = new AnimationMixer(this.body);
    const carry = carryClip(cast.clips);
    for (const clip of carry === null ? cast.clips : [...cast.clips, carry]) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }
    this.crate = make.crate();
    this.crate.scale.setScalar(6);
    this.crate.position.set(0, 0.15, 0.55);
    this.crate.visible = false;
    this.body.getObjectByName("chest")?.add(this.crate);
    const hit = new Mesh(HIT_BOX, HIT_MATERIAL);
    hit.position.y = 0.45;
    hit.visible = false;
    hit.name = `${FIGURE_TARGET}${actor.key}`;
    this.holder.add(hit);
    const home = NODES[homeOf(actor)] ?? { x: 0, z: 0 };
    this.holder.position.set(home.x, 0, home.z);
  }

  /** What the character is doing now. A change of doing starts its choreography afresh. */
  cast(actor: Actor, still: boolean): void {
    this.setSlip(actor.slip);
    if (actor.doing === this.doing && !still) {
      return;
    }
    this.doing = actor.doing;
    const { legs, still: stillLeg } = choreography(actor);
    this.legs = legs;
    if (still) {
      const leg = legs[stillLeg] ?? legs[0];
      const spot = leg === undefined ? undefined : NODES[leg.to];
      if (leg !== undefined && spot !== undefined) {
        this.leg = stillLeg;
        this.path = [];
        this.holder.position.set(spot.x, 0, spot.z);
        this.crate.visible = leg.carrying;
        this.play(leg.clip);
        this.mixer.setTime(0);
      }
      return;
    }
    this.startLeg(0);
  }

  private startLeg(index: number): void {
    this.leg = index;
    this.held = 0;
    const leg = this.legs[index];
    if (leg === undefined) {
      return;
    }
    const here = { x: this.holder.position.x, z: this.holder.position.z };
    this.path = [...route(here, leg.to)];
    this.crate.visible = leg.carrying;
  }

  private play(name: string): void {
    if (name === this.playing) {
      return;
    }
    this.actions.get(this.playing)?.stop();
    this.actions.get(name)?.reset().play();
    this.playing = name;
  }

  private setSlip(on: boolean): void {
    if (on && this.slip === null) {
      this.slip = this.makeSlip();
      this.slip.position.set(0.35, 0.35, 0);
      this.slipFrame = 0;
      this.holder.add(this.slip);
    } else if (!on && this.slip !== null) {
      this.holder.remove(this.slip);
      this.slip = null;
    }
  }

  /** One frame: a stride along the path, or a frame of the clip held at the end of it. */
  step(): void {
    const leg = this.legs[this.leg];
    if (leg === undefined) {
      return;
    }
    const [next] = this.path;
    if (next === undefined) {
      this.play(leg.clip);
      this.held += 1;
      if (leg.hold !== null && this.held >= leg.hold) {
        this.startLeg((this.leg + 1) % this.legs.length);
      }
    } else {
      const dx = next.x - this.holder.position.x;
      const dz = next.z - this.holder.position.z;
      const away = Math.hypot(dx, dz);
      if (away <= STRIDE) {
        this.holder.position.set(next.x, 0, next.z);
        this.path.shift();
      } else {
        this.holder.position.x += (dx / away) * STRIDE;
        this.holder.position.z += (dz / away) * STRIDE;
      }
      if (away > 1e-3) {
        this.holder.rotation.y = Math.atan2(dx, dz);
      }
      this.play(leg.carrying ? "Carrying" : "Walking_A");
    }
    this.mixer.update(FRAME_SECONDS);
    this.tipSlip();
  }

  /** An errata slip tips in crooked and lands square in three frames, as the page's does. */
  private tipSlip(): void {
    if (this.slip === null || this.slipFrame >= 3) {
      return;
    }
    this.slipFrame += 1;
    const card = this.slip.getObjectByName("card");
    if (card !== undefined) {
      card.rotation.z = -0.3 * (1 - this.slipFrame / 3);
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.holder.removeFromParent();
  }
}
