/**
 * The traffic on a graph's roads: something carried along every edge that flows, and along no
 * other (ADR 0116, `graph.ts`). A courier with a crate walks a run's road out of a stage still
 * working; a handcart with a crate rolls along each road of the selected model's chains.
 *
 * A carrier moves a fixed stride a frame from just past the source building to just short of the
 * target, then starts again, so the road reads as work going one way. Under reduced motion it
 * stands at the road's middle and does not move.
 */

import { AnimationMixer, Group, type Object3D } from "three";
import { clone as cloneRig } from "three/addons/utils/SkeletonUtils.js";

import { carryClip, FIGURE_SCALE, FRAME_SECONDS } from "@/lib/village/folk.ts";
import type { Kit } from "@/lib/village/kit.ts";
import type { Point } from "@/lib/village/layout.ts";

const STRIDE = 0.15;
/** How far from each building's middle a carrier turns back: its doorstep, not its roof. */
const DOORSTEP = 1.2;
const CART_SCALE = 2.2;
const CRATE_SCALE = 2.4;

/** A courier with a crate in both arms, walking. */
function courier(kit: Kit): { body: Object3D; mixer: AnimationMixer } {
  const model = kit.cast.models.get("Ranger");
  const body = model === undefined ? new Group() : cloneRig(model);
  body.scale.setScalar(FIGURE_SCALE);
  const crate = kit.piece("crate");
  crate.scale.setScalar(6);
  crate.position.set(0, 0.15, 0.55);
  body.getObjectByName("chest")?.add(crate);
  const mixer = new AnimationMixer(body);
  const clip = carryClip(kit.cast.clips);
  if (clip !== null) {
    mixer.clipAction(clip).play();
  }
  return { body, mixer };
}

/** A handcart with a crate on it, rolling. */
function cart(kit: Kit): { body: Object3D; mixer: null } {
  const body = new Group();
  const barrow = kit.piece("handcart");
  barrow.scale.setScalar(CART_SCALE);
  const crate = kit.piece("crate");
  crate.scale.setScalar(CRATE_SCALE);
  crate.position.set(0, 0.32, 0.05);
  body.add(barrow, crate);
  return { body, mixer: null };
}

export class Carrier {
  readonly holder = new Group();
  private readonly points: readonly Point[];
  private readonly lengths: number[] = [0];
  private readonly mixer: AnimationMixer | null;
  private travelled: number;

  constructor(kit: Kit, path: readonly Point[], kind: "figure" | "cart", start: number) {
    this.points = path;
    for (let at = 1; at < path.length; at += 1) {
      const from = path[at - 1];
      const to = path[at];
      const before = this.lengths[at - 1] ?? 0;
      this.lengths.push(
        before +
          (from === undefined || to === undefined ? 0 : Math.hypot(to.x - from.x, to.z - from.z)),
      );
    }
    const { body, mixer } = kind === "figure" ? courier(kit) : cart(kit);
    this.holder.add(body);
    this.mixer = mixer;
    this.travelled = DOORSTEP + start * this.span();
    this.place();
  }

  private span(): number {
    return Math.max(0, (this.lengths.at(-1) ?? 0) - DOORSTEP * 2);
  }

  /** Stands the carrier where it has got to along the road, facing the way it goes. */
  private place(): void {
    const at = this.lengths.findIndex((length) => length >= this.travelled);
    const index = Math.max(1, at === -1 ? this.points.length - 1 : at);
    const from: Point = this.points[index - 1] ?? { x: 0, z: 0 };
    const to: Point = this.points[index] ?? from;
    const before = this.lengths[index - 1] ?? 0;
    const piece = (this.lengths[index] ?? before) - before || 1;
    const share = Math.min(1, Math.max(0, (this.travelled - before) / piece));
    this.holder.position.set(
      from.x + (to.x - from.x) * share,
      0.07,
      from.z + (to.z - from.z) * share,
    );
    this.holder.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  }

  /** One frame along the road. */
  step(): void {
    this.travelled += STRIDE;
    if (this.travelled > DOORSTEP + this.span()) {
      this.travelled = DOORSTEP;
    }
    this.place();
    this.mixer?.update(FRAME_SECONDS);
  }

  /** Reduced motion: at the road's middle, still. */
  settle(): void {
    this.travelled = DOORSTEP + this.span() / 2;
    this.place();
    this.mixer?.setTime(0);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.holder.removeFromParent();
  }
}
