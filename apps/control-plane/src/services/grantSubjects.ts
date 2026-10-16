/**
 * Who a grant, or a question about access, names: a role by key or a member by address, exactly
 * one, resolved against what the customer has -- and what that subject holds and reaches. ADR
 * 0141, ADR 0142.
 *
 * Its own module beside `grants.ts`, which keeps the writes, and `grantObjects.ts`, which keeps
 * what a grant gives: three procedures ask it -- `grants.*`, `grants.reach` and `scopes.preview`
 * (ADR 0143) -- and none of them owns it.
 */

import type { SqlExecutor } from "@undercroft/db";
import type { GrantSubject } from "../repos/accessGrants.ts";
import { rolePolicy } from "../repos/accessRoles.ts";
import { memberIdForEmail } from "../repos/membership.ts";
import { conferredBy, type Holding, heldByMember } from "./authz.ts";

/** Who a request names: a role by key, or a member by address -- exactly one. */
export interface NamedSubject {
  readonly role?: string | undefined;
  readonly email?: string | undefined;
}

export type SubjectRefusal = "one-subject" | "no-such-role" | "not-member";

export type Resolved =
  | { readonly ok: true; readonly subject: GrantSubject }
  | { readonly ok: false; readonly reason: SubjectRefusal };

/** The subject a request names, resolved against what the customer has. */
export async function resolve(
  exec: SqlExecutor,
  tenantId: string,
  named: NamedSubject,
): Promise<Resolved> {
  if ((named.role === undefined) === (named.email === undefined)) {
    return { ok: false, reason: "one-subject" };
  }
  if (named.role !== undefined) {
    return (await rolePolicy(exec, tenantId, named.role)) === null
      ? { ok: false, reason: "no-such-role" }
      : { ok: true, subject: { kind: "role", role: named.role } };
  }
  const userId = await memberIdForEmail(exec, tenantId, named.email ?? "");
  return userId === null
    ? { ok: false, reason: "not-member" }
    : { ok: true, subject: { kind: "user", userId } };
}

export type ReachOutcome =
  | { readonly ok: true; readonly holding: Holding }
  | { readonly ok: false; readonly reason: SubjectRefusal };

/**
 * What a role confers or a member holds -- the permissions, and what they reach, as Casbin decides
 * them -- or, naming nobody, what the caller holds. The question to ask before a grant and after
 * it: "what can this person see now".
 */
export async function holdingFor(
  exec: SqlExecutor,
  input: NamedSubject & { tenantId: string; caller: Holding },
): Promise<ReachOutcome> {
  if (input.role === undefined && input.email === undefined) {
    return { ok: true, holding: input.caller };
  }
  if (input.role !== undefined && input.email !== undefined) {
    return { ok: false, reason: "one-subject" };
  }
  if (input.role !== undefined) {
    const holding = await conferredBy(exec, input.tenantId, input.role);
    return holding === null ? { ok: false, reason: "no-such-role" } : { ok: true, holding };
  }
  const holding = await heldByMember(exec, input.tenantId, input.email ?? "");
  return holding === null ? { ok: false, reason: "not-member" } : { ok: true, holding };
}
