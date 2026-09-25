/**
 * Reports over tRPC: who may author and who may only read, and what a question that was
 * not answered is told.
 *
 * The role gate is pinned from both sides -- a viewer is refused a definition and answered
 * a saved question, a member is answered both -- and the two worded refusals, Postgres's
 * sentence about bad SQL and a parameter with no value, reach the caller in the caller's
 * language.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

const TENANT = "CASE-0042";
const SQL = { kind: "sql" as const, sql: "select 1 as n" };
const CHART = { type: "table" as const, y: [], options: {} };

let db: TestDatabase;

async function seedMember(email: string, role: Role): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    userId,
    role,
  ]);
  return userId;
}

function caller(userId: string, email: string, worker: WorkerClient, locale: "vi" | "en" = "vi") {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("bi.answer and bi.runQuestion", () => {
  it("a viewer is refused a definition but answered a saved question; a member is answered both", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const member = await seedMember("m@example.test", "member");
    const worker = new InMemoryWorkerClient().answering({
      columns: [{ name: "n", type: "integer" }],
      rows: [[1]],
      truncated: false,
    });

    const got = await refusal(() =>
      caller(viewer, "v@example.test", worker).bi.answer({ tenantId: TENANT, definition: SQL }),
    );
    expect(got.code).toBe("FORBIDDEN");

    const result = await caller(member, "m@example.test", worker).bi.answer({
      tenantId: TENANT,
      definition: SQL,
    });
    expect(result.rows).toEqual([[1]]);

    const saved = await caller(member, "m@example.test", worker).bi.questions.save({
      tenantId: TENANT,
      name: "One",
      definition: SQL,
      chart: CHART,
    });
    const answered = await caller(viewer, "v@example.test", worker).bi.runQuestion({
      tenantId: TENANT,
      questionId: saved.id,
    });
    expect(answered.rows).toEqual([[1]]);
    // The read a dashboard's tile makes is the same answer, by the question's id.
    const read = await caller(viewer, "v@example.test", worker).bi.questions.answer({
      tenantId: TENANT,
      id: saved.id,
    });
    expect(read.rows).toEqual([[1]]);
    expect(worker.queries.map((q) => q.sql)).toEqual([
      "select 1 as n",
      "select 1 as n",
      "select 1 as n",
    ]);
  });

  it("SQL that did not run, and a parameter with no value, are BAD_REQUEST worded in the caller's language", async () => {
    const member = await seedMember("m@example.test", "member");
    const worker = new InMemoryWorkerClient().refusingQueries('relation "nope" does not exist');

    const failed = await refusal(() =>
      caller(member, "m@example.test", worker, "en").bi.answer({
        tenantId: TENANT,
        definition: { kind: "sql", sql: "select * from nope" },
      }),
    );
    expect(failed.code).toBe("BAD_REQUEST");
    expect(failed.message).toBe('The query did not run: relation "nope" does not exist');

    const unbound = await refusal(() =>
      caller(member, "m@example.test", worker, "en").bi.answer({
        tenantId: TENANT,
        definition: { kind: "sql", sql: "select * from t where d > {{since}}" },
      }),
    );
    expect(unbound.code).toBe("BAD_REQUEST");
    expect(unbound.message).toBe(
      "The question needs a value for since. Set that filter and run again.",
    );
  });

  it("a viewer cannot save a question, and the schema is readable by anyone in the tenant", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const worker = new InMemoryWorkerClient();

    const got = await refusal(() =>
      caller(viewer, "v@example.test", worker).bi.questions.save({
        tenantId: TENANT,
        name: "One",
        definition: SQL,
        chart: CHART,
      }),
    );
    expect(got.code).toBe("FORBIDDEN");
    expect(await caller(viewer, "v@example.test", worker).bi.schema({ tenantId: TENANT })).toEqual({
      tables: [],
    });
  });
});
