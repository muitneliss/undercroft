/**
 * Who may see a tenant, and how they came to be invited.
 *
 * This is what closes the loop on invite-only sign-in: the gate admits an address that has
 * a live `app.invitation` row, and `invite` is how such a row comes to exist without anyone
 * opening a SQL client.
 *
 * Every outcome is a VALUE, not an exception: `invite` reports `already-member` and
 * `not-created` the same way it reports success, and `revokeInvitation` answers `false`
 * when there was nothing open to withdraw. The handler turns those into CONFLICT and
 * NOT_FOUND. That is what makes this callable from a future CLI or backfill without
 * catching tRPC errors.
 *
 * No invitation token is ever returned or sent. `app.invitation.token_sha256` exists for a
 * link-based flow that this one does not use: Google and a one-time code already prove the
 * person controls the address, which is the only thing a token would have proved. A digest
 * of a random value is stored so the column keeps its shape and nothing replayable exists.
 */

import type { EmailMessage, Locale } from "@undercroft/core";
import { hashToken, randomToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { messages } from "../i18n/index.ts";
import { record as recordAudit } from "../repos/auditLog.ts";
import * as invitations from "../repos/invitation.ts";
import { listMembers, type Member, roleForEmail } from "../repos/membership.ts";

export type { Member };
export type Invitation = invitations.InvitationRow;

/** How long an invitation stays open. Long enough to be acted on, short enough to expire. */
const INVITATION_DAYS = 7;

export type InviteResult =
  | { readonly ok: true; readonly id: string; readonly notified: boolean }
  /** The address already has access. `role` is what it already holds, for the message. */
  | { readonly ok: false; readonly reason: "already-member"; readonly role: string }
  /** The insert returned no row. Not expected; reported rather than assumed away. */
  | { readonly ok: false; readonly reason: "not-created" };

/**
 * What an invited person is told, in one place.
 *
 * A pure value: composing the words is a decision, sending them is transport. Both callers
 * that can send — the People page and `bun run invite` — build their own sender and use this
 * wording, so the two cannot drift into saying different things about the same invitation.
 *
 * The message carries no token and no link that grants anything: the invitation is keyed by
 * the address, so this is a nudge to go and sign in, not a credential. That is why it is
 * safe to email, and why losing the email costs nothing but a conversation.
 *
 * `locale` is the admin's, because it is the only language anyone knows: an invited address
 * has never signed in, so this platform holds no preference for it. The admin inviting a
 * Vietnamese colleague is reading Vietnamese, and their colleague almost certainly does too.
 * It is a guess about a *language*, not about a value, and it is recoverable in a way rule 2
 * is about -- an invitation in the wrong language still says who sent it and where to sign
 * in, where a guessed amount just reads as a fact.
 */
export function invitationMessage(
  to: string,
  tenantId: string,
  publicUrl: string,
  locale: Locale,
): EmailMessage {
  const t = messages(locale);
  return {
    to,
    subject: t("invitation.subject"),
    // One catalogue entry per language rather than three concatenated fragments: Vietnamese
    // and English do not share word order, and a sentence assembled from pieces can only be
    // right in the language it was assembled in.
    text: t("invitation.body", { tenantId, publicUrl, email: to }),
  };
}

export function members(exec: SqlExecutor, tenantId: string): Promise<Member[]> {
  return listMembers(exec, tenantId);
}

export function invitationsFor(exec: SqlExecutor, tenantId: string): Promise<Invitation[]> {
  return invitations.listByTenant(exec, tenantId);
}

/**
 * Invite an address to a tenant, in the order the steps must happen.
 *
 * Re-inviting an address with a live invitation REFRESHES it rather than adding a second
 * row: two open invitations for one address would both be redeemed at first sign-in, which
 * is a confusing way to grant one membership. The new row is written first and the older
 * ones superseded after, so a failure between the two leaves an extra open invitation --
 * which the gate redeems harmlessly -- rather than none at all.
 *
 * Whether the invitee was told is reported, never assumed: with no mail configured the
 * invitation is still valid and the admin has to pass the address on by hand. `notify` is
 * injected because sending is the transport's business, not this decision's.
 */
export async function invite(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    email: string;
    role: string;
    actor: string;
    notify: (email: string, tenantId: string) => Promise<boolean>;
  },
): Promise<InviteResult> {
  const held = await roleForEmail(exec, input.tenantId, input.email);
  if (held !== null) {
    return { ok: false, reason: "already-member", role: held };
  }

  const id = await invitations.create(exec, {
    tenantId: input.tenantId,
    email: input.email,
    role: input.role,
    tokenDigest: hashToken(randomToken()),
    days: INVITATION_DAYS,
  });
  if (id === null) {
    return { ok: false, reason: "not-created" };
  }

  await invitations.supersedeOthers(exec, input.tenantId, input.email, id);

  await recordAudit(exec, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "people.invite",
    detail: JSON.stringify({ email: input.email, role: input.role }),
  });

  const notified = await input.notify(input.email, input.tenantId);
  return { ok: true, id, notified };
}

/** Withdraw an invitation that has not been accepted. `false` if there was none open. */
export function revokeInvitation(
  exec: SqlExecutor,
  input: { id: string; tenantId: string },
): Promise<boolean> {
  return invitations.deleteOpen(exec, input.id, input.tenantId);
}
