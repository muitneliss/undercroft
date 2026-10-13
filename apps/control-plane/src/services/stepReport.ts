/**
 * A run's dbt steps as an answer: a summary of every step, then the page of them the caller
 * asked for -- by default only the ones that did not pass.
 *
 * Why this exists (issue 441): a full-tenant transform records a thousand steps, almost all of
 * them passing tests, and an answer that carried every one of them was 292 KB to find the one
 * that failed. So the summary always comes, the steps that need reading come by default, and the
 * passing ones come on request, filtered and paged.
 *
 * Pure, over steps already in memory, and that is a choice rather than an accident. Two answers
 * report steps -- `runs.get` reads them from `ops.run_step`, `models.build` gets them back from
 * the worker -- and one function over a list gives both the same summary, the same filters and
 * the same cursor. A SQL version for the first and this for the second would be two definitions
 * of "problem" and of a page boundary, free to drift. Reading every step of a run is what
 * `runs.get` did before this; what got smaller is the answer, which is what cost.
 *
 * A step is never folded into a verdict it did not earn (CLAUDE.md rule 2). The summary counts
 * dbt's own statuses as dbt wrote them: a skipped step is counted as `skipped`, never as a pass,
 * and a status nobody here has seen before is counted under its own name and listed as a problem
 * rather than hidden.
 */

import type { RunStep } from "@undercroft/db/repos";

export const STEP_VIEWS = ["none", "problems", "all"] as const;
/** Which steps an answer lists: none, the problems (the default), or every one. */
export type StepView = (typeof STEP_VIEWS)[number];

/** What a caller asks of the steps. The names are the API's own, so a handler passes its input. */
export interface StepQuery {
  /**
   * Which steps to list. Left out, it is `problems` -- unless a step filter is given, and then it
   * is `all`: an agent asking for `stepStatus: "skipped"` means the skipped steps, and answering
   * it with the problems among them (none, since a skip is not a problem) would be a trap.
   */
  readonly steps?: StepView | undefined;
  /** Only steps whose dbt status is exactly this: `pass`, `fail`, `skipped`... */
  readonly stepStatus?: string | undefined;
  readonly stepKind?: RunStep["kind"] | undefined;
  /** Only steps whose name contains this, ignoring case. */
  readonly stepName?: string | undefined;
  /** Where the previous page ended -- its `nextStepCursor`, handed back unread. */
  readonly stepCursor?: string | undefined;
  /** The most steps one page lists. */
  readonly stepLimit: number;
}

/** Every step of the run, counted, whatever the query listed. */
export interface StepSummary {
  readonly total: number;
  /** How many steps of each kind ended in each dbt status, e.g. `test: { pass: 686, fail: 1 }`. */
  readonly byStatus: {
    readonly model: Readonly<Record<string, number>>;
    readonly test: Readonly<Record<string, number>>;
    /** The seeds the build loaded (ADR 0128); empty for a build that reached none. */
    readonly seed: Readonly<Record<string, number>>;
  };
  /** How many steps are problems -- see {@link isProblem}. */
  readonly problems: number;
}

/** The steps half of an answer, in the field names the answer carries. */
export interface StepReport {
  readonly stepSummary: StepSummary;
  /** The page asked for, ordered by kind, then name, then dbt's unique id. */
  readonly steps: RunStep[];
  /** Hand back as `stepCursor` for the next page; `null` when this page was the last. */
  readonly nextStepCursor: string | null;
}

/**
 * The statuses that need no reading: a model built, a test passed, a step dbt skipped. A skip is
 * counted by name in the summary and listed on request, but it is not a problem in itself -- it
 * is the shadow of one, and that one is listed.
 */
const QUIET = new Set(["success", "pass", "skipped"]);

/**
 * Whether a step needs reading: it failed, errored, or warned (`fail`, `error`, `warn`), or it
 * ended in a status this module does not know -- unknown is listed, never assumed fine -- or it
 * built and was held back rather than published (ADR 0131): a `success` that Reports does not
 * read is not one to pass over.
 */
export function isProblem(step: Pick<RunStep, "status" | "promoted">): boolean {
  return !QUIET.has(step.status) || (step.status === "success" && step.promoted === false);
}

/** The order a page walks in, compared by code point so the cursor and the sort agree exactly. */
type StepKey = readonly [kind: string, name: string, uniqueId: string];

function keyOf(step: RunStep): StepKey {
  return [step.kind, step.name, step.uniqueId];
}

function compareKeys(a: StepKey, b: StepKey): -1 | 0 | 1 {
  for (let at = 0; at < a.length; at += 1) {
    const left = a[at] ?? "";
    const right = b[at] ?? "";
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

function encodeStepCursor(step: RunStep): string {
  return Buffer.from(JSON.stringify(keyOf(step)), "utf8").toString("base64url");
}

/**
 * The key a cursor names, or `null` for anything that is not one of ours -- read from the top,
 * as every cursor in this API reads a stale bookmark, rather than refused as an error.
 */
function decodeStepCursor(cursor: string | undefined): StepKey | null {
  if (cursor === undefined || cursor === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(parsed)) {
      const [kind, name, uniqueId, ...rest]: unknown[] = parsed;
      if (
        typeof kind === "string" &&
        typeof name === "string" &&
        typeof uniqueId === "string" &&
        rest.length === 0
      ) {
        return [kind, name, uniqueId];
      }
    }
  } catch {
    // Not base64url JSON: not ours.
  }
  return null;
}

function summarise(all: readonly RunStep[]): StepSummary {
  const byStatus: Record<RunStep["kind"], Record<string, number>> = {
    model: {},
    test: {},
    seed: {},
  };
  let problems = 0;
  for (const step of all) {
    const tally = byStatus[step.kind];
    tally[step.status] = (tally[step.status] ?? 0) + 1;
    if (isProblem(step)) {
      problems += 1;
    }
  }
  return { total: all.length, byStatus, problems };
}

function viewOf(query: StepQuery): StepView {
  if (query.steps !== undefined) {
    return query.steps;
  }
  const filtered =
    query.stepStatus !== undefined || query.stepKind !== undefined || query.stepName !== undefined;
  return filtered ? "all" : "problems";
}

/**
 * The steps half of an answer: the summary of `all`, then the page `query` selects.
 *
 * `steps` picks the set (none, problems, all), the three filters narrow it, the cursor resumes
 * after the last step of the previous page, and `stepLimit` bounds the page. A filter that
 * matches nothing is an empty page, and the summary beside it still counts every step.
 */
export function reportSteps(all: readonly RunStep[], query: StepQuery): StepReport {
  const stepSummary = summarise(all);
  const view = viewOf(query);
  if (view === "none") {
    return { stepSummary, steps: [], nextStepCursor: null };
  }
  const after = decodeStepCursor(query.stepCursor);
  const name = query.stepName?.toLowerCase();
  const selected = all
    .filter(
      (step) =>
        (view === "all" || isProblem(step)) &&
        (query.stepStatus === undefined || step.status === query.stepStatus) &&
        (query.stepKind === undefined || step.kind === query.stepKind) &&
        (name === undefined || step.name.toLowerCase().includes(name)) &&
        (after === null || compareKeys(keyOf(step), after) > 0),
    )
    .sort((a, b) => compareKeys(keyOf(a), keyOf(b)));
  const steps = selected.slice(0, query.stepLimit);
  const last = steps.at(-1);
  const nextStepCursor =
    selected.length > query.stepLimit && last !== undefined ? encodeStepCursor(last) : null;
  return { stepSummary, steps, nextStepCursor };
}
