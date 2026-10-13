/**
 * What a Reports answer must say about the tables it read: which of them are served with
 * failing tests, or with none on record (issue 456, ADR 0129).
 *
 * A model whose tests fail keeps the rows it just built -- dbt has no rollback -- and the BI
 * login reads them like any other. Withholding them would hide a figure a person may still
 * need; serving them bare presents a refused row as a fact (CLAUDE.md rule 2, ADR 0090). So the
 * rows are served whole and the answer carries a qualifier per such table, naming its state
 * and the run, for every surface that shows the figure to word.
 *
 * Which tables a query read is never guessed from its SQL: the worker reports the relations of
 * Postgres's own plan of the statement it ran (`runFramedWithRelations`), as the BI login. The
 * BI login cannot read `ops`, so the state is joined in here, from the ledger, by the control
 * plane. A table no model builds -- one a model built and was since dropped from the project,
 * say -- has no test record and is qualified as unknown.
 */

import type { QueryAnswer, TableResult } from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { readTestStates, type TestStateName } from "./testState.ts";

/** One table the answer read whose latest tests are not passing. */
export interface AnswerQualifier {
  /** The table's name in the tenant's analytics schema: the model that builds it. */
  readonly table: string;
  readonly state: Exclude<TestStateName, "passing">;
  /** How many tests failed; `null` when unknown. */
  readonly failing: number | null;
  /** The failing tests' names, empty when unknown. */
  readonly failingTests: readonly string[];
  /** The build whose tests these are, and when it ended; `null` when the table never built. */
  readonly runId: string | null;
  readonly endedAt: string | null;
}

/**
 * An answer as Reports serves it: the rows, whole, and the qualifiers. `qualifiers` is `null`
 * when which tables were read is not known -- a worker older than the plan read, or a plan it
 * could not read -- which a screen words as "not known", never as "nothing to say".
 */
export interface QualifiedAnswer extends TableResult {
  readonly qualifiers: readonly AnswerQualifier[] | null;
}

/** The worker's answer with a qualifier for each table it read whose tests are not passing. */
export async function qualify(
  exec: SqlExecutor,
  tenantId: string,
  answer: QueryAnswer,
): Promise<QualifiedAnswer> {
  const { relations, ...table } = answer;
  if (relations === null || relations === undefined) {
    return { ...table, qualifiers: null };
  }
  if (relations.length === 0) {
    return { ...table, qualifiers: [] };
  }
  const testsOf = await readTestStates(exec, tenantId, relations);
  const qualifiers: AnswerQualifier[] = [];
  for (const name of relations) {
    const tests = testsOf(name);
    if (tests.state === "passing") {
      continue;
    }
    qualifiers.push({
      table: name,
      state: tests.state,
      failing: tests.failing,
      failingTests: tests.failingTests.map((test) => test.name),
      runId: tests.runId,
      endedAt: tests.endedAt,
    });
  }
  return { ...table, qualifiers };
}
