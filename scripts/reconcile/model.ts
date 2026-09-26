/**
 * The vocabulary of a live reconciliation: what a test case is, what it may conclude, and
 * what a single record's comparison may conclude.
 *
 * FIVE STATUSES, AND THREE OF THEM ARE NOT PASS. A reconciliation that cannot reach a system,
 * or runs while a source is still landing, has not shown that the data is complete -- and
 * the easiest way to ship a green report that proves nothing is to fold "could not tell"
 * into "fine". So `PENDING` (the data has not finished arriving), `BLOCKED` (a credential, a
 * permission or an observation point is missing) and `OUT_OF_SCOPE` (the confirmed scope of
 * the test says this is not a question to ask) are separate values, and `summarise` never
 * turns any of them into a pass. `OUT_OF_SCOPE` is not a failure either: it is a decision
 * about the question, recorded so a reader can check it.
 *
 * A RECORD VERDICT IS NOT A ROW COUNT. Two systems holding the same number of rows prove
 * nothing when one of them splits, merges or aggregates; every comparison here is keyed, and
 * a key that maps to several target rows is reported as `DUPLICATE` rather than counted as
 * present.
 */

export type Status = "PASS" | "FAIL" | "PENDING" | "BLOCKED" | "OUT_OF_SCOPE";

export const STATUSES: readonly Status[] = ["PASS", "FAIL", "PENDING", "BLOCKED", "OUT_OF_SCOPE"];

/** What one keyed record came to, in one direction of one leg. */
export type Verdict =
  /** In scope on both sides, present once, and every compared field agrees. */
  | "MATCH"
  /** In scope, synchronised by the target's own watermark, and absent. */
  | "MISSING"
  /** Present in the target, absent from the source reference. */
  | "EXTRA"
  /** One source key answered by more than one target row. */
  | "DUPLICATE"
  /** Present once, but a field the contract preserves differs. */
  | "CONTENT_MISMATCH"
  /** Outside the target's confirmed scope; its absence is the correct answer. */
  | "OUT_OF_SCOPE"
  /** Newer than the target's last completed run; its absence proves nothing yet. */
  | "NOT_YET_SYNCED"
  /** Deliberately dropped by a rule the target's contract names, with the rule recorded. */
  | "EXCLUDED_BY_RULE";

export const VERDICTS: readonly Verdict[] = [
  "MATCH",
  "MISSING",
  "EXTRA",
  "DUPLICATE",
  "CONTENT_MISMATCH",
  "OUT_OF_SCOPE",
  "NOT_YET_SYNCED",
  "EXCLUDED_BY_RULE",
];

/** A verdict that shows the target disagrees with the source for a reason nobody declared. */
export const DEFECT_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>([
  "MISSING",
  "EXTRA",
  "DUPLICATE",
  "CONTENT_MISMATCH",
]);

export type TestGroup = "unit" | "contract" | "integration" | "live" | "e2e" | "regression";

export type SourceName = "gmail" | "hubspot" | "drive";

/** SOURCE <-> OSTWIN, SOURCE <-> UNDERCROFT, and OSTWIN <-> UNDERCROFT over their shared scope. */
export type Leg = "S2O" | "S2U" | "O2U";

/** One field a contract says must survive the trip, and what each side held. */
export interface FieldDiff {
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
}

/** One keyed record's result. `evidence` names where each side's copy was read. */
export interface RecordResult {
  readonly key: string;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly diffs: readonly FieldDiff[];
  readonly evidence: Readonly<Record<string, string>>;
}

/** A file or excerpt a result can be checked against, relative to the run's evidence folder. */
export interface Evidence {
  readonly label: string;
  readonly path: string;
}

/** One executed test case: the unit the matrix, the report and the exit code are built from. */
export interface TestResult {
  readonly id: string;
  readonly title: string;
  readonly group: TestGroup;
  readonly source: SourceName | "system";
  readonly leg?: Leg;
  /** The CASE-ID of the client this case is about, never a name. */
  readonly client?: string;
  readonly requirement: string;
  readonly contract: string;
  readonly preconditions: string;
  readonly expected: string;
  readonly actual: string;
  readonly status: Status;
  /** Why the status is what it is -- mandatory for every status but PASS. */
  readonly reason: string;
  readonly counts?: Readonly<Partial<Record<Verdict, number>>>;
  readonly evidence: readonly Evidence[];
  /** The issue or finding this case reproduces, when it is a regression case. */
  readonly finding?: string;
}

export interface RunSummary {
  readonly total: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  /** True only when every case either passed or was out of scope by a recorded decision. */
  readonly complete: boolean;
  /** Zero, one or two: pass, confirmed failure, incomplete. The process exit code. */
  readonly exitCode: 0 | 1 | 2;
}

/**
 * Fold a run's results into its verdict.
 *
 * A FAIL outranks everything: a confirmed discrepancy is reported even when other cases
 * could not run. Otherwise any PENDING or BLOCKED case makes the run incomplete, exit 2 --
 * the official live mode is not allowed to report success over a case it did not decide.
 */
export function summarise(results: readonly TestResult[]): RunSummary {
  const byStatus: Record<Status, number> = {
    PASS: 0,
    FAIL: 0,
    PENDING: 0,
    BLOCKED: 0,
    OUT_OF_SCOPE: 0,
  };
  for (const result of results) {
    byStatus[result.status] += 1;
  }
  const undecided = byStatus.PENDING + byStatus.BLOCKED;
  let exitCode: 0 | 1 | 2 = 0;
  if (byStatus.FAIL > 0) {
    exitCode = 1;
  } else if (undecided > 0) {
    exitCode = 2;
  }
  return {
    total: results.length,
    byStatus,
    complete: byStatus.FAIL === 0 && undecided === 0,
    exitCode,
  };
}

/** Count record verdicts, keeping every verdict present even at zero. */
export function tally(records: readonly RecordResult[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    MATCH: 0,
    MISSING: 0,
    EXTRA: 0,
    DUPLICATE: 0,
    CONTENT_MISMATCH: 0,
    OUT_OF_SCOPE: 0,
    NOT_YET_SYNCED: 0,
    EXCLUDED_BY_RULE: 0,
  };
  for (const record of records) {
    counts[record.verdict] += 1;
  }
  return counts;
}

/**
 * The status a leg earns from its record verdicts.
 *
 * Any defect verdict fails the leg. With none, a leg whose target has not finished its run
 * is PENDING rather than PASS -- the records it holds agree, but the ones still arriving
 * have not been seen. `synchronised` is the target's own statement that its run completed.
 */
export function legStatus(
  counts: Readonly<Record<Verdict, number>>,
  synchronised: boolean,
): { status: Status; reason: string } {
  const defects = [...DEFECT_VERDICTS].filter((verdict) => counts[verdict] > 0);
  if (defects.length > 0) {
    return {
      status: "FAIL",
      reason: `defects: ${defects.map((verdict) => `${verdict}=${counts[verdict]}`).join(", ")}`,
    };
  }
  if (!synchronised) {
    return {
      status: "PENDING",
      reason: "no defect among the records seen, but the target's run has not completed",
    };
  }
  const compared = counts.MATCH + counts.NOT_YET_SYNCED;
  const total = VERDICTS.reduce((sum, verdict) => sum + counts[verdict], 0);
  // An empty comparison proves nothing, so it is never a PASS. Whether the source SHOULD have
  // held records for this client is a different question, asked by the source-side sanity
  // cases; here the leg simply has nothing to decide.
  if (total === 0) {
    return {
      status: "OUT_OF_SCOPE",
      reason: "vacuous: the source holds no record for this client in this leg",
    };
  }
  if (compared === 0 && counts.OUT_OF_SCOPE > 0 && counts.EXCLUDED_BY_RULE === 0) {
    return { status: "OUT_OF_SCOPE", reason: "every source record is outside the target's scope" };
  }
  if (counts.NOT_YET_SYNCED > 0) {
    return {
      status: "PENDING",
      reason: `${counts.NOT_YET_SYNCED} record(s) newer than the target's last completed run`,
    };
  }
  return { status: "PASS", reason: "" };
}
