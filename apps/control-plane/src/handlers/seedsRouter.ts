/**
 * The `seeds` procedures: a tenant's reference tables, which its models read with `ref()`.
 * ADR 0128.
 *
 * A holder of `models:read` may list and read them, as they may read the models built from them
 * (ADR 0147); only a holder of `models:write` may save or delete one, because a seed changes what
 * every model reading it builds. Same layer
 * and rules as the other routers: validate, call one service, decide what its answer means.
 *
 * A table the service refuses is BAD_REQUEST, worded, with the facts an agent acts on --
 * `reason` the problem's code, `row` the index into `rows` and `column` the column -- so a
 * script that wrote the table can point at the cell without parsing the sentence.
 */

import { TRPCError } from "@trpc/server";
import {
  MAX_SEED_BYTES,
  MAX_SEED_CELL_CHARS,
  MAX_SEED_COLUMNS,
  MAX_SEED_ROWS,
  SeedCell,
  SeedColumn,
  SeedName,
  type SeedRefusal,
} from "@undercroft/contracts";
import type { Locale } from "@undercroft/core/locale";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as seeds from "../services/seeds.ts";
import { listedOrRefusal, NameFilterInput } from "./listInputs.ts";
import { requirePermission, requireWholeReach } from "./permissionGate.ts";
import { actorOf, refusal, router } from "./trpc.ts";

/** The bound a table-level problem names, so its sentence can say how far is too far. */
const LIMIT_OF: Partial<Record<SeedRefusal["problem"], number>> = {
  "too-many-columns": MAX_SEED_COLUMNS,
  "too-many-rows": MAX_SEED_ROWS,
  "too-large": MAX_SEED_BYTES,
  "cell-too-long": MAX_SEED_CELL_CHARS,
};

/** A refused table, worded in the reader's language, with where it failed as facts. */
function tableRefused(locale: Locale, found: SeedRefusal, columns: number): TRPCError {
  const sentence = messages(locale)(`seedTable.problem.${found.problem}` as const, {
    row: found.row === null ? "" : String(found.row),
    column: found.column ?? "",
    columns: String(columns),
    max: LIMIT_OF[found.problem]?.toLocaleString(locale) ?? "",
  });
  return refusal("BAD_REQUEST", sentence, {
    reason: found.problem,
    row: found.row === null ? null : String(found.row),
    column: found.column,
  });
}

export const seedsRouter = router({
  /**
   * The tenant's seeds: names, sizes and the hash of each one's content, no cells -- so a reader
   * can choose one to `ref()`, or tell whether its copy is current. `get` has the cells.
   */
  list: requirePermission("models:read")
    .input(z.object(NameFilterInput))
    .query(async ({ ctx, input }) =>
      listedOrRefusal(ctx.locale, await seeds.list(ctx.exec, input.tenantId, ctx.reach, input)),
    ),

  get: requirePermission("models:read")
    .input(z.object({ name: SeedName }))
    .query(async ({ ctx, input }) => {
      const seed = await seeds.get(ctx.exec, input.tenantId, input.name, ctx.reach);
      if (seed === null) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return seed;
    }),

  /**
   * Store a seed: its typed columns and its rows, every cell a string or null. Loads nothing --
   * the next build that reaches it does. A cell its column cannot hold, or a table past a bound,
   * is BAD_REQUEST naming where; a taken name under `create`, or a model's name, is a CONFLICT.
   * The bounds are the service's, so each refusal is worded rather than a schema's.
   */
  save: requireWholeReach("models:write")
    .input(
      z.object({
        name: SeedName,
        columns: z.array(SeedColumn).min(1),
        rows: z.array(z.array(SeedCell)),
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = messages(ctx.locale);
      const outcome = await seeds.save(ctx.exec, {
        tenantId: ctx.tenantId,
        name: input.name,
        columns: input.columns,
        rows: input.rows,
        create: input.create,
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return outcome;
      }
      switch (outcome.reason) {
        case "refused":
          throw tableRefused(ctx.locale, outcome.refusal, input.columns.length);
        case "model-named":
          throw new TRPCError({
            code: "CONFLICT",
            message: t("error.seedNameIsModel", { name: input.name }),
          });
        default:
          throw new TRPCError({
            code: "CONFLICT",
            message: t("error.seedNameTaken", { name: input.name }),
          });
      }
    }),

  /**
   * Delete a seed and drop the table its loads made, or do neither (ADR 0077's arrangement). A
   * seed a model still reads is a CONFLICT naming the models; without a worker nothing can drop
   * the table, so nothing is deleted.
   */
  delete: requireWholeReach("models:write")
    .input(z.object({ name: SeedName }))
    .mutation(async ({ ctx, input }) => {
      const t = messages(ctx.locale);
      if (ctx.worker === null) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: t("error.seedNotDeleted", { name: input.name }),
        });
      }
      const outcome = await seeds.remove(ctx.exec, ctx.worker, {
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
            message: t("error.seedDependedOn", {
              name: input.name,
              dependents: outcome.dependents.join(", "),
            }),
          });
        default:
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: t("error.seedNotDeleted", { name: input.name }),
          });
      }
    }),
});
