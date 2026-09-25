/**
 * The assistant is not a weaker door into the same house.
 *
 * This is the promise the whole design rests on, so it is asserted the only way that means
 * anything: by running a bound tool through the REAL router against PGlite, as the role that
 * asked. If `bindTools` ever stopped going through `createCaller` -- calling a service directly
 * for speed, say -- every test here would keep passing on the read path and the authorization
 * tests below would fail, which is the point of having both.
 *
 * Each guard is pinned from both sides, per `.claude/rules/tests.md`: the viewer who is refused
 * AND the admin who is not. A refusal test alone is satisfied by a tool that always throws.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { DEFAULT_LOCALE } from "@undercroft/core";
import type { SqlExecutor } from "@undercroft/db";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { CATALOGUE, TOOLS } from "../services/assistant/catalogue.ts";
import { bindTools, unresolvedProcedures } from "./assistantTools.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

/**
 * For the tests that only BIND tools: binding reads the catalogue and never runs a procedure,
 * so a query here is a loud failure rather than a silent dependency on a fixture.
 */
const noDatabase: SqlExecutor = {
  query: () => Promise.reject(new Error("binding a tool must not touch the database")),
  exec: () => Promise.reject(new Error("binding a tool must not touch the database")),
};

function context(user: SessionUser | null, superadmin = false, exec: SqlExecutor = db): Context {
  return {
    exec,
    user,
    sessionId: "s1",
    superadmin,
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
}

async function seedMember(email: string, role: Role, tenantId = "CASE-0042"): Promise<SessionUser> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.app_user (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = app.app_user.email RETURNING id`,
    [email],
  );
  const userId = rows[0]!.id;
  await db.query(
    `INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = $3`,
    [tenantId, userId, role],
  );
  return { userId, email };
}

/** Run one bound tool the way the model would, and report what came back. */
async function call(ctx: Context, name: string, input: unknown): Promise<unknown> {
  const tools = bindTools(ctx, { tiers: ["read", "navigate", "write", "privileged"] });
  const tool = tools[name];
  if (tool?.execute === undefined) {
    throw new Error(`no bound tool named ${name}`);
  }
  return await tool.execute(input, { toolCallId: "c1", messages: [], context: undefined });
}

describe("every tool the catalogue declares is bound to a procedure that exists", () => {
  it("no declared procedure path is dangling", () => {
    // The catalogue names its procedures as strings, because a service may not import the
    // router (`layer-service-no-upward`). That trade buys layering and costs a compile-time
    // check, so this test is the check: a renamed procedure fails the gate rather than failing
    // at somebody's first question.
    expect(unresolvedProcedures()).toEqual([]);
  });

  it("some tool declares a procedure, so the assertion above is not vacuous", () => {
    // Not "the catalogue is not empty": a catalogue of navigate tools alone declares no
    // procedure path, and the check above would pass having checked nothing.
    expect(Object.values(TOOLS).some((spec) => spec.procedure !== undefined)).toBe(true);
  });
});

describe("a bound tool carries the caller's authority, not the assistant's", () => {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-0042'), ('CASE-0043')");
    // Seeded as the superuser; from here on every statement runs as the control plane does.
    await db.become("undercroft_app");
  });

  afterEach(async () => {
    await db.close();
  });

  it("a member reading their own customer's sources is answered", async () => {
    const user = await seedMember("member@example.test", "member");
    const answered = await call(context(user), "sourceStatus", { tenantId: "CASE-0042" });
    expect(Array.isArray(answered)).toBe(true);
  });

  it("a member asking about a customer they are not in is refused, as NOT FOUND", async () => {
    const user = await seedMember("member@example.test", "member");
    // NOT_FOUND rather than FORBIDDEN is the anti-enumeration boundary `tenantProcedure`
    // draws, and it matters more here than anywhere: an assistant that answered "you lack
    // permission for CASE-0043" would confirm that customer exists to anyone who can type.
    await expect(call(context(user), "sourceStatus", { tenantId: "CASE-0043" })).rejects.toThrow(
      /NOT_FOUND/u,
    );
  });

  it("a viewer is refused an admin-only read, in their own language", async () => {
    const user = await seedMember("viewer@example.test", "viewer");
    // `lake.search` is admin-only. The refusal carries the procedure's own worded message, so
    // the model can tell the reader what happened rather than quietly trying something else.
    await expect(
      call(context(user), "searchLake", { tenantId: "CASE-0042", q: "hợp đồng", limit: 5 }),
    ).rejects.toThrow(/FORBIDDEN/u);
  });

  it("an admin gets past that same boundary", async () => {
    const user = await seedMember("admin@example.test", "admin");
    // The quiet half of the guard above -- without it, a `searchLake` that threw for everybody
    // would satisfy the viewer test while the feature was broken.
    //
    // The admin's refusal is PRECONDITION_FAILED, not success: this suite configures no worker,
    // and a lake search runs there. That is the assertion rather than a weakness in it, and it
    // is the idiom `authz.test.ts` already uses -- the DIFFERENCE between the two codes is the
    // authorization fact. FORBIDDEN means stopped at the role; PRECONDITION_FAILED means
    // through it and stopped by infrastructure.
    await expect(
      call(context(user), "searchLake", { tenantId: "CASE-0042", q: "hợp đồng", limit: 5 }),
    ).rejects.toThrow(/PRECONDITION_FAILED/u);
  });

  it("an anonymous caller is refused before any customer is named", async () => {
    await expect(call(context(null), "listCustomers", {})).rejects.toThrow(/UNAUTHORIZED/u);
  });

  it("a superadmin holds admin without a membership row", async () => {
    const user = await seedMember("root@example.test", "viewer", "CASE-0043");
    // Seeded as a VIEWER in another customer deliberately: if authority came from
    // `tenant_member` rather than from `authorityIn`, this would be refused -- the bug that
    // once left the one person able to set up a deployment unable to finish a consent.
    const answered = await call(context(user, true), "sourceStatus", { tenantId: "CASE-0042" });
    expect(Array.isArray(answered)).toBe(true);
  });
});

describe("a tier that is not bound cannot be reached at all", () => {
  it("binding only the read tier offers no write tool", () => {
    const readOnly = bindTools(context(null, false, noDatabase), { tiers: ["read"] });
    const everything = bindTools(context(null, false, noDatabase), {
      tiers: ["read", "navigate", "write", "privileged"],
    });
    // An unbound tool is a stronger guarantee than a bound one that refuses: no prompt can
    // call a verb that was never put on the table. Today both sets are equal because only the
    // read tier exists; the assertion is written against the tiers so it keeps its meaning
    // when the write tier lands.
    const writeTools = Object.entries(CATALOGUE).filter(([, spec]) => spec.tier !== "read");
    for (const [name] of writeTools) {
      expect(readOnly[name]).toBeUndefined();
      expect(everything[name]).toBeDefined();
    }
    expect(Object.keys(readOnly).length).toBe(Object.keys(CATALOGUE).length - writeTools.length);
  });
});
