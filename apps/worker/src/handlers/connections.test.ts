/**
 * The connection verbs, through the HTTP seam.
 *
 * What is under test is mostly the privilege boundary. These three verbs mint, inspect and
 * destroy a customer's credential, so who may call them is the whole question -- and the
 * answer is deliberately narrower than for `/v1/lake/records`.
 */

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/style/noMagicNumbers: In a test the number IS the assertion. `expect(delayMs).toBe(5000)` says what the code must do; `expect(delayMs).toBe(EXPECTED_BACKOFF_MS)` says only that two names agree, and it can pass while both are wrong. Naming a fixture value also puts the expected result somewhere other than the line asserting it, which is the opposite of what .claude/rules/tests.md asks for. Source files get named constants; test files keep their literals.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { hashToken, randomToken } from "@undercroft/crypto";
import { migrate } from "@undercroft/db";
import { readCredential } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { createLakeApi } from "./lake.ts";

const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
const TENANT = "CASE-0042";

let db: TestDatabase;
let lake: LakeStore;
let fetcher: InMemoryByteFetcher;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  fetcher = new InMemoryByteFetcher();
});

afterEach(async () => {
  await db.close();
});

function api() {
  return createLakeApi({
    lake,
    exec: db,
    serviceToken: "svc-token",
    env: ENV,
    byteFetcher: fetcher,
  });
}

function post(path: string, body: unknown, token = "svc-token") {
  return api().request(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const CREDENTIAL = {
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const VALID = {
  source: "gmail",
  tenantId: TENANT,
  // Google's opaque `sub`, never an address: ops.connection is readable by BI.
  externalAccountId: "108134092834092834",
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  credential: CREDENTIAL,
};

/** An ingest key that IS valid for the lake API, to prove it is refused here. */
async function issueIngestKey(): Promise<string> {
  const token = randomToken();
  await db.query("INSERT INTO app.ingest_key (id, token_sha256, tenant_id) VALUES ($1, $2, $3)", [
    "key-1",
    hashToken(token),
    TENANT,
  ]);
  return token;
}

describe("who may manage a credential", () => {
  it("the trigger token is accepted", async () => {
    // The quiet side: a guard that refused everything would satisfy the two below.
    expect((await post("/v1/connections/credential", VALID)).status).toBe(200);
  });

  it("an ingest key is refused, even though it is valid for the lake API", async () => {
    // The firing side, and the point of the verb being service-token only. An ingest key is
    // a grant to LAND data; accepting one here would widen every key ever issued into a
    // credential-management capability.
    const ingestKey = await issueIngestKey();

    const response = await post("/v1/connections/credential", VALID, ingestKey);

    expect(response.status).toBe(401);
    const { rows } = await db.query("SELECT 1 FROM app.connection_secret");
    expect(rows).toHaveLength(0);
  });

  it("no token at all is refused", async () => {
    const response = await api().request("/v1/connections/credential", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID),
    });

    expect(response.status).toBe(401);
  });
});

describe("storing a credential", () => {
  it("the connection and its sealed secret are both written", async () => {
    await post("/v1/connections/credential", VALID);

    const { rows } = await db.query<{ status: string; external_account_id: string }>(
      "SELECT status, external_account_id FROM ops.connection WHERE tenant_id = $1",
      [TENANT],
    );
    expect(rows[0]?.status).toBe("connected");
    expect(rows[0]?.external_account_id).toBe("108134092834092834");

    // Sealed, and openable only with the key -- which the control plane does not have.
    const stored = await readCredential(db, TENANT, "gmail", { env: ENV });
    expect(stored.refreshToken).toBe("rt");
  });

  it("an unknown tenant is a 404 and leaves no credential behind", async () => {
    const response = await post("/v1/connections/credential", { ...VALID, tenantId: "CASE-9999" });

    expect(response.status).toBe(404);
    const { rows } = await db.query("SELECT 1 FROM app.connection_secret");
    expect(rows).toHaveLength(0);
  });

  it("a malformed body is refused and its details name paths, not values", async () => {
    // The body carries a live refresh token; an error that echoed it would put a
    // credential in a log.
    const response = await post("/v1/connections/credential", {
      ...VALID,
      credential: { accessToken: "", refreshToken: "super-secret-token", expiresAt: null },
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("super-secret-token");
  });

  it("consenting twice replaces the credential rather than failing", async () => {
    await post("/v1/connections/credential", VALID);

    const response = await post("/v1/connections/credential", {
      ...VALID,
      credential: { ...CREDENTIAL, refreshToken: "rt2" },
    });

    expect(response.status).toBe(200);
    expect((await readCredential(db, TENANT, "gmail", { env: ENV })).refreshToken).toBe("rt2");
  });
});

describe("browsing what may be shared", () => {
  it("gmail labels come back for the picker", async () => {
    await post("/v1/connections/credential", VALID);
    fetcher.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      body: { labels: [{ id: "Label_8", name: "Invoices" }] },
    });

    const response = await post("/v1/connections/browse", {
      source: "gmail",
      tenantId: TENANT,
      kind: "labels",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: "Label_8", name: "Invoices" }] });
  });

  it("a grant Google refuses is answered as a refusal, not as a fault", async () => {
    // Left to raise, this 403 became a 500, which the control plane could only read as "the
    // worker is down" -- so the operator was told the processing service was not responding
    // when the truth was that the Gmail permission had never been granted. 403 here is what
    // lets that screen name the remedy.
    await post("/v1/connections/credential", VALID);
    fetcher.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      status: 403,
      body: { error: { code: 403, status: "PERMISSION_DENIED" } },
    });

    const response = await post("/v1/connections/browse", {
      source: "gmail",
      tenantId: TENANT,
      kind: "labels",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "scope_insufficient" });
  });

  it("drive cannot be browsed, because its choosing happens in the Picker", async () => {
    const response = await post("/v1/connections/browse", {
      source: "drive",
      tenantId: TENANT,
      kind: "labels",
    });

    expect(response.status).toBe(400);
  });
});

describe("revoking a connection", () => {
  it("the stored credential is deleted and Google is told", async () => {
    await post("/v1/connections/credential", VALID);
    fetcher.on("POST", "https://oauth2.googleapis.com/revoke", { status: 200, body: "" });

    const response = await post("/v1/connections/revoke", { source: "gmail", tenantId: TENANT });

    expect(await response.json()).toEqual({ revokedUpstream: true });
    const { rows } = await db.query("SELECT 1 FROM app.connection_secret");
    expect(rows).toHaveLength(0);
  });

  it("a customer can disconnect even when Google refuses the revoke", async () => {
    // A token already revoked at Google answers 400. Refusing to disconnect over that would
    // trap a customer in a connection they have asked to end.
    await post("/v1/connections/credential", VALID);
    fetcher.on("POST", "https://oauth2.googleapis.com/revoke", {
      status: 400,
      body: { error: "invalid_token" },
    });

    const response = await post("/v1/connections/revoke", { source: "gmail", tenantId: TENANT });

    // Reported, never assumed: the grant may still stand at Google and an operator needs
    // to know that.
    expect(await response.json()).toEqual({ revokedUpstream: false });
    const { rows } = await db.query("SELECT 1 FROM app.connection_secret");
    expect(rows).toHaveLength(0);
  });
});
