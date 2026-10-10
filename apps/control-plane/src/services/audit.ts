/**
 * The audit log's decisions: what a row says about an attempt, and who may read which rows.
 * ADR 0113, and ADR 0120 for the reads and the sign-in events it added.
 *
 * Writing a successful change stays with the service that made it -- only it knows what
 * changed -- and goes through `repos/auditLog.ts` directly, as it always has. What is here is
 * what no single service owns: recording a call as the router saw it (refused, failed, or an
 * agent's read), an action no service records, an event that happened outside the router, and
 * reading any of it back.
 */

import type { SqlExecutor } from "@undercroft/db";
import { findIdByEmail } from "../repos/appUser.ts";
import {
  type Actor,
  type AuditRow,
  type Channel,
  list,
  type Outcome,
  record,
} from "../repos/auditLog.ts";
import { accessIn } from "./authz.ts";

export type { Actor, AuditRow, Channel, Outcome } from "../repos/auditLog.ts";

/** A detail is facts a reader may see: ids, codes, counts -- never customer data. */
export type AuditDetail = Readonly<Record<string, string | number | boolean | null>>;

/**
 * The events that reach the log through no procedure, each written where it happens. Every
 * other action is a procedure's path.
 *
 * - `auth.signIn`, `auth.signOut`: a session began or was ended, by any way in or out -- Better
 *   Auth's session hooks, so `session.signOut` and Better Auth's own `/sign-out` are one row.
 * - `auth.refused`: a sign-in turned away, `reason` saying why (`NOT_INVITED`, or a code that
 *   was wrong, expired or tried too often).
 * - `auth.consentGranted`: a person let a model-context app in (ADR 0061).
 * - `auth.tokenRefused`: a bearer credential refused at the door, whatever the door.
 */
export type EventAction =
  | IdentityEvent
  | "auth.invitationRedeemed"
  | "connections.connected"
  | "bi.exports.download";

/** The events about a person's identity or credential, which belong to no tenant. */
export type IdentityEvent =
  | "auth.signIn"
  | "auth.signOut"
  | "auth.refused"
  | "auth.consentGranted"
  | "auth.tokenRefused";

/**
 * Record an event about a person's identity or credential, which no procedure saw: a sign-in, a
 * sign-out, a consent, a refused credential.
 *
 * `email` is the address the event is proven to be about, as Better Auth and `app.app_user` hold
 * it (lowercased); the person is found by it exactly, since an address names one `app_user`, and
 * an address with none -- a removed person, a superadmin's first moment -- is recorded by address
 * alone. `null` is a credential nobody could be proven to own, and the row then names nobody.
 *
 * Never throws. Each of these has already happened -- the session exists, the consent is stored,
 * the refusal stands -- and a failed insert turned into a failed request would read like an
 * outage to a person for whom nothing in fact went wrong.
 */
export async function recordEvent(
  exec: SqlExecutor,
  event: {
    action: IdentityEvent;
    email: string | null;
    channel: Channel | null;
    credential?: string | null;
    detail?: AuditDetail;
    outcome?: Outcome;
    reason?: string | null;
  },
): Promise<void> {
  try {
    const { email } = event;
    const credential = event.credential ?? null;
    await record(exec, {
      tenantId: null,
      actor:
        email === null
          ? { userId: null, email: null, channel: event.channel, credential }
          : {
              userId: await findIdByEmail(exec, email),
              email,
              channel: event.channel,
              credential,
            },
      action: event.action,
      detail: JSON.stringify(event.detail ?? {}),
      outcome: event.outcome ?? "ok",
      reason: event.reason ?? null,
    });
  } catch {
    // Intentionally swallowed; see above.
  }
}

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
 * Record a bearer credential refused at a door that reads one, as `auth.tokenRefused`.
 *
 * The row names the credential's owner where an account was read for it -- a personal token
 * whose row was found, an OAuth token whose consent was read -- and nobody otherwise; it carries
 * the credential's id, never the token. Its door is `mcp`, the bearer door's channel (ADR 0113),
 * whichever route the bearer was sent to.
 */
export function recordTokenRefusal(
  exec: SqlExecutor,
  refusal: { reason: string; credentialId?: string | undefined; owner?: string | undefined },
): Promise<void> {
  return recordEvent(exec, {
    action: "auth.tokenRefused",
    email: refusal.owner ?? null,
    channel: "mcp",
    credential: refusal.credentialId ?? null,
    outcome: "refused",
    reason: refusal.reason,
  });
}

/**
 * Record a call as the router answered it, copying nothing of its input but the tenant it named:
 * one it turned away (`refused`), one it broke on (`failed`), or an agent's read that succeeded
 * (`ok`, with no `reason`) -- ADR 0120.
 *
 * The tenant it named is attributed only if the caller holds authority there. A non-member's
 * attempt keeps the tenant in `detail`, readable by the caller and a superadmin, and out of the
 * tenant's own log: otherwise its admin could read which outsiders tried their tenant id, and the
 * router's 404-not-403 boundary would leak through the trail. A read that succeeded is asked the
 * same question rather than trusted to have been a tenant procedure: `audit.all` takes a tenant
 * as a filter, and a superadmin's filter naming no customer is not that customer's.
 */
export async function recordAttempt(
  exec: SqlExecutor,
  entry: {
    action: string;
    actor: Actor & { readonly userId: string };
    superadmin: boolean;
    /** The `tenantId` the call named, read off its raw input; `null` when it named none. */
    named: string | null;
    outcome: Outcome;
    /** Why it did not succeed; `null` for one that did. */
    reason: string | null;
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
