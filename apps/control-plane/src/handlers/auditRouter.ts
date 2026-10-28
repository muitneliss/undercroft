/**
 * The `audit` procedures: the audit log, read back by the three people who may read it. ADR 0113.
 *
 * One procedure per audience, each on the gate that already means that audience, so who may read
 * which rows is decided where every other authority is and never re-decided in here:
 *
 * - `mine`, any signed-in caller: the rows they acted in, in every tenant and in none.
 * - `tenant`, the tenant's admin: every row attributed to the tenant, by anyone. On
 *   `tenantStatusProcedure`, so a deactivated tenant's admin can still read who deactivated it.
 * - `all`, a platform superadmin: every row.
 *
 * And the call log beside it (ADR 0151), a platform superadmin's alone: `calls.list`, the agents'
 * calls without their bodies, and `calls.get`, one of them whole -- what it sent, what it was answered, and
 * the cause of a failure its caller was told only as `internal_error`.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import { listAll, listMine, listTenant } from "../services/audit.ts";
import { getCall, listCalls } from "../services/callLog.ts";
import { Email } from "./inputs.ts";
import { requirePermission } from "./permissionGate.ts";
import { authedProcedure, router, superadminProcedure, tenantStatusProcedure } from "./trpc.ts";

/** A page as `runs.list` takes one: rows older than `cursor` (a page's `nextCursor`), at most `limit`. */
const Page = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .optional(),
});

/**
 * A call's id, which is a `bigint`: at most 18 digits, so every id this admits is one the column
 * can hold -- a 19th could pass a looser pattern and overflow in the statement, which would answer
 * a well-formed request with `internal_error`.
 */
const CallId = z.string().regex(/^[1-9][0-9]{0,17}$/u);

export const auditRouter = router({
  mine: authedProcedure
    .input(Page)
    .query(({ ctx, input }) => listMine(ctx.exec, { ...input, userId: ctx.user.userId })),

  tenant: requirePermission("audit:read", tenantStatusProcedure)
    .input(Page.extend({ email: Email.optional() }))
    .query(({ ctx, input }) => listTenant(ctx.exec, { ...input, tenantId: ctx.tenantId })),

  all: superadminProcedure
    .input(Page.extend({ tenantId: z.string().min(1).optional(), email: Email.optional() }))
    .query(({ ctx, input }) => listAll(ctx.exec, input)),

  calls: router({
    list: superadminProcedure
      .input(
        Page.extend({
          cursor: CallId.optional(),
          tenantId: z.string().min(1).optional(),
          email: Email.optional(),
          path: z.string().min(1).max(128).optional(),
          outcome: z.enum(["ok", "refused", "failed"]).optional(),
        }),
      )
      .query(({ ctx, input }) => listCalls(ctx.exec, input)),

    get: superadminProcedure.input(z.object({ id: CallId })).query(async ({ ctx, input }) => {
      const call = await getCall(ctx.exec, input.id);
      if (call === null) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: messages(ctx.locale)("error.callNotFound", { id: input.id }),
        });
      }
      return call;
    }),
  }),
});
