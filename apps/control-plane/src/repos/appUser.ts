/**
 * `app.app_user`: the AUTHORIZATION identity, keyed by email address.
 *
 * Not Better Auth's `app.auth_user`, which is the authentication identity. `app.tenant_member`
 * keys this table, so this uuid is the only id a procedure may act on. `services/invite.ts`
 * holds the seam between the two and explains why email is the join.
 *
 * Addresses arrive here already normalised -- the service lowercases and trims, because
 * `email` is `text UNIQUE` and Postgres would happily keep two rows for one person.
 */

import type { Locale } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";

/** Record the language this person reads, for the emails nobody's browser is open to see. */
export async function setLocale(exec: SqlExecutor, userId: string, locale: Locale): Promise<void> {
  await exec.query("UPDATE app.app_user SET locale = $2 WHERE id = $1", [userId, locale]);
}

/** The `app_user` id for an address, or `null` when there is no such user. */
export async function findIdByEmail(exec: SqlExecutor, email: string): Promise<string | null> {
  const { rows } = await exec.query<{ id: string }>(
    "SELECT id FROM app.app_user WHERE email = $1",
    [email],
  );
  return rows[0]?.id ?? null;
}

/** An `app_user` as the doors weigh it: who, and whether they are deactivated (ADR 0152). */
export interface UserStanding {
  readonly id: string;
  readonly deactivated: boolean;
}

/**
 * The `app_user` for an address and whether it is deactivated, or `null` when there is none.
 * One read, so "who" and "may they act" cannot be answered by two statements that disagree.
 */
export async function findStandingByEmail(
  exec: SqlExecutor,
  email: string,
): Promise<UserStanding | null> {
  const { rows } = await exec.query<{ id: string; deactivated: boolean }>(
    "SELECT id, deactivated_at IS NOT NULL AS deactivated FROM app.app_user WHERE email = $1",
    [email],
  );
  const [row] = rows;
  return row === undefined ? null : { id: row.id, deactivated: row.deactivated };
}

/**
 * Create the `app_user` for an address, or return the existing one.
 *
 * The no-op `DO UPDATE SET email = app.app_user.email` is what makes the statement return a
 * row on both paths: `DO NOTHING` returns none, and a caller that has just been told to
 * provision a user would then have nothing to write a membership against.
 */
export async function provisionByEmail(exec: SqlExecutor, email: string): Promise<string | null> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO app.app_user (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = app.app_user.email
     RETURNING id`,
    [email],
  );
  return rows[0]?.id ?? null;
}
