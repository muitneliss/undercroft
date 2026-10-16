/**
 * The `scopes` procedures: what a person reads, resolved -- the models and reference tables they
 * see, how much of each, and the rules that no longer hold (ADR 0143).
 *
 * `preview` asks what `grants.reach` asks, with the same gate: about oneself any member may ask;
 * about a role or another person it needs `people:manage`, checked inside, because who reads what
 * is the roster's information (ADR 0119). Its own namespace because it answers about the READ
 * side -- the scope a reader's SQL runs under -- where `grants` keeps what is given.
 */

import { z } from "zod";

import { holds } from "../services/authz.ts";
import { preview } from "../services/scopes.ts";
import { noSuchRoleRefusal, notMemberRefusal } from "./accessRefusals.ts";
import { Email, Role } from "./inputs.ts";
import { permissionRefusal } from "./permissionGate.ts";
import { refusal, router, tenantProcedure } from "./trpc.ts";
import { messages } from "../i18n/index.ts";

export const scopesRouter = router({
  /**
   * What a role (`role`), a member (`email`) or -- naming nobody -- the caller can see: their
   * permissions; every model and reference table they read, each with the rows it shows (`null`
   * for every row, else rows meeting any one rule), the columns it hides, and `broken` when its
   * row rule no longer compiles against the table, which then shows them no row; and the raw
   * streams and reports they read.
   */
  preview: tenantProcedure
    .input(z.object({ role: Role.optional(), email: Email.optional() }))
    .query(async ({ ctx, input }) => {
      if ((input.role !== undefined || input.email !== undefined) && !holds(ctx, "people:manage")) {
        throw permissionRefusal(ctx, "people:manage");
      }
      const outcome = await preview(ctx.exec, {
        tenantId: ctx.tenantId,
        role: input.role,
        email: input.email,
        caller: { permissions: ctx.permissions, reach: ctx.reach },
      });
      if (outcome.ok) {
        return outcome.preview;
      }
      switch (outcome.reason) {
        case "one-subject":
          throw refusal("BAD_REQUEST", messages(ctx.locale)("error.grantOneSubject"), {
            reason: "ONE_SUBJECT",
          });
        case "no-such-role":
          throw noSuchRoleRefusal(ctx, input.role ?? "");
        default:
          throw notMemberRefusal(ctx, input.email ?? "");
      }
    }),
});
