/**
 * The schedule of grants, as the card reads it.
 *
 * `presentStatus` is pure, so the rule deciding whether a customer is asked to reconnect is
 * asked from both sides with no database. The rest runs against real Postgres, because the
 * interesting part -- what a join reaching into `app.connection_secret` is allowed to bring
 * back, and what it must leave behind -- is a property of the query.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { migrate } from "@undercroft/db";
import { upsertConnection, writeConnectionDetail, writeCredential } from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import { disconnect, KNOWN_SOURCES, list, presentStatus, setScope } from "./connections.ts";
import { InMemoryWorkerClient } from "./workerClient.ts";

const TENANT = "CASE-0042";
const ENV = { UNDERCROFT_SECRET_KEY: Buffer.alloc(32, 5).toString("base64") };
const GMAIL_SCOPE = JSON.stringify({ labels: [{ id: "Label_8", name: "Invoices" }] });
/** What Google returns for a Gmail consent nobody unticked. */
const GMAIL_GRANT =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly";

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db);
  await db.query("INSERT INTO ops.tenant (id) VALUES ($1)", [TENANT]);
});

afterEach(async () => {
  await db.close();
});

describe("presentStatus", () => {
  it("a connected, scoped source is connected", () => {
    expect(
      presentStatus({
        status: "connected",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: GMAIL_GRANT,
      }),
    ).toBe("connected");
  });

  it("connected with no recorded scope needs one", () => {
    // Running in this state would read a whole mailbox on the strength of a missing row.
    expect(
      presentStatus({
        status: "connected",
        source: "gmail",
        selectionJson: "{}",
        scope: GMAIL_GRANT,
      }),
    ).toBe("needs_scope");
  });

  it("an empty label list is a recorded decision, not a missing one", () => {
    // The quiet side: "deliberately the whole mailbox" must not read as "nobody has chosen".
    expect(
      presentStatus({
        status: "connected",
        source: "gmail",
        selectionJson: JSON.stringify({ labels: [] }),
        scope: GMAIL_GRANT,
      }),
    ).toBe("connected");
  });

  it("a source that takes no scope is connected without one", () => {
    // HubSpot and Xero have no picker, so `needs_scope` would be a state nobody can leave.
    expect(
      presentStatus({ status: "connected", source: "hubspot", selectionJson: "{}", scope: "" }),
    ).toBe("connected");
  });

  it("a grant missing the permission it asked for needs a reconnect", () => {
    // What `case-001` actually held: Allow pressed with the Gmail tick removed. It read
    // `connected` on the card while every Gmail call came back 403, and the only repair is
    // to consent again.
    expect(
      presentStatus({
        status: "connected",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: "openid https://www.googleapis.com/auth/userinfo.email",
      }),
    ).toBe("needs_reconnect");
  });

  it("an unrecorded grant is not judged either way", () => {
    // The quiet side. An empty scope column is no evidence -- rows predating it, and every
    // source that never went through Google -- and no evidence is not a verdict.
    expect(
      presentStatus({
        status: "connected",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: "",
      }),
    ).toBe("connected");
  });

  it("expired and error both read as needing a reconnect", () => {
    // One state on screen: telling a token expiry from a provider fault is not the
    // customer's question to answer.
    expect(
      presentStatus({
        status: "expired",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: GMAIL_GRANT,
      }),
    ).toBe("needs_reconnect");
    expect(
      presentStatus({
        status: "error",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: GMAIL_GRANT,
      }),
    ).toBe("needs_reconnect");
  });

  it("disconnected stays disconnected", () => {
    expect(
      presentStatus({
        status: "disconnected",
        source: "gmail",
        selectionJson: GMAIL_SCOPE,
        scope: GMAIL_GRANT,
      }),
    ).toBe("disconnected");
  });
});

describe("the schedule", () => {
  it("a tenant with nothing connected still sees every source", async () => {
    // The schedule IS the product: the screen a new customer lands on is the one an
    // established one uses, and an empty list gave it nothing to show.
    const rows = await list(db, TENANT);

    expect(rows.map((r) => r.source)).toEqual([...KNOWN_SOURCES]);
    expect(rows.every((r) => r.status === "disconnected")).toBe(true);
  });

  it("the credential's own expiry stays off the card, along with the credential", async () => {
    // The licence for joining `app.connection_secret` at all is that the control plane may
    // know WHEN a credential expires and may never know what it is. Knowing is not showing:
    // `expiresAt: row.expiresAt` wired the access token's HOURLY rotation to the field the
    // card reads as "when must the customer consent again", so every freshly connected Google
    // source announced "expires today" and then turned itself into "reconnect" an hour later,
    // for a token the worker refreshes unattended. No provider tells us when a GRANT ends, so
    // the card gets null and says "no expiry recorded" -- true, where the number to hand was not.
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
    await writeCredential(
      db,
      TENANT,
      "gmail",
      { accessToken: "at", refreshToken: "rt", expiresAt: "2099-01-01T00:00:00.000Z" },
      ENV,
    );
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
    });

    const gmail = (await list(db, TENANT)).find((r) => r.source === "gmail");

    expect(gmail?.expiresAt).toBeNull();
    expect(JSON.stringify(gmail)).not.toContain("2099-01-01T00:00:00.000Z");
    expect(JSON.stringify(gmail)).not.toContain("ciphertext");
    expect(JSON.stringify(gmail)).not.toContain("rt");
  });

  it("the granted scope string comes back split", async () => {
    await upsertConnection(db, {
      tenantId: TENANT,
      source: "gmail",
      status: "connected",
      scope: "openid https://www.googleapis.com/auth/gmail.readonly",
    });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
    });

    const gmail = (await list(db, TENANT)).find((r) => r.source === "gmail");

    expect(gmail?.scopes).toEqual(["openid", "https://www.googleapis.com/auth/gmail.readonly"]);
  });
});

describe("choosing a scope", () => {
  beforeEach(async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
  });

  it("a valid selection is stored and moves the card to connected", async () => {
    const result = await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const gmail = (await list(db, TENANT)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("connected");
    expect(gmail?.config.labels).toEqual(["Invoices"]);
  });

  it("a selection that does not match the source is refused", async () => {
    // The firing side. A picker that saved a Drive shape under gmail would otherwise store
    // something the collector cannot read, and the run would fail far from the cause.
    const result = await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: JSON.stringify({ files: [{ id: "x", name: "y", kind: "folder" }] }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result).toEqual({ ok: false, reason: "unsupported-source" });
  });

  it("the audit entry counts what was chosen and never names it", async () => {
    // `ops.audit_log` has a wider readership than `app.connection_detail`. What was decided
    // and by whom belongs in a trail; which folders a customer picked is their data.
    await setScope(db, {
      tenantId: TENANT,
      source: "gmail",
      selectionJson: GMAIL_SCOPE,
      actor: "ada@example.test",
      actorId: "u1",
    });

    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.scope_set");
    expect(JSON.stringify(rows[0]?.detail)).toContain('"count":1');
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("Invoices");
  });
});

describe("disconnecting", () => {
  beforeEach(async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });
    await writeConnectionDetail(db, {
      tenantId: TENANT,
      source: "gmail",
      accountLabel: "ops@acme.test",
      selectionJson: GMAIL_SCOPE,
    });
  });

  it("the grant ends, the scope is cleared, and the account history stays", async () => {
    const worker = new InMemoryWorkerClient();

    const result = await disconnect(db, worker, {
      tenantId: TENANT,
      source: "gmail",
      actor: "ada@example.test",
    });

    expect(result.revokedUpstream).toBe(true);
    expect(worker.revoked).toEqual([{ tenantId: TENANT, source: "gmail" }]);

    const gmail = (await list(db, TENANT)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("disconnected");
    // A stored scope for a connection nobody may use is a record of what a customer once
    // shared, kept past the moment they asked us to stop.
    expect(gmail?.config).toEqual({});
    // The row itself stays: reconnecting the same account should look like the same account.
    expect(gmail?.externalAccountLabel).toBe("ops@acme.test");
  });

  it("a customer can disconnect with no worker configured", async () => {
    // Our side must not depend on the provider being reachable, or a Google outage would
    // trap a customer in a connection they asked to end.
    const result = await disconnect(db, null, {
      tenantId: TENANT,
      source: "gmail",
      actor: "ada@example.test",
    });

    expect(result.revokedUpstream).toBe(false);
    const gmail = (await list(db, TENANT)).find((r) => r.source === "gmail");
    expect(gmail?.status).toBe("disconnected");
  });
});
