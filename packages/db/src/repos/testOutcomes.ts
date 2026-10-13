/**
 * A model's latest tests, as the run ledger recorded them (ADR 0129).
 *
 * "Latest" is anchored on the rows a reader is served: the newest transform run in which the
 * model BUILT successfully, because that build wrote the table every question reads, and its
 * tests are the ones that judged those rows. A later run in which the model failed to build
 * left that table in place, so it does not move the anchor; a run that only built a parent
 * never touches the model's rows at all.
 *
 * A test belongs to a model by `ops.run_step.model`, which the worker writes from dbt's
 * manifest (`testedModels`, `560_run_step_model.sql`) -- never by reading the test's name.
 * Steps recorded before that column existed carry `NULL` and belong to no model, which reads
 * as no record rather than as a pass.
 *
 * Rows only. What counts as failing, passing or unknown is the caller's to decide.
 */

import type { SqlExecutor } from "../executor.ts";

/** One test of a model's latest successful build, as dbt reported it. */
export interface TestStepRecord {
  readonly uniqueId: string;
  readonly name: string;
  /** dbt's own word: `pass`, `fail`, `warn`, `error`, `skipped`. */
  readonly status: string;
  /** How many rows it found, or `null` when dbt reported none. */
  readonly failures: number | null;
}

/** The build that wrote a model's current rows, and the tests that build ran on them. */
export interface ModelTestRecord {
  readonly runId: string;
  readonly endedAt: string | null;
  /** Empty when that build ran no test attributed to the model. */
  readonly tests: readonly TestStepRecord[];
}

/**
 * Each model's latest successful build and the tests attributed to it in that run, keyed by
 * model name, for every model of the tenant or for `names` alone. A model that never built
 * successfully is absent.
 */
export async function latestTestsPerModel(
  exec: SqlExecutor,
  tenantId: string,
  names: readonly string[] | null = null,
): Promise<Map<string, ModelTestRecord>> {
  const { rows } = await exec.query<{
    model: string;
    run_id: string;
    ended_at: Date | string | null;
    unique_id: string | null;
    name: string | null;
    status: string | null;
    failures: number | null;
  }>(
    `WITH built AS (
       SELECT DISTINCT ON (s.name) s.name AS model, s.run_id, r.ended_at
       FROM ops.run_step s JOIN ops.run r ON r.id = s.run_id
       WHERE r.tenant_id = $1 AND r.verb = 'transform'
         AND s.kind = 'model' AND s.status = 'success'
         AND ($2::text[] IS NULL OR s.name = ANY($2::text[]))
       ORDER BY s.name, r.started_at DESC, r.id DESC
     )
     SELECT b.model, b.run_id, b.ended_at, t.unique_id, t.name, t.status, t.failures
     FROM built b
     LEFT JOIN ops.run_step t ON t.run_id = b.run_id AND t.kind = 'test' AND t.model = b.model
     ORDER BY b.model, t.name, t.unique_id`,
    [tenantId, names === null ? null : [...names]],
  );
  const byModel = new Map<
    string,
    { runId: string; endedAt: string | null; tests: TestStepRecord[] }
  >();
  for (const r of rows) {
    let record = byModel.get(r.model);
    if (record === undefined) {
      record = {
        runId: r.run_id,
        endedAt: r.ended_at === null ? null : new Date(r.ended_at).toISOString(),
        tests: [],
      };
      byModel.set(r.model, record);
    }
    if (r.unique_id !== null && r.name !== null && r.status !== null) {
      record.tests.push({
        uniqueId: r.unique_id,
        name: r.name,
        status: r.status,
        failures: r.failures,
      });
    }
  }
  return byModel;
}
