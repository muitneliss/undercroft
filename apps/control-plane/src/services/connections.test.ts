/**
 * The schedule of grants, as the card reads it.
 *
 * `presentStatus` is pure, so the rule deciding whether a customer is asked to reconnect is
 * asked from both sides with no database. The rest runs against real Postgres, because the
 * interesting part -- what a join reaching into `app.connection_secret` is allowed to bring
 * back, and what it must leave behind -- is a property of the query.
 */

import { migrate } from "@undercroft/db";
import {
  openRun,
  upsertConnection,
  writeConnectionDetail,
  writeCredential,
} from "@undercroft/db/repos";
import { createTestDatabase, type TestDatabase } from "@undercroft/db/testing";
import { afterEach, beforeEach, describe, expect, test as it } from "bun:test";

import {
  disconnect,
  KNOWN_SOURCES,
  list,
  presentStatus,
  setCadence,
  setScope,
  setToken,
} from "./connections.ts";
import { InMemoryWorkerClient } from "./inMemoryWorkerClient.ts";

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
  await db.become("undercroft_app");
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
      { env: ENV },
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

  it("the card says how often the source is read and when it is next due", async () => {
    // The same rule the scheduler's due list applies, so the card and the ledger agree.
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "hourly",
      actor: "ada@example.test",
    });
    await openRun(db, {
      id: "r-1",
      tenantId: TENANT,
      source: "hubspot",
      verb: "ingest",
      trigger: "schedule",
    });
    const startedAt = (await list(db, TENANT)).find((r) => r.source === "hubspot")?.lastRun
      ?.startedAt;

    const hubspot = (await list(db, TENANT, new Date("2026-03-01T10:00:00.000Z"))).find(
      (r) => r.source === "hubspot",
    );
    expect(hubspot?.cadence).toBe("hourly");
    expect(hubspot?.nextRunAt).toBe(
      new Date(new Date(startedAt ?? "").getTime() + 3_600_000).toISOString(),
    );
  });

  it("a paused source, and one still waiting for its scope, have no next run", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "paused",
      actor: "ada@example.test",
    });
    await upsertConnection(db, { tenantId: TENANT, source: "gmail", status: "connected" });

    const cards = await list(db, TENANT);
    expect(cards.find((r) => r.source === "hubspot")?.nextRunAt).toBeNull();
    expect(cards.find((r) => r.source === "gmail")?.nextRunAt).toBeNull();
    // A source nobody has connected reads the default and will not run.
    expect(cards.find((r) => r.source === "xero")).toMatchObject({
      cadence: "daily",
      nextRunAt: null,
    });
  });
});

describe("choosing a cadence", () => {
  it("is recorded on the connection and in the trail", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "hubspot", status: "connected" });
    const result = await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "every_6h",
      actor: "ada@example.test",
    });
    expect(result).toEqual({ ok: true });
    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.cadence_set");
    expect(JSON.stringify(rows[0]?.detail)).toContain('"cadence":"every_6h"');
  });

  it("a source nobody has connected has nothing to set it on", async () => {
    const result = await setCadence(db, {
      tenantId: TENANT,
      source: "hubspot",
      cadence: "hourly",
      actor: "ada@example.test",
    });
    expect(result).toEqual({ ok: false, reason: "no-connection" });
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

  it("a Xero choice records the organisation's id for runs and its name for the card", async () => {
    await upsertConnection(db, { tenantId: TENANT, source: "xero", status: "connected" });

    const result = await setScope(db, {
      tenantId: TENANT,
      source: "xero",
      selectionJson: JSON.stringify({
        organisation: { id: "org-9f2a", name: "Acme Pte Ltd" },
        entities: ["invoices", "contacts"],
      }),
      actor: "ada@example.test",
      actorId: "u1",
    });

    expect(result.ok).toBe(true);
    const xero = (await list(db, TENANT)).find((r) => r.source === "xero");
    expect(xero?.status).toBe("connected");
    // The id is what a run sends as `xero-tenant-id`; the name is what a person reads.
    expect(xero?.externalAccountId).toBe("org-9f2a");
    expect(xero?.externalAccountLabel).toBe("Acme Pte Ltd");
    expect(xero?.config.entities).toEqual(["invoices", "contacts"]);
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

describe("connecting with a pasted token", () => {
  it("hands the token to the worker to be proven and sealed, and audits the source alone", async () => {
    const worker = new InMemoryWorkerClient().backedBy(db);

    const result = await setToken(db, worker, {
      tenantId: TENANT,
      source: "hubspot",
      token: "pat-na1-secret",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: true });
    expect(worker.stored[0]).toMatchObject({
      source: "hubspot",
      validate: true,
      externalAccountId: "",
    });
    const hubspot = (await list(db, TENANT)).find((r) => r.source === "hubspot");
    expect(hubspot?.status).toBe("connected");
    const { rows } = await db.query<{ action: string; detail: unknown }>(
      "SELECT action, detail FROM ops.audit_log",
    );
    expect(rows[0]?.action).toBe("connection.connected");
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("pat-na1-secret");
  });

  it("a token the provider refused is reported as such, and nothing is audited", async () => {
    const worker = new InMemoryWorkerClient().failing("credential-rejected");

    const result = await setToken(db, worker, {
      tenantId: TENANT,
      source: "hubspot",
      token: "typo",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: false, reason: "rejected" });
    const { rows } = await db.query("SELECT 1 FROM ops.audit_log");
    expect(rows).toHaveLength(0);
  });

  it("a source that consents rather than pastes is refused before the worker is asked", async () => {
    const worker = new InMemoryWorkerClient();

    const result = await setToken(db, worker, {
      tenantId: TENANT,
      source: "gmail",
      token: "t",
      actor: "ada@example.test",
    });

    expect(result).toEqual({ ok: false, reason: "unsupported-source" });
    expect(worker.stored).toHaveLength(0);
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
