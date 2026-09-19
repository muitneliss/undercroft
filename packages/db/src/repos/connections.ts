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

// biome-ignore-all lint/complexity/useMaxParams: Four functions take five arguments, each a distinct required input with no sensible grouping. Bundling them into an options object to satisfy a count would hide which are required.
// biome-ignore-all lint/nursery/noUnsafeTypeAssertion: Every one of these is a boundary where a payload genuinely is unknown -- a third-party API body, a Docker inspect response, a row shape from a hand-written query -- and is Zod-parsed or checked immediately after. Making the assertions safe means modelling each external shape as a type, which is real work with real value and is not a lint migration.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`params.tenantId`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useExportsLast: Reordering 28 modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the type a module is about first, then what operates on it. The ordering carries meaning here and the rule's preferred one does not.

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

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

export interface Connection {
  readonly tenantId: string;
  readonly source: string;
  readonly status: "disconnected" | "connected" | "error" | "expired";
  readonly externalAccountId: string | null;
  readonly scope: string;
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
            external_account_id AS "externalAccountId", scope
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
            external_account_id AS "externalAccountId", scope
     FROM ops.connection WHERE tenant_id = $1 AND source = $2`,
    [tenantId, source],
  );
  return rows[0] ?? null;
}

export async function upsertConnection(
  exec: SqlExecutor,
  input: {
    tenantId: string;
    source: string;
    status?: Connection["status"];
    externalAccountId?: string | null;
    scope?: string;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO ops.connection (tenant_id, source, status, external_account_id, scope, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, source) DO UPDATE SET
       status              = EXCLUDED.status,
       external_account_id = EXCLUDED.external_account_id,
       scope               = EXCLUDED.scope,
       updated_at          = now()`,
    [
      input.tenantId,
      input.source,
      input.status ?? "connected",
      input.externalAccountId ?? null,
      input.scope ?? "",
    ],
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

export async function writeCredential(
  exec: SqlExecutor,
  tenantId: string,
  source: string,
  credential: Credential,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const sealed = seal(credentialToJson(credential), env === undefined ? {} : { env });
  await exec.query(
    `INSERT INTO app.connection_secret (tenant_id, source, ciphertext, key_version, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, source) DO UPDATE SET
       ciphertext  = EXCLUDED.ciphertext,
       key_version = EXCLUDED.key_version,
       expires_at  = EXCLUDED.expires_at,
       updated_at  = now()`,
    [tenantId, source, Buffer.from(sealed.blob), sealed.keyVersion, credential.expiresAt],
  );
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
  const row = rows[0];
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
  const row = rows[0];
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
  readonly lastRunId: string;
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
    accountLabel: string | null;
    selectionJson: string | null;
    chosenAt: Date | string | null;
    credentialExpiresAt: Date | string | null;
    lastRunId: string | null;
  }>(
    `SELECT c.tenant_id AS "tenantId", c.source, c.status,
            c.external_account_id AS "externalAccountId", c.scope,
            d.account_label       AS "accountLabel",
            d.selection::text     AS "selectionJson",
            d.chosen_at           AS "chosenAt",
            s.expires_at          AS "credentialExpiresAt",
            r.id                  AS "lastRunId"
     FROM ops.connection c
     LEFT JOIN app.connection_detail d ON d.tenant_id = c.tenant_id AND d.source = c.source
     LEFT JOIN app.connection_secret s ON s.tenant_id = c.tenant_id AND s.source = c.source
     LEFT JOIN LATERAL (
       SELECT id FROM ops.run
       WHERE tenant_id = c.tenant_id AND source = c.source
       ORDER BY started_at DESC LIMIT 1
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
    accountLabel: row.accountLabel ?? "",
    selectionJson: row.selectionJson ?? "{}",
    chosenAt: row.chosenAt === null ? null : new Date(row.chosenAt).toISOString(),
    credentialExpiresAt:
      row.credentialExpiresAt === null ? null : new Date(row.credentialExpiresAt).toISOString(),
    lastRunId: row.lastRunId ?? "",
  }));
}
