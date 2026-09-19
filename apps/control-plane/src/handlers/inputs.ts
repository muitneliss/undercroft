/**
 * What the API accepts, as Zod schemas.
 *
 * Their own module because each carries a REFUSAL with a reason, and a refusal is easier to
 * find and to test when it is not buried above three hundred lines of procedures.
 */

import { z } from "zod";

export const Role = z.enum(["viewer", "member", "admin"]);

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
