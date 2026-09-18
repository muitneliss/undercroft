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
