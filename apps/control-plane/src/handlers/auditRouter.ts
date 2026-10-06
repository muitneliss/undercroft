/**
 * The `audit` procedures: the audit log, read back by the three people who may read it. ADR 0112.
 *
 * One procedure per audience, each on the gate that already means that audience, so who may read
 * which rows is decided where every other authority is and never re-decided in here:
 *
 * - `mine`, any signed-in caller: the rows they acted in, in every tenant and in none.
 * - `tenant`, the tenant's admin: every row attributed to the tenant, by anyone. On
 *   `tenantStatusProcedure`, so a deactivated tenant's admin can still read who deactivated it.
 * - `all`, a platform superadmin: every row.
 */

import { z } from "zod";
import { listAll, listMine, listTenant } from "../services/audit.ts";
import { Email } from "./inputs.ts";
import {
  authedProcedure,
  requireRole,
  router,
  superadminProcedure,
  tenantStatusProcedure,
} from "./trpc.ts";

/** A page: rows older than `before` (an id from the last page's `next`), at most `limit`. */
const Page = z.object({
  before: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/u)
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export const auditRouter = router({
  mine: authedProcedure
    .input(Page)
    .query(({ ctx, input }) => listMine(ctx.exec, { ...input, userId: ctx.user.userId })),

  tenant: requireRole("admin", tenantStatusProcedure)
    .input(Page.extend({ email: Email.optional() }))
    .query(({ ctx, input }) => listTenant(ctx.exec, { ...input, tenantId: ctx.tenantId })),

  all: superadminProcedure
    .input(Page.extend({ tenantId: z.string().min(1).optional(), email: Email.optional() }))
    .query(({ ctx, input }) => listAll(ctx.exec, input)),
});
