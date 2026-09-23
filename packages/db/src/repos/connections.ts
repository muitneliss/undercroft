/**
 * The connection registry: which tenant has connected what, and with which credential.
 *
 * Two tables, deliberately split:
 *
 *   ops.connection          -- status and the external account. No secret material, so
 *                              the BI role and the operator UI may read it.
 *   app.connection_secret   -- the sealed credential, same key, in a schema BI cannot see.
 *
 * The credential is one sealed JSON bundle, not a column per field: providers hand back
 * differently shaped objects (a rotating pair, a fixed refresh token, an access token with
 * an expiry), and a column per field would be a union of shapes, mostly null. `expires_at`
 * is kept in the clear beside the ciphertext so "which connections need attention" is a
 * query rather than a decrypt-everything loop.
 *
 * **Refreshing takes a row lock.** Xero rotates its refresh token and invalidates the old
 * one the instant it is used, so two concurrent refreshes do not race -- they destroy the
 * connection and the customer must re-consent. `SELECT ... FOR UPDATE`, inside a
 * transaction, is what makes that impossible rather than unlikely. `readCredential` with
 * `forUpdate` must be called within `withTransaction`; the FOR UPDATE only holds a lock
 * inside one.
 *
 * This module holds no HTTP and decides nothing. *When* a credential is too old to use, and
 * what to do when it cannot be refreshed, is one layer up in
 * `../services/credentials.ts` -- that decision is worth testing with no database, and this
 * SQL is worth reading with no policy mixed into it.
 */

import { seal, unseal } from "@undercroft/crypto";
import type { SqlExecutor } from "../executor.ts";

export class ConnectionRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionRegistryError";
  }
}

export interface Credential {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** ISO 8601, or null for a credential that does not expire (a HubSpot private app). */
  readonly expiresAt: string | null;
}

/**
 * How often the source is read. The words and the rule that turns them into a time are in
 * `@undercroft/contracts`; this repo stores the word and decides nothing about it.
 */
export type Cadence = "hourly" | "every_6h" | "daily" | "paused";

export interface Connection {
  readonly tenantId: string;
  readonly source: string;
  readonly status: "disconnected" | "connected" | "error" | "expired";
  readonly externalAccountId: string | null;
  readonly scope: string;
  readonly cadence: Cadence;
}

function credentialToJson(c: Credential): string {
  return JSON.stringify({
    accessToken: c.accessToken,
    refreshToken: c.refreshToken,
    expiresAt: c.expiresAt,
  });
}

function credentialFromJson(blob: string): Credential {
  const data = JSON.parse(blob) as Partial<Credential>;
  return {
    accessToken: data.accessToken ?? "",
    refreshToken: data.refreshToken ?? "",
    expiresAt: data.expiresAt ?? null,
  };
}

export async function listConnections(exec: SqlExecutor, tenantId: string): Promise<Connection[]> {
  const { rows } = await exec.query<Connection>(
    `SELECT tenant_id AS "tenantId", source, status,
            external_account_id AS "externalAccountId", scope, cadence
     FROM ops.connection WHERE tenant_id = $1 ORDER BY source`,
    [tenantId],
  );
  return rows;
}

export async function getConnection(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
): Promise<Connection | null> {
  const { rows } = await exec.query<Connection>(
    `SELECT tenant_id AS "tenantId", source, status,
            external_account_id AS "externalAccountId", scope, cadence
     FROM ops.connection WHERE tenant_id = $1 AND source = $2`,
    [tenantId, source],
  );
  return rows[0] ?? null;
}

/** Record how often a source is read. `false` means there is no such connection to set it on. */
export async function setCadence(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  cadence: Cadence,
): Promise<boolean> {
  const { rows } = await exec.query<{ source: string }>(
    `UPDATE ops.connection SET cadence = $3, updated_at = now()
     WHERE tenant_id = $1 AND source = $2
     RETURNING source`,
    [tenantId, source, cadence],
  );
  return rows.length > 0;
}

/**
 * Everything the schedule needs to decide whether a connected pair is due.
 *
 * Connected rows only; which of them is due is decided one layer up, by the rule in
 * `@undercroft/contracts`, so this query stays a read of what is recorded. The selection
 * comes back as JSON text for the same reason as in `readConnectionDetail`.
 */
export interface DueCandidate {
  readonly tenantId: string;
  readonly source: string;
  readonly status: "connected";
  readonly cadence: Cadence;
  readonly selectionJson: string;
  readonly lastRunStartedAt: string | null;
  readonly lastRunStatus: "running" | "ok" | "failed" | null;
}

export async function listDueCandidates(exec: SqlExecutor): Promise<DueCandidate[]> {
  const { rows } = await exec.query<{
    tenantId: string;
    source: string;
    cadence: Cadence;
    selectionJson: string | null;
    lastRunStartedAt: Date | string | null;
    lastRunStatus: DueCandidate["lastRunStatus"];
  }>(
    `SELECT c.tenant_id AS "tenantId", c.source, c.cadence,
            d.selection::text AS "selectionJson",
            r.started_at      AS "lastRunStartedAt",
            r.status          AS "lastRunStatus"
     FROM ops.connection c
     LEFT JOIN app.connection_detail d ON d.tenant_id = c.tenant_id AND d.source = c.source
     LEFT JOIN LATERAL (
       SELECT started_at, status FROM ops.run
       WHERE tenant_id = c.tenant_id AND source = c.source AND verb = 'ingest'
       ORDER BY started_at DESC, id DESC LIMIT 1
     ) r ON true
     WHERE c.status = 'connected'
     ORDER BY c.tenant_id, c.source`,
  );
  return rows.map((row) => ({
    tenantId: row.tenantId,
    source: row.source,
    status: "connected",
    cadence: row.cadence,
    selectionJson: row.selectionJson ?? "{}",
    lastRunStartedAt:
      row.lastRunStartedAt === null ? null : new Date(row.lastRunStartedAt).toISOString(),
    lastRunStatus: row.lastRunStatus,
  }));
}

/**
 * Record a connection, or refuse because it belongs to another account.
 *
 * **An account id, once recorded, is only ever replaced by itself.** A source names one
 * account (ADR 0043), so a credential for a different account offered to it is not a
 * reconnect -- it would file that account's mail under this one's stream, green, with nothing
 * erroring. The guard is the statement's own `WHERE`, not a read-then-write in the caller,
 * because two consents racing for one source must not both pass a check neither can see the
 * other make: the conflict row is locked, and whoever comes second finds the first's account.
 * `false` means nothing was written.
 *
 * An EMPTY incoming id pins nothing and erases nothing: a Xero consent names no organisation
 * (the admin chooses one afterwards) and a pasted HubSpot token names no account, and each
 * used to blank the id a previous choice had recorded -- which left a reconnected Xero unable
 * to run until its scope was saved again.
 */
export async function upsertConnection(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    source: string;
    status?: Connection["status"];
    externalAccountId?: string | null;
    scope?: string;
  },
): Promise<boolean> {
  const { rows } = await exec.query<{ source: string }>(
    `INSERT INTO ops.connection (tenant_id, source, status, external_account_id, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, source) DO UPDATE SET
       status              = EXCLUDED.status,
       external_account_id = COALESCE(NULLIF(EXCLUDED.external_account_id, ''),
                                      ops.connection.external_account_id),
       scope               = EXCLUDED.scope,
       updated_at          = now()
     WHERE COALESCE(EXCLUDED.external_account_id, '') = ''
        OR COALESCE(ops.connection.external_account_id, '') = ''
        OR ops.connection.external_account_id = EXCLUDED.external_account_id
     RETURNING source`,
    [
      input.tenantId,
      input.source,
      input.status ?? "connected",
      input.externalAccountId ?? null,
      input.scope ?? "",
    ],
  );
  return rows.length > 0;
}

/**
 * Record the provider's own account id -- a Xero organisation, chosen after consent.
 *
 * On `ops.connection` because a run needs it and BI may see it: it is an opaque id, never a
 * name. The name goes to `app.connection_detail` with the rest of the choice.
 */
export async function setExternalAccount(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  externalAccountId: string,
): Promise<void> {
  await exec.query(
    `UPDATE ops.connection SET external_account_id = $3, updated_at = now()
     WHERE tenant_id = $1 AND source = $2`,
    [tenantId, source, externalAccountId],
  );
}

export async function setStatus(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  status: Connection["status"],
): Promise<void> {
  await exec.query(
    "UPDATE ops.connection SET status = $3, updated_at = now() WHERE tenant_id = $1 AND source = $2",
    [tenantId, source, status],
  );
}

/**
 * Seal and store a credential.
 *
 * `grantExpiresAt` is when the GRANT lapses -- `services/grantExpiry.ts` decides it -- and it
 * is kept in the clear beside the ciphertext for the same reason `expires_at` is: "which
 * grants are about to lapse" has to be a query. A new grant end clears `warned_at`, so a
 * grant renewed after a warning is warned about again when it next approaches its end.
 */
export async function writeCredential(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  credential: Credential,
  opts: { env?: NodeJS.ProcessEnv; grantExpiresAt?: string | null } = {},
): Promise<void> {
  const sealed = seal(
    credentialToJson(credential),
    opts.env === undefined ? {} : { env: opts.env },
  );
  await exec.query(
    `INSERT INTO app.connection_secret
       (tenant_id, source, ciphertext, key_version, expires_at, grant_expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (tenant_id, source) DO UPDATE SET
       ciphertext       = EXCLUDED.ciphertext,
       key_version      = EXCLUDED.key_version,
       expires_at       = EXCLUDED.expires_at,
       grant_expires_at = EXCLUDED.grant_expires_at,
       warned_at        = CASE
         WHEN EXCLUDED.grant_expires_at IS DISTINCT FROM app.connection_secret.grant_expires_at
         THEN NULL ELSE app.connection_secret.warned_at END,
       updated_at       = now()`,
    [
      tenantId,
      source,
      Buffer.from(sealed.blob),
      sealed.keyVersion,
      credential.expiresAt,
      opts.grantExpiresAt ?? null,
    ],
  );
}

/** A grant about to lapse, as the warning names it. */
export interface ExpiringGrant {
  readonly tenantId: string;
  readonly source: string;
  readonly grantExpiresAt: string;
}

/**
 * Claim every grant lapsing within `withinDays` that has not been warned about.
 *
 * One UPDATE that marks and returns: a second tick, or a second replica, finds nothing. A
 * grant already lapsed is not claimed -- the card says "reconnect" for that, and a warning
 * about the past is noise.
 */
export async function claimExpiringGrants(
  exec: SqlExecutor,
  withinDays: number,
): Promise<ExpiringGrant[]> {
  const { rows } = await exec.query<{
    tenant_id: string;
    source: string;
    grant_expires_at: Date | string;
  }>(
    `UPDATE app.connection_secret SET warned_at = now()
     WHERE grant_expires_at IS NOT NULL AND warned_at IS NULL
       AND grant_expires_at > now()
       AND grant_expires_at <= now() + make_interval(days => $1::int)
     RETURNING tenant_id, source, grant_expires_at`,
    [withinDays],
  );
  return rows.map((row) => ({
    tenantId: row.tenant_id,
    source: row.source,
    grantExpiresAt: new Date(row.grant_expires_at).toISOString(),
  }));
}

/**
 * Open the sealed credential.
 *
 * `forUpdate` takes a row lock, which callers about to refresh must use. It only holds
 * inside a transaction; on autocommit it locks for the statement and no longer.
 */
export async function readCredential(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  opts: { forUpdate?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<Credential> {
  const { rows } = await exec.query<{ ciphertext: Uint8Array; key_version: number }>(
    `SELECT ciphertext, key_version FROM app.connection_secret
     WHERE tenant_id = $1 AND source = $2${opts.forUpdate === true ? " FOR UPDATE" : ""}`,
    [tenantId, source],
  );
  const [row] = rows;
  if (row === undefined) {
    throw new ConnectionRegistryError(
      `no stored credential for tenant ${JSON.stringify(tenantId)} source ${JSON.stringify(source)}; ` +
        "the connection has not completed its OAuth flow",
    );
  }
  const opened = unseal({ blob: row.ciphertext, keyVersion: row.key_version }, opts.env);
  return credentialFromJson(opened);
}

/**
 * What the admin chose to share, and the account it belongs to.
 *
 * `app.connection_detail` rather than a column on `ops.connection`, because BI holds
 * `SELECT ON ops.connection` and a table-level grant covers columns added later -- a label
 * named "Invoices/Acme Pte Ltd" on that table would be one dbt model from a dashboard. See
 * `packages/db/sql/070_google_ingestion.sql`.
 *
 * `selection` comes back as JSON *text*, not a parsed object. The caller decides what shape
 * it expects and parses it there; a repo that interpreted it would have to know what a Gmail
 * label is.
 */
export interface ConnectionDetail {
  readonly accountLabel: string;
  readonly selectionJson: string;
  readonly chosenAt: string | null;
}

export async function readConnectionDetail(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
): Promise<ConnectionDetail | null> {
  const { rows } = await exec.query<{
    account_label: string;
    selection: unknown;
    chosen_at: Date | string | null;
  }>(
    `SELECT account_label, selection::text AS selection, chosen_at
     FROM app.connection_detail WHERE tenant_id = $1 AND source = $2`,
    [tenantId, source],
  );
  const [row] = rows;
  if (row === undefined) {
    return null;
  }
  return {
    accountLabel: row.account_label,
    selectionJson: typeof row.selection === "string" ? row.selection : "{}",
    chosenAt: row.chosen_at === null ? null : new Date(row.chosen_at).toISOString(),
  };
}

/**
 * Record what an admin chose.
 *
 * `selectionJson` is passed through as text and cast by Postgres, never re-serialised here:
 * the same rule the raw loader follows, for the same reason.
 */
export async function writeConnectionDetail(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    source: string;
    accountLabel?: string;
    selectionJson?: string;
    chosenBy?: string;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO app.connection_detail
       (tenant_id, source, account_label, selection, chosen_at, chosen_by, updated_at)
     -- The COALESCEs here are the column defaults. A first write that sets only a selection
     -- must not put NULL into account_label, which is NOT NULL.
     VALUES ($1, $2, COALESCE($3, ''), COALESCE($4::jsonb, '{}'::jsonb), $5, COALESCE($6, ''), now())
     ON CONFLICT (tenant_id, source) DO UPDATE SET
       -- COALESCE on the incoming value, so writing a selection does not blank the account
       -- label the OAuth callback recorded, and vice versa.
       account_label = COALESCE($3, app.connection_detail.account_label),
       selection     = COALESCE($4::jsonb, app.connection_detail.selection),
       chosen_at     = COALESCE($5, app.connection_detail.chosen_at),
       chosen_by     = COALESCE($6, app.connection_detail.chosen_by),
       updated_at    = now()`,
    [
      input.tenantId,
      input.source,
      input.accountLabel ?? null,
      input.selectionJson ?? null,
      input.selectionJson === undefined ? null : new Date().toISOString(),
      input.chosenBy ?? null,
    ],
  );
}

/** Forget a connection's credential. The connection row and its history stay. */
export async function deleteCredential(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
): Promise<void> {
  await exec.query("DELETE FROM app.connection_secret WHERE tenant_id = $1 AND source = $2", [
    tenantId,
    source,
  ]);
}

/**
 * A connection with everything the operator UI renders, in one read.
 *
 * Three LEFT JOINs, because all three are genuinely optional: a connection may have no
 * chosen scope, no credential and no run yet, and each absence is a state the card has copy
 * for rather than an error.
 *
 * **`ciphertext` is not in the select list, and that is the whole licence for this join.**
 * The control plane may know WHEN a credential expires -- that is what turns "which
 * connections need attention" into a query instead of a decrypt-everything loop -- and it
 * may not know what the credential is. It could not open one anyway: it holds no master
 * key. Adding `ciphertext` here would not merely widen a row, it would move a secret into
 * the internet-facing process.
 */
export interface ConnectionView extends Connection {
  readonly accountLabel: string;
  /** The chosen scope as JSON text. The service parses it; this decides nothing. */
  readonly selectionJson: string;
  readonly chosenAt: string | null;
  /**
   * When the stored ACCESS TOKEN stops working -- an hour after consent for Google, half an
   * hour for Xero. **Not when the grant lapses**, which is a different fact with a different
   * cause: a grant ends when the refresh token is revoked or goes unused too long, and no
   * provider tells us a date for that in advance.
   *
   * Named in full because the short name is what caused the bug. The card view also has an
   * `expiresAt`, meaning the grant's, and `expiresAt: row.expiresAt` read as obviously
   * correct while wiring one to the other -- every freshly consented Google connection
   * announced "expires today" on the schedule and then flipped itself to "reconnect" an hour
   * later, for a credential the worker refreshes without anybody being asked.
   */
  readonly credentialExpiresAt: string | null;
  /**
   * The newest run for this source, or `null` when there has never been one. Enough for a
   * card to say whether the last run worked, when, and how much it saw; the ledger holds
   * the rest.
   */
  readonly lastRun: LastRun | null;
}

export interface LastRun {
  readonly id: string;
  readonly status: "running" | "ok" | "failed";
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** Records the run saw in raw: created + changed + unchanged. A count, not an amount. */
  readonly seen: number;
  readonly refused: number;
  readonly error: string | null;
}

export async function listConnectionViews(
  exec: SqlExecutor,
  tenantId: string,
): Promise<ConnectionView[]> {
  const { rows } = await exec.query<{
    tenantId: string;
    source: string;
    status: Connection["status"];
    externalAccountId: string | null;
    scope: string;
    cadence: Cadence;
    accountLabel: string | null;
    selectionJson: string | null;
    chosenAt: Date | string | null;
    credentialExpiresAt: Date | string | null;
    lastRunId: string | null;
    lastRunStatus: LastRun["status"] | null;
    lastRunStartedAt: Date | string | null;
    lastRunEndedAt: Date | string | null;
    lastRunSeen: number | null;
    lastRunRefused: number | null;
    lastRunError: string | null;
  }>(
    `SELECT c.tenant_id AS "tenantId", c.source, c.status,
            c.external_account_id AS "externalAccountId", c.scope, c.cadence,
            d.account_label       AS "accountLabel",
            d.selection::text     AS "selectionJson",
            d.chosen_at           AS "chosenAt",
            s.expires_at          AS "credentialExpiresAt",
            r.id                  AS "lastRunId",
            r.status              AS "lastRunStatus",
            r.started_at          AS "lastRunStartedAt",
            r.ended_at            AS "lastRunEndedAt",
            r.seen                AS "lastRunSeen",
            r.refused             AS "lastRunRefused",
            r.error               AS "lastRunError"
     FROM ops.connection c
     LEFT JOIN app.connection_detail d ON d.tenant_id = c.tenant_id AND d.source = c.source
     LEFT JOIN app.connection_secret s ON s.tenant_id = c.tenant_id AND s.source = c.source
     LEFT JOIN LATERAL (
       SELECT id, status, started_at, ended_at, created + changed + unchanged AS seen,
              refused, error
       FROM ops.run
       WHERE tenant_id = c.tenant_id AND source = c.source AND verb = 'ingest'
       ORDER BY started_at DESC, id DESC LIMIT 1
     ) r ON true
     WHERE c.tenant_id = $1
     ORDER BY c.source`,
    [tenantId],
  );

  return rows.map((row) => ({
    tenantId: row.tenantId,
    source: row.source,
    status: row.status,
    externalAccountId: row.externalAccountId,
    scope: row.scope,
    cadence: row.cadence,
    accountLabel: row.accountLabel ?? "",
    selectionJson: row.selectionJson ?? "{}",
    chosenAt: row.chosenAt === null ? null : new Date(row.chosenAt).toISOString(),
    credentialExpiresAt:
      row.credentialExpiresAt === null ? null : new Date(row.credentialExpiresAt).toISOString(),
    lastRun:
      row.lastRunId === null || row.lastRunStatus === null || row.lastRunStartedAt === null
        ? null
        : {
            id: row.lastRunId,
            status: row.lastRunStatus,
            startedAt: new Date(row.lastRunStartedAt).toISOString(),
            endedAt:
              row.lastRunEndedAt === null ? null : new Date(row.lastRunEndedAt).toISOString(),
            seen: row.lastRunSeen ?? 0,
            refused: row.lastRunRefused ?? 0,
            error: row.lastRunError,
          },
  }));
}
