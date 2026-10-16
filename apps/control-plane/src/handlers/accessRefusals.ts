/**
 * The refusals of the procedures that change who holds what -- `roles.*`, `grants.*` and the
 * `people` procedures that name a role (ADR 0141) -- worded once for all three routers.
 *
 * Each carries facts an agent matches on beside the sentence a person reads, as every worded
 * refusal does (`refusal` in `trpc.ts`). The subset rule's is FORBIDDEN, like a missing
 * permission's, and names what is lacking the same way: `permission` is the first one, so an
 * agent that reads a `PERMISSION_REQUIRED` refusal reads this one too, and `permissions` is all
 * of them, comma-joined.
 */

import type { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import { messages } from "../i18n/index.ts";
import { refusal } from "./trpc.ts";

interface Asked {
  readonly locale: Locale;
  readonly tenantId: string;
}

/**
 * The caller would give or take away permissions they do not hold themselves -- or, when they hold
 * every permission involved, objects they do not reach (ADR 0142): `REACH_NOT_HELD`, naming the
 * objects as grants spell them (`model:fct_sales`, `raw:*`), so an agent can say what to ask for.
 */
export function notHeldRefusal(
  ctx: Asked,
  missing: readonly Permission[],
  objects: readonly string[] = [],
): TRPCError {
  if (missing.length === 0 && objects.length > 0) {
    return refusal(
      "FORBIDDEN",
      messages(ctx.locale)("error.reachNotHeld", { objects: objects.join(", ") }),
      {
        reason: "REACH_NOT_HELD",
        object: objects[0] ?? null,
        objects: objects.join(","),
        tenantId: ctx.tenantId,
      },
    );
  }
  return refusal(
    "FORBIDDEN",
    messages(ctx.locale)("error.permissionsNotHeld", { permissions: missing.join(", ") }),
    {
      reason: "PERMISSION_NOT_HELD",
      permission: missing[0] ?? null,
      permissions: missing.join(","),
      tenantId: ctx.tenantId,
    },
  );
}

/** The customer has no role with that key. NOT_FOUND, past membership, so worded. */
export function noSuchRoleRefusal(ctx: Asked, role: string): TRPCError {
  return refusal("NOT_FOUND", messages(ctx.locale)("error.noSuchRole", { role }), {
    reason: "ROLE_NOT_FOUND",
    role,
  });
}

/**
 * The address holds no role in this customer. Safe to word: every procedure that answers it has
 * established the caller manages access here, and could read the same off the roster.
 */
export function notMemberRefusal(ctx: Asked, email: string): TRPCError {
  return refusal("NOT_FOUND", messages(ctx.locale)("error.notMember", { email }), {
    reason: "NOT_MEMBER",
    email,
  });
}
