/**
 * The `users` procedures: the people on the platform as a whole, for a platform superadmin, and
 * deactivating or reactivating one of them (ADR 0152).
 *
 * All three on `superadminProcedure`, never on a customer's permission: one person can belong to
 * several customers, and an admin of one must not cut them off from the others it cannot see.
 * Removing someone from ONE customer is `people.removeMember`, and stays a customer's own act.
 */

import { TRPCError } from "@trpc/server";
import type { Locale } from "@undercroft/core";
import { z } from "zod";
import { messages } from "../i18n/index.ts";
import * as users from "../services/users.ts";
import type { UserRefusal } from "../services/users.ts";
import { Email } from "./inputs.ts";
import { actorOf, refusal, router, superadminProcedure } from "./trpc.ts";

/** The facts each refusal names, for an agent to match on. */
const REASONS: Readonly<Record<Exclude<UserRefusal, "not-found">, string>> = {
  "already-deactivated": "USER_DEACTIVATED",
  "already-active": "USER_ACTIVE",
  self: "CANNOT_DEACTIVATE_SELF",
  superadmin: "SUPERADMIN_BY_ENVIRONMENT",
};

/**
 * What a transition that changed nothing answers. NOT_FOUND, worded, for an address nobody has
 * -- the caller is a superadmin, who may know who is on the platform, so naming it confirms
 * nothing they could not list. Everything else is PRECONDITION_FAILED, as a customer's
 * deactivation answers "already in that state" (`tenantsRouter.ts`): what refused is the state
 * of the platform -- the person's, the caller's own, or the environment's list -- never a lack
 * of authority, so FORBIDDEN would send the caller looking for authority that would not help.
 */
function refused(locale: Locale, email: string, reason: UserRefusal): TRPCError {
  const t = messages(locale);
  if (reason === "not-found") {
    return new TRPCError({ code: "NOT_FOUND", message: t("error.userNotFound", { email }) });
  }
  const sentence = {
    "already-deactivated": t("error.userDeactivated", { email }),
    "already-active": t("error.userNotDeactivated", { email }),
    self: t("error.cannotDeactivateSelf"),
    superadmin: t("error.superadminByEnvironment", { email }),
  }[reason];
  return refusal("PRECONDITION_FAILED", sentence, { reason: REASONS[reason], email });
}

const Person = z.object({ email: Email });

export const usersRouter = router({
  list: superadminProcedure.query(({ ctx }) => users.list(ctx.exec)),

  /**
   * Deactivate a person everywhere and revoke every credential they hold; their memberships are
   * kept. Answers how many of each kind of credential went, the same counts the audit row keeps.
   */
  deactivate: superadminProcedure.input(Person).mutation(async ({ ctx, input }) => {
    const result = await users.deactivate(ctx.exec, ctx.offboarding, {
      email: input.email,
      actor: actorOf(ctx),
    });
    if (!result.ok) {
      throw refused(ctx.locale, input.email, result.reason);
    }
    return { email: result.email, deactivatedAt: result.deactivatedAt, revoked: result.revoked };
  }),

  /** Reactivate a deactivated person: their memberships are as they were. */
  reactivate: superadminProcedure.input(Person).mutation(async ({ ctx, input }) => {
    const result = await users.reactivate(ctx.exec, { email: input.email, actor: actorOf(ctx) });
    if (!result.ok) {
      throw refused(ctx.locale, input.email, result.reason);
    }
    return { email: result.email, deactivatedSince: result.deactivatedSince };
  }),
});
