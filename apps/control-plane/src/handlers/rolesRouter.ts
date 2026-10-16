/**
 * The `roles` procedures: the roles a customer has, built-in and its own. ADR 0141.
 *
 * Any member may list and read them -- which permissions each holds is what a person needs to
 * know to ask for the right one, and it names nobody: who holds a role is the roster's, behind
 * `people:manage`. Saving and deleting need `roles:manage`, and the subset rule inside the
 * service: nobody defines, changes or deletes a role holding a permission they do not hold.
 *
 * Same layer and rules as the other routers: validate, call one service, decide what its answer
 * means over HTTP. Every refusal is worded and names its facts.
 */

import type { TRPCError } from "@trpc/server";
import { PERMISSIONS } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import * as roles from "../services/roles.ts";
import { noSuchRoleRefusal, notHeldRefusal } from "./accessRefusals.ts";
import { Role } from "./inputs.ts";
import { listedOrRefusal, NameFilterInput } from "./listInputs.ts";
import { requirePermission } from "./permissionGate.ts";
import { actorOf, refusal, router, tenantProcedure } from "./trpc.ts";

/** The longest label a customer may give a role: a name read in a picker, not a paragraph. */
const MAX_LABEL_CHARS = 80;
/** The longest description: what the role is for, in a sentence or two. */
const MAX_DESCRIPTION_CHARS = 500;

/** A built-in's key under `roles.save` or `roles.delete`: its grants are the platform's code. */
function builtInRefusal(locale: Locale, role: string): TRPCError {
  return refusal("BAD_REQUEST", messages(locale)("error.builtInRole", { role }), {
    reason: "BUILT_IN_ROLE",
    role,
  });
}

export const rolesRouter = router({
  /**
   * Every role the customer has -- the four built-ins, then its own -- each with the permissions
   * it holds and how many hold it or are invited at it, and the permission catalogue a role is
   * made of. `names` or `match` narrow the roles by key.
   */
  list: tenantProcedure.input(z.object(NameFilterInput)).query(async ({ ctx, input }) => ({
    roles: listedOrRefusal(ctx.locale, await roles.list(ctx.exec, input.tenantId, input)),
    permissions: PERMISSIONS,
  })),

  get: tenantProcedure.input(z.object({ key: Role })).query(async ({ ctx, input }) => {
    const role = await roles.get(ctx.exec, input.tenantId, input.key);
    if (role === null) {
      throw noSuchRoleRefusal(ctx, input.key);
    }
    return role;
  }),

  /**
   * Define a role, or change one the customer defined: its label, description and permissions.
   * With `create`, a key already in use is a CONFLICT; content identical to what is stored is
   * `unchanged: true`. A built-in's key is refused, and so is any permission -- given or taken
   * away -- that the caller does not hold.
   */
  save: requirePermission("roles:manage")
    .input(
      z.object({
        key: Role,
        label: z.string().trim().min(1).max(MAX_LABEL_CHARS),
        description: z.string().trim().max(MAX_DESCRIPTION_CHARS).default(""),
        permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
        create: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await roles.save(ctx.exec, {
        tenantId: ctx.tenantId,
        key: input.key,
        label: input.label,
        description: input.description,
        permissions: input.permissions,
        create: input.create,
        held: ctx.permissions,
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return { key: input.key, unchanged: outcome.unchanged };
      }
      switch (outcome.reason) {
        case "built-in":
          throw builtInRefusal(ctx.locale, input.key);
        case "not-held":
          throw notHeldRefusal(ctx, outcome.lacking);
        default:
          throw refusal(
            "CONFLICT",
            messages(ctx.locale)("error.roleKeyTaken", { role: input.key }),
            { reason: "ROLE_TAKEN", role: input.key },
          );
      }
    }),

  /**
   * Delete a role the customer defined, with every grant to it. Refused while anybody holds it or
   * an open invitation names it -- a CONFLICT naming both counts -- and for a built-in.
   */
  delete: requirePermission("roles:manage")
    .input(z.object({ key: Role }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await roles.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        key: input.key,
        held: ctx.permissions,
        actor: actorOf(ctx),
      });
      if (outcome.ok) {
        return { ok: true };
      }
      switch (outcome.reason) {
        case "built-in":
          throw builtInRefusal(ctx.locale, input.key);
        case "not-found":
          throw noSuchRoleRefusal(ctx, input.key);
        case "not-held":
          throw notHeldRefusal(ctx, outcome.lacking);
        default:
          throw refusal(
            "CONFLICT",
            messages(ctx.locale)("error.roleInUse", {
              role: input.key,
              members: String(outcome.members),
              invitations: String(outcome.invitations),
            }),
            {
              reason: "ROLE_IN_USE",
              role: input.key,
              members: String(outcome.members),
              invitations: String(outcome.invitations),
            },
          );
      }
    }),
});
