/**
 * The Xero half of the connection verbs: which organisations a consent can see, and what
 * disconnecting tells Xero.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { InMemoryByteFetcher } from "@undercroft/core";
import { migrate } from "@undercroft/db";
import { readCredential, upsertConnection, writeCredential } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { browseScope, revokeConnection, XERO_REVOKE_URL } from "./connections.ts";
import { XERO_CONNECTIONS_URL } from "./xero/organisations.ts";

const ENV = { UNDERCROFT_SECRET_KEY: Buffer.alloc(32, 4).toString("base64") };
const XERO = { clientId: "xero-client", clientSecret: "xero-secret" };

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await upsertConnection(db, { tenantId: "CASE-1", source: "xero", status: "connected" });
  await writeCredential(
    db,
    "CASE-1",
    "xero",
    { accessToken: "at", refreshToken: "rt-live", expiresAt: null },
    { env: ENV },
  );
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

describe("browsing a Xero consent's organisations", () => {
  it("lists them for the admin to choose from", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      body: [{ tenantId: "org-9f2a", tenantName: "Acme Pte Ltd" }],
    });

    const outcome = await browseScope(
      { exec: db, fetcher, token: () => Promise.resolve("t") },
      { source: "xero", kind: "organisations" },
    );

    expect(outcome).toEqual({
      ok: true,
      items: [{ id: "org-9f2a", name: "Acme Pte Ltd", kind: null }],
    });
  });

  it("a consent Xero refuses is a reconnect, not an outage; a pair nobody lists is unsupported", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      status: 401,
      body: {},
    });

    expect(
      await browseScope(
        { exec: db, fetcher, token: () => Promise.resolve("t") },
        { source: "xero", kind: "organisations" },
      ),
    ).toEqual({ ok: false, reason: "scope-insufficient" });
    expect(
      await browseScope(
        { exec: db, fetcher, token: () => Promise.resolve("t") },
        { source: "xero", kind: "labels" },
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("disconnecting Xero", () => {
  it("revokes the refresh token at Xero with the client's credential, then forgets ours", async () => {
    const fetcher = new InMemoryByteFetcher().on("POST", XERO_REVOKE_URL, {
      status: 200,
      body: "",
    });

    const result = await revokeConnection(
      { exec: db, fetcher, token: () => Promise.resolve("at"), xero: XERO, env: ENV },
      { source: "xero", tenantId: "CASE-1" },
    );

    expect(result.revokedUpstream).toBe(true);
    const [sent] = fetcher.calls;
    expect(sent?.headers.authorization).toBe(
      `Basic ${Buffer.from("xero-client:xero-secret").toString("base64")}`,
    );
    expect(new URLSearchParams(sent?.body ?? "").get("token")).toBe("rt-live");
    await expect(readCredential(db, "CASE-1", "xero", { env: ENV })).rejects.toThrow();
  });

  it("with no Xero client configured, or a Xero that refuses, ours is still forgotten and it says so", async () => {
    const refusing = new InMemoryByteFetcher().on("POST", XERO_REVOKE_URL, {
      status: 400,
      body: { error: "invalid_token" },
    });

    const refused = await revokeConnection(
      { exec: db, fetcher: refusing, token: () => Promise.resolve("at"), xero: XERO, env: ENV },
      { source: "xero", tenantId: "CASE-1" },
    );
    expect(refused.revokedUpstream).toBe(false);
    await expect(readCredential(db, "CASE-1", "xero", { env: ENV })).rejects.toThrow();
  });
});
