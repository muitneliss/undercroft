/**
 * A tenant's catalogue of document kinds over tRPC: who may change it, what a kind must say, and
 * when publishing makes a version. ADR 0085.
 *
 * Publishing is what the worker re-classifies on, so the promise worth pinning is that it makes
 * a version exactly when the catalogue changed -- never for an unchanged one, which would pay to
 * classify everything again for nothing.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { InMemoryWorkerClient } from "../services/inMemoryWorkerClient.ts";
import type { WorkerClient } from "../services/workerClient.ts";
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

function caller(
  userId: string,
  email: string,
  locale: "vi" | "en" = "en",
  worker: WorkerClient | null = null,
) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    credentialId: "s1",
    via: "session",
    grant: "write",
    superadmin: false,
    locale,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({
        ok: false as const,
        reason: "not-configured" as const,
        provider: "google" as const,
      }),
    worker,
    specReads: new Map(),
    googlePicker: null,
  };
  return appRouter.createCaller(ctx).documentKinds;
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

describe("editing the catalogue", () => {
  it("a member reads it but may not change it", async () => {
    const member = await seedMember("m@example.test", "member");

    const got = await refusal(() =>
      caller(member, "m@example.test").add({ tenantId: TENANT, kind: "invoice" }),
    );

    expect(got.code).toBe("FORBIDDEN");
    expect((await caller(member, "m@example.test").list({ tenantId: TENANT })).kinds).toEqual([]);
  });

  it("a generic kind added without a description takes the generic catalogue's", async () => {
    const admin = await seedMember("a@example.test", "admin");

    await caller(admin, "a@example.test").add({ tenantId: TENANT, kind: "invoice" });

    const { kinds, available } = await caller(admin, "a@example.test").list({ tenantId: TENANT });
    expect(kinds.map((k) => [k.kind, k.origin, k.description])).toEqual([
      [
        "invoice",
        "generic",
        "A bill requesting payment for goods or services, including a tax invoice.",
      ],
    ]);
    expect(available.map((k) => k.kind)).not.toContain("invoice");
  });

  it("a kind of the admin's own must say what it means", async () => {
    const admin = await seedMember("a@example.test", "admin");

    const got = await refusal(() =>
      caller(admin, "a@example.test").add({ tenantId: TENANT, kind: "membership_form" }),
    );

    expect(got).toEqual({
      code: "BAD_REQUEST",
      message:
        "membership_form is not in the generic catalogue, so it needs a description: the classifier is told what it means.",
    });
  });

  it("other cannot be removed", async () => {
    const admin = await seedMember("a@example.test", "admin");
    await caller(admin, "a@example.test").add({ tenantId: TENANT, kind: "other" });

    const got = await refusal(() =>
      caller(admin, "a@example.test").remove({ tenantId: TENANT, kind: "other" }),
    );

    expect(got.code).toBe("BAD_REQUEST");
  });
});

describe("publishing the catalogue", () => {
  it("makes a version when the catalogue changed, and only then", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const kinds = caller(admin, "a@example.test");
    await kinds.add({ tenantId: TENANT, kind: "invoice" });

    const first = await kinds.publish({ tenantId: TENANT });
    const again = await kinds.publish({ tenantId: TENANT });
    await kinds.update({
      tenantId: TENANT,
      kind: "invoice",
      description: "A bill from a supplier.",
    });
    const pending = (await kinds.list({ tenantId: TENANT })).unpublishedChanges;
    const edited = await kinds.publish({ tenantId: TENANT });

    expect(first).toEqual({ version: 1, changed: true });
    expect(again).toEqual({ version: 1, changed: false });
    expect(pending).toBe(true);
    expect(edited).toEqual({ version: 2, changed: true });
  });

  it("refuses a catalogue with no kind besides other", async () => {
    const admin = await seedMember("a@example.test", "admin");
    await caller(admin, "a@example.test").add({ tenantId: TENANT, kind: "other" });

    const got = await refusal(() => caller(admin, "a@example.test").publish({ tenantId: TENANT }));

    expect(got.code).toBe("PRECONDITION_FAILED");
  });
});

describe("initialising the catalogue", () => {
  it("starts a run on the worker and answers with its id to watch", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient();

    const started = await caller(admin, "a@example.test", "en", worker).initialise({
      tenantId: TENANT,
    });

    expect(started).toEqual({ runId: "run-init-1" });
    expect(worker.initialised).toEqual([{ tenantId: TENANT, triggeredBy: admin }]);
  });

  it("is a CONFLICT for a tenant whose catalogue already has kinds", async () => {
    const admin = await seedMember("a@example.test", "admin");
    const worker = new InMemoryWorkerClient().catalogueExists();

    const got = await refusal(() =>
      caller(admin, "a@example.test", "en", worker).initialise({ tenantId: TENANT }),
    );

    expect(got).toEqual({
      code: "CONFLICT",
      message:
        "This catalogue already has kinds, and initialising again would re-add the ones you removed. Edit it instead.",
    });
  });
});
