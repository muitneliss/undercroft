/**
 * `ops.tenant`: the customer record, with no secret material in it.
 *
 * One writer, and it is not reachable over HTTP. `ensureTenant` exists for the bootstrap
 * CLI (`bun run invite`), which has to be able to create the first tenant: nobody is signed
 * in yet to create it through the product, and the alternative — an operator pasting SQL —
 * is how the first production sign-in got stuck. The router still exposes no create
 * endpoint, so "a tenant is not created by a request" holds exactly as before.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import type { SqlExecutor } from "@undercroft/db";

export interface Tenant {
  readonly id: string;
  readonly displayName: string;
}

/** One tenant, or `null`. Whether "absent" is a 404 is the caller's decision. */
export async function findTenant(exec: SqlExecutor, tenantId: string): Promise<Tenant | null> {
  const { rows } = await exec.query<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM ops.tenant WHERE id = $1",
    [tenantId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, displayName: row.display_name };
}

/**
 * Create the tenant if it is not there. Idempotent, and never renames an existing one.
 *
 * `DO NOTHING` rather than `DO UPDATE`: running the bootstrap command twice must not
 * silently retitle a tenant that is already in use.
 */
export async function ensureTenant(
  exec: SqlExecutor,
  tenantId: string,
  displayName: string,
): Promise<void> {
  await exec.query(
    "INSERT INTO ops.tenant (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [tenantId, displayName],
  );
}
