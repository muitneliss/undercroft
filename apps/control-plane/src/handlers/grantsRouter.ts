/**
 * The `grants` procedures: one permission, or reading one thing, given to a role or to one
 * member, standing or until a moment. ADR 0141, ADR 0142.
 *
 * Reading them needs `people:manage`, not `roles:manage`: a grant to a person says who holds what,
 * which is the roster's information and is read by whoever may read the roster (ADR 0119). Giving
 * or taking one away needs `roles:manage` and the subset rule inside the service. `reach` answers
 * what a role, a member or the caller may do and read, decided as every request decides it.
 *
 * What a grant gives is `permission` (a catalogue key) or `object` (`model:fct_sales`,
 * `raw:hubspot/deals`, `report:question:<uuid>`, or `model:*` and its kin) -- exactly one, as two
 * fields for the reason the subject is two.
 *
 * A subject is `role` (a key) or `email` (a member's address), exactly one of the two -- two plain
 * fields rather than a nested object, so a person at the CLI types `--role` or `--email` and an
 * agent fills one field.
 */

import type { TRPCError } from "@trpc/server";
import { HiddenColumnsShape, RowRuleShape } from "@undercroft/contracts";
import { PERMISSIONS } from "@undercroft/contracts/access";
import type { Locale } from "@undercroft/core";
import { z } from "zod";

import { messages } from "../i18n/index.ts";
import { holds } from "../services/authz.ts";
import * as grants from "../services/grants.ts";
import { holdingFor } from "../services/grantSubjects.ts";
import { noSuchRoleRefusal, notHeldRefusal, notMemberRefusal } from "./accessRefusals.ts";
import { Email, Role } from "./inputs.ts";
import { permissionRefusal, requirePermission } from "./permissionGate.ts";
import { actorOf, refusal, router, tenantProcedure } from "./trpc.ts";

/** The longest object a grant names: a source, a slash and an entity of 128 characters. */
const MAX_OBJECT_CHARS = 256;

/** Who a request names, as the schema takes it: a role by key, or a member by address. */
const Subject = { role: Role.optional(), email: Email.optional() };

/** The refusal for a subject that could not be resolved, worded for the caller. */
function subjectRefusal(
  ctx: { readonly locale: Locale; readonly tenantId: string },
  reason: "one-subject" | "no-such-role" | "not-member",
  named: { readonly role?: string | undefined; readonly email?: string | undefined },
): TRPCError {
  switch (reason) {
    case "one-subject":
      return refusal("BAD_REQUEST", messages(ctx.locale)("error.grantOneSubject"), {
        reason: "ONE_SUBJECT",
      });
    case "no-such-role":
      return noSuchRoleRefusal(ctx, named.role ?? "");
    default:
      return notMemberRefusal(ctx, named.email ?? "");
  }
}

/** A refusal about a grant's rules (ADR 0143), or about the grant changing while it was saved. */
type RuleOutcome = Extract<
  grants.SaveOutcome,
  { readonly reason: "rules-need-one-model" | "eq-one-value" | "unknown-column" | "changed" }
>;

function ruleRefusal(locale: Locale, outcome: RuleOutcome): TRPCError {
  const t = messages(locale);
  switch (outcome.reason) {
    case "rules-need-one-model":
      return refusal("BAD_REQUEST", t("error.grantRulesOneModel"), {
        reason: "RULES_NEED_ONE_MODEL",
      });
    case "eq-one-value":
      return refusal("BAD_REQUEST", t("error.ruleEqualsOne"), { reason: "RULE_SHAPE" });
    case "unknown-column":
      return refusal(
        "BAD_REQUEST",
        t(outcome.known.length === 0 ? "error.grantNoColumnsYet" : "error.grantUnknownColumn", {
          model: outcome.model,
          columns: outcome.unknown.join(", "),
          known: outcome.known.join(", "),
        }),
        { reason: "COLUMN_NOT_FOUND", model: outcome.model, columns: outcome.unknown.join(",") },
      );
    default:
      return refusal("CONFLICT", t("error.grantChanged"), { reason: "GRANT_CHANGED" });
  }
}

export const grantsRouter = router({
  /**
   * Every grant in the customer, expired ones included and marked, or the grants to one role or
   * one member. Each names its permission, or `null` for one the catalogue no longer knows.
   */
  list: requirePermission("people:manage")
    .input(z.object(Subject))
    .query(async ({ ctx, input }) => {
      const outcome = await grants.list(ctx.exec, ctx.tenantId, input);
      if (!outcome.ok) {
        throw subjectRefusal(ctx, outcome.reason, input);
      }
      return outcome.grants;
    }),

  /**
   * Give a permission to a role or a member, standing or until `expiresAt` (an ISO 8601 moment
   * with its offset). The same grant stored already has its expiry and rules replaced; an
   * identical one is `unchanged: true`. Refused for a permission the caller does not hold.
   *
   * A grant on one model may carry `rowRule` -- conditions a row must all meet -- and
   * `hiddenColumns` (ADR 0143), each naming the model's columns as its last build found them; the
   * caller must reach at least as much of the model as the rule gives.
   */
  save: requirePermission("roles:manage")
    .input(
      z.object({
        ...Subject,
        permission: z.enum(PERMISSIONS).optional(),
        object: z.string().trim().min(1).max(MAX_OBJECT_CHARS).optional(),
        expiresAt: z.string().datetime({ offset: true }).nullable().default(null),
        rowRule: RowRuleShape.optional(),
        hiddenColumns: HiddenColumnsShape.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const outcome = await grants.save(ctx.exec, {
        tenantId: ctx.tenantId,
        role: input.role,
        email: input.email,
        permission: input.permission,
        object: input.object,
        rowRule: input.rowRule,
        hiddenColumns: input.hiddenColumns,
        expiresAt: input.expiresAt,
        held: { permissions: ctx.permissions, reach: ctx.reach },
        now: new Date(),
        actor: actorOf(ctx),
        actorId: ctx.user.userId,
      });
      if (outcome.ok) {
        return { id: outcome.id, unchanged: outcome.unchanged };
      }
      const t = messages(ctx.locale);
      switch (outcome.reason) {
        case "not-held":
          throw notHeldRefusal(ctx, outcome.lacking, outcome.objects);
        case "one-object":
          throw refusal("BAD_REQUEST", t("error.grantOneObject"), { reason: "ONE_OBJECT" });
        case "unknown-object":
          throw refusal(
            "BAD_REQUEST",
            t("error.grantObjectShape", { object: input.object ?? "" }),
            {
              reason: "OBJECT_SHAPE",
              object: input.object ?? null,
            },
          );
        case "no-such-object":
          throw refusal("NOT_FOUND", t("error.noSuchObject", { object: outcome.object }), {
            reason: "OBJECT_NOT_FOUND",
            object: outcome.object,
          });
        case "expired":
          throw refusal(
            "BAD_REQUEST",
            t("error.grantExpiryPassed", { expiresAt: input.expiresAt ?? "" }),
            { reason: "EXPIRY_PASSED", expiresAt: input.expiresAt },
          );
        case "rules-need-one-model":
        case "eq-one-value":
        case "unknown-column":
        case "changed":
          throw ruleRefusal(ctx.locale, outcome);
        default:
          throw subjectRefusal(ctx, outcome.reason, input);
      }
    }),

  /** Take one grant away, by id. Refused for a grant of a permission the caller does not hold. */
  delete: requirePermission("roles:manage")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const outcome = await grants.remove(ctx.exec, {
        tenantId: ctx.tenantId,
        id: input.id,
        held: { permissions: ctx.permissions, reach: ctx.reach },
        actor: actorOf(ctx),
      });
      if (outcome.ok) {
        return { ok: true };
      }
      if (outcome.reason === "not-held") {
        throw notHeldRefusal(ctx, outcome.lacking, outcome.objects);
      }
      throw refusal("NOT_FOUND", messages(ctx.locale)("error.noSuchGrant"), {
        reason: "GRANT_NOT_FOUND",
        id: input.id,
      });
    }),

  /**
   * What a role confers, a member holds, or -- naming nobody -- the caller holds: the permissions,
   * and what they reach (`models`, `raw`, `reports`: `"all"`, or the named things), as Casbin
   * decides them on every request. Ask it before a grant and after it. About oneself any member
   * may ask; about a role or another person it needs `people:manage`, checked inside, because who
   * holds what is the roster's information (ADR 0119).
   */
  reach: tenantProcedure.input(z.object(Subject)).query(async ({ ctx, input }) => {
    if ((input.role !== undefined || input.email !== undefined) && !holds(ctx, "people:manage")) {
      throw permissionRefusal(ctx, "people:manage");
    }
    const outcome = await holdingFor(ctx.exec, {
      tenantId: ctx.tenantId,
      role: input.role,
      email: input.email,
      caller: { permissions: ctx.permissions, reach: ctx.reach },
    });
    if (!outcome.ok) {
      throw subjectRefusal(ctx, outcome.reason, input);
    }
    return outcome.holding;
  }),
});
