/**
 * The permission gate: what a tenant procedure needs beyond membership (ADR 0139).
 *
 * Its own module beside `trpc.ts` rather than inside it, because it is one idea with three
 * parts that must agree -- the guard a procedure is built on, the refusal it answers with, and
 * the registry `procedureManifest` reads to say which permission each procedure needs -- and
 * none of it is the context, the 404 boundary or the deactivation that `trpc.ts` argues. It
 * knows the permission it is asked about and nothing of which roles hold it: that is
 * `BUILT_IN_GRANTS`, projected into Casbin by `services/rbac.ts`, and answered on the context
 * as `permissions` by `tenantStatusProcedure`.
 */

import type { TRPCError } from "@trpc/server";
import type { Permission } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import { messages, permissionLabel } from "../i18n/index.ts";
import { holds } from "../services/authz.ts";
import { refusal, tenantProcedure, type tenantStatusProcedure } from "./trpc.ts";

/**
 * The refusal for a caller who is a member but lacks `permission`: FORBIDDEN, worded, with the
 * permission as a fact an agent matches on.
 *
 * Worded, because the UI shows this message to the caller verbatim and the assistant relays it.
 * The two refusals before it -- UNAUTHORIZED, and NOT_FOUND for a non-member -- deliberately
 * carry no message at all: what they must not do is confirm that the tenant exists. Past
 * membership the caller knows it does, and what helps them is the NAME of what they lack, so
 * they can ask someone who holds `people:manage` for a role that has it.
 */
export function permissionRefusal(
  ctx: { readonly locale: Locale; readonly tenantId: string },
  permission: Permission,
): TRPCError {
  return refusal(
    "FORBIDDEN",
    messages(ctx.locale)("error.requiresPermission", {
      permission,
      label: permissionLabel(ctx.locale, permission),
    }),
    { reason: "PERMISSION_REQUIRED", permission, tenantId: ctx.tenantId },
  );
}

/**
 * Which permission each guard `requirePermission` built stands for, keyed by the guard itself.
 *
 * How `procedureManifest` learns what a procedure needs: it walks the procedure's middleware
 * chain, as it does for `sessionProcedure`, and asks this of each link. Read from the running
 * router rather than written beside it, so a procedure cannot claim one permission in its
 * description and check another.
 */
const GUARDED = new WeakMap<object, Permission>();

/** The permission one middleware link guards, or `null` for a link that is not such a guard. */
export function permissionGuardedBy(middleware: unknown): Permission | null {
  return typeof middleware === "function" ? (GUARDED.get(middleware) ?? null) : null;
}

/**
 * Require `permission` in the tenant. FORBIDDEN here is correct: membership is established.
 *
 * Every tenant procedure that does more than any member may is built on this, naming exactly one
 * permission from the catalogue (`@undercroft/contracts/access`); which roles hold it is
 * `BUILT_IN_GRANTS`'s to say and Casbin's to decide (ADR 0139). It replaced
 * `requireRole(min)`, whose ladder could not say that a builder may save a model and may not
 * invite a person.
 *
 * On `tenantProcedure` unless told otherwise, so a procedure is refused on a deactivated
 * customer like every other. `tenantStatusProcedure` is passed by the two that must work there:
 * reactivating it, and reading its audit log.
 */
export function requirePermission(
  permission: Permission,
  on: typeof tenantStatusProcedure = tenantProcedure,
): ReturnType<typeof tenantProcedure.use> {
  const guarded = on.use(({ ctx, next }) => {
    if (!holds(ctx, permission)) {
      throw permissionRefusal(ctx, permission);
    }
    return next();
  });
  const guard: unknown = guarded._def.middlewares.at(-1);
  if (typeof guard === "function") {
    GUARDED.set(guard, permission);
  }
  return guarded;
}
