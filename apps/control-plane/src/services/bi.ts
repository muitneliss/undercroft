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
  type QuestionDefinition,
  type RunQueryRequest,
  type TableResult,
} from "@undercroft/contracts";
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
  type NoPassingVersion,
  noPassingVersion,
  type QualifiedAnswer,
  qualify,
} from "./answerQualifiers.ts";
import { getQuestionView } from "./biQuestions.ts";
import { readSchema, type SchemaFilter, type SchemaOutcome } from "./tableSchema.ts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export interface DashboardView {
  readonly id: string;
  readonly name: string;
  readonly layout: DashboardLayout;
  readonly filters: DashboardFilter[];
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export function run(
  worker: WorkerClient,
  input: RunQueryRequest,
): Promise<WorkerOutcome<TableResult>> {
  return worker.runQuery(input);
}

/** The analytics schema, narrowed to what `filter` names (`tableSchema.ts`); whole without one. */
export function schema(
  worker: WorkerClient,
  input: { tenantId: string },
  filter: SchemaFilter = {},
): Promise<SchemaOutcome> {
  return readSchema(() => worker.readSchema(input), filter);
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
  | ({ readonly ok: false; readonly reason: "no-passing-version" } & NoPassingVersion);

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
  input: { tenantId: string; definition: QuestionDefinition; params: QueryParams; limit?: number },
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
  const outcome = await worker.runQuery({ tenantId: input.tenantId, sql, limit });
  if (!outcome.ok) {
    const unpublished =
      outcome.reason === "query-failed"
        ? await noPassingVersion(exec, input.tenantId, outcome.message)
        : null;
    return unpublished === null
      ? outcome
      : { ok: false, reason: "no-passing-version", ...unpublished };
  }
  return { ok: true, value: await qualify(exec, input.tenantId, outcome.value) };
}

/** Answer a saved question. Any member of the tenant may: the question was saved for them. */
export async function answerQuestion(
  exec: SqlExecutor,
  worker: WorkerClient,
  input: { tenantId: string; questionId: string; params: QueryParams },
): Promise<AnswerOutcome> {
  const question = await getQuestionView(exec, input.tenantId, input.questionId);
  if (question === null) {
    return { ok: false, reason: "question-not-found" };
  }
  return answer(exec, worker, {
    tenantId: input.tenantId,
    definition: question.definition,
    params: input.params,
  });
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; reason: "not-found" };

// -- dashboards ---------------------------------------------------------------------

function dashboardView(row: {
  id: string;
  name: string;
  layout: unknown;
  filters: unknown;
  updatedAt: string;
  updatedBy: string;
}): DashboardView {
  return {
    id: row.id,
    name: row.name,
    layout: DashboardLayoutShape.parse(row.layout),
    filters: DashboardFilters.parse(row.filters),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function listDashboardViews(
  exec: SqlExecutor,
  tenantId: string,
): Promise<DashboardView[]> {
  return (await listDashboards(exec, tenantId)).map(dashboardView);
}

export async function getDashboardView(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<DashboardView | null> {
  const row = await getDashboard(exec, tenantId, id);
  return row === null ? null : dashboardView(row);
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
  } else if (!(await updateDashboard(exec, input.tenantId, { id, ...fields }))) {
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

export async function removeDashboard(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: Actor },
): Promise<boolean> {
  const removed = await deleteDashboard(exec, input.tenantId, input.id);
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
