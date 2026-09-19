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
  // biome-ignore lint/style/noTernary: A ternary selects between two VALUES -- see the file-level note in runFlow.ts, which this module is too small to repeat.
  return status === "ok" ? "granted" : "lapsed";
}
