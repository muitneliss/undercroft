/**
 * `ops.audit_log`: append-only, who did what, through which door, to which tenant. ADR 0113.
 *
 * `record` is the only INSERT, and nothing here updates or deletes: an audit trail that can be
 * edited is a story, not evidence. The database agrees -- `510_audit_log_read.sql` revokes the
 * control plane's UPDATE and DELETE on the table.
 *
 * `detail` is passed in already serialised: what is worth recording about an action is the
 * action's business, and a repo that reached into a payload to decide would be deciding.
 */

import type { SqlExecutor } from "@undercroft/db";

/** The door an action came through. For reading, never for authority (ADR 0113). */
export type Channel = "web" | "cli" | "mcp" | "assistant";

/**
 * Who acted. `userId` is `null` only for an address the platform does not know -- a refused
 * sign-in -- and `channel` only for an event that arrived through no door of ours.
 */
export interface Actor {
  readonly userId: string | null;
  readonly email: string;
  readonly channel: Channel | null;
  /** A bearer credential's id (`upat_…`, `oauth:<client>`); `null` for a browser session. */
  readonly credential: string | null;
}

/** `ok` took effect; `refused` was turned away (a 4xx); `failed` broke on our side (a 5xx). */
export type Outcome = "ok" | "refused" | "failed";

/**
 * Who a row names. An {@link Actor}, or -- for a bearer credential nobody could be proven to own,
 * a token that is not ours at all -- nobody: `email` and `userId` both `null` (ADR 0120). The
 * column holds NULL then, not a placeholder, because a placeholder would read as somebody.
 */
export type Named = Actor | (Omit<Actor, "email" | "userId"> & { email: null; userId: null });

export async function record(
  exec: SqlExecutor,
  /**
   * `tenantId` is nullable because not every recordable action belongs to a tenant, and the
   * column has always allowed it. A refused sign-in is the case that proved it: the whole
   * point is that the address has no tenant, and attributing the refusal to one would be
   * recording something that is not true.
   */
  entry: {
    tenantId: string | null;
    actor: Named;
    action: string;
    detail: string;
    outcome?: Outcome;
    reason?: string | null;
  },
): Promise<void> {
  await exec.query(
    `INSERT INTO ops.audit_log
       (tenant_id, actor, user_id, channel, credential, action, detail, outcome, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.tenantId,
      entry.actor.email,
      entry.actor.userId,
      entry.actor.channel,
      entry.actor.credential,
      entry.action,
      entry.detail,
      entry.outcome ?? "ok",
      entry.reason ?? null,
    ],
  );
}

/** One row as its readers get it. `id` is a bigint, so a string. */
export interface AuditRow {
  readonly id: string;
  readonly at: string;
  readonly tenantId: string | null;
  /** The address that acted; `null` only for a bearer nobody could be proven to own. */
  readonly actor: string | null;
  readonly userId: string | null;
  readonly channel: Channel | null;
  readonly credential: string | null;
  readonly action: string;
  readonly outcome: Outcome;
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, unknown>>;
}

/** Which rows to read. Each field set narrows; which ones a reader MUST set is the service's call. */
export interface AuditFilter {
  readonly tenantId?: string | undefined;
  readonly userId?: string | undefined;
  readonly email?: string | undefined;
  /** Rows strictly older than this id: the page after one that ended there. */
  readonly before?: string | undefined;
  readonly limit: number;
}

interface Selected {
  id: string;
  at: Date | string;
  tenant_id: string | null;
  actor: string | null;
  user_id: string | null;
  channel: Channel | null;
  credential: string | null;
  action: string;
  outcome: Outcome;
  reason: string | null;
  detail: Readonly<Record<string, unknown>> | null;
}

/**
 * Rows matching `filter`, newest first.
 *
 * One statement for every reader, each condition switched off by a NULL parameter, so the three
 * readers cannot drift into three slightly different ideas of a row.
 */
export async function list(exec: SqlExecutor, filter: AuditFilter): Promise<AuditRow[]> {
  const { rows } = await exec.query<Selected>(
    `SELECT id::text AS id, at, tenant_id, actor, user_id::text AS user_id, channel, credential,
            action, outcome, reason, detail
       FROM ops.audit_log
      WHERE ($1::text IS NULL OR tenant_id = $1)
        AND ($2::uuid IS NULL OR user_id = $2)
        AND ($3::text IS NULL OR actor = $3)
        AND ($4::bigint IS NULL OR id < $4::bigint)
      ORDER BY id DESC
      LIMIT $5`,
    [
      filter.tenantId ?? null,
      filter.userId ?? null,
      filter.email ?? null,
      filter.before ?? null,
      filter.limit,
    ],
  );
  return rows.map((row) => ({
    id: row.id,
    at: new Date(row.at).toISOString(),
    tenantId: row.tenant_id,
    actor: row.actor,
    userId: row.user_id,
    channel: row.channel,
    credential: row.credential,
    action: row.action,
    outcome: row.outcome,
    reason: row.reason,
    detail: row.detail ?? {},
  }));
}
