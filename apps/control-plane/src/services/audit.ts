/**
 * The audit log's decisions: what a row says about an attempt, and who may read which rows.
 * ADR 0112.
 *
 * Writing a successful change stays with the service that made it -- only it knows what
 * changed -- and goes through `repos/auditLog.ts` directly, as it always has. What is here is
 * what no single service owns: recording an attempt the router refused or failed, an action no
 * service records, an event that happened outside the router, and reading any of it back.
 */

import type { SqlExecutor } from "@undercroft/db";
import { type Actor, type AuditRow, list, type Outcome, record } from "../repos/auditLog.ts";
import { accessIn } from "./authz.ts";

export type { Actor, AuditRow, Channel, Outcome } from "../repos/auditLog.ts";

/** A detail is facts a reader may see: ids, codes, counts -- never customer data. */
export type AuditDetail = Readonly<Record<string, string | number | boolean | null>>;

/**
 * The events that reach the log through no procedure, each written where it happens. Every
 * other action is a procedure's path.
 */
export type EventAction =
  | "auth.signIn"
  | "auth.refused"
  | "auth.invitationRedeemed"
  | "connections.connected"
  | "bi.exports.download";

/** Record one action that took effect. */
export async function recordAction(
  exec: SqlExecutor,
  entry: { tenantId: string | null; actor: Actor; action: string; detail: AuditDetail },
): Promise<void> {
  await record(exec, {
    tenantId: entry.tenantId,
    actor: entry.actor,
    action: entry.action,
    detail: JSON.stringify(entry.detail),
  });
}

/**
 * Record a call the router turned away (`refused`) or broke on (`failed`).
 *
 * The tenant it named is attributed only if the caller holds authority there. A non-member's
 * attempt keeps the tenant in `detail`, readable by the caller and a superadmin, and out of the
 * tenant's own log: otherwise its admin could read which outsiders tried their tenant id, and the
 * router's 404-not-403 boundary would leak through the trail.
 */
export async function recordAttempt(
  exec: SqlExecutor,
  entry: {
    action: string;
    actor: Actor & { readonly userId: string };
    superadmin: boolean;
    /** The `tenantId` the call named, read off its raw input; `null` when it named none. */
    named: string | null;
    outcome: Exclude<Outcome, "ok">;
    reason: string;
  },
): Promise<void> {
  const tenantId =
    entry.named === null
      ? null
      : await attributable(exec, entry.named, entry.actor, entry.superadmin);
  await record(exec, {
    tenantId,
    actor: entry.actor,
    action: entry.action,
    detail: JSON.stringify(
      entry.named !== null && tenantId === null ? { tenantId: entry.named } : {},
    ),
    outcome: entry.outcome,
    reason: entry.reason,
  });
}

async function attributable(
  exec: SqlExecutor,
  tenantId: string,
  actor: { readonly userId: string },
  superadmin: boolean,
): Promise<string | null> {
  const access = await accessIn(exec, { tenantId, userId: actor.userId, superadmin });
  return access === null ? null : tenantId;
}

/** One page of rows, newest first, and the id to ask for the next page from. */
export interface AuditPage {
  readonly items: readonly AuditRow[];
  /** Pass as `cursor` for the page after this one; `null` when this is the last. */
  readonly nextCursor: string | null;
}

/** A page, the way `runs.list` asks for one: rows older than `cursor`, at most `limit`. */
export interface PageRequest {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

async function page(
  exec: SqlExecutor,
  filter: {
    tenantId?: string | undefined;
    userId?: string | undefined;
    email?: string | undefined;
  },
  request: PageRequest,
): Promise<AuditPage> {
  // One row past the page says whether there is another, without counting the table.
  const rows = await list(exec, { ...filter, before: request.cursor, limit: request.limit + 1 });
  const items = rows.slice(0, request.limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > request.limit && last !== undefined ? last.id : null };
}

/** A person's own actions, in every tenant and in none. */
export function listMine(
  exec: SqlExecutor,
  input: PageRequest & { userId: string },
): Promise<AuditPage> {
  return page(exec, { userId: input.userId }, input);
}

/**
 * Everything attributed to one tenant, by anyone. The caller's authority there is the router's
 * gate, not this function's.
 */
export function listTenant(
  exec: SqlExecutor,
  input: PageRequest & { tenantId: string; email?: string | undefined },
): Promise<AuditPage> {
  return page(exec, { tenantId: input.tenantId, email: input.email }, input);
}

/** Every row, for a superadmin. */
export function listAll(
  exec: SqlExecutor,
  input: PageRequest & { tenantId?: string | undefined; email?: string | undefined },
): Promise<AuditPage> {
  return page(exec, { tenantId: input.tenantId, email: input.email }, input);
}
