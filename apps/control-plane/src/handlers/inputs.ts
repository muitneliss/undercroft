/**
 * What the API accepts, as Zod schemas.
 *
 * Their own module because each carries a REFUSAL with a reason, and because the sub-routers
 * split out of `router.ts` all need them -- a schema that lives in one of them would make the
 * others import a sibling for a rule that belongs to none of them in particular.
 */

import { BUILT_IN_ROLES } from "@undercroft/contracts/access";
import { MAX_STEP_PAGE } from "@undercroft/contracts/runs";
import { z } from "zod";
import { STEP_VIEWS } from "../services/stepReport.ts";

/**
 * A role a person can be invited at or given: one of the built-ins (ADR 0139). The database's
 * CHECK on both role columns names the same four (`590_tenant_roles.sql`), so a key this accepts
 * is one the row will take, and one it refuses never reaches the statement.
 */
export const Role = z.enum(BUILT_IN_ROLES);

/**
 * A tenant reference, as typed into the create form.
 *
 * Constrained to the shape `.claude/rules/pii.md` requires -- letters, digits, hyphen and
 * underscore, no spaces -- because this value becomes an S3 key prefix in the raw lake and
 * a directory name, and because a reference is a CASE-id and never a customer's name. The
 * refusal is worth more than the convenience: a reference cannot be renamed once the lake
 * has written under it.
 */
export const TenantId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

/**
 * Addresses are stored and compared lowercased.
 *
 * `app.app_user.email` and the sign-in gate both normalise this way, and an invitation
 * written in different case from the address someone signs in with would never be redeemed.
 */
export const Email = z.string().trim().toLowerCase().email().max(320); // the longest address RFC 5321 allows

/** How many dbt steps one answer lists unless asked for more: a page an agent can read. */
const DEFAULT_STEP_PAGE = 100;

/**
 * Which of a run's dbt steps an answer lists (issue 441): `services/stepReport.ts` reads these
 * fields by these names, so a procedure that reports steps extends this and passes them on.
 * `runs.get` does; `models.build` is the other answer with steps to report.
 *
 * `steps` has no default here on purpose: left out it means `problems`, unless a step filter is
 * given -- see `StepQuery` in the service, which decides it for every answer at once. The page is
 * bounded by `MAX_STEP_PAGE`, which the web leaf asks for to list every step of a run.
 */
export const StepQuery = z.object({
  steps: z.enum(STEP_VIEWS).optional(),
  stepStatus: z.string().trim().min(1).max(32).optional(),
  stepKind: z.enum(["model", "test", "seed"]).optional(),
  stepName: z.string().trim().min(1).max(256).optional(),
  stepCursor: z.string().min(1).optional(),
  stepLimit: z.number().int().min(1).max(MAX_STEP_PAGE).default(DEFAULT_STEP_PAGE),
});
