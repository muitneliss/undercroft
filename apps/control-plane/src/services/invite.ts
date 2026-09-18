/**
 * The invite gate: who is allowed to have a session at all.
 *
 * Undercroft has two identities for a person and this module is the seam between them.
 * Better Auth owns the AUTHENTICATION identity (`app.auth_user`, "this address proved it
 * controls a Google account or a mailbox"). `app.app_user` is the AUTHORIZATION identity --
 * it is what `app.tenant_member` keys, and therefore what every tenant-scoped procedure
 * resolves a role against. **Email is the join between them**, because it is the only value
 * both a Google profile and an emailed code yield.
 *
 * That trade-off, stated plainly: a person who changes the email on their Google account
 * becomes a different identity here, and an invitation must be accepted from the exact
 * address it was sent to. `SignIn.tsx` already says so on the denied path.
 *
 * Why invitation by address and not by token. `app.invitation` carries a `token_sha256` for
 * a link-based flow, and this gate does not ask for it. Presenting the token would prove
 * the person controls the mailbox -- which is precisely what Google or a one-time code has
 * *just* proved by stronger means. Requiring both would add a step that demonstrates
 * nothing new.
 *
 * Kept as plain exported functions rather than logic inside a Better Auth callback so they
 * can be driven directly in the offline gate: the library cannot boot against PGlite, but
 * these can, and this is the part that decides who gets in. The statements they run live in
 * `../repos/{appUser,invitation,membership}.ts`; what stays here is the order they happen
 * in, which is the part worth reading twice.
 */

import type { SqlExecutor } from "@undercroft/db";
import { findIdByEmail, provisionByEmail } from "../repos/appUser.ts";
import { record as recordAudit } from "../repos/auditLog.ts";
import { isKnownOrInvited, listLiveForEmail, markAccepted } from "../repos/invitation.ts";
import { addMember } from "../repos/membership.ts";

export interface InvitedUser {
  /** `app.app_user.id` -- the uuid `app.tenant_member` keys, never Better Auth's user id. */
  readonly appUserId: string;
  readonly email: string;
}

/**
 * Addresses are compared lowercased and trimmed.
 *
 * `app.app_user.email` is `text UNIQUE`, so Postgres would treat `A@x.test` and `a@x.test`
 * as two users. Google returns a lowercased address and a person typing their own address
 * into the OTP form will not, and two rows for one person means a session whose tenant list
 * is silently empty.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolve a just-authenticated address to its `app_user`, provisioning it from a live
 * invitation if this is the first sign-in.
 *
 * Returns `null` when the address has no `app_user` and no live invitation -- the caller
 * must refuse the sign-in. Returning `null` rather than throwing keeps "not invited" a
 * value the caller decides how to report, instead of an exception shape it has to match.
 *
 * Every live invitation for the address is accepted, not just the first: an operator may be
 * invited to several tenants before ever signing in, and honouring one while silently
 * leaving the rest pending is the kind of half-state nobody goes looking for.
 *
 * Run this inside a transaction (`withTransaction`). It reads, then writes on the basis of
 * what it read.
 */
export async function resolveInvitedUser(
  exec: SqlExecutor,
  rawEmail: string,
): Promise<InvitedUser | null> {
  const email = normalizeEmail(rawEmail);
  if (email === "") return null;

  let appUserId = await findIdByEmail(exec, email);
  const invitations = await listLiveForEmail(exec, email);

  // Neither known nor invited. An expired invitation lands here too, which is the point:
  // an invitation that has run out is not a weaker yes, it is a no.
  if (appUserId === null && invitations.length === 0) return null;

  if (appUserId === null) {
    appUserId = await provisionByEmail(exec, email);
    // The upsert returns a row on both paths, so this cannot happen -- but an absent id
    // would otherwise be written into a membership as a silent NULL.
    if (appUserId === null) {
      throw new Error(`could not provision an app_user for ${email}`);
    }
  }

  for (const invitation of invitations) {
    await addMember(exec, invitation.tenantId, appUserId, invitation.role);
    await markAccepted(exec, invitation.id);
  }

  return { appUserId, email };
}

/**
 * May this address hold a session at all? Read-only.
 *
 * The same question `resolveInvitedUser` answers, without the provisioning, for the two
 * places that must ask before anything has been created: the identity gate, and the decision
 * whether to put a one-time code in the post. Kept separate rather than given a `dryRun`
 * flag, because a gate that shares a code path with a writer is one refactor away from
 * provisioning the person it was supposed to refuse.
 */
export async function isAdmissible(exec: SqlExecutor, rawEmail: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  if (email === "") return false;
  return await isKnownOrInvited(exec, email);
}

/** How the person was trying to get in, so the trail distinguishes the two doors. */
export type RefusedVia = "google" | "email-otp";

/**
 * Record that an address was turned away.
 *
 * Deliberately NOT folded into `isAdmissible`: that function is the read-only gate, and a
 * gate that also writes is one refactor away from writing the wrong thing. This is a
 * separate call the caller makes once it has decided to refuse.
 *
 * It exists because the refusal was previously silent. A correct gate that leaves no trace
 * is indistinguishable from a broken one, and the first production sign-in cost a round of
 * guessing that one `SELECT` on this table would have answered: *which* address was
 * refused, which is exactly the thing a typo or the wrong Google account gets wrong.
 *
 * `tenantId` is null and `actor` is the address itself: a refused caller belongs to no
 * tenant and is not a user, so anything else here would be invented.
 *
 * Never allowed to break a sign-in. If the audit insert fails, the refusal still stands --
 * it is already decided -- and losing the log line is strictly better than turning a
 * deliberate "no" into a 500 that reads like an outage.
 */
export async function recordRefusal(
  exec: SqlExecutor,
  input: { email: string; via: RefusedVia },
): Promise<void> {
  try {
    await recordAudit(exec, {
      tenantId: null,
      actor: normalizeEmail(input.email),
      action: "auth.refused",
      detail: JSON.stringify({ via: input.via }),
    });
  } catch {
    // Intentionally swallowed; see above.
  }
}

/**
 * The `app_user` for an already-authenticated address, or `null`.
 *
 * The read half of the gate, used on every request once a session exists. It provisions
 * nothing: by the time a session is being resolved the `app_user` must already be there, and
 * creating one here would turn a revoked account into a working one.
 */
export async function appUserForEmail(
  exec: SqlExecutor,
  rawEmail: string,
): Promise<InvitedUser | null> {
  const email = normalizeEmail(rawEmail);
  if (email === "") return null;

  const id = await findIdByEmail(exec, email);
  return id === null ? null : { appUserId: id, email };
}
