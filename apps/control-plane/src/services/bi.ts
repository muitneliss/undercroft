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
 * half-right.
 */

// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. That ordering carries meaning; the rule's preferred one does not.

import {
  bindParams,
  type ChartConfig,
  compile,
  type DashboardFilter,
  DashboardFilters,
  type DashboardLayout,
  DashboardLayout as DashboardLayoutShape,
  ChartConfig as ChartConfigShape,
  DEFAULT_QUERY_ROWS,
  ParamMissing,
  type QueryParams,
  QuestionDefinition,
  type RunQueryRequest,
  type SchemaResponse,
  type TableResult,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { record as recordAudit } from "../repos/auditLog.ts";
import {
  deleteDashboard,
  getDashboard,
  insertDashboard,
  listDashboards,
  updateDashboard,
} from "../repos/biDashboards.ts";
import {
  deleteQuestion,
  getQuestion,
  insertQuestion,
  listQuestions,
  updateQuestion,
} from "../repos/biQuestions.ts";
import type { WorkerClient, WorkerOutcome } from "./workerClient.ts";

export interface QuestionView {
  readonly id: string;
  readonly name: string;
  readonly definition: QuestionDefinition;
  readonly chart: ChartConfig;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

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

export function schema(
  worker: WorkerClient,
  input: { tenantId: string },
): Promise<WorkerOutcome<SchemaResponse>> {
  return worker.readSchema(input);
}

/** The SQL a definition compiles to, parameters unbound. What the builder shows beside itself. */
export function compileDefinition(definition: QuestionDefinition): string {
  return compile(definition);
}

export type AnswerOutcome =
  | WorkerOutcome<TableResult>
  | { readonly ok: false; readonly reason: "param-missing"; readonly param: string }
  | { readonly ok: false; readonly reason: "question-not-found" };

/**
 * Answer a definition with the dashboard's (or the URL's) values bound in.
 *
 * A parameter with no value is a refusal before anything is sent: a filter that silently
 * matched everything is the wrong answer that looks right.
 */
export async function answer(
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
  return await worker.runQuery({ tenantId: input.tenantId, sql, limit });
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
  return answer(worker, {
    tenantId: input.tenantId,
    definition: question.definition,
    params: input.params,
  });
}

// -- questions ----------------------------------------------------------------------

function questionView(row: {
  id: string;
  name: string;
  definition: unknown;
  chart: unknown;
  updatedAt: string;
  updatedBy: string;
}): QuestionView {
  return {
    id: row.id,
    name: row.name,
    definition: QuestionDefinition.parse(row.definition),
    chart: ChartConfigShape.parse(row.chart),
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export async function listQuestionViews(
  exec: SqlExecutor,
  tenantId: string,
): Promise<QuestionView[]> {
  return (await listQuestions(exec, tenantId)).map(questionView);
}

export async function getQuestionView(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<QuestionView | null> {
  const row = await getQuestion(exec, tenantId, id);
  return row === null ? null : questionView(row);
}

export type SaveOutcome = { ok: true; id: string } | { ok: false; reason: "not-found" };

/** Store a question: a new one without an id, an existing one with. Executes nothing. */
export async function saveQuestion(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    id?: string;
    name: string;
    definition: QuestionDefinition;
    chart: ChartConfig;
    actor: string;
    actorId: string;
  },
): Promise<SaveOutcome> {
  const fields = {
    name: input.name,
    definition: input.definition,
    chart: input.chart,
    actorId: input.actorId,
  };
  let { id } = input;
  if (id === undefined) {
    id = await insertQuestion(exec, input.tenantId, fields);
  } else if (!(await updateQuestion(exec, input.tenantId, { id, ...fields }))) {
    return { ok: false, reason: "not-found" };
  }
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "bi.question.save",
    detail: JSON.stringify({ id, name: input.name, kind: input.definition.kind }),
  });
  return { ok: true, id };
}

export async function removeQuestion(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: string },
): Promise<boolean> {
  const removed = await deleteQuestion(exec, input.tenantId, input.id);
  if (removed) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "bi.question.delete",
      detail: JSON.stringify({ id: input.id }),
    });
  }
  return removed;
}

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
    actor: string;
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
    action: "bi.dashboard.save",
    detail: JSON.stringify({ id, name: input.name, tiles: input.layout.tiles.length }),
  });
  return { ok: true, id };
}

export async function removeDashboard(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: string },
): Promise<boolean> {
  const removed = await deleteDashboard(exec, input.tenantId, input.id);
  if (removed) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "bi.dashboard.delete",
      detail: JSON.stringify({ id: input.id }),
    });
  }
  return removed;
}
