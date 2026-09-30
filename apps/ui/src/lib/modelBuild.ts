/**
 * How a model's last build reads on the list: the same four marks the grants use, so a
 * column of models scans the way a column of sources does.
 *
 * dbt's statuses for a model node are `success`, `error` and `skipped`; a model never built
 * has none. Anything dbt adds later that this does not know is pending rather than
 * guessed at as a success.
 *
 * The four marks are four STATES here too, and the list's counts are one per state: every
 * model is in exactly one, so the counts add up to the models listed. "Never built" is a
 * build state -- no build is recorded -- and not a claim that the model is new. The state a
 * reader pressed lives in the address (`?build=failed`), so Back restores the list it came
 * from and a pasted link opens the same narrowed list.
 */

import type { TFunction } from "i18next";

import type { CardFacts } from "@/lib/connectionState.ts";

/** In the order the counts print: what needs a person first. */
export const BUILD_STATES = ["failed", "never", "other", "ok"] as const;
export type BuildState = (typeof BUILD_STATES)[number];

/** The search parameter that holds the state the list is narrowed to. */
export const BUILD_PARAM = "build";

const MARK: Readonly<Record<BuildState, CardFacts["mark"]>> = {
  ok: "granted",
  failed: "lapsed",
  never: "absent",
  other: "pending",
};

export function buildState(status: string | null): BuildState {
  switch (status) {
    case "success":
      return "ok";
    case "error":
      return "failed";
    case null:
      return "never";
    default:
      return "other";
  }
}

export function buildMark(status: string | null): CardFacts["mark"] {
  return MARK[buildState(status)];
}

export function stateMark(state: BuildState): CardFacts["mark"] {
  return MARK[state];
}

export function buildMarkLabel(t: TFunction, status: string | null): string {
  const state = buildState(status);
  return state === "other" ? t("models.buildOther", { status }) : stateLabel(t, state);
}

/** A state's name, for its count: "other" gathers several statuses, so it cannot name one. */
export function stateLabel(t: TFunction, state: BuildState): string {
  switch (state) {
    case "ok":
      return t("models.buildOk");
    case "failed":
      return t("models.buildFailed");
    case "never":
      return t("models.neverBuilt");
    default:
      return t("models.buildOtherState");
  }
}

/** How many of `statuses` are in each state. Every status counts once, so they sum to all. */
export function buildTally(statuses: readonly (string | null)[]): Record<BuildState, number> {
  const tally: Record<BuildState, number> = { failed: 0, never: 0, other: 0, ok: 0 };
  for (const status of statuses) {
    tally[buildState(status)] += 1;
  }
  return tally;
}

/** The state the address narrows the list to, or `null` for the whole list. */
export function buildFilter(params: URLSearchParams): BuildState | null {
  const value = params.get(BUILD_PARAM);
  return BUILD_STATES.find((state) => state === value) ?? null;
}
