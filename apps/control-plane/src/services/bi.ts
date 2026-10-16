/**
 * Reports, as the control plane serves them: questions and dashboards saved per tenant,
 * and a question answered -- compiled, its parameters bound, run through the worker as the
 * tenant's read-only login.
 *
 * Nothing here touches the tenant's data. The control plane holds no tenant login and
 * cannot mint one (ADR 0016, extended to data): it compiles the definition to SQL with the
 * contract's one compiler, binds the dashboard's values as literals, and asks the worker.
 * The rows come back and are relayed; none are stored.
 *
 * A definition is validated on the way OUT of the database as well as in. A row written
 * by an older contract is refused with a value the handler can word, rather than drawn
 * half-right. The questions themselves are kept by `biQuestions.ts`.
 *
 * WHAT A READER REACHES (ADR 0142). Two separate things, checked in two places. Which REPORTS a
 * person may open is the control plane's to filter -- a question or dashboard outside their reach
 * answers as if it did not exist -- and which MODELS their SQL may read is Postgres's: a reader
 * who reaches fewer than every model is answered by the customer's scope login for exactly those
 * (`scopeOf`), which refuses any other table in its own words. Opening a report does not widen
 * what it reads: a question over `fct_sales`, opened by someone who does not reach `fct_sales`,
 * is refused by the database rather than answered past their reach.
 */

import {
  bindParams,
  compile,
  type DashboardFilter,
  DashboardFilters,
  type DashboardLayout,
  DashboardLayout as DashboardLayoutShape,
  DEFAULT_QUERY_ROWS,
  ParamMissing,
  type QueryParams,
  type QueryScope,
  type QuestionDefinition,
} from "@undercroft/contracts";
import { type Reach, reachesReport } from "@undercroft/contracts/access";
import type { ModelLimit } from "@undercroft/contracts/rowRules";
import type { SqlExecutor } from "@undercroft/db";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import {
  deleteDashboard,
  getDashboard,
  insertDashboard,
  listDashboards,
  updateDashboard,
} from "../repos/biDashboards.ts";
import {
  type ColumnNotGranted,
  columnNotGranted,
  type NoPassingVersion,
  noPassingVersion,
  type QualifiedAnswer,
  qualify,
} from "./answerQualifiers.ts";
import { getQuestionView, reachWhatWasMade } from "./biQuestions.ts";
import { readSchema, type SchemaFilter, type SchemaOutcome } from "./tableSchema.ts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export interface DashboardView {
  readonly id: string;
  readonly name: string;
  readonly layout: DashboardLayout;
  readonly filters: DashboardFilter[];
  readonly updatedAt: string;
  readonly updatedBy: string;
  /**
   * The tiles' questions the reader may not open (ADR 0142), by id: their tiles are drawn as
   * "not granted" rather than left out, so a dashboard never looks complete with a figure
   * missing. Empty for a reader who reaches every question on it.
   */
  readonly ungranted: string[];
}

/**
 * The scope a reader's SQL runs under: `null` when they reach every model whole, and the BI login
 * reads for them; otherwise the models they reach and how much of each (ADR 0142, ADR 0143),
 * which the worker reads as the scope login for exactly those -- its tables, its columns, its
 * rows. An empty list is a real scope -- a login that reads no table.
 */
export function scopeOf(reach: Reach): QueryScope | null {
  return reach.models === "all"
    ? null
    : { models: [...reach.models], limits: scopeLimits(reach.limits ?? []) };
}

/** Limits as the wire carries them: the same values, in arrays of their own. */
export function scopeLimits(limits: readonly ModelLimit[]): QueryScope["limits"] {
  return limits.map((limit) => ({
    model: limit.model,
    rows:
      limit.rows === null
        ? null
        : limit.rows.map((rule) =>
            rule.map((condition) => ({ ...condition, values: [...condition.values] })),
          ),
    hidden: [...limit.hidden],
  }));
}

/** The analytics schema, narrowed to what `filter` names (`tableSchema.ts`); whole without one. */
export function schema(
  worker: WorkerClient,
  input: { tenantId: string; reach: Reach },
  filter: SchemaFilter = {},
): Promise<SchemaOutcome> {
  // As the reader's login sees it: a scope login's `information_schema` holds its tables alone.
  return readSchema(
    () => worker.readSchema({ tenantId: input.tenantId, scope: scopeOf(input.reach) }),
    filter,
  );
}

/** The SQL a definition compiles to, parameters unbound. What the builder shows beside itself. */
export function compileDefinition(definition: QuestionDefinition): string {
  return compile(definition);
}

export type AnswerOutcome =
  | WorkerOutcome<QualifiedAnswer>
  | { readonly ok: false; readonly reason: "param-missing"; readonly param: string }
  | { readonly ok: false; readonly reason: "question-not-found" }
  /** The query read a model whose first build was held back: nothing of it is published. */
  | ({ readonly ok: false; readonly reason: "no-passing-version" } & NoPassingVersion)
  /** The query named a column the reader's grants hide, or read one with `*` (ADR 0143). */
  | ({ readonly ok: false; readonly reason: "column-not-granted" } & ColumnNotGranted);

/**
 * Answer a definition with the dashboard's (or the URL's) values bound in.
 *
 * A parameter with no value is a refusal before anything is sent: a filter that silently
 * matched everything is the wrong answer that looks right. The rows come back whole, with a
 * qualifier for each table they were read from whose latest tests fail or are unknown
 * (`answerQualifiers.ts`, ADR 0129).
 */
export async function answer(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: {
    tenantId: string;
    definition: QuestionDefinition;
    params: QueryParams;
    limit?: number;
    reach: Reach;
  },
): Promise<AnswerOutcome> {
  let sql: string;
  try {
    sql = bindParams(compile(input.definition), input.params);
  } catch (error) {
    if (error instanceof ParamMissing) {
      return { ok: false, reason: "param-missing", param: error.param };
    }
    throw error;
  }
  const limit =
    input.limit ??
    (input.definition.kind === "visual" ? input.definition.limit : DEFAULT_QUERY_ROWS);
  const outcome = await worker.runQuery({
    tenantId: input.tenantId,
    sql,
    limit,
    scope: scopeOf(input.reach),
  });
  if (!outcome.ok) {
    if (outcome.reason !== "query-failed") {
      return outcome;
    }
    const hidden = columnNotGranted(outcome.message, input.reach);
    if (hidden !== null) {
      return { ok: false, reason: "column-not-granted", ...hidden };
    }
    const unpublished = await noPassingVersion(exec, input.tenantId, outcome.message);
    return unpublished === null
      ? outcome
      : { ok: false, reason: "no-passing-version", ...unpublished };
  }
  return { ok: true, value: await qualify(exec, input.tenantId, outcome.value, input.reach) };
}

/**
 * Answer a saved question. Any member who reaches it may: the question was saved for them. One
 * they do not reach is not found, as if it did not exist.
 */
export async function answerQuestion(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; questionId: string; params: QueryParams; reach: Reach },
): Promise<AnswerOutcome> {
  const question = await getQuestionView(exec, input.tenantId, input.questionId, input.reach);
  if (question === null) {
    return { ok: false, reason: "question-not-found" };
  }
  return answer(exec, worker, {
    tenantId: input.tenantId,
    definition: question.definition,
    params: input.params,
    reach: input.reach,
  });
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; reason: "not-found" };

// -- dashboards ---------------------------------------------------------------------

function dashboardView(
  row: {
    id: string;
    name: string;
    layout: unknown;
    filters: unknown;
    updatedAt: string;
    updatedBy: string;
  },
  reach: Reach,
): DashboardView {
  const layout = DashboardLayoutShape.parse(row.layout);
  const questions = [...new Set(layout.tiles.map((tile) => tile.questionId))];
  return {
    id: row.id,
    name: row.name,
    layout,
    filters: DashboardFilters.parse(row.filters),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    ungranted: questions.filter((questionId) => !reachesReport(reach, "question", questionId)),
  };
}

/** The dashboards the reader reaches, each with the tiles they may not open named. */
export async function listDashboardViews(
  exec: SqlExecutor,
  tenantId: string,
  reach: Reach,
): Promise<DashboardView[]> {
  return (await listDashboards(exec, tenantId))
    .filter((row) => reachesReport(reach, "dashboard", row.id))
    .map((row) => dashboardView(row, reach));
}

/** One dashboard, or `null` -- for one the reader does not reach as for one that does not exist. */
export async function getDashboardView(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
  reach: Reach,
): Promise<DashboardView | null> {
  if (!reachesReport(reach, "dashboard", id)) {
    return null;
  }
  const row = await getDashboard(exec, tenantId, id);
  return row === null ? null : dashboardView(row, reach);
}

export async function saveDashboard(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    id?: string;
    name: string;
    layout: DashboardLayout;
    filters: DashboardFilter[];
    actor: Actor;
    actorId: string;
    reach: Reach;
  },
): Promise<SaveOutcome> {
  const fields = {
    name: input.name,
    layout: input.layout,
    filters: input.filters,
    actorId: input.actorId,
  };
  let { id } = input;
  if (id === undefined) {
    id = await insertDashboard(exec, input.tenantId, fields);
    await reachWhatWasMade(exec, { ...input, kind: "dashboard", id });
  } else if (
    !(
      reachesReport(input.reach, "dashboard", id) &&
      (await updateDashboard(exec, input.tenantId, { id, ...fields }))
    )
  ) {
    return { ok: false, reason: "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "bi.dashboards.save",
    detail: JSON.stringify({ id, name: input.name, tiles: input.layout.tiles.length }),
  });
  return { ok: true, id };
}

/** Delete a dashboard the reader reaches; one they do not reach is not found. */
export async function removeDashboard(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: Actor; reach: Reach },
): Promise<boolean> {
  const removed =
    reachesReport(input.reach, "dashboard", input.id) &&
    (await deleteDashboard(exec, input.tenantId, input.id));
  if (removed) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "bi.dashboards.delete",
      detail: JSON.stringify({ id: input.id }),
    });
  }
  return removed;
}
