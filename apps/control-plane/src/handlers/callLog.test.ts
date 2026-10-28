/**
 * An agent's call kept whole for a superadmin (ADR 0151), through the router as every door calls
 * it, against PGlite, as the control plane's own login.
 *
 * What is promised: a call through an agent's door is kept and read back whole by a superadmin
 * and by nobody else; the browser's is never kept; a secret is never stored, though the call
 * still carries it; an answer carrying a customer's rows is kept as its shape, without a cell; a
 * failure keeps the cause its caller was not told; a body is cut at the cap with its whole size;
 * and a row older than 30 days is swept while a younger one stays.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { DEFAULT_LOCALE } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { appRouter } from "./router.ts";
import type { Context, Role, SessionUser } from "./trpc.ts";

let db: TestDatabase;

async function person(email: string, memberships: Record<string, Role> = {}): Promise<SessionUser> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO app.app_user (email) VALUES ($1) RETURNING id",
    [email],
  );
  const userId = rows[0]?.id ?? "";
  for (const [tenantId, role] of Object.entries(memberships)) {
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1) ON CONFLICT DO NOTHING", [tenantId]);
    await db.query("INSERT INTO app.tenant_member (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
      tenantId,
      userId,
      role,
    ]);
  }
  return { userId, email };
}

function caller(user: SessionUser, door: Partial<Context> = {}) {
  return appRouter.createCaller({
    exec: db,
    user,
    credentialId: "session-1",
    via: "session",
    channel: "web",
    grant: "write",
    superadmin: false,
    locale: DEFAULT_LOCALE,
    endSession: () => Promise.resolve(),
    apps: null,
    notifyInvitation: () => Promise.resolve(false),
    startConsent: () =>
      Promise.resolve({ ok: false, reason: "not-configured", provider: "google" } as const),
    worker: null,
    specReads: new Map(),
    googlePicker: null,
    signInMethods: [],
    publicUrl: null,
    holdOpen: () => undefined,
    ...door,
  });
}

/** A personal token at `/mcp`, as `bearerContext` admits one. */
const MCP = { via: "token", channel: "mcp", grant: "write", credentialId: "upat_abc" } as const;

/** The CLI with the person's own session, as a signed-in terminal sends it. */
const CLI = { channel: "cli" } as const;

/** A platform superadmin reading the log at their own browser. */
async function superadmin() {
  return caller(await person("root@example.test"), { superadmin: true });
}

async function codeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "NO_ERROR";
  } catch (error) {
    if (!(error instanceof TRPCError)) {
      throw error;
    }
    return error.code;
  }
}

/** The one call a person made, whole, as a superadmin reads it. */
async function onlyCallOf(email: string) {
  const root = await superadmin();
  const { items } = await root.audit.calls.list({ email });
  expect(items).toHaveLength(1);
  return root.audit.calls.get({ id: items[0]?.id ?? "" });
}

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.become("undercroft_app");
});

afterEach(async () => {
  await db.close();
});

describe("who is kept, and who may read it", () => {
  it("a call through /mcp is read back by a superadmin: what it sent and what it was answered", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const answer = await caller(admin, MCP).tenants.get({ tenantId: "CASE-1" });

    const root = await superadmin();
    const { items } = await root.audit.calls.list({ email: "admin@example.test" });
    expect(items).toMatchObject([
      {
        path: "tenants.get",
        type: "query",
        channel: "mcp",
        credential: "upat_abc",
        tenantId: "CASE-1",
        outcome: "ok",
        responseKept: "whole",
        requestTruncated: false,
        responseTruncated: false,
      },
    ]);
    // The list carries no body; one call is read whole.
    expect(items[0]).not.toHaveProperty("request");
    const call = await root.audit.calls.get({ id: items[0]?.id ?? "" });
    expect(JSON.parse(call.request ?? "null")).toEqual({ tenantId: "CASE-1" });
    expect(JSON.parse(call.response ?? "null")).toEqual(JSON.parse(JSON.stringify(answer)));
    expect(call.error).toBeNull();
  });

  it("the same call through the browser keeps nothing", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    await caller(admin).tenants.get({ tenantId: "CASE-1" });

    expect((await (await superadmin()).audit.calls.list({})).items).toEqual([]);
  });

  it("a customer's admin is refused the log and every call in it", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    await caller(admin, MCP).tenants.get({ tenantId: "CASE-1" });
    const asAdmin = caller(admin);

    expect(await codeOf(() => asAdmin.audit.calls.list({}))).toBe("FORBIDDEN");
    expect(await codeOf(() => asAdmin.audit.calls.get({ id: "1" }))).toBe("FORBIDDEN");
  });

  it("a call the log does not hold is NOT_FOUND, in the reader's words", async () => {
    const root = await superadmin();
    expect(await codeOf(() => root.audit.calls.get({ id: "42" }))).toBe("NOT_FOUND");
  });
});

describe("what a row never holds", () => {
  it("a minted ingest key's token is answered to the CLI and never kept", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    const minted = await caller(admin, CLI).keys.mint({ tenantId: "CASE-1", label: "nightly" });

    const call = await onlyCallOf("admin@example.test");
    expect(call.response).not.toContain(minted.token);
    expect(JSON.parse(call.response ?? "null")).toEqual({
      id: minted.id,
      token: "[redacted]",
      expiresAt: null,
    });
  });

  it("a personal token minted through the CLI's session is never kept", async () => {
    const admin = await person("admin@example.test");
    const minted = await caller(admin, CLI).account.tokens.mint({
      label: "laptop",
      grant: "read",
      expiresInDays: 30,
    });

    const call = await onlyCallOf("admin@example.test");
    expect(call.response).not.toContain(minted.token);
    expect(JSON.parse(call.response ?? "{}")).toMatchObject({ token: "[redacted]" });
  });

  it("a raw record's payload is kept as its shape: the columns and how many, never a cell", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    await db.asSuperuser((tx) =>
      tx.query(
        `INSERT INTO raw.records (source, tenant_id, entity, source_record_id, payload,
           content_sha256, observed_at, lake_key, lake_stamp, run_id)
         VALUES ('hubspot', 'CASE-1', 'deals', 'd-1', '{"name":"Acme Lantern Works 7731"}'::jsonb,
                 repeat('0', 64), '2026-09-18T08:00:00Z', 'k', 's', 'r-1')`,
      ),
    );
    const page = await caller(admin, MCP).lake.records({
      tenantId: "CASE-1",
      source: "hubspot",
      entity: "deals",
    });
    // The caller is answered with the payload; the row is not.
    expect(page.items[0]?.payload).toContain("Acme Lantern Works 7731");

    const call = await onlyCallOf("admin@example.test");
    expect(call.responseKept).toBe("shape");
    expect(call.response).not.toContain("Acme Lantern Works");
    expect(call.response).not.toContain("d-1");
    expect(JSON.parse(call.response ?? "null")).toEqual({
      items: { count: 1 },
      nextCursor: null,
      ofRun: null,
    });
  });
});

describe("what a row holds that nobody else does", () => {
  it("a call that broke on our side keeps the cause its caller was told only as internal_error", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    // A cursor `audit.mine`'s pattern admits and its `bigint` cannot hold: the statement fails
    // in Postgres, after every gate let it through.
    const outOfRange = "9999999999999999999";
    expect(await codeOf(() => caller(admin, MCP).audit.mine({ cursor: outOfRange }))).toBe(
      "INTERNAL_SERVER_ERROR",
    );

    const call = await onlyCallOf("admin@example.test");
    expect(call).toMatchObject({
      path: "audit.mine",
      outcome: "failed",
      reason: "INTERNAL_SERVER_ERROR",
    });
    expect(call.error).toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      status: 500,
      cause: { message: expect.stringContaining("out of range") },
    });
  });

  it("a request over 256 KB is cut on a character, with its whole size", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    // A reference table of 9,000 Vietnamese place names: about 330 KB of JSON, inside a seed's
    // own bounds (10,000 rows, 1 MB), so the call itself is accepted.
    const rows = Array.from({ length: 9000 }, (_, index) => [`Thành phố Hồ Chí Minh ${index}`]);
    await caller(admin, CLI).seeds.save({
      tenantId: "CASE-1",
      name: "places",
      columns: [{ name: "place", type: "text" }],
      rows,
      create: true,
    });

    const call = await onlyCallOf("admin@example.test");
    const sent = new TextEncoder().encode(
      JSON.stringify({
        tenantId: "CASE-1",
        name: "places",
        columns: [{ name: "place", type: "text" }],
        rows,
        create: true,
      }),
    ).length;
    expect(call.requestTruncated).toBe(true);
    expect(call.requestBytes).toBe(sent);
    const kept = new TextEncoder().encode(call.request ?? "").length;
    expect(kept).toBeLessThanOrEqual(256 * 1024);
    expect(kept).toBeGreaterThan(256 * 1024 - 4);
    // Cut between characters: no replacement character where a multi-byte one was split.
    expect(call.request).not.toContain("�");
  });
});

describe("retention", () => {
  it("a row older than 30 days is swept when the log next turns a thousand; a younger one stays", async () => {
    const admin = await person("admin@example.test", { "CASE-1": "admin" });
    await db.asSuperuser(async (tx) => {
      await tx.query(
        `INSERT INTO ops.call_log (at, user_id, actor, channel, path, type, outcome, response_kept)
         VALUES (now() - interval '31 days', $1, 'old@example.test', 'cli', 'tenants.list', 'query',
                 'ok', 'whole'),
                (now() - interval '29 days', $1, 'recent@example.test', 'cli', 'tenants.list',
                 'query', 'ok', 'whole')`,
        [admin.userId],
      );
      // The next row is the thousandth, which sweeps.
      await tx.query("SELECT setval(pg_get_serial_sequence('ops.call_log', 'id'), 999)");
    });
    await caller(admin, MCP).tenants.get({ tenantId: "CASE-1" });

    const { items } = await (await superadmin()).audit.calls.list({});
    expect(items.map(({ actor }) => actor)).toEqual(["admin@example.test", "recent@example.test"]);
  });
});
