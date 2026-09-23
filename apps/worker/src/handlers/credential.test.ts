/**
 * The credential verb with `validate`: a pasted token is proven against the provider before
 * it is sealed, and a refused one leaves nothing behind.
 */

import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";
import { createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";

import { createLakeApi } from "./lake.ts";

const PROBE = "https://api.hubapi.com/crm/v3/objects/companies?limit=1";
const KEY = Buffer.alloc(32, 6).toString("base64");

let db: TestDatabase;

beforeEach(async () => {
  db = await createMigratedTestDatabase();
  await db.query("INSERT INTO ops.tenant (id) VALUES ('CASE-1')");
  await db.become("undercroft_worker");
});

afterEach(async () => {
  await db.close();
});

function post(byteFetcher: InMemoryByteFetcher, body: unknown) {
  const app = createLakeApi({
    lake: new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) }),
    exec: db,
    serviceToken: "svc-token",
    env: { UNDERCROFT_SECRET_KEY: KEY },
    byteFetcher,
  });
  return app.request("/v1/connections/credential", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer svc-token" },
    body: JSON.stringify(body),
  });
}

const PASTED = {
  source: "hubspot",
  tenantId: "CASE-1",
  externalAccountId: "",
  scope: "",
  credential: { accessToken: "pat-typed-by-an-admin", refreshToken: "", expiresAt: null },
  validate: true,
};

async function connectionStatus(): Promise<string | null> {
  const { rows } = await db.query<{ status: string }>(
    "SELECT status FROM ops.connection WHERE tenant_id = 'CASE-1' AND source = 'hubspot'",
  );
  return rows[0]?.status ?? null;
}

describe("POST /v1/connections/credential with validate", () => {
  it("a token the provider accepts is sealed and the connection reads connected", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { body: { results: [] } });

    const res = await post(fetcher, PASTED);

    expect(res.status).toBe(200);
    expect(await connectionStatus()).toBe("connected");
    expect(fetcher.calls[0]?.headers.authorization).toBe("Bearer pat-typed-by-an-admin");
  });

  it("a token the provider refuses is 422 and leaves no connection behind", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { status: 401, body: {} });

    const res = await post(fetcher, PASTED);

    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("credential_rejected");
    expect(await connectionStatus()).toBeNull();
  });

  it("a provider that is down is an outage, not a rejected token", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { status: 503, body: {} });

    const res = await post(fetcher, PASTED);

    expect(res.status).toBe(502);
    expect(await connectionStatus()).toBeNull();
  });

  it("without validate a consent's credential is sealed as before, unprobed", async () => {
    // The quiet side: an OAuth consent has just been issued by the provider and needs no
    // probe -- and must not fail because none is modelled.
    const fetcher = new InMemoryByteFetcher();

    const res = await post(fetcher, { ...PASTED, validate: false });

    expect(res.status).toBe(200);
    expect(fetcher.calls).toHaveLength(0);
  });
});
