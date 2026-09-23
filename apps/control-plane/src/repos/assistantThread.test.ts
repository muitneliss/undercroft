/**
 * One conversation per reader per customer, and appending to it twice is not two turns.
 *
 * Three promises a reader would notice breaking: their history is still there when they come
 * back, it is not somebody else's, and a retried save does not show them their own question
 * twice. All three are properties of the keys in `200_assistant.sql`, so they are asserted
 * through the repo against PGlite rather than by reading the DDL.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { clearThread, findThread, listTurns, openThread, saveTurn } from "./assistantThread.ts";

let db: TestDatabase;
let operator: string;
let colleague: string;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.app_user (email) VALUES ('ops@example.test'), ('audit@example.test')
     RETURNING id`,
  );
  operator = rows[0]!.id;
  colleague = rows[1]!.id;
  // Seeded as the superuser; from here on every statement runs as the control plane does.
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

async function ask(threadId: string, messageId: string, text: string): Promise<void> {
  await saveTurn(db, threadId, {
    messageId,
    ordinal: 0,
    role: "user",
    parts: [{ type: "text", text }],
  });
}

describe("a reader's conversation is theirs, and there is one of it", () => {
  it("coming back to the same customer reopens the same thread", async () => {
    const first = await openThread(db, "CASE-0042", operator);
    const second = await openThread(db, "CASE-0042", operator);
    expect(second).toBe(first);
  });

  it("a colleague on the same customer gets their own thread, not this one", async () => {
    const mine = await openThread(db, "CASE-0042", operator);
    const theirs = await openThread(db, "CASE-0042", colleague);
    expect(theirs).not.toBe(mine);
  });

  it("the same reader on another customer gets another thread", async () => {
    const here = await openThread(db, "CASE-0042", operator);
    const there = await openThread(db, "CASE-0043", operator);
    expect(there).not.toBe(here);
  });

  it("a reader who has never spoken here has no thread, which is not an error", async () => {
    expect(await findThread(db, "CASE-0042", operator)).toBeNull();
  });
});

describe("appending a turn", () => {
  it("saving the same exchange twice leaves one turn, not two", async () => {
    const threadId = await openThread(db, "CASE-0042", operator);
    await ask(threadId, "m1", "Hoá đơn về chưa?");
    await ask(threadId, "m1", "Hoá đơn về chưa?");
    expect(await listTurns(db, threadId)).toHaveLength(1);
  });

  it("a different message is a different turn", async () => {
    const threadId = await openThread(db, "CASE-0042", operator);
    await ask(threadId, "m1", "Hoá đơn về chưa?");
    await ask(threadId, "m2", "Còn hợp đồng?");
    expect(await listTurns(db, threadId)).toHaveLength(2);
  });

  it("clearing empties the thread and keeps it, so there is still one conversation", async () => {
    const threadId = await openThread(db, "CASE-0042", operator);
    await ask(threadId, "m1", "Hoá đơn về chưa?");
    expect(await clearThread(db, threadId)).toBe(1);
    expect(await listTurns(db, threadId)).toEqual([]);
    expect(await findThread(db, "CASE-0042", operator)).toBe(threadId);
  });
});
