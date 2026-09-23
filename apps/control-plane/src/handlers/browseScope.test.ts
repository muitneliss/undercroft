/**
 * What the scope picker is TOLD when it cannot show a list.
 *
 * Separate from `authz.test.ts`, which builds its context with no worker at all and asserts
 * codes rather than wording -- deliberately, and it says so. This file asks the other
 * question: given a worker that answered, does the sentence on screen name something the
 * administrator reading it can act on?
 *
 * It exists because that sentence was once "the processing service is not responding" for a
 * Gmail grant Google had refused. The service was up; the permission had been unticked at
 * the consent screen; and the only person who could fix it was being told to wait.
 */

import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { messages } from "../i18n/index.ts";
import type { WorkerFailure } from "../services/workerClient.ts";
import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";

const TENANT = "CASE-0042";
const ADMIN = { userId: "", email: "ada@example.test" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [ADMIN.email],
  );
  ADMIN.userId = rows[0]!.id;
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    TENANT,
    ADMIN.userId,
    "admin",
  ]);
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

function callerWith(failure: WorkerFailure) {
  const ctx: Context = {
    exec: db,
    user: { userId: ADMIN.userId, email: ADMIN.email },
    sessionId: "s1",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker: new InMemoryWorkerClient().failing(failure),
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

async function refusalOf(failure: WorkerFailure): Promise<{ code: string; message: string }> {
  try {
    await callerWith(failure).connections.browseScope({ tenantId: TENANT, source: "gmail" });
  } catch (error) {
    if (error instanceof TRPCError) {
      return { code: error.code, message: error.message };
    }
    throw error;
  }
  throw new Error("expected the browse to be refused");
}

describe("a scope picker that cannot list anything", () => {
  it("a withheld permission names the remedy the reader owns", async () => {
    const refusal = await refusalOf("scope-insufficient");

    expect(refusal.message).toBe(messages(DEFAULT_LOCALE)("error.scopeInsufficient"));
    expect(refusal.code).toBe("PRECONDITION_FAILED");
  });

  it("a worker that is actually down still says so", async () => {
    // The quiet side, and the reason the branch above has to be a branch: these two must not
    // collapse back into one sentence, which is the state this file was written to end.
    const refusal = await refusalOf("unreachable");

    expect(refusal.message).toBe(messages(DEFAULT_LOCALE)("error.workerUnavailable"));
  });

  it("a refusal that is neither is worded as neither", async () => {
    const refusal = await refusalOf("refused");

    expect(refusal.message).toBe(
      messages(DEFAULT_LOCALE)("error.browseRefused", { source: "gmail" }),
    );
  });
});
