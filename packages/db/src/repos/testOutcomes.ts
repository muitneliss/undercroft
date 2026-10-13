/**
 * A model's latest tests, as the run ledger recorded them (ADR 0129), and whether a newer build
 * of it was held back (ADR 0131).
 *
 * "Latest" is anchored on the rows a reader is served: the newest transform run whose build of
 * the model was PUBLISHED -- promoted from staging into analytics (`ops.run_step.promoted`) --
 * because that build wrote the table every question reads, and its tests are the ones that
 * judged those rows. A step recorded before write-audit-publish carries `promoted` NULL, and
 * then a successful build was the published one, as it was at the time. A later run that held
 * the model back left that table in place, so it does not move the anchor; it is reported
 * beside it as `unpublished`, the build that is failing now. A run that only built a parent never
 * touches the model's rows at all.
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

/** A build of a model that was held back in staging rather than published (ADR 0131). */
export interface UnpublishedBuild {
  readonly runId: string;
  readonly endedAt: string | null;
}

/** The build that wrote a model's current rows, and the tests that build ran on them. */
export interface ModelTestRecord {
  /** `null` when no build of the model was ever published: nothing of it is served. */
  readonly runId: string | null;
  readonly endedAt: string | null;
  /** Empty when that build ran no test attributed to the model, or there is no such build. */
  readonly tests: readonly TestStepRecord[];
  /** The newest build since the published one that was held back, or `null` when none was. */
  readonly unpublished: UnpublishedBuild | null;
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/**
 * Each model's published build and the tests attributed to it in that run, with the newest held
 * build since, keyed by model name, for every model of the tenant or for `names` alone. A model
 * neither published nor held back -- never built -- is absent.
 */
export async function latestTestsPerModel(
  exec: SqlExecutor,
  tenantId: string,
  names: readonly string[] | null = null,
): Promise<Map<string, ModelTestRecord>> {
  const { rows } = await exec.query<{
    model: string;
    run_id: string | null;
    ended_at: Date | string | null;
    held_run_id: string | null;
    held_ended_at: Date | string | null;
    unique_id: string | null;
    name: string | null;
    status: string | null;
    failures: number | null;
  }>(
    `WITH steps AS (
       SELECT s.name, s.run_id, s.status, s.promoted, r.started_at, r.ended_at
       FROM ops.run_step s JOIN ops.run r ON r.id = s.run_id
       WHERE r.tenant_id = $1 AND r.verb = 'transform' AND s.kind = 'model'
         AND ($2::text[] IS NULL OR s.name = ANY($2::text[]))
     ),
     served AS (
       SELECT DISTINCT ON (name) name AS model, run_id, started_at, ended_at
       FROM steps
       WHERE promoted OR (promoted IS NULL AND status = 'success')
       ORDER BY name, started_at DESC, run_id DESC
     ),
     held AS (
       SELECT DISTINCT ON (name) name AS model, run_id, started_at, ended_at
       FROM steps
       WHERE promoted = false
       ORDER BY name, started_at DESC, run_id DESC
     ),
     models AS (
       SELECT COALESCE(sv.model, h.model) AS model,
              sv.run_id, sv.ended_at,
              CASE WHEN sv.model IS NULL OR h.started_at > sv.started_at THEN h.run_id END
                AS held_run_id,
              CASE WHEN sv.model IS NULL OR h.started_at > sv.started_at THEN h.ended_at END
                AS held_ended_at
       FROM served sv FULL JOIN held h ON h.model = sv.model
     )
     SELECT m.model, m.run_id, m.ended_at, m.held_run_id, m.held_ended_at,
            t.unique_id, t.name, t.status, t.failures
     FROM models m
     LEFT JOIN ops.run_step t ON t.run_id = m.run_id AND t.kind = 'test' AND t.model = m.model
     ORDER BY m.model, t.name, t.unique_id`,
    [tenantId, names === null ? null : [...names]],
  );
  const byModel = new Map<
    string,
    {
      runId: string | null;
      endedAt: string | null;
      tests: TestStepRecord[];
      unpublished: UnpublishedBuild | null;
    }
  >();
  for (const r of rows) {
    let record = byModel.get(r.model);
    if (record === undefined) {
      record = {
        runId: r.run_id,
        endedAt: isoOrNull(r.ended_at),
        tests: [],
        unpublished:
          r.held_run_id === null
            ? null
            : { runId: r.held_run_id, endedAt: isoOrNull(r.held_ended_at) },
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
