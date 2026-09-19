/**
 * Reports over tRPC: who may run SQL, and what a query that did not run is told.
 *
 * The role gate is pinned from both sides -- a viewer is refused, a member is answered --
 * and the one worded refusal, Postgres's sentence about bad SQL, reaches the caller in the
 * caller's language with the sentence intact.
 */

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { migrate } from "@undercroft/db";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient, type WorkerClient } from "../services/workerClient.ts";
import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

const TENANT = "CASE-0042";

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
    sessionId: "s1",
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
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
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("bi.run", () => {
  it("a viewer is refused; a member's SQL reaches the worker and the rows come back", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const member = await seedMember("m@example.test", "member");
    const worker = new InMemoryWorkerClient().answering({
      columns: [{ name: "n", type: "integer" }],
      rows: [[1]],
      truncated: false,
    });

    const got = await refusal(() =>
      caller(viewer, "v@example.test", worker).bi.run({ tenantId: TENANT, sql: "select 1 as n" }),
    );
    expect(got.code).toBe("FORBIDDEN");

    const result = await caller(member, "m@example.test", worker).bi.run({
      tenantId: TENANT,
      sql: "select 1 as n",
    });
    expect(result.rows).toEqual([[1]]);
    expect(worker.queries).toEqual([{ tenantId: TENANT, sql: "select 1 as n", limit: 1000 }]);
  });

  it("SQL that did not run is a BAD_REQUEST carrying Postgres's sentence, in the caller's language", async () => {
    const member = await seedMember("m@example.test", "member");
    const worker = new InMemoryWorkerClient().refusingQueries('relation "nope" does not exist');

    const got = await refusal(() =>
      caller(member, "m@example.test", worker, "en").bi.run({
        tenantId: TENANT,
        sql: "select * from nope",
      }),
    );
    expect(got.code).toBe("BAD_REQUEST");
    expect(got.message).toBe('The query did not run: relation "nope" does not exist');
  });

  it("the schema is readable by a viewer: the shape of the data is not the data", async () => {
    const viewer = await seedMember("v@example.test", "viewer");
    const schema = await caller(viewer, "v@example.test", new InMemoryWorkerClient()).bi.schema({
      tenantId: TENANT,
    });
    expect(schema).toEqual({ tables: [] });
  });
});
