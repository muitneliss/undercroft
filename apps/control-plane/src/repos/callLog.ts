/**
 * `ops.call_log`: an agent's call kept whole for a platform superadmin, for 30 days. ADR 0151.
 *
 * Three statements and a sweep. `insert` takes the bodies already serialised, redacted and cut --
 * what is worth keeping of a call is the service's decision, and a repo that reached into a
 * payload to decide would be deciding. `list` never selects a body: a page is a list of calls,
 * and 256 KB twice per row is not a page. `get` reads one row whole.
 */

import type { SqlExecutor } from "@undercroft/db";

/** The doors that write a row. The browser's never does (ADR 0120's reason, ADR 0151). */
export type CallChannel = "cli" | "mcp" | "assistant";

/** As in the audit log: `ok`, `refused` (a 4xx), `failed` (a 5xx). */
export type CallOutcome = "ok" | "refused" | "failed";

/** How much of the answer the row holds: all of it, its shape without a cell, or nothing. */
export type ResponseKept = "whole" | "shape" | "none";

/** A body as it is stored: text cut at the cap, the whole size, and whether it was cut. */
export interface StoredBody {
  readonly text: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

export interface CallEntry {
  readonly traceId: string | null;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly actor: string;
  readonly channel: CallChannel;
  readonly credential: string | null;
  readonly path: string;
  readonly type: "query" | "mutation";
  readonly outcome: CallOutcome;
  readonly reason: string | null;
  readonly durationMs: number | null;
  readonly request: StoredBody | null;
  readonly responseKept: ResponseKept;
  readonly response: StoredBody | null;
  /** Already serialised JSON, or `null` for a call that did not fail. */
  readonly error: string | null;
}

/** Write one row; its id, which the service reads to decide when to sweep. */
export async function insert(exec: SqlExecutor, entry: CallEntry): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO ops.call_log
       (trace_id, tenant_id, user_id, actor, channel, credential, path, type, outcome, reason,
        duration_ms, request, request_bytes, request_truncated, response_kept, response,
        response_bytes, response_truncated, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
             $19::jsonb)
     RETURNING id::text AS id`,
    [
      entry.traceId,
      entry.tenantId,
      entry.userId,
      entry.actor,
      entry.channel,
      entry.credential,
      entry.path,
      entry.type,
      entry.outcome,
      entry.reason,
      entry.durationMs,
      entry.request?.text ?? null,
      entry.request?.bytes ?? null,
      entry.request?.truncated ?? false,
      entry.responseKept,
      entry.response?.text ?? null,
      entry.response?.bytes ?? null,
      entry.response?.truncated ?? false,
      entry.error,
    ],
  );
  return rows[0]?.id ?? "";
}

/** One call as a list shows it: everything but the bodies, whose sizes stand in for them. */
export interface CallSummary {
  readonly id: string;
  readonly at: string;
  readonly traceId: string | null;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly actor: string | null;
  readonly channel: CallChannel;
  readonly credential: string | null;
  readonly path: string;
  readonly type: "query" | "mutation";
  readonly outcome: CallOutcome;
  readonly reason: string | null;
  readonly durationMs: number | null;
  readonly requestBytes: number | null;
  readonly requestTruncated: boolean;
  readonly responseKept: ResponseKept;
  readonly responseBytes: number | null;
  readonly responseTruncated: boolean;
}

/** One call whole: its bodies as stored, and its error as the server saw it. */
export interface CallDetail extends CallSummary {
  readonly request: string | null;
  readonly response: string | null;
  readonly error: Readonly<Record<string, unknown>> | null;
}

/** Which rows to read. Each field set narrows. */
export interface CallFilter {
  readonly tenantId?: string | undefined;
  readonly email?: string | undefined;
  readonly path?: string | undefined;
  readonly outcome?: CallOutcome | undefined;
  /** Rows strictly older than this id: the page after one that ended there. */
  readonly before?: string | undefined;
  readonly limit: number;
}

interface SummaryRow {
  id: string;
  at: Date | string;
  trace_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  actor: string | null;
  channel: CallChannel;
  credential: string | null;
  path: string;
  type: "query" | "mutation";
  outcome: CallOutcome;
  reason: string | null;
  duration_ms: number | null;
  request_bytes: number | null;
  request_truncated: boolean;
  response_kept: ResponseKept;
  response_bytes: number | null;
  response_truncated: boolean;
}

interface DetailRow extends SummaryRow {
  request: string | null;
  response: string | null;
  error: Readonly<Record<string, unknown>> | null;
}

const SUMMARY_COLUMNS = `id::text AS id, at, trace_id, tenant_id, user_id::text AS user_id, actor,
  channel, credential, path, type, outcome, reason, duration_ms, request_bytes, request_truncated,
  response_kept, response_bytes, response_truncated`;

function summaryOf(row: SummaryRow): CallSummary {
  return {
    id: row.id,
    at: new Date(row.at).toISOString(),
    traceId: row.trace_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    actor: row.actor,
    channel: row.channel,
    credential: row.credential,
    path: row.path,
    type: row.type,
    outcome: row.outcome,
    reason: row.reason,
    durationMs: row.duration_ms,
    requestBytes: row.request_bytes,
    requestTruncated: row.request_truncated,
    responseKept: row.response_kept,
    responseBytes: row.response_bytes,
    responseTruncated: row.response_truncated,
  };
}

/**
 * Rows matching `filter`, newest first, without their bodies.
 *
 * One statement, each condition switched off by a NULL parameter, as `auditLog.list` is; and
 * `ORDER BY` names the table's column for the reason given there -- the bare `id` is the `text`
 * cast, and "999" sorts above "1000".
 */
export async function list(exec: SqlExecutor, filter: CallFilter): Promise<CallSummary[]> {
  const { rows } = await exec.query<SummaryRow>(
    `SELECT ${SUMMARY_COLUMNS}
       FROM ops.call_log
      WHERE ($1::text IS NULL OR tenant_id = $1)
        AND ($2::text IS NULL OR actor = $2)
        AND ($3::text IS NULL OR path = $3)
        AND ($4::text IS NULL OR outcome = $4)
        AND ($5::bigint IS NULL OR id < $5::bigint)
      ORDER BY call_log.id DESC
      LIMIT $6`,
    [
      filter.tenantId ?? null,
      filter.email ?? null,
      filter.path ?? null,
      filter.outcome ?? null,
      filter.before ?? null,
      filter.limit,
    ],
  );
  return rows.map(summaryOf);
}

/** One row whole, or `null` when there is none -- never one, or swept. */
export async function get(exec: SqlExecutor, id: string): Promise<CallDetail | null> {
  const { rows } = await exec.query<DetailRow>(
    `SELECT ${SUMMARY_COLUMNS}, request, response, error
       FROM ops.call_log
      WHERE id = $1::bigint`,
    [id],
  );
  const [row] = rows;
  return row === undefined
    ? null
    : { ...summaryOf(row), request: row.request, response: row.response, error: row.error };
}

/** Delete every row older than `days` days; how many went. */
export async function pruneOlderThan(exec: SqlExecutor, days: number): Promise<number> {
  const { rows } = await exec.query<{ removed: number }>(
    `WITH gone AS (
       DELETE FROM ops.call_log WHERE at < now() - make_interval(days => $1::int) RETURNING 1
     )
     SELECT count(*)::int AS removed FROM gone`,
    [days],
  );
  return rows[0]?.removed ?? 0;
}
