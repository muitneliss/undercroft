/**
 * `app.assistant_thread` and `app.assistant_turn`: one conversation per reader per customer.
 *
 * The repo decides nothing. It opens or finds a thread, reads its turns in order, appends or
 * replaces a turn by the SDK's own message id, and clears a thread -- and whether any of that
 * is allowed was argued one layer up, in the handler, where `tenantProcedure` already decided
 * whether this reader has any authority in this customer at all.
 *
 * `parts` travels as JSON in and an unparsed value out, the same way `app.bi_question`'s
 * `definition` does: its shape is the AI SDK's, and validating it is the service's job. What
 * this layer will NOT do is let an undigested result through -- that is the table's own CHECK
 * constraint (200_assistant.sql), so a caller who forgets gets a raised error here rather than
 * a customer's contract stored in `app`.
 */

import type { SqlExecutor } from "@undercroft/db";

export interface TurnRow {
  readonly messageId: string;
  readonly ordinal: number;
  readonly role: "user" | "assistant";
  readonly parts: unknown;
  readonly createdAt: string;
}

interface Row {
  message_id: string;
  ordinal: number;
  role: "user" | "assistant";
  parts: unknown;
  created_at: Date | string;
}

const COLUMNS = "message_id, ordinal, role, parts, created_at";

function toRow(r: Row): TurnRow {
  return {
    messageId: r.message_id,
    ordinal: r.ordinal,
    role: r.role,
    parts: r.parts,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * The reader's thread for this customer, opened if they have not spoken here before.
 *
 * `ON CONFLICT ... DO UPDATE` rather than `DO NOTHING`, because `DO NOTHING` returns no row and
 * would need a second SELECT -- two statements where a concurrent first message in two tabs can
 * interleave. Touching `updated_at` makes the upsert return the id in every case.
 */
export async function openThread(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<string> {
  const { rows } = await exec.query<{ id: string }>(
    `INSERT INTO app.assistant_thread (tenant_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET updated_at = now()
     RETURNING id`,
    [tenantId, userId],
  );
  return rows[0]?.id ?? "";
}

/** `null` when this reader has never spoken about this customer, which is not an error. */
export async function findThread(
  exec: SqlExecutor,
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const { rows } = await exec.query<{ id: string }>(
    "SELECT id FROM app.assistant_thread WHERE tenant_id = $1 AND user_id = $2",
    [tenantId, userId],
  );
  return rows[0]?.id ?? null;
}

export async function listTurns(exec: SqlExecutor, threadId: string): Promise<TurnRow[]> {
  const { rows } = await exec.query<Row>(
    `SELECT ${COLUMNS} FROM app.assistant_turn WHERE thread_id = $1 ORDER BY ordinal, message_id`,
    [threadId],
  );
  return rows.map(toRow);
}

/**
 * Write one turn, keyed by the SDK's message id.
 *
 * Idempotent by that id: saving the same exchange twice -- which happens whenever a stream is
 * retried or a transcript re-persisted -- updates the one row rather than appending a second
 * copy the reader would see twice.
 */
export async function saveTurn(
  exec: SqlExecutor,
  threadId: string,
  turn: { messageId: string; ordinal: number; role: "user" | "assistant"; parts: unknown },
): Promise<void> {
  await exec.query(
    `INSERT INTO app.assistant_turn (thread_id, message_id, ordinal, role, parts)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (thread_id, message_id)
     DO UPDATE SET ordinal = $3, role = $4, parts = $5::jsonb`,
    [threadId, turn.messageId, turn.ordinal, turn.role, JSON.stringify(turn.parts)],
  );
}

/** How many turns the thread holds, for the per-reader turn budget. */
export async function countTurns(exec: SqlExecutor, threadId: string): Promise<number> {
  const { rows } = await exec.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM app.assistant_turn WHERE thread_id = $1",
    [threadId],
  );
  return Number.parseInt(rows[0]?.n ?? "0", 10);
}

/**
 * Empty the thread, keeping the thread itself.
 *
 * A reader asking for a clean page gets this rather than a second thread, so the interleaf
 * never has to answer "which conversation am I in?".
 */
export async function clearThread(exec: SqlExecutor, threadId: string): Promise<number> {
  const { rows } = await exec.query<{ message_id: string }>(
    "DELETE FROM app.assistant_turn WHERE thread_id = $1 RETURNING message_id",
    [threadId],
  );
  return rows.length;
}
