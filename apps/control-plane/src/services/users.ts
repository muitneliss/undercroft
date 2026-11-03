/**
 * People on the platform as a whole, and the one thing a platform superadmin can do about one:
 * deactivate them, or reactivate them. ADR 0152.
 *
 * Deactivation is beside a customer's own `people.removeMember`, not a stronger version of it.
 * Removing a member ends their access to ONE customer, and their `app_user` and every credential
 * they hold stay -- which is right, because they may belong to others. Deactivating a person ends
 * it everywhere, at once: from the next request they are nobody at every door (`standingOf` in
 * `invite.ts`), they cannot sign in even holding a live invitation (`admissionRefusal`), and every
 * credential they hold is revoked here. A customer's admin cannot do this, because they cannot
 * see the other customers it would cut the person off from.
 *
 * What it KEEPS is the `app_user` -- it keys the audit trail and everything the person saved --
 * and their memberships, so reactivating restores their access as it was. What it does NOT keep
 * is any credential: a reactivated person signs in again and mints new tokens, because a token
 * someone had reason to want dead should not come back to life by an unrelated decision.
 *
 * ## Why the revocation is two writes, not one transaction
 *
 * The person's state and their personal access tokens are our tables, and change in ONE statement
 * (`deactivateUser`). Their sessions, an OAuth app's refresh tokens and their consents are Better
 * Auth's, written through its adapter wherever it keeps them (`Offboarding.withdrawSignIns`) --
 * a second connection this module cannot enlist in a transaction. So they go FIRST: if that write
 * fails, nothing has been deactivated and pressing again repeats it whole; if the statement after
 * it fails, the person is not yet deactivated and has lost only credentials they can make again.
 * The other order would leave a deactivated person whose refresh tokens nobody will retry
 * revoking, because the second press answers "already deactivated". The door does not depend on
 * either: `standingOf` refuses a deactivated person whatever they present.
 */

import type { SqlExecutor } from "@undercroft/db";
import { findStandingByEmail } from "../repos/appUser.ts";
import { type Actor, record as recordAudit } from "../repos/auditLog.ts";
import {
  deactivateUser,
  listUsers,
  type PlatformUser,
  reactivateUser,
} from "../repos/userAccess.ts";

export type { PlatformUser } from "../repos/userAccess.ts";

/** What Better Auth held for a person and no longer does: how many of each were withdrawn. */
export interface Withdrawn {
  readonly sessions: number;
  readonly refreshTokens: number;
  readonly consents: number;
}

/**
 * What deactivating a person needs from outside the database, built by the composition root
 * (`handlers/context.ts`) and handed to the procedure on its context.
 *
 * - `isSuperadmin`: whether `UNDERCROFT_SUPERADMINS` names an address. The one question about
 *   ANOTHER address the platform's list answers, and only here: a superadmin is admitted by the
 *   environment before any query (ADR 0013), so a deactivation could revoke their credentials
 *   and never keep them out -- the refusal says to take the address out of the list instead.
 * - `withdrawSignIns`: delete the person's sessions and consents and revoke an OAuth app's
 *   refresh tokens, in Better Auth's own store. Zero of each where no sign-in was built.
 */
export interface Offboarding {
  readonly isSuperadmin: (email: string) => boolean;
  readonly withdrawSignIns: (email: string) => Promise<Withdrawn>;
}

/**
 * Offboarding where no sign-in was built and no superadmin is named: it withdraws nothing, since
 * nobody can hold a session, and names nobody. What a context built by a script or a suite that
 * never deactivates anyone carries.
 */
export const NO_OFFBOARDING: Offboarding = {
  isSuperadmin: () => false,
  withdrawSignIns: () => Promise.resolve({ sessions: 0, refreshTokens: 0, consents: 0 }),
};

/** Every person on the platform, with how many customers each belongs to and their state. */
export function list(exec: SqlExecutor): Promise<PlatformUser[]> {
  return listUsers(exec);
}

/** Everything a deactivation revoked, by kind. The audit row carries the same counts. */
export interface Revoked extends Withdrawn {
  readonly tokens: number;
}

/** Why a deactivation or reactivation changed nothing. The handler words each. */
export type UserRefusal =
  /** No person has that address. */
  | "not-found"
  /** Already in the state asked for: refused rather than reported as done, as for a customer. */
  | "already-deactivated"
  | "already-active"
  /** The caller's own address: a superadmin who did this would be locked out by themselves. */
  | "self"
  /** Named in `UNDERCROFT_SUPERADMINS`, which outranks the column (see `Offboarding`). */
  | "superadmin";

export type DeactivateResult =
  | {
      readonly ok: true;
      readonly email: string;
      readonly deactivatedAt: string;
      readonly revoked: Revoked;
    }
  | { readonly ok: false; readonly reason: UserRefusal };

export type ReactivateResult =
  | { readonly ok: true; readonly email: string; readonly deactivatedSince: string }
  | { readonly ok: false; readonly reason: UserRefusal };

/** Why a transition declined, read after its conditional UPDATE changed nothing. */
async function declined(exec: SqlExecutor, email: string): Promise<UserRefusal> {
  const now = await findStandingByEmail(exec, email);
  if (now === null) {
    return "not-found";
  }
  return now.deactivated ? "already-deactivated" : "already-active";
}

/**
 * Deactivate a person platform-wide and revoke every credential they hold. `email` arrives
 * normalised (`Email` in `handlers/inputs.ts`), as `app.app_user` keys it. Authority is not
 * re-checked: this is reachable through `superadminProcedure` alone.
 *
 * The state is checked before anything is withdrawn, so a refusal touches nothing; the
 * conditional UPDATE still decides a race, and the loser is told who won.
 */
export async function deactivate(
  exec: SqlExecutor,
  offboarding: Offboarding,
  input: { email: string; actor: Actor },
): Promise<DeactivateResult> {
  const { email, actor } = input;
  if (email === actor.email.toLowerCase()) {
    return { ok: false, reason: "self" };
  }
  if (offboarding.isSuperadmin(email)) {
    return { ok: false, reason: "superadmin" };
  }
  const before = await findStandingByEmail(exec, email);
  if (before === null) {
    return { ok: false, reason: "not-found" };
  }
  if (before.deactivated) {
    return { ok: false, reason: "already-deactivated" };
  }
  const withdrawn = await offboarding.withdrawSignIns(email);
  const changed = await deactivateUser(exec, email);
  if (changed === null) {
    return { ok: false, reason: await declined(exec, email) };
  }
  const revoked: Revoked = { tokens: changed.tokensRevoked, ...withdrawn };
  await recordAudit(exec, {
    tenantId: null,
    actor,
    action: "users.deactivate",
    detail: JSON.stringify({ email, deactivatedAt: changed.deactivatedAt, ...revoked }),
  });
  return { ok: true, email, deactivatedAt: changed.deactivatedAt, revoked };
}

/**
 * Reactivate a deactivated person: their memberships are as they were, so they hold again what
 * they held. The credentials the deactivation revoked stay revoked; they sign in again.
 *
 * The audit row carries when they had been deactivated, so the pair of rows reads as the whole
 * interval without a reader having to find the first one, as `tenants.reactivate`'s does.
 */
export async function reactivate(
  exec: SqlExecutor,
  input: { email: string; actor: Actor },
): Promise<ReactivateResult> {
  const { email, actor } = input;
  const changed = await reactivateUser(exec, email);
  if (changed === null) {
    return { ok: false, reason: await declined(exec, email) };
  }
  await recordAudit(exec, {
    tenantId: null,
    actor,
    action: "users.reactivate",
    detail: JSON.stringify({ email, deactivatedSince: changed.deactivatedSince }),
  });
  return { ok: true, email, deactivatedSince: changed.deactivatedSince };
}
