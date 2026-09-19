/**
 * The ledger over tRPC: who may read it, and what a run looks like from the interface.
 */

// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useDestructuring: Style preference with no correctness content, and it fires where the current form names the source of the value (`page.items[1]`), which is the thing worth seeing at the call site.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys, HTTP header names, and Better Auth's option keys and table names. strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { closeRun, openRun, recordEntities, recordRefusals } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { appRouter } from "./router.ts";
import type { Context, Role } from "./trpc.ts";

let db: TestDatabase;

async function seedMember(email: string, role: Role, tenantId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    tenantId,
    userId,
    role,
  ]);
  return userId;
}

function caller(userId: string, email: string) {
  const ctx: Context = {
    exec: db,
    user: { userId, email },
    sessionId: "s1",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () => Promise.resolve({ ok: false as const, reason: "not-configured" as const }),
    worker: null,
    googlePicker: null,
  };
  return appRouter.createCaller(ctx);
}

async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.exec("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
  await db.become("undercroft_app");

  await openRun(db, {
    id: "r-ok",
    tenantId: "CASE-0042",
    source: "hubspot",
    verb: "ingest",
    trigger: "schedule",
  });
  await recordEntities(db, "r-ok", [
    { entity: "deals", landed: 5, created: 4, changed: 1, unchanged: 0, refused: 1 },
  ]);
  await recordRefusals(db, "r-ok", [
    { entity: "deals", sourceRecordId: "d-7", reason: "no value at idPath" },
  ]);
  await closeRun(db, "r-ok", { status: "ok", created: 4, changed: 1, refused: 1 });
  await openRun(db, {
    id: "r-running",
    tenantId: "CASE-0042",
    source: "xero",
    verb: "ingest",
    trigger: "manual",
  });
  await openRun(db, {
    id: "r-other",
    tenantId: "CASE-0043",
    source: "hubspot",
    verb: "ingest",
    trigger: "schedule",
  });
});

afterEach(async () => {
  await db.close();
});

describe("runs.list", () => {
  it("a viewer reads the tenant's ledger, newest first, with entities and counts", async () => {
    const viewer = await seedMember("v@example.test", "viewer", "CASE-0042");
    const page = await caller(viewer, "v@example.test").runs.list({ tenantId: "CASE-0042" });

    expect(page.items.map((r) => r.id)).toEqual(["r-running", "r-ok"]);
    const ok = page.items[1];
    expect(ok?.kind).toBe("ingest");
    expect(ok?.source).toBe("hubspot");
    expect(ok?.entities).toEqual(["deals"]);
    expect(ok?.counts).toEqual({ landed: 5, created: 4, changed: 1, unchanged: 0, refused: 1 });
    // A run still in progress reports no counts: a number still changing is not a number.
    expect(page.items[0]?.counts).toBeNull();
    expect(page.nextCursor).toBeNull();
  });

  it("another tenant's runs are not in it", async () => {
    const viewer = await seedMember("v@example.test", "viewer", "CASE-0042");
    const page = await caller(viewer, "v@example.test").runs.list({ tenantId: "CASE-0042" });
    expect(page.items.map((r) => r.id)).not.toContain("r-other");
  });
});

describe("runs.get", () => {
  it("returns the run with its refusals and their reasons", async () => {
    const member = await seedMember("m@example.test", "member", "CASE-0042");
    const run = await caller(member, "m@example.test").runs.get({
      tenantId: "CASE-0042",
      runId: "r-ok",
    });
    expect(run.refusals.map((r) => [r.sourceRecordId, r.reason])).toEqual([
      ["d-7", "no value at idPath"],
    ]);
    expect(run.entityCounts[0]?.entity).toBe("deals");
    expect(run.steps).toEqual([]);
  });

  it("a run of another tenant is NOT_FOUND, never FORBIDDEN", async () => {
    const member = await seedMember("m@example.test", "member", "CASE-0042");
    expect(
      await errorCode(() =>
        caller(member, "m@example.test").runs.get({ tenantId: "CASE-0042", runId: "r-other" }),
      ),
    ).toBe("NOT_FOUND");
  });
});
