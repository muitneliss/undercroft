/**
 * The vocabulary `runFlow.ts` and `runFlowEntities.ts` share: what a stage is, and the three
 * geometries it can be in. Its own module so the two files that build stages can both import
 * it without importing each other.
 */

export type StageKind = "entity" | "outcome" | "models" | "lake" | "link-parent" | "link-child";

export interface RunStage {
  readonly key: string;
  readonly kind: StageKind;
  readonly label: string;
  readonly mark: StageMark;
  readonly markLabel: string;
  /** One quiet datum line, or nothing when there is no evidence yet to show. */
  readonly detail: string | null;
  /**
   * How far along this stage is, 0 to 1, for the rule inked along the foot of its plate.
   *
   * `null` wherever there is no measured fraction to draw: a stage that has finished, a models
   * build that has no per-model signal, an entity read toward a total nobody has stated. A bar
   * against a guessed denominator is rule 2 broken in pixels, and it is the most convincing
   * kind of guess, because it looks exactly like a measurement.
   */
  readonly gathered: number | null;
  /** Set only for a link stage: where it goes. */
  readonly href: string | null;
  // `@xyflow/react`'s Node<T> requires its data to be indexable; every declared field above
  // is still exactly typed, this only admits the shape to that constraint.
  readonly [key: string]: unknown;
}

/**
 * Three of the system's four status geometries: granted, pending, lapsed. `runMark` (the
 * card's own mapping) has a fourth, absent, for a source that has never run at all -- not a
 * state a stage in a run already open on this leaf can be in, so this narrows it away rather
 * than carry a branch nothing here can reach.
 */
export type StageMark = "granted" | "pending" | "lapsed";

export function markForStatus(status: "running" | "ok" | "failed"): StageMark {
  if (status === "running") {
    return "pending";
  }
  return status === "ok" ? "granted" : "lapsed";
}
