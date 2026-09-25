/**
 * The connection verbs, through the HTTP seam.
 *
 * What is under test is mostly the privilege boundary. These three verbs mint, inspect and
 * destroy a customer's credential, so who may call them is the whole question -- and the
 * answer is deliberately narrower than for `/v1/lake/records`.
 */

import { createStampSource, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { hashToken, randomToken } from "@undercroft/crypto";
import type { SqlExecutor } from "@undercroft/db";
import { readCredential } from "@undercroft/db/repos";
import { createMigratedTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { InMemoryObjectStore, LakeStore } from "@undercroft/lake";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { GOOGLE_TOKEN_URL, googleRefresher } from "../services/google/refresh.ts";
import { noDatabase } from "../testing.ts";
import { createLakeApi } from "./lake.ts";

const KEY = Buffer.alloc(32, 9).toString("base64");
const ENV = { UNDERCROFT_SECRET_KEY: KEY };
const TENANT = "CASE-0042";

let db: TestDatabase;
let lake: LakeStore;
let fetcher: InMemoryByteFetcher;

beforeEach(() => {
  lake = new LakeStore(new InMemoryObjectStore(), { stamps: createStampSource(new TestClock()) });
  fetcher = new InMemoryByteFetcher();
});

/**
 * A migrated database with one tenant, entered as the worker. Per describe, so the requests
 * refused before any statement (the last describe) do not open a database they never reach.
 */
function withDatabase(): void {
  beforeEach(async () => {
    db = await createMigratedTestDatabase();
    await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
    // Seeded as the superuser; from here on every statement runs as the worker does.
    await db.become("undercroft_worker");
  });

  afterEach(async () => {
    await db.close();
  });
}

/** The API. `exec` is `noDatabase` only for requests refused before any SQL. */
function api(exec: SqlExecutor = db) {
  return createLakeApi({
    lake,
    exec,
    serviceToken: "svc-token",
    env: ENV,
    byteFetcher: fetcher,
  });
}

function post(path: string, body: unknown, token = "svc-token", exec: SqlExecutor = db) {
  return api(exec).request(path, {
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
  // Minting a key is the control plane's; the worker only ever reads the digest.
  await db.asSuperuser((tx) =>
    tx.query("INSERT INTO app.ingest_key (id, token_sha256, tenant_id) VALUES ($1, $2, $3)", [
      "key-1",
      hashToken(token),
      TENANT,
    ]),
  );
  return token;
}

describe("who may manage a credential", () => {
  withDatabase();

  it("the trigger token is accepted", async () => {
    // The quiet side: a guard that refused everything would satisfy the test below.
    expect((await post("/v1/connections/credential", VALID)).status).toBe(200);
  });

  it("an ingest key is refused, even though it is valid for the lake API, and so is none", async () => {
    // The firing side, and the point of the verb being service-token only. An ingest key is
    // a grant to LAND data; accepting one here would widen every key ever issued into a
    // credential-management capability.
    const ingestKey = await issueIngestKey();

    const response = await post("/v1/connections/credential", VALID, ingestKey);
    const anonymous = await api().request("/v1/connections/credential", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(VALID),
    });

    expect(response.status).toBe(401);
    expect(anonymous.status).toBe(401);
    const { rows } = await db.query("SELECT 1 FROM app.connection_secret");
    expect(rows).toHaveLength(0);
  });
});

describe("storing a credential", () => {
  withDatabase();

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

  it("consenting twice replaces the credential rather than failing", async () => {
    await post("/v1/connections/credential", VALID);

    const response = await post("/v1/connections/credential", {
      ...VALID,
      credential: { ...CREDENTIAL, refreshToken: "rt2" },
    });

    expect(response.status).toBe(200);
    expect((await readCredential(db, TENANT, "gmail", { env: ENV })).refreshToken).toBe("rt2");
  });

  it("a credential for another account is refused and the pinned one is kept", async () => {
    // The firing side of the test above. Another mailbox's token sealed here would file its
    // mail under this connection's stream, green, with nothing erroring. ADR 0043.
    await post("/v1/connections/credential", VALID);

    const response = await post("/v1/connections/credential", {
      ...VALID,
      externalAccountId: "208134092834092834",
      credential: { ...CREDENTIAL, refreshToken: "somebody-else" },
    });

    expect(response.status).toBe(412);
    expect((await readCredential(db, TENANT, "gmail", { env: ENV })).refreshToken).toBe("rt");
  });

  it("a Xero reconsent, which names no organisation, keeps the one already chosen", async () => {
    // A Xero consent names nobody; the organisation is chosen afterwards. Reconnecting used to
    // blank that choice, and the next run refused for want of the header it supplies.
    const xero = { ...VALID, source: "xero", externalAccountId: "", scope: "" };
    await post("/v1/connections/credential", xero);
    await db.asSuperuser((tx) =>
      tx.query(
        "UPDATE ops.connection SET external_account_id = 'org-1' WHERE tenant_id = $1 AND source = 'xero'",
        [TENANT],
      ),
    );

    await post("/v1/connections/credential", xero);

    const { rows } = await db.query<{ external_account_id: string }>(
      "SELECT external_account_id FROM ops.connection WHERE tenant_id = $1 AND source = 'xero'",
      [TENANT],
    );
    expect(rows[0]?.external_account_id).toBe("org-1");
  });
});

describe("browsing what may be shared", () => {
  withDatabase();

  it("gmail labels come back for the picker", async () => {
    await post("/v1/connections/credential", VALID);
    fetcher.on("GET", "https://gmail.googleapis.com/gmail/v1/users/me/labels", {
      body: { labels: [{ id: "Label_8", name: "Invoices", type: "user" }] },
    });

    const response = await post("/v1/connections/browse", {
      source: "gmail",
      tenantId: TENANT,
      kind: "labels",
    });

    expect(response.status).toBe(200);
    // Who owns a label crosses the hop, not only its name. Drop it here and the picker still
    // renders every label -- in one undifferentiated run, with the thirteen Gmail ships
    // sitting on top of the ones an admin came to find, and nothing on the page to say a
    // classification was lost on the way.
    expect(await response.json()).toEqual({
      items: [{ id: "Label_8", name: "Invoices", kind: "user" }],
      partial: [],
    });
  });

  it("a Drive grant of drive.file is a reconnect, and Google is never asked", async () => {
    // Issue 177's "reconnect, not a generic refusal", and why it cannot be Google's 403 that
    // says so: under drive.file Google refuses nothing, it answers the folder listing with an
    // empty page, and the browse would offer "no folders" as the truth about a customer's
    // drive. Every Drive connection made before ADR 0047 holds this scope.
    await post("/v1/connections/credential", {
      ...VALID,
      source: "drive",
      scope: "openid https://www.googleapis.com/auth/drive.file",
    });

    const response = await post("/v1/connections/browse", {
      source: "drive",
      tenantId: TENANT,
      kind: "folders",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "scope_insufficient" });
    expect(fetcher.calls).toEqual([]);
  });

  it("a Drive grant of drive.readonly lists its folders and file types", async () => {
    // The quiet side, through the verb: the pair is served, the grant passes, and what an
    // admin pastes into a Drive scope -- `{ id, name, kind: "folder" }` -- crosses the hop
    // with its path, beside a completeness verdict.
    await post("/v1/connections/credential", {
      ...VALID,
      source: "drive",
      scope: "openid https://www.googleapis.com/auth/drive.readonly",
    });
    function files(q: string, fields: string): string {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", q);
      url.searchParams.set("fields", `nextPageToken,incompleteSearch,${fields}`);
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("corpora", "allDrives");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      return url.toString();
    }
    const folder = "application/vnd.google-apps.folder";
    fetcher
      .on(
        "GET",
        "https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=nextPageToken%2Cdrives%28id%2Cname%29",
        { body: { drives: [] } },
      )
      .on("GET", files(`mimeType = '${folder}' and trashed = false`, "files(id,name,parents)"), {
        body: { files: [{ id: "fo-1", name: "Statements", parents: ["root"] }] },
      })
      .on("GET", files(`mimeType != '${folder}' and trashed = false`, "files(mimeType)"), {
        body: { files: [{ mimeType: "application/pdf" }] },
      });

    const response = await post("/v1/connections/browse", {
      source: "drive",
      tenantId: TENANT,
      kind: "folders",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        { id: "fo-1", name: "Statements", kind: "folder", path: ["Statements"] },
        { id: "application/pdf", name: "application/pdf", kind: "file-type" },
      ],
      partial: [],
    });
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
});

describe("browsing a mailbox whose refresh token is dead", () => {
  withDatabase();

  const SECOND = "gmail.3fa9c1d2e0ab";

  /** The API as production wires it for Gmail: with the kind's refresher, over `fetcher`. */
  async function browse(): Promise<Response> {
    return await createLakeApi({
      lake,
      exec: db,
      serviceToken: "svc-token",
      env: ENV,
      byteFetcher: fetcher,
      refreshers: { gmail: googleRefresher({ clientId: "c", clientSecret: "s", fetcher }) },
    }).request("/v1/connections/browse", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer svc-token" },
      body: JSON.stringify({ source: SECOND, tenantId: TENANT, kind: "labels" }),
    });
  }

  async function statusOf(source: string): Promise<string | undefined> {
    const { rows } = await db.query<{ status: string }>(
      "SELECT status FROM ops.connection WHERE tenant_id = $1 AND source = $2",
      [TENANT, source],
    );
    return rows[0]?.status;
  }

  it("a refresh Google refuses is a reconnect: 409, and the connection now reads expired", async () => {
    // Issue 213. Google answers a dead refresh token with 400 `invalid_grant`; that escaped as a
    // 500, the scope screen said only that the list could not be fetched, and the connection
    // went on reading "connected". The list itself is never asked for. An outage at the token
    // endpoint is the quiet side, pinned where it is decided (`google/refresh.test.ts`,
    // `tokenRefresh.test.ts`).
    await post("/v1/connections/credential", {
      ...VALID,
      source: SECOND,
      externalAccountId: "208134092834092834",
      credential: { ...CREDENTIAL, expiresAt: "2020-01-01T00:00:00.000Z" },
    });
    fetcher.on("POST", GOOGLE_TOKEN_URL, { status: 400, body: { error: "invalid_grant" } });

    const response = await browse();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "credential_unusable" });
    expect(await statusOf(SECOND)).toBe("expired");
    expect(fetcher.calls.map((call) => call.url)).toEqual([GOOGLE_TOKEN_URL]);
  });
});

describe("revoking a connection", () => {
  withDatabase();

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

describe("a request refused before the database is asked", () => {
  // `noDatabase` refuses every statement, so each of these also proves that none ran.
  it("a malformed body is refused and its details name paths, not values", async () => {
    // The body carries a live refresh token; an error that echoed it would put a
    // credential in a log.
    const response = await post(
      "/v1/connections/credential",
      {
        ...VALID,
        credential: { accessToken: "", refreshToken: "super-secret-token", expiresAt: null },
      },
      "svc-token",
      noDatabase,
    );

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("super-secret-token");
  });

  it("drive asked for labels is a pair nobody lists, refused before anything is read", async () => {
    const response = await post(
      "/v1/connections/browse",
      { source: "drive", tenantId: TENANT, kind: "labels" },
      "svc-token",
      noDatabase,
    );

    expect(response.status).toBe(400);
  });
});
