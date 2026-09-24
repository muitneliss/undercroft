/**
 * The Xero half of the connection verbs: which organisations a consent can see, and what
 * disconnecting tells Xero.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { InMemoryByteFetcher } from "@undercroft/core";
import { readCredential, upsertConnection, writeCredential } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";

import { noDatabase } from "../testing.ts";
import { browseScope, revokeConnection, XERO_REVOKE_URL } from "./connections.ts";
import { XERO_CONNECTIONS_URL } from "./xero/organisations.ts";

const ENV = { UNDERCROFT_SECRET_KEY: Buffer.alloc(32, 4).toString("base64") };
const XERO = { clientId: "xero-client", clientSecret: "xero-secret" };

let db: TestDatabase;

describe("browsing a Xero consent's organisations", () => {
  // A listing is pure HTTP: the token arrives as an argument and nothing is read or written.
  // `noDatabase` refuses every statement, so these would fail if that ever stopped being so.
  it("lists them for the admin to choose from", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      body: [{ tenantId: "org-9f2a", tenantName: "Acme Pte Ltd" }],
    });

    const outcome = await browseScope(
      { exec: noDatabase, fetcher, token: () => Promise.resolve("t") },
      { source: "xero", tenantId: "CASE-1", kind: "organisations" },
    );

    expect(outcome).toEqual({
      ok: true,
      items: [{ id: "org-9f2a", name: "Acme Pte Ltd", kind: null }],
      partial: [],
    });
  });

  it("a consent Xero refuses is a reconnect, not an outage; a pair nobody lists is unsupported", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      status: 401,
      body: {},
    });

    expect(
      await browseScope(
        { exec: noDatabase, fetcher, token: () => Promise.resolve("t") },
        { source: "xero", tenantId: "CASE-1", kind: "organisations" },
      ),
    ).toEqual({ ok: false, reason: "scope-insufficient" });
    expect(
      await browseScope(
        { exec: noDatabase, fetcher, token: () => Promise.resolve("t") },
        { source: "xero", tenantId: "CASE-1", kind: "labels" },
      ),
    ).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("disconnecting Xero", () => {
  const LIVE = { accessToken: "at", refreshToken: "rt-live", expiresAt: null };

  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
    await upsertConnection(db, { tenantId: "CASE-1", source: "xero", status: "connected" });
    await writeCredential(db, "CASE-1", "xero", LIVE, { env: ENV });
    await db.become("undercroft_worker");
  });

  afterEach(async () => {
    await db.close();
  });

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
    // No client: Xero cannot be told, so it is not asked -- the fetcher records no route and
    // would refuse any request -- and the result says the grant may still stand there.
    const silent = new InMemoryByteFetcher();
    const unconfigured = await revokeConnection(
      { exec: db, fetcher: silent, token: () => Promise.resolve("at"), env: ENV },
      { source: "xero", tenantId: "CASE-1" },
    );
    expect(unconfigured.revokedUpstream).toBe(false);
    expect(silent.calls).toHaveLength(0);
    await expect(readCredential(db, "CASE-1", "xero", { env: ENV })).rejects.toThrow();

    // A Xero that refuses the revoke. The worker may re-seal a credential, as a reconnect does.
    await writeCredential(db, "CASE-1", "xero", LIVE, { env: ENV });
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
