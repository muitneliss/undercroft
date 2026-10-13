/**
 * What a model's latest tests say about the rows it is serving: passing, failing, or unknown
 * (issue 456, ADR 0129).
 *
 * Read wherever a figure is read -- `models.list` and `models.get`, a Reports answer's
 * qualifiers (`answerQualifiers.ts`), and the guard in front of a build that would copy a
 * parent's rows (`modelBuild.ts`) -- so the three cannot word one ledger three ways.
 *
 * The record is the ledger's (`latestTestsPerModel`): the model's latest SUCCESSFUL build and
 * the tests attributed to it in that run. From it:
 *
 * - `failing` when any of those tests failed (`fail`) or could not run (`error`): the same two
 *   statuses the run's own `testsFailed` counts, so a model and its run never disagree.
 * - `passing` when at least one test passed or warned and none failed. A `warn` is a test whose
 *   author chose to be told rather than stopped; it does not fail the model, and it is counted
 *   in `warnings` and listed, so it is visible rather than swallowed.
 * - `unknown` otherwise: the model never built, its build ran no test attributed to it (it has
 *   none, or every one was skipped), or its steps predate the attribution. NEVER passing: the
 *   absence of a failing test is not a passing one (CLAUDE.md rule 2).
 */

import type { SqlExecutor } from "@undercroft/db";
import { latestTestsPerModel, type ModelTestRecord } from "@undercroft/db/repos";

export type TestStateName = "passing" | "failing" | "unknown";

/** One test of a model's latest build that did not simply pass. */
export interface TestStepView {
  readonly name: string;
  readonly uniqueId: string;
  readonly status: string;
  /** Rows it found, or `null` when dbt reported none (a test that errored found nothing). */
  readonly failures: number | null;
}

/** A model's test state as a list shows it: the word, the counts and the run. */
export interface TestSummary {
  readonly state: TestStateName;
  /** How many tests failed or errored; `null` when the state is unknown -- not `0`. */
  readonly failing: number | null;
  /** How many tests warned; `null` when the state is unknown. */
  readonly warnings: number | null;
  /** The build whose tests these are; `null` when the model never built successfully. */
  readonly runId: string | null;
  readonly endedAt: string | null;
}

/** A model's test state in full, as `get` shows it: which tests failed and which warned. */
export interface TestDetail extends TestSummary {
  readonly failingTests: readonly TestStepView[];
  readonly warningTests: readonly TestStepView[];
}

/** dbt's statuses for a test that did not pass: it found rows, or it could not run at all. */
const FAILED = new Set(["fail", "error"]);
const WARNED = "warn";
const PASSED = "pass";

function viewOf(test: ModelTestRecord["tests"][number]): TestStepView {
  return { name: test.name, uniqueId: test.uniqueId, status: test.status, failures: test.failures };
}

/** The state one ledger record comes to; no record at all is a model that never built. */
export function testStateOf(record: ModelTestRecord | undefined): TestDetail {
  if (record === undefined) {
    return {
      state: "unknown",
      failing: null,
      warnings: null,
      runId: null,
      endedAt: null,
      failingTests: [],
      warningTests: [],
    };
  }
  const failingTests = record.tests.filter((t) => FAILED.has(t.status)).map(viewOf);
  const warningTests = record.tests.filter((t) => t.status === WARNED).map(viewOf);
  const judged = record.tests.some(
    (t) => FAILED.has(t.status) || t.status === WARNED || t.status === PASSED,
  );
  const state: TestStateName = failingTests.length > 0 ? "failing" : judged ? "passing" : "unknown";
  return {
    state,
    failing: state === "unknown" ? null : failingTests.length,
    warnings: state === "unknown" ? null : warningTests.length,
    runId: record.runId,
    endedAt: record.endedAt,
    failingTests,
    warningTests,
  };
}

/** The summary of a state: what a list carries per model, without the tests themselves. */
export function summaryOf(detail: TestDetail): TestSummary {
  return {
    state: detail.state,
    failing: detail.failing,
    warnings: detail.warnings,
    runId: detail.runId,
    endedAt: detail.endedAt,
  };
}

/**
 * The test state of every model `names` lists, or of every model of the tenant, in one read.
 * A name with no record answers `unknown` -- including a name that is no model at all, such as a
 * relation a query read that no model builds.
 */
export async function readTestStates(
  exec: SqlExecutor,
  tenantId: string,
  names: readonly string[] | null = null,
): Promise<(name: string) => TestDetail> {
  const records = await latestTestsPerModel(exec, tenantId, names);
  return (name) => testStateOf(records.get(name));
}
