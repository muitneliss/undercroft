/**
 * Exports: every row of a report's answer or of a model's table, handed out as a link to a CSV
 * file (ADR 0111).
 *
 * Asking for one decides the SQL -- a saved question's or a definition's, compiled and bound with
 * the contract's one compiler, or a model's whole table -- and stores it for the person who asked,
 * for fifteen minutes. Downloading it reads that row back and has the worker stream the rows,
 * as the tenant's read-only login, exactly as an answer is run. Nothing here touches a row of
 * the tenant's data: the control plane compiles and relays, as `bi.ts` says of an answer.
 *
 * A builder question exports what it answers, its own LIMIT included; the whole of a table is
 * its model, or SQL that says so. An export is the answer, not a different question.
 *
 * The audit row names the export, its kind and what it was of, never the SQL: the trail is for
 * "who took what", and an export is a taking.
 *
 * An export reads under its asker's reach (ADR 0142): a question or a model they do not reach is
 * not found, and the rows are read as the scope login for the models they reached when they
 * asked -- stored with the SQL -- narrowed to what they still reach when they download it.
 * Reach given in between does not widen a file asked for before it; reach taken away narrows it.
 */

import {
  bindParams,
  compile,
  csvFileName,
  ParamMissing,
  type QueryParams,
  type QueryScope,
  type QuestionDefinition,
  quoteIdent,
} from "@undercroft/contracts";
import { type Reach, reachesModel } from "@undercroft/contracts/access";
import type { SqlExecutor } from "@undercroft/db";
import { getModel } from "@undercroft/db/repos";

import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import {
  type ExportKind,
  type ExportRow,
  findLiveExport,
  insertExport,
} from "../repos/biExports.ts";
import { scopeOf } from "./bi.ts";
import { getQuestionView } from "./biQuestions.ts";

export type { ExportKind, ExportRow } from "../repos/biExports.ts";

/** How long an export's link answers. A person opens it now, or asks again. */
export const EXPORT_MINUTES = 15;

/** What an export is of. */
export type ExportSource =
  | { readonly kind: "question"; readonly questionId: string }
  | { readonly kind: "definition"; readonly definition: QuestionDefinition }
  | { readonly kind: "model"; readonly model: string };

export type CreateOutcome =
  | { readonly ok: true; readonly export: ExportRow }
  | { readonly ok: false; readonly reason: "param-missing"; readonly param: string }
  | { readonly ok: false; readonly reason: "question-not-found" | "model-not-found" };

type Compiled =
  | { readonly ok: true; readonly sql: string; readonly name: string | null }
  | Exclude<CreateOutcome, { ok: true }>;

function bound(definition: QuestionDefinition, params: QueryParams, name: string | null): Compiled {
  try {
    return { ok: true, sql: bindParams(compile(definition), params), name };
  } catch (error) {
    if (error instanceof ParamMissing) {
      return { ok: false, reason: "param-missing", param: error.param };
    }
    throw error;
  }
}

/** The SQL an export runs, and the name its file takes; `null` names nothing (a definition). */
async function compiled(
  exec: SqlExecutor,
  asked: {
    readonly tenantId: string;
    readonly source: ExportSource;
    readonly params: QueryParams;
    readonly reach: Reach;
  },
): Promise<Compiled> {
  const { tenantId, source, params, reach } = asked;
  switch (source.kind) {
    case "question": {
      const question = await getQuestionView(exec, tenantId, source.questionId, reach);
      return question === null
        ? { ok: false, reason: "question-not-found" }
        : bound(question.definition, params, question.name);
    }
    case "definition":
      return bound(source.definition, params, null);
    case "model": {
      // The model's table as its last build left it, under the tenant's own search path. A
      // model never built answers "relation does not exist" at the download, in Postgres's words.
      const model = reachesModel(reach, source.model)
        ? await getModel(exec, tenantId, source.model)
        : null;
      return model === null
        ? { ok: false, reason: "model-not-found" }
        : { ok: true, sql: `SELECT * FROM ${quoteIdent(model.name)}`, name: model.name };
    }
    default: {
      const exhaustive: never = source;
      throw new Error(`unhandled export source ${String(exhaustive)}`);
    }
  }
}

/** What the audit row says an export was of: the question's id or the model's name. */
function ofWhat(source: ExportSource): string | null {
  switch (source.kind) {
    case "question":
      return source.questionId;
    case "model":
      return source.model;
    default:
      return null;
  }
}

/**
 * Ask for an export. Who may is the caller's to decide: a saved question is any member's, like
 * its answer; anything else is SQL an author chooses, which is a member's.
 */
export async function createExport(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    userId: string;
    actor: Actor;
    source: ExportSource;
    params: QueryParams;
    /** The file's name when what is exported has none of its own, in the caller's language. */
    unnamed: string;
    reach: Reach;
  },
): Promise<CreateOutcome> {
  const sql = await compiled(exec, input);
  if (!sql.ok) {
    return sql;
  }
  const row = await insertExport(exec, {
    tenantId: input.tenantId,
    userId: input.userId,
    kind: input.source.kind,
    scopeModels: scopeOf(input.reach)?.models ?? null,
    sql: sql.sql,
    fileName: csvFileName(sql.name ?? input.unnamed, input.unnamed),
    minutes: EXPORT_MINUTES,
  });
  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "bi.exports.create",
    detail: JSON.stringify({ id: row.id, kind: input.source.kind, of: ofWhat(input.source) }),
  });
  return { ok: true, export: row };
}

/** An export as its download runs it: the row, and the scope its rows are read under. */
export interface OpenedExport extends Omit<ExportRow, "scopeModels"> {
  /** `null` for the BI login; else the models both asked under and still reached (ADR 0142). */
  readonly scope: QueryScope | null;
}

/**
 * The scope a download runs under: the models the asker reached when they asked, and still reach
 * now -- the narrower of the two, so neither a grant since nor one taken away since makes the
 * file read more than its asker may read at the moment the rows are taken.
 */
function narrowerOf(asked: readonly string[] | null, now: QueryScope | null): QueryScope | null {
  if (asked === null) {
    return now;
  }
  return now === null
    ? { models: [...asked] }
    : { models: asked.filter((m) => now.models.includes(m)) };
}

/** The export `userId` asked for in `tenantId`, while it lives; `null` for anyone else's. */
export async function openExport(
  exec: SqlExecutor,
  input: { tenantId: string; id: string; userId: string; reach: Reach },
): Promise<OpenedExport | null> {
  const row = await findLiveExport(exec, input);
  if (row === null) {
    return null;
  }
  const { scopeModels, ...rest } = row;
  return { ...rest, scope: narrowerOf(scopeModels, scopeOf(input.reach)) };
}

/** Whether exporting `kind` needs `reports:author`, rather than only membership. */
export function exportNeedsAuthor(kind: ExportKind): boolean {
  return kind !== "question";
}
