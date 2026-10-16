/**
 * The `models` procedures.
 *
 * Split from `router.ts`, which had grown past what one file may be. Same layer and the
 * same rules: validate the input, call one service, decide what its answer means over HTTP.
 */

import { TRPCError } from "@trpc/server";
import {
  DEFAULT_QUERY_ROWS,
  MAX_BUILD_SELECTORS,
  MAX_MODEL_SQL_BYTES,
  MAX_QUERY_ROWS,
  MAX_QUERY_SQL_BYTES,
  ModelDescription,
  ModelName,
  ModelSelector,
  ModelTests,
} from "@undercroft/contracts";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { lineage } from "../services/lineage.ts";
import { buildModels } from "../services/modelBuild.ts";
import {
  REFERENCE_PARTS,
  type Reference,
  type ReferenceParts,
  reference,
  referenceParts,
} from "../services/modelReference.ts";
import { check } from "../services/modelChecks.ts";
import { preview } from "../services/modelPreview.ts";
import * as models from "../services/models.ts";
import { revision } from "../services/revision.ts";
import { BUILD_DEADLINE_MS } from "../services/workerBuild.ts";
import { PREVIEW_DEADLINE_MS } from "../services/workerPreview.ts";
import { notRun } from "./answers.ts";
import { testedFindingSentence, wordCheck } from "./checkWords.ts";
import { ANSWER_SECONDS } from "./holdOpen.ts";
import { StepQuery } from "./inputs.ts";
import { cursorRefusal, listingOrRefusal, NameFilterInput, PageInput } from "./listInputs.ts";
import { buildHeld, parentTestsFailing, previewRefused } from "./modelRefusals.ts";
import { requireWholeReach } from "./permissionGate.ts";
import { actorOf, refusal, router, tenantProcedure } from "./trpc.ts";

const MS_PER_SECOND = 1000;

/**
 * The longest lineage `name` worth reading: a model's name, or a source table as
 * `schema.table`. Generous, since a missing dependency is named as its author wrote it.
 */
const MAX_LINEAGE_NAME_CHARS = 255;

export const modelsRouter = router({
  /**
   * The tenant's models with their last build: names, descriptions, hashes and column counts,
   * no SQL. Any member may read what is built for them. `include: ["columns"]` adds each build's
   * columns, `["dependsOn"]` what each declares it reads (ADR 0137). `limit` or `cursor` answers
   * a page, `{ items, nextCursor }`, rather than the array (ADR 0133).
   */
  list: tenantProcedure
    .input(
      z.object({
        ...NameFilterInput,
        ...PageInput,
        include: z
          .array(z.enum(["columns", "dependsOn"]))
          .min(1)
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      listingOrRefusal(
        ctx.locale,
        "models.list",
        await models.list(ctx.exec, input.tenantId, ctx.reach, input),
      ),
    ),

  /**
   * One hash per kind of authored content -- models, macros, questions -- and one over all of
   * them, so a client learns whether anything changed without reading any of it (ADR 0127).
   */
  revision: tenantProcedure.query(({ ctx, input }) => revision(ctx.exec, input.tenantId)),

  get: tenantProcedure.input(z.object({ name: ModelName })).query(async ({ ctx, input }) => {
    const model = await models.get(ctx.exec, input.tenantId, input.name, ctx.reach);
    if (model === null) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return model;
  }),

  /**
   * Store a model. Executes nothing: Build is the worker's verb, chosen separately, so a
   * saved mistake is a row and not a broken table. `models:write`, like every write that
   * changes what a customer's dashboards will show. A name taken by a model under `create`,
   * or by one of the tenant's seeds at all (ADR 0128), is a CONFLICT. `description` left out
   * keeps the stored one and `null` clears it (ADR 0137).
   */
  save: requireWholeReach("models:write")
    .input(
      z.object({
        name: ModelName,
        sql: z.string().max(MAX_MODEL_SQL_BYTES),
        tests: ModelTests,
        description: ModelDescription.nullable().optional(),
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await models.save(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
        description: input.description,
        create: input.create,
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return outcome;
      }
      const t = messages(ctx.locale);
      if (outcome.reason === "test-refused") {
        throw refusal(
          "BAD_REQUEST",
          t("error.modelTestRefused", {
            reason: testedFindingSentence(ctx.locale, outcome.finding),
          }),
          {
            reason: "TEST_REFUSED",
            code: outcome.finding.code,
            test: outcome.finding.test ?? null,
            subject: outcome.finding.subject,
          },
        );
      }
      const taken =
        outcome.reason === "seed-named" ? "error.modelNameIsSeed" : "error.modelNameTaken";
      throw new TRPCError({ code: "CONFLICT", message: t(taken, { name: input.name }) });
    }),

  /**
   * Delete a model and drop what it built, or do neither (ADR 0077). Without a worker nothing
   * can drop the tables, so nothing is deleted: a "deleted" over data still readable is the
   * one answer this must never give. A build running and a model another one reads from are
   * CONFLICTs the person can act on; a worker that did not drop is a precondition they cannot.
   */
  delete: requireWholeReach("models:write")
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
   * `models:write` like save: a build creates the table a dashboard reads.
   *
   * It waits by default and answers with what the build did, its steps reported as `runs.get`
   * reports them (the problems unless asked, issue 441). With `wait: false` it answers at once
   * with the run, for a caller that waits on `runs.get` instead of on this request. Waiting, it
   * holds its request open for the worker's whole deadline plus the time to answer (ADR 0126).
   *
   * A name the tenant has no model of is NOT_FOUND naming it, before anything runs. A parent the
   * build would read without rebuilding whose latest tests failed is PRECONDITION_FAILED naming
   * it (issue 457); one with no test record is named in `parentTestsUnknown` instead. Success is
   * `verdict: "clean"` -- `ok` with failing tests is `tests-failing` (ADR 0129). A build
   * already running is a CONFLICT naming that run and its start, so it can be waited on; a
   * worker that did not answer is a precondition nobody at the screen can fix.
   */
  build: requireWholeReach("models:write")
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
        case "parent-tests-failing":
          throw parentTestsFailing(ctx.locale, outcome.failing);
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
      const checked = await check(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        tests: input.tests,
      });
      return wordCheck(ctx.locale, checked);
    }),

  /**
   * What an unsaved model returns (ADR 0132): dbt compiles `sql` as the model `name` in the
   * tenant's own project -- in place of the saved model of that name, or beside the saved ones --
   * and the worker runs what it compiled, read-only, as the tenant's dbt login. A sample of its
   * rows, or `query` over it, where the model is named `name`. Nothing is saved or built.
   *
   * `models:write`, and a write for a credential's grant, as `lake.query` is: it runs SQL an
   * author wrote as the login that may read the raw lake, so it reaches exactly what that console
   * does -- which is why every built-in role holding `models:write` also holds `lake:read`. ADR
   * 0132 made it admin-only; ADR 0139 moved it with `save` to the permission.
   * A mutation, as `models.check` is, because a model's SQL does not fit a query string.
   *
   * A model dbt would not compile, and SQL Postgres refused, are BAD_REQUEST quoting dbt or
   * Postgres: the request was the fault, and the sentence is how the author fixes it. A worker
   * that did not answer is a precondition. It holds its request open for the worker's deadline.
   */
  preview: requireWholeReach("models:write")
    .meta({ holdsOpenSeconds: PREVIEW_DEADLINE_MS / MS_PER_SECOND + ANSWER_SECONDS })
    .input(
      z.object({
        name: ModelName,
        sql: z.string().min(1).max(MAX_MODEL_SQL_BYTES),
        query: z.string().trim().min(1).max(MAX_QUERY_SQL_BYTES).optional(),
        limit: z.number().int().min(1).max(MAX_QUERY_ROWS).default(DEFAULT_QUERY_ROWS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: messages(ctx.locale)("error.previewNotRun"),
        });
      }
      const outcome = await preview(ctx.worker, {
        tenantId: ctx.tenantId,
        name: input.name,
        sql: input.sql,
        limit: input.limit,
        ...(input.query === undefined ? {} : { query: input.query }),
      });
      if (outcome.ok) {
        return outcome.value;
      }
      throw previewRefused(ctx.locale, input.name, outcome);
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
   *
   * `limit` or `cursor` answers that part a page at a time: at most `limit` nodes and `limit`
   * edges, with `nextCursor` (ADR 0133). The browser draws the graph whole and never asks.
   */
  lineage: tenantProcedure
    .input(
      z.object({
        name: z.string().min(1).max(MAX_LINEAGE_NAME_CHARS).optional(),
        direction: z.enum(["up", "down", "both"]).default("both"),
        depth: z.number().int().positive().optional(),
        ...PageInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const target =
        input.name === undefined
          ? null
          : { name: input.name, direction: input.direction, depth: input.depth ?? null };
      const reader = { tenantId: input.tenantId, reach: ctx.reach };
      const answer = await lineage(ctx.exec, reader, target, input);
      if (answer.ok) {
        return answer.value;
      }
      if (answer.reason === "unknown-cursor") {
        throw cursorRefusal(ctx.locale, "models.lineage");
      }
      throw refusal(
        "NOT_FOUND",
        messages(ctx.locale)("error.lineageNameUnknown", { name: input.name ?? "" }),
        { reason: "unknown-name", name: input.name ?? null },
      );
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
