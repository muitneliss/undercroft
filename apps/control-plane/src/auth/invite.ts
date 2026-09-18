/**
 * The invite gate: who is allowed to have a session at all.
 *
 * Undercroft has two identities for a person and this function is the seam between them.
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
 * Kept as a plain exported function rather than logic inside a Better Auth callback so it
 * can be driven directly in the offline gate: the library cannot boot against PGlite, but
 * this can, and this is the part that decides who gets in.
 */

import type { SqlExecutor } from "@undercroft/db";

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

  const existing = await exec.query<{ id: string }>(
    "SELECT id FROM app.app_user WHERE email = $1",
    [email],
  );
  let appUserId = existing.rows[0]?.id;

  const invitations = await exec.query<{ id: string; tenant_id: string; role: string }>(
    `SELECT id, tenant_id, role FROM app.invitation
     WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()`,
    [email],
  );

  // Neither known nor invited. An expired invitation lands here too, which is the point:
  // an invitation that has run out is not a weaker yes, it is a no.
  if (appUserId === undefined && invitations.rows.length === 0) return null;

  if (appUserId === undefined) {
    const created = await exec.query<{ id: string }>(
      `INSERT INTO app.app_user (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = app.app_user.email
       RETURNING id`,
      [email],
    );
    appUserId = created.rows[0]?.id;
    // The upsert above returns a row on both paths, so this cannot happen -- but an
    // undefined id would otherwise be written into a membership as a silent NULL.
    if (appUserId === undefined) {
      throw new Error(`could not provision an app_user for ${email}`);
    }
  }

  for (const invitation of invitations.rows) {
    await exec.query(
      `INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [invitation.tenant_id, appUserId, invitation.role],
    );
    await exec.query("UPDATE app.invitation SET accepted_at = now() WHERE id = $1", [
      invitation.id,
    ]);
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

  const { rows } = await exec.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM app.app_user WHERE email = $1
       UNION ALL
       SELECT 1 FROM app.invitation
       WHERE email = $1 AND accepted_at IS NULL AND expires_at > now()
     ) AS ok`,
    [email],
  );
  return rows[0]?.ok === true;
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

  const { rows } = await exec.query<{ id: string }>(
    "SELECT id FROM app.app_user WHERE email = $1",
    [email],
  );
  const id = rows[0]?.id;
  return id === undefined ? null : { appUserId: id, email };
}
