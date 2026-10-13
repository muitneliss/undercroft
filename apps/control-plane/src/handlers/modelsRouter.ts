/**
 * The `models` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import {
  MAX_BUILD_SELECTORS,
  MAX_MODEL_SQL_BYTES,
  ModelName,
  ModelSelector,
  ModelTests,
} from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { formatWhen } from "../services/alertWording.ts";
import { type BuildHolder, buildModels } from "../services/modelBuild.ts";
import {
  REFERENCE_PARTS,
  type Reference,
  type ReferenceParts,
  reference,
  referenceParts,
} from "../services/modelReference.ts";
import * as models from "../services/models.ts";
import { revision } from "../services/revision.ts";
import { BUILD_DEADLINE_MS } from "../services/workerBuild.ts";
import { notRun } from "./answers.ts";
import { wordCheck } from "./checkWords.ts";
import { ANSWER_SECONDS } from "./holdOpen.ts";
import { StepQuery } from "./inputs.ts";
import { listedOrRefusal, NameFilterInput } from "./listInputs.ts";
import { actorOf, refusal, requireRole, router, tenantProcedure } from "./trpc.ts";

const MS_PER_SECOND = 1000;

/**
 * A build refused because one is already running: CONFLICT, with the holder's run and start as
 * facts an agent waits on (`runs.get` with `waitSeconds`) and in the sentence a person reads.
 * A holder the ledger no longer has -- it finished between the refusal and the read -- is not
 * named, and the sentence says only that a build was running.
 */
function buildHeld(locale: Locale, holder: BuildHolder | null): TRPCError {
  const t = messages(locale);
  if (holder === null) {
    return refusal("CONFLICT", t("error.buildInProgress"), {
      reason: "BUILD_IN_PROGRESS",
      runId: null,
      startedAt: null,
    });
  }
  return refusal(
    "CONFLICT",
    t("error.buildInProgressAs", {
      runId: holder.runId,
      startedAt: formatWhen(holder.startedAt, locale),
    }),
    { reason: "BUILD_IN_PROGRESS", runId: holder.runId, startedAt: holder.startedAt },
  );
}

/**
 * The longest lineage `name` worth reading: a model's name, or a source table as
 * `schema.table`. Generous, since a missing dependency is named as its author wrote it.
 */
const MAX_LINEAGE_NAME_CHARS = 255;

export const modelsRouter = router({
  /**
   * The tenant's models with their last build: names, hashes and column counts, no SQL. Any
   * member may read what is built for them. `include: ["columns"]` adds each build's columns.
   */
  list: tenantProcedure
    .input(
      z.object({
        ...NameFilterInput,
        include: z
          .array(z.enum(["columns"]))
          .min(1)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      listedOrRefusal(ctx.locale, await models.list(ctx.exec, input.tenantId, input)),
    ),

  /**
   * One hash per kind of authored content -- models, macros, questions -- and one over all of
   * them, so a client learns whether anything changed without reading any of it (ADR 0127).
   */
  revision: tenantProcedure.query(({ ctx, input }) => revision(ctx.exec, input.tenantId)),

  get: tenantProcedure.input(z.object({ name: ModelName })).query(async ({ ctx, input }) => {
    const model = await models.get(ctx.exec, input.tenantId, input.name);
    if (model === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return model;
  }),

  /**
   * Store a model. Executes nothing: Build is the worker's verb, chosen separately, so a
   * saved mistake is a row and not a broken table. Admin-only, like every write that
   * changes what a customer's dashboards will show. A name taken by a model under `create`,
   * or by one of the tenant's seeds at all (ADR 0128), is a CONFLICT.
   */
  save: requireRole("admin")
    .input(
      z.object({
        name: ModelName,
        sql: z.string().max(MAX_MODEL_SQL_BYTES),
        tests: ModelTests,
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await models.save(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
        create: input.create,
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (!outcome.ok) {
        const key = outcome.reason === "seed-named" ? "error.modelNameIsSeed" : "error.modelNameTaken";
        throw new TRPCError({
          code: "CONFLICT",
          message: messages(ctx.locale)(key, { name: input.name }),
        });
      }
      return outcome;
    }),

  /**
   * Delete a model and drop what it built, or do neither (ADR 0077). Without a worker nothing
   * can drop the tables, so nothing is deleted: a "deleted" over data still readable is the
   * one answer this must never give. A build running and a model another one reads from are
   * CONFLICTs the person can act on; a worker that did not drop is a precondition they cannot.
   */
  delete: requireRole("admin")
    .input(z.object({ name: ModelName }))
    .mutation(async ({ ctx, input }) => {
      const t = messages(ctx.locale);
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: t("error.modelNotDeleted", { name: input.name }),
        });
      }
      const outcome = await models.remove(ctx.exec, ctx.worker, {
        tenantId: ctx.tenantId,
        name: input.name,
        actor: actorOf(ctx),
      });
      if (outcome.ok) {
        return { ok: true };
      }
      switch (outcome.reason) {
        case "not-found":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "in-progress":
          throw new TRPCError({ code: "CONFLICT", message: t("error.buildInProgress") });
        case "depended-on":
          throw new TRPCError({
            code: "CONFLICT",
            message: t("error.modelDependedOn", {
              name: input.name,
              dependents: outcome.dependents.join(", "),
            }),
          });
        default:
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: t("error.modelNotDeleted", { name: input.name }),
          });
      }
    }),

  /**
   * Build models as one run: `name` for one, or `names` for up to twenty, each `name`, `+name`
   * (with its upstream) or `name+` (with its downstream), as one `dbt build` (issue 442).
   * Admin-only like save: a build creates the table a dashboard reads.
   *
   * It waits by default and answers with what the build did, its steps reported as `runs.get`
   * reports them (the problems unless asked, issue 441). With `wait: false` it answers at once
   * with the run, for a caller that waits on `runs.get` instead of on this request. Waiting, it
   * holds its request open for the worker's whole deadline plus the time to answer (ADR 0126).
   *
   * A name the tenant has no model of is NOT_FOUND naming it, before anything runs. A build
   * already running is a CONFLICT naming that run and its start, so it can be waited on; a
   * worker that did not answer is a precondition nobody at the screen can fix.
   */
  build: requireRole("admin")
    .meta({ holdsOpenSeconds: BUILD_DEADLINE_MS / MS_PER_SECOND + ANSWER_SECONDS })
    .input(
      StepQuery.omit({ stepCursor: true }).extend({
        name: ModelName.optional(),
        names: z.array(ModelSelector).min(1).max(MAX_BUILD_SELECTORS).optional(),
        wait: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = messages(ctx.locale);
      const { tenantId, name, names, wait, ...steps } = input;
      const select = names ?? (name === undefined ? null : [name]);
      if (select === null || (name !== undefined && names !== undefined)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: t("error.buildNamesOne") });
      }
      if (ctx.worker === null) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: t("error.buildNotStarted") });
      }
      const outcome = await buildModels(ctx.exec, ctx.worker, {
        tenantId,
        select,
        wait,
        steps,
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return outcome.value;
      }
      switch (outcome.reason) {
        case "not-found":
          throw refusal(
            "NOT_FOUND",
            t("error.modelsNotFound", { names: outcome.missing.join(", ") }),
            { reason: "MODEL_NOT_FOUND", missing: outcome.missing.join(",") },
          );
        case "in-progress":
          throw buildHeld(ctx.locale, outcome.holder);
        default:
          throw notRun(ctx.locale, outcome.reason, "error.buildNotStarted");
      }
    }),

  /**
   * Check a model's SQL, running nothing. Any member may: it tells an author about a mistake
   * while it is still text, and the model-builder skill runs it before every save. Advisory,
   * never a gate on `save` -- the editor's promise is that a saved mistake is a row, not a
   * broken table. Each finding and each thing it could not verify comes back worded.
   */
  check: tenantProcedure
    .input(
      z.object({
        name: ModelName,
        sql: z.string().max(MAX_MODEL_SQL_BYTES),
        tests: ModelTests,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const checked = await models.check(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
      });
      return wordCheck(ctx.locale, checked);
    }),

  /**
   * What each model declares it reads: other models by `ref()`, raw lake tables by
   * `source()`, through any macro it calls. Any member may, as they may read the models it is
   * read from. Declared relations only (ADR 0092): a model whose upstream its text cannot
   * show carries why, and a ref to a deleted model stays as a missing dependency.
   *
   * With a `name`, only the part around that node, which is what an agent asking "what reads
   * this model" needs; the whole graph of a large tenant overflowed every client it was sent
   * to (issue 443). A name no node carries is NOT_FOUND, never an empty graph -- an empty one
   * would say the model exists and reads nothing.
   */
  lineage: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(MAX_LINEAGE_NAME_CHARS).optional(),
        direction: z.enum(["up", "down", "both"]).default("both"),
        depth: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const target =
        input.name === undefined
          ? null
          : { name: input.name, direction: input.direction, depth: input.depth ?? null };
      const graph = await models.lineage(ctx.exec, input.tenantId, target);
      if (graph === null) {
        throw refusal(
          "NOT_FOUND",
          messages(ctx.locale)("error.lineageNameUnknown", { name: input.name ?? "" }),
          { reason: "unknown-name", name: input.name ?? null },
        );
      }
      return graph;
    }),

  /**
   * The sources and macros every project carries, and the tenant's own macros, for the
   * editor's reference panel and for an agent choosing what to call. Whole without `parts`;
   * with them, only those, marked with what was asked -- the platform's two parts are the same
   * text on every call, so an agent asks for `tenantMacros` alone.
   */
  reference: tenantProcedure
    .input(z.object({ parts: z.array(z.enum(REFERENCE_PARTS)).min(1).optional() }))
    .query(
      async ({ ctx, input }): Promise<Reference | ReferenceParts> =>
        input.parts === undefined
          ? await reference(ctx.exec, input.tenantId)
          : await referenceParts(ctx.exec, input.tenantId, input.parts),
    ),
});
