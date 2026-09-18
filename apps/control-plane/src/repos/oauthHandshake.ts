/**
 * `app.oauth_handshake`: one in-flight OAuth consent.
 *
 * Written when an admin starts a flow, consumed exactly once by the callback, and gone.
 *
 * **The state is stored as a digest**, exactly as `app.invitation.token_sha256` is, so a
 * database read yields something that cannot be replayed. The PKCE verifier is *not*
 * hashed -- it has to go back to Google verbatim -- which is why this table lives in `app`,
 * the schema BI has no USAGE on.
 *
 * **Consumption is one statement.** `DELETE ... RETURNING` is what makes single-use a
 * property rather than a hope: a read-then-delete leaves a window in which a replayed
 * callback finds the row still there.
 */

// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "@undercroft/db";

export interface Handshake {
  readonly tenantId: string;
  readonly source: string;
  readonly verifier: string;
  readonly requestedScope: string;
  readonly startedBy: string;
}

export async function startHandshake(
  exec: SqlExecutor,
  input: {
    stateSha256: string;
    tenantId: string;
    source: string;
    verifier: string;
    requestedScope: string;
    startedBy: string;
    expiresAt: string;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO app.oauth_handshake
       (state_sha256, tenant_id, source, verifier, requested_scope, started_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.stateSha256,
      input.tenantId,
      input.source,
      input.verifier,
      input.requestedScope,
      input.startedBy,
      input.expiresAt,
    ],
  );
}

/**
 * Take the handshake for this state, if it is still live.
 *
 * Returns `null` for unknown, already-used and expired alike. The caller refuses all three
 * identically and says nothing about which: distinguishing them in a response would tell an
 * attacker whether a state they guessed had ever existed.
 */
export async function consumeHandshake(
  exec: SqlExecutor,
  stateSha256: string,
): Promise<Handshake | null> {
  const { rows } = await exec.query<{
    tenant_id: string;
    source: string;
    verifier: string;
    requested_scope: string;
    started_by: string;
  }>(
    `DELETE FROM app.oauth_handshake
     WHERE state_sha256 = $1 AND expires_at > now()
     RETURNING tenant_id, source, verifier, requested_scope, started_by`,
    [stateSha256],
  );
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return {
    tenantId: row.tenant_id,
    source: row.source,
    verifier: row.verifier,
    requestedScope: row.requested_scope,
    startedBy: row.started_by,
  };
}

/**
 * Drop handshakes that were started and never finished.
 *
 * A consent an admin abandoned leaves a row with a live PKCE verifier in it. Expiry already
 * makes it unusable; this is what stops the table growing forever, and it is called from the
 * start path so it needs no scheduler.
 */
export async function pruneExpiredHandshakes(exec: SqlExecutor): Promise<number> {
  const { rows } = await exec.query<{ state_sha256: string }>(
    "DELETE FROM app.oauth_handshake WHERE expires_at <= now() RETURNING state_sha256",
  );
  return rows.length;
}
