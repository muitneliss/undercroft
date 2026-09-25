/**
 * What a caller that is not the browser is told when a schedule is not saved.
 *
 * The UI checks an expression before it offers Save, so a person at the form never reaches
 * this refusal. The CLI and the assistant do: they send whatever was typed, and the only thing
 * standing between them and "VALIDATION_FAILED" with a list of zod issues is that the
 * procedure words the refusal itself. So this asks for the sentence and the code, through the
 * real router, and -- the quiet side -- that an expression it can keep is kept.
 */

import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { upsertConnection } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { messages } from "../i18n/index.ts";
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
  await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

function caller() {
  const ctx: Context = {
    exec: db,
    user: { userId: ADMIN.userId, email: ADMIN.email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

describe("connections.setCadence with a cron expression", () => {
  it("one the scheduler cannot keep is refused in the reader's words, with a code beside them", async () => {
    let refused: unknown = null;
    try {
      await caller().connections.setCadence({
        tenantId: TENANT,
        source: "hubspot",
        cadence: "custom",
        cron: "*/2 * * * *",
      });
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(TRPCError);
    const refusal = refused as TRPCError;
    expect(refusal.code).toBe("BAD_REQUEST");
    expect(refusal.message).toBe(
      messages(DEFAULT_LOCALE)("error.cronTooFrequent", { cron: "*/2 * * * *", minutes: "5" }),
    );
    expect((refusal.cause as { facts?: unknown } | undefined)?.facts).toEqual({
      source: "hubspot",
      reason: "cron-too-frequent",
    });
  });

  it("one it can keep is saved and read back", async () => {
    await caller().connections.setCadence({
      tenantId: TENANT,
      source: "hubspot",
      cadence: "custom",
      cron: "30 7 * * 1-5",
    });

    const hubspot = (await caller().connections.list({ tenantId: TENANT })).find(
      (card) => card.source === "hubspot",
    );
    expect(hubspot).toMatchObject({ cadence: "custom", cron: "30 7 * * 1-5" });
  });
});
