/**
 * A tenant's saved questions: listed as summaries, read whole, saved and deleted. Split from
 * `bi.ts`, which answers them and keeps the dashboards, when the list learned to answer
 * summaries (issue 444, ADR 0127).
 *
 * A definition is validated on the way OUT of the database as well as in, on the list as on
 * `get`: a row written by an older contract is refused with a value the handler can word,
 * rather than drawn half-right.
 */

import {
  type ChartConfig,
  ChartConfig as ChartConfigShape,
  type ChartType,
  QuestionDefinition,
} from "@undercroft/contracts";
import type { SqlExecutor } from "@undercroft/db";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import {
  deleteQuestion,
  getQuestion,
  insertQuestion,
  listQuestions,
  type QuestionRow,
  updateQuestion,
} from "../repos/biQuestions.ts";
import type { SaveOutcome } from "./bi.ts";
import {
  type Listing,
  listed,
  mapNarrowed,
  narrowByName,
  type PagedListRequest,
} from "./listFilter.ts";
import { DEFAULT_PAGE } from "./listPage.ts";

/**
 * The page a reader gets who asks the definitions and sends a cursor and no limit: 32 questions
 * with their SQL were 59 KB (issue 444), at the edge of what an MCP answer carries (ADR 0122),
 * so a page of 50 of them would be cut by size rather than arrive whole.
 */
const DEFAULT_PAGE_WITH_DEFINITIONS = 20;

/** What a reader chooses a question by, and no SQL: what `bi.questions.list` answers. */
export interface QuestionSummary {
  readonly id: string;
  readonly name: string;
  /** The definition's kind: built in the builder (`visual`) or written as `sql`. */
  readonly kind: QuestionDefinition["kind"];
  readonly chartType: ChartType;
  readonly updatedAt: string;
  readonly updatedBy: string;
  /**
   * Hex SHA-256 of the stored definition as Postgres prints its `jsonb`. Compare it with one
   * this platform gave before -- a client cannot recompute it from its own JSON, because
   * Postgres orders the keys and spaces the text its own way (ADR 0127).
   */
  readonly definitionSha256: string;
}

/** A question on the list: its summary, and its definition or chart only when asked. */
export interface QuestionItem extends QuestionSummary {
  readonly definition?: QuestionDefinition;
  readonly chart?: ChartConfig;
}

/** One question in full, as `bi.questions.get` answers it. */
export interface QuestionView extends QuestionSummary {
  readonly definition: QuestionDefinition;
  readonly chart: ChartConfig;
}

/** What `bi.questions.list` adds to each question beyond its summary, each in full. */
export type QuestionInclude = "definition" | "chart";

function questionView(row: QuestionRow): QuestionView {
  const definition = QuestionDefinition.parse(row.definition);
  const chart = ChartConfigShape.parse(row.chart);
  return {
    id: row.id,
    name: row.name,
    kind: definition.kind,
    chartType: chart.type,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    definitionSha256: row.definitionSha256,
    definition,
    chart,
  };
}

/** A question with only the parts `include` names beyond its summary. */
function questionItem(view: QuestionView, include: readonly QuestionInclude[]): QuestionItem {
  const { definition, chart, ...summary } = view;
  return {
    ...summary,
    ...(include.includes("definition") ? { definition } : {}),
    ...(include.includes("chart") ? { chart } : {}),
  };
}

/**
 * The tenant's questions, narrowed by `filter` (`listFilter.ts`; names need not be unique, and a
 * name admits every question carrying it) and paged when asked. Summaries unless `include` names
 * more: 32 questions' SQL was 59 KB of a 69 KB list that a reader asked of only to choose one
 * (issue 444). Every row is still parsed, so a row an older contract wrote is refused on the list
 * as on `get`.
 *
 * A page is keyed by id, never by name, which two questions may share: `listQuestions` reads
 * them `ORDER BY name, id`, so the id places a question exactly in that order.
 */
export async function listQuestionViews(
  exec: SqlExecutor,
  tenantId: string,
  request: PagedListRequest<QuestionInclude> = {},
): Promise<Listing<QuestionItem>> {
  const views = (await listQuestions(exec, tenantId)).map(questionView);
  const include = request.include ?? [];
  return listed(
    mapNarrowed(
      narrowByName(views, (view) => view.name, request),
      (view) => questionItem(view, include),
    ),
    (question) => question.id,
    request,
    include.includes("definition") ? DEFAULT_PAGE_WITH_DEFINITIONS : DEFAULT_PAGE,
  );
}

export async function getQuestionView(
  exec: SqlExecutor,
  tenantId: string,
  id: string,
): Promise<QuestionView | null> {
  const row = await getQuestion(exec, tenantId, id);
  return row === null ? null : questionView(row);
}

/** Store a question: a new one without an id, an existing one with. Executes nothing. */
export async function saveQuestion(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    id?: string;
    name: string;
    definition: QuestionDefinition;
    chart: ChartConfig;
    actor: Actor;
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
    action: "bi.questions.save",
    detail: JSON.stringify({ id, name: input.name, kind: input.definition.kind }),
  });
  return { ok: true, id };
}

export async function removeQuestion(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; actor: Actor },
): Promise<boolean> {
  const removed = await deleteQuestion(exec, input.tenantId, input.id);
  if (removed) {
    await recordAudit(exec, {
      tenantId: input.tenantId,
      actor: input.actor,
      action: "bi.questions.delete",
      detail: JSON.stringify({ id: input.id }),
    });
  }
  return removed;
}
