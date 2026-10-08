/**
 * What each doing looks like (`docs/design/village.md`): which KayKit character plays each role,
 * where each is at home, and the choreography a doing is played as, a short loop of legs. Pure
 * data and rules; `folk.ts` is the figure that walks and holds them on the film's frames.
 *
 * A leg names a spot in `roads.ts` and a clip in `clips.glb`, so a change here needs both to
 * exist: a spot nobody connects is unreachable, and a clip the asset script did not keep plays
 * nothing.
 */

import type { Actor, Doing, Role } from "@/lib/village/script.ts";

/** Which KayKit character plays each role (`docs/design/village.md`). */
export const MODEL: Readonly<Record<Role, string>> = {
  courier: "Ranger",
  carter: "Ranger",
  keeper: "Rogue",
  copyist: "Rogue_Hooded",
  scribe: "Mage",
  artisan: "Barbarian",
  inspector: "Knight",
};

/** Where each role is at home. A courier's home is by its own road's slot. */
export function homeOf(actor: Pick<Actor, "role" | "slot">): string {
  switch (actor.role) {
    case "courier":
      return `courier${actor.slot ?? 0}Rest`;
    case "carter":
      return "apiEdge";
    case "keeper":
      return "keeperRest";
    case "copyist":
      return "copyistRest";
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
export interface Leg {
  readonly to: string;
  readonly clip: string;
  readonly hold: number | null;
  /** Walks there with a crate in its arms, and keeps it through the clip. */
  readonly carrying: boolean;
  /** Sets the crate down on arriving, so the clip is worked empty-handed: a copyist at a desk. */
  readonly setsDown?: true;
}

/** Whether a figure on `leg` has the crate in its arms: on the way, or there too unless set down. */
export function inArms(leg: Leg, arrived: boolean): boolean {
  return leg.carrying && !(arrived && leg.setsDown === true);
}

/**
 * What a doing looks like, as legs. A loop repeats; a last leg held forever is where the figure
 * stays. `still` is the leg reduced motion shows: where the work is.
 *
 * A worker waiting for a turn sits at home, not where its work is: sitting at the bench would say
 * the work had begun. A courier's home is on its road's line, so it waits on the gate's bench.
 */
export function choreography(actor: Actor): { legs: readonly Leg[]; still: number } {
  const home = homeOf(actor);
  const slot = actor.slot ?? 0;
  const plays: Readonly<Record<Doing, () => { legs: readonly Leg[]; still: number }>> = {
    resting: () => ({ legs: [stay(home, "Idle_A")], still: 0 }),
    failed: () => ({ legs: [stay(home, "Idle_A")], still: 0 }),
    waiting: () => ({
      legs: [stay(actor.role === "courier" ? "gateBench" : home, "Sit_Floor_Idle")],
      still: 0,
    }),
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
    copying: () => ({
      legs: [
        { to: "archive", clip: "PickUp", hold: 12, carrying: false },
        { to: "lectern", clip: "Working_B", hold: 20, carrying: true, setsDown: true },
      ],
      still: 1,
    }),
    classifying: () => ({ legs: [stay("sorting", "Ranged_Magic_Spellcasting")], still: 0 }),
    building: () => ({
      legs: [
        { to: "workshop", clip: "Hammering", hold: 20, carrying: false },
        { to: "mill", clip: "Sawing", hold: 20, carrying: false },
      ],
      still: 0,
    }),
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

/** A leg held forever at `to`: where a figure stays while it works or rests. */
function stay(to: string, clip: string): Leg {
  return { to, clip, hold: null, carrying: false };
}
